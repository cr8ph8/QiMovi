import {
  assertSha256,
  cloneCanonical,
  hashCanonical,
  timingSafeHashEqual,
} from "./canonical-json.mjs";
import { sealEvidenceEnvelope, validateEvidenceEnvelope } from "./contracts.mjs";
import { invariant } from "./errors.mjs";
import {
  validateSourceAdmissionCandidate,
  validateSourceObservation,
  validateSourceVerificationReport,
} from "./source-intake.mjs";

export const SOURCE_ADMISSION_RECORD_SCHEMA_VERSION = "filmstack-source-admission-record/v1";
export const SOURCE_REVISION_SCHEMA_VERSION = "filmstack-source-revision/v1";

const ID_PATTERN = /^(?!(?:__proto__|constructor|prototype|hasOwnProperty|isPrototypeOf|propertyIsEnumerable|toLocaleString|toString|valueOf|__defineGetter__|__defineSetter__|__lookupGetter__|__lookupSetter__)$)[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RIGHTS_BASIS_KINDS = Object.freeze([
  "AUTHORSHIP_ASSERTION",
  "SIGNED_ASSIGNMENT",
  "LICENSE",
  "PUBLIC_DOMAIN",
  "OTHER",
]);
const SOURCE_REVISION_KEYS = new Set([
  "schema_version",
  "revision_id",
  "source_title",
  "declared_format",
  "blob_sha256",
  "byte_length",
  "evidence_id",
  "evidence_hash",
  "admission_candidate_id",
  "admission_record_id",
  "admission_record_hash",
  "admitted_at_ms",
]);
const RECORD_KEYS = new Set([
  "schema_version",
  "admission_record_id",
  "admission_record_hash",
  "admission_candidate_id",
  "admission_candidate_hash",
  "observation_id",
  "observation_hash",
  "verification_report_id",
  "verification_report_hash",
  "blob_sha256",
  "byte_length",
  "title_id",
  "base_state_version",
  "base_state_hash",
  "policy_version",
  "policy_hash",
  "revision_id",
  "source_title",
  "declared_format",
  "admitted_by_actor_id",
  "source_authority_actor_id",
  "source_authority_record_id",
  "source_authority_record_hash",
  "intentional_export_attestor_id",
  "intentional_export_attestation_id",
  "intentional_export_attestation_hash",
  "creative_approver_id",
  "creative_approval_id",
  "creative_approval_hash",
  "title_revision_identity_reviewer_id",
  "title_revision_identity_record_id",
  "title_revision_identity_record_hash",
  "rights_controller_id",
  "rights_basis_kind",
  "rights_record_id",
  "rights_record_hash",
  "admitted_evidence",
  "decision",
  "decision_reason_codes",
  "decision_state",
  "production_gate_effect",
  "admitted_at_ms",
]);
const RECORD_INPUT_KEYS = new Set([
  "admission_record_id",
  "candidate",
  "observation",
  "verification_report",
  "base_state_version",
  "base_state_hash",
  "policy_version",
  "policy_hash",
  "admitted_by_actor_id",
  "source_authority_actor_id",
  "source_authority_record_id",
  "source_authority_record_hash",
  "intentional_export_attestor_id",
  "intentional_export_attestation_id",
  "intentional_export_attestation_hash",
  "creative_approver_id",
  "creative_approval_id",
  "creative_approval_hash",
  "title_revision_identity_reviewer_id",
  "title_revision_identity_record_id",
  "title_revision_identity_record_hash",
  "rights_controller_id",
  "rights_basis_kind",
  "rights_record_id",
  "rights_record_hash",
  "evidence_id",
  "decision_reason_codes",
  "admitted_at_ms",
]);

function exactKeys(value, keys, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value), "INVALID_SOURCE_ADMISSION_CONTRACT", `${label} must be an object.`);
  const actual = Object.keys(value);
  const unknown = actual.filter((key) => !keys.has(key)).sort();
  const missing = [...keys].filter((key) => !(key in value)).sort();
  invariant(unknown.length === 0, "UNKNOWN_FIELDS", `${label} has unknown fields: ${unknown.join(", ")}.`, { unknown });
  invariant(missing.length === 0, "MISSING_FIELDS", `${label} is missing fields: ${missing.join(", ")}.`, { missing });
}

function identifier(value, field) {
  invariant(typeof value === "string" && ID_PATTERN.test(value), "INVALID_ID", `${field} is not a safe identifier.`);
}

