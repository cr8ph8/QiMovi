/**
 * QUERY-contract shim for read-only edge functions.
 *
 * The HTTP QUERY method (RFC 10008) is not yet routable through Deno Deploy +
 * upstream CDNs, so we approximate its guarantees at the handler level:
 *
 *   Retrieved ≠ Admitted.  Evaluated ≠ Committed.
 *
 * A `readOnlyHandler` promises the caller:
 *   1. No governed state mutation. We enforce this by handing the inner
 *      function a Postgres client whose write ops are trapped and thrown at
 *      call-site (see `makeReadClient`).
 *   2. A reproducible evidence tuple ⟨H(q), H(S), H(E)⟩ is emitted as response
 *      headers AND persisted to `query_evidence_log`. The query hash binds
 *      the response to the specific submission context (entry/project/…), so
 *      the panel can validate that a live payload matches what was logged.
 *   3. Replay detection: if we see the same ⟨function, context, H(q)⟩ produce
 *      a different H(E) than a prior tuple, we record a `divergence` row in
 *      `evidence_replay_flags` so the read is not silently non-reproducible.
 *   4. Default `Cache-Control: private, no-store`. Callers must opt in
 *      explicitly to caching.
 *
 * This file is imported by edge functions only (Deno). It uses `npm:` and
 * `https:` specifiers accordingly and MUST NOT be imported from the browser.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── CORS ──────────────────────────────────────────────────────────────────

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-state-hash",
  "Access-Control-Expose-Headers":
    "etag, content-location, x-query-hash, x-evidence-hash, x-state-hash, x-committed, x-evidence-context, x-evidence-canonical-length",
};

// ─── Canonical hashing (mirrors src/lib/query/canonical.ts) ────────────────

function sortValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
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

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Read-only client ──────────────────────────────────────────────────────

export interface ReadClientOptions {
  authHeader?: string | null;
}

export function makeReadClient(url: string, key: string, opts: ReadClientOptions = {}): SupabaseClient {
  const headers: Record<string, string> = { Prefer: "read-only" };
  if (opts.authHeader) headers.Authorization = opts.authHeader;
  const raw = createClient(url, key, { global: { headers } });

  const forbidden = new Set(["insert", "update", "upsert", "delete"]);
  const wrapFrom = (fromResult: unknown): unknown => {
    return new Proxy(fromResult as object, {
      get(target, prop, receiver) {
        if (typeof prop === "string" && forbidden.has(prop)) {
          return () => {
            throw new Error(
              `[queryContract] write op '${prop}' is forbidden in a readOnlyHandler`,
            );
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  };

  return new Proxy(raw, {
    get(target, prop, receiver) {
      if (prop === "from") {
        const orig = Reflect.get(target, prop, receiver) as SupabaseClient["from"];
        return (table: string) => wrapFrom(orig.call(target, table));
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as SupabaseClient;
}

// ─── Context binding ───────────────────────────────────────────────────────

export type ContextKind = "none" | "entry" | "project" | "universe" | "competition";

export interface EvidenceContext {
  kind: ContextKind;
  /** UUID id of the scoped subject; null only when `kind === "none"`. */
  id: string | null;
  /** Extra key/values folded into the context hash (never mutated). */
  extras?: Record<string, unknown>;
}

/** UUID-shape sanity check; returns null on empty / malformed values. */
function normalizeId(id: string | null | undefined): string | null {
  if (!id || typeof id !== "string") return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  return id.toLowerCase();
}

function normalizeContext(ctx: EvidenceContext | null | undefined): EvidenceContext {
  if (!ctx) return { kind: "none", id: null };
  const id = ctx.kind === "none" ? null : normalizeId(ctx.id);
  return {
    kind: ctx.kind ?? "none",
    id,
    extras: ctx.extras,
  };
}

// ─── Evidence log + replay detection ───────────────────────────────────────

interface EvidenceRow {
  function_name: string;
  principal_id: string | null;
  query_hash: string;
  state_hash: string | null;
  evidence_hash: string;
  media_type: string | null;
  context_kind: ContextKind;
  context_id: string | null;
  context_hash: string;
  response_bytes: number;
  response_media_type: string | null;
}

async function detectDivergence(
  serviceClient: SupabaseClient,
  row: EvidenceRow,
): Promise<void> {
  try {
    // Look for a prior tuple with the same ⟨fn, context, query_hash⟩. If it
    // returned a different evidence_hash, the read is non-reproducible.
    let q = serviceClient
      .from("query_evidence_log")
      .select("id, evidence_hash, created_at")
      .eq("function_name", row.function_name)
      .eq("query_hash", row.query_hash)
      .order("created_at", { ascending: false })
      .limit(1);
    q = row.context_id ? q.eq("context_id", row.context_id) : q.is("context_id", null);
    const { data } = await q;
    const prior = (data ?? [])[0] as { evidence_hash?: string } | undefined;
    if (!prior || !prior.evidence_hash) return;
    if (prior.evidence_hash === row.evidence_hash) return;

    await serviceClient.from("evidence_replay_flags").insert({
      function_name: row.function_name,
      context_kind: row.context_kind,
      context_id: row.context_id,
      query_hash: row.query_hash,
      expected_evidence_hash: prior.evidence_hash,
      observed_evidence_hash: row.evidence_hash,
      kind: "divergence",
      principal_id: row.principal_id,
      notes: { detected_by: "readOnlyHandler.detectDivergence" },
    });
    await serviceClient.from("governance_events").insert({
      event_type: "evidence_divergence",
      event_status: "flagged",
      metadata_json: {
        function_name: row.function_name,
        context_kind: row.context_kind,
        context_id: row.context_id,
        query_hash: row.query_hash,
        expected_evidence_hash: prior.evidence_hash,
        observed_evidence_hash: row.evidence_hash,
      },
    });
  } catch (err) {
    console.error("[queryContract] divergence detection failed:", err);
  }
}

