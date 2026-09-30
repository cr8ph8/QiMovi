/**
 * Submission gate diagnostics — a read-only "dry run" that mirrors every
 * check the server-side trigger `tg_enforce_submission_gates` performs,
 * plus the client-side pre-checks in `SubmissionPortal.handleSubmitToCompetition`.
 *
 * Purpose: give writers a copy-paste-clear list of what is passing, what is
 * failing, and — critically — *how to fix each failure* before they burn
 * tokens on a submission that the trigger would reject.
 *
 * Every diagnostic mirrors a specific SQL/UI gate. If the SQL trigger changes,
 * update the matching `GateId` block here in the same PR.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  checkEligibility,
  ELIGIBILITY_RULES,
  requiresAttestation,
  type JudgingTier,
  type LengthCategoryKey,
} from "./eligibility";

export type GateStatus = "pass" | "fail" | "warn" | "skip";

export type GateId =
  | "title"
  | "category"
  | "page_count"
  | "duplicate"
  | "attestation"
  | "wallet"
  | "imprint_ack"
  | "ai_disclosure";

export interface GateDiagnostic {
  id: GateId;
  label: string;
  status: GateStatus;
  /** One-line result summary shown next to the badge. */
  message: string;
  /** Actionable fix instruction shown when status is fail/warn. */
  fix?: string;
  /** Extra machine-readable payload for analytics / support tickets. */
  detail?: Record<string, unknown>;
}

export interface GateDryRunInput {
  userId: string | null;
  title: string;
  selectedCategory: LengthCategoryKey | string;
  competitionId: string | null;
  tier: JudgingTier | string;
  parentEntryId?: string | null;
  pageCount: number | null | undefined;
  walletBalance: number | null;
  entryCost: number | null;
  userEntryCount: number | null;
  acknowledgedImprint: boolean;
  aiDisclosureCaptured: boolean;
}

export interface GateDryRunResult {
  checks: GateDiagnostic[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
    ok: boolean;
  };
}

/**
 * Run every gate check against the current portal state. Async because the
 * duplicate-submission and attestation checks require database reads.
 *
 * Never throws — a query failure is downgraded to a `warn` so the user still
 * sees the rest of the diagnostics.
 */
