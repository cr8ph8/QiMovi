import { cloneCanonical, hashCanonical, assertSha256, timingSafeHashEqual } from "./canonical-json.mjs";
import {
  EVIDENCE_DISPOSITIONS,
  EVIDENCE_STATES,
  OPERATION_KINDS,
  RISK_TIERS,
  SCHEMA,
  VERDICTS,
} from "./constants.mjs";
import { KernelError, invariant } from "./errors.mjs";
import { validateProductionGateEvaluation } from "./gate-contract.mjs";
import { validateArtifactImpactReport } from "./dependency-graph.mjs";
import { validateArtifactInstance } from "./artifact-instances.mjs";
import { validateSourceAdmissionRecord } from "./source-admission.mjs";

const ID_PATTERN = /^(?!(?:__proto__|constructor|prototype|hasOwnProperty|isPrototypeOf|propertyIsEnumerable|toLocaleString|toString|valueOf|__defineGetter__|__defineSetter__|__lookupGetter__|__lookupSetter__)$)[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FACT_PATTERN = /^[a-z][a-z0-9._:-]{0,127}$/;
const SHA_OR_ABSENT_PATTERN = /^(?:[0-9a-f]{64}|ABSENT)$/;
const GOVERNED_FACT_TARGETS = new Set(["source.revision"]);

const AGGREGATE_KEYS = new Set([
  "schema_version",
  "aggregate_id",
  "version",
  "previous_state_hash",
  "state_hash",
  "state",
]);
const TITLE_STATE_V2_KEYS = new Set([
  "schema_version",
  "title_id",
  "lifecycle",
  "facts",
  "evidence_refs",
  "evidence_dispositions",
  "invalidated_gate_approval_hashes",
  "gates",
  "invalidations",
]);
const TITLE_STATE_V3_KEYS = new Set([
  ...TITLE_STATE_V2_KEYS,
  "artifact_instances",
  "artifact_heads",
  "artifact_instance_impacts",
]);
const PROPOSAL_KEYS = new Set([
  "schema_version",
  "proposal_id",
  "actor_id",
  "target_aggregate_id",
  "intent",
  "base_state_version",
  "base_state_hash",
  "delta",
  "evidence_refs",
  "declared_risk",
  "idempotency_key",
  "created_at_ms",
  "expires_at_ms",
  "proposal_hash",
]);
const OPERATION_KEYS = new Set(["op_id", "kind", "target", "expected_target_hash", "payload"]);
const RECEIPT_KEYS = new Set([
  "schema_version",
  "receipt_id",
  "verifier_id",
  "verifier_version",
  "proposal_hash",
  "base_state_version",
  "base_state_hash",
  "policy_version",
  "verdict",
  "reason_codes",
  "issued_at_ms",
  "expires_at_ms",
  "receipt_hash",
]);
const EVIDENCE_KEYS = new Set([
  "schema_version",
  "evidence_id",
  "blob_sha256",
  "evidence_class",
  "issuer_id",
  "scope_aggregate_id",
  "state",
  "observed_at_ms",
  "verified_at_ms",
  "expires_at_ms",
  "evidence_hash",
]);
const EVIDENCE_DISPOSITION_KEYS = new Set([
  "schema_version",
  "evidence_id",
  "evidence_hash",
  "evidence_class",
  "scope_aggregate_id",
  "from_state",
  "disposition",
  "replacement_evidence_id",
  "replacement_evidence_hash",
  "invalidated_approval_hashes",
  "gate_recheck_required",
  "effective_at_ms",
  "reason_codes",
  "policy_version",
  "disposition_hash",
]);

function exactKeys(value, keys, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value), "INVALID_CONTRACT", `${label} must be an object.`);
  const actual = Object.keys(value);
  const unknown = actual.filter((key) => !keys.has(key)).sort();
  const missing = [...keys].filter((key) => !(key in value)).sort();
  invariant(unknown.length === 0, "UNKNOWN_FIELDS", `${label} has unknown fields: ${unknown.join(", ")}.`, { unknown });
  invariant(missing.length === 0, "MISSING_FIELDS", `${label} is missing fields: ${missing.join(", ")}.`, { missing });
}

function id(value, field) {
  invariant(typeof value === "string" && ID_PATTERN.test(value), "INVALID_ID", `${field} must match ${ID_PATTERN}.`);
}

function nonemptyString(value, field, maxLength = 2048) {
  invariant(typeof value === "string" && value.length > 0 && value.length <= maxLength, "INVALID_STRING", `${field} must be a non-empty string of at most ${maxLength} characters.`);
}

function safeNonnegativeInteger(value, field) {
  invariant(Number.isSafeInteger(value) && value >= 0, "INVALID_INTEGER", `${field} must be a non-negative safe integer.`);
}

