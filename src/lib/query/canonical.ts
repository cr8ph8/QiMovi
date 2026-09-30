/**
 * Deterministic JSON canonicalizer + SHA-256 helper used by the QUERY-contract
 * layer. Shared between client and edge functions so H(q) matches on both sides.
 *
 * Rules:
 *  - object keys sorted lexicographically
 *  - `undefined` fields dropped (both in objects and arrays)
 *  - NaN / Infinity → null (never valid JSON anyway)
 *  - no trailing whitespace, no pretty printing
 *
 * This is NOT full RFC 8785 JCS — it is deliberately small and covers the
 * payload shapes our read-only edge functions accept. If we ever need JCS
 * proper, swap the implementation without touching call sites.
 */

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : sortValue(item)));
  }
  if (typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      const v = src[key];
      if (v === undefined) continue;
      out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}

/** SHA-256 of a UTF-8 string, hex-encoded. Works in browsers, Deno, and Node ≥18. */
export async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const subtle: SubtleCrypto | undefined =
    (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) {
    throw new Error("SubtleCrypto unavailable — cannot compute SHA-256");
  }
  const digest = await subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Canonical hash of a value: sha256(canonicalize(value)). */
export async function hashCanonical(value: unknown): Promise<string> {
  return sha256Hex(canonicalize(value));
}

/**
 * Compute the evidence hash the server would have written for a given raw
 * response text. Mirrors the edge-function pipeline in queryContract.ts:
 *
 *   evidenceHash = sha256(canonicalize(JSON.parse(bodyText)))
 *
 * The response is JSON-parsed first so key order in the wire payload is
 * irrelevant — the same object always hashes to the same value. Non-JSON
 * responses fall back to hashing the raw bytes (matches server behaviour
 * for endpoints that opt out of JSON canonicalization in the future).
 */
export async function computeExpectedEvidenceHash(responseText: string): Promise<string> {
  try {
    const parsed = responseText.length === 0 ? null : JSON.parse(responseText);
    return hashCanonical(parsed);
  } catch {
    return sha256Hex(responseText);
  }
}
