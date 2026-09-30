import { cloneCanonical } from "./canonical-json.mjs";
import { invariant } from "./errors.mjs";
import {
  SOURCE_INTAKE_MODES,
  createSourceAdmissionCandidate,
  createSourceVerificationReport,
  readStableSourceFile,
  sealSourceObservation,
} from "./source-intake.mjs";

export class SourceIntakeService {
  #database;
  #sourceIntakeToken;
  #clock;
  #mode;

  constructor({ database, sourceIntakeToken, clock, mode = "STANDARD" }) {
    invariant(SOURCE_INTAKE_MODES.includes(mode), "INVALID_SOURCE_INTAKE_MODE", `Unknown source-intake mode: ${mode}.`);
    this.#database = database;
    this.#sourceIntakeToken = sourceIntakeToken;
    this.#clock = clock;
    this.#mode = mode;
    Object.freeze(this);
  }

  async observeFile({
    filePath,
    observationId,
    intakeCaseId,
    sourceKindClaim,
    claimedCustodianId,
    declaredFormat,
    maxBytes,
  }) {
    const source = await readStableSourceFile(filePath, maxBytes === undefined ? {} : { maxBytes });
    const observedAtMs = this.#clock();
    const observation = sealSourceObservation({
      observation_id: observationId,
      intake_case_id: intakeCaseId,
      source_bytes: source.bytes,
      source_kind_claim: sourceKindClaim,
      claimed_custodian_id: claimedCustodianId,
      original_filename: source.presented_filename,
      declared_format: declaredFormat,
      observed_at_ms: observedAtMs,
    });
    return this.#database.recordSourceObservation(
      this.#sourceIntakeToken,
      { observation, blob: source.bytes },
      observedAtMs,
    );
  }

  verifyObservation({
    observationId,
    verificationReportId,
    expectedBlobSha256 = null,
  }) {
    const observation = this.#database.getSourceObservation(observationId);
    invariant(observation, "SOURCE_OBSERVATION_NOT_FOUND", `Source observation does not exist: ${observationId}.`);
    const storedBlob = this.#database.getSourceBlob(observation.blob_sha256);
    invariant(storedBlob, "SOURCE_BLOB_NOT_FOUND", `Quarantined source blob does not exist: ${observation.blob_sha256}.`);
    const verifiedAtMs = this.#clock();
    const report = createSourceVerificationReport({
      observation,
      source_bytes: storedBlob.bytes,
      verification_report_id: verificationReportId,
      expected_blob_sha256: expectedBlobSha256,
      verified_at_ms: verifiedAtMs,
    });
    return this.#database.recordSourceVerificationReport(
      this.#sourceIntakeToken,
      report,
      verifiedAtMs,
    );
  }

  createAdmissionCandidate({
    observationId,
    verificationReportId,
    admissionCandidateId,
    titleId,
    proposedRevisionId,
    sourceTitleClaim,
  }) {
    const title = this.#database.getAggregate(titleId);
    invariant(title, "AGGREGATE_NOT_FOUND", `A stable title aggregate is required before source admission can be proposed: ${titleId}.`);
    const observation = this.#database.getSourceObservation(observationId);
    invariant(observation, "SOURCE_OBSERVATION_NOT_FOUND", `Source observation does not exist: ${observationId}.`);
    const report = this.#database.getSourceVerificationReport(verificationReportId);
    invariant(report, "SOURCE_VERIFICATION_REPORT_NOT_FOUND", `Source verification report does not exist: ${verificationReportId}.`);
    const createdAtMs = this.#clock();
    const candidate = createSourceAdmissionCandidate({
      observation,
      verification_report: report,
      admission_candidate_id: admissionCandidateId,
      title_id: titleId,
      proposed_revision_id: proposedRevisionId,
      source_title_claim: sourceTitleClaim,
      created_at_ms: createdAtMs,
      mode: this.#mode,
    });
    return this.#database.recordSourceAdmissionCandidate(
      this.#sourceIntakeToken,
      candidate,
      createdAtMs,
    );
  }

  getMode() {
    return this.#mode;
  }

  getObservation(observationId) {
    return this.#database.getSourceObservation(observationId);
  }

  getVerificationReport(verificationReportId) {
    return this.#database.getSourceVerificationReport(verificationReportId);
  }

  getAdmissionCandidate(admissionCandidateId) {
    return this.#database.getSourceAdmissionCandidate(admissionCandidateId);
  }

  listObservations(intakeCaseId) {
    return cloneCanonical(this.#database.listSourceObservations(intakeCaseId));
  }

  listVerificationReports(observationId) {
    return cloneCanonical(this.#database.listSourceVerificationReports(observationId));
  }

  listAdmissionCandidates(intakeCaseId) {
    return cloneCanonical(this.#database.listSourceAdmissionCandidates(intakeCaseId));
  }
}