function nullableSafeNonnegativeInteger(value, field) {
  invariant(value === null || (Number.isSafeInteger(value) && value >= 0), "INVALID_INTEGER", `${field} must be null or a non-negative safe integer.`);
}

function uniqueSortedStrings(values, field, { allowEmpty = true } = {}) {
  invariant(Array.isArray(values), "INVALID_ARRAY", `${field} must be an array.`);
  invariant(allowEmpty || values.length > 0, "INVALID_ARRAY", `${field} must not be empty.`);
  for (const value of values) {
    id(value, `${field} item`);
  }
  invariant(new Set(values).size === values.length, "DUPLICATE_VALUE", `${field} must not contain duplicates.`);
  const sorted = [...values].sort();
  invariant(values.every((value, index) => value === sorted[index]), "NON_CANONICAL_ORDER", `${field} must be sorted.`);
}

function uniqueSortedHashes(values, field) {
  invariant(Array.isArray(values), "INVALID_ARRAY", `${field} must be an array.`);
  for (const value of values) {
    assertSha256(value, `${field} item`);
  }
  invariant(new Set(values).size === values.length, "DUPLICATE_VALUE", `${field} must not contain duplicates.`);
  const sorted = [...values].sort();
  invariant(values.every((value, index) => value === sorted[index]), "NON_CANONICAL_ORDER", `${field} must be sorted.`);
}

function payloadForHash(value, hashField) {
  const payload = cloneCanonical(value);
  delete payload[hashField];
  return payload;
}

function validateArtifactProjection(state) {
  invariant(state.artifact_instances && typeof state.artifact_instances === "object" && !Array.isArray(state.artifact_instances), "INVALID_ARTIFACT_INSTANCES", "state.artifact_instances must be an object.");
  invariant(Object.keys(state.artifact_instances).length <= 256, "ARTIFACT_INSTANCE_LIMIT", "A title may contain at most 256 artifact-instance revisions in v0.4.");
  for (const [instanceId, instance] of Object.entries(state.artifact_instances)) {
    id(instanceId, "state.artifact_instances key");
    validateArtifactInstance(instance);
    invariant(instance.instance_id === instanceId, "ARTIFACT_INSTANCE_ID_MISMATCH", "Artifact-instance map key must match instance_id.");
    invariant(instance.title_id === state.title_id, "ARTIFACT_TITLE_MISMATCH", "Artifact instance must match the containing title.");
  }
  invariant(state.artifact_heads && typeof state.artifact_heads === "object" && !Array.isArray(state.artifact_heads), "INVALID_ARTIFACT_HEADS", "state.artifact_heads must be an object.");
  const revisionsBySeries = new Map();
  for (const instance of Object.values(state.artifact_instances)) {
    const revisions = revisionsBySeries.get(instance.series_id) ?? [];
    revisions.push(instance);
    revisionsBySeries.set(instance.series_id, revisions);
  }
  for (const [seriesId, headId] of Object.entries(state.artifact_heads)) {
    id(seriesId, "state.artifact_heads key");
    id(headId, "state.artifact_heads value");
    const head = state.artifact_instances[headId];
    invariant(head && head.series_id === seriesId, "ARTIFACT_HEAD_MISMATCH", "Artifact head must exist and belong to its series.");
  }
  invariant(Object.keys(state.artifact_heads).length === revisionsBySeries.size, "ARTIFACT_HEAD_MISMATCH", "Every artifact series must have exactly one current head.");
  for (const [seriesId, revisions] of revisionsBySeries) {
    revisions.sort((left, right) => left.revision - right.revision);
    invariant(revisions[0].revision === 1, "INVALID_ARTIFACT_LINEAGE", `Artifact series ${seriesId} must begin at revision 1.`);
    for (let index = 0; index < revisions.length; index += 1) {
      const instance = revisions[index];
      invariant(instance.revision === index + 1, "INVALID_ARTIFACT_LINEAGE", `Artifact series ${seriesId} has a revision gap or duplicate.`);
      if (index > 0) {
        const predecessor = revisions[index - 1];
        invariant(instance.supersedes_instance_id === predecessor.instance_id, "INVALID_ARTIFACT_LINEAGE", `Artifact series ${seriesId} does not supersede its immediate predecessor.`);
        invariant(instance.artifact_key === predecessor.artifact_key, "ARTIFACT_LINEAGE_IDENTITY_MISMATCH", "An artifact series cannot change artifact type.");
        invariant(instance.scope.scope_hash === predecessor.scope.scope_hash, "ARTIFACT_LINEAGE_IDENTITY_MISMATCH", "An artifact series cannot change scope.");
      }
    }
    invariant(state.artifact_heads[seriesId] === revisions.at(-1).instance_id, "ARTIFACT_HEAD_MISMATCH", `Artifact series ${seriesId} head must be its highest revision.`);
  }
  invariant(state.artifact_instance_impacts && typeof state.artifact_instance_impacts === "object" && !Array.isArray(state.artifact_instance_impacts), "INVALID_ARTIFACT_INSTANCE_IMPACTS", "state.artifact_instance_impacts must be an object.");
  const instanceIds = Object.keys(state.artifact_instances).sort();
  const impactIds = Object.keys(state.artifact_instance_impacts).sort();
  invariant(instanceIds.length === impactIds.length && instanceIds.every((value, index) => value === impactIds[index]), "ARTIFACT_INSTANCE_IMPACT_MISMATCH", "Every artifact instance must have exactly one impact projection.");
  for (const [instanceId, status] of Object.entries(state.artifact_instance_impacts)) {
    invariant(["NEEDS_REVIEW", "STALE", "INVALID"].includes(status), "INVALID_INVALIDATION_STATUS", `Invalid artifact-instance impact for ${instanceId}: ${status}.`);
  }
}

