// Submission eligibility — single source of truth for per-category page bounds
// and attestation requirements. Mirrors the SQL trigger
// `tg_enforce_submission_gates`; keep in sync with it.

export type LengthCategoryKey =
  | "vertical"
  | "micro"
  | "short"
  | "pilot_30"
  | "pilot_60"
  | "feature";

export type JudgingTier = "standard" | "festival" | "finalist";

export interface EligibilityRule {
  key: LengthCategoryKey;
  label: string;
  minPages: number;
  maxPages: number;
  /** Optional aspect-ratio hint for vertical-format submissions. */
  aspectHint?: "9:16" | "16:9" | "any";
}

export const ELIGIBILITY_RULES: Record<LengthCategoryKey, EligibilityRule> = {
  vertical: { key: "vertical", label: "Vertical",            minPages: 1,  maxPages: 5,    aspectHint: "9:16" },
  micro:    { key: "micro",    label: "Micro Short / Scene", minPages: 1,  maxPages: 5,    aspectHint: "16:9" },
  short:    { key: "short",    label: "Short Film",          minPages: 6,  maxPages: 19,   aspectHint: "any" },
  pilot_30: { key: "pilot_30", label: "30-Min Pilot",        minPages: 20, maxPages: 40,   aspectHint: "any" },
  pilot_60: { key: "pilot_60", label: "60-Min Pilot",        minPages: 45, maxPages: 70,   aspectHint: "any" },
  feature:  { key: "feature",  label: "Feature",             minPages: 71, maxPages: 1000, aspectHint: "any" },
};

export interface EligibilityResult {
  ok: boolean;
  reason?: string;
}

export function checkEligibility(
  category: LengthCategoryKey | string,
  pageCount: number | null | undefined,
): EligibilityResult {
  const rule = ELIGIBILITY_RULES[category as LengthCategoryKey];
  if (!rule) return { ok: false, reason: `Unknown category "${category}".` };
  if (pageCount == null) return { ok: false, reason: "Page count missing — re-upload the script." };
  if (pageCount < rule.minPages || pageCount > rule.maxPages) {
    return {
      ok: false,
      reason: `${rule.label} accepts ${rule.minPages}–${rule.maxPages} pages. Your script is ${pageCount} pages.`,
    };
  }
  return { ok: true };
}

/** Festival/finalist tier competitions require an explicit author-rights attestation. */
export function requiresAttestation(tier: JudgingTier | string | null | undefined): boolean {
  return tier === "festival" || tier === "finalist";
}
