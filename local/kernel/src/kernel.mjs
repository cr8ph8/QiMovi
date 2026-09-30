import { cloneCanonical, hashCanonical, timingSafeHashEqual } from "./canonical-json.mjs";
import { EVIDENCE_DISPOSITIONS, RISK_TIERS, SCHEMA } from "./constants.mjs";
import {
  analyzeEvidenceDispositionOperations,
  analyzeEvidenceLinkOperations,
  approvalHashesInvalidatedByEvidenceChange,
  createEvidenceDispositionOperation,
  productionGateRecheckRequired,
  resolveEvidenceState,
} from "./evidence-lifecycle.mjs";
import {
  validateAggregateState,
  validateEvidenceEnvelope,
  validateProposal,
  validateVerifierReceipt,
} from "./contracts.mjs";
import { KernelError, invariant } from "./errors.mjs";
import { evaluateAuthority } from "./policy.mjs";
import { applyDelta, assertExpectedTargets } from "./reducer.mjs";
import { compileEffectiveProductionGate, createGateEvaluationOperation } from "./gates.mjs";
import { computeArtifactImpactReport, createArtifactImpactOperation } from "./dependency-graph.mjs";
import { createArtifactInstanceOperation } from "./artifact-instances.mjs";
import { createSourceAdmissionRecord, validateSourceAdmissionRecord } from "./source-admission.mjs";

function riskOrFallback(value) {
  return RISK_TIERS.includes(value) ? value : "R4";
}

function reasonFromError(error) {
  return error instanceof KernelError ? error.code : "KERNEL_ERROR";
}

export class TransactionKernel {
  #database;
  #kernelToken;
  #policy;
  #clock;
  #dependencyGraph;
  #artifactRegistry;

  constructor({ database, kernelToken, policy, clock, dependencyGraph = null, artifactRegistry = null }) {
    this.#database = database;
    this.#kernelToken = kernelToken;
    this.#policy = policy;
    this.#clock = clock;
    this.#dependencyGraph = dependencyGraph;
    this.#artifactRegistry = artifactRegistry;
    Object.freeze(this);
  }

