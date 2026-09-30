import { cloneCanonical, hashCanonical } from "./canonical-json.mjs";
import { sealAggregateState, validateAggregateState, validateDelta } from "./contracts.mjs";
import { SCHEMA } from "./constants.mjs";
import { mergeImpactStatus } from "./dependency-graph.mjs";
import { KernelError, invariant } from "./errors.mjs";
import { sourceRevisionProjection } from "./source-admission.mjs";

function evidenceLinkHash(evidenceId) {
  return hashCanonical({ evidence_id: evidenceId, linked: true });
}

export function artifactImpactProjectionHash(state) {
  return state.schema_version === SCHEMA.titleState
    ? hashCanonical({
        invalidations: state.invalidations,
        artifact_heads: state.artifact_heads,
        artifact_instance_impacts: state.artifact_instance_impacts,
      })
    : hashCanonical(state.invalidations);
}

export function currentTargetHash(state, operation) {
  switch (operation.kind) {
    case "UPSERT_FACT":
    case "REMOVE_FACT":
      return Object.hasOwn(state.facts, operation.target)
        ? hashCanonical(state.facts[operation.target])
        : "ABSENT";
    case "SET_LIFECYCLE":
      return hashCanonical(state.lifecycle);
    case "LINK_EVIDENCE":
    case "UNLINK_EVIDENCE":
      return state.evidence_refs.includes(operation.target)
        ? evidenceLinkHash(operation.target)
        : "ABSENT";
    case "RECORD_EVIDENCE_DISPOSITION":
      return Object.hasOwn(state.evidence_dispositions, operation.target)
        ? hashCanonical(state.evidence_dispositions[operation.target])
        : "ABSENT";
    case "EVALUATE_PRODUCTION_GATE":
      return hashCanonical(state.gates.production);
    case "APPLY_ARTIFACT_IMPACTS":
      return artifactImpactProjectionHash(state);
    case "MIGRATE_TITLE_STATE":
      return hashCanonical(state.schema_version);
    case "RECORD_ARTIFACT_INSTANCE":
      return Object.hasOwn(state.artifact_instances ?? {}, operation.target)
        ? state.artifact_instances[operation.target].instance_hash
        : "ABSENT";
    case "ADMIT_SOURCE_REVISION":
      return Object.hasOwn(state.facts, "source.revision")
        ? hashCanonical(state.facts["source.revision"])
        : "ABSENT";
    default:
      throw new KernelError("UNKNOWN_OPERATION_KIND", `Unknown operation kind: ${operation.kind}.`);
  }
}

export function assertExpectedTargets(state, delta) {
  for (const operation of delta) {
    const observed = currentTargetHash(state, operation);
    invariant(
      observed === operation.expected_target_hash,
      "STALE_TARGET",
      `Operation ${operation.op_id} expected ${operation.expected_target_hash} but observed ${observed}.`,
      { op_id: operation.op_id, expected: operation.expected_target_hash, observed },
    );
  }
}

function markInvalidation(state, target, status = "NEEDS_REVIEW") {
  state.invalidations[target] = mergeImpactStatus(state.invalidations[target], status);
}

