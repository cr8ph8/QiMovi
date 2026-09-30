import { cloneCanonical, hashCanonical } from "./canonical-json.mjs";
import { EVIDENCE_DISPOSITIONS, OPERATION_KINDS, RISK_TIERS } from "./constants.mjs";
import { invariant } from "./errors.mjs";

const POLICY_KEYS = new Set([
  "version",
  "actors",
  "trusted_verifiers",
  "base_required_verifiers",
  "risk_required_verifiers",
  "operation_risk",
  "operation_required_verifiers",
  "production_gate",
  "policy_hash",
]);
const ACTOR_PERMISSION_KEYS = new Set([
  "aggregate_ids",
  "allowed_operations",
  "allowed_evidence_dispositions",
  "max_risk",
]);
const PRODUCTION_GATE_KEYS = new Set([
  "required_evidence_classes",
  "approval_evidence_class",
  "issuer_allowlists",
]);
const IDENTIFIER_PATTERN = /^(?!(?:__proto__|constructor|prototype|hasOwnProperty|isPrototypeOf|propertyIsEnumerable|toLocaleString|toString|valueOf|__defineGetter__|__defineSetter__|__lookupGetter__|__lookupSetter__)$)[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EVIDENCE_CLASS_PATTERN = /^[a-z][a-z0-9._:-]{0,127}$/;

function rejectUnknownKeys(value, allowedKeys, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value), "INVALID_POLICY", `${label} must be an object.`);
  const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key)).sort();
  invariant(unknown.length === 0, "INVALID_POLICY", `${label} contains unknown keys: ${unknown.join(", ")}.`, { unknown });
}

function riskIndex(risk) {
  const index = RISK_TIERS.indexOf(risk);
  invariant(index >= 0, "INVALID_RISK", `Unknown risk tier: ${risk}.`);
  return index;
}

