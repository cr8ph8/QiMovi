/**
 * Proof Verification — derives per-item verification status from a
 * canonical EvidenceBundleV1 so entrants and judges see the same
 * "is this proven, still pending, or contradicting itself?" answer.
 *
 * Status semantics:
 *   • verified    — evidence is present, hashed, and agrees with itself.
 *   • pending     — evidence hasn't been produced or hasn't finished.
 *   • conflicting — evidence exists but two signals disagree (e.g. a
 *                   "human-written" label with a high AI-influence ratio).
 *                   These are the highest-priority items for review.
 *
 * Every item ships a headline sentence (short badge subtitle) and a longer
 * `explanation` (bullet points + why-it-matters) that the UI opens with a
 * single click. The explanation strings are the authoritative reason-for-
 * status and MUST stay grounded in the numeric evidence fields — never
 * invent a rationale that isn't derivable from the bundle.
 */

import type { EvidenceBundleV1 } from "@/lib/evidence-schema";

export type ProofStatus = "verified" | "pending" | "conflicting";

export interface ProofItem {
  /** Stable machine key — safe to use as React key + analytics id. */
  key: string;
  /** Short display label, e.g. "Authorship continuity". */
  label: string;
  /** Verification verdict. */
  status: ProofStatus;
  /** Single-sentence summary shown next to the status badge. */
  headline: string;
  /** Long-form explanation shown when the user clicks "Explain". */
  explanation: {
    /** Bullet points describing the raw evidence that produced the verdict. */
    findings: string[];
    /** Why this item matters for entrants / judges. */
    whyItMatters: string;
    /** Recommended action, if any (e.g. "Regenerate the artifact"). */
    nextStep?: string;
  };
  /**
   * Optional hash / reference the user can quote back to support.
   * Kept short (first 16 chars) for display.
   */
  evidenceRef?: string;
}

export interface ProofVerificationReport {
  items: ProofItem[];
  counts: Record<ProofStatus, number>;
  /** Overall verdict — worst individual status wins. */
  overall: ProofStatus;
}

// ─── helpers ─────────────────────────────────────────────────────────────

const pct = (v: number | undefined | null): string =>
  v == null || Number.isNaN(v) ? "—" : `${(v * 100).toFixed(1)}%`;

const hashPreview = (h: string | null | undefined): string | undefined =>
  h ? h.slice(0, 16) + "…" : undefined;

const worst = (a: ProofStatus, b: ProofStatus): ProofStatus => {
  const order: Record<ProofStatus, number> = { verified: 0, pending: 1, conflicting: 2 };
  return order[a] >= order[b] ? a : b;
};

// ─── individual checks ──────────────────────────────────────────────────

function checkContinuity(b: EvidenceBundleV1): ProofItem {
  const score = b.scores.authorship_continuity_score;
  const label = b.labels.continuity_label?.toLowerCase();
  const versions = b.lineage.version_count;

  if (score == null) {
    return {
      key: "continuity",
      label: "Authorship continuity",
      status: "pending",
      headline: "No continuity score computed yet.",
      explanation: {
        findings: [
          "The authorship_continuity artifact has not been generated for this entry.",
          `Lineage currently shows ${versions} recorded version(s).`,
        ],
        whyItMatters:
          "Continuity attests that the same author's voice runs through every draft — without it, judges can't distinguish a coherent rewrite from a patchwork of AI-generated fragments.",
        nextStep: "Generate the authorship_continuity artifact from the evidence panel.",
      },
    };
  }

  // Conflict rule: strong label but score is actually low, OR weak label but score is high.
  const strongLabel = label === "strong" || label === "stable";
  const weakLabel = label === "weak" || label === "unstable" || label === "fragmented";
  const conflict = (strongLabel && score < 0.4) || (weakLabel && score >= 0.7);

  if (conflict) {
    return {
      key: "continuity",
      label: "Authorship continuity",
      status: "conflicting",
      headline: `Continuity label "${label}" disagrees with numeric score ${pct(score)}.`,
      explanation: {
        findings: [
          `Continuity score: ${pct(score)}.`,
          `Continuity label: "${label ?? "unset"}".`,
          `Version graph: ${b.lineage.human_version_count} human · ${b.lineage.ai_version_count} AI across ${versions} version(s).`,
        ],
        whyItMatters:
          "When the qualitative label and quantitative score disagree, the underlying analysis is unreliable — either the classifier drifted, or the score was computed on a stale draft.",
        nextStep:
          "Regenerate the authorship_continuity artifact so the label and score are recomputed together against the current draft.",
      },
      evidenceRef: hashPreview(b.integrity.artifact_hash),
    };
  }

  return {
    key: "continuity",
    label: "Authorship continuity",
    status: "verified",
    headline: `Continuity ${pct(score)}${label ? ` · "${label}"` : ""}.`,
    explanation: {
      findings: [
        `Continuity score: ${pct(score)}.`,
        `Continuity label: "${label ?? "unset"}".`,
        `Version graph: ${b.lineage.human_version_count} human · ${b.lineage.ai_version_count} AI across ${versions} version(s).`,
      ],
      whyItMatters:
        "A verified continuity attestation lets judges rely on the draft as a coherent authored work rather than a stitched sequence of unrelated passes.",
    },
    evidenceRef: hashPreview(b.integrity.artifact_hash),
  };
}

