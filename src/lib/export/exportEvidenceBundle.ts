/**
 * Canonical JSON Evidence Bundle Export
 *
 * Assembles stored artifact data into a frozen EvidenceBundleV1 structure.
 * Does NOT re-compute metrics — exports canonical stored values only, except
 * for the optional per-criterion `rubric_decomposition` block which is loaded
 * on demand from `judge_consensus` × `rubric_versions`.
 */

import {
  EVIDENCE_SCHEMA_VERSION,
  checkExportReadiness,
  computeEvidenceHealth,
  type EvidenceBundleV1,
  type EvidenceBundleRubricBlock,
} from "@/lib/evidence-schema";
import { loadRubricDecomposition } from "@/lib/consensus/loadDecomposition";

export interface StoredArtifact {
  id: string;
  artifact_type: string;
  artifact_data: Record<string, any>;
  artifact_hash: string;
  artifact_version?: number;
  text_hash?: string;
  version_graph_hash?: string;
  governance_log_hash?: string;
  created_at: string;
  status: string;
}

export function assembleEvidenceBundle(
  entryId: string,
  artifacts: StoredArtifact[],
  entryTitle?: string,
  rubricDecomposition?: EvidenceBundleRubricBlock | null,
): EvidenceBundleV1 {
  const get = (type: string) => artifacts.find((a) => a.artifact_type === type);

  const continuity = get("authorship_continuity");
  const influence = get("ai_influence_map");
  const originality = get("originality_distance");
  const confidentiality = get("confidentiality_boundary");

  const scores = {
    authorship_continuity_score: continuity ? Number(continuity.artifact_data?.continuity_score) : undefined,
    ai_influence_ratio: influence ? Number(influence.artifact_data?.overall_ai_influence) : undefined,
    voice_stability_score: originality ? Number(originality.artifact_data?.voice_stability_score) : undefined,
    originality_distance_score: originality ? Number(originality.artifact_data?.overall_distance) : undefined,
    structural_integrity_score: originality ? Number(originality.artifact_data?.structural_integrity_score) : undefined,
  };

  const readiness = checkExportReadiness(artifacts);

  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    artifact_type: "evidence_bundle",
    artifact_version: 1,
    generated_at: new Date().toISOString(),
    entry_id: entryId,
    entry_title: entryTitle,
    scores,
    labels: {
      continuity_label: continuity?.artifact_data?.continuity_label,
      voice_stability_label: originality?.artifact_data?.voice_stability_label,
      originality_risk_label: originality?.artifact_data?.originality_risk_label,
      confidentiality_mode: confidentiality?.artifact_data?.confidentiality_mode,
    },
    governance: {
      governance_event_count: 0,
      governance_audit_hash: artifacts[0]?.governance_log_hash,
      privacy_modes: confidentiality?.artifact_data?.privacy_modes_active || [],
      models_used: confidentiality?.artifact_data?.models_used || [],
      providers_used: confidentiality?.artifact_data?.providers_used || [],
    },
    lineage: {
      version_count: continuity?.artifact_data?.revision_count || 0,
      human_version_count: continuity?.artifact_data?.human_version_count || 0,
      ai_version_count: continuity?.artifact_data?.ai_version_count || 0,
      version_graph_hash: artifacts[0]?.version_graph_hash,
    },
    integrity: {
      artifact_hash: artifacts.map((a) => a.artifact_hash).join("|"),
      current_text_hash: artifacts[0]?.text_hash,
      version_graph_hash: artifacts[0]?.version_graph_hash,
      governance_log_hash: artifacts[0]?.governance_log_hash,
    },
    rubric_decomposition: rubricDecomposition ?? null,
    summary: {
      overall_health: computeEvidenceHealth(scores),
      key_findings: [],
      export_readiness: readiness.ready,
    },
  };
}

/**
 * Convenience: assemble the bundle and load the per-criterion continuous
 * decomposition from `judge_consensus` × `rubric_versions` in one call.
 */
export async function assembleEvidenceBundleWithRubric(
  entryId: string,
  artifacts: StoredArtifact[],
  entryTitle?: string,
): Promise<EvidenceBundleV1> {
  const decomp = await loadRubricDecomposition(entryId).catch(() => null);
  const block: EvidenceBundleRubricBlock | null = decomp
    ? {
        rubric_preset: decomp.rubric_preset,
        rubric_version: decomp.rubric_version,
        rubric_label: decomp.rubric_label,
        panel_size: decomp.panel_size,
        weighted_total: decomp.weighted_total,
        criteria: decomp.criteria,
      }
    : null;
  return assembleEvidenceBundle(entryId, artifacts, entryTitle, block);
}

export function downloadEvidenceJSON(bundle: EvidenceBundleV1): void {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `evidence_bundle_${bundle.entry_id.slice(0, 8)}_v1.json`;
  a.click();
  URL.revokeObjectURL(url);
}