  #record({
    authenticatedActorId,
    proposal,
    decision,
    reasons,
    effectiveRisk,
    receiptHashes,
    currentState,
    nextState = null,
    storeIdempotency = true,
    eventDelta = proposal.delta,
    occurredAtMs,
    sourceAdmissionRecord = null,
  }) {
    return this.#database.recordDecision(this.#kernelToken, {
      authenticatedActorId,
      proposal,
      decision,
      reasonCodes: [...new Set(reasons)].sort(),
      effectiveRisk,
      receiptHashes: [...new Set(receiptHashes)].sort(),
      currentState,
      nextState,
      occurredAtMs,
      storeIdempotency,
      eventDelta,
      sourceAdmissionRecord,
    });
  }

  #checkProposalEvidence(proposal, currentState, now) {
    const outcomes = [];
    for (const evidenceId of proposal.evidence_refs) {
      const evidence = this.#database.getEvidence(evidenceId);
      if (!evidence) {
        outcomes.push({ decision: "ESCALATE", reason: "EVIDENCE_NOT_FOUND" });
        continue;
      }
      validateEvidenceEnvelope(evidence);
      if (evidence.scope_aggregate_id !== proposal.target_aggregate_id) {
        outcomes.push({ decision: "REJECT", reason: "EVIDENCE_SCOPE_MISMATCH" });
      } else {
        const resolvedState = resolveEvidenceState(evidence, currentState.state.evidence_dispositions, now);
        if (["REJECTED", "SUPERSEDED", "REVOKED", "EXPIRED"].includes(resolvedState)) {
          outcomes.push({ decision: "REJECT", reason: `EVIDENCE_${resolvedState}` });
        } else if (resolvedState !== "VERIFIED_CURRENT") {
          outcomes.push({ decision: "ESCALATE", reason: "EVIDENCE_NOT_VERIFIED_CURRENT" });
        }
      }
    }
    return outcomes;
  }

  #checkEvidenceOperations(proposal, currentState) {
    for (const operation of proposal.delta) {
      if (operation.kind !== "LINK_EVIDENCE" && operation.kind !== "UNLINK_EVIDENCE") {
        continue;
      }
      const evidence = this.#database.getEvidence(operation.target);
      invariant(evidence, "EVIDENCE_NOT_FOUND", `Evidence does not exist: ${operation.target}.`);
      validateEvidenceEnvelope(evidence);
      invariant(evidence.scope_aggregate_id === proposal.target_aggregate_id, "EVIDENCE_SCOPE_MISMATCH", "Evidence is scoped to a different aggregate.");
      if (operation.kind === "UNLINK_EVIDENCE" && this.#policy.production_gate) {
        const gateClasses = new Set([
          ...this.#policy.production_gate.required_evidence_classes,
          this.#policy.production_gate.approval_evidence_class,
        ]);
        const issuerAllowed = (this.#policy.production_gate.issuer_allowlists[evidence.evidence_class] ?? []).includes(evidence.issuer_id);
        invariant(
          evidence.state !== "VERIFIED_CURRENT"
            || !gateClasses.has(evidence.evidence_class)
            || !issuerAllowed
            || !currentState.state.gates.production.evidence_hashes.includes(evidence.evidence_hash)
            || Object.hasOwn(currentState.state.evidence_dispositions, evidence.evidence_id),
          "GATE_EVIDENCE_UNLINK_REQUIRES_DISPOSITION",
          "Current policy-qualified gate evidence must receive a terminal disposition before it can be unlinked.",
        );
      }
    }
  }

  #checkEvidenceDispositionOperations(proposal, currentState, now) {
    const operations = proposal.delta.filter((operation) => operation.kind === "RECORD_EVIDENCE_DISPOSITION");
    if (operations.length === 0) return null;
    const allowedKinds = new Set([
      "RECORD_EVIDENCE_DISPOSITION",
      "EVALUATE_PRODUCTION_GATE",
      "APPLY_ARTIFACT_IMPACTS",
    ]);
    invariant(proposal.delta.every((operation) => allowedKinds.has(operation.kind)), "EVIDENCE_TRANSITION_MUST_BE_ISOLATED", "Evidence disposition bundles cannot contain unrelated operations.");
    return analyzeEvidenceDispositionOperations({
      stateEnvelope: currentState,
      evidenceEnvelopes: this.#database.listEvidence(proposal.target_aggregate_id),
      operations,
      policy: this.#policy,
      now,
    });
  }

  #checkGateEvaluationOperation(proposal, currentState, now, lifecycleAnalysis) {
    const operations = proposal.delta.filter((operation) => operation.kind === "EVALUATE_PRODUCTION_GATE");
    if (lifecycleAnalysis === null && operations.length === 0) {
      return;
    }
    if (lifecycleAnalysis !== null) {
      if (!this.#policy.production_gate) {
        invariant(operations.length === 0, "GATE_POLICY_MISSING", "An unconfigured gate cannot be evaluated.");
        return;
      }
      if (!lifecycleAnalysis.gate_recheck_required) {
        invariant(operations.length === 0, "UNEXPECTED_GATE_EVALUATION", "Gate-irrelevant evidence disposition cannot carry a production-gate reevaluation.");
        return;
      }
      invariant(operations.length === 1, "GATE_EVALUATION_REQUIRED", "Evidence disposition requires one atomic production-gate reevaluation.");
    } else {
      invariant(operations.length === 1 && proposal.delta.length === 1, "GATE_EVALUATION_MUST_BE_ISOLATED", "Production-gate evaluation must be isolated unless it accompanies an evidence disposition.");
    }
    const proposed = operations[0];
    const expected = createGateEvaluationOperation({
      stateEnvelope: currentState,
      evidenceEnvelopes: this.#database.listEvidence(proposal.target_aggregate_id),
      policy: this.#policy,
      now,
      dispositionOverrides: lifecycleAnalysis?.projected_dispositions ?? {},
      opId: proposed.op_id,
    });
    invariant(hashCanonical(proposed) === hashCanonical(expected), "GATE_EVALUATION_MISMATCH", "Proposed gate evaluation does not match current policy-qualified evidence.");
  }

  #checkArtifactImpactOperation(proposal, currentState, additionalTriggers = []) {
    const proposedOperations = proposal.delta.filter((operation) => operation.kind === "APPLY_ARTIFACT_IMPACTS");
    if (proposal.delta.some((operation) => operation.kind === "ADMIT_SOURCE_REVISION")) {
      invariant(proposedOperations.length === 0, "SOURCE_ADMISSION_MUST_BE_ISOLATED", "Source admission cannot carry artifact impacts; propagation is a later transaction.");
      return;
    }
    const sourceOperations = proposal.delta.filter((operation) => operation.kind !== "APPLY_ARTIFACT_IMPACTS");
    if (!this.#dependencyGraph) {
      invariant(proposedOperations.length === 0, "ARTIFACT_GRAPH_UNCONFIGURED", "Artifact impacts require an active dependency graph.");
      return;
    }

    const report = computeArtifactImpactReport({
      stateEnvelope: currentState,
      operations: sourceOperations,
      graph: this.#dependencyGraph,
      additionalTriggers,
    });
    if (report === null) {
      invariant(proposedOperations.length === 0, "UNEXPECTED_ARTIFACT_IMPACT", "Proposal includes an artifact impact without a material graph trigger.");
      return;
    }
    invariant(proposedOperations.length === 1, "ARTIFACT_IMPACT_REQUIRED", "Material source changes require one kernel-recomputed artifact impact operation.");
    const expected = createArtifactImpactOperation({
      stateEnvelope: currentState,
      operations: sourceOperations,
      graph: this.#dependencyGraph,
      additionalTriggers,
      opId: proposedOperations[0].op_id,
    });
    invariant(hashCanonical(proposedOperations[0]) === hashCanonical(expected), "ARTIFACT_IMPACT_MISMATCH", "Proposed artifact impact does not match the active registry, graph, rules, and base state.");
  }

  #checkStateSchemaOperation(proposal, currentState) {
    const migrations = proposal.delta.filter((operation) => operation.kind === "MIGRATE_TITLE_STATE");
    if (currentState.state.schema_version === SCHEMA.legacyTitleState) {
      invariant(migrations.length === 1 && proposal.delta.length === 1, "STATE_SCHEMA_MIGRATION_REQUIRED", "A v2 title state is read-only until an isolated v2-to-v3 migration commits.");
      return;
    }
    invariant(migrations.length === 0, "INVALID_STATE_MIGRATION", "The current title state is already v3.");
  }

  #checkArtifactInstanceOperation(proposal, currentState, now) {
    const operations = proposal.delta.filter((operation) => operation.kind === "RECORD_ARTIFACT_INSTANCE");
    if (operations.length === 0) return;
    invariant(this.#artifactRegistry && this.#dependencyGraph, "ARTIFACT_SYSTEM_UNCONFIGURED", "Artifact-instance recording requires an active registry and dependency graph.");
    invariant(currentState.state.schema_version === SCHEMA.titleState, "STATE_SCHEMA_MIGRATION_REQUIRED", "Artifact instances require filmstack-title-state/v3.");
    invariant(
      operations.length === 1
        && proposal.delta.every((operation) => ["RECORD_ARTIFACT_INSTANCE", "APPLY_ARTIFACT_IMPACTS"].includes(operation.kind)),
      "ARTIFACT_INSTANCE_MUST_BE_ISOLATED",
      "Artifact-instance recording may be accompanied only by its kernel-recomputed dependency impact.",
    );
    const proposed = operations[0];
    const expected = createArtifactInstanceOperation({
      stateEnvelope: currentState,
      registry: this.#artifactRegistry,
      graph: this.#dependencyGraph,
      evidenceEnvelopes: this.#database.listEvidence(proposal.target_aggregate_id),
      now,
      opId: proposed.op_id,
      instanceId: proposed.payload.instance_id,
      seriesId: proposed.payload.series_id,
      artifactKey: proposed.payload.artifact_key,
      ownerActorId: proposed.payload.responsibility.owner_actor_id,
      reviewerActorIds: proposed.payload.responsibility.reviewer_actor_ids,
      approverActorIds: proposed.payload.responsibility.approver_actor_ids,
      materialization: proposed.payload.materialization,
    });
    invariant(hashCanonical(proposed) === hashCanonical(expected), "ARTIFACT_INSTANCE_MISMATCH", "Proposed artifact instance does not match the active title, registry, graph, lineage, dependency snapshot, and prospective-only contract.");
  }

  #checkSourceAdmissionOperation(proposal, currentState, authenticatedActorId) {
    const operations = proposal.delta.filter((operation) => operation.kind === "ADMIT_SOURCE_REVISION");
    if (operations.length === 0) return null;
    invariant(operations.length === 1 && proposal.delta.length === 1, "SOURCE_ADMISSION_MUST_BE_ISOLATED", "Source admission must be the only operation in its proposal.");
    const proposed = validateSourceAdmissionRecord(operations[0].payload);
    invariant(currentState.state.schema_version === SCHEMA.titleState, "STATE_SCHEMA_MIGRATION_REQUIRED", "Source admission requires filmstack-title-state/v3.");
    invariant(!Object.hasOwn(currentState.state.facts, "source.revision"), "SOURCE_REVISION_SUPERSESSION_REQUIRED", "Source admission v1 cannot replace an existing canonical revision.");
    invariant(proposed.title_id === proposal.target_aggregate_id, "SOURCE_ADMISSION_TITLE_MISMATCH", "Source admission title must match the proposal target.");
    invariant(proposed.admitted_by_actor_id === authenticatedActorId, "SOURCE_ADMISSION_ACTOR_MISMATCH", "The admission record must identify the authenticated admitting actor.");
    invariant(proposed.base_state_version === currentState.version && proposed.base_state_hash === currentState.state_hash, "SOURCE_ADMISSION_BASE_MISMATCH", "Source admission record must bind the exact current title state.");
    invariant(proposed.policy_version === this.#policy.version && proposed.policy_hash === this.#policy.policy_hash, "SOURCE_ADMISSION_POLICY_MISMATCH", "Source admission record must bind the active policy version and hash.");
    invariant(this.#policy.operation_required_verifiers.ADMIT_SOURCE_REVISION.length > 0, "SOURCE_ADMISSION_VERIFIER_POLICY_MISSING", "Source admission policy must name at least one operation-specific control verifier.");
    invariant(proposed.admitted_at_ms === proposal.created_at_ms, "SOURCE_ADMISSION_TIME_MISMATCH", "Source admission decision time must equal the proposal creation time.");
    const candidate = this.#database.getSourceAdmissionCandidate(proposed.admission_candidate_id);
    invariant(candidate, "SOURCE_ADMISSION_CANDIDATE_NOT_FOUND", `Source admission candidate does not exist: ${proposed.admission_candidate_id}.`);
    const observation = this.#database.getSourceObservation(proposed.observation_id);
    invariant(observation, "SOURCE_OBSERVATION_NOT_FOUND", `Source observation does not exist: ${proposed.observation_id}.`);
    const report = this.#database.getSourceVerificationReport(proposed.verification_report_id);
    invariant(report, "SOURCE_VERIFICATION_REPORT_NOT_FOUND", `Source verification report does not exist: ${proposed.verification_report_id}.`);
    invariant(this.#database.getSourceAdmissionRecord(proposed.admission_record_id) === null, "SOURCE_ADMISSION_ALREADY_EXISTS", "Source admission record ID already exists.");
    invariant(this.#database.getEvidence(proposed.admitted_evidence.evidence_id) === null, "EVIDENCE_ALREADY_EXISTS", "Source admission evidence ID already exists.");
    const expected = createSourceAdmissionRecord({
      admission_record_id: proposed.admission_record_id,
      candidate,
      observation,
      verification_report: report,
      base_state_version: currentState.version,
      base_state_hash: currentState.state_hash,
      policy_version: this.#policy.version,
      policy_hash: this.#policy.policy_hash,
      admitted_by_actor_id: authenticatedActorId,
      source_authority_actor_id: proposed.source_authority_actor_id,
      source_authority_record_id: proposed.source_authority_record_id,
      source_authority_record_hash: proposed.source_authority_record_hash,
      intentional_export_attestor_id: proposed.intentional_export_attestor_id,
      intentional_export_attestation_id: proposed.intentional_export_attestation_id,
      intentional_export_attestation_hash: proposed.intentional_export_attestation_hash,
      creative_approver_id: proposed.creative_approver_id,
      creative_approval_id: proposed.creative_approval_id,
      creative_approval_hash: proposed.creative_approval_hash,
      title_revision_identity_reviewer_id: proposed.title_revision_identity_reviewer_id,
      title_revision_identity_record_id: proposed.title_revision_identity_record_id,
      title_revision_identity_record_hash: proposed.title_revision_identity_record_hash,
      rights_controller_id: proposed.rights_controller_id,
      rights_basis_kind: proposed.rights_basis_kind,
      rights_record_id: proposed.rights_record_id,
      rights_record_hash: proposed.rights_record_hash,
      evidence_id: proposed.admitted_evidence.evidence_id,
      decision_reason_codes: proposed.decision_reason_codes,
      admitted_at_ms: proposal.created_at_ms,
    });
    invariant(hashCanonical(proposed) === hashCanonical(expected), "SOURCE_ADMISSION_RECORD_MISMATCH", "Source admission record does not match trusted quarantine records, title state, policy, actor, and proof bindings.");
    return expected;
  }

  #checkReceipts({ receipts, proposal, currentState, requiredVerifiers, now }) {
    invariant(Array.isArray(receipts), "INVALID_RECEIPTS", "receipts must be an array.");
    const byVerifier = new Map();
    const receiptHashes = [];
    for (const receipt of receipts) {
      validateVerifierReceipt(receipt);
      invariant(!byVerifier.has(receipt.verifier_id), "DUPLICATE_VERIFIER_RECEIPT", `Duplicate receipt for verifier: ${receipt.verifier_id}.`);
      const trustedVersion = this.#policy.trusted_verifiers[receipt.verifier_id];
      invariant(trustedVersion, "UNTRUSTED_VERIFIER", `Untrusted verifier: ${receipt.verifier_id}.`);
      invariant(trustedVersion === receipt.verifier_version, "VERIFIER_VERSION_MISMATCH", `Unexpected verifier version for ${receipt.verifier_id}.`);
      invariant(receipt.policy_version === this.#policy.version, "POLICY_VERSION_MISMATCH", "Receipt policy version does not match the active policy.");
      invariant(timingSafeHashEqual(receipt.proposal_hash, proposal.proposal_hash), "RECEIPT_PROPOSAL_MISMATCH", "Receipt is bound to a different proposal.");
      invariant(receipt.base_state_version === currentState.version, "RECEIPT_BASE_MISMATCH", "Receipt is bound to a different state version.");
      invariant(timingSafeHashEqual(receipt.base_state_hash, currentState.state_hash), "RECEIPT_BASE_MISMATCH", "Receipt is bound to a different state hash.");
      byVerifier.set(receipt.verifier_id, receipt);
      receiptHashes.push(receipt.receipt_hash);
    }

    const missing = requiredVerifiers.filter((verifierId) => !byVerifier.has(verifierId));
    if (missing.length > 0) {
      return {
        decision: "ESCALATE",
        reasons: missing.map((verifierId) => `MISSING_VERIFIER_${verifierId.toUpperCase().replaceAll(/[^A-Z0-9]/g, "_")}`),
        receiptHashes,
      };
    }

    const requiredReceipts = requiredVerifiers.map((verifierId) => byVerifier.get(verifierId));
    const stale = requiredReceipts.filter((receipt) => receipt.issued_at_ms > now || receipt.expires_at_ms <= now);
    if (stale.length > 0) {
      return { decision: "ESCALATE", reasons: ["STALE_VERIFIER_RECEIPT"], receiptHashes };
    }
    const failed = requiredReceipts.filter((receipt) => receipt.verdict === "FAIL");
    if (failed.length > 0) {
      return {
        decision: "REJECT",
        reasons: ["VERIFIER_FAILED", ...failed.flatMap((receipt) => receipt.reason_codes)],
        receiptHashes,
      };
    }
    const rewrite = requiredReceipts.filter((receipt) => receipt.verdict === "REWRITE_REQUIRED");
    if (rewrite.length > 0) {
      return {
        decision: "REWRITE",
        reasons: ["VERIFIER_REWRITE_REQUIRED", ...rewrite.flatMap((receipt) => receipt.reason_codes)],
        receiptHashes,
      };
    }
    return { decision: "COMMIT", reasons: ["VERIFIED_COMMIT"], receiptHashes };
  }

  decide({ authenticated_actor_id: authenticatedActorId, proposal, receipts = [] }) {
    const now = this.#clock();
    // Snapshot caller-owned objects exactly once at the trust boundary. Accessors,
    // proxies, and later caller mutation must not change the bytes that validation,
    // authorization, reduction, and the audit event observe.
    proposal = cloneCanonical(proposal);
    receipts = cloneCanonical(receipts);
    let currentState = null;
    let effectiveRisk = riskOrFallback(proposal?.declared_risk);

    try {
      validateProposal(proposal);
      currentState = this.#database.getAggregate(proposal.target_aggregate_id);
      invariant(currentState, "AGGREGATE_NOT_FOUND", `Aggregate not found: ${proposal.target_aggregate_id}.`);
      validateAggregateState(currentState);
    } catch (error) {
      if (
        proposal
        && typeof proposal.target_aggregate_id === "string"
        && typeof proposal.proposal_hash === "string"
        && /^[0-9a-f]{64}$/.test(proposal.proposal_hash)
      ) {
        currentState = this.#database.getAggregate(proposal.target_aggregate_id);
      }
      if (currentState) {
        return this.#record({
          authenticatedActorId,
          proposal,
          decision: "REJECT",
          reasons: [reasonFromError(error)],
          effectiveRisk,
          receiptHashes: [],
          currentState,
          occurredAtMs: now,
          storeIdempotency: false,
          eventDelta: [],
        });
      }
      throw error;
    }

    const prior = this.#database.getIdempotency(authenticatedActorId, proposal.target_aggregate_id, proposal.idempotency_key);
    if (prior) {
      if (timingSafeHashEqual(prior.proposal_hash, proposal.proposal_hash)) {
        return { ...prior.result, idempotent_replay: true };
      }
      return this.#record({
        authenticatedActorId,
        proposal,
        decision: "REJECT",
        reasons: ["IDEMPOTENCY_CONFLICT"],
        effectiveRisk,
        receiptHashes: [],
        currentState,
        occurredAtMs: now,
        storeIdempotency: false,
      });
    }

    if (proposal.created_at_ms > now || proposal.expires_at_ms <= now) {
      return this.#record({
        authenticatedActorId,
        proposal,
        decision: "REJECT",
        reasons: [proposal.created_at_ms > now ? "PROPOSAL_NOT_YET_VALID" : "PROPOSAL_EXPIRED"],
        effectiveRisk,
        receiptHashes: [],
        currentState,
        occurredAtMs: now,
      });
    }

    try {
      const authority = evaluateAuthority({ policy: this.#policy, authenticatedActorId, proposal });
      effectiveRisk = authority.effective_risk;

      invariant(
        currentState.version === proposal.base_state_version
          && timingSafeHashEqual(currentState.state_hash, proposal.base_state_hash),
        "STALE_BASE",
        "Proposal base state no longer matches authoritative state.",
      );
      this.#checkStateSchemaOperation(proposal, currentState);
      assertExpectedTargets(currentState.state, proposal.delta);
      const sourceAdmissionRecord = this.#checkSourceAdmissionOperation(proposal, currentState, authenticatedActorId);
      this.#checkEvidenceOperations(proposal, currentState);
      const lifecycleAnalysis = this.#checkEvidenceDispositionOperations(proposal, currentState, now);
      const linkAnalysis = analyzeEvidenceLinkOperations({
        stateEnvelope: currentState,
        evidenceEnvelopes: this.#database.listEvidence(proposal.target_aggregate_id),
        operations: proposal.delta.filter((operation) => ["LINK_EVIDENCE", "UNLINK_EVIDENCE"].includes(operation.kind)),
        now,
      });
      this.#checkGateEvaluationOperation(proposal, currentState, now, lifecycleAnalysis);
      this.#checkArtifactImpactOperation(
        proposal,
        currentState,
        lifecycleAnalysis?.evidence_class_triggers ?? linkAnalysis.evidence_class_triggers,
      );
      this.#checkArtifactInstanceOperation(proposal, currentState, now);

      const evidenceOutcomes = this.#checkProposalEvidence(proposal, currentState, now);
      const evidenceRejects = evidenceOutcomes.filter((item) => item.decision === "REJECT");
      if (evidenceRejects.length > 0) {
        return this.#record({
          authenticatedActorId,
          proposal,
          decision: "REJECT",
          reasons: evidenceRejects.map((item) => item.reason),
          effectiveRisk,
          receiptHashes: [],
          currentState,
          occurredAtMs: now,
        });
      }
      const evidenceEscalations = evidenceOutcomes.filter((item) => item.decision === "ESCALATE");
      if (evidenceEscalations.length > 0) {
        return this.#record({
          authenticatedActorId,
          proposal,
          decision: "ESCALATE",
          reasons: evidenceEscalations.map((item) => item.reason),
          effectiveRisk,
          receiptHashes: [],
          currentState,
          occurredAtMs: now,
        });
      }

      const receiptDecision = this.#checkReceipts({
        receipts,
        proposal,
        currentState,
        requiredVerifiers: authority.required_verifiers,
        now,
      });
      if (receiptDecision.decision !== "COMMIT") {
        return this.#record({
          authenticatedActorId,
          proposal,
          decision: receiptDecision.decision,
          reasons: receiptDecision.reasons,
          effectiveRisk,
          receiptHashes: receiptDecision.receiptHashes,
          currentState,
          occurredAtMs: now,
        });
      }

      const nextState = applyDelta(currentState, proposal.delta);
      return this.#record({
        authenticatedActorId,
        proposal,
        decision: "COMMIT",
        reasons: receiptDecision.reasons,
        effectiveRisk,
        receiptHashes: receiptDecision.receiptHashes,
        currentState,
        nextState,
        occurredAtMs: now,
        sourceAdmissionRecord,
      });
    } catch (error) {
      const reason = reasonFromError(error);
      if (reason === "STALE_BASE_AT_COMMIT") {
        currentState = this.#database.getAggregate(proposal.target_aggregate_id);
      }
      return this.#record({
        authenticatedActorId,
        proposal,
        decision: "REJECT",
        reasons: [reason],
        effectiveRisk,
        receiptHashes: [],
        currentState,
        occurredAtMs: now,
      });
    }
  }
}