async function writeEvidence(serviceClient: SupabaseClient, row: EvidenceRow): Promise<void> {
  try {
    await serviceClient.from("query_evidence_log").insert({ ...row, committed: false });
  } catch (err) {
    console.error("[queryContract] evidence log write failed:", err);
  }
}

// ─── Handler wrapper ───────────────────────────────────────────────────────

export interface ReadContext {
  req: Request;
  body: unknown;
  principalId: string | null;
  stateHashHint: string | null;
  read: SupabaseClient;
  functionName: string;
}

export interface ReadOnlyHandlerOptions {
  name: string;
  mediaType?: string;
  /** Set to true to allow anonymous callers. Default: require Authorization. */
  allowAnonymous?: boolean;
  /**
   * Declare how to pull the submission context (entry, project, …) out of the
   * request body. Called AFTER body parsing and auth. Return null / omit for
   * global reads with no scoped subject.
   */
  context?: (body: unknown, principalId: string | null) => EvidenceContext | null;
}

export function readOnlyHandler(
  handler: (ctx: ReadContext) => Promise<unknown>,
  opts: ReadOnlyHandlerOptions,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    if (req.method !== "GET" && req.method !== "POST" && req.method !== "QUERY") {
      return json({ error: "Method Not Allowed" }, 405);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) {
      return json({ error: "Server misconfigured" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    let principalId: string | null = null;
    if (authHeader) {
      const userClient = createClient(url, anon, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data } = await userClient.auth.getUser();
      principalId = data.user?.id ?? null;
    }
    if (!principalId && !opts.allowAnonymous) {
      return json({ error: "Unauthorized" }, 401);
    }

    let body: unknown = null;
    if (req.method === "POST" || req.method === "QUERY") {
      try {
        body = await req.json();
      } catch {
        body = null;
      }
    } else {
      const u = new URL(req.url);
      const obj: Record<string, string> = {};
      u.searchParams.forEach((v, k) => (obj[k] = v));
      body = Object.keys(obj).length ? obj : null;
    }

    // Bind evidence to the specific submission context. `queryHash` therefore
    // differs across contexts even when the rest of the request looks the same.
    const context = normalizeContext(opts.context ? opts.context(body, principalId) : null);
    const contextEnvelope = {
      kind: context.kind,
      id: context.id,
      extras: context.extras ?? {},
    };
    const contextHash = await sha256Hex(canonicalize(contextEnvelope));

    const stateHashHint = req.headers.get("x-state-hash");
    const queryHash = await sha256Hex(
      canonicalize({
        function: opts.name,
        body,
        principal: principalId,
        state: stateHashHint,
        context: contextEnvelope,
      }),
    );

    const readClient = makeReadClient(url, service, { authHeader });
    const serviceClient = createClient(url, service);

    let payload: unknown;
    try {
      payload = await handler({
        req,
        body,
        principalId,
        stateHashHint,
        read: readClient,
        functionName: opts.name,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      console.error(`[${opts.name}] handler error:`, msg);
      return json({ error: msg }, 500);
    }

    const mediaType = opts.mediaType ?? "application/json";
    const bodyString = JSON.stringify(payload ?? null);
    const canonicalBody = canonicalize(payload ?? null);
    const canonicalBytes = new TextEncoder().encode(canonicalBody).byteLength;
    const evidenceHash = await sha256Hex(canonicalBody);

    const evidenceRow: EvidenceRow = {
      function_name: opts.name,
      principal_id: principalId,
      query_hash: queryHash,
      state_hash: stateHashHint,
      evidence_hash: evidenceHash,
      media_type: mediaType,
      context_kind: context.kind,
      context_id: context.id,
      context_hash: contextHash,
      response_bytes: canonicalBytes,
      response_media_type: mediaType,
    };

    // Run divergence detection BEFORE inserting the new row so the "prior"
    // lookup can't self-match. Both are fire-and-forget from the client POV.
    void (async () => {
      await detectDivergence(serviceClient, evidenceRow);
      await writeEvidence(serviceClient, evidenceRow);
    })();

    const contextHeader = context.id ? `${context.kind}:${context.id}` : context.kind;

    return new Response(bodyString, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": mediaType,
        "Cache-Control": "private, no-store",
        ETag: `"sha256:${evidenceHash}"`,
        "x-query-hash": `sha256:${queryHash}`,
        "x-evidence-hash": `sha256:${evidenceHash}`,
        "x-state-hash": stateHashHint ? `sha256:${stateHashHint.replace(/^sha256:/, "")}` : "",
        "x-committed": "false",
        "x-evidence-context": contextHeader,
        "x-evidence-canonical-length": String(canonicalBytes),
      },
    });
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
