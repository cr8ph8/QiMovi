/**
 * Sanitize error-like values for inclusion in `audit_log.details`.
 *
 * Audit rows are queryable by operators and are surfaced in transparency
 * panels, so error payloads must never leak:
 *   - stack traces (file paths, internal source line numbers)
 *   - JWTs / bearer tokens / API keys
 *   - user emails
 *   - raw UUIDs (they identify other users' rows)
 *
 * Output shape is deliberately small and stable:
 *   { code?: string; message: string }
 *
 * `code` is preserved when the source is a PostgrestError-like object with a
 * short (<= 12 char) alphanumeric code. Longer / unknown codes are dropped —
 * they are more likely to be free-form text than a real error class.
 */

const MAX_MESSAGE_LEN = 240;

// Tokens that look like JWTs (`xxxxx.yyyyy.zzzzz`, base64url chars).
const JWT_RE = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
// Common "bearer <token>" / "sk_live_..." / "Api-Key ..." shapes.
const BEARER_RE = /\b(?:bearer|api[-_ ]?key|token|secret)[\s:=]+[A-Za-z0-9_\-.]{6,}/gi;
// Emails.
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// UUIDs (v1–v5 shape).
const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// Anything that looks like a file path with a line:col suffix (stack frames).
const STACK_FRAME_RE = /(?:\/[^\s()]+|[A-Za-z]:\\[^\s()]+):\d+(?::\d+)?/g;
// "at fn (path:line:col)" frames — collapse whole "at …" tails.
const AT_FRAME_RE = /\s+at\s+[^\n]+/g;
// Control chars including newlines/tabs — collapse to spaces so a single
// long line survives the length cap without carrying half a stack trace.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]+/g;

function stripSecrets(input: string): string {
  return input
    .replace(JWT_RE, "[redacted-jwt]")
    .replace(BEARER_RE, "[redacted-credential]")
    .replace(EMAIL_RE, "[redacted-email]")
    .replace(UUID_RE, "[redacted-uuid]");
}

function stripStack(input: string): string {
  // Cut everything from the first `\n at ` (Node/V8) or generic stack frames.
  const firstNewline = input.indexOf("\n");
  const head = firstNewline === -1 ? input : input.slice(0, firstNewline);
  return head.replace(AT_FRAME_RE, "").replace(STACK_FRAME_RE, "[redacted-path]");
}

function truncate(input: string, max = MAX_MESSAGE_LEN): string {
  if (input.length <= max) return input;
  return input.slice(0, max - 1).trimEnd() + "…";
}

function normalizeMessage(raw: string | null | undefined): string {
  if (raw == null) return "unknown_error";
  let out = String(raw);
  out = stripStack(out);
  out = stripSecrets(out);
  out = out.replace(CONTROL_RE, " ").replace(/\s{2,}/g, " ").trim();
  if (!out) return "unknown_error";
  return truncate(out);
}

function normalizeCode(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  // Accept short alphanumeric codes only (PostgREST SQLSTATE, e.g. "42501",
  // "PGRST116", "23505"). Anything else is likely free-form text.
  if (/^[A-Za-z0-9_-]{1,12}$/.test(s)) return s;
  return undefined;
}

export interface SanitizedAuditError {
  code?: string;
  message: string;
}

/**
 * Convert any error-like value into an audit-safe `{ code?, message }` pair.
 * Never throws. Always returns a message (falls back to `"unknown_error"`).
 */
export function sanitizeErrorForAudit(err: unknown): SanitizedAuditError {
  if (err == null) return { message: "unknown_error" };

  // String errors: no code available.
  if (typeof err === "string") {
    return { message: normalizeMessage(err) };
  }

  // Numbers / booleans / symbols: coerce to string, no code.
  if (typeof err !== "object") {
    return { message: normalizeMessage(String(err)) };
  }

  const obj = err as Record<string, unknown>;
  // PostgrestError-like: { code, message, details?, hint? }
  // Prefer `message`, ignore `details`/`hint` (may contain row data).
  const rawMessage =
    (typeof obj.message === "string" && obj.message) ||
    (err instanceof Error && err.message) ||
    "";
  const code = normalizeCode(obj.code);
  const out: SanitizedAuditError = { message: normalizeMessage(rawMessage) };
  if (code) out.code = code;
  return out;
}
