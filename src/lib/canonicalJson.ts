/**
 * Canonical JSON serializer used for disclosure signature verification.
 *
 * Must match `public.canonical_json(jsonb)` in the database byte-for-byte:
 *   - object keys sorted ascending (codepoint order, matches Postgres text sort
 *     on the ASCII keys we use)
 *   - arrays preserved in source order
 *   - scalars encoded with standard JSON.stringify (UTF-8, JSON escapes)
 *   - no whitespace between tokens
 *   - `undefined` is treated as `null` (so callers can't accidentally drop keys)
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "null";
    return JSON.stringify(value);
  }
  if (typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalJson(v)).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys
        .map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k]))
        .join(",") +
      "}"
    );
  }
  // functions, symbols, bigints — not expected in disclosure payloads
  return "null";
}

/** Hex-encoded SHA-256 of a UTF-8 string, using WebCrypto. */
export async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