function nonemptyTrimmedText(value, field, maxLength) {
  invariant(
    typeof value === "string" && value.length > 0 && value.length <= maxLength && value.trim() === value,
    "INVALID_STRING",
    `${field} must be non-empty, trimmed text of at most ${maxLength} characters.`,
  );
}

function safeNonnegativeInteger(value, field) {
  invariant(Number.isSafeInteger(value) && value >= 0, "INVALID_INTEGER", `${field} must be a non-negative safe integer.`);
}

function sortedReasonCodes(value) {
  invariant(Array.isArray(value) && value.length > 0, "INVALID_REASON_CODES", "decision_reason_codes must be a non-empty array.");
  for (const reason of value) identifier(reason, "decision_reason_codes item");
  invariant(new Set(value).size === value.length, "DUPLICATE_VALUE", "decision_reason_codes must not contain duplicates.");
  const sorted = [...value].sort();
  invariant(value.every((reason, index) => reason === sorted[index]), "NON_CANONICAL_ORDER", "decision_reason_codes must be sorted.");
  return sorted;
}

function recordHashPayload(record) {
  const payload = cloneCanonical(record);
  delete payload.admission_record_hash;
  return payload;
}

export function validateSourceAdmissionRecord(value) {
  const record = cloneCanonical(value);
  exactKeys(record, RECORD_KEYS, "Source admission record");
  invariant(record.schema_version === SOURCE_ADMISSION_RECORD_SCHEMA_VERSION, "UNSUPPORTED_SCHEMA", `schema_version must equal ${SOURCE_ADMISSION_RECORD_SCHEMA_VERSION}.`);
  for (const field of [
    "admission_record_id",
    "admission_candidate_id",
    "observation_id",
    "verification_report_id",
    "title_id",
    "revision_id",
    "admitted_by_actor_id",
    "source_authority_actor_id",
    "source_authority_record_id",
    "intentional_export_attestor_id",
    "intentional_export_attestation_id",
    "creative_approver_id",
    "creative_approval_id",
    "title_revision_identity_reviewer_id",
    "title_revision_identity_record_id",
    "rights_controller_id",
    "rights_record_id",
  ]) identifier(record[field], field);
  for (const field of [
    "admission_candidate_hash",
    "observation_hash",
    "verification_report_hash",
    "blob_sha256",
    "source_authority_record_hash",
    "intentional_export_attestation_hash",
    "creative_approval_hash",
    "title_revision_identity_record_hash",
    "rights_record_hash",
    "admission_record_hash",
  ]) assertSha256(record[field], field);
  safeNonnegativeInteger(record.byte_length, "byte_length");
  invariant(record.byte_length > 0, "INVALID_SOURCE_SIZE", "byte_length must be greater than zero.");
  safeNonnegativeInteger(record.base_state_version, "base_state_version");
  assertSha256(record.base_state_hash, "base_state_hash");
  identifier(record.policy_version, "policy_version");
  assertSha256(record.policy_hash, "policy_hash");
  nonemptyTrimmedText(record.source_title, "source_title", 512);
  invariant(["FDX", "FOUNTAIN", "PDF", "DOCX", "TXT", "RTF", "OTHER"].includes(record.declared_format), "INVALID_SOURCE_FORMAT", "declared_format is not supported.");
  invariant(RIGHTS_BASIS_KINDS.includes(record.rights_basis_kind), "INVALID_RIGHTS_BASIS", "rights_basis_kind is not supported.");
  validateEvidenceEnvelope(record.admitted_evidence);
  invariant(record.admitted_evidence.evidence_class === "source_revision", "INVALID_EVIDENCE_CLASS", "Source admission must create source_revision evidence.");
  invariant(record.admitted_evidence.state === "VERIFIED_CURRENT", "INVALID_EVIDENCE_STATE", "Admitted source evidence must be VERIFIED_CURRENT.");
  invariant(record.admitted_evidence.blob_sha256 === record.blob_sha256, "SOURCE_ADMISSION_EVIDENCE_MISMATCH", "Admitted evidence must identify the exact source bytes.");
  invariant(record.admitted_evidence.scope_aggregate_id === record.title_id, "SOURCE_ADMISSION_EVIDENCE_MISMATCH", "Admitted evidence must be scoped to the admitted title.");
  invariant(record.admitted_evidence.issuer_id === record.source_authority_actor_id, "SOURCE_ADMISSION_EVIDENCE_MISMATCH", "Admitted evidence issuer must be the reviewed source authority.");
  invariant(record.admitted_evidence.expires_at_ms === null, "INVALID_SOURCE_EXPIRY", "A source revision does not silently expire; supersession or revocation requires a separate transaction.");
  invariant(record.decision === "ADMIT", "INVALID_SOURCE_ADMISSION_DECISION", "A committed source admission record must carry the ADMIT decision.");
  sortedReasonCodes(record.decision_reason_codes);
  invariant(record.decision_state === "ADMITTED", "AUTHORITY_LAUNDERING", "A committed source admission record must be ADMITTED.");
  invariant(record.production_gate_effect === "NONE", "AUTHORITY_LAUNDERING", "Source admission cannot change the production gate.");
  safeNonnegativeInteger(record.admitted_at_ms, "admitted_at_ms");
  invariant(record.admitted_evidence.verified_at_ms === record.admitted_at_ms, "SOURCE_ADMISSION_EVIDENCE_MISMATCH", "Evidence verification time must equal the admission decision time.");
  invariant(
    timingSafeHashEqual(hashCanonical(recordHashPayload(record)), record.admission_record_hash),
    "SOURCE_ADMISSION_RECORD_HASH_MISMATCH",
    "admission_record_hash does not match the canonical admission record.",
  );
  return record;
}

