/**
 * QUERY-readiness registry.
 *
 * Static inventory of edge functions with a declared intent so the Governance
 * dashboard can show, honestly, which endpoints obey the read/write boundary
 * from the QUERY-contract layer and which do not yet.
 *
 * NEVER mark an endpoint `enforced: true` unless it actually runs through the
 * `readOnlyHandler` wrapper in `supabase/functions/_shared/queryContract.ts`.
 */

export type QueryIntent = "read" | "write" | "mixed";

export type ContractBadge =
  /** Wrapped in readOnlyHandler — write attempts fail at the DB. */
  | "read_only_wrapper"
  /** Writes an evidence tuple to query_evidence_log. */
  | "evidence_log"
  /** Accepts a caller-supplied state_hash snapshot pin. */
  | "state_pin"
  /** Response defaults to Cache-Control: private, no-store. */
  | "cache_no_store"
  /** Query/evidence hashes are bound to a submission context (entry/project/…). */
  | "context_binding";

export interface EndpointEntry {
  name: string;
  intent: QueryIntent;
  /** True only when the wrapper is actually applied in the deployed function. */
  enforced: boolean;
  badges: ContractBadge[];
  /** One-line human summary of what the endpoint does. */
  purpose: string;
}

/**
 * Operations that MUST NEVER be exposed under an HTTP QUERY method or
 * under any endpoint labelled `read` here. Mirrors §8 of the QUERY essay.
 */
export const NEVER_QUERY_OPERATIONS: readonly string[] = [
  "adding or deleting memories",
  "admitting a claim",
  "committing a proposal",
  "changing policy",
  "altering validators",
  "rollback",
  "revocation",
  "model updates",
  "governance edits",
  "acquiring a durable lock",
  "appending a decision to the authoritative ledger",
] as const;

/**
 * Endpoints inventoried for QUERY-readiness. Kept small and honest: we list
 * only the read-shaped endpoints we have actually reviewed. Unlisted functions
 * are presumed write/mixed until reviewed.
 */
export const QUERY_READY_ENDPOINTS: readonly EndpointEntry[] = [
  {
    name: "list-gate-decisions",
    intent: "read",
    enforced: true,
    badges: ["read_only_wrapper", "evidence_log", "cache_no_store", "context_binding"],
    purpose: "Return recent OKF admission-gate decisions for a project.",
  },
  {
    name: "read-evidence-bundle",
    intent: "read",
    enforced: true,
    badges: ["read_only_wrapper", "evidence_log", "cache_no_store", "context_binding"],
    purpose:
      "Return the last persisted TPAS evidence bundle + fresh version/event/node counts. Admin+Pro. Never mutates hashes.",
  },
  {
    name: "read-context-bundle",
    intent: "read",
    enforced: true,
    badges: ["read_only_wrapper", "evidence_log", "cache_no_store", "context_binding"],
    purpose:
      "Return latest persisted context_bundles + project_artifacts mirrors for a project/entry. Owner or admin.",
  },
  {
    name: "read-protected-authors",
    intent: "read",
    enforced: true,
    badges: ["read_only_wrapper", "evidence_log", "cache_no_store", "context_binding"],
    purpose:
      "Return the protected-authors registry plus, when entry_id is supplied, that entry's emulation flags. Admin only. Never writes.",
  },
  {
    name: "read-governance-events",
    intent: "read",
    enforced: true,
    badges: ["read_only_wrapper", "evidence_log", "cache_no_store", "context_binding"],
    purpose:
      "Read-only slice of the governance audit ledger with optional entry / type / status / since filters. Admin only. Never appends events.",
  },
  {
    name: "export-evidence-bundle",
    intent: "write",
    enforced: false,
    badges: [],
    purpose:
      "Recomputes hashes, persists bundle to entries.parsed_metadata, writes governance audit. Read path split out to read-evidence-bundle.",
  },
  {
    name: "build-context-bundle",
    intent: "write",
    enforced: false,
    badges: [],
    purpose:
      "Spends tokens, invokes build spine, mirrors into project_artifacts, writes governance audit. Read path split out to read-context-bundle.",
  },
  {
    name: "scan-protected-author-emulation",
    intent: "write",
    enforced: false,
    badges: [],
    purpose:
      "Runs detection scans and inserts author_emulation_flags via log_author_emulation_flag RPC. Read path split out to read-protected-authors.",
  },
  {
    name: "export-document",
    intent: "write",
    enforced: false,
    badges: [],
    purpose:
      "Renders DOCX/PPTX artifacts and writes an audit_log row per export. Not read-safe; the canonical read of the underlying business_documents row happens directly via RLS on the client.",
  },
] as const;