function sortedUnique(values, label, pattern = IDENTIFIER_PATTERN) {
  invariant(Array.isArray(values), "INVALID_POLICY", `${label} must be an array.`);
  invariant(values.every((value) => typeof value === "string" && pattern.test(value)), "INVALID_POLICY", `${label} contains an invalid identifier.`);
  invariant(new Set(values).size === values.length, "INVALID_POLICY", `${label} must not contain duplicates.`);
  return [...values].sort();
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function intrinsicOperationRisk(operation) {
  if (operation.kind === "ADMIT_SOURCE_REVISION") return "R3";
  if (operation.kind === "MIGRATE_TITLE_STATE") return "R2";
  if (operation.kind === "RECORD_ARTIFACT_INSTANCE") return "R1";
  if (operation.kind === "EVALUATE_PRODUCTION_GATE" && operation.payload.status === "APPROVED") {
    return "R3";
  }
  if (operation.kind === "RECORD_EVIDENCE_DISPOSITION") {
    return operation.payload.disposition === "EXPIRED" ? "R1" : "R2";
  }
  return "R0";
}

export function createPolicy(input) {
  invariant(input && typeof input === "object" && !Array.isArray(input), "INVALID_POLICY", "Policy must be an object.");
  rejectUnknownKeys(input, POLICY_KEYS, "Policy");
  const inputSnapshot = {};
  for (const key of Object.keys(input).sort()) {
    const value = input[key];
    if (value !== undefined) inputSnapshot[key] = value;
  }
  input = cloneCanonical(inputSnapshot);
  invariant(typeof input.version === "string" && input.version.length > 0, "INVALID_POLICY", "Policy version is required.");
  invariant(input.actors && typeof input.actors === "object" && !Array.isArray(input.actors), "INVALID_POLICY", "Policy actors must be an object.");
  invariant(input.trusted_verifiers && typeof input.trusted_verifiers === "object" && !Array.isArray(input.trusted_verifiers), "INVALID_POLICY", "trusted_verifiers must be an object.");
  if (input.risk_required_verifiers !== undefined) {
    rejectUnknownKeys(input.risk_required_verifiers, new Set(RISK_TIERS), "risk_required_verifiers");
  }
  if (input.operation_risk !== undefined) {
    rejectUnknownKeys(input.operation_risk, new Set(OPERATION_KINDS), "operation_risk");
  }
  if (input.operation_required_verifiers !== undefined) {
    rejectUnknownKeys(input.operation_required_verifiers, new Set(OPERATION_KINDS), "operation_required_verifiers");
  }
  if (input.production_gate !== null && input.production_gate !== undefined) {
    rejectUnknownKeys(input.production_gate, PRODUCTION_GATE_KEYS, "production_gate");
  }

  const policy = cloneCanonical({
    version: input.version,
    actors: input.actors,
    trusted_verifiers: input.trusted_verifiers,
    base_required_verifiers: sortedUnique(input.base_required_verifiers ?? [], "base_required_verifiers"),
    risk_required_verifiers: Object.fromEntries(
      RISK_TIERS.map((risk) => [risk, sortedUnique(input.risk_required_verifiers?.[risk] ?? [], `risk_required_verifiers.${risk}`)]),
    ),
    operation_risk: Object.fromEntries(
      OPERATION_KINDS.map((kind) => [kind, input.operation_risk?.[kind] ?? "R4"]),
    ),
    operation_required_verifiers: Object.fromEntries(
      OPERATION_KINDS.map((kind) => [
        kind,
        sortedUnique(input.operation_required_verifiers?.[kind] ?? [], `operation_required_verifiers.${kind}`),
      ]),
    ),
    production_gate: input.production_gate
      ? {
          required_evidence_classes: sortedUnique(
            input.production_gate.required_evidence_classes ?? [],
            "production_gate.required_evidence_classes",
            EVIDENCE_CLASS_PATTERN,
          ),
          approval_evidence_class: input.production_gate.approval_evidence_class,
          issuer_allowlists: Object.fromEntries(
            Object.entries(input.production_gate.issuer_allowlists ?? {})
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([evidenceClass, issuers]) => [
                evidenceClass,
                sortedUnique(issuers, `production_gate.issuer_allowlists.${evidenceClass}`),
              ]),
          ),
        }
      : null,
  });

  for (const [actorId, permission] of Object.entries(policy.actors)) {
    invariant(IDENTIFIER_PATTERN.test(actorId), "INVALID_POLICY", `Invalid actor identifier: ${actorId}.`);
    rejectUnknownKeys(permission, ACTOR_PERMISSION_KEYS, `Actor permission ${actorId}`);
    invariant(Array.isArray(permission.aggregate_ids) && permission.aggregate_ids.length > 0, "INVALID_POLICY", `${actorId}.aggregate_ids must not be empty.`);
    invariant(permission.aggregate_ids.every((aggregateId) => aggregateId === "*" || (typeof aggregateId === "string" && IDENTIFIER_PATTERN.test(aggregateId))), "INVALID_POLICY", `${actorId}.aggregate_ids contains an invalid aggregate identifier.`);
    invariant(Array.isArray(permission.allowed_operations) && permission.allowed_operations.length > 0, "INVALID_POLICY", `${actorId}.allowed_operations must not be empty.`);
    invariant(permission.allowed_operations.every((kind) => OPERATION_KINDS.includes(kind)), "INVALID_POLICY", `${actorId} has an unknown operation permission.`);
    const allowedDispositions = permission.allowed_evidence_dispositions ?? [];
    invariant(Array.isArray(allowedDispositions), "INVALID_POLICY", `${actorId}.allowed_evidence_dispositions must be an array.`);
    invariant(allowedDispositions.every((value) => EVIDENCE_DISPOSITIONS.includes(value)), "INVALID_POLICY", `${actorId} has an unknown evidence disposition permission.`);
    invariant(new Set(allowedDispositions).size === allowedDispositions.length, "INVALID_POLICY", `${actorId}.allowed_evidence_dispositions must not contain duplicates.`);
    riskIndex(permission.max_risk);
  }
  for (const [verifierId, verifierVersion] of Object.entries(policy.trusted_verifiers)) {
    invariant(IDENTIFIER_PATTERN.test(verifierId), "INVALID_POLICY", `Invalid verifier identifier: ${verifierId}.`);
    invariant(typeof verifierVersion === "string" && verifierVersion.length > 0, "INVALID_POLICY", `Verifier version must be a nonempty string: ${verifierId}.`);
  }
  for (const risk of Object.values(policy.operation_risk)) {
    riskIndex(risk);
  }
  if (policy.production_gate) {
    invariant(typeof policy.production_gate.approval_evidence_class === "string" && EVIDENCE_CLASS_PATTERN.test(policy.production_gate.approval_evidence_class), "INVALID_POLICY", "production_gate.approval_evidence_class is invalid.");
    invariant(
      !policy.production_gate.required_evidence_classes.includes(policy.production_gate.approval_evidence_class),
      "INVALID_POLICY",
      "The production approval evidence class must be distinct from every required evidence class.",
    );
    const expectedGateClasses = [...new Set([
      ...policy.production_gate.required_evidence_classes,
      policy.production_gate.approval_evidence_class,
    ])].sort();
    const configuredGateClasses = Object.keys(policy.production_gate.issuer_allowlists).sort();
    invariant(
      expectedGateClasses.length === configuredGateClasses.length
        && expectedGateClasses.every((evidenceClass, index) => evidenceClass === configuredGateClasses[index]),
      "INVALID_POLICY",
      "Production-gate issuer allowlists must contain exactly the required evidence classes plus the distinct approval class.",
    );
    for (const evidenceClass of [...policy.production_gate.required_evidence_classes, policy.production_gate.approval_evidence_class]) {
      const issuers = policy.production_gate.issuer_allowlists[evidenceClass];
      invariant(Array.isArray(issuers) && issuers.length > 0, "INVALID_POLICY", `Gate evidence class has no issuer allowlist: ${evidenceClass}.`);
    }
  }
  const allRequired = new Set([
    ...policy.base_required_verifiers,
    ...Object.values(policy.risk_required_verifiers).flat(),
    ...Object.values(policy.operation_required_verifiers).flat(),
  ]);
  for (const verifierId of allRequired) {
    invariant(typeof policy.trusted_verifiers[verifierId] === "string", "INVALID_POLICY", `Required verifier is not trusted: ${verifierId}.`);
  }

  return deepFreeze({ ...policy, policy_hash: hashCanonical(policy) });
}