export function createSourceAdmissionRecord(input) {
  exactKeys(input, RECORD_INPUT_KEYS, "Source admission record input");
  const candidate = validateSourceAdmissionCandidate(input.candidate);
  const observation = validateSourceObservation(input.observation);
  const report = validateSourceVerificationReport(input.verification_report);
  invariant(candidate.source_kind_claim === "INTENTIONAL_EXPORT", "SOURCE_NOT_ADMISSION_ELIGIBLE", "Only an intentional export can enter the governed real-source admission path.");
  invariant(candidate.intake_mode === "STANDARD", "SOURCE_INTAKE_MODE_MISMATCH", "Real source admission requires STANDARD intake mode.");
  invariant(report.technical_result === "PASS", "SOURCE_VERIFICATION_REQUIRED", "Source admission requires a technical PASS.");
  invariant(
    candidate.observation_id === observation.observation_id
      && candidate.observation_hash === observation.observation_hash
      && candidate.verification_report_id === report.verification_report_id
      && candidate.verification_report_hash === report.verification_report_hash
      && candidate.blob_sha256 === observation.blob_sha256
      && candidate.blob_sha256 === report.blob_sha256
      && candidate.byte_length === observation.byte_length
      && candidate.byte_length === report.byte_length,
    "SOURCE_CROSS_BINDING_MISMATCH",
    "Candidate, observation, and technical report must identify the same exact source bytes.",
  );
  for (const field of [
    "admission_record_id",
    "admitted_by_actor_id",
    "source_authority_actor_id",
    "source_authority_record_id",
    "intentional_export_attestor_id",
    "intentional_export_attestation_id",
    "creative_approver_id",
    "creative_approval_id",
    "title_revision_identity_reviewer_id",
    "title_revision_identity_record_id",
    "rights_controller_id",
    "rights_record_id",
    "evidence_id",
  ]) identifier(input[field], field);
  for (const field of [
    "source_authority_record_hash",
    "intentional_export_attestation_hash",
    "creative_approval_hash",
    "title_revision_identity_record_hash",
    "rights_record_hash",
  ]) assertSha256(input[field], field);
  invariant(RIGHTS_BASIS_KINDS.includes(input.rights_basis_kind), "INVALID_RIGHTS_BASIS", "rights_basis_kind is not supported.");
  safeNonnegativeInteger(input.base_state_version, "base_state_version");
  assertSha256(input.base_state_hash, "base_state_hash");
  identifier(input.policy_version, "policy_version");
  assertSha256(input.policy_hash, "policy_hash");
  const decisionReasonCodes = [...input.decision_reason_codes].sort();
  sortedReasonCodes(decisionReasonCodes);
  safeNonnegativeInteger(input.admitted_at_ms, "admitted_at_ms");
  invariant(input.admitted_at_ms >= candidate.created_at_ms, "INVALID_ADMISSION_TIME", "Source admission cannot predate the pending candidate.");

  const admittedEvidence = sealEvidenceEnvelope({
    evidence_id: input.evidence_id,
    blob_sha256: candidate.blob_sha256,
    evidence_class: "source_revision",
    issuer_id: input.source_authority_actor_id,
    scope_aggregate_id: candidate.title_id,
    state: "VERIFIED_CURRENT",
    observed_at_ms: observation.observed_at_ms,
    verified_at_ms: input.admitted_at_ms,
    expires_at_ms: null,
  });
  const normalized = cloneCanonical({
    schema_version: SOURCE_ADMISSION_RECORD_SCHEMA_VERSION,
    admission_record_id: input.admission_record_id,
    admission_candidate_id: candidate.admission_candidate_id,
    admission_candidate_hash: candidate.admission_candidate_hash,
    observation_id: observation.observation_id,
    observation_hash: observation.observation_hash,
    verification_report_id: report.verification_report_id,
    verification_report_hash: report.verification_report_hash,
    blob_sha256: candidate.blob_sha256,
    byte_length: candidate.byte_length,
    title_id: candidate.title_id,
    base_state_version: input.base_state_version,
    base_state_hash: input.base_state_hash,
    policy_version: input.policy_version,
    policy_hash: input.policy_hash,
    revision_id: candidate.proposed_revision_id,
    source_title: candidate.source_title_claim,
    declared_format: observation.declared_format,
    admitted_by_actor_id: input.admitted_by_actor_id,
    source_authority_actor_id: input.source_authority_actor_id,
    source_authority_record_id: input.source_authority_record_id,
    source_authority_record_hash: input.source_authority_record_hash,
    intentional_export_attestor_id: input.intentional_export_attestor_id,
    intentional_export_attestation_id: input.intentional_export_attestation_id,
    intentional_export_attestation_hash: input.intentional_export_attestation_hash,
    creative_approver_id: input.creative_approver_id,
    creative_approval_id: input.creative_approval_id,
    creative_approval_hash: input.creative_approval_hash,
    title_revision_identity_reviewer_id: input.title_revision_identity_reviewer_id,
    title_revision_identity_record_id: input.title_revision_identity_record_id,
    title_revision_identity_record_hash: input.title_revision_identity_record_hash,
    rights_controller_id: input.rights_controller_id,
    rights_basis_kind: input.rights_basis_kind,
    rights_record_id: input.rights_record_id,
    rights_record_hash: input.rights_record_hash,
    admitted_evidence: admittedEvidence,
    decision: "ADMIT",
    decision_reason_codes: decisionReasonCodes,
    decision_state: "ADMITTED",
    production_gate_effect: "NONE",
    admitted_at_ms: input.admitted_at_ms,
  });
  return validateSourceAdmissionRecord({
    ...normalized,
    admission_record_hash: hashCanonical(normalized),
  });
}

