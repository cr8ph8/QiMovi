import { useState, useCallback } from "react";

export interface EvidenceTuple {
  queryHash: string | null;
  evidenceHash: string | null;
  stateHash: string | null;
  committed: boolean;
  capturedAt: string;
  /** Context envelope the server bound to this read (e.g. "entry:<uuid>"). */
  contextKind: string | null;
  contextId: string | null;
  /** Byte length of the canonicalized response, so callers can recompute H(E). */
  canonicalLength: number | null;
}

/**
 * Extracts the QUERY-contract headers from a `fetch` Response (as returned by
 * `supabase.functions.invoke` when using `Prefer: return=headers`, or from a
 * direct `fetch(functionUrl)` call).
 *
 * Non-invasive: read handlers set these headers automatically via
 * `readOnlyHandler`. Legacy handlers simply return nulls.
 */
export function useEvidenceTuple() {
  const [tuple, setTuple] = useState<EvidenceTuple | null>(null);

  const capture = useCallback((headers: Headers | Record<string, string> | null | undefined) => {
    if (!headers) {
      setTuple(null);
      return null;
    }
    const get = (k: string): string | null => {
      if (headers instanceof Headers) return headers.get(k);
      const rec = headers as Record<string, string>;
      return rec[k] ?? rec[k.toLowerCase()] ?? null;
    };
    const ctx = get("x-evidence-context");
    let contextKind: string | null = null;
    let contextId: string | null = null;
    if (ctx) {
      const [kind, id] = ctx.split(":", 2);
      contextKind = kind || null;
      contextId = id || null;
    }
    const lenRaw = get("x-evidence-canonical-length");
    const canonicalLength = lenRaw && /^\d+$/.test(lenRaw) ? Number(lenRaw) : null;
    const next: EvidenceTuple = {
      queryHash: get("x-query-hash"),
      evidenceHash: get("x-evidence-hash"),
      stateHash: get("x-state-hash") || null,
      committed: (get("x-committed") ?? "false") === "true",
      capturedAt: new Date().toISOString(),
      contextKind,
      contextId,
      canonicalLength,
    };
    setTuple(next);
    return next;
  }, []);

  return { tuple, capture };
}