function checkAiInfluence(b: EvidenceBundleV1): ProofItem {
  const ratio = b.scores.ai_influence_ratio;
  const providers = b.governance.providers_used ?? [];
  const models = b.governance.models_used ?? [];

  if (ratio == null) {
    return {
      key: "ai_influence",
      label: "AI influence disclosure",
      status: "pending",
      headline: "AI influence ratio has not been measured.",
      explanation: {
        findings: [
          "The ai_influence_map artifact has not been generated for this entry.",
          providers.length
            ? `Providers seen in governance log: ${providers.join(", ")}.`
            : "No providers recorded in the governance log.",
        ],
        whyItMatters:
          "The disclosure ratio is what separates \"AI-assisted\" from \"AI-generated\" in the eyes of a competition. Without it, blind-review fairness can't be enforced.",
        nextStep: "Generate the ai_influence_map artifact.",
      },
    };
  }

  // Conflict: high AI ratio but continuity label / lineage insists the work is fully human.
  const humanClaim =
    b.lineage.ai_version_count === 0 && b.lineage.human_version_count > 0;
  const heavyAi = ratio >= 0.5;
  if (humanClaim && heavyAi) {
    return {
      key: "ai_influence",
      label: "AI influence disclosure",
      status: "conflicting",
      headline: `Lineage claims 0 AI versions but measured AI influence is ${pct(ratio)}.`,
      explanation: {
        findings: [
          `Measured AI influence: ${pct(ratio)}.`,
          `Lineage: ${b.lineage.human_version_count} human · ${b.lineage.ai_version_count} AI version(s).`,
          models.length ? `Models used: ${models.join(", ")}.` : "No models recorded.",
        ],
        whyItMatters:
          "A submission tagged as fully human but with heavy measured AI influence is the exact failure mode blind review is meant to catch. Judges MUST resolve this before scoring.",
        nextStep:
          "Reconcile the disclosure — either update the AI-assisted flag on the entry or regenerate lineage from the correct baseline.",
      },
      evidenceRef: hashPreview(b.integrity.artifact_hash),
    };
  }

  return {
    key: "ai_influence",
    label: "AI influence disclosure",
    status: "verified",
    headline: `AI influence ratio ${pct(ratio)} across ${models.length || 0} model(s).`,
    explanation: {
      findings: [
        `Measured AI influence: ${pct(ratio)}.`,
        `Lineage: ${b.lineage.human_version_count} human · ${b.lineage.ai_version_count} AI version(s).`,
        models.length ? `Models used: ${models.join(", ")}.` : "No models recorded.",
      ],
      whyItMatters:
        "Verified disclosure lets judges apply the correct rubric weighting for AI-assisted vs human-written work without guessing.",
    },
    evidenceRef: hashPreview(b.integrity.artifact_hash),
  };
}

function checkVoiceStability(b: EvidenceBundleV1): ProofItem {
  const score = b.scores.voice_stability_score;
  const label = b.labels.voice_stability_label?.toLowerCase();

  if (score == null) {
    return {
      key: "voice_stability",
      label: "Voice stability",
      status: "pending",
      headline: "Voice-stability signal not computed.",
      explanation: {
        findings: ["The originality_distance artifact hasn't produced a voice-stability score yet."],
        whyItMatters:
          "Voice stability is the strongest single signal that the same writer is behind every scene. Judges lean on it whenever tone shifts between acts.",
        nextStep: "Generate the originality_distance artifact.",
      },
    };
  }

  const strongLabel = label === "stable" || label === "strong";
  const weakLabel = label === "unstable" || label === "weak" || label === "drifting";
  const conflict = (strongLabel && score < 0.4) || (weakLabel && score >= 0.7);
  if (conflict) {
    return {
      key: "voice_stability",
      label: "Voice stability",
      status: "conflicting",
      headline: `Voice label "${label}" disagrees with score ${pct(score)}.`,
      explanation: {
        findings: [
          `Voice stability score: ${pct(score)}.`,
          `Voice stability label: "${label ?? "unset"}".`,
        ],
        whyItMatters:
          "A disagreeing label and score means the voice classifier and the stability metric were computed at different times or on different drafts.",
        nextStep: "Regenerate the originality_distance artifact.",
      },
      evidenceRef: hashPreview(b.integrity.artifact_hash),
    };
  }

  return {
    key: "voice_stability",
    label: "Voice stability",
    status: "verified",
    headline: `Voice stability ${pct(score)}${label ? ` · "${label}"` : ""}.`,
    explanation: {
      findings: [
        `Voice stability score: ${pct(score)}.`,
        `Voice stability label: "${label ?? "unset"}".`,
      ],
      whyItMatters:
        "A verified voice-stability reading tells judges the tonal signature is consistent enough to score as one authored work.",
    },
    evidenceRef: hashPreview(b.integrity.artifact_hash),
  };
}