export function applyDelta(currentEnvelope, delta) {
  validateAggregateState(currentEnvelope);
  validateDelta(delta);
  assertExpectedTargets(currentEnvelope.state, delta);

  const nextState = cloneCanonical(currentEnvelope.state);
  let productionGateRecomputed = false;
  for (const operation of delta) {
    switch (operation.kind) {
      case "UPSERT_FACT":
        {
          const changed = !Object.hasOwn(nextState.facts, operation.target)
            || hashCanonical(nextState.facts[operation.target]) !== hashCanonical(operation.payload.value);
          nextState.facts[operation.target] = cloneCanonical(operation.payload.value);
          if (changed) markInvalidation(nextState, `fact:${operation.target}`);
        }
        break;
      case "REMOVE_FACT":
        invariant(Object.hasOwn(nextState.facts, operation.target), "MISSING_TARGET", `Cannot remove missing fact: ${operation.target}.`);
        delete nextState.facts[operation.target];
        markInvalidation(nextState, `fact:${operation.target}`);
        break;
      case "SET_LIFECYCLE":
        nextState.lifecycle = operation.payload.value;
        markInvalidation(nextState, "lifecycle");
        break;
      case "LINK_EVIDENCE":
        invariant(!nextState.evidence_refs.includes(operation.target), "TARGET_ALREADY_EXISTS", `Evidence is already linked: ${operation.target}.`);
        nextState.evidence_refs = [...nextState.evidence_refs, operation.target].sort();
        markInvalidation(nextState, `evidence:${operation.target}`);
        break;
      case "UNLINK_EVIDENCE":
        invariant(nextState.evidence_refs.includes(operation.target), "MISSING_TARGET", `Evidence is not linked: ${operation.target}.`);
        nextState.evidence_refs = nextState.evidence_refs.filter((item) => item !== operation.target);
        markInvalidation(nextState, `evidence:${operation.target}`);
        break;
      case "RECORD_EVIDENCE_DISPOSITION":
        invariant(!Object.hasOwn(nextState.evidence_dispositions, operation.target), "EVIDENCE_ALREADY_DISPOSED", `Evidence already has a terminal disposition: ${operation.target}.`);
        nextState.evidence_dispositions[operation.target] = cloneCanonical(operation.payload);
        nextState.invalidated_gate_approval_hashes = [...new Set([
          ...nextState.invalidated_gate_approval_hashes,
          ...operation.payload.invalidated_approval_hashes,
        ])].sort();
        markInvalidation(nextState, `evidence:${operation.target}`, "INVALID");
        if (operation.payload.gate_recheck_required) markInvalidation(nextState, "gate:production", "INVALID");
        break;
      case "EVALUATE_PRODUCTION_GATE":
        nextState.gates.production = cloneCanonical(operation.payload);
        productionGateRecomputed = true;
        break;
      case "APPLY_ARTIFACT_IMPACTS":
        invariant(operation.payload.base_state_hash === currentEnvelope.state_hash, "ARTIFACT_IMPACT_BASE_MISMATCH", "Artifact impact report is bound to a different base state.");
        for (const impact of operation.payload.impacts) {
          markInvalidation(nextState, `artifact:${impact.artifact_key}`, impact.status);
          if (nextState.schema_version === SCHEMA.titleState) {
            const currentHeadIds = Object.values(nextState.artifact_heads).sort();
            for (const instanceId of currentHeadIds) {
              const instance = nextState.artifact_instances[instanceId];
              if (instance.artifact_key === impact.artifact_key) {
                nextState.artifact_instance_impacts[instanceId] = mergeImpactStatus(
                  nextState.artifact_instance_impacts[instanceId],
                  impact.status,
                );
              }
            }
          }
        }
        break;
      case "MIGRATE_TITLE_STATE":
        invariant(nextState.schema_version === SCHEMA.legacyTitleState, "INVALID_STATE_MIGRATION", "Only a v2 title state can migrate to v3.");
        nextState.schema_version = SCHEMA.titleState;
        nextState.artifact_instances = {};
        nextState.artifact_heads = {};
        nextState.artifact_instance_impacts = {};
        break;
      case "RECORD_ARTIFACT_INSTANCE":
        invariant(nextState.schema_version === SCHEMA.titleState, "STATE_SCHEMA_MIGRATION_REQUIRED", "Artifact instances require filmstack-title-state/v3.");
        invariant(!Object.hasOwn(nextState.artifact_instances, operation.target), "ARTIFACT_INSTANCE_ALREADY_EXISTS", `Artifact instance already exists: ${operation.target}.`);
        invariant(operation.payload.title_id === currentEnvelope.aggregate_id, "ARTIFACT_TITLE_MISMATCH", "Artifact instance must match the containing title.");
        {
          const priorId = nextState.artifact_heads[operation.payload.series_id] ?? null;
          invariant(operation.payload.supersedes_instance_id === priorId, "INVALID_ARTIFACT_LINEAGE", "Artifact instance must supersede the exact current series head.");
          if (priorId === null) {
            invariant(operation.payload.revision === 1, "INVALID_ARTIFACT_LINEAGE", "A new artifact series must begin at revision 1.");
          } else {
            const prior = nextState.artifact_instances[priorId];
            invariant(operation.payload.revision === prior.revision + 1, "INVALID_ARTIFACT_LINEAGE", "Artifact revision must advance exactly once.");
            invariant(operation.payload.artifact_key === prior.artifact_key, "ARTIFACT_LINEAGE_IDENTITY_MISMATCH", "Artifact series cannot change type.");
            invariant(operation.payload.scope.scope_hash === prior.scope.scope_hash, "ARTIFACT_LINEAGE_IDENTITY_MISMATCH", "Artifact series cannot change scope.");
          }
          nextState.artifact_instances[operation.target] = cloneCanonical(operation.payload);
          nextState.artifact_heads[operation.payload.series_id] = operation.target;
          nextState.artifact_instance_impacts[operation.target] = "NEEDS_REVIEW";
          markInvalidation(nextState, `artifact:${operation.payload.artifact_key}`);
        }
        break;
      case "ADMIT_SOURCE_REVISION":
        invariant(!Object.hasOwn(nextState.facts, "source.revision"), "SOURCE_REVISION_SUPERSESSION_REQUIRED", "Source admission v1 cannot replace an existing source revision.");
        nextState.facts["source.revision"] = sourceRevisionProjection(operation.payload);
        markInvalidation(nextState, "fact:source.revision");
        break;
      default:
        throw new KernelError("UNKNOWN_OPERATION_KIND", `Unknown operation kind: ${operation.kind}.`);
    }
  }

  if (productionGateRecomputed) {
    delete nextState.invalidations["gate:production"];
  }

  // Gates are reducer-owned. The only public gate operation carries a kernel-recomputed evaluation.
  const nextEnvelope = sealAggregateState({
    aggregate_id: currentEnvelope.aggregate_id,
    version: currentEnvelope.version + 1,
    previous_state_hash: currentEnvelope.state_hash,
    state: nextState,
  });
  return nextEnvelope;
}