export class EvidenceIntake {
  #database;
  #evidenceToken;
  #clock;
  #mode;

  constructor({ database, evidenceToken, clock, mode = "QUARANTINE_ONLY" }) {
    this.#database = database;
    this.#evidenceToken = evidenceToken;
    this.#clock = clock;
    this.#mode = mode;
    Object.freeze(this);
  }

  append(envelope) {
    envelope = cloneCanonical(envelope);
    validateEvidenceEnvelope(envelope);
    invariant(!EVIDENCE_DISPOSITIONS.includes(envelope.state), "TERMINAL_EVIDENCE_REQUIRES_DISPOSITION", "New evidence envelopes cannot start in a terminal lifecycle disposition.");
    invariant(
      envelope.state !== "VERIFIED_CURRENT" || this.#mode === "SYNTHETIC_FIXTURE",
      "GOVERNED_EVIDENCE_ADMISSION_REQUIRED",
      "Caller-labelled VERIFIED_CURRENT evidence is disabled outside explicit synthetic fixtures; governed verification admission is not implemented yet.",
    );
    const now = this.#clock();
    invariant(envelope.observed_at_ms <= now, "EVIDENCE_OBSERVED_IN_FUTURE", "Evidence observation time cannot be in the future.");
    invariant(envelope.verified_at_ms === null || envelope.verified_at_ms <= now, "EVIDENCE_VERIFIED_IN_FUTURE", "Evidence verification time cannot be in the future.");
    return this.#database.recordEvidence(this.#evidenceToken, envelope, now);
  }

