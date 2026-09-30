/**
 * Client-side replay validator.
 *
 * Cross-checks a live read response against the tuple recorded in
 * `query_evidence_log`. Answers three questions in one call:
 *
 *   PASS         — a matching log row exists for ⟨fn, context, query_hash⟩
 *                  and its `evidence_hash` equals the one we recomputed here.
 *   DIVERGED     — a row exists with the same query_hash but a different
 *                  evidence_hash. The response was inconsistent with what
 *                  the server previously logged for this exact query, OR the
 *                  payload was mutated after leaving the edge function.
 *                  Records a `substitution` flag when appropriate.
 *   NOT_LOGGED   — no matching row was found. Because the evidence write is
 *                  fire-and-forget, callers should retry once after a short
 *                  delay before treating this as a violation.
 *
 * The evidence log is admin-scoped by RLS, so this validator only produces a
 * meaningful answer for admin/god-mode callers. Non-admin callers will always
 * receive NOT_LOGGED because they can't see the log; the panel that uses this
 * validator is admin-only.
 */

import { supabase } from "@/integrations/supabase/client";

export type ValidationStatus = "pass" | "diverged" | "not_logged";

export interface ValidationInput {
  functionName: string;
  contextKind: string;
  contextId: string | null;
  queryHash: string;
  evidenceHash: string;
  principalId?: string | null;
}

export interface ValidationResult {
  status: ValidationStatus;
  expectedEvidenceHash: string | null;
  observedEvidenceHash: string;
  logRowId: string | null;
  loggedAt: string | null;
}

/** Strip a `sha256:` prefix so equality checks are cheap and consistent. */
export function stripHashPrefix(hash: string): string {
  return hash.replace(/^sha256:/, "").toLowerCase();
}

export async function validateAgainstLog(input: ValidationInput): Promise<ValidationResult> {
  const q = stripHashPrefix(input.queryHash);
  const e = stripHashPrefix(input.evidenceHash);
  const observed = `sha256:${e}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("query_evidence_log")
    .select("id, created_at, evidence_hash")
    .eq("function_name", input.functionName)
    .order("created_at", { ascending: false })
    .limit(1);
  // Match query_hash both with and without the sha256: prefix defensively.
  query = query.in("query_hash", [q, `sha256:${q}`]);
  query = input.contextId ? query.eq("context_id", input.contextId) : query.is("context_id", null);

  const { data, error } = await query;
  if (error) {
    return {
      status: "not_logged",
      expectedEvidenceHash: null,
      observedEvidenceHash: observed,
      logRowId: null,
      loggedAt: null,
    };
  }

  const row = (data ?? [])[0] as
    | { id: string; created_at: string; evidence_hash: string }
    | undefined;
  if (!row) {
    return {
      status: "not_logged",
      expectedEvidenceHash: null,
      observedEvidenceHash: observed,
      logRowId: null,
      loggedAt: null,
    };
  }

  const loggedHash = stripHashPrefix(row.evidence_hash);
  if (loggedHash === e) {
    return {
      status: "pass",
      expectedEvidenceHash: `sha256:${loggedHash}`,
      observedEvidenceHash: observed,
      logRowId: row.id,
      loggedAt: row.created_at,
    };
  }

  // Divergence detected client-side. Server-side detection covers server-to-
  // server drift; this covers post-response mutation and client-visible drift.
  await recordSubstitutionFlag({
    functionName: input.functionName,
    contextKind: input.contextKind,
    contextId: input.contextId,
    queryHash: `sha256:${q}`,
    expected: `sha256:${loggedHash}`,
    observed,
    principalId: input.principalId ?? null,
  });

  return {
    status: "diverged",
    expectedEvidenceHash: `sha256:${loggedHash}`,
    observedEvidenceHash: observed,
    logRowId: row.id,
    loggedAt: row.created_at,
  };
}

async function recordSubstitutionFlag(params: {
  functionName: string;
  contextKind: string;
  contextId: string | null;
  queryHash: string;
  expected: string;
  observed: string;
  principalId: string | null;
}): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("evidence_replay_flags").insert({
      function_name: params.functionName,
      context_kind: params.contextKind,
      context_id: params.contextId,
      query_hash: params.queryHash,
      expected_evidence_hash: params.expected,
      observed_evidence_hash: params.observed,
      kind: "substitution",
      principal_id: params.principalId,
      notes: { detected_by: "client.validateAgainstLog" },
    });
  } catch {
    // RLS may deny writes for non-admins; the divergence stays visible in the
    // panel's live comparison regardless.
  }
}
