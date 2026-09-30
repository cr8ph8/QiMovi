/**
 * Qi Authorship Shield — deterministic scoring engine
 *
 * No model calls. Maps existing stylometric signals + declared metadata
 * onto the ten Q2E quotients and seven composite scores.
 *
 * All scores are 0..100 unless otherwise noted.
 *
 * Disclaimer: scores are assistive indicators only. Not legal advice.
 * Not a binary AI-detection verdict.
 */

export type AIUsageType =
  | "none"
  | "brainstorm"
  | "outline"
  | "dialogue_polish"
  | "rewrite"
  | "full_gen"
  | "unknown";

export type RightsStatus =
  | "original"
  | "adaptation"
  | "public_domain"
  | "licensed_ip"
  | "work_for_hire"
  | "unknown";

export type IntendedMarket =
  | "feature"
  | "tv_pilot"
  | "short"
  | "web_series"
  | "game"
  | "novel_adaptation"
  | "franchise_continuation";

export type AIInfluenceTrace =
  | "human_led"
  | "ai_assisted"
  | "ai_heavy"
  | "unclear"
  | "high_risk_synthetic";

export type RiskBand = "low" | "moderate" | "high" | "critical";

export interface ShieldInputs {
  // From submission_stylometrics (if available)
  cliche_density?: number; // hits per 1k words
  mattr?: number;          // 0..1
  burstiness?: number;     // sentence length stdev
  multi_signal_risk?: number; // 0..1

  // Structural
  text_length: number;
  scene_count: number;
  character_count: number;
  dialogue_density?: number; // 0..1

  // Declared
  ai_used: boolean;
  ai_usage_type: AIUsageType;
  human_revision_level: number; // 0..100
  rights_status: RightsStatus;
  intended_market: IntendedMarket;
  declared_influences: string[];
  protected_voice_concern: boolean;
}

export interface ShieldScores {
  // Ten quotients
  syntax_quotient: number;
  rhythm_quotient: number;
  dialogue_quotient: number;
  scene_architecture_quotient: number;
  theme_quotient: number;
  character_pressure_quotient: number;
  emotional_temperature_quotient: number;
  genre_convention_quotient: number;
  cultural_texture_quotient: number;
  provenance_quotient: number;

  // Composite outputs
  originality_score: number;
  voice_distinctiveness_score: number;
  human_revision_score: number;
  ai_influence_trace: AIInfluenceTrace;
  provenance_score: number;
  protected_style_similarity: number;
  protected_style_cluster: string;
  market_substitution_risk: number;
  authorship_integrity_score: number;
  risk_band: RiskBand;