  getMode() {
    return this.#mode;
  }
}

export class EvidenceLifecycleEvaluator {
  #database;
  #policy;
  #clock;
  #dependencyGraph;

  constructor({ database, policy, clock, dependencyGraph = null }) {
    this.#database = database;
    this.#policy = policy;
    this.#clock = clock;
    this.#dependencyGraph = dependencyGraph;
    Object.freeze(this);
  }

  #bundle(stateEnvelope, evidenceEnvelopes, dispositionOperations, now) {
    const analysis = analyzeEvidenceDispositionOperations({
      stateEnvelope,
      evidenceEnvelopes,
      operations: dispositionOperations,
      policy: this.#policy,
      now,
    });
    const operations = [...dispositionOperations];
    if (this.#policy.production_gate && analysis.gate_recheck_required) {
      operations.push(createGateEvaluationOperation({
        stateEnvelope,
        evidenceEnvelopes,
        policy: this.#policy,
        now,
        dispositionOverrides: analysis.projected_dispositions,
        opId: "evaluate-production-gate",
      }));
    }
    if (this.#dependencyGraph) {
      const impact = createArtifactImpactOperation({
        stateEnvelope,
        operations: dispositionOperations,
        graph: this.#dependencyGraph,
        additionalTriggers: analysis.evidence_class_triggers,
        opId: "apply-artifact-impacts",
      });
      if (impact) operations.push(impact);
    }
    return cloneCanonical({
      evaluated_at_ms: now,
      disposition_hashes: dispositionOperations.map((operation) => operation.payload.disposition_hash).sort(),
      operations: operations.sort((left, right) => left.op_id.localeCompare(right.op_id)),
    });
  }

  previewDisposition(aggregateId, {
    evidenceId,
    disposition,
    replacementEvidenceId = null,
    effectiveAtMs = null,
    reasonCodes,
    opId = "record-evidence-disposition",
  }) {
    const now = this.#clock();
    const stateEnvelope = this.#database.getAggregate(aggregateId);
    invariant(stateEnvelope, "AGGREGATE_NOT_FOUND", `Aggregate not found: ${aggregateId}.`);
    const evidenceEnvelopes = this.#database.listEvidence(aggregateId);
    const evidence = evidenceEnvelopes.find((item) => item.evidence_id === evidenceId);
    invariant(evidence, "EVIDENCE_NOT_FOUND", `Evidence does not exist: ${evidenceId}.`);
    const replacementEvidence = replacementEvidenceId === null
      ? null
      : evidenceEnvelopes.find((item) => item.evidence_id === replacementEvidenceId);
    invariant(replacementEvidenceId === null || replacementEvidence, "REPLACEMENT_EVIDENCE_NOT_FOUND", `Replacement evidence does not exist: ${replacementEvidenceId}.`);
    const effective = effectiveAtMs ?? (disposition === "EXPIRED" ? evidence.expires_at_ms : now);
    invariant(effective !== null, "EVIDENCE_HAS_NO_EXPIRY", "Evidence without an expiry cannot receive an EXPIRED disposition.");
    const invalidatedApprovalHashes = approvalHashesInvalidatedByEvidenceChange({
      stateEnvelope,
      evidenceEnvelopes,
      evidenceId: evidence.evidence_id,
      evidenceClass: evidence.evidence_class,
      evidenceIssuerId: evidence.issuer_id,
      policy: this.#policy,
      now,
    });
    const operation = createEvidenceDispositionOperation({
      stateEnvelope,
      evidence,
      disposition,
      replacementEvidence,
      effectiveAtMs: effective,
      reasonCodes,
      policyVersion: this.#policy.version,
      invalidatedApprovalHashes,
      gateRecheckRequired: productionGateRecheckRequired({
      stateEnvelope,
      evidenceId: evidence.evidence_id,
      evidenceHash: evidence.evidence_hash,
      evidenceClass: evidence.evidence_class,
        evidenceIssuerId: evidence.issuer_id,
        invalidatedApprovalHashes,
        policy: this.#policy,
      }),
      opId,
    });
    return this.#bundle(stateEnvelope, evidenceEnvelopes, [operation], now);
  }

  previewDueExpiries(aggregateId, { limit = 62 } = {}) {
    const now = this.#clock();
    invariant(Number.isSafeInteger(limit) && limit >= 1 && limit <= 62, "INVALID_EXPIRY_LIMIT", "Expiry sweep limit must be between 1 and 62.");
    const stateEnvelope = this.#database.getAggregate(aggregateId);
    invariant(stateEnvelope, "AGGREGATE_NOT_FOUND", `Aggregate not found: ${aggregateId}.`);
    const evidenceEnvelopes = this.#database.listEvidence(aggregateId);
    const due = evidenceEnvelopes
      .filter((evidence) => (
        evidence.state === "VERIFIED_CURRENT"
        && evidence.expires_at_ms !== null
        && evidence.expires_at_ms <= now
        && !Object.hasOwn(stateEnvelope.state.evidence_dispositions, evidence.evidence_id)
      ))
      .sort((left, right) => left.expires_at_ms - right.expires_at_ms || left.evidence_id.localeCompare(right.evidence_id))
      .slice(0, limit);
    if (due.length === 0) {
      return cloneCanonical({ evaluated_at_ms: now, disposition_hashes: [], operations: [] });
    }
    const operations = due.map((evidence, index) => {
      const invalidatedApprovalHashes = approvalHashesInvalidatedByEvidenceChange({
        stateEnvelope,
        evidenceEnvelopes,
        evidenceId: evidence.evidence_id,
        evidenceClass: evidence.evidence_class,
        evidenceIssuerId: evidence.issuer_id,
        policy: this.#policy,
        now,
      });
      return createEvidenceDispositionOperation({
        stateEnvelope,
        evidence,
        disposition: "EXPIRED",
        replacementEvidence: null,
        effectiveAtMs: evidence.expires_at_ms,
        reasonCodes: ["CLOCK_EXPIRY_REACHED"],
        policyVersion: this.#policy.version,
        invalidatedApprovalHashes,
        gateRecheckRequired: productionGateRecheckRequired({
          stateEnvelope,
          evidenceId: evidence.evidence_id,
          evidenceHash: evidence.evidence_hash,
          evidenceClass: evidence.evidence_class,
          evidenceIssuerId: evidence.issuer_id,
          invalidatedApprovalHashes,
          policy: this.#policy,
        }),
        opId: `expire-${String(index).padStart(2, "0")}-${hashCanonical({ evidence_id: evidence.evidence_id, expires_at_ms: evidence.expires_at_ms }).slice(0, 24)}`,
      });
    });
    return this.#bundle(stateEnvelope, evidenceEnvelopes, operations, now);
  }
}