export function validateTitleState(state) {
  invariant(state && typeof state === "object" && !Array.isArray(state), "INVALID_CONTRACT", "Title state must be an object.");
  if (state.schema_version === SCHEMA.legacyTitleState) {
    exactKeys(state, TITLE_STATE_V2_KEYS, "Title state v2");
  } else if (state.schema_version === SCHEMA.titleState) {
    exactKeys(state, TITLE_STATE_V3_KEYS, "Title state v3");
  } else {
    invariant(false, "UNSUPPORTED_SCHEMA", `Unsupported title state schema: ${state.schema_version}.`);
  }
  id(state.title_id, "state.title_id");
  nonemptyString(state.lifecycle, "state.lifecycle", 64);
  invariant(state.facts && typeof state.facts === "object" && !Array.isArray(state.facts), "INVALID_FACTS", "state.facts must be an object.");
  for (const key of Object.keys(state.facts)) {
    invariant(FACT_PATTERN.test(key), "INVALID_FACT_ID", `Invalid fact ID: ${key}.`);
  }
  uniqueSortedStrings(state.evidence_refs, "state.evidence_refs");
  invariant(state.evidence_dispositions && typeof state.evidence_dispositions === "object" && !Array.isArray(state.evidence_dispositions), "INVALID_EVIDENCE_DISPOSITIONS", "state.evidence_dispositions must be an object.");
  for (const [evidenceId, disposition] of Object.entries(state.evidence_dispositions)) {
    id(evidenceId, "state.evidence_dispositions key");
    validateEvidenceDisposition(disposition);
    invariant(disposition.evidence_id === evidenceId, "EVIDENCE_DISPOSITION_ID_MISMATCH", "Evidence disposition key must match evidence_id.");
    invariant(disposition.scope_aggregate_id === state.title_id, "EVIDENCE_SCOPE_MISMATCH", "Evidence disposition must match the title scope.");
  }
  uniqueSortedHashes(state.invalidated_gate_approval_hashes, "state.invalidated_gate_approval_hashes");
  invariant(state.gates && typeof state.gates === "object" && !Array.isArray(state.gates), "INVALID_GATES", "state.gates must be an object.");
  exactKeys(state.gates, new Set(["production"]), "state.gates");
  validateProductionGateEvaluation(state.gates.production);
  invariant(state.invalidations && typeof state.invalidations === "object" && !Array.isArray(state.invalidations), "INVALID_INVALIDATIONS", "state.invalidations must be an object.");
  for (const [key, status] of Object.entries(state.invalidations)) {
    invariant(
      key === "lifecycle"
        || /^fact:[a-z][a-z0-9._:-]{0,127}$/.test(key)
        || /^evidence:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key)
        || key === "gate:production"
        || /^artifact:[A-Z][A-Z0-9_]{0,127}$/.test(key),
      "INVALID_INVALIDATION_KEY",
      `Invalid invalidation key: ${key}.`,
    );
    invariant(["NEEDS_REVIEW", "STALE", "INVALID"].includes(status), "INVALID_INVALIDATION_STATUS", `Invalid invalidation status for ${key}: ${status}.`);
  }
  if (state.schema_version === SCHEMA.titleState) validateArtifactProjection(state);
  cloneCanonical(state);
  return state;
}

export function aggregateHashPayload(envelope) {
  return {
    schema_version: envelope.schema_version,
    aggregate_id: envelope.aggregate_id,
    version: envelope.version,
    previous_state_hash: envelope.previous_state_hash,
    state: envelope.state,
  };
}

