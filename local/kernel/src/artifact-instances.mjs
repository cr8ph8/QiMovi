import {
  assertSha256,
  cloneCanonical,
  hashCanonical,
  timingSafeHashEqual,
} from "./canonical-json.mjs";
import { SCHEMA } from "./constants.mjs";
import { invariant } from "./errors.mjs";

export const ARTIFACT_INSTANCE_WATERMARK = "PROSPECTIVE_NOT_AUTHORIZED";
export const ARTIFACT_INSTANCE_APPLICABILITY = Object.freeze([
  "REQUIRED",
  "ASSESSMENT_REQUIRED",
]);

const ID_PATTERN = /^(?!(?:__proto__|constructor|prototype|hasOwnProperty|isPrototypeOf|propertyIsEnumerable|toLocaleString|toString|valueOf|__defineGetter__|__defineSetter__|__lookupGetter__|__lookupSetter__)$)[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ARTIFACT_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const SHA_OR_ABSENT_PATTERN = /^(?:[0-9a-f]{64}|ABSENT)$/;
const INSTANCE_KEYS = new Set([
  "schema_version",
  "instance_id",
  "series_id",
  "revision",
  "supersedes_instance_id",
  "title_id",
  "artifact_key",
  "registry_hash",
  "scope",
  "applicability",
  "document_state",
  "authority_state",
  "responsibility",
  "materialization",
  "dependency_snapshot",
  "instance_hash",
]);
const SCOPE_KEYS = new Set(["kind", "scope_id", "scope_hash"]);
const RESPONSIBILITY_KEYS = new Set(["owner_actor_id", "reviewer_actor_ids", "approver_actor_ids"]);
const MATERIALIZATION_KEYS = new Set(["candidate_blob_sha256", "media_type", "storage_ref", "watermark"]);
const SNAPSHOT_KEYS = new Set([
  "schema_version",
  "registry_hash",
  "graph_hash",
  "rules_version",
  "base_state_version",
  "base_state_hash",
  "scope_hash",
  "bindings",
  "unresolved_required_rule_ids",
  "snapshot_hash",
]);
const BINDING_KEYS = new Set([
  "rule_id",
  "relation",
  "required",
  "source_kind",
  "source_id",
  "source_state",
  "source_hash",
]);

function exactKeys(value, keys, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value), "INVALID_ARTIFACT_INSTANCE", `${label} must be an object.`);
  const unknown = Object.keys(value).filter((key) => !keys.has(key)).sort();
  const missing = [...keys].filter((key) => !(key in value)).sort();
  invariant(unknown.length === 0 && missing.length === 0, "INVALID_ARTIFACT_INSTANCE", `${label} keys do not match the contract.`, { unknown, missing });
}

function id(value, field) {
  invariant(typeof value === "string" && ID_PATTERN.test(value), "INVALID_ARTIFACT_INSTANCE", `${field} is invalid.`);
}

function nonemptyString(value, field, maxLength = 2048) {
  invariant(typeof value === "string" && value.length > 0 && value.length <= maxLength, "INVALID_ARTIFACT_INSTANCE", `${field} must contain 1-${maxLength} characters.`);
}

function sortedUniqueIds(values, field) {
  invariant(Array.isArray(values), "INVALID_ARTIFACT_INSTANCE", `${field} must be an array.`);
  for (const value of values) id(value, `${field} item`);
  invariant(new Set(values).size === values.length, "INVALID_ARTIFACT_INSTANCE", `${field} contains duplicates.`);
  invariant(values.every((value, index) => value === [...values].sort()[index]), "INVALID_ARTIFACT_INSTANCE", `${field} must be sorted.`);
}

function hashPayload(value, hashField) {
  const payload = cloneCanonical(value);
  delete payload[hashField];
  return payload;
}

export function artifactScopeHashPayload(scope) {
  return { kind: scope.kind, scope_id: scope.scope_id };
}

