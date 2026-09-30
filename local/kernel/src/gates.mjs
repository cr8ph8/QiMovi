import { cloneCanonical, hashCanonical } from "./canonical-json.mjs";
import { validateAggregateState, validateEvidenceEnvelope } from "./contracts.mjs";
import { mergeEvidenceDispositions, resolveEvidenceState } from "./evidence-lifecycle.mjs";
import { invariant } from "./errors.mjs";
import { validateProductionGateEvaluation } from "./gate-contract.mjs";

function blockerFor(evidenceClass) {
  return `MISSING_${evidenceClass.toUpperCase().replaceAll(/[^A-Z0-9]/g, "_")}`;
}

export function compileProductionGateEvaluation({
  stateEnvelope,
  evidenceEnvelopes,
  policy,
  now,
  dispositionOverrides = {},
}) {
  validateAggregateState(stateEnvelope);
  invariant(policy.production_gate, "GATE_POLICY_MISSING", "Policy has no production_gate configuration.");
  invariant(Number.isSafeInteger(now) && now >= 0, "INVALID_CLOCK", "Gate evaluation time must be a non-negative safe integer.");

  const linked = new Set(stateEnvelope.state.evidence_refs);
  const dispositions = mergeEvidenceDispositions(stateEnvelope.state, dispositionOverrides);
  const invalidatedApprovalHashes = new Set([
    ...stateEnvelope.state.invalidated_gate_approval_hashes,
    ...Object.values(dispositions).flatMap((disposition) => disposition.invalidated_approval_hashes),
  ]);
  const gateClasses = new Set([
    ...policy.production_gate.required_evidence_classes,
    policy.production_gate.approval_evidence_class,
  ]);
  const qualified = [];
  for (const evidence of evidenceEnvelopes) {
    validateEvidenceEnvelope(evidence);
    if (
      linked.has(evidence.evidence_id)
      && evidence.scope_aggregate_id === stateEnvelope.aggregate_id
      && gateClasses.has(evidence.evidence_class)
      && resolveEvidenceState(evidence, dispositions, now) === "VERIFIED_CURRENT"
      && (policy.production_gate.issuer_allowlists[evidence.evidence_class] ?? []).includes(evidence.issuer_id)
      && (
        evidence.evidence_class !== policy.production_gate.approval_evidence_class
        || !invalidatedApprovalHashes.has(evidence.evidence_hash)
      )
    ) {
      qualified.push(evidence);
    }
  }

  const satisfied = [...new Set(qualified.map((evidence) => evidence.evidence_class))].sort();
  const satisfiedSet = new Set(satisfied);
  const missingRequired = policy.production_gate.required_evidence_classes
    .filter((evidenceClass) => !satisfiedSet.has(evidenceClass));
  const approvalMissing = !satisfiedSet.has(policy.production_gate.approval_evidence_class);
  const blockers = missingRequired.map(blockerFor);
  if (missingRequired.length === 0 && approvalMissing) {
    blockers.push(blockerFor(policy.production_gate.approval_evidence_class));
  }
  const relevantClasses = new Set([
    ...policy.production_gate.required_evidence_classes,
    policy.production_gate.approval_evidence_class,
  ]);
  const qualifiedHashes = new Set(qualified.map((evidence) => evidence.evidence_hash));
  const priorBoundHashes = new Set(stateEnvelope.state.gates.production.evidence_hashes);
  const priorBoundLosses = evidenceEnvelopes.filter((evidence) => (
    stateEnvelope.state.gates.production.status === "APPROVED"
    && priorBoundHashes.has(evidence.evidence_hash)
    && !qualifiedHashes.has(evidence.evidence_hash)
    && linked.has(evidence.evidence_id)
    && evidence.scope_aggregate_id === stateEnvelope.aggregate_id
    && relevantClasses.has(evidence.evidence_class)
    && (policy.production_gate.issuer_allowlists[evidence.evidence_class] ?? []).includes(evidence.issuer_id)
  ));
  const revokedLosses = priorBoundLosses.filter((evidence) => dispositions[evidence.evidence_id]?.disposition === "REVOKED");
  const expiredLosses = priorBoundLosses.filter((evidence) => (
    dispositions[evidence.evidence_id]?.disposition === "EXPIRED"
    || (evidence.state === "VERIFIED_CURRENT" && evidence.expires_at_ms !== null && evidence.expires_at_ms <= now)
  ));

  let status = "BLOCKED";
  if (revokedLosses.length > 0) {
    status = "REVOKED";
    blockers.push(...revokedLosses.map((evidence) => `REVOKED_${evidence.evidence_class.toUpperCase().replaceAll(/[^A-Z0-9]/g, "_")}`));
  } else if (expiredLosses.length > 0) {
    status = "EXPIRED";
    blockers.push(...expiredLosses.map((evidence) => `EXPIRED_${evidence.evidence_class.toUpperCase().replaceAll(/[^A-Z0-9]/g, "_")}`));
  } else if (missingRequired.length === 0 && approvalMissing) {
    status = "REVIEW_REQUIRED";
  } else if (missingRequired.length === 0 && !approvalMissing) {
    status = "APPROVED";
  }
  const canonicalBlockers = [...new Set(blockers)].sort();
  const expiries = qualified
    .map((evidence) => evidence.expires_at_ms)
    .filter((expiry) => expiry !== null)
    .sort((left, right) => left - right);

  const evaluation = {
    status,
    blockers: canonicalBlockers,
    satisfied_evidence_classes: satisfied,
    evidence_hashes: qualified.map((evidence) => evidence.evidence_hash).sort(),
    policy_version: policy.version,
    policy_hash: policy.policy_hash,
    next_recheck_at_ms: expiries[0] ?? null,
  };
  validateProductionGateEvaluation(evaluation);
  return cloneCanonical(evaluation);
}