export async function runSubmissionDryRun(
  input: GateDryRunInput,
): Promise<GateDryRunResult> {
  const checks: GateDiagnostic[] = [];

  // 1. Title present
  checks.push({
    id: "title",
    label: "Title",
    status: input.title.trim() ? "pass" : "fail",
    message: input.title.trim()
      ? `"${input.title.trim().slice(0, 60)}"`
      : "No title on the entry.",
    fix: input.title.trim()
      ? undefined
      : "Type a title in the Details step. It is stamped into the receipt hash and cannot be blank.",
  });

  // 2. Category + competition mapped
  const rule = ELIGIBILITY_RULES[input.selectedCategory as LengthCategoryKey];
  checks.push({
    id: "category",
    label: "Competition category",
    status: !input.selectedCategory
      ? "fail"
      : !input.competitionId
        ? "fail"
        : !rule
          ? "fail"
          : "pass",
    message: !input.selectedCategory
      ? "No length category selected."
      : !rule
        ? `Unknown category "${input.selectedCategory}".`
        : !input.competitionId
          ? `${rule.label} has no open competition mapped.`
          : `${rule.label} · ${rule.minPages}–${rule.maxPages} pages`,
    fix: !input.selectedCategory
      ? "Pick a length category matching your script."
      : !rule
        ? "Re-select the category from the category picker to reset the value."
        : !input.competitionId
          ? "There is no active competition for this category right now — check the Competitions page for the next window."
          : undefined,
    detail: rule
      ? { min: rule.minPages, max: rule.maxPages, aspect: rule.aspectHint }
      : undefined,
  });

  // 3. Page-count eligibility (mirrors trigger check #1)
  const eligibility = checkEligibility(input.selectedCategory, input.pageCount);
  checks.push({
    id: "page_count",
    label: "Page count in range",
    status: input.pageCount == null ? "fail" : eligibility.ok ? "pass" : "fail",
    message:
      input.pageCount == null
        ? "Page count missing from parse."
        : eligibility.ok
          ? `${input.pageCount} pages — within range.`
          : (eligibility.reason ?? "Out of range."),
    fix:
      input.pageCount == null
        ? "Re-upload the PDF or Fountain file so the parser can count pages."
        : eligibility.ok
          ? undefined
          : rule
            ? `Cut or expand the draft to ${rule.minPages}–${rule.maxPages} pages, or switch to the correct length category.`
            : "Adjust the draft length to match the selected category.",
    detail: { pageCount: input.pageCount, rule: rule ?? null },
  });

  // 4. Duplicate submission (mirrors trigger check #2)
  if (input.userId && input.competitionId) {
    try {
      const { data, error } = await supabase
        .from("entries")
        .select("id, status, parent_entry_id")
        .eq("user_id", input.userId)
        .eq("competition_id", input.competitionId)
        .not("status", "in", "(withdrawn,rejected)");
      if (error) throw error;
      const lineageAnchor = input.parentEntryId ?? null;
      const dup = (data ?? []).find((row: any) => {
        const rowAnchor = row.parent_entry_id ?? row.id;
        return lineageAnchor
          ? rowAnchor === lineageAnchor
          : (data ?? []).length > 0 && row.parent_entry_id == null;
      });
      const isDup = Boolean(dup) && (data ?? []).length > 0 && lineageAnchor != null;
      checks.push({
        id: "duplicate",
        label: "No duplicate submission",
        status: isDup ? "fail" : "pass",
        message: isDup
          ? "This draft lineage already has an active entry in this competition."
          : "No prior active entry from this draft lineage.",
        fix: isDup
          ? "Withdraw the existing entry from My Drafts, or fork the draft to a new lineage before resubmitting."
          : undefined,
        detail: { active_entries: (data ?? []).length },
      });
    } catch (e: any) {
      checks.push({
        id: "duplicate",
        label: "No duplicate submission",
        status: "warn",
        message: "Could not verify — the server will re-check on submit.",
        fix: "If the submit still fails with a duplicate error, withdraw the prior entry from My Drafts.",
        detail: { error: String(e?.message ?? e) },
      });
    }
  } else {
    checks.push({
      id: "duplicate",
      label: "No duplicate submission",
      status: "skip",
      message: "Sign in and pick a category to run this check.",
    });
  }

  // 5. Attestation (mirrors trigger check #3)
  const needsAttestation = requiresAttestation(input.tier);
  if (!needsAttestation) {
    checks.push({
      id: "attestation",
      label: "Author-rights attestation",
      status: "pass",
      message: "Not required for this tier.",
    });
  } else if (!input.userId) {
    checks.push({
      id: "attestation",
      label: "Author-rights attestation",
      status: "skip",
      message: "Sign in to check whether a recent attestation is on file.",
    });
  } else {
    try {
      const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("submission_attestations")
        .select("id, entry_id, is_sole_author, has_rights, acknowledged_terms, created_at")
        .eq("user_id", input.userId)
        .eq("is_sole_author", true)
        .eq("has_rights", true)
        .eq("acknowledged_terms", true)
        .or(`entry_id.is.null,entry_id.eq.${input.parentEntryId ?? "00000000-0000-0000-0000-000000000000"}`)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      const hasFresh = (data ?? []).length > 0;
      checks.push({
        id: "attestation",
        label: "Author-rights attestation",
        status: hasFresh ? "pass" : "fail",
        message: hasFresh
          ? "Fresh attestation on file (valid for 15 minutes)."
          : "No fresh attestation on file for this festival/finalist tier.",
        fix: hasFresh
          ? undefined
          : "Click Submit — the attestation dialog will open. Confirm sole authorship, rights, and terms to proceed.",
      });
    } catch (e: any) {
      checks.push({
        id: "attestation",
        label: "Author-rights attestation",
        status: "warn",
        message: "Could not verify attestation — the submit flow will prompt you.",
        fix: "Continue with submit; the attestation dialog is the definitive gate.",
        detail: { error: String(e?.message ?? e) },
      });
    }
  }

  // 6. Wallet balance
  if (input.entryCost == null) {
    checks.push({
      id: "wallet",
      label: "Wallet balance",
      status: "skip",
      message: "Category cost not resolved yet.",
    });
  } else if (input.walletBalance == null) {
    checks.push({
      id: "wallet",
      label: "Wallet balance",
      status: "warn",
      message: "Wallet not loaded — will be re-checked on submit.",
    });
  } else {
    const ok = input.walletBalance >= input.entryCost;
    checks.push({
      id: "wallet",
      label: "Wallet balance",
      status: ok ? "pass" : "fail",
      message: ok
        ? `${input.walletBalance} tokens available (needs ${input.entryCost}).`
        : `${input.walletBalance} tokens available, needs ${input.entryCost} — short ${input.entryCost - input.walletBalance}.`,
      fix: ok
        ? undefined
        : `Top up at least ${input.entryCost - input.walletBalance} more tokens from the Wallet page before submitting.`,
    });
  }

  // 7. Imprint acknowledgement (first-two-entries copy)
  if (input.userEntryCount != null && input.userEntryCount < 2) {
    checks.push({
      id: "imprint_ack",
      label: "Imprint acknowledgement",
      status: input.acknowledgedImprint ? "pass" : "fail",
      message: input.acknowledgedImprint
        ? "Acknowledged — your submission imprint is recorded."
        : "New writers must acknowledge the imprint notice on the first two entries.",
      fix: input.acknowledgedImprint
        ? undefined
        : "Tick the 'I understand' checkbox next to the imprint notice.",
    });
  } else {
    checks.push({
      id: "imprint_ack",
      label: "Imprint acknowledgement",
      status: "pass",
      message: "Already acknowledged on a prior submission.",
    });
  }

  // 8. AI disclosure captured (recommended, not blocking)
  checks.push({
    id: "ai_disclosure",
    label: "AI disclosure captured",
    status: input.aiDisclosureCaptured ? "pass" : "warn",
    message: input.aiDisclosureCaptured
      ? "AI-use declaration is on the entry."
      : "No AI-use declaration on the entry yet.",
    fix: input.aiDisclosureCaptured
      ? undefined
      : "Confirm your AI-use declaration on the Details step. It is embedded in the receipt hash and required for the public evidence page.",
  });

  const passed = checks.filter((c) => c.status === "pass").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  const warnings = checks.filter((c) => c.status === "warn").length;

  return {
    checks,
    summary: {
      total: checks.length,
      passed,
      failed,
      warnings,
      ok: failed === 0,
    },
  };
}