export function sealAggregateState({ aggregate_id, version, previous_state_hash = null, state }) {
  const draft = {
    schema_version: SCHEMA.aggregateState,
    aggregate_id,
    version,
    previous_state_hash,
    state: cloneCanonical(state),
  };
  const envelope = { ...draft, state_hash: hashCanonical(draft) };
  validateAggregateState(envelope);
  return cloneCanonical(envelope);
}

export function validateAggregateState(envelope) {
  exactKeys(envelope, AGGREGATE_KEYS, "Aggregate state");
  invariant(envelope.schema_version === SCHEMA.aggregateState, "UNSUPPORTED_SCHEMA", `Unsupported aggregate schema: ${envelope.schema_version}.`);
  id(envelope.aggregate_id, "aggregate_id");
  safeNonnegativeInteger(envelope.version, "version");
  if (envelope.previous_state_hash !== null) {
    assertSha256(envelope.previous_state_hash, "previous_state_hash");
  }
  assertSha256(envelope.state_hash, "state_hash");
  validateTitleState(envelope.state);
  invariant(envelope.state.title_id === envelope.aggregate_id, "AGGREGATE_ID_MISMATCH", "state.title_id must equal aggregate_id.");
  const observed = hashCanonical(aggregateHashPayload(envelope));
  invariant(timingSafeHashEqual(observed, envelope.state_hash), "STATE_HASH_MISMATCH", "Aggregate state hash does not match canonical state bytes.");
  invariant(envelope.version !== 0 || envelope.previous_state_hash === null, "INVALID_PREVIOUS_HASH", "Version 0 must have a null previous_state_hash.");
  invariant(envelope.version === 0 || envelope.previous_state_hash !== null, "INVALID_PREVIOUS_HASH", "Versions after 0 require previous_state_hash.");
  return envelope;
}

export function validateTitleGenesis(envelope, { allowLegacy = true } = {}) {
  validateAggregateState(envelope);
  invariant(envelope.version === 0, "INVALID_GENESIS", "GENESIS must embed an aggregate at version 0.");
  invariant(envelope.previous_state_hash === null, "INVALID_GENESIS", "GENESIS cannot have a previous state hash.");
  invariant(
    envelope.state.schema_version === SCHEMA.titleState
      || (allowLegacy && envelope.state.schema_version === SCHEMA.legacyTitleState),
    "INVALID_GENESIS_SCHEMA",
    allowLegacy
      ? "GENESIS must use title-state v2 or v3."
      : "Fresh title aggregates must use the current title-state schema; historical v2 state requires replay and an explicit migration transaction.",
  );
  invariant(envelope.state.lifecycle === "DEVELOPMENT", "INVALID_GENESIS_LIFECYCLE", "A fresh title aggregate must start in DEVELOPMENT; snapshot import requires a separate governed path.");
  invariant(envelope.state.gates.production.status === "NOT_EVALUATED", "INVALID_GENESIS_GATE", "GENESIS must start with a NOT_EVALUATED production gate.");
  const emptyGate = {
    status: "NOT_EVALUATED",
    blockers: ["GATE_NOT_EVALUATED"],
    satisfied_evidence_classes: [],
    evidence_hashes: [],
    policy_version: "UNCONFIGURED",
    policy_hash: "0".repeat(64),
    next_recheck_at_ms: null,
  };
  invariant(
    Object.keys(envelope.state.facts).length === 0
      && envelope.state.evidence_refs.length === 0
      && Object.keys(envelope.state.evidence_dispositions).length === 0
      && envelope.state.invalidated_gate_approval_hashes.length === 0
      && Object.keys(envelope.state.invalidations).length === 0
      && hashCanonical(envelope.state.gates.production) === hashCanonical(emptyGate)
      && (
        envelope.state.schema_version === SCHEMA.legacyTitleState
        || (
          Object.keys(envelope.state.artifact_instances).length === 0
          && Object.keys(envelope.state.artifact_heads).length === 0
          && Object.keys(envelope.state.artifact_instance_impacts).length === 0
        )
      ),
    "INVALID_GENESIS_STATE",
    "GENESIS must contain the exact empty reducer-owned title projection; snapshot import requires a separate governed path.",
  );
  return envelope;
}

