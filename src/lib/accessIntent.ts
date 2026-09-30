// Intent preservation: when a user is blocked by an access gate (e.g. they
// need to sign in or upgrade), we capture where they were and what they
// were trying to do so we can send them back after they unlock.
//
// Stored in sessionStorage so it survives the auth round-trip (including
// Google OAuth) but never leaks across tabs/sessions.

const KEY = "access_gate_intent";

export interface AccessIntent {
  /** Path + query + hash to return to. Always same-origin. */
  returnTo: string;
  /** Optional stable id of the locked action that triggered the gate. */
  actionId?: string;
  /** Human-readable reason (for telemetry / UI hints). */
  reason?: string;
  /** Epoch ms when the intent was captured. */
  capturedAt: number;
}

const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
const RETURN_PATH_BASE = "https://return-path.invalid";

/** Restrict redirects to normalized same-origin paths. */
export function isSafeReturnPath(path: string | null | undefined): path is string {
  if (!path || typeof path !== "string") return false;
  if (!path.startsWith("/")) return false;

  // Browsers normalize backslashes as URL separators. Decode a few layers as
  // well so encoded separators or controls cannot be smuggled through an auth
  // round-trip and later reinterpreted as an external redirect.
  let decoded = path;
  for (let i = 0; i < 3; i += 1) {
    if (decoded.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(decoded)) return false;
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return false;
    }
  }
  if (decoded.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(decoded)) return false;

  try {
    const resolved = new URL(path, RETURN_PATH_BASE);
    return resolved.origin === RETURN_PATH_BASE && resolved.pathname.startsWith("/");
  } catch {
    return false;
  }
}

export function saveAccessIntent(intent: Omit<AccessIntent, "capturedAt">): void {
  if (typeof window === "undefined") return;
  if (!isSafeReturnPath(intent.returnTo)) return;
  try {
    const payload: AccessIntent = { ...intent, capturedAt: Date.now() };
    sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* sessionStorage may be unavailable (private mode, SSR) */
  }
}

export function loadAccessIntent(): AccessIntent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AccessIntent;
    if (!isSafeReturnPath(parsed.returnTo)) return null;
    if (Date.now() - (parsed.capturedAt ?? 0) > MAX_AGE_MS) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearAccessIntent(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Resolve the post-auth / post-upgrade destination, preferring (in order):
 *   1. ?redirect=<path> query param (must be same-origin)
 *   2. saved sessionStorage intent
 *   3. provided fallback (default "/my-submissions")
 */
export function resolveRedirectPath(search: string | URLSearchParams, fallback = "/my-submissions"): string {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const fromQuery = params.get("redirect");
  if (isSafeReturnPath(fromQuery)) return fromQuery;
  const intent = loadAccessIntent();
  if (intent && isSafeReturnPath(intent.returnTo)) return intent.returnTo;
  return fallback;
}

/** Append ?redirect=<encoded> to a path, preserving existing query. */
export function withRedirect(href: string, returnTo: string): string {
  if (!isSafeReturnPath(returnTo)) return href;
  const [pathAndQuery, hash] = href.split("#");
  const [path, query] = pathAndQuery.split("?");
  const params = new URLSearchParams(query || "");
  params.set("redirect", returnTo);
  return `${path}?${params.toString()}${hash ? `#${hash}` : ""}`;
}
