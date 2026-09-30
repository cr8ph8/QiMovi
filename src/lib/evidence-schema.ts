/**
 * Canonical Evidence Bundle Schema v1
 *
 * This is the frozen source-of-truth for all exportable evidence in QiCanIScreenwrite.
 * Do NOT create competing bundle formats. Extend only through additive version bumps.
 */

// ─── Artifact Types (canonical, normalized) ───

export const CANONICAL_ARTIFACT_TYPES = [
  "authorship_continuity",
  "ai_influence",
  "provenance_summary",
  "model_behavior",
  "confidentiality_boundary",
  "originality_distance",
  "evidence_bundle",
] as const;

export type CanonicalArtifactType = (typeof CANONICAL_ARTIFACT_TYPES)[number];

/** Map of legacy/alternate names → canonical type for normalization */
export const ARTIFACT_TYPE_ALIASES: Record<string, CanonicalArtifactType> = {
  ai_influence_map: "ai_influence",
  provenance_graph: "provenance_summary",
};

export function normalizeArtifactType(raw: string): CanonicalArtifactType {
  return (ARTIFACT_TYPE_ALIASES[raw] as CanonicalArtifactType) || (raw as CanonicalArtifactType);
}

// ─── Artifact Lifecycle States ───

export const ARTIFACT_STATES = [
  "pending",
  "generating",
  "ready",
  "stale",
  "failed",
  "exported",
] as const;

export type ArtifactState = (typeof ARTIFACT_STATES)[number];

export function isTerminalState(state: ArtifactState): boolean {
  return state === "ready" || state === "failed" || state === "exported";
}

// ─── Standardized Metric Structure ───

export interface CanonicalMetric {
  metric_name: string;
  metric_value: number;
  metric_label?: string;
  confidence?: number;
  method?: string;
  source_context?: string;
  computed_at: string;
}

// ─── Integrity References ───

export interface IntegrityBlock {
  artifact_hash: string;
  current_text_hash?: string;
  version_graph_hash?: string;
  governance_log_hash?: string;
}

// ─── Evidence Bundle Schema v1 ───

export const EVIDENCE_SCHEMA_VERSION = "1.0.0";

export interface EvidenceBundleScoreBlock {
  authorship_continuity_score?: number;
  ai_influence_ratio?: number;
  voice_stability_score?: number;
  originality_distance_score?: number;
  structural_integrity_score?: number;
}

export interface EvidenceBundleLabelBlock {
  continuity_label?: string;
  voice_stability_label?: string;
  originality_risk_label?: string;
  confidentiality_mode?: string;
}

export interface EvidenceBundleGovernanceBlock {
  governance_event_count: number;
  governance_audit_hash?: string;
  privacy_modes: string[];
  models_used: string[];
  providers_used: string[];
}

export interface EvidenceBundleLineageBlock {
  version_count: number;
  human_version_count: number;
  ai_version_count: number;
  version_graph_hash?: string;
  creation_timeline_summary?: Array<{
    version_id: string;
    actor_type: string;
    source_type: string;
    created_at: string;
  }>;
}

export interface EvidenceBundleSummaryBlock {
  overall_health: "strong" | "moderate" | "weak";
  key_findings: string[];
  export_readiness: boolean;
}

/**
 * Continuous per-criterion decomposition, sourced from `judge_consensus`
 * (`expected_scores` + `score_distributions`) and labelled via
 * `rubric_versions`. Populated by `loadRubricDecomposition` so client + server
 * bundles use the same shape.
 */
export interface EvidenceBundleCriterion {
  key: string;
  label: string;
  weight: number;
  expected_mean: number | null;
  expected_stddev: number | null;
  entropy_avg: number | null;
  pmf_avg: number[] | null;
  judge_count: number;
  methods: string[];
}

export interface EvidenceBundleRubricBlock {
  rubric_preset: string | null;
  rubric_version: number | null;
  rubric_label: string | null;
  panel_size: number;
  weighted_total: number | null;
  criteria: EvidenceBundleCriterion[];
}