function validateOperationPayload(operation) {
  switch (operation.kind) {
    case "UPSERT_FACT":
      invariant(FACT_PATTERN.test(operation.target), "INVALID_OPERATION_TARGET", `Invalid fact target: ${operation.target}.`);
      invariant(
        !GOVERNED_FACT_TARGETS.has(operation.target),
        "GOVERNED_SOURCE_ADMISSION_REQUIRED",
        "source.revision is reducer-owned and requires the future governed source-admission transaction.",
      );
      exactKeys(operation.payload, new Set(["value"]), "UPSERT_FACT payload");
      cloneCanonical(operation.payload.value);
      break;
    case "REMOVE_FACT":
      invariant(FACT_PATTERN.test(operation.target), "INVALID_OPERATION_TARGET", `Invalid fact target: ${operation.target}.`);
      invariant(
        !GOVERNED_FACT_TARGETS.has(operation.target),
        "GOVERNED_SOURCE_ADMISSION_REQUIRED",
        "source.revision is reducer-owned and requires the future governed source-admission transaction.",
      );
      invariant(operation.payload === null, "INVALID_OPERATION_PAYLOAD", "REMOVE_FACT payload must be null.");
      break;
    case "SET_LIFECYCLE":
      invariant(operation.target === "lifecycle", "INVALID_OPERATION_TARGET", "SET_LIFECYCLE target must be lifecycle.");
      exactKeys(operation.payload, new Set(["value"]), "SET_LIFECYCLE payload");
      nonemptyString(operation.payload.value, "SET_LIFECYCLE payload.value", 64);
      break;
    case "LINK_EVIDENCE":
    case "UNLINK_EVIDENCE":
      id(operation.target, `${operation.kind} target`);
      invariant(operation.payload === null, "INVALID_OPERATION_PAYLOAD", `${operation.kind} payload must be null.`);
      break;
    case "RECORD_EVIDENCE_DISPOSITION":
      id(operation.target, "RECORD_EVIDENCE_DISPOSITION target");
      validateEvidenceDisposition(operation.payload);
      invariant(operation.payload.evidence_id === operation.target, "EVIDENCE_DISPOSITION_ID_MISMATCH", "Disposition evidence_id must match the operation target.");
      break;
    case "EVALUATE_PRODUCTION_GATE":
      invariant(operation.target === "production", "INVALID_OPERATION_TARGET", "EVALUATE_PRODUCTION_GATE target must be production.");
      validateProductionGateEvaluation(operation.payload);
      break;
    case "APPLY_ARTIFACT_IMPACTS":
      invariant(operation.target === "artifact_impacts", "INVALID_OPERATION_TARGET", "APPLY_ARTIFACT_IMPACTS target must be artifact_impacts.");
      validateArtifactImpactReport(operation.payload);
      break;
    case "MIGRATE_TITLE_STATE":
      invariant(operation.target === "schema_version", "INVALID_OPERATION_TARGET", "MIGRATE_TITLE_STATE target must be schema_version.");
      exactKeys(operation.payload, new Set(["from_schema_version", "to_schema_version"]), "MIGRATE_TITLE_STATE payload");
      invariant(
        operation.payload.from_schema_version === SCHEMA.legacyTitleState
          && operation.payload.to_schema_version === SCHEMA.titleState,
        "INVALID_STATE_MIGRATION",
        "Only the explicit filmstack-title-state/v2 to v3 migration is supported.",
      );
      break;
    case "RECORD_ARTIFACT_INSTANCE":
      id(operation.target, "RECORD_ARTIFACT_INSTANCE target");
      validateArtifactInstance(operation.payload);
      invariant(operation.payload.instance_id === operation.target, "ARTIFACT_INSTANCE_ID_MISMATCH", "Artifact instance_id must match the operation target.");
      break;
    case "ADMIT_SOURCE_REVISION":
      invariant(operation.target === "source.revision", "INVALID_OPERATION_TARGET", "ADMIT_SOURCE_REVISION target must be source.revision.");
      invariant(operation.expected_target_hash === "ABSENT", "SOURCE_REVISION_SUPERSESSION_REQUIRED", "Source admission v1 can create only the first canonical source revision.");
      validateSourceAdmissionRecord(operation.payload);
      break;
    default:
      throw new KernelError("UNKNOWN_OPERATION_KIND", `Unknown operation kind: ${operation.kind}.`);
  }
}

export function validateOperation(operation) {
  exactKeys(operation, OPERATION_KEYS, "Delta operation");
  id(operation.op_id, "operation.op_id");
  invariant(OPERATION_KINDS.includes(operation.kind), "UNKNOWN_OPERATION_KIND", `Unknown operation kind: ${operation.kind}.`);
  nonemptyString(operation.target, "operation.target", 128);
  invariant(typeof operation.expected_target_hash === "string" && SHA_OR_ABSENT_PATTERN.test(operation.expected_target_hash), "INVALID_TARGET_HASH", "expected_target_hash must be ABSENT or a lowercase SHA-256.");
  validateOperationPayload(operation);
  return operation;
}

