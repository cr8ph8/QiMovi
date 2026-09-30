export type ParityRoleTier = "lead" | "key" | "supporting" | "consultant";

export const RESERVED_RIGHTS = [
  "theatrical",
  "svod",
  "avod",
  "tv",
  "foreign",
  "merch",
  "publishing",
  "podcast",
  "games_interactive",
  "live_events",
  "nfts_collectibles",
  "derivative_productions",
] as const;
export type ReservedRight = (typeof RESERVED_RIGHTS)[number];

export const RESERVED_RIGHT_LABELS: Record<ReservedRight, string> = {
  theatrical: "Theatrical",
  svod: "SVOD",
  avod: "AVOD",
  tv: "TV / Broadcast",
  foreign: "Foreign",
  merch: "Merchandise",
  publishing: "Publishing",
  podcast: "Podcast",
  games_interactive: "Games & Interactive",
  live_events: "Live Events",
  nfts_collectibles: "NFTs / Collectibles",
  derivative_productions: "Derivative Productions",
};

export interface ParityDeal {
  id: string;
  universe_id: string | null;
  entry_id: string | null;
  owner_id: string;
  is_enabled: boolean;

  parity_day_rate_usd: number;
  sag_tier_note: string | null;
  jurisdiction: string;

  investor_capital_usd: number;
  hurdle_multiple: number;
  distribution_fee_pct: number;
  foreign_sales_commission_pct: number;
  pa_cap_usd: number;
  overhead_cap_usd: number;
  cam_fee_pct: number;
  residuals_pct: number;
  deferred_payroll_usd: number;
  cross_collateralize: boolean;

  pool_investor_tail_pct: number;
  pool_creator_ip_pct: number;
  pool_contributor_pct: number;

  reserved_rights: ReservedRight[];
  notes: string | null;

  // Custom jurisdiction clauses — populated only when jurisdiction === "OTHER".
  // These override the canned JurisdictionProfile fields in the PDF and validator.
  custom_governing_law: string | null;
  custom_forum: string | null;
  custom_residuals_body: string | null;
  custom_withholding_note: string | null;
  custom_collection_account_note: string | null;
  custom_reserved_rights_caveat: string | null;

  created_at: string;
  updated_at: string;
}

export interface ParityParticipant {
  id: string;
  deal_id: string;
  collaborator_id: string | null;
  display_name_override: string | null;
  role_tier: ParityRoleTier;
  unit_weight: number;
}

export interface ParityScenario {
  id: string;
  deal_id: string;
  label: string;
  gross_receipts_usd: number;
  computed_waterfall: WaterfallResult;
  created_by: string | null;
  created_at: string;
}

export interface WaterfallLine {
  label: string;
  amount: number;
  isDeduction?: boolean;
  isTotal?: boolean;
  isPool?: boolean;
}

export interface WaterfallResult {
  grossReceipts: number;
  lines: WaterfallLine[];
  adjustedGross: number;
  investorSeniorPaid: number;
  deferredPaid: number;
  netProfitPool: number;
  investorTail: number;
  creatorIpPool: number;
  contributorPool: number;
}