export function validateArtifactScope(scope, { titleId = null } = {}) {
  exactKeys(scope, SCOPE_KEYS, "Artifact scope");
  invariant(scope.kind === "TITLE", "UNSUPPORTED_ARTIFACT_SCOPE", "v0.4 supports only explicit TITLE artifact scope.");
  id(scope.scope_id, "scope.scope_id");
  if (titleId !== null) invariant(scope.scope_id === titleId, "ARTIFACT_SCOPE_MISMATCH", "Artifact scope must match the containing title.");
  assertSha256(scope.scope_hash, "scope.scope_hash");
  invariant(timingSafeHashEqual(scope.scope_hash, hashCanonical(artifactScopeHashPayload(scope))), "ARTIFACT_SCOPE_HASH_MISMATCH", "Artifact scope hash does not match its canonical identity.");
  return scope;
}

export function dependencySnapshotHashPayload(snapshot) {
  return hashPayload(snapshot, "snapshot_hash");
}

export function validateArtifactDependencySnapshot(snapshot) {
  exactKeys(snapshot, SNAPSHOT_KEYS, "Artifact dependency snapshot");
  invariant(snapshot.schema_version === SCHEMA.artifactDependencySnapshot, "UNSUPPORTED_SCHEMA", `Unsupported artifact dependency snapshot schema: ${snapshot.schema_version}.`);
  assertSha256(snapshot.registry_hash, "snapshot.registry_hash");
  assertSha256(snapshot.graph_hash, "snapshot.graph_hash");
  id(snapshot.rules_version, "snapshot.rules_version");
  invariant(Number.isSafeInteger(snapshot.base_state_version) && snapshot.base_state_version >= 0, "INVALID_ARTIFACT_INSTANCE", "snapshot.base_state_version must be a non-negative safe integer.");
  assertSha256(snapshot.base_state_hash, "snapshot.base_state_hash");
  assertSha256(snapshot.scope_hash, "snapshot.scope_hash");
  invariant(Array.isArray(snapshot.bindings), "INVALID_ARTIFACT_INSTANCE", "snapshot.bindings must be an array.");
  let previousRuleId = "";
  for (const binding of snapshot.bindings) {
    exactKeys(binding, BINDING_KEYS, "Artifact dependency binding");
    id(binding.rule_id, "binding.rule_id");
    invariant(previousRuleId < binding.rule_id, "INVALID_ARTIFACT_INSTANCE", "Dependency bindings must be unique and sorted by rule_id.");
    previousRuleId = binding.rule_id;
    invariant(["DERIVES_EXACTLY", "DEPENDS_MATERIALLY", "SATISFIES_REQUIREMENT", "GOVERNS_GATE"].includes(binding.relation), "INVALID_ARTIFACT_INSTANCE", `Unsupported dependency relation: ${binding.relation}.`);
    invariant(typeof binding.required === "boolean", "INVALID_ARTIFACT_INSTANCE", "binding.required must be boolean.");
    invariant(["FACT", "EVIDENCE_CLASS", "ARTIFACT_TYPE"].includes(binding.source_kind), "INVALID_ARTIFACT_INSTANCE", `Unsupported dependency source kind: ${binding.source_kind}.`);
    nonemptyString(binding.source_id, "binding.source_id", 128);
    invariant(["PRESENT", "ABSENT"].includes(binding.source_state), "INVALID_ARTIFACT_INSTANCE", "binding.source_state is invalid.");
    invariant(typeof binding.source_hash === "string" && SHA_OR_ABSENT_PATTERN.test(binding.source_hash), "INVALID_ARTIFACT_INSTANCE", "binding.source_hash must be ABSENT or a lowercase SHA-256.");
    invariant((binding.source_state === "ABSENT") === (binding.source_hash === "ABSENT"), "INVALID_ARTIFACT_INSTANCE", "Absent dependency bindings must use the ABSENT hash sentinel.");
  }
  sortedUniqueIds(snapshot.unresolved_required_rule_ids, "snapshot.unresolved_required_rule_ids");
  const unresolved = snapshot.bindings.filter((binding) => binding.required && binding.source_state === "ABSENT").map((binding) => binding.rule_id);
  invariant(
    unresolved.length === snapshot.unresolved_required_rule_ids.length
      && unresolved.every((ruleId, index) => ruleId === snapshot.unresolved_required_rule_ids[index]),
    "INVALID_ARTIFACT_INSTANCE",
    "unresolved_required_rule_ids must exactly identify absent required bindings.",
  );
  assertSha256(snapshot.snapshot_hash, "snapshot.snapshot_hash");
  invariant(timingSafeHashEqual(snapshot.snapshot_hash, hashCanonical(dependencySnapshotHashPayload(snapshot))), "ARTIFACT_DEPENDENCY_SNAPSHOT_HASH_MISMATCH", "Artifact dependency snapshot hash does not match canonical bytes.");
  return snapshot;
}