export interface EvidenceBundleV1 {
  schema_version: typeof EVIDENCE_SCHEMA_VERSION;
  artifact_id?: string;
  artifact_type: "evidence_bundle";
  artifact_version: number;
  generated_at: string;
  entry_id: string;
  entry_title?: string;
  baseline_version_id?: string;
  current_version_id?: string;

  scores: EvidenceBundleScoreBlock;
  labels: EvidenceBundleLabelBlock;
  governance: EvidenceBundleGovernanceBlock;
  lineage: EvidenceBundleLineageBlock;
  integrity: IntegrityBlock;
  /** Continuous per-criterion decomposition (may be null when no consensus exists). */
  rubric_decomposition?: EvidenceBundleRubricBlock | null;
  summary?: EvidenceBundleSummaryBlock;
}

// ─── Artifact Display Metadata ───

export interface ArtifactTypeMeta {
  label: string;
  description: string;
  iconKey: string;
}

export const ARTIFACT_TYPE_META: Record<CanonicalArtifactType, ArtifactTypeMeta> = {
  authorship_continuity: {
    label: "Authorship Continuity",
    description: "Tracks human vs AI contribution ratios and voice stability across versions.",
    iconKey: "FileCheck",
  },
  ai_influence: {
    label: "AI Influence Map",
    description: "Measures overall AI influence, rewrite intensity, and human restoration patterns.",
    iconKey: "Brain",
  },
  provenance_summary: {
    label: "Provenance Summary",
    description: "Graph of creation nodes and edges showing the evolution of the screenplay.",
    iconKey: "Network",
  },
  model_behavior: {
    label: "Model Behavior",
    description: "Reports on model interactions, drift, and hallucination flags.",
    iconKey: "BarChart3",
  },
  confidentiality_boundary: {
    label: "Confidentiality Boundary",
    description: "Sensitivity level, providers used, and privacy mode audit.",
    iconKey: "Lock",
  },
  originality_distance: {
    label: "Originality Distance",
    description: "Measures novelty, distance from source material, and structural integrity.",
    iconKey: "Sparkles",
  },
  evidence_bundle: {
    label: "Evidence Bundle",
    description: "Composite canonical evidence package for export and review.",
    iconKey: "Shield",
  },
};

// ─── Helper: Determine evidence health from scores ───

export function computeEvidenceHealth(
  scores: EvidenceBundleScoreBlock
): EvidenceBundleSummaryBlock["overall_health"] {
  const vals = [
    scores.authorship_continuity_score,
    scores.voice_stability_score,
    scores.structural_integrity_score,
  ].filter((v): v is number => v != null);

  if (vals.length === 0) return "weak";
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (avg >= 0.7) return "strong";
  if (avg >= 0.4) return "moderate";
  return "weak";
}

// ─── Helper: Check export readiness ───

export interface ArtifactReadinessInput {
  status: string;
  artifact_hash: string;
  artifact_type: string;
}

export function checkExportReadiness(artifacts: ArtifactReadinessInput[]): {
  ready: boolean;
  missing: CanonicalArtifactType[];
  stale: string[];
  failed: string[];
} {
  const required: CanonicalArtifactType[] = [
    "authorship_continuity",
    "ai_influence",
    "originality_distance",
  ];

  const readyTypes = new Set(
    artifacts
      .filter((a) => a.status === "ready" || a.status === "exported")
      .map((a) => normalizeArtifactType(a.artifact_type))
  );

  const missing = required.filter((t) => !readyTypes.has(t));
  const stale = artifacts.filter((a) => a.status === "stale").map((a) => a.artifact_type);
  const failed = artifacts.filter((a) => a.status === "failed").map((a) => a.artifact_type);

  return {
    ready: missing.length === 0 && failed.length === 0,
    missing,
    stale,
    failed,
  };
}
