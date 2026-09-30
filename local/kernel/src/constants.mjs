export const SCHEMA = Object.freeze({
  aggregateState: "hampton-aggregate-state/v1",
  legacyTitleState: "filmstack-title-state/v2",
  titleState: "filmstack-title-state/v3",
  proposal: "hampton-proposal/v1",
  verifierReceipt: "hampton-verifier-receipt/v1",
  evidenceEnvelope: "hampton-evidence-envelope/v1",
  evidenceDisposition: "hampton-evidence-disposition/v1",
  decisionResult: "hampton-decision-result/v1",
  event: "hampton-event/v1",
  artifactRegistry: "filmstack-artifact-registry/v1",
  dependencyGraph: "filmstack-dependency-graph/v1",
  artifactImpact: "filmstack-artifact-impact/v1",
  artifactInstance: "filmstack-artifact-instance/v1",
  artifactDependencySnapshot: "filmstack-artifact-dependency-snapshot/v1",
  shotTaxonomy: "filmstack-shot-taxonomy/v1",
  shotTaxonomyRegistry: "filmstack-shot-taxonomy-registry/v1",
  shotRecord: "filmstack-shot-record/v1",
  reactorGenerationIntent: "filmstack-reactor-generation-intent/v1",
});

export const DECISIONS = Object.freeze(["COMMIT", "REJECT", "REWRITE", "ESCALATE"]);
export const VERDICTS = Object.freeze(["PASS", "FAIL", "REWRITE_REQUIRED"]);
export const RISK_TIERS = Object.freeze(["R0", "R1", "R2", "R3", "R4"]);
export const OPERATION_KINDS = Object.freeze([
  "UPSERT_FACT",
  "REMOVE_FACT",
  "SET_LIFECYCLE",
  "LINK_EVIDENCE",
  "UNLINK_EVIDENCE",
  "RECORD_EVIDENCE_DISPOSITION",
  "EVALUATE_PRODUCTION_GATE",
  "APPLY_ARTIFACT_IMPACTS",
  "MIGRATE_TITLE_STATE",
  "RECORD_ARTIFACT_INSTANCE",
  "ADMIT_SOURCE_REVISION",
]);
export const EVIDENCE_STATES = Object.freeze([
  "OBSERVED",
  "VERIFICATION_REQUIRED",
  "VERIFIED_CURRENT",
  "REJECTED",
  "SUPERSEDED",
  "REVOKED",
  "EXPIRED",
]);

export const EVIDENCE_DISPOSITIONS = Object.freeze([
  "SUPERSEDED",
  "REVOKED",
  "EXPIRED",
]);

export const GENESIS_HASH = "0".repeat(64);