export function artifactInstanceHashPayload(instance) {
  return hashPayload(instance, "instance_hash");
}

export function validateArtifactInstance(instance) {
  exactKeys(instance, INSTANCE_KEYS, "Artifact instance");
  invariant(instance.schema_version === SCHEMA.artifactInstance, "UNSUPPORTED_SCHEMA", `Unsupported artifact instance schema: ${instance.schema_version}.`);
  id(instance.instance_id, "instance.instance_id");
  id(instance.series_id, "instance.series_id");
  invariant(Number.isSafeInteger(instance.revision) && instance.revision >= 1, "INVALID_ARTIFACT_INSTANCE", "instance.revision must be a positive safe integer.");
  invariant(instance.supersedes_instance_id === null || (typeof instance.supersedes_instance_id === "string" && ID_PATTERN.test(instance.supersedes_instance_id)), "INVALID_ARTIFACT_INSTANCE", "supersedes_instance_id must be null or an identifier.");
  invariant((instance.revision === 1) === (instance.supersedes_instance_id === null), "INVALID_ARTIFACT_LINEAGE", "Revision 1 cannot supersede another instance; later revisions must.");
  id(instance.title_id, "instance.title_id");
  invariant(typeof instance.artifact_key === "string" && ARTIFACT_PATTERN.test(instance.artifact_key), "INVALID_ARTIFACT_INSTANCE", "instance.artifact_key is invalid.");
  assertSha256(instance.registry_hash, "instance.registry_hash");
  validateArtifactScope(instance.scope, { titleId: instance.title_id });
  invariant(ARTIFACT_INSTANCE_APPLICABILITY.includes(instance.applicability), "INVALID_ARTIFACT_INSTANCE", `Unsupported prospective applicability: ${instance.applicability}.`);
  invariant(instance.document_state === "PROSPECTIVE_DRAFT", "ARTIFACT_AUTHORITY_LAUNDERING", "v0.4 artifact records must remain prospective drafts.");
  invariant(instance.authority_state === "NO_EXTERNAL_AUTHORITY", "ARTIFACT_AUTHORITY_LAUNDERING", "Artifact metadata cannot grant external authority.");
  exactKeys(instance.responsibility, RESPONSIBILITY_KEYS, "Artifact responsibility");
  id(instance.responsibility.owner_actor_id, "responsibility.owner_actor_id");
  sortedUniqueIds(instance.responsibility.reviewer_actor_ids, "responsibility.reviewer_actor_ids");
  sortedUniqueIds(instance.responsibility.approver_actor_ids, "responsibility.approver_actor_ids");
  if (instance.materialization !== null) {
    exactKeys(instance.materialization, MATERIALIZATION_KEYS, "Artifact materialization");
    assertSha256(instance.materialization.candidate_blob_sha256, "materialization.candidate_blob_sha256");
    nonemptyString(instance.materialization.media_type, "materialization.media_type", 255);
    nonemptyString(instance.materialization.storage_ref, "materialization.storage_ref", 2048);
    invariant(instance.materialization.watermark === ARTIFACT_INSTANCE_WATERMARK, "ARTIFACT_AUTHORITY_LAUNDERING", `Prospective materializations must retain the ${ARTIFACT_INSTANCE_WATERMARK} watermark.`);
  }
  validateArtifactDependencySnapshot(instance.dependency_snapshot);
  invariant(timingSafeHashEqual(instance.registry_hash, instance.dependency_snapshot.registry_hash), "ARTIFACT_REGISTRY_MISMATCH", "Artifact and dependency snapshot registry hashes must match.");
  invariant(timingSafeHashEqual(instance.scope.scope_hash, instance.dependency_snapshot.scope_hash), "ARTIFACT_SCOPE_MISMATCH", "Artifact and dependency snapshot scopes must match.");
  assertSha256(instance.instance_hash, "instance.instance_hash");
  invariant(timingSafeHashEqual(instance.instance_hash, hashCanonical(artifactInstanceHashPayload(instance))), "ARTIFACT_INSTANCE_HASH_MISMATCH", "Artifact instance hash does not match canonical bytes.");
  return instance;
}

