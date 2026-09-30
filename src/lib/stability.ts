/**
 * Stability metrics module — computes scoring reliability, narrative drift,
 * and evaluation consistency from canonical QiCanIScreenwrite data.
 *
 * All computations are deterministic, heuristic-based, and extensible.
 */

export interface StabilityResult {
  metric_name: string;
  metric_value: number; // 0–100 normalised
  metric_label: "stable" | "moderate drift" | "unstable" | "high variance" | "low confidence";
  confidence: number; // 0–1
  source_context: string;
  computed_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

function coefficientOfVariation(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  return stddev(values) / mean;
}

function labelFromScore(score: number): StabilityResult["metric_label"] {
  if (score >= 85) return "stable";
  if (score >= 60) return "moderate drift";
  if (score >= 40) return "unstable";
  return "high variance";
}

function confidenceFromSampleSize(n: number, ideal = 5): number {
  return Math.min(n / ideal, 1);
}

const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Metric: Scoring Drift
// Measures how much total_score varies across grading_reports for one entry.
// ---------------------------------------------------------------------------

export interface GradingReportInput {
  total_score: number;
  model_id: string;
  created_at: string;
}

export function computeScoringDrift(reports: GradingReportInput[]): StabilityResult {
  if (reports.length < 2) {
    return {
      metric_name: "scoring_drift",
      metric_value: 100,
      metric_label: "stable",
      confidence: 0,
      source_context: "grading_reports",
      computed_at: now(),
    };
  }
  const scores = reports.map((r) => r.total_score);
  const cv = coefficientOfVariation(scores);
  // cv of 0 = perfect consistency → 100; cv ≥ 0.5 → 0
  const value = Math.round(Math.max(0, Math.min(100, (1 - cv / 0.5) * 100)));
  return {
    metric_name: "scoring_drift",
    metric_value: value,
    metric_label: labelFromScore(value),
    confidence: confidenceFromSampleSize(reports.length),
    source_context: "grading_reports",
    computed_at: now(),
  };
}

// ---------------------------------------------------------------------------
// Metric: Evaluation Consistency
// Checks how consistent per-dimension scores are across multiple runs/reports.
// ---------------------------------------------------------------------------

export interface DimensionScoresInput {
  originality: number;
  structure: number;
  character_depth: number;
  dialogue: number;
  theme: number;
  emotion: number;
  format_adherence: number;
}

export function computeEvalConsistency(reports: (DimensionScoresInput & GradingReportInput)[]): StabilityResult {
  if (reports.length < 2) {
    return {
      metric_name: "evaluation_consistency",
      metric_value: 100,
      metric_label: "stable",
      confidence: 0,
      source_context: "grading_reports",
      computed_at: now(),
    };
  }

  const dims: (keyof DimensionScoresInput)[] = [
    "originality", "structure", "character_depth",
    "dialogue", "theme", "emotion", "format_adherence",
  ];

  const cvPerDim = dims.map((d) => {
    const vals = reports.map((r) => r[d]);
    return coefficientOfVariation(vals);
  });

  const avgCv = cvPerDim.reduce((a, b) => a + b, 0) / cvPerDim.length;
  const value = Math.round(Math.max(0, Math.min(100, (1 - avgCv / 0.4) * 100)));

  return {
    metric_name: "evaluation_consistency",
    metric_value: value,
    metric_label: labelFromScore(value),
    confidence: confidenceFromSampleSize(reports.length),
    source_context: "grading_reports",
    computed_at: now(),
  };
}

// ---------------------------------------------------------------------------
// Metric: Narrative Stability
// Uses script_quotients variance if multiple evaluation runs exist.
// ---------------------------------------------------------------------------

export interface QuotientRunInput {
  character_q?: number | null;
  dialogue_q?: number | null;
  structure_q?: number | null;
  theme_q?: number | null;
  creativity_q?: number | null;
  audience_q?: number | null;
  market_q?: number | null;
}

export function computeNarrativeStability(runs: QuotientRunInput[]): StabilityResult {
  if (runs.length < 2) {
    return {
      metric_name: "narrative_stability",
      metric_value: 100,
      metric_label: "stable",
      confidence: 0,
      source_context: "evaluation_runs",
      computed_at: now(),
    };
  }

  const keys: (keyof QuotientRunInput)[] = [
    "character_q", "dialogue_q", "structure_q",
    "theme_q", "creativity_q", "audience_q", "market_q",
  ];

  const cvs: number[] = [];
  for (const k of keys) {
    const vals = runs.map((r) => r[k]).filter((v): v is number => v != null && v > 0);
    if (vals.length >= 2) cvs.push(coefficientOfVariation(vals));
  }

  if (cvs.length === 0) {
    return {
      metric_name: "narrative_stability",
      metric_value: 100,
      metric_label: "stable",
      confidence: 0,
      source_context: "evaluation_runs",
      computed_at: now(),
    };
  }

  const avgCv = cvs.reduce((a, b) => a + b, 0) / cvs.length;
  const value = Math.round(Math.max(0, Math.min(100, (1 - avgCv / 0.4) * 100)));

  return {
    metric_name: "narrative_stability",
    metric_value: value,
    metric_label: labelFromScore(value),
    confidence: confidenceFromSampleSize(runs.length),
    source_context: "evaluation_runs",
    computed_at: now(),
  };
}

// ---------------------------------------------------------------------------
// Metric: Confidence Volatility
// Measures how much the confidence_score varies across evaluation runs.
// ---------------------------------------------------------------------------

export function computeConfidenceVolatility(runs: { confidence_score?: number | null }[]): StabilityResult {
  const vals = runs.map((r) => r.confidence_score).filter((v): v is number => v != null);
  if (vals.length < 2) {
    return {
      metric_name: "confidence_volatility",
      metric_value: 100,
      metric_label: "stable",
      confidence: 0,
      source_context: "script_quotients",
      computed_at: now(),
    };
  }
  const cv = coefficientOfVariation(vals);
  const value = Math.round(Math.max(0, Math.min(100, (1 - cv / 0.3) * 100)));
  return {
    metric_name: "confidence_volatility",
    metric_value: value,
    metric_label: labelFromScore(value),
    confidence: confidenceFromSampleSize(vals.length),
    source_context: "script_quotients",
    computed_at: now(),
  };
}

// ---------------------------------------------------------------------------
// Aggregate: compute all stability metrics for an entry
// ---------------------------------------------------------------------------

export interface EntryStabilityInput {
  gradingReports: (GradingReportInput & DimensionScoresInput)[];
  quotientRuns: (QuotientRunInput & { confidence_score?: number | null })[];
}

export function computeEntryStability(input: EntryStabilityInput): StabilityResult[] {
  return [
    computeScoringDrift(input.gradingReports),
    computeEvalConsistency(input.gradingReports),
    computeNarrativeStability(input.quotientRuns),
    computeConfidenceVolatility(input.quotientRuns),
  ];
}

// ---------------------------------------------------------------------------
// Overall stability score (weighted average of all metrics that have data)
// ---------------------------------------------------------------------------

export function overallStabilityScore(results: StabilityResult[]): {
  score: number;
  label: StabilityResult["metric_label"];
  confidence: number;
} {
  const withData = results.filter((r) => r.confidence > 0);
  if (withData.length === 0) return { score: 100, label: "stable", confidence: 0 };
  const weightedSum = withData.reduce((s, r) => s + r.metric_value * r.confidence, 0);
  const totalWeight = withData.reduce((s, r) => s + r.confidence, 0);
  const score = Math.round(weightedSum / totalWeight);
  return {
    score,
    label: labelFromScore(score),
    confidence: Math.round((totalWeight / withData.length) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Metric: Cross-Entry Drift (franchise / universe level)
// Measures how much total_scores vary across entries in a universe.
// ---------------------------------------------------------------------------

export interface CrossEntryReportInput {
  entry_id: string;
  total_score: number;
  originality: number;
  structure: number;
  character_depth: number;
  dialogue: number;
  theme: number;
  emotion: number;
  format_adherence: number;
}

export function computeCrossEntryDrift(reports: CrossEntryReportInput[]): StabilityResult {
  if (reports.length < 2) {
    return {
      metric_name: "cross_entry_drift",
      metric_value: 100,
      metric_label: "stable",
      confidence: 0,
      source_context: "universe_grading_reports",
      computed_at: now(),
    };
  }

  const totalScores = reports.map((r) => r.total_score);
  const cv = coefficientOfVariation(totalScores);
  const value = Math.round(Math.max(0, Math.min(100, (1 - cv / 0.4) * 100)));

  return {
    metric_name: "cross_entry_drift",
    metric_value: value,
    metric_label: labelFromScore(value),
    confidence: confidenceFromSampleSize(reports.length, 4),
    source_context: "universe_grading_reports",
    computed_at: now(),
  };
}

export interface DimensionDrift {
  dimension: string;
  cv: number;
  label: StabilityResult["metric_label"];
  values: { entry_id: string; value: number }[];
}

export function computeDimensionDrifts(reports: CrossEntryReportInput[]): DimensionDrift[] {
  if (reports.length < 2) return [];

  const dims: (keyof Omit<CrossEntryReportInput, "entry_id" | "total_score">)[] = [
    "originality", "structure", "character_depth", "dialogue", "theme", "emotion", "format_adherence",
  ];

  return dims.map((d) => {
    const values = reports.map((r) => ({ entry_id: r.entry_id, value: r[d] }));
    const nums = values.map((v) => v.value);
    const cv = coefficientOfVariation(nums);
    return { dimension: d, cv: Math.round(cv * 1000) / 1000, label: labelFromScore(Math.round(Math.max(0, Math.min(100, (1 - cv / 0.4) * 100)))), values };
  });
}