export function sourceRevisionProjection(recordValue) {
  const record = validateSourceAdmissionRecord(recordValue);
  return validateSourceRevisionProjection({
    schema_version: SOURCE_REVISION_SCHEMA_VERSION,
    revision_id: record.revision_id,
    source_title: record.source_title,
    declared_format: record.declared_format,
    blob_sha256: record.blob_sha256,
    byte_length: record.byte_length,
    evidence_id: record.admitted_evidence.evidence_id,
    evidence_hash: record.admitted_evidence.evidence_hash,
    admission_candidate_id: record.admission_candidate_id,
    admission_record_id: record.admission_record_id,
    admission_record_hash: record.admission_record_hash,
    admitted_at_ms: record.admitted_at_ms,
  });
}

export function validateSourceRevisionProjection(value) {
  const revision = cloneCanonical(value);
  exactKeys(revision, SOURCE_REVISION_KEYS, "Source revision projection");
  invariant(revision.schema_version === SOURCE_REVISION_SCHEMA_VERSION, "UNSUPPORTED_SCHEMA", `schema_version must equal ${SOURCE_REVISION_SCHEMA_VERSION}.`);
  for (const field of ["revision_id", "evidence_id", "admission_candidate_id", "admission_record_id"]) identifier(revision[field], field);
  for (const field of ["blob_sha256", "evidence_hash", "admission_record_hash"]) assertSha256(revision[field], field);
  nonemptyTrimmedText(revision.source_title, "source_title", 512);
  invariant(["FDX", "FOUNTAIN", "PDF", "DOCX", "TXT", "RTF", "OTHER"].includes(revision.declared_format), "INVALID_SOURCE_FORMAT", "declared_format is not supported.");
  safeNonnegativeInteger(revision.byte_length, "byte_length");
  invariant(revision.byte_length > 0, "INVALID_SOURCE_SIZE", "byte_length must be greater than zero.");
  safeNonnegativeInteger(revision.admitted_at_ms, "admitted_at_ms");
  return revision;
}

export function createSourceAdmissionOperation({ record, opId = "admit-source-revision" }) {
  identifier(opId, "opId");
  record = validateSourceAdmissionRecord(record);
  return cloneCanonical({
    op_id: opId,
    kind: "ADMIT_SOURCE_REVISION",
    target: "source.revision",
    expected_target_hash: "ABSENT",
    payload: record,
  });
}