function activeEvidenceHash({ stateEnvelope, evidenceEnvelopes, evidenceClass, now }) {
  const hashes = evidenceEnvelopes
    .filter((evidence) => (
      evidence.evidence_class === evidenceClass
      && stateEnvelope.state.evidence_refs.includes(evidence.evidence_id)
      && evidence.state === "VERIFIED_CURRENT"
      && !Object.hasOwn(stateEnvelope.state.evidence_dispositions, evidence.evidence_id)
      && (evidence.expires_at_ms === null || evidence.expires_at_ms > now)
    ))
    .map((evidence) => evidence.evidence_hash)
    .sort();
  return hashes.length === 0 ? "ABSENT" : hashCanonical(hashes);
}

function artifactTypeHash(state, artifactKey) {
  if (!state.artifact_heads || !state.artifact_instances) return "ABSENT";
  const heads = Object.values(state.artifact_heads)
    .map((instanceId) => state.artifact_instances[instanceId])
    .filter((instance) => instance?.artifact_key === artifactKey)
    .map((instance) => ({
      instance_id: instance.instance_id,
      instance_hash: instance.instance_hash,
      impact_status: state.artifact_instance_impacts[instance.instance_id],
    }))
    .sort((left, right) => left.instance_id.localeCompare(right.instance_id));
  return heads.length === 0 ? "ABSENT" : hashCanonical(heads);
}

export function compileArtifactDependencySnapshot({
  stateEnvelope,
  registry,
  graph,
  artifactKey,
  scope,
  evidenceEnvelopes = [],
  now,
}) {
  invariant(Number.isSafeInteger(now) && now >= 0, "INVALID_CLOCK", "Artifact dependency snapshots require a non-negative trusted time sample.");
  invariant(Array.isArray(evidenceEnvelopes), "INVALID_ARTIFACT_INSTANCE", "evidenceEnvelopes must be an array.");
  const bindings = graph.rules
    .filter((rule) => rule.to.kind === "ARTIFACT_TYPE" && rule.to.key === artifactKey)
    .map((rule) => {
      let sourceHash = "ABSENT";
      if (rule.from.kind === "FACT" && Object.hasOwn(stateEnvelope.state.facts, rule.from.key)) {
        sourceHash = hashCanonical(stateEnvelope.state.facts[rule.from.key]);
      } else if (rule.from.kind === "EVIDENCE_CLASS") {
        sourceHash = activeEvidenceHash({ stateEnvelope, evidenceEnvelopes, evidenceClass: rule.from.key, now });
      } else if (rule.from.kind === "ARTIFACT_TYPE") {
        sourceHash = artifactTypeHash(stateEnvelope.state, rule.from.key);
      }
      return {
        rule_id: rule.rule_id,
        relation: rule.relation,
        required: rule.required,
        source_kind: rule.from.kind,
        source_id: rule.from.key,
        source_state: sourceHash === "ABSENT" ? "ABSENT" : "PRESENT",
        source_hash: sourceHash,
      };
    })
    .sort((left, right) => left.rule_id.localeCompare(right.rule_id));
  const draft = {
    schema_version: SCHEMA.artifactDependencySnapshot,
    registry_hash: registry.registry_hash,
    graph_hash: graph.graph_hash,
    rules_version: graph.rules_version,
    base_state_version: stateEnvelope.version,
    base_state_hash: stateEnvelope.state_hash,
    scope_hash: scope.scope_hash,
    bindings,
    unresolved_required_rule_ids: bindings
      .filter((binding) => binding.required && binding.source_state === "ABSENT")
      .map((binding) => binding.rule_id),
  };
  const snapshot = { ...draft, snapshot_hash: hashCanonical(draft) };
  validateArtifactDependencySnapshot(snapshot);
  return cloneCanonical(snapshot);
}

