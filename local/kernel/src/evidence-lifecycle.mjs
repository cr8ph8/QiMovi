import { cloneCanonical, hashCanonical, timingSafeHashEqual } from "./canonical-json.mjs";
import {
  sealEvidenceDisposition,
  validateAggregateState,
  validateEvidenceDisposition,
  validateEvidenceEnvelope,
} from "./contracts.mjs";
import { invariant } from "./errors.mjs";

function evidenceById(evidenceEnvelopes) {
  const result = new Map();
  for (const evidence of evidenceEnvelopes) {
    validateEvidenceEnvelope(evidence);
    invariant(!result.has(evidence.evidence_id), "DUPLICATE_EVIDENCE_ID", `Duplicate evidence envelope: ${evidence.evidence_id}.`);
    result.set(evidence.evidence_id, evidence);
  }
  return result;
}

function activeHashSets({ stateEnvelope, evidenceEnvelopes, dispositions, now, linkedEvidenceIds = stateEnvelope.state.evidence_refs }) {
  const linked = new Set(linkedEvidenceIds);
  const sets = new Map();
  for (const evidence of evidenceEnvelopes) {
    if (
      linked.has(evidence.evidence_id)
      && evidence.scope_aggregate_id === stateEnvelope.aggregate_id
      && evidence.state === "VERIFIED_CURRENT"
      && !Object.hasOwn(dispositions, evidence.evidence_id)
      && (evidence.expires_at_ms === null || evidence.expires_at_ms > now)
    ) {
      if (!sets.has(evidence.evidence_class)) sets.set(evidence.evidence_class, new Set());
      sets.get(evidence.evidence_class).add(evidence.evidence_hash);
    }
  }
  return sets;
}

export function approvalHashesInvalidatedByEvidenceChange({
  stateEnvelope,
  evidenceEnvelopes,
  evidenceId,
  evidenceClass,
  evidenceIssuerId,
  policy,
  now,
}) {
  validateAggregateState(stateEnvelope);
  invariant(Number.isSafeInteger(now) && now >= 0, "INVALID_CLOCK", "Approval invalidation time must be a non-negative safe integer.");
  const changedEvidence = evidenceEnvelopes.find((evidence) => evidence.evidence_id === evidenceId);
  if (
    !policy.production_gate
    || !changedEvidence
    || !stateEnvelope.state.evidence_refs.includes(evidenceId)
    || !stateEnvelope.state.gates.production.evidence_hashes.includes(changedEvidence.evidence_hash)
    || !policy.production_gate.required_evidence_classes.includes(evidenceClass)
    || !(policy.production_gate.issuer_allowlists[evidenceClass] ?? []).includes(evidenceIssuerId)
  ) {
    return [];
  }

  const approvalClass = policy.production_gate.approval_evidence_class;
  const allowedIssuers = new Set(policy.production_gate.issuer_allowlists[approvalClass] ?? []);
  const invalidated = new Set(stateEnvelope.state.invalidated_gate_approval_hashes);
  const dispositions = stateEnvelope.state.evidence_dispositions;
  const hashes = [];
  for (const evidence of evidenceEnvelopes) {
    validateEvidenceEnvelope(evidence);
    if (
      evidence.scope_aggregate_id === stateEnvelope.aggregate_id
      && evidence.evidence_class === approvalClass
      && allowedIssuers.has(evidence.issuer_id)
      && evidence.state === "VERIFIED_CURRENT"
      && !Object.hasOwn(dispositions, evidence.evidence_id)
      && (evidence.expires_at_ms === null || evidence.expires_at_ms > now)
      && !invalidated.has(evidence.evidence_hash)
    ) {
      hashes.push(evidence.evidence_hash);
    }
  }
  return [...new Set(hashes)].sort();
}

export function productionGateRecheckRequired({
  stateEnvelope,
  evidenceId,
  evidenceHash,
  evidenceClass,
  evidenceIssuerId,
  invalidatedApprovalHashes,
  policy,
}) {
  validateAggregateState(stateEnvelope);
  if (!policy.production_gate) return false;
  const relevantClasses = new Set([
    ...policy.production_gate.required_evidence_classes,
    policy.production_gate.approval_evidence_class,
  ]);
  return invalidatedApprovalHashes.length > 0
    || (
      stateEnvelope.state.evidence_refs.includes(evidenceId)
      && stateEnvelope.state.gates.production.evidence_hashes.includes(evidenceHash)
      && relevantClasses.has(evidenceClass)
      && (policy.production_gate.issuer_allowlists[evidenceClass] ?? []).includes(evidenceIssuerId)
    );
}

