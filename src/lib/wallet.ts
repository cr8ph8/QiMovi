/**
 * Base token costs for all platform actions.
 *
 * Token value: $0.10 per token (rebased ÷10 from original $0.01).
 * Model tier surcharges apply proportionally to API cost differentials.
 *
 * Entry fee formula: BASE_SCORING_COST (15) + length-scaled platform margin.
 */
export const BASE_SCORING_COST = 15; // included in every entry fee

export const TOKEN_COSTS = {
  ai_score: 15,
  ai_review: 15,
  beat_board: 15,
  writing_stats: 10,
  send_review: 10,
  script_compare_2: 20,
  script_compare_3: 30,
  scene_analysis: 5,
  deep_voice: 5,
  dialogue_generation: 1,
  zeitgeist: 3,
  deep_analysis: 20,
  ai_rewrite: 1,           // legacy fallback — use rewrite tier costs below
  ai_suggest_rewrites: 1,
  // ── Rewrite tier costs ─────────────────────────────────
  rewrite_micro: 1,
  rewrite_standard: 3,
  rewrite_extended: 5,
  rewrite_structural: 12,
  rewrite_full: 25,
  ai_script_generate: 25,
  resubmit: 25,
  competition_waiver: 0,
  logline_generate: 5,
  title_suggest: 5,
  // ── Entry fees (include base-tier scoring + platform margin) ──
  entry_vertical: 20,    // 15 scoring + 5 margin
  entry_micro: 20,        // 15 scoring + 5 margin
  entry_short: 35,        // 15 scoring + 20 margin
  entry_pilot_30: 50,     // 15 scoring + 35 margin
  entry_pilot_60: 65,     // 15 scoring + 50 margin
  entry_feature: 100,     // 15 scoring + 85 margin
  ip_risk_assessment: 5,
} as const;

export type TokenAction = keyof typeof TOKEN_COSTS;

export const TOKEN_ACTION_LABELS: Record<TokenAction, string> = {
  ai_score: "AI Score",
  ai_review: "AI Review",
  beat_board: "Beat Board",
  writing_stats: "Writing Stats",
  send_review: "Send Review",
  script_compare_2: "Script Compare (2)",
  script_compare_3: "Script Compare (3)",
  scene_analysis: "Scene Analysis",
  deep_voice: "Deep Voice",
  dialogue_generation: "Dialogue Generation",
  zeitgeist: "Zeitgeist",
  deep_analysis: "Deep Analysis",
  ai_rewrite: "AI Rewrite",
  ai_suggest_rewrites: "Rewrite Suggestions",
  ai_script_generate: "AI Script Generate",
  resubmit: "Resubmit Draft",
  competition_waiver: "Competition Waiver",
  logline_generate: "Generate Logline",
  title_suggest: "Title Suggestions",
  entry_vertical: "Vertical Entry",
  entry_micro: "Micro Short / Scene Entry",
  entry_short: "Short Film Entry",
  entry_pilot_30: "30-Min Pilot Entry",
  entry_pilot_60: "60-Min Pilot Entry",
  entry_feature: "Feature Entry",
  ip_risk_assessment: "IP Risk Assessment",
  rewrite_micro: "Micro Rewrite",
  rewrite_standard: "Standard Rewrite",
  rewrite_extended: "Extended Rewrite",
  rewrite_structural: "Structural Rewrite",
  rewrite_full: "Full Transformation",
};

export type FeatureCategory = "main" | "sub" | "admin" | "entry_cost" | "dead" | "unwired";
export type FeatureStatus = "active" | "dead_code" | "unwired" | "gate_only";

export interface TokenActionMeta {
  label: string;
  category: FeatureCategory;
  edgeFunction: string | null;
  usesAI: boolean;
  status: FeatureStatus;
  description: string;
}

