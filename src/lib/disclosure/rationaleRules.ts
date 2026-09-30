/**
 * Disclosure rationale rules for `WhatYouSeePreview`.
 *
 * Every row in the public-preview simulation now resolves to exactly one of
 * these rule ids, so we can emit a machine-readable audit log alongside the
 * human-readable "why?" tooltips. Rule ids are stable strings — treat them
 * as the audit anchor and only add new ones; never rename or reuse.
 *
 * Consumers:
 *   - `WhatYouSeePreview` reads `RULE_DEFS[rule_id].summary` for the UI
 *     tooltip and dumps the full rationale log to JSON on demand.
 *   - Downstream auditors validate each row against the current rule set
 *     when replaying an entry's disclosure decisions.
 */

export type DisclosureStatus = "visible" | "redacted" | "conditional";

export type DisclosureRuleId =
  | "visibility_public"
  | "visibility_gated"
  | "blind_review_identity"
  | "blind_review_contact"
  | "blind_review_coauthor"
  | "ai_disclosure_public_anchor"
  | "ai_detail_requires_declaration"
  | "ai_prompt_never_public"
  | "script_body_embargoed"
  | "script_body_sharing_on"
  | "script_body_sharing_off"
  | "evidence_hash_available"
  | "evidence_hash_pending"
  | "internal_correlation_ids";

export interface DisclosureRuleDef {
  /** Category badge for grouping in the rationale UI. */
  category:
    | "visibility"
    | "blind_review"
    | "ai_disclosure"
    | "reader_view"
    | "evidence"
    | "internal";
  /** Terminal status this rule always yields. */
  status: DisclosureStatus;
  /** One-line human explanation used as the tooltip text. */
  summary: string;
  /**
   * Plain-language explanation shown to entrants in the rationale log so
   * they understand *why* a row was classified — no jargon, no policy refs.
   * Written in second person, as if explaining to the entrant directly.
   */
  plainLanguage: string;
  /** Long-form policy pointer for auditors reviewing the log. */
  policy: string;
}

export const RULE_DEFS: Record<DisclosureRuleId, DisclosureRuleDef> = {
  visibility_public: {
    category: "visibility",
    status: "visible",
    summary: "Shown on the public evidence page.",
    plainLanguage:
      "You set this entry's visibility to public, so this field appears on the public evidence page for anyone to see.",
    policy:
      "entry.visibility === 'public' — field is rendered on the public evidence page.",
  },
  visibility_gated: {
    category: "visibility",
    status: "conditional",
    summary:
      "Would show on the public evidence page once visibility is set to 'public'.",
    plainLanguage:
      "Your entry is currently private, so this field is held back. Flip visibility to public and it will appear on the evidence page.",
    policy:
      "entry.visibility !== 'public' — field is withheld until the entrant flips visibility to public.",
  },
  blind_review_identity: {
    category: "blind_review",
    status: "redacted",
    summary:
      "Author identity is hidden from public readers to preserve blind review integrity.",
    plainLanguage:
      "Judges score your work without knowing who wrote it. Your name stays hidden from public readers no matter what visibility you pick.",
    policy:
      "Blind review policy: writer_name is never surfaced to public readers, regardless of visibility.",
  },
  blind_review_contact: {
    category: "blind_review",
    status: "redacted",
    summary:
      "Contact details are never surfaced publicly — used only for submission notifications.",
    plainLanguage:
      "We only use your email to send you submission updates. It is never displayed on any public page.",
    policy:
      "PII policy: writer_email is a transactional contact channel and is excluded from every public surface.",
  },
  blind_review_coauthor: {
    category: "blind_review",
    status: "redacted",
    summary:
      "Co-author identities follow the same blind-review rule as the primary writer.",
    plainLanguage:
      "Co-writers are treated like you: their names are hidden from public readers to keep judging blind.",
    policy:
      "Blind review policy: co_author is treated as an identity field and never rendered publicly.",
  },
  ai_disclosure_public_anchor: {
    category: "ai_disclosure",
    status: "visible",
    summary:
      "Self-reported disclosure is always public on the evidence page — this is the audit anchor.",
    plainLanguage:
      "Whether you declared AI use is always public. It is the honesty anchor readers rely on, so it shows even if the rest of your entry is private.",
    policy:
      "Transparency policy: the declared AI status is a public audit anchor. Its visibility does not require entry.visibility=public.",
  },
  ai_detail_requires_declaration: {
    category: "ai_disclosure",
    status: "conditional",
    summary:
      "Category and genre labels accompany the disclosure when AI use is declared.",
    plainLanguage:
      "These extra AI labels only appear when you have declared AI use. If you marked the entry as human-written, they stay hidden.",
    policy:
      "Detail policy: ai_category / ai_genre are only shown when ai_disclosure.is_ai_generated === true.",
  },
  ai_prompt_never_public: {
    category: "ai_disclosure",
    status: "redacted",
    summary:
      "Prompts and model configuration stay in the receipt hash but are never rendered to public readers.",
    plainLanguage:
      "Your prompts and model settings are protected. They are folded into the evidence hash for auditors but never shown to the public.",
    policy:
      "Model-config policy: raw prompts and provider settings are hash-committed for audit but never published.",
  },
  script_body_embargoed: {
    category: "reader_view",
    status: "redacted",
    summary: "Script body is under embargo.",
    plainLanguage:
      "You (or the competition) placed the script under an embargo. Readers cannot see the pages until that embargo date passes.",
    policy:
      "embargo_until > now(): script body is withheld from every reader surface until the embargo window elapses.",
  },
  script_body_sharing_on: {
    category: "reader_view",
    status: "visible",
    summary: "Reader view is enabled for this entry.",
    plainLanguage:
      "You turned on reader view, so the script pages are available through the sharing mode you selected.",
    policy:
      "sharing_mode ∈ {'public','link'}: reader view surfaces the script body to allowed audiences.",
  },
  script_body_sharing_off: {
    category: "reader_view",
    status: "conditional",
    summary:
      "Reader view is off. Turn on sharing to publish the script body.",
    plainLanguage:
      "Reader view is off, so the script body stays private. Enable sharing when you want readers to open the pages.",
    policy:
      "sharing_mode === 'private': script body stays hidden until the entrant enables reader view.",
  },
  evidence_hash_available: {
    category: "evidence",
    status: "visible",
    summary:
      "Hash is public evidence that this exact submission was scored — no private data can be reversed from it.",
    plainLanguage:
      "The hash is a fingerprint that proves the exact version we scored. It is safe to publish — nobody can reverse it to see your script.",
    policy:
      "evidence_bundle_hash present and entry.visibility === 'public': hash is a public integrity anchor.",
  },
  evidence_hash_pending: {
    category: "evidence",
    status: "redacted",
    summary: "Hash is generated when the submission is finalized.",
    plainLanguage:
      "We haven't finalized this submission yet, so there is no hash to show. It appears automatically once judging locks the entry.",
    policy:
      "evidence_bundle_hash is null: no anchor exists yet, so nothing is exposed.",
  },
  internal_correlation_ids: {
    category: "internal",
    status: "redacted",
    summary:
      "Judge identities and internal correlation ids are never exposed to entrants or the public.",
    plainLanguage:
      "Judge names and our internal tracking ids stay inside the platform. Neither you nor the public ever see them.",
    policy:
      "Internal-only fields (judge ids, correlation ids) are excluded from every entrant-facing and public surface.",
  },
};