function sortedSet(set) {
  return [...(set ?? new Set())].sort();
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function evidenceClassTriggers(beforeSets, afterSets, affectedClasses) {
  const triggers = [];
  for (const evidenceClass of [...new Set(affectedClasses)].sort()) {
    const before = sortedSet(beforeSets.get(evidenceClass));
    const after = sortedSet(afterSets.get(evidenceClass));
    if (sameStrings(before, after)) continue;
    triggers.push({
      node_id: `evidence-class:${evidenceClass}`,
      change: after.length === 0 ? "LOST" : "CHANGED",
    });
  }
  return triggers;
}

export function analyzeEvidenceLinkOperations({
  stateEnvelope,
  evidenceEnvelopes,
  operations,
  now,
}) {
  validateAggregateState(stateEnvelope);
  invariant(Number.isSafeInteger(now) && now >= 0, "INVALID_CLOCK", "Evidence link evaluation time must be a non-negative safe integer.");
  invariant(Array.isArray(operations), "INVALID_EVIDENCE_LINK", "Evidence link operations must be an array.");
  invariant(
    operations.every((operation) => ["LINK_EVIDENCE", "UNLINK_EVIDENCE"].includes(operation.kind)),
    "INVALID_EVIDENCE_LINK",
    "Evidence link analysis accepts only LINK_EVIDENCE and UNLINK_EVIDENCE operations.",
  );
  if (operations.length === 0) return { evidence_class_triggers: [] };

  const byId = evidenceById(evidenceEnvelopes);
  const projectedLinks = new Set(stateEnvelope.state.evidence_refs);
  const affectedClasses = [];
  for (const operation of operations) {
    const evidence = byId.get(operation.target);
    invariant(evidence, "EVIDENCE_NOT_FOUND", `Evidence does not exist: ${operation.target}.`);
    invariant(evidence.scope_aggregate_id === stateEnvelope.aggregate_id, "EVIDENCE_SCOPE_MISMATCH", "Evidence is scoped to another aggregate.");
    affectedClasses.push(evidence.evidence_class);
    if (operation.kind === "LINK_EVIDENCE") {
      invariant(!projectedLinks.has(operation.target), "TARGET_ALREADY_EXISTS", `Evidence is already linked: ${operation.target}.`);
      projectedLinks.add(operation.target);
    } else {
      invariant(projectedLinks.has(operation.target), "MISSING_TARGET", `Evidence is not linked: ${operation.target}.`);
      projectedLinks.delete(operation.target);
    }
  }

  const beforeSets = activeHashSets({
    stateEnvelope,
    evidenceEnvelopes,
    dispositions: stateEnvelope.state.evidence_dispositions,
    now,
  });
  const afterSets = activeHashSets({
    stateEnvelope,
    evidenceEnvelopes,
    dispositions: stateEnvelope.state.evidence_dispositions,
    now,
    linkedEvidenceIds: [...projectedLinks],
  });
  return cloneCanonical({
    evidence_class_triggers: evidenceClassTriggers(beforeSets, afterSets, affectedClasses),
  });
}

export function mergeEvidenceDispositions(state, overrides = {}) {
  const merged = cloneCanonical(state.evidence_dispositions);
  for (const [evidenceId, disposition] of Object.entries(overrides)) {
    validateEvidenceDisposition(disposition);
    invariant(disposition.evidence_id === evidenceId, "EVIDENCE_DISPOSITION_ID_MISMATCH", "Disposition override key must match evidence_id.");
    merged[evidenceId] = cloneCanonical(disposition);
  }
  return merged;
}

export function resolveEvidenceState(evidence, dispositions, now) {
  validateEvidenceEnvelope(evidence);
  invariant(Number.isSafeInteger(now) && now >= 0, "INVALID_CLOCK", "Evidence resolution time must be a non-negative safe integer.");
  const disposition = dispositions[evidence.evidence_id];
  if (disposition) {
    validateEvidenceDisposition(disposition);
    invariant(timingSafeHashEqual(disposition.evidence_hash, evidence.evidence_hash), "EVIDENCE_DISPOSITION_BINDING_MISMATCH", "Disposition is bound to different evidence bytes.");
    return disposition.disposition;
  }
  if (evidence.state === "VERIFIED_CURRENT" && evidence.expires_at_ms !== null && evidence.expires_at_ms <= now) {
    return "EXPIRED";
  }
  return evidence.state;
}

export function createEvidenceDispositionOperation({
  stateEnvelope,
  evidence,
  disposition,
  replacementEvidence = null,
  effectiveAtMs,
  reasonCodes,
  policyVersion,
  invalidatedApprovalHashes = [],
  gateRecheckRequired = false,
  opId,
}) {
  validateAggregateState(stateEnvelope);
  validateEvidenceEnvelope(evidence);
  const payload = sealEvidenceDisposition({
    evidence_id: evidence.evidence_id,
    evidence_hash: evidence.evidence_hash,
    evidence_class: evidence.evidence_class,
    scope_aggregate_id: evidence.scope_aggregate_id,
    from_state: "VERIFIED_CURRENT",
    disposition,
    replacement_evidence_id: replacementEvidence?.evidence_id ?? null,
    replacement_evidence_hash: replacementEvidence?.evidence_hash ?? null,
    invalidated_approval_hashes: invalidatedApprovalHashes,
    gate_recheck_required: gateRecheckRequired,
    effective_at_ms: effectiveAtMs,
    reason_codes: reasonCodes,
    policy_version: policyVersion,
  });
  const existing = stateEnvelope.state.evidence_dispositions[evidence.evidence_id];
  return {
    op_id: opId,
    kind: "RECORD_EVIDENCE_DISPOSITION",
    target: evidence.evidence_id,
    expected_target_hash: existing ? hashCanonical(existing) : "ABSENT",
    payload,
  };
}

export function analyzeEvidenceDispositionOperations({
  stateEnvelope,
  evidenceEnvelopes,
  operations,
  policy,
  now,
}) {
  validateAggregateState(stateEnvelope);
  invariant(Number.isSafeInteger(now) && now >= 0, "INVALID_CLOCK", "Evidence lifecycle evaluation time must be a non-negative safe integer.");
  invariant(Array.isArray(operations) && operations.length > 0, "INVALID_EVIDENCE_TRANSITION", "At least one evidence disposition operation is required.");
  invariant(operations.every((operation) => operation.kind === "RECORD_EVIDENCE_DISPOSITION"), "INVALID_EVIDENCE_TRANSITION", "Lifecycle analysis accepts only evidence disposition operations.");
  if (operations.length > 1) {
    invariant(operations.every((operation) => operation.payload.disposition === "EXPIRED"), "EVIDENCE_TRANSITION_MUST_BE_ISOLATED", "Only deterministic expiry dispositions may be batched.");
  }

  const byId = evidenceById(evidenceEnvelopes);
  const currentDispositions = stateEnvelope.state.evidence_dispositions;
  const projectedDispositions = cloneCanonical(currentDispositions);
  const transitionTargets = new Set(operations.map((operation) => operation.target));

  for (const operation of operations) {
    const disposition = operation.payload;
    validateEvidenceDisposition(disposition);
    invariant(disposition.evidence_id === operation.target, "EVIDENCE_DISPOSITION_ID_MISMATCH", "Disposition target does not match evidence_id.");
    invariant(disposition.scope_aggregate_id === stateEnvelope.aggregate_id, "EVIDENCE_SCOPE_MISMATCH", "Disposition is scoped to another aggregate.");
    invariant(disposition.policy_version === policy.version, "POLICY_VERSION_MISMATCH", "Disposition policy version does not match the active policy.");
    invariant(!Object.hasOwn(currentDispositions, operation.target), "EVIDENCE_ALREADY_DISPOSED", `Evidence already has a terminal disposition: ${operation.target}.`);

    const evidence = byId.get(operation.target);
    invariant(evidence, "EVIDENCE_NOT_FOUND", `Evidence does not exist: ${operation.target}.`);
    invariant(evidence.scope_aggregate_id === stateEnvelope.aggregate_id, "EVIDENCE_SCOPE_MISMATCH", "Evidence is scoped to another aggregate.");
    invariant(evidence.state === "VERIFIED_CURRENT", "INVALID_EVIDENCE_TRANSITION", "Only VERIFIED_CURRENT evidence may receive a terminal disposition.");
    invariant(timingSafeHashEqual(evidence.evidence_hash, disposition.evidence_hash), "EVIDENCE_DISPOSITION_BINDING_MISMATCH", "Disposition is bound to different evidence bytes.");
    invariant(evidence.evidence_class === disposition.evidence_class, "EVIDENCE_CLASS_MISMATCH", "Disposition evidence class does not match the envelope.");
    const expectedInvalidatedApprovalHashes = approvalHashesInvalidatedByEvidenceChange({
      stateEnvelope,
      evidenceEnvelopes,
      evidenceId: evidence.evidence_id,
      evidenceClass: evidence.evidence_class,
      evidenceIssuerId: evidence.issuer_id,
      policy,
      now,
    });
    invariant(
      sameStrings(disposition.invalidated_approval_hashes, expectedInvalidatedApprovalHashes),
      "APPROVAL_INVALIDATION_MISMATCH",
      "Disposition approval invalidations do not match the current policy-qualified approval set.",
    );
    const expectedGateRecheck = productionGateRecheckRequired({
      stateEnvelope,
      evidenceId: evidence.evidence_id,
      evidenceHash: evidence.evidence_hash,
      evidenceClass: evidence.evidence_class,
      evidenceIssuerId: evidence.issuer_id,
      invalidatedApprovalHashes: expectedInvalidatedApprovalHashes,
      policy,
    });
    invariant(disposition.gate_recheck_required === expectedGateRecheck, "GATE_RECHECK_MISMATCH", "Disposition gate recheck flag does not match current policy and linkage.");
    if (disposition.disposition === "EXPIRED") {
      invariant(evidence.expires_at_ms !== null, "EVIDENCE_HAS_NO_EXPIRY", "Evidence without an expiry cannot be expired by the clock.");
      invariant(now >= evidence.expires_at_ms, "EVIDENCE_NOT_DUE", "Evidence has not reached its expiry time.");
      invariant(disposition.effective_at_ms === evidence.expires_at_ms, "EXPIRY_TIME_MISMATCH", "Expiry disposition must take effect at the envelope expiry time.");
    } else {
      invariant(disposition.effective_at_ms <= now, "EVIDENCE_TRANSITION_NOT_YET_EFFECTIVE", "Evidence disposition cannot take effect in the future.");
      invariant(evidence.expires_at_ms === null || evidence.expires_at_ms > now, "EVIDENCE_ALREADY_EXPIRED", "Expired evidence must use the EXPIRED disposition.");
    }

    if (disposition.disposition === "SUPERSEDED") {
      invariant(!transitionTargets.has(disposition.replacement_evidence_id), "INVALID_REPLACEMENT_EVIDENCE", "A replacement cannot receive a disposition in the same transaction.");
      const replacement = byId.get(disposition.replacement_evidence_id);
      invariant(replacement, "REPLACEMENT_EVIDENCE_NOT_FOUND", `Replacement evidence does not exist: ${disposition.replacement_evidence_id}.`);
      invariant(replacement.evidence_id !== evidence.evidence_id, "INVALID_REPLACEMENT_EVIDENCE", "Evidence cannot supersede itself.");
      invariant(replacement.scope_aggregate_id === evidence.scope_aggregate_id, "REPLACEMENT_SCOPE_MISMATCH", "Replacement evidence is scoped to another aggregate.");
      invariant(replacement.evidence_class === evidence.evidence_class, "REPLACEMENT_CLASS_MISMATCH", "Replacement evidence has another evidence class.");
      invariant(replacement.state === "VERIFIED_CURRENT", "REPLACEMENT_NOT_VERIFIED_CURRENT", "Replacement evidence must be VERIFIED_CURRENT.");
      invariant(!Object.hasOwn(currentDispositions, replacement.evidence_id), "REPLACEMENT_ALREADY_DISPOSED", "Replacement evidence already has a terminal disposition.");
      invariant(replacement.expires_at_ms === null || replacement.expires_at_ms > now, "REPLACEMENT_EXPIRED", "Replacement evidence is expired.");
      invariant(timingSafeHashEqual(replacement.evidence_hash, disposition.replacement_evidence_hash), "REPLACEMENT_HASH_MISMATCH", "Replacement hash does not match the admitted envelope.");
    }

    projectedDispositions[operation.target] = cloneCanonical(disposition);
  }

  const beforeSets = activeHashSets({
    stateEnvelope,
    evidenceEnvelopes,
    dispositions: currentDispositions,
    now,
  });
  // At the exact clock boundary, due evidence has already stopped qualifying. Add it
  // back to the before-set so the explicit expiry transaction records the loss.
  const linked = new Set(stateEnvelope.state.evidence_refs);
  for (const operation of operations) {
    if (operation.payload.disposition !== "EXPIRED" || !linked.has(operation.target)) continue;
    const evidence = byId.get(operation.target);
    if (!beforeSets.has(evidence.evidence_class)) beforeSets.set(evidence.evidence_class, new Set());
    beforeSets.get(evidence.evidence_class).add(evidence.evidence_hash);
  }
  const afterSets = activeHashSets({
    stateEnvelope,
    evidenceEnvelopes,
    dispositions: projectedDispositions,
    now,
  });

  const affectedClasses = operations.map((operation) => operation.payload.evidence_class);
  const classTriggers = evidenceClassTriggers(beforeSets, afterSets, affectedClasses);
  const gateRecheckRequired = operations.some((operation) => operation.payload.gate_recheck_required);

  return cloneCanonical({
    projected_dispositions: projectedDispositions,
    evidence_class_triggers: classTriggers,
    gate_recheck_required: gateRecheckRequired,
  });
}