export const TOKEN_ACTION_METADATA: Record<string, TokenActionMeta> = {
  // ── Main Features ──────────────────────────────────────
  ai_script_generate: {
    label: "AI Script Generate",
    category: "main",
    edgeFunction: "generate-script",
    usesAI: true,
    status: "active",
    description: "Full screenplay generation from logline/prompt",
  },
  ai_score: {
    label: "AI Judge (IPQ Scoring)",
    category: "main",
    edgeFunction: "ai-judge",
    usesAI: true,
    status: "active",
    description: "8-dimension screenplay evaluation via configurable AI models",
  },
  logline_generate: {
    label: "Logline Generator",
    category: "main",
    edgeFunction: "generate-script",
    usesAI: true,
    status: "active",
    description: "AI-powered logline generation from prompts",
  },
  title_suggest: {
    label: "Title Suggestions",
    category: "main",
    edgeFunction: "generate-script",
    usesAI: true,
    status: "active",
    description: "AI-generated title alternatives for screenplays",
  },
  script_compare_2: {
    label: "Model Compare (2)",
    category: "main",
    edgeFunction: "ai-compare",
    usesAI: true,
    status: "active",
    description: "Side-by-side comparison across 2 AI models",
  },
  script_compare_3: {
    label: "Model Compare (3)",
    category: "main",
    edgeFunction: "ai-compare",
    usesAI: true,
    status: "active",
    description: "Side-by-side comparison across 3 AI models",
  },
  // ── Sub-Features ───────────────────────────────────────
  ai_rewrite: {
    label: "AI Rewrite Selection",
    category: "sub",
    edgeFunction: "rewrite-selection",
    usesAI: true,
    status: "active",
    description: "Inline AI rewrite of selected text",
  },
  ai_suggest_rewrites: {
    label: "Rewrite Suggestions",
    category: "sub",
    edgeFunction: "suggest-rewrites",
    usesAI: true,
    status: "active",
    description: "AI-generated rewrite suggestions for script elements",
  },
  deep_analysis: {
    label: "Deep Analysis",
    category: "sub",
    edgeFunction: "ai-judge",
    usesAI: true,
    status: "active",
    description: "Extended AI analysis with higher token budget",
  },
  ai_review: {
    label: "AI Review",
    category: "sub",
    edgeFunction: null,
    usesAI: false,
    status: "gate_only",
    description: "Gating flag only — no dedicated edge function",
  },
  send_review: {
    label: "Send Review",
    category: "sub",
    edgeFunction: null,
    usesAI: false,
    status: "unwired",
    description: "Review sharing (no backend wired)",
  },
  // ── Admin-Only AI ──────────────────────────────────────
  auto_audit: {
    label: "Auto Audit",
    category: "admin",
    edgeFunction: "auto-audit",
    usesAI: true,
    status: "active",
    description: "Automated system audit via AI",
  },
  model_health_check: {
    label: "Model Health Check",
    category: "admin",
    edgeFunction: "model-health-check",
    usesAI: true,
    status: "active",
    description: "Tests latency and availability across AI providers",
  },
  legal_summary: {
    label: "Legal Summary",
    category: "admin",
    edgeFunction: "legal-summary",
    usesAI: true,
    status: "active",
    description: "AI-generated legal document summaries",
  },
  filmstack_seed: {
    label: "FilmStack Intelligence",
    category: "sub",
    edgeFunction: "seed-filmstack",
    usesAI: true,
    status: "active",
    description: "Auto-generates Logline, Synopsis, Film PRD, Character Bible, World Bible, and Beat Sheet",
  },
  evidence_artifact: {
    label: "Evidence Artifacts",
    category: "admin",
    edgeFunction: "generate-artifact",
    usesAI: true,
    status: "active",
    description: "Generates provenance evidence bundles",
  },
  ip_risk_assessment: {
    label: "IP Risk Assessment",
    category: "sub",
    edgeFunction: null,
    usesAI: false,
    status: "active",
    description: "Self-service IP risk evaluation for authorship workflows",
  },
  // ── Dead Code ──────────────────────────────────────────
  deep_voice: {
    label: "Deep Voice",
    category: "dead",
    edgeFunction: "voice-drift",
    usesAI: true,
    status: "dead_code",
    description: "Voice drift analysis — edge function exists, no UI invocation",
  },
  seed_governance: {
    label: "Seed Governance Demo",
    category: "dead",
    edgeFunction: "seed-governance-demo",
    usesAI: false,
    status: "dead_code",
    description: "Demo data seeder — no production use",
  },
  seed_demo_profiles: {
    label: "Seed Demo Profiles",
    category: "dead",
    edgeFunction: "seed-demo-profiles",
    usesAI: false,
    status: "dead_code",
    description: "Demo profile seeder — no production use",
  },
  // ── Unwired Feature Flags ──────────────────────────────
  beat_board: {
    label: "Beat Board",
    category: "unwired",
    edgeFunction: null,
    usesAI: false,
    status: "unwired",
    description: "Feature flag exists, no backend implementation",
  },
  writing_stats: {
    label: "Writing Stats",
    category: "unwired",
    edgeFunction: null,
    usesAI: false,
    status: "unwired",
    description: "Feature flag exists, no backend implementation",
  },
  scene_analysis: {
    label: "Scene Analysis",
    category: "unwired",
    edgeFunction: null,
    usesAI: false,
    status: "unwired",
    description: "Feature flag exists, no backend implementation",
  },
  dialogue_generation: {
    label: "Dialogue Generation",
    category: "unwired",
    edgeFunction: null,
    usesAI: false,
    status: "unwired",
    description: "Feature flag exists, no backend implementation",
  },
  zeitgeist: {
    label: "Zeitgeist",
    category: "unwired",
    edgeFunction: null,
    usesAI: false,
    status: "unwired",
    description: "Feature flag exists, no backend implementation",
  },
  // ── Entry Costs ────────────────────────────────────────
  entry_vertical: {
    label: "Vertical Entry",
    category: "entry_cost",
    edgeFunction: null,
    usesAI: false,
    status: "active",
    description: "Token cost for vertical (1–5 page) submissions",
  },
  entry_micro: {
    label: "Micro Short / Scene Entry",
    category: "entry_cost",
    edgeFunction: null,
    usesAI: false,
    status: "active",
    description: "Token cost for micro short submissions",
  },
  entry_short: {
    label: "Short Film Entry",
    category: "entry_cost",
    edgeFunction: null,
    usesAI: false,
    status: "active",
    description: "Token cost for short film (6–19 page) submissions",
  },
  entry_pilot_30: {
    label: "30-Min Pilot Entry",
    category: "entry_cost",
    edgeFunction: null,
    usesAI: false,
    status: "active",
    description: "Token cost for 30-minute pilot submissions",
  },
  entry_pilot_60: {
    label: "60-Min Pilot Entry",
    category: "entry_cost",
    edgeFunction: null,
    usesAI: false,
    status: "active",
    description: "Token cost for 60-minute pilot submissions",
  },
  entry_feature: {
    label: "Feature Entry",
    category: "entry_cost",
    edgeFunction: null,
    usesAI: false,
    status: "active",
    description: "Token cost for feature-length submissions",
  },
  resubmit: {
    label: "Resubmit Draft",
    category: "entry_cost",
    edgeFunction: null,
    usesAI: false,
    status: "active",
    description: "Token cost for resubmitting a revised draft",
  },
  competition_waiver: {
    label: "Competition Waiver",
    category: "entry_cost",
    edgeFunction: null,
    usesAI: false,
    status: "active",
    description: "Fee waiver for competitions (0 cost)",
  },
  grade_compare_2: {
    label: "Grade Compare (2 Models)",
    category: "main",
    edgeFunction: "ai-judge",
    usesAI: true,
    status: "active",
    description: "Side-by-side grading with 2 AI models (Pro only, cost = 2× grade cost)",
  },
  grade_compare_3: {
    label: "Grade Compare (3 Models)",
    category: "main",
    edgeFunction: "ai-judge",
    usesAI: true,
    status: "active",
    description: "Side-by-side grading with 3 AI models (Pro only, cost = 3× grade cost)",
  },
  // ── Rewrite Tiers ──────────────────────────────────────
  rewrite_micro: {
    label: "Micro Rewrite",
    category: "sub",
    edgeFunction: "rewrite-selection",
    usesAI: true,
    status: "active",
    description: "Small localized edits — line, sentence, grammar, tone (1⊘)",
  },
  rewrite_standard: {
    label: "Standard Rewrite",
    category: "sub",
    edgeFunction: "rewrite-selection",
    usesAI: true,
    status: "active",
    description: "Moderate-context rewrites — dialogue blocks, pacing, subtext (3⊘)",
  },
  rewrite_extended: {
    label: "Extended Rewrite",
    category: "sub",
    edgeFunction: "rewrite-selection",
    usesAI: true,
    status: "active",
    description: "Multi-beat transformations — scenes, story beats, sequences (5⊘)",
  },
  rewrite_structural: {
    label: "Structural Rewrite",
    category: "sub",
    edgeFunction: "rewrite-selection",
    usesAI: true,
    status: "active",
    description: "Large-context rewrites — genre, budget, rating adaptations (12⊘)",
  },
  rewrite_full: {
    label: "Full Transformation",
    category: "sub",
    edgeFunction: "rewrite-selection",
    usesAI: true,
    status: "active",
    description: "Highest-scope rewrites — acts, plot paths, multi-scene sequences (25⊘)",
  },
};