/** Serializable audit row — one per field in the "What you see" preview. */
export interface RationaleLogRow {
  field: string;
  status: DisclosureStatus;
  rule_id: DisclosureRuleId;
  rule_summary: string;
  rule_plain_language: string;
  rule_policy: string;
  rule_category: DisclosureRuleDef["category"];
  /** Inputs that drove the decision at evaluation time. */
  inputs: Record<string, unknown>;
  /** Whether the underlying field has a non-null value on this entry. */
  value_present: boolean;
}

export interface RationaleLog {
  schema: "wys_rationale_log_v1";
  entry_id: string;
  generated_at: string;
  visibility: string | null;
  sharing_mode: string | null;
  embargo_until: string | null;
  ai_declared: boolean;
  counts: { visible: number; conditional: number; redacted: number };
  rows: RationaleLogRow[];
}

/**
 * Canonical set of recognized rule ids, derived from `RULE_DEFS`. Used at
 * runtime to validate that a rationale log doesn't reference a rule id we
 * no longer publish (e.g. a stale build, a copy-pasted log, or a bug in a
 * row builder). Keep this derived from the object — never hand-maintained.
 */
export const KNOWN_DISCLOSURE_RULE_IDS: ReadonlySet<DisclosureRuleId> =
  new Set(Object.keys(RULE_DEFS) as DisclosureRuleId[]);

export function isKnownDisclosureRuleId(
  id: unknown,
): id is DisclosureRuleId {
  return typeof id === "string" && KNOWN_DISCLOSURE_RULE_IDS.has(id as DisclosureRuleId);
}

export interface RationaleLogValidationIssue {
  /** Row index in `log.rows` where the problem was found. */
  row_index: number;
  /** Field label on the offending row (for user-facing messages). */
  field: string;
  /** The rule_id value we saw — may not be a valid DisclosureRuleId. */
  rule_id: string;
  reason: "unknown_rule_id" | "missing_rule_id";
}

export interface RationaleLogValidationResult {
  valid: boolean;
  issues: RationaleLogValidationIssue[];
  /** Deduplicated unknown ids, useful for a single summary toast. */
  unknown_ids: string[];
}

/**
 * Validate that every row in a rationale log uses a recognized
 * `DisclosureRuleId`. Callers MUST run this before submitting or persisting
 * the log so we never ship rows tagged with retired or misspelled ids.
 */
export function validateRationaleLog(
  log: Pick<RationaleLog, "rows">,
): RationaleLogValidationResult {
  const issues: RationaleLogValidationIssue[] = [];
  const unknown = new Set<string>();
  log.rows.forEach((row, index) => {
    const id = row?.rule_id as unknown;
    if (id === undefined || id === null || id === "") {
      issues.push({
        row_index: index,
        field: row?.field ?? "(unknown field)",
        rule_id: "",
        reason: "missing_rule_id",
      });
      return;
    }
    if (!isKnownDisclosureRuleId(id)) {
      const idStr = String(id);
      unknown.add(idStr);
      issues.push({
        row_index: index,
        field: row?.field ?? "(unknown field)",
        rule_id: idStr,
        reason: "unknown_rule_id",
      });
    }
  });
  return {
    valid: issues.length === 0,
    issues,
    unknown_ids: Array.from(unknown),
  };
}