export function createArtifactInstanceRecord({
  stateEnvelope,
  registry,
  graph,
  evidenceEnvelopes = [],
  now,
  instanceId,
  seriesId = instanceId,
  artifactKey,
  ownerActorId,
  reviewerActorIds = [],
  approverActorIds = [],
  materialization = null,
}) {
  invariant(stateEnvelope.state.schema_version === SCHEMA.titleState, "STATE_SCHEMA_MIGRATION_REQUIRED", "Artifact instances require filmstack-title-state/v3.");
  id(instanceId, "instanceId");
  id(seriesId, "seriesId");
  invariant(!Object.hasOwn(stateEnvelope.state.artifact_instances, instanceId), "ARTIFACT_INSTANCE_ALREADY_EXISTS", `Artifact instance already exists: ${instanceId}.`);
  const registryRecord = registry.records.find((record) => record.artifact_key === artifactKey);
  invariant(registryRecord, "UNKNOWN_ARTIFACT_TYPE", `Artifact type is not present in the active registry: ${artifactKey}.`);
  invariant(timingSafeHashEqual(registry.registry_hash, graph.registry_hash), "REGISTRY_GRAPH_MISMATCH", "Artifact registry and dependency graph do not match.");
  const scopeDraft = { kind: "TITLE", scope_id: stateEnvelope.aggregate_id };
  const scope = { ...scopeDraft, scope_hash: hashCanonical(scopeDraft) };
  const priorId = stateEnvelope.state.artifact_heads[seriesId] ?? null;
  const prior = priorId === null ? null : stateEnvelope.state.artifact_instances[priorId];
  if (prior) {
    invariant(prior.artifact_key === artifactKey, "ARTIFACT_LINEAGE_IDENTITY_MISMATCH", "A series cannot change artifact type.");
    invariant(timingSafeHashEqual(prior.scope.scope_hash, scope.scope_hash), "ARTIFACT_LINEAGE_IDENTITY_MISMATCH", "A series cannot change scope.");
  }
  const snapshot = compileArtifactDependencySnapshot({
    stateEnvelope,
    registry,
    graph,
    artifactKey,
    scope,
    evidenceEnvelopes,
    now,
  });
  const normalizedMaterialization = materialization === null ? null : cloneCanonical({
    candidate_blob_sha256: materialization.candidate_blob_sha256,
    media_type: materialization.media_type,
    storage_ref: materialization.storage_ref,
    watermark: ARTIFACT_INSTANCE_WATERMARK,
  });
  const draft = {
    schema_version: SCHEMA.artifactInstance,
    instance_id: instanceId,
    series_id: seriesId,
    revision: prior === null ? 1 : prior.revision + 1,
    supersedes_instance_id: priorId,
    title_id: stateEnvelope.aggregate_id,
    artifact_key: artifactKey,
    registry_hash: registry.registry_hash,
    scope,
    applicability: registryRecord.default_applicability === "REQUIRED" ? "REQUIRED" : "ASSESSMENT_REQUIRED",
    document_state: "PROSPECTIVE_DRAFT",
    authority_state: "NO_EXTERNAL_AUTHORITY",
    responsibility: {
      owner_actor_id: ownerActorId,
      reviewer_actor_ids: [...reviewerActorIds].sort(),
      approver_actor_ids: [...approverActorIds].sort(),
    },
    materialization: normalizedMaterialization,
    dependency_snapshot: snapshot,
  };
  const instance = { ...draft, instance_hash: hashCanonical(draft) };
  validateArtifactInstance(instance);
  return cloneCanonical(instance);
}

export function createArtifactInstanceOperation({
  stateEnvelope,
  registry,
  graph,
  evidenceEnvelopes = [],
  now,
  opId = "record-artifact-instance",
  ...recordInput
}) {
  const instance = createArtifactInstanceRecord({
    stateEnvelope,
    registry,
    graph,
    evidenceEnvelopes,
    now,
    ...recordInput,
  });
  return {
    op_id: opId,
    kind: "RECORD_ARTIFACT_INSTANCE",
    target: instance.instance_id,
    expected_target_hash: "ABSENT",
    payload: instance,
  };
}