export const TOKEN_VALUE_USD = 0.10;                     // $0.10 per token (rebased ÷10)
export const LOVABLE_CREDIT_DEFAULT_COST = 0.30;       // on-demand rate
export const LOVABLE_CREDIT_PREPAID_COST = 0.24;       // 20% discount (pre-purchased)
export const LOVABLE_PREPAID_DISCOUNT = 0.20;           // 20%

/** Weighted average price per platform token based on bundle pricing */
export function getAvgTokenPrice(): number {
  const totalTokens = TOKEN_BUNDLES.reduce((s, b) => s + b.tokens, 0);
  const totalCents = TOKEN_BUNDLES.reduce((s, b) => s + b.priceCents, 0);
  return totalCents / totalTokens / 100; // dollars per token
}

export const TOKEN_BUNDLES = [
  { id: "starter", name: "Starter", tokens: 100,  priceCents: 1000,  label: "$10" },
  { id: "creator", name: "Creator", tokens: 300,  priceCents: 3000,  label: "$30" },
  { id: "pro",     name: "Pro",     tokens: 500,  priceCents: 5000,  label: "$50" },
  { id: "studio",  name: "Studio",  tokens: 1000, priceCents: 10000, label: "$100" },
] as const;

export const LENGTH_CATEGORIES = [
  { key: "vertical", label: "Vertical", pages: "1–5", cost: 20 },
  { key: "micro", label: "Micro Short / Scene", pages: "1–5", cost: 20 },
  { key: "short", label: "Short Film", pages: "6–19", cost: 35 },
  { key: "pilot_30", label: "30-Min Pilot", pages: "20–40", cost: 50 },
  { key: "pilot_60", label: "60-Min Pilot", pages: "45–70", cost: 65 },
  { key: "feature", label: "Feature", pages: "71+", cost: 100 },
] as const;