export class RuntimeReadModel {
  #database;

  constructor(database) {
    this.#database = database;
    Object.freeze(this);
  }

  getAggregate(aggregateId) {
    return this.#database.getAggregate(aggregateId);
  }

  getEvidence(evidenceId) {
    return this.#database.getEvidence(evidenceId);
  }

  listEvidence(aggregateId) {
    return this.#database.listEvidence(aggregateId);
  }

  listEvents() {
    return this.#database.listEvents();
  }

  getSourceAdmissionRecord(admissionRecordId) {
    return this.#database.getSourceAdmissionRecord(admissionRecordId);
  }

  listSourceAdmissionRecords(aggregateId) {
    return this.#database.listSourceAdmissionRecordsForTitle(aggregateId);
  }
}

export class GateEvaluator {
  #database;
  #policy;
  #clock;

  constructor({ database, policy, clock }) {
    this.#database = database;
    this.#policy = policy;
    this.#clock = clock;
    Object.freeze(this);
  }

  preview(aggregateId, { opId = "evaluate-production-gate" } = {}) {
    const now = this.#clock();
    const stateEnvelope = this.#database.getAggregate(aggregateId);
    invariant(stateEnvelope, "AGGREGATE_NOT_FOUND", `Aggregate not found: ${aggregateId}.`);
    return createGateEvaluationOperation({
      stateEnvelope,
      evidenceEnvelopes: this.#database.listEvidence(aggregateId),
      policy: this.#policy,
      now,
      opId,
    });
  }