function operationConflictKey(operation) {
  if (operation.kind === "UPSERT_FACT" || operation.kind === "REMOVE_FACT") {
    return `fact:${operation.target}`;
  }
  if (operation.kind === "LINK_EVIDENCE" || operation.kind === "UNLINK_EVIDENCE") {
    return `evidence:${operation.target}`;
  }
  if (operation.kind === "RECORD_EVIDENCE_DISPOSITION") {
    return `evidence-disposition:${operation.target}`;
  }
  if (operation.kind === "EVALUATE_PRODUCTION_GATE") {
    return "gate:production";
  }
  if (operation.kind === "APPLY_ARTIFACT_IMPACTS") {
    return "artifact_impacts";
  }
  if (operation.kind === "MIGRATE_TITLE_STATE") return "schema_version";
  if (operation.kind === "RECORD_ARTIFACT_INSTANCE") return `artifact-instance:${operation.payload.series_id}`;
  if (operation.kind === "ADMIT_SOURCE_REVISION") return "fact:source.revision";
  return "lifecycle";
}

export function validateDelta(delta) {
  invariant(Array.isArray(delta) && delta.length > 0 && delta.length <= 64, "INVALID_DELTA", "delta must contain between 1 and 64 operations.");
  const opIds = new Set();
  const targets = new Set();
  for (const operation of delta) {
    validateOperation(operation);
    invariant(!opIds.has(operation.op_id), "DUPLICATE_OPERATION_ID", `Duplicate operation ID: ${operation.op_id}.`);
    opIds.add(operation.op_id);
    const conflictKey = operationConflictKey(operation);
    invariant(!targets.has(conflictKey), "CONFLICTING_OPERATIONS", `Multiple operations target ${conflictKey}.`);
    targets.add(conflictKey);
  }
  const migrations = delta.filter((operation) => operation.kind === "MIGRATE_TITLE_STATE");
  invariant(migrations.length === 0 || delta.length === 1, "STATE_MIGRATION_MUST_BE_ISOLATED", "Title-state migration must be the only operation in its proposal.");
  const instanceRecords = delta.filter((operation) => operation.kind === "RECORD_ARTIFACT_INSTANCE");
  invariant(
    instanceRecords.length === 0
      || (
        instanceRecords.length === 1
        && delta.every((operation) => ["RECORD_ARTIFACT_INSTANCE", "APPLY_ARTIFACT_IMPACTS"].includes(operation.kind))
      ),
    "ARTIFACT_INSTANCE_MUST_BE_ISOLATED",
    "Artifact-instance recording may be accompanied only by its kernel-recomputed dependency impact.",
  );
  const sourceAdmissions = delta.filter((operation) => operation.kind === "ADMIT_SOURCE_REVISION");
  invariant(
    sourceAdmissions.length === 0 || (sourceAdmissions.length === 1 && delta.length === 1),
    "SOURCE_ADMISSION_MUST_BE_ISOLATED",
    "Source revision admission must be the only operation in its proposal.",
  );
  return delta;
}

export function proposalHashPayload(proposal) {
  return payloadForHash(proposal, "proposal_hash");
}

export function sealProposal(draft) {
  const normalized = cloneCanonical({
    ...draft,
    schema_version: SCHEMA.proposal,
    delta: [...draft.delta].sort((a, b) => a.op_id.localeCompare(b.op_id)),
    evidence_refs: [...draft.evidence_refs].sort(),
  });
  const proposal = { ...normalized, proposal_hash: hashCanonical(normalized) };
  validateProposal(proposal);
  return cloneCanonical(proposal);
}

export function validateProposal(proposal) {
  exactKeys(proposal, PROPOSAL_KEYS, "Proposal");
  invariant(proposal.schema_version === SCHEMA.proposal, "UNSUPPORTED_SCHEMA", `Unsupported proposal schema: ${proposal.schema_version}.`);
  id(proposal.proposal_id, "proposal_id");
  id(proposal.actor_id, "actor_id");
  id(proposal.target_aggregate_id, "target_aggregate_id");
  nonemptyString(proposal.intent, "intent", 2048);
  safeNonnegativeInteger(proposal.base_state_version, "base_state_version");
  assertSha256(proposal.base_state_hash, "base_state_hash");
  validateDelta(proposal.delta);
  uniqueSortedStrings(proposal.evidence_refs, "evidence_refs");
  invariant(RISK_TIERS.includes(proposal.declared_risk), "INVALID_RISK", `Unknown declared risk: ${proposal.declared_risk}.`);
  id(proposal.idempotency_key, "idempotency_key");
  safeNonnegativeInteger(proposal.created_at_ms, "created_at_ms");
  safeNonnegativeInteger(proposal.expires_at_ms, "expires_at_ms");
  invariant(proposal.expires_at_ms > proposal.created_at_ms, "INVALID_EXPIRY", "expires_at_ms must be greater than created_at_ms.");
  assertSha256(proposal.proposal_hash, "proposal_hash");
  const observed = hashCanonical(proposalHashPayload(proposal));
  invariant(timingSafeHashEqual(observed, proposal.proposal_hash), "PROPOSAL_HASH_MISMATCH", "Proposal hash does not match canonical proposal bytes.");
  return proposal;
}