function checkOriginality(b: EvidenceBundleV1): ProofItem {
  const distance = b.scores.originality_distance_score;
  const risk = b.labels.originality_risk_label?.toLowerCase();

  if (distance == null) {
    return {
      key: "originality",
      label: "Originality distance",
      status: "pending",
      headline: "Originality distance has not been measured.",
      explanation: {
        findings: ["The originality_distance artifact hasn't been generated."],
        whyItMatters:
          "Judges need an objective distance measurement to defend a novelty score against later disputes.",
        nextStep: "Generate the originality_distance artifact.",
      },
    };
  }

  // Conflict: risk says "low" but distance is very small (i.e. close to existing works), or vice versa.
  const conflict =
    (risk === "low" && distance < 0.3) || (risk === "high" && distance >= 0.7);
  if (conflict) {
    return {
      key: "originality",
      label: "Originality distance",
      status: "conflicting",
      headline: `Risk label "${risk}" disagrees with measured distance ${pct(distance)}.`,
      explanation: {
        findings: [
          `Originality distance: ${pct(distance)}.`,
          `Risk label: "${risk ?? "unset"}".`,
        ],
        whyItMatters:
          "A low-risk label paired with a low distance (or the reverse) means the risk classifier is out of sync with the measurement — a common source of unfair novelty scores.",
        nextStep: "Regenerate originality_distance so risk and distance are recomputed together.",
      },
      evidenceRef: hashPreview(b.integrity.artifact_hash),
    };
  }

  return {
    key: "originality",
    label: "Originality distance",
    status: "verified",
    headline: `Distance ${pct(distance)}${risk ? ` · risk "${risk}"` : ""}.`,
    explanation: {
      findings: [
        `Originality distance: ${pct(distance)}.`,
        `Risk label: "${risk ?? "unset"}".`,
      ],
      whyItMatters:
        "A verified originality reading is the defensible basis for the novelty component of the rubric score.",
    },
    evidenceRef: hashPreview(b.integrity.artifact_hash),
  };
}

function checkProvenance(b: EvidenceBundleV1): ProofItem {
  const graphHash = b.lineage.version_graph_hash ?? b.integrity.version_graph_hash;
  const versions = b.lineage.version_count;

  if (!graphHash) {
    return {
      key: "provenance",
      label: "Provenance graph integrity",
      status: "pending",
      headline: "No provenance hash recorded.",
      explanation: {
        findings: [
          "The provenance_summary artifact has not been sealed with a version_graph_hash.",
          `Recorded versions: ${versions}.`,
        ],
        whyItMatters:
          "The provenance hash is what lets an auditor re-run the pipeline months later and prove every draft came from the recorded parent.",
        nextStep: "Regenerate the provenance_summary artifact and re-seal the version graph.",
      },
    };
  }

  // Conflict: two integrity blocks disagree.
  if (
    b.lineage.version_graph_hash &&
    b.integrity.version_graph_hash &&
    b.lineage.version_graph_hash !== b.integrity.version_graph_hash
  ) {
    return {
      key: "provenance",
      label: "Provenance graph integrity",
      status: "conflicting",
      headline: "Lineage hash disagrees with integrity block hash.",
      explanation: {
        findings: [
          `Lineage.version_graph_hash: ${b.lineage.version_graph_hash.slice(0, 16)}…`,
          `Integrity.version_graph_hash: ${b.integrity.version_graph_hash.slice(0, 16)}…`,
        ],
        whyItMatters:
          "Two different graph hashes for the same entry means the artifact and the integrity block were sealed against different draft snapshots — the bundle is not self-consistent.",
        nextStep: "Regenerate every artifact so the integrity block reseals against the current graph.",
      },
      evidenceRef: hashPreview(graphHash),
    };
  }

  return {
    key: "provenance",
    label: "Provenance graph integrity",
    status: "verified",
    headline: `${versions} version(s) sealed under a shared graph hash.`,
    explanation: {
      findings: [
        `Version graph hash: ${graphHash.slice(0, 24)}…`,
        `Versions in graph: ${versions}.`,
      ],
      whyItMatters:
        "A verified graph hash means any judge or auditor can independently recompute the lineage and get the exact same tree.",
    },
    evidenceRef: hashPreview(graphHash),
  };
}