  effective(aggregateId) {
    const now = this.#clock();
    const stateEnvelope = this.#database.getAggregate(aggregateId);
    invariant(stateEnvelope, "AGGREGATE_NOT_FOUND", `Aggregate not found: ${aggregateId}.`);
    return compileEffectiveProductionGate({
      stateEnvelope,
      evidenceEnvelopes: this.#database.listEvidence(aggregateId),
      policy: this.#policy,
      now,
    });
  }
}

export class ArtifactImpactEvaluator {
  #database;
  #dependencyGraph;
  #clock;

  constructor({ database, dependencyGraph, clock }) {
    this.#database = database;
    this.#dependencyGraph = dependencyGraph;
    this.#clock = clock;
    Object.freeze(this);
  }

  preview(aggregateId, { operations, additionalTriggers = [], opId = "apply-artifact-impacts" }) {
    invariant(this.#dependencyGraph, "ARTIFACT_GRAPH_UNCONFIGURED", "Artifact impact preview requires an active dependency graph.");
    invariant(Array.isArray(operations), "INVALID_DELTA", "Artifact impact preview operations must be an array.");
    const stateEnvelope = this.#database.getAggregate(aggregateId);
    invariant(stateEnvelope, "AGGREGATE_NOT_FOUND", `Aggregate not found: ${aggregateId}.`);
    const linkAnalysis = analyzeEvidenceLinkOperations({
      stateEnvelope,
      evidenceEnvelopes: this.#database.listEvidence(aggregateId),
      operations: operations.filter((operation) => ["LINK_EVIDENCE", "UNLINK_EVIDENCE"].includes(operation.kind)),
      now: this.#clock(),
    });
    const mergedTriggers = new Map();
    for (const trigger of [...linkAnalysis.evidence_class_triggers, ...additionalTriggers]) {
      const current = mergedTriggers.get(trigger.node_id);
      mergedTriggers.set(trigger.node_id, current === "LOST" || trigger.change === "LOST" ? "LOST" : "CHANGED");
    }
    return createArtifactImpactOperation({
      stateEnvelope,
      operations,
      graph: this.#dependencyGraph,
      additionalTriggers: [...mergedTriggers.entries()]
        .map(([node_id, change]) => ({ node_id, change }))
        .sort((left, right) => left.node_id.localeCompare(right.node_id)),
      opId,
    });
  }
}

export class ArtifactInstanceEvaluator {
  #database;
  #artifactRegistry;
  #dependencyGraph;
  #clock;