/**
 * Calculate the total entry cost including model tier surcharge.
 * Surcharges are proportional to actual API cost differentials.
 */
export function getEntryTierTotal(
  baseFee: number,
  tierMultiplier: number = 1.0,
  tierFlat: number = 0,
): number {
  return Math.ceil(baseFee * tierMultiplier) + tierFlat;
}

/** Auto-determine category from page count. For 1-5 pages defaults to "vertical". */
export function getLengthCategory(pageCount: number) {
  if (pageCount <= 5) return LENGTH_CATEGORIES[0]; // vertical (user can override to micro)
  if (pageCount <= 19) return LENGTH_CATEGORIES[2]; // short
  if (pageCount <= 44) return LENGTH_CATEGORIES[3]; // pilot_30
  if (pageCount <= 70) return LENGTH_CATEGORIES[4]; // pilot_60
  return LENGTH_CATEGORIES[5]; // feature
}

export function getLengthCategoryByKey(key: string) {
  return LENGTH_CATEGORIES.find((c) => c.key === key) || LENGTH_CATEGORIES[5];
}

/** Labels for model tier surcharges displayed in UI */
export const MODEL_TIER_LABELS: Record<string, string> = {
  budget: "Budget",
  fast: "Fast",
  standard: "Standard",
  premium: "Premium",
  super_premium: "Super Premium",
};

/** Centralized model cost registry — cost per 1K tokens (mirrors ai-router.ts) */
export const MODEL_COSTS: Record<string, { input: number; output: number; label: string; tier: string }> = {
  "google/gemini-3-flash-preview":  { input: 0.01,  output: 0.04,  label: "Gemini 3 Flash",        tier: "fast" },
  "google/gemini-2.5-flash-lite":   { input: 0.008, output: 0.03,  label: "Gemini 2.5 Flash Lite", tier: "budget" },
  "google/gemini-2.5-flash":        { input: 0.015, output: 0.06,  label: "Gemini 2.5 Flash",      tier: "standard" },
  "google/gemini-2.5-pro":          { input: 0.125, output: 0.5,   label: "Gemini 2.5 Pro",        tier: "premium" },
  "google/gemini-3.1-pro-preview":  { input: 0.125, output: 0.5,   label: "Gemini 3.1 Pro",        tier: "premium" },
  "openai/gpt-5-nano":              { input: 0.03,  output: 0.1,   label: "GPT-5 Nano",            tier: "standard" },
  "openai/gpt-5-mini":              { input: 0.1,   output: 0.3,   label: "GPT-5 Mini",            tier: "premium" },
  "openai/gpt-5":                   { input: 0.5,   output: 1.5,   label: "GPT-5",                 tier: "super_premium" },
  "openai/gpt-5.2":                 { input: 0.6,   output: 1.8,   label: "GPT-5.2",               tier: "super_premium" },
};

/**
 * Cost-proportional surcharges based on API cost differentials.
 * Standard tier (Gemini 2.5 Flash) is the 1.0× baseline.
 * Premium/Super Premium multipliers are compressed from actual ratios
 * (8× and 26× respectively) to keep fees proportionally fair.
 */
export const DEFAULT_SURCHARGES: Record<string, { multiplier: number; flat: number }> = {
  budget:        { multiplier: 1.0, flat: 0 },
  fast:          { multiplier: 1.0, flat: 0 },
  standard:      { multiplier: 1.0, flat: 0 },
  premium:       { multiplier: 3.0, flat: 0 },
  super_premium: { multiplier: 5.0, flat: 0 },
};

export function getEntryTokenAction(category: string): TokenAction {
  switch (category) {
    case "vertical": return "entry_vertical";
    case "micro": return "entry_micro";
    case "short": return "entry_short";
    case "pilot_30": return "entry_pilot_30";
    case "pilot_60": return "entry_pilot_60";
    case "feature": return "entry_feature";
    default: return "entry_feature";
  }
}
