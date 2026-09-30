import { RuntimeDatabase } from "./database.mjs";
import { cloneCanonical, timingSafeHashEqual } from "./canonical-json.mjs";
import { validateAggregateState, validateTitleGenesis } from "./contracts.mjs";
import { validateArtifactRegistry } from "./artifact-registry.mjs";
import { validateDependencyGraph } from "./dependency-graph.mjs";
import { invariant } from "./errors.mjs";
import { createPolicy } from "./policy.mjs";
import { replayEvents } from "./replay.mjs";
import { SOURCE_INTAKE_MODES } from "./source-intake.mjs";
import { SourceIntakeService } from "./source-intake-service.mjs";
import { SourceAdmissionEvaluator } from "./source-admission-evaluator.mjs";
import {
  ArtifactImpactEvaluator,
  ArtifactInstanceEvaluator,
  EvidenceIntake,
  EvidenceLifecycleEvaluator,
  GateEvaluator,
  RuntimeReadModel,
  TransactionKernel,
} from "./kernel.mjs";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function assertDatabaseReplay(database) {
  const stored = database.listAggregates();
  const replay = replayEvents(database.listEvents());
  const storedIds = stored.map((envelope) => envelope.aggregate_id).sort();
  const replayIds = Object.keys(replay.aggregates).sort();
  invariant(
    storedIds.length === replayIds.length && storedIds.every((aggregateId, index) => aggregateId === replayIds[index]),
    "REPLAY_AGGREGATE_SET_MISMATCH",
    "Stored aggregate identities do not match the self-contained event history.",
    { stored_ids: storedIds, replay_ids: replayIds },
  );
  for (const envelope of stored) {
    validateAggregateState(envelope);
    const reconstructed = replay.aggregates[envelope.aggregate_id];
    invariant(
      reconstructed.version === envelope.version
        && timingSafeHashEqual(reconstructed.state_hash, envelope.state_hash),
      "REPLAY_HASH_MISMATCH",
      `Stored aggregate does not match replay: ${envelope.aggregate_id}.`,
    );
  }
}

export function openRuntime({
  filename = ":memory:",
  policy,
  clock = () => Date.now(),
  initialAggregates = [],
  artifactRegistry = null,
  dependencyGraph = null,
  evidenceIntakeMode = "QUARANTINE_ONLY",
  sourceIntakeMode = "STANDARD",
} = {}) {
  invariant(policy && typeof policy === "object", "POLICY_REQUIRED", "A validated policy is required.");
  const policySnapshot = cloneCanonical(policy);
  const trustedPolicy = createPolicy(policySnapshot);
  invariant(timingSafeHashEqual(policySnapshot.policy_hash, trustedPolicy.policy_hash), "POLICY_HASH_MISMATCH", "Runtime policy must be created by createPolicy and retain its canonical hash.");
  invariant(typeof clock === "function", "INVALID_CLOCK", "clock must be a function.");
  invariant(["QUARANTINE_ONLY", "SYNTHETIC_FIXTURE"].includes(evidenceIntakeMode), "INVALID_EVIDENCE_INTAKE_MODE", "evidenceIntakeMode must be QUARANTINE_ONLY or SYNTHETIC_FIXTURE.");
  invariant(SOURCE_INTAKE_MODES.includes(sourceIntakeMode), "INVALID_SOURCE_INTAKE_MODE", `Unknown source-intake mode: ${sourceIntakeMode}.`);
  invariant((artifactRegistry === null) === (dependencyGraph === null), "INCOMPLETE_ARTIFACT_SYSTEM", "Artifact registry and dependency graph must be configured together.");
  const trustedRegistry = artifactRegistry === null ? null : deepFreeze(cloneCanonical(artifactRegistry));
  const trustedDependencyGraph = dependencyGraph === null ? null : deepFreeze(cloneCanonical(dependencyGraph));
  const trustedInitialAggregates = deepFreeze(cloneCanonical(initialAggregates));
  if (trustedRegistry) {
    validateArtifactRegistry(trustedRegistry);
    validateDependencyGraph(trustedDependencyGraph, { registry: trustedRegistry });
  }
  const kernelToken = Symbol("hampton-kernel-writer");
  const evidenceToken = Symbol("hampton-evidence-intake");
  const sourceIntakeToken = Symbol("hampton-source-intake");
  const clockToken = Symbol("hampton-trusted-clock");
  const database = new RuntimeDatabase({ filename, kernelToken, evidenceToken, sourceIntakeToken, clockToken });
  const trustedClock = () => database.sampleClock(clockToken, clock());

  try {
    assertDatabaseReplay(database);
    for (const envelope of trustedInitialAggregates) validateTitleGenesis(envelope, { allowLegacy: false });
    const initialIds = trustedInitialAggregates.map((envelope) => envelope.aggregate_id);
    invariant(new Set(initialIds).size === initialIds.length, "DUPLICATE_GENESIS", "initialAggregates contains duplicate title identities.");
    const missing = trustedInitialAggregates.filter((envelope) => !database.getAggregate(envelope.aggregate_id));
    if (missing.length > 0) database.bootstrapAggregates(kernelToken, missing, trustedClock());
    assertDatabaseReplay(database);
  } catch (error) {
    database.close();
    throw error;
  }

  return Object.freeze({
    kernel: new TransactionKernel({ database, kernelToken, policy: trustedPolicy, clock: trustedClock, dependencyGraph: trustedDependencyGraph, artifactRegistry: trustedRegistry }),
    evidenceIntake: new EvidenceIntake({ database, evidenceToken, clock: trustedClock, mode: evidenceIntakeMode }),
    sourceIntake: new SourceIntakeService({ database, sourceIntakeToken, clock: trustedClock, mode: sourceIntakeMode }),
    sourceAdmissionEvaluator: new SourceAdmissionEvaluator({ database, policy: trustedPolicy, clock: trustedClock }),
    evidenceLifecycleEvaluator: new EvidenceLifecycleEvaluator({ database, policy: trustedPolicy, clock: trustedClock, dependencyGraph: trustedDependencyGraph }),
    gateEvaluator: new GateEvaluator({ database, policy: trustedPolicy, clock: trustedClock }),
    artifactImpactEvaluator: new ArtifactImpactEvaluator({ database, dependencyGraph: trustedDependencyGraph, clock: trustedClock }),
    artifactInstanceEvaluator: new ArtifactInstanceEvaluator({ database, artifactRegistry: trustedRegistry, dependencyGraph: trustedDependencyGraph, clock: trustedClock }),
    artifactCatalog: Object.freeze({
      getRegistry: () => trustedRegistry === null ? null : cloneCanonical(trustedRegistry),
      getDependencyGraph: () => trustedDependencyGraph === null ? null : cloneCanonical(trustedDependencyGraph),
    }),
    readModel: new RuntimeReadModel(database),
    close: () => database.close(),
  });
}
