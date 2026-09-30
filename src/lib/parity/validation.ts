import type { ParityDeal } from "./types";
import { JURISDICTION_MAP, OTHER_REQUIRED_FIELDS, type Jurisdiction } from "./jurisdictions";

export interface ParityValidationIssue {
  message: string;
  field: string;        // DOM id or logical field name for jump-to
  severity: "error" | "warning";
  jurisdiction?: Jurisdiction;
}

export interface ParityValidationResult {
  valid: boolean;
  errors: ParityValidationIssue[];
  warnings: ParityValidationIssue[];
  rules: ParityRule[]; // the rule set that was actually applied (for UI display)
}

/**
 * Clause fields a jurisdiction profile must provide before the deal can be
 * considered exportable. Mirrors the sections rendered in the PDF.
 */
const REQUIRED_PROFILE_CLAUSES = [
  "governingLaw",
  "residualsBody",
  "withholdingNote",
  "collectionAccountNote",
  "reservedRightsCaveat",
] as const;

/**
 * A deal-level rule that may apply to any jurisdiction. `check` returns either
 * undefined (passes) or an issue (fails). All rules re-run on every edit, so
 * validation updates in real time as the user types.
 */
export interface ParityRule {
  id: string;
  label: string;
  field: string; // DOM id for jump-to
  severity: "error" | "warning";
  check: (deal: ParityDeal) => string | undefined;
}

// ---------- Reusable rule factories ----------

const requireNonEmpty = (field: keyof ParityDeal, domId: string, label: string, severity: "error" | "warning" = "error"): ParityRule => ({
  id: `nonempty:${String(field)}`,
  label,
  field: domId,
  severity,
  check: (deal) => {
    const v = (deal as any)[field];
    if (v == null || (typeof v === "string" && v.trim().length === 0)) {
      return `${label} is required.`;
    }
    return undefined;
  },
});

const requirePositive = (field: keyof ParityDeal, domId: string, label: string, severity: "error" | "warning" = "error"): ParityRule => ({
  id: `positive:${String(field)}`,
  label,
  field: domId,
  severity,
  check: (deal) => {
    const v = Number((deal as any)[field]);
    if (!Number.isFinite(v) || v <= 0) return `${label} must be greater than 0.`;
    return undefined;
  },
});

const requireReservedRight = (right: string, label: string, severity: "error" | "warning" = "warning"): ParityRule => ({
  id: `reservedright:${right}`,
  label,
  field: "reserved-rights",
  severity,
  check: (deal) => {
    if (!deal.reserved_rights?.includes(right as any)) {
      return `${label}`;
    }
    return undefined;
  },
});

// ---------- Per-jurisdiction rule sets ----------

const COMMON_RULES: ParityRule[] = [
  // Pool splits must sum to 100% – applies everywhere
  {
    id: "pool-sum",
    label: "Net Profit Pool splits must sum to 100%",
    field: "pool-splits",
    severity: "error",
    check: (deal) => {
      const sum = deal.pool_investor_tail_pct + deal.pool_creator_ip_pct + deal.pool_contributor_pct;
      if (Math.abs(sum - 100) > 0.01) {
        return `Net Profit Pool splits must sum to 100% (currently ${sum.toFixed(2)}%).`;
      }
      return undefined;
    },
  },
  // Warnings
  {
    id: "day-rate-positive",
    label: "Parity day rate should be > 0",
    field: "parity-day-rate",
    severity: "warning",
    check: (deal) => deal.parity_day_rate_usd <= 0
      ? "Parity day rate is 0 — every covered participant would be paid nothing."
      : undefined,
  },
  {
    id: "hurdle-ge-1",
    label: "Hurdle multiple ≥ 1.00x",
    field: "hurdle-multiple",
    severity: "warning",
    check: (deal) => deal.hurdle_multiple < 1
      ? "Hurdle multiple below 1.00x means investors recoup less than principal."
      : undefined,
  },
];