export function receiptHashPayload(receipt) {
  return payloadForHash(receipt, "receipt_hash");
}

export function sealVerifierReceipt(draft) {
  const normalized = cloneCanonical({
    ...draft,
    schema_version: SCHEMA.verifierReceipt,
    reason_codes: [...draft.reason_codes].sort(),
  });
  const receipt = { ...normalized, receipt_hash: hashCanonical(normalized) };
  validateVerifierReceipt(receipt);
  return cloneCanonical(receipt);
}

export function validateVerifierReceipt(receipt) {
  exactKeys(receipt, RECEIPT_KEYS, "Verifier receipt");
  invariant(receipt.schema_version === SCHEMA.verifierReceipt, "UNSUPPORTED_SCHEMA", `Unsupported receipt schema: ${receipt.schema_version}.`);
  id(receipt.receipt_id, "receipt_id");
  id(receipt.verifier_id, "verifier_id");
  id(receipt.verifier_version, "verifier_version");
  assertSha256(receipt.proposal_hash, "proposal_hash");
  safeNonnegativeInteger(receipt.base_state_version, "base_state_version");
  assertSha256(receipt.base_state_hash, "base_state_hash");
  id(receipt.policy_version, "policy_version");
  invariant(VERDICTS.includes(receipt.verdict), "INVALID_VERDICT", `Unknown verifier verdict: ${receipt.verdict}.`);
  uniqueSortedStrings(receipt.reason_codes, "reason_codes");
  safeNonnegativeInteger(receipt.issued_at_ms, "issued_at_ms");
  safeNonnegativeInteger(receipt.expires_at_ms, "expires_at_ms");
  invariant(receipt.expires_at_ms > receipt.issued_at_ms, "INVALID_EXPIRY", "Receipt expires_at_ms must be greater than issued_at_ms.");
  invariant(receipt.verdict === "PASS" || receipt.reason_codes.length > 0, "MISSING_REASON_CODE", "Non-PASS receipts require at least one reason code.");
  assertSha256(receipt.receipt_hash, "receipt_hash");
  const observed = hashCanonical(receiptHashPayload(receipt));
  invariant(timingSafeHashEqual(observed, receipt.receipt_hash), "RECEIPT_HASH_MISMATCH", "Receipt hash does not match canonical receipt bytes.");
  return receipt;
}

export function evidenceHashPayload(evidence) {
  return payloadForHash(evidence, "evidence_hash");
}

export function sealEvidenceEnvelope(draft) {
  const normalized = cloneCanonical({ ...draft, schema_version: SCHEMA.evidenceEnvelope });
  const envelope = { ...normalized, evidence_hash: hashCanonical(normalized) };
  validateEvidenceEnvelope(envelope);
  return cloneCanonical(envelope);
}

export function validateEvidenceEnvelope(evidence) {
  exactKeys(evidence, EVIDENCE_KEYS, "Evidence envelope");
  invariant(evidence.schema_version === SCHEMA.evidenceEnvelope, "UNSUPPORTED_SCHEMA", `Unsupported evidence schema: ${evidence.schema_version}.`);
  id(evidence.evidence_id, "evidence_id");
  assertSha256(evidence.blob_sha256, "blob_sha256");
  id(evidence.evidence_class, "evidence_class");
  id(evidence.issuer_id, "issuer_id");
  id(evidence.scope_aggregate_id, "scope_aggregate_id");
  invariant(EVIDENCE_STATES.includes(evidence.state), "INVALID_EVIDENCE_STATE", `Unknown evidence state: ${evidence.state}.`);
  safeNonnegativeInteger(evidence.observed_at_ms, "observed_at_ms");
  nullableSafeNonnegativeInteger(evidence.verified_at_ms, "verified_at_ms");
  nullableSafeNonnegativeInteger(evidence.expires_at_ms, "expires_at_ms");
  invariant(evidence.state !== "VERIFIED_CURRENT" || evidence.verified_at_ms !== null, "MISSING_VERIFICATION_TIME", "VERIFIED_CURRENT evidence requires verified_at_ms.");
  invariant(evidence.verified_at_ms === null || evidence.verified_at_ms >= evidence.observed_at_ms, "INVALID_VERIFICATION_TIME", "Evidence cannot be verified before it was observed.");
  invariant(evidence.expires_at_ms === null || evidence.expires_at_ms > evidence.observed_at_ms, "INVALID_EXPIRY", "Evidence expiry must be after observation time.");
  invariant(evidence.expires_at_ms === null || evidence.verified_at_ms === null || evidence.verified_at_ms < evidence.expires_at_ms, "INVALID_VERIFICATION_TIME", "Evidence must be verified before it expires.");
  assertSha256(evidence.evidence_hash, "evidence_hash");
  const observed = hashCanonical(evidenceHashPayload(evidence));
  invariant(timingSafeHashEqual(observed, evidence.evidence_hash), "EVIDENCE_HASH_MISMATCH", "Evidence hash does not match canonical evidence bytes.");
  return evidence;
}

