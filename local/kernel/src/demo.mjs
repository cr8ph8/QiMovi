import {
  createInitialTitleState,
  createPolicy,
  loadCompiledArtifactSystem,
  openRuntime,
  sealProposal,
  sealVerifierReceipt,
} from "./index.mjs";

const now = Date.UTC(2026, 7, 30, 17, 0, 0);
const aggregate = createInitialTitleState({ titleId: "fixture-title-001" });
const artifactSystem = loadCompiledArtifactSystem();
const policy = createPolicy({
  version: "fixture-policy-v1",
  actors: {
    "fixture-producer": {
      aggregate_ids: ["fixture-title-001"],
      allowed_operations: ["UPSERT_FACT"],
      max_risk: "R1",
    },
  },
  trusted_verifiers: {
    "domain-invariants": "1.0.0",
  },
  base_required_verifiers: ["domain-invariants"],
  risk_required_verifiers: {},
  operation_risk: {
    UPSERT_FACT: "R1",
  },
});

const runtime = openRuntime({
  policy,
  clock: () => now,
  initialAggregates: [aggregate],
  artifactRegistry: artifactSystem.registry,
  dependencyGraph: artifactSystem.dependencyGraph,
});

const sourceCandidateOperation = {
  op_id: "op-source-candidate-revision",
  kind: "UPSERT_FACT",
  target: "source.candidate_revision",
  expected_target_hash: "ABSENT",
  payload: { value: "synthetic-source-candidate-v1" },
};

const proposal = sealProposal({
  proposal_id: "proposal-fixture-001",
  actor_id: "fixture-producer",
  target_aggregate_id: "fixture-title-001",
  intent: "Record a synthetic source candidate marker without admitting a canonical source revision or clearing any production gate.",
  base_state_version: aggregate.version,
  base_state_hash: aggregate.state_hash,
  delta: [sourceCandidateOperation],
  evidence_refs: [],
  declared_risk: "R1",
  idempotency_key: "fixture-commit-001",
  created_at_ms: now - 1000,
  expires_at_ms: now + 60000,
});

const receipt = sealVerifierReceipt({
  receipt_id: "receipt-fixture-001",
  verifier_id: "domain-invariants",
  verifier_version: "1.0.0",
  proposal_hash: proposal.proposal_hash,
  base_state_version: aggregate.version,
  base_state_hash: aggregate.state_hash,
  policy_version: policy.version,
  verdict: "PASS",
  reason_codes: [],
  issued_at_ms: now - 500,
  expires_at_ms: now + 30000,
});

const result = runtime.kernel.decide({
  authenticated_actor_id: "fixture-producer",
  proposal,
  receipts: [receipt],
});
const current = runtime.readModel.getAggregate("fixture-title-001");

process.stdout.write(`${JSON.stringify({
  boundary: "SYNTHETIC_FIXTURE_ONLY",
  decision: result,
  authoritative_state: current,
  artifact_registry: {
    records: artifactSystem.registry.counts.records,
    baseline: artifactSystem.registry.counts.baseline_artifact_types,
    overlays: artifactSystem.registry.counts.policy_overlays,
    registry_hash: artifactSystem.registry.registry_hash,
  },
  dependency_graph: {
    rules: artifactSystem.dependencyGraph.rules.length,
    graph_hash: artifactSystem.dependencyGraph.graph_hash,
    impact_hash: null,
    impacted_artifact_types: 0,
  },
  event_count: runtime.readModel.listEvents().length,
  production_gate_effect: "NONE",
}, null, 2)}\n`);

runtime.close();