export function createInitialTitleState({ titleId, lifecycle = "DEVELOPMENT" }) {
  invariant(lifecycle === "DEVELOPMENT", "INVALID_GENESIS_LIFECYCLE", "Fresh title genesis must start in DEVELOPMENT; imports require a separate governed path.");
  return sealAggregateState({
    aggregate_id: titleId,
    version: 0,
    previous_state_hash: null,
    state: {
      schema_version: SCHEMA.titleState,
      title_id: titleId,
      lifecycle,
      facts: {},
      evidence_refs: [],
      evidence_dispositions: {},
      invalidated_gate_approval_hashes: [],
      gates: {
        production: {
          status: "NOT_EVALUATED",
          blockers: ["GATE_NOT_EVALUATED"],
          satisfied_evidence_classes: [],
          evidence_hashes: [],
          policy_version: "UNCONFIGURED",
          policy_hash: "0".repeat(64),
          next_recheck_at_ms: null,
        },
      },
      invalidations: {},
      artifact_instances: {},
      artifact_heads: {},
      artifact_instance_impacts: {},
    },
  });
}

export function createTitleStateMigrationOperation({ stateEnvelope, opId = "migrate-title-state-v2-to-v3" }) {
  invariant(stateEnvelope.state.schema_version === SCHEMA.legacyTitleState, "INVALID_STATE_MIGRATION", "Only a v2 title state can migrate to v3.");
  return {
    op_id: opId,
    kind: "MIGRATE_TITLE_STATE",
    target: "schema_version",
    expected_target_hash: hashCanonical(SCHEMA.legacyTitleState),
    payload: {
      from_schema_version: SCHEMA.legacyTitleState,
      to_schema_version: SCHEMA.titleState,
    },
  };
}