  constructor({ database, artifactRegistry, dependencyGraph, clock }) {
    this.#database = database;
    this.#artifactRegistry = artifactRegistry;
    this.#dependencyGraph = dependencyGraph;
    this.#clock = clock;
    Object.freeze(this);
  }

  previewRecord(aggregateId, input = {}) {
    invariant(this.#artifactRegistry && this.#dependencyGraph, "ARTIFACT_SYSTEM_UNCONFIGURED", "Artifact-instance preview requires an active registry and dependency graph.");
    const stateEnvelope = this.#database.getAggregate(aggregateId);
    invariant(stateEnvelope, "AGGREGATE_NOT_FOUND", `Aggregate not found: ${aggregateId}.`);
    const now = this.#clock();
    const recordOperation = createArtifactInstanceOperation({
      stateEnvelope,
      registry: this.#artifactRegistry,
      graph: this.#dependencyGraph,
      evidenceEnvelopes: this.#database.listEvidence(aggregateId),
      now,
      opId: input.opId ?? "record-artifact-instance",
      instanceId: input.instanceId,
      seriesId: input.seriesId ?? input.instanceId,
      artifactKey: input.artifactKey,
      ownerActorId: input.ownerActorId,
      reviewerActorIds: input.reviewerActorIds ?? [],
      approverActorIds: input.approverActorIds ?? [],
      materialization: input.materialization ?? null,
    });
    const impactOperation = createArtifactImpactOperation({
      stateEnvelope,
      operations: [recordOperation],
      graph: this.#dependencyGraph,
      opId: input.impactOpId ?? "apply-artifact-impacts",
    });
    return cloneCanonical({
      evaluated_at_ms: now,
      instance_hash: recordOperation.payload.instance_hash,
      operations: impactOperation === null
        ? [recordOperation]
        : [recordOperation, impactOperation].sort((left, right) => left.op_id.localeCompare(right.op_id)),
    });
  }
}