  signals: Record<string, unknown>;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Pick a neutral cluster label from declared influences / intended market.
 * Never names a living author unless the user explicitly declared them.
 */
function pickProtectedCluster(inputs: ShieldInputs): string {
  if (inputs.declared_influences.length > 0) {
    return "User-Declared Influence";
  }
  switch (inputs.intended_market) {
    case "franchise_continuation":
      return "Studio Franchise Voice";
    case "tv_pilot":
      return "Prestige TV Drama Pattern";
    case "feature":
      return "Studio Action Tentpole Pattern";
    case "short":
    case "web_series":
      return "Indie Quirk Pattern";
    case "novel_adaptation":
      return "High Prestige Literary Voice";
    case "game":
      return "Streaming Limited-Series Pattern";
    default:
      return "Indie Quirk Pattern";
  }
}

function deriveAIInfluence(
  ai_used: boolean,
  type: AIUsageType,
  revision: number,
  risk: number,
): AIInfluenceTrace {
  if (!ai_used) return revision >= 60 ? "human_led" : "unclear";
  if (type === "full_gen" && revision < 30) return "high_risk_synthetic";
  if (type === "full_gen") return "ai_heavy";
  if (type === "rewrite" && revision < 40) return "ai_heavy";
  if (type === "unknown" && risk > 0.6) return "ai_heavy";
  if (type === "unknown") return "unclear";
  return "ai_assisted";
}

function bandFromRisk(risk: number): RiskBand {
  if (risk < 25) return "low";
  if (risk < 50) return "moderate";
  if (risk < 75) return "high";
  return "critical";
}

export function computeShieldScores(inputs: ShieldInputs): ShieldScores {
  const cliche = inputs.cliche_density ?? 12;       // ~12/1k typical
  const mattr = inputs.mattr ?? 0.62;
  const burst = inputs.burstiness ?? 6;
  const multiRisk = inputs.multi_signal_risk ?? 0.35;
  const wordCount = Math.max(1, inputs.text_length / 5); // rough word estimate
  const dialogueDensity = inputs.dialogue_density ?? 0.45;

  // === Ten quotients (0..100) ===
  const syntax_quotient = clamp(50 + (mattr - 0.55) * 200);
  const rhythm_quotient = clamp(40 + burst * 4);
  const dialogue_quotient = clamp(35 + dialogueDensity * 80);
  const scene_architecture_quotient = clamp(
    40 + Math.min(40, inputs.scene_count * 1.2),
  );
  const theme_quotient = clamp(55 + (mattr - 0.55) * 120 - cliche * 0.6);
  const character_pressure_quotient = clamp(
    45 + Math.min(35, inputs.character_count * 3),
  );
  const emotional_temperature_quotient = clamp(50 + burst * 2 - cliche * 0.4);
  const genre_convention_quotient = clamp(60 - cliche * 0.5);
  const cultural_texture_quotient = clamp(
    50 + (inputs.declared_influences.length > 0 ? 10 : 0) + (mattr - 0.55) * 100,
  );

  // Provenance quotient — driven by declared metadata
  const metadataCompleteness =
    (inputs.ai_used !== undefined ? 1 : 0) +
    (inputs.ai_usage_type !== "unknown" ? 1 : 0) +
    (inputs.rights_status !== "unknown" ? 1 : 0) +
    (inputs.human_revision_level > 0 ? 1 : 0) +
    (inputs.declared_influences.length > 0 ? 1 : 0);
  const provenance_quotient = clamp(40 + metadataCompleteness * 12);

  // === Composite outputs ===
  const originality_score = clamp(
    (syntax_quotient + theme_quotient + cultural_texture_quotient) / 3
      - cliche * 0.8,
  );

  const voice_distinctiveness_score = clamp(
    (rhythm_quotient + dialogue_quotient + emotional_temperature_quotient) / 3,
  );

  const human_revision_score = clamp(inputs.human_revision_level);

  const ai_influence_trace = deriveAIInfluence(
    inputs.ai_used,
    inputs.ai_usage_type,
    inputs.human_revision_level,
    multiRisk,
  );

  const provenance_score = provenance_quotient;

  // Protected style similarity — driven by multi-signal risk + concern flag
  const baseSim = multiRisk * 70;
  const concernBump = inputs.protected_voice_concern ? 15 : 0;
  const marketBump =
    inputs.intended_market === "franchise_continuation" ? 12 : 0;
  const protected_style_similarity = clamp(baseSim + concernBump + marketBump);
  const protected_style_cluster = pickProtectedCluster(inputs);

  // Market substitution risk (Hampton Risk_A formula, demo-grade)
  // Risk = Sim × (1 - P_L) × P_R × C_D
  const sim = protected_style_similarity / 100;
  const permissionMissing =
    inputs.rights_status === "unknown" ||
    inputs.rights_status === "adaptation"
      ? 1
      : inputs.rights_status === "original" || inputs.rights_status === "public_domain"
        ? 0.1
        : 0.4;
  const readerPreference = 0.55 + (multiRisk - 0.35) * 0.4; // demo proxy
  const costDelta = 0.85; // research: fine-tune cost ~99.7% lower; modeled high
  const market_substitution_risk = clamp(
    sim * permissionMissing * readerPreference * costDelta * 100,
  );

  // Authorship integrity (0..100) — weighted blend, penalized by risk
  const positiveBlend =
    originality_score * 0.25 +
    voice_distinctiveness_score * 0.2 +
    human_revision_score * 0.25 +
    provenance_score * 0.3;
  const riskPenalty =
    protected_style_similarity * 0.2 + market_substitution_risk * 0.25;
  const authorship_integrity_score = clamp(positiveBlend - riskPenalty * 0.4);

  const overallRiskForBand =
    market_substitution_risk * 0.6 + protected_style_similarity * 0.4;
  const risk_band = bandFromRisk(overallRiskForBand);

  return {
    syntax_quotient: round(syntax_quotient),
    rhythm_quotient: round(rhythm_quotient),
    dialogue_quotient: round(dialogue_quotient),
    scene_architecture_quotient: round(scene_architecture_quotient),
    theme_quotient: round(theme_quotient),
    character_pressure_quotient: round(character_pressure_quotient),
    emotional_temperature_quotient: round(emotional_temperature_quotient),
    genre_convention_quotient: round(genre_convention_quotient),
    cultural_texture_quotient: round(cultural_texture_quotient),
    provenance_quotient: round(provenance_quotient),
    originality_score: round(originality_score),
    voice_distinctiveness_score: round(voice_distinctiveness_score),
    human_revision_score: round(human_revision_score),
    ai_influence_trace,
    provenance_score: round(provenance_score),
    protected_style_similarity: round(protected_style_similarity),
    protected_style_cluster,
    market_substitution_risk: round(market_substitution_risk),
    authorship_integrity_score: round(authorship_integrity_score),
    risk_band,
    signals: {
      word_count_estimate: Math.round(wordCount),
      cliche_density: round(cliche),
      mattr: round(mattr * 100) / 100,
      burstiness: round(burst),
      multi_signal_risk: round(multiRisk),
      reader_preference_proxy: round(readerPreference),
      permission_missing_factor: round(permissionMissing),
    },
  };
}

export const RISK_RECOMMENDATIONS: Record<RiskBand, string> = {
  low: "This project shows strong authorship integrity, clear provenance, and meaningful human revision. No major protected-style similarity concerns were detected in this analysis.",
  moderate:
    "This project shows signs of AI assistance or recognizable influence patterns. Human revision and provenance are present, but additional draft documentation is recommended.",
  high: "This project may be too close to a protected or declared voice profile, especially given limited provenance or low human revision. Review, disclosure, licensing verification, or substantial revision is recommended.",
  critical:
    "This project presents elevated authorship-risk signals: high voice similarity, unclear permission, limited human revision, and potential market-substitution concern. Do not treat this as a legal finding, but rights review is strongly recommended.",
};

export function certificateStatusFor(scores: ShieldScores): {
  status:
    | "qi_certified_original"
    | "qi_certified_ai_assisted"
    | "review_recommended"
    | "high_risk"
    | "incomplete";
  label: string;
} {
  if (scores.provenance_score < 50)
    return { status: "incomplete", label: "Incomplete: More Metadata Needed" };
  if (scores.risk_band === "critical" || scores.risk_band === "high")
    return { status: "high_risk", label: "High Risk: Provenance or Protected Voice Concern" };
  if (scores.risk_band === "moderate")
    return { status: "review_recommended", label: "Review Recommended: Style Similarity Risk" };
  if (scores.ai_influence_trace === "ai_assisted")
    return { status: "qi_certified_ai_assisted", label: "Qi Certified: AI-Assisted with Clear Provenance" };
  return { status: "qi_certified_original", label: "Qi Certified: Original / Human-Led" };
}