const JURISDICTION_RULES: Record<Jurisdiction, ParityRule[]> = {
  US: [
    requireNonEmpty("sag_tier_note", "parity-day-rate", "SAG tier note (SAG-AFTRA jurisdiction)"),
  ],
  UK: [
    requirePositive("residuals_pct", "hurdle-multiple", "Modeled residuals % (Equity / BECTU / WGGB use-fees)"),
  ],
  EU: [
    // DSM Art. 18 — unwaivable fair-remuneration claim must be modeled
    requirePositive("residuals_pct", "hurdle-multiple", "Modeled residuals % (DSM Art. 18 fair-remuneration)"),
    requirePositive("cam_fee_pct", "hurdle-multiple", "CAM fee % (CAMA required for EU cross-border receipts)"),
  ],
  CA: [
    requirePositive("residuals_pct", "hurdle-multiple", "Modeled residuals % (ACTRA / DGC / WGC use-fees)"),
    requireNonEmpty("sag_tier_note", "parity-day-rate", "Tier note (e.g. ACTRA Independent Production Agreement tier)", "warning"),
  ],
  AU: [
    requirePositive("residuals_pct", "hurdle-multiple", "Modeled residuals % (MEAA / ADG / AWG use-fees)"),
  ],
  IN: [
    // Authors' statutory royalty share under Copyright Act 1957 §§18-19 is unwaivable.
    requirePositive("residuals_pct", "hurdle-multiple", "Modeled residuals % (unwaivable §18-19 statutory royalty)"),
    requireNonEmpty("notes", "parity-notes", "Notes — FEMA / cross-border remittance treatment must be specified"),
    // Author of underlying literary work retains publishing rights – nudge user to reserve it.
    requireReservedRight("publishing", "Publishing should typically be reserved in India (author's statutory share applies to underlying literary work)."),
  ],
  ZA: [
    requirePositive("residuals_pct", "hurdle-multiple", "Modeled residuals % (SAGA / WGSA / DALRO / SAMRO)"),
  ],
  NZ: [
    requirePositive("residuals_pct", "hurdle-multiple", "Modeled residuals % (Equity NZ / NZWG use-fees)"),
  ],
  OTHER: OTHER_REQUIRED_FIELDS.map((f) =>
    requireNonEmpty(f.key as keyof ParityDeal, f.domId, `${f.label} (required for 'Other / Custom')`)
  ),
};

export function getRulesForJurisdiction(code: Jurisdiction | string | null | undefined): ParityRule[] {
  const j = (code as Jurisdiction) in JURISDICTION_RULES ? (code as Jurisdiction) : null;
  return [...COMMON_RULES, ...(j ? JURISDICTION_RULES[j] : [])];
}

export function validateParityDeal(deal: ParityDeal): ParityValidationResult {
  const errors: ParityValidationIssue[] = [];
  const warnings: ParityValidationIssue[] = [];

  // 1. Jurisdiction must be one of the supported codes
  const code = deal.jurisdiction as Jurisdiction | null | undefined;
  const profile = code ? JURISDICTION_MAP[code] : undefined;
  if (!code || !profile) {
    errors.push({
      message: `Unsupported jurisdiction "${code ?? "(none)"}". Pick one of: ${Object.keys(JURISDICTION_MAP).join(", ")}.`,
      field: "jurisdiction",
      severity: "error",
    });
  }

  // 2. Required clause fields on the jurisdiction profile must be non-empty
  if (profile) {
    for (const key of REQUIRED_PROFILE_CLAUSES) {
      const v = profile[key];
      if (!v || typeof v !== "string" || v.trim().length === 0) {
        errors.push({
          message: `Jurisdiction ${profile.label} is missing required clause: ${key}.`,
          field: "jurisdiction",
          severity: "error",
          jurisdiction: code ?? undefined,
        });
      }
    }
  }

  // 3. Apply common + jurisdiction-specific rules
  const rules = getRulesForJurisdiction(code);
  for (const rule of rules) {
    const message = rule.check(deal);
    if (message) {
      const issue: ParityValidationIssue = {
        message,
        field: rule.field,
        severity: rule.severity,
        jurisdiction: code ?? undefined,
      };
      (rule.severity === "error" ? errors : warnings).push(issue);
    }
  }

  return { valid: errors.length === 0, errors, warnings, rules };
}

export function isSupportedJurisdiction(code: unknown): code is Jurisdiction {
  return typeof code === "string" && code in JURISDICTION_MAP;
}