export function evidenceDispositionHashPayload(disposition) {
  return payloadForHash(disposition, "disposition_hash");
}

export function sealEvidenceDisposition(draft) {
  invariant(Array.isArray(draft.reason_codes), "INVALID_ARRAY", "Evidence disposition reason_codes must be an array.");
  invariant(Array.isArray(draft.invalidated_approval_hashes), "INVALID_ARRAY", "Evidence disposition invalidated_approval_hashes must be an array.");
  const normalized = cloneCanonical({
    ...draft,
    schema_version: SCHEMA.evidenceDisposition,
    reason_codes: [...draft.reason_codes].sort(),
    invalidated_approval_hashes: [...draft.invalidated_approval_hashes].sort(),
  });
  const disposition = {
    ...normalized,
    disposition_hash: hashCanonical(normalized),
  };
  validateEvidenceDisposition(disposition);
  return cloneCanonical(disposition);
}

export function validateEvidenceDisposition(disposition) {
  exactKeys(disposition, EVIDENCE_DISPOSITION_KEYS, "Evidence disposition");
  invariant(disposition.schema_version === SCHEMA.evidenceDisposition, "UNSUPPORTED_SCHEMA", `Unsupported evidence disposition schema: ${disposition.schema_version}.`);
  id(disposition.evidence_id, "disposition.evidence_id");
  assertSha256(disposition.evidence_hash, "disposition.evidence_hash");
  id(disposition.evidence_class, "disposition.evidence_class");
  id(disposition.scope_aggregate_id, "disposition.scope_aggregate_id");
  invariant(disposition.from_state === "VERIFIED_CURRENT", "INVALID_EVIDENCE_TRANSITION", "Terminal evidence dispositions must start from VERIFIED_CURRENT.");
  invariant(EVIDENCE_DISPOSITIONS.includes(disposition.disposition), "INVALID_EVIDENCE_DISPOSITION", `Unknown evidence disposition: ${disposition.disposition}.`);
  invariant(disposition.replacement_evidence_id === null || (typeof disposition.replacement_evidence_id === "string" && ID_PATTERN.test(disposition.replacement_evidence_id)), "INVALID_ID", "replacement_evidence_id must be null or a valid identifier.");
  invariant(disposition.replacement_evidence_hash === null || (typeof disposition.replacement_evidence_hash === "string" && /^[0-9a-f]{64}$/.test(disposition.replacement_evidence_hash)), "INVALID_HASH", "replacement_evidence_hash must be null or a lowercase SHA-256.");
  if (disposition.disposition === "SUPERSEDED") {
    invariant(disposition.replacement_evidence_id !== null && disposition.replacement_evidence_hash !== null, "MISSING_REPLACEMENT_EVIDENCE", "SUPERSEDED requires a replacement evidence ID and hash.");
    invariant(disposition.replacement_evidence_id !== disposition.evidence_id, "INVALID_REPLACEMENT_EVIDENCE", "Evidence cannot supersede itself.");
  } else {
    invariant(disposition.replacement_evidence_id === null && disposition.replacement_evidence_hash === null, "UNEXPECTED_REPLACEMENT_EVIDENCE", `${disposition.disposition} cannot name replacement evidence.`);
  }
  uniqueSortedHashes(disposition.invalidated_approval_hashes, "disposition.invalidated_approval_hashes");
  invariant(typeof disposition.gate_recheck_required === "boolean", "INVALID_GATE_RECHECK", "disposition.gate_recheck_required must be boolean.");
  safeNonnegativeInteger(disposition.effective_at_ms, "disposition.effective_at_ms");
  uniqueSortedStrings(disposition.reason_codes, "disposition.reason_codes", { allowEmpty: false });
  id(disposition.policy_version, "disposition.policy_version");
  assertSha256(disposition.disposition_hash, "disposition.disposition_hash");
  const observed = hashCanonical(evidenceDispositionHashPayload(disposition));
  invariant(timingSafeHashEqual(observed, disposition.disposition_hash), "EVIDENCE_DISPOSITION_HASH_MISMATCH", "Evidence disposition hash does not match canonical bytes.");
  return disposition;
}