export function createGateEvaluationOperation({
  stateEnvelope,
  evidenceEnvelopes,
  policy,
  now,
  dispositionOverrides = {},
  opId = "evaluate-production-gate",
}) {
  const evaluation = compileProductionGateEvaluation({
    stateEnvelope,
    evidenceEnvelopes,
    policy,
    now,
    dispositionOverrides,
  });
  return {
    op_id: opId,
    kind: "EVALUATE_PRODUCTION_GATE",
    target: "production",
    expected_target_hash: hashCanonical(stateEnvelope.state.gates.production),
    payload: evaluation,
  };
}

export function compileEffectiveProductionGate(args) {
  const evaluation = compileProductionGateEvaluation(args);
  const invalidated = args.stateEnvelope.state.invalidations["gate:production"] !== undefined;
  const canonicalGate = args.stateEnvelope.state.gates.production;
  const canonicalStatus = canonicalGate.status;
  const policyCurrent = canonicalGate.policy_hash === args.policy.policy_hash;
  const basisCurrent = canonicalGate.evidence_hashes.length === evaluation.evidence_hashes.length
    && canonicalGate.evidence_hashes.every((evidenceHash, index) => evidenceHash === evaluation.evidence_hashes[index]);
  const authorized = canonicalStatus === "APPROVED"
    && policyCurrent
    && basisCurrent
    && !invalidated
    && evaluation.status === "APPROVED";
  const effectiveStatus = canonicalStatus === "APPROVED"
    ? (!policyCurrent || !basisCurrent || invalidated) && evaluation.status === "APPROVED"
      ? "REVIEW_REQUIRED"
      : evaluation.status
    : canonicalStatus;
  return cloneCanonical({
    canonical_status: canonicalStatus,
    effective_status: effectiveStatus,
    authorized,
    invalidated,
    policy_current: policyCurrent,
    basis_current: basisCurrent,
    evaluation,
  });
}
