import type { ParityDeal, ParityRoleTier } from "./types";

export const TIER_DEFAULT_UNITS: Record<ParityRoleTier, number> = {
  lead: 100,
  key: 60,
  supporting: 25,
  consultant: 10,
};

export const TIER_LABELS: Record<ParityRoleTier, string> = {
  lead: "Lead",
  key: "Key Dept / Transmedia Lead",
  supporting: "Supporting Creative",
  consultant: "Consultant / Advisor",
};

export const DEFAULT_DEAL: Partial<ParityDeal> = {
  is_enabled: true,
  parity_day_rate_usd: 1056, // SAG ultra-low budget scale, illustrative
  sag_tier_note: "SAG Ultra Low Budget scale (illustrative)",
  jurisdiction: "US",
  investor_capital_usd: 3_000_000,
  hurdle_multiple: 1.2,
  distribution_fee_pct: 15,
  foreign_sales_commission_pct: 12.5,
  pa_cap_usd: 850_000,
  overhead_cap_usd: 50_000,
  cam_fee_pct: 1,
  residuals_pct: 3,
  deferred_payroll_usd: 350_000,
  cross_collateralize: false,
  pool_investor_tail_pct: 35,
  pool_creator_ip_pct: 40,
  pool_contributor_pct: 25,
  reserved_rights: [
    "merch",
    "publishing",
    "podcast",
    "games_interactive",
    "live_events",
    "nfts_collectibles",
    "derivative_productions",
  ],
  custom_governing_law: null,
  custom_forum: null,
  custom_residuals_body: null,
  custom_withholding_note: null,
  custom_collection_account_note: null,
  custom_reserved_rights_caveat: null,
};

export const SCENARIO_PRESETS = [
  { label: "Conservative", grossReceipts: 1_350_000 },
  { label: "Moderate", grossReceipts: 6_200_000 },
  { label: "Breakout", grossReceipts: 14_500_000 },
] as const;