function checkGovernance(b: EvidenceBundleV1): ProofItem {
  const auditHash = b.governance.governance_audit_hash ?? b.integrity.governance_log_hash;
  const eventCount = b.governance.governance_event_count ?? 0;

  if (!auditHash) {
    return {
      key: "governance",
      label: "Governance log",
      status: "pending",
      headline: "Governance log has not been sealed.",
      explanation: {
        findings: [
          "No governance_log_hash is attached to this bundle.",
          `Recorded governance events: ${eventCount}.`,
        ],
        whyItMatters:
          "The governance log is the audit trail for every policy-affecting decision — without a sealed hash there is no proof it hasn't been edited after the fact.",
        nextStep: "Trigger a governance seal from the admin governance panel.",
      },
    };
  }

  return {
    key: "governance",
    label: "Governance log",
    status: "verified",
    headline: `${eventCount} event(s) sealed under audit hash.`,
    explanation: {
      findings: [
        `Governance audit hash: ${auditHash.slice(0, 24)}…`,
        `Sealed event count: ${eventCount}.`,
      ],
      whyItMatters:
        "A verified governance log lets judges cite policy decisions (blocks, escalations, admits) with a tamper-evident receipt.",
    },
    evidenceRef: hashPreview(auditHash),
  };
}

function checkRubric(b: EvidenceBundleV1): ProofItem {
  const rd = b.rubric_decomposition;
  if (!rd || rd.criteria.length === 0) {
    return {
      key: "rubric_consensus",
      label: "Rubric consensus",
      status: "pending",
      headline: "No panel consensus recorded for this entry.",
      explanation: {
        findings: ["judge_consensus has no rows for this entry yet."],
        whyItMatters:
          "Rubric consensus is what turns raw judge scores into a defensible total. Without it, the leaderboard number is a preview, not a result.",
        nextStep: "Wait for the required judge panel to finalize scoring.",
      },
    };
  }

  // Conflict: a weighted total exists but no per-criterion detail.
  if (rd.weighted_total != null && rd.criteria.length === 0) {
    return {
      key: "rubric_consensus",
      label: "Rubric consensus",
      status: "conflicting",
      headline: "Weighted total exists without per-criterion detail.",
      explanation: {
        findings: [
          `Weighted total: ${rd.weighted_total.toFixed(2)} / 10.`,
          "Per-criterion breakdown is empty.",
        ],
        whyItMatters:
          "A total with no breakdown can't be defended in a dispute — the numeric result has no evidence trail back to individual rubric decisions.",
        nextStep: "Reload the rubric decomposition or re-finalize consensus.",
      },
    };
  }

  return {
    key: "rubric_consensus",
    label: "Rubric consensus",
    status: "verified",
    headline:
      `Panel of ${rd.panel_size} across ${rd.criteria.length} criteria` +
      (rd.weighted_total != null ? ` · total ${rd.weighted_total.toFixed(2)} / 10.` : "."),
    explanation: {
      findings: [
        `Panel size: ${rd.panel_size}.`,
        `Criteria measured: ${rd.criteria.length}.`,
        rd.rubric_label
          ? `Rubric: ${rd.rubric_label}${rd.rubric_version != null ? ` v${rd.rubric_version}` : ""}.`
          : "Rubric label not set.",
      ],
      whyItMatters:
        "Verified consensus is the substantive result — judges' individual scores collapsed into a defensible per-criterion decomposition.",
    },
  };
}

// ─── entry point ────────────────────────────────────────────────────────

/**
 * Compute the full proof-verification report for an evidence bundle.
 * Pure function; safe to call in a render pass.
 */
export function verifyEvidenceBundle(bundle: EvidenceBundleV1): ProofVerificationReport {
  const items: ProofItem[] = [
    checkContinuity(bundle),
    checkAiInfluence(bundle),
    checkVoiceStability(bundle),
    checkOriginality(bundle),
    checkProvenance(bundle),
    checkGovernance(bundle),
    checkRubric(bundle),
  ];

  const counts: Record<ProofStatus, number> = { verified: 0, pending: 0, conflicting: 0 };
  let overall: ProofStatus = "verified";
  for (const item of items) {
    counts[item.status] += 1;
    overall = worst(overall, item.status);
  }

  return { items, counts, overall };
}