export function evaluateAuthority({ policy, authenticatedActorId, proposal }) {
  invariant(authenticatedActorId === proposal.actor_id, "ACTOR_ID_MISMATCH", "Authenticated actor does not match proposal actor_id.");
  const permission = policy.actors[authenticatedActorId];
  invariant(permission, "UNAUTHORIZED_ACTOR", `Actor is not authorized: ${authenticatedActorId}.`);
  invariant(permission.aggregate_ids.includes("*") || permission.aggregate_ids.includes(proposal.target_aggregate_id), "UNAUTHORIZED_TARGET", "Actor is not authorized for the target aggregate.");

  let effectiveRiskIndex = riskIndex(proposal.declared_risk);
  for (const operation of proposal.delta) {
    invariant(permission.allowed_operations.includes(operation.kind), "UNAUTHORIZED_OPERATION", `Actor is not authorized for ${operation.kind}.`);
    if (operation.kind === "RECORD_EVIDENCE_DISPOSITION") {
      invariant((permission.allowed_evidence_dispositions ?? []).includes(operation.payload.disposition), "UNAUTHORIZED_EVIDENCE_DISPOSITION", `Actor is not authorized for ${operation.payload.disposition}.`);
    }
    effectiveRiskIndex = Math.max(
      effectiveRiskIndex,
      riskIndex(policy.operation_risk[operation.kind]),
      riskIndex(intrinsicOperationRisk(operation)),
    );
  }
  invariant(effectiveRiskIndex <= riskIndex(permission.max_risk), "RISK_EXCEEDS_AUTHORITY", "Effective risk exceeds actor authority.");

  const effectiveRisk = RISK_TIERS[effectiveRiskIndex];
  const required = [...policy.base_required_verifiers];
  for (let index = 0; index <= effectiveRiskIndex; index += 1) {
    required.push(...policy.risk_required_verifiers[RISK_TIERS[index]]);
  }
  for (const operation of proposal.delta) {
    required.push(...policy.operation_required_verifiers[operation.kind]);
  }
  return {
    effective_risk: effectiveRisk,
    required_verifiers: [...new Set(required)].sort(),
  };
}
