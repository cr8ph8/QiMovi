import { cloneCanonical } from "./canonical-json.mjs";
import { invariant } from "./errors.mjs";
import { createSourceAdmissionOperation, createSourceAdmissionRecord } from "./source-admission.mjs";

export class SourceAdmissionEvaluator {
  #database;
  #policy;
  #clock;

  constructor({ database, policy, clock }) {
    this.#database = database;
    this.#policy = policy;
    this.#clock = clock;
    Object.freeze(this);
  }

  preview({
    admissionCandidateId,
    admissionRecordId,
    admittedByActorId,
    sourceAuthorityActorId,
    sourceAuthorityRecordId,
    sourceAuthorityRecordHash,
    intentionalExportAttestorId,
    intentionalExportAttestationId,
    intentionalExportAttestationHash,
    creativeApproverId,
    creativeApprovalId,
    creativeApprovalHash,
    titleRevisionIdentityReviewerId,
    titleRevisionIdentityRecordId,
    titleRevisionIdentityRecordHash,
    rightsControllerId,
    rightsBasisKind,
    rightsRecordId,
    rightsRecordHash,
    evidenceId,
    decisionReasonCodes,
    opId = "admit-source-revision",
  }) {
    const candidate = this.#database.getSourceAdmissionCandidate(admissionCandidateId);
    invariant(candidate, "SOURCE_ADMISSION_CANDIDATE_NOT_FOUND", `Source admission candidate does not exist: ${admissionCandidateId}.`);
    const observation = this.#database.getSourceObservation(candidate.observation_id);
    invariant(observation, "SOURCE_OBSERVATION_NOT_FOUND", `Source observation does not exist: ${candidate.observation_id}.`);
    const report = this.#database.getSourceVerificationReport(candidate.verification_report_id);
    invariant(report, "SOURCE_VERIFICATION_REPORT_NOT_FOUND", `Source verification report does not exist: ${candidate.verification_report_id}.`);
    const state = this.#database.getAggregate(candidate.title_id);
    invariant(state, "AGGREGATE_NOT_FOUND", `Aggregate not found: ${candidate.title_id}.`);
    const admittedAtMs = this.#clock();
    const record = createSourceAdmissionRecord({
      admission_record_id: admissionRecordId,
      candidate,
      observation,
      verification_report: report,
      base_state_version: state.version,
      base_state_hash: state.state_hash,
      policy_version: this.#policy.version,
      policy_hash: this.#policy.policy_hash,
      admitted_by_actor_id: admittedByActorId,
      source_authority_actor_id: sourceAuthorityActorId,
      source_authority_record_id: sourceAuthorityRecordId,
      source_authority_record_hash: sourceAuthorityRecordHash,
      intentional_export_attestor_id: intentionalExportAttestorId,
      intentional_export_attestation_id: intentionalExportAttestationId,
      intentional_export_attestation_hash: intentionalExportAttestationHash,
      creative_approver_id: creativeApproverId,
      creative_approval_id: creativeApprovalId,
      creative_approval_hash: creativeApprovalHash,
      title_revision_identity_reviewer_id: titleRevisionIdentityReviewerId,
      title_revision_identity_record_id: titleRevisionIdentityRecordId,
      title_revision_identity_record_hash: titleRevisionIdentityRecordHash,
      rights_controller_id: rightsControllerId,
      rights_basis_kind: rightsBasisKind,
      rights_record_id: rightsRecordId,
      rights_record_hash: rightsRecordHash,
      evidence_id: evidenceId,
      decision_reason_codes: decisionReasonCodes,
      admitted_at_ms: admittedAtMs,
    });
    return cloneCanonical({
      title_state: state,
      admission_record: record,
      operation: createSourceAdmissionOperation({ record, opId }),
      evaluated_at_ms: admittedAtMs,
    });
  }
}

