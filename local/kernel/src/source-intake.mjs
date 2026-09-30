import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  assertSha256,
  cloneCanonical,
  hashCanonical,
  timingSafeHashEqual,
} from "./canonical-json.mjs";
import { invariant } from "./errors.mjs";

export const SOURCE_OBSERVATION_SCHEMA_VERSION = "filmstack-source-observation/v1";
export const SOURCE_VERIFICATION_REPORT_SCHEMA_VERSION = "filmstack-source-verification-report/v1";
export const SOURCE_ADMISSION_CANDIDATE_SCHEMA_VERSION = "filmstack-source-admission-candidate/v1";
export const SOURCE_INTAKE_MODES = Object.freeze(["STANDARD", "SYNTHETIC_FIXTURE"]);
export const DEFAULT_MAX_SOURCE_BYTES = 64 * 1024 * 1024;

const MAX_ALLOWED_SOURCE_BYTES = 256 * 1024 * 1024;
const BUILTIN_VERIFIER_ID = "hampton.raw-byte-verifier";
const BUILTIN_VERIFIER_VERSION = "1.0.0";
const VERIFICATION_PROFILE = "RAW_BYTES_SHA256_V1";
const ID_PATTERN = /^(?!(?:__proto__|constructor|prototype|hasOwnProperty|isPrototypeOf|propertyIsEnumerable|toLocaleString|toString|valueOf|__defineGetter__|__defineSetter__|__lookupGetter__|__lookupSetter__)$)[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SOURCE_KINDS = Object.freeze(["INTENTIONAL_EXPORT", "CACHE_LEAD", "SYNTHETIC_FIXTURE", "OTHER"]);
const DECLARED_FORMATS = Object.freeze(["FDX", "FOUNTAIN", "PDF", "DOCX", "TXT", "RTF", "OTHER"]);
const REQUIRED_ADMISSION_CONTROLS = Object.freeze([
  "AUTHENTICATED_HUMAN_ADMISSION_REQUIRED",
  "CREATIVE_APPROVAL_REQUIRED",
  "INTENTIONAL_EXPORT_ATTESTATION_REQUIRED",
  "RIGHTS_BASIS_REQUIRED",
  "SOURCE_AUTHORITY_REVIEW_REQUIRED",
  "TITLE_REVISION_IDENTITY_REVIEW_REQUIRED",
]);
const OBSERVATION_KEYS = new Set([
  "schema_version",
  "observation_id",
  "observation_hash",
  "blob_sha256",
  "byte_length",
  "intake_case_id",
  "source_kind_claim",
  "claimed_custodian_id",
  "original_filename",
  "declared_format",
  "observed_at_ms",
  "quarantine_state",
  "authority_state",
  "admission_state",
]);
const OBSERVATION_INPUT_KEYS = new Set([
  "observation_id",
  "intake_case_id",
  "source_bytes",
  "source_kind_claim",
  "claimed_custodian_id",
  "original_filename",
  "declared_format",
  "observed_at_ms",
]);
const VERIFICATION_KEYS = new Set([
  "schema_version",
  "verification_report_id",
  "verification_report_hash",
  "observation_id",
  "observation_hash",
  "blob_sha256",
  "byte_length",
  "verifier_id",
  "verifier_version",
  "verification_profile",
  "expected_blob_sha256",
  "expected_hash_status",
  "checks",
  "technical_result",
  "reason_codes",
  "verified_at_ms",
  "authority_state",
  "admission_decision",
]);
const VERIFICATION_INPUT_KEYS = new Set([
  "observation",
  "source_bytes",
  "verification_report_id",
  "expected_blob_sha256",
  "verified_at_ms",
]);
const VERIFICATION_CHECK_KEYS = new Set([
  "observation_blob_hash_match",
  "observation_byte_length_match",
  "expected_blob_hash_match",
]);
const ADMISSION_CANDIDATE_KEYS = new Set([
  "schema_version",
  "admission_candidate_id",
  "admission_candidate_hash",
  "observation_id",
  "observation_hash",
  "verification_report_id",
  "verification_report_hash",
  "blob_sha256",
  "byte_length",
  "intake_case_id",
  "title_id",
  "proposed_evidence_class",
  "proposed_revision_id",
  "source_title_claim",
  "source_kind_claim",
  "intake_mode",
  "candidate_state",
  "authority_state",
  "production_gate_effect",
  "unresolved_controls",
  "created_at_ms",
]);
const ADMISSION_CANDIDATE_INPUT_KEYS = new Set([
  "observation",
  "verification_report",
  "admission_candidate_id",
  "title_id",
  "proposed_revision_id",
  "source_title_claim",
  "created_at_ms",
  "mode",
]);

function exactKeys(value, keys, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value), "INVALID_SOURCE_CONTRACT", `${label} must be an object.`);
  const actual = Object.keys(value);
  const unknown = actual.filter((key) => !keys.has(key)).sort();
  const missing = [...keys].filter((key) => !(key in value)).sort();
  invariant(unknown.length === 0, "UNKNOWN_FIELDS", `${label} has unknown fields: ${unknown.join(", ")}.`, { unknown });
  invariant(missing.length === 0, "MISSING_FIELDS", `${label} is missing fields: ${missing.join(", ")}.`, { missing });
}

function identifier(value, field) {
  invariant(typeof value === "string" && ID_PATTERN.test(value), "INVALID_ID", `${field} is not a safe identifier.`);
}

function safeNonnegativeInteger(value, field) {
  invariant(Number.isSafeInteger(value) && value >= 0, "INVALID_INTEGER", `${field} must be a non-negative safe integer.`);
}

function nonemptyTrimmedText(value, field, maxLength) {
  invariant(
    typeof value === "string"
      && value.length > 0
      && value.length <= maxLength
      && value.trim() === value,
    "INVALID_STRING",
    `${field} must be non-empty, trimmed text of at most ${maxLength} characters.`,
  );
}

function originalFilename(value) {
  nonemptyTrimmedText(value, "original_filename", 255);
  invariant(value !== "." && value !== "..", "INVALID_SOURCE_NAME", "original_filename cannot be a traversal segment.");
  invariant(!/[\\/\u0000-\u001f\u007f]/u.test(value), "INVALID_SOURCE_NAME", "original_filename must be a basename without path separators or control characters.");
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function hashPayload(value, hashField) {
  const payload = cloneCanonical(value);
  delete payload[hashField];
  return payload;
}

function equalStringArrays(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Read one stable regular file as exact bytes. No text or container normalization occurs. */
export function readStableSourceFile(filePath, { maxBytes = DEFAULT_MAX_SOURCE_BYTES } = {}) {
  invariant(typeof filePath === "string" && filePath.length > 0, "INVALID_SOURCE_PATH", "Source file path is required.");
  invariant(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= MAX_ALLOWED_SOURCE_BYTES, "INVALID_SOURCE_SIZE_LIMIT", `maxBytes must be between 1 and ${MAX_ALLOWED_SOURCE_BYTES}.`);

  let pathStat;
  try {
    pathStat = fs.lstatSync(filePath, { bigint: true });
  } catch {
    invariant(false, "SOURCE_FILE_UNAVAILABLE", "Source file could not be opened.");
  }
  invariant(!pathStat.isSymbolicLink() && pathStat.isFile(), "INVALID_SOURCE_FILE", "Source must be a regular, non-symbolic-link file.");
  invariant(pathStat.size > 0n && pathStat.size <= BigInt(maxBytes), "INVALID_SOURCE_SIZE", `Source must contain 1-${maxBytes} bytes.`);

  let descriptor;
  try {
    try {
      descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    } catch {
      invariant(false, "SOURCE_FILE_UNAVAILABLE", "Source file could not be opened without following links.");
    }
    const before = fs.fstatSync(descriptor, { bigint: true });
    invariant(before.isFile(), "INVALID_SOURCE_FILE", "Source must remain a regular file.");
    invariant(before.dev === pathStat.dev && before.ino === pathStat.ino, "SOURCE_FILE_CHANGED", "Source changed while opening.");
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    let finalPathStat;
    try {
      finalPathStat = fs.lstatSync(filePath, { bigint: true });
    } catch {
      invariant(false, "SOURCE_FILE_CHANGED", "Source path changed while reading.");
    }
    invariant(
      before.dev === after.dev
        && before.ino === after.ino
        && before.size === after.size
        && before.mtimeNs === after.mtimeNs
        && before.ctimeNs === after.ctimeNs
        && finalPathStat.dev === after.dev
        && finalPathStat.ino === after.ino
        && finalPathStat.size === after.size
        && finalPathStat.mtimeNs === after.mtimeNs
        && finalPathStat.ctimeNs === after.ctimeNs
        && BigInt(bytes.length) === after.size,
      "SOURCE_FILE_CHANGED",
      "Source changed while reading.",
    );
    const snapshot = Buffer.from(bytes);
    return Object.freeze({
      bytes: snapshot,
      presented_filename: path.basename(filePath),
      blob_sha256: sha256Bytes(snapshot),
      byte_length: snapshot.length,
    });
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function sourceObservationHashPayload(observation) {
  return hashPayload(observation, "observation_hash");
}

export function validateSourceObservation(value) {
  const observation = cloneCanonical(value);
  exactKeys(observation, OBSERVATION_KEYS, "Source observation");
  invariant(observation.schema_version === SOURCE_OBSERVATION_SCHEMA_VERSION, "UNSUPPORTED_SCHEMA", `schema_version must equal ${SOURCE_OBSERVATION_SCHEMA_VERSION}.`);
  identifier(observation.observation_id, "observation_id");
  identifier(observation.intake_case_id, "intake_case_id");
  identifier(observation.claimed_custodian_id, "claimed_custodian_id");
  assertSha256(observation.blob_sha256, "blob_sha256");
  safeNonnegativeInteger(observation.byte_length, "byte_length");
  invariant(observation.byte_length > 0 && observation.byte_length <= MAX_ALLOWED_SOURCE_BYTES, "INVALID_SOURCE_SIZE", "byte_length is outside the supported source range.");
  invariant(SOURCE_KINDS.includes(observation.source_kind_claim), "INVALID_SOURCE_KIND", "source_kind_claim is not supported.");
  originalFilename(observation.original_filename);
  invariant(DECLARED_FORMATS.includes(observation.declared_format), "INVALID_SOURCE_FORMAT", "declared_format is not supported.");
  safeNonnegativeInteger(observation.observed_at_ms, "observed_at_ms");
  invariant(observation.quarantine_state === "QUARANTINED", "AUTHORITY_LAUNDERING", "Source observations must remain QUARANTINED.");
  invariant(observation.authority_state === "NO_CANONICAL_AUTHORITY", "AUTHORITY_LAUNDERING", "Source observations have no canonical authority.");
  invariant(observation.admission_state === "NOT_ADMITTED", "AUTHORITY_LAUNDERING", "Source observations are not admitted evidence.");
  assertSha256(observation.observation_hash, "observation_hash");
  invariant(timingSafeHashEqual(hashCanonical(sourceObservationHashPayload(observation)), observation.observation_hash), "SOURCE_OBSERVATION_HASH_MISMATCH", "observation_hash does not match the canonical observation.");
  return observation;
}

export function sealSourceObservation(draft) {
  exactKeys(draft, OBSERVATION_INPUT_KEYS, "Source observation input");
  invariant(Buffer.isBuffer(draft.source_bytes), "INVALID_SOURCE_BYTES", "source_bytes must be a Buffer.");
  const bytes = Buffer.from(draft.source_bytes);
  invariant(bytes.length > 0 && bytes.length <= MAX_ALLOWED_SOURCE_BYTES, "INVALID_SOURCE_SIZE", `source_bytes must contain 1-${MAX_ALLOWED_SOURCE_BYTES} bytes.`);
  const normalized = cloneCanonical({
    schema_version: SOURCE_OBSERVATION_SCHEMA_VERSION,
    observation_id: draft.observation_id,
    blob_sha256: sha256Bytes(bytes),
    byte_length: bytes.length,
    intake_case_id: draft.intake_case_id,
    source_kind_claim: draft.source_kind_claim,
    claimed_custodian_id: draft.claimed_custodian_id,
    original_filename: draft.original_filename,
    declared_format: draft.declared_format,
    observed_at_ms: draft.observed_at_ms,
    quarantine_state: "QUARANTINED",
    authority_state: "NO_CANONICAL_AUTHORITY",
    admission_state: "NOT_ADMITTED",
  });
  return validateSourceObservation({
    ...normalized,
    observation_hash: hashCanonical(normalized),
  });
}

export function sourceVerificationReportHashPayload(report) {
  return hashPayload(report, "verification_report_hash");
}

export function validateSourceVerificationReport(value) {
  const report = cloneCanonical(value);
  exactKeys(report, VERIFICATION_KEYS, "Source verification report");
  invariant(report.schema_version === SOURCE_VERIFICATION_REPORT_SCHEMA_VERSION, "UNSUPPORTED_SCHEMA", `schema_version must equal ${SOURCE_VERIFICATION_REPORT_SCHEMA_VERSION}.`);
  identifier(report.verification_report_id, "verification_report_id");
  identifier(report.observation_id, "observation_id");
  assertSha256(report.observation_hash, "observation_hash");
  assertSha256(report.blob_sha256, "blob_sha256");
  safeNonnegativeInteger(report.byte_length, "byte_length");
  invariant(report.byte_length > 0 && report.byte_length <= MAX_ALLOWED_SOURCE_BYTES, "INVALID_SOURCE_SIZE", "byte_length is outside the supported source range.");
  invariant(report.verifier_id === BUILTIN_VERIFIER_ID, "UNTRUSTED_SOURCE_VERIFIER", "verifier_id must identify the built-in raw-byte verifier.");
  invariant(report.verifier_version === BUILTIN_VERIFIER_VERSION, "UNTRUSTED_SOURCE_VERIFIER", "verifier_version must identify the built-in raw-byte verifier version.");
  invariant(report.verification_profile === VERIFICATION_PROFILE, "INVALID_VERIFICATION_PROFILE", `verification_profile must equal ${VERIFICATION_PROFILE}.`);
  if (report.expected_blob_sha256 !== null) assertSha256(report.expected_blob_sha256, "expected_blob_sha256");
  exactKeys(report.checks, VERIFICATION_CHECK_KEYS, "Source verification checks");
  invariant(typeof report.checks.observation_blob_hash_match === "boolean", "INVALID_VERIFICATION_CHECK", "observation_blob_hash_match must be boolean.");
  invariant(typeof report.checks.observation_byte_length_match === "boolean", "INVALID_VERIFICATION_CHECK", "observation_byte_length_match must be boolean.");
  invariant(report.checks.expected_blob_hash_match === null || typeof report.checks.expected_blob_hash_match === "boolean", "INVALID_VERIFICATION_CHECK", "expected_blob_hash_match must be null or boolean.");
  if (report.expected_blob_sha256 === null) {
    invariant(report.expected_hash_status === "NOT_PROVIDED" && report.checks.expected_blob_hash_match === null, "INVALID_EXPECTED_HASH_STATUS", "No expected hash must use NOT_PROVIDED and a null check.");
  } else {
    invariant(report.expected_hash_status === (report.checks.expected_blob_hash_match ? "MATCH" : "MISMATCH"), "INVALID_EXPECTED_HASH_STATUS", "expected_hash_status disagrees with the expected-hash check.");
    invariant(report.checks.expected_blob_hash_match === timingSafeHashEqual(report.blob_sha256, report.expected_blob_sha256), "INVALID_VERIFICATION_CHECK", "expected_blob_hash_match disagrees with the report hashes.");
  }
  const expectedReasons = [];
  if (!report.checks.observation_blob_hash_match) expectedReasons.push("OBSERVATION_BLOB_HASH_MISMATCH");
  if (!report.checks.observation_byte_length_match) expectedReasons.push("OBSERVATION_BYTE_LENGTH_MISMATCH");
  if (report.checks.expected_blob_hash_match === false) expectedReasons.push("EXPECTED_BLOB_HASH_MISMATCH");
  expectedReasons.sort();
  invariant(Array.isArray(report.reason_codes) && report.reason_codes.every((reason) => typeof reason === "string" && ID_PATTERN.test(reason)), "INVALID_REASON_CODES", "reason_codes must contain safe identifiers.");
  invariant(equalStringArrays(report.reason_codes, expectedReasons), "INVALID_REASON_CODES", "reason_codes must exactly describe failed technical checks.");
  const expectedResult = expectedReasons.length === 0 ? "PASS" : "FAIL";
  invariant(report.technical_result === expectedResult, "INVALID_TECHNICAL_RESULT", "technical_result disagrees with the technical checks.");
  safeNonnegativeInteger(report.verified_at_ms, "verified_at_ms");
  invariant(report.authority_state === "TECHNICAL_VERIFICATION_ONLY", "AUTHORITY_LAUNDERING", "Technical verification grants no canonical authority.");
  invariant(report.admission_decision === "NOT_PERFORMED", "AUTHORITY_LAUNDERING", "Technical verification cannot perform admission.");
  assertSha256(report.verification_report_hash, "verification_report_hash");
  invariant(timingSafeHashEqual(hashCanonical(sourceVerificationReportHashPayload(report)), report.verification_report_hash), "SOURCE_VERIFICATION_REPORT_HASH_MISMATCH", "verification_report_hash does not match the canonical report.");
  return report;
}

export function createSourceVerificationReport(input) {
  exactKeys(input, VERIFICATION_INPUT_KEYS, "Source verification input");
  const observation = validateSourceObservation(input.observation);
  invariant(Buffer.isBuffer(input.source_bytes), "INVALID_SOURCE_BYTES", "source_bytes must be a Buffer.");
  const bytes = Buffer.from(input.source_bytes);
  invariant(bytes.length > 0 && bytes.length <= MAX_ALLOWED_SOURCE_BYTES, "INVALID_SOURCE_SIZE", `source_bytes must contain 1-${MAX_ALLOWED_SOURCE_BYTES} bytes.`);
  identifier(input.verification_report_id, "verification_report_id");
  if (input.expected_blob_sha256 !== null) assertSha256(input.expected_blob_sha256, "expected_blob_sha256");
  safeNonnegativeInteger(input.verified_at_ms, "verified_at_ms");
  invariant(input.verified_at_ms >= observation.observed_at_ms, "INVALID_VERIFICATION_TIME", "Technical verification cannot predate observation.");

  const actualHash = sha256Bytes(bytes);
  const hashMatch = timingSafeHashEqual(actualHash, observation.blob_sha256);
  const lengthMatch = bytes.length === observation.byte_length;
  const expectedMatch = input.expected_blob_sha256 === null ? null : timingSafeHashEqual(actualHash, input.expected_blob_sha256);
  const reasonCodes = [];
  if (!hashMatch) reasonCodes.push("OBSERVATION_BLOB_HASH_MISMATCH");
  if (!lengthMatch) reasonCodes.push("OBSERVATION_BYTE_LENGTH_MISMATCH");
  if (expectedMatch === false) reasonCodes.push("EXPECTED_BLOB_HASH_MISMATCH");
  reasonCodes.sort();
  const normalized = cloneCanonical({
    schema_version: SOURCE_VERIFICATION_REPORT_SCHEMA_VERSION,
    verification_report_id: input.verification_report_id,
    observation_id: observation.observation_id,
    observation_hash: observation.observation_hash,
    blob_sha256: actualHash,
    byte_length: bytes.length,
    verifier_id: BUILTIN_VERIFIER_ID,
    verifier_version: BUILTIN_VERIFIER_VERSION,
    verification_profile: VERIFICATION_PROFILE,
    expected_blob_sha256: input.expected_blob_sha256,
    expected_hash_status: input.expected_blob_sha256 === null ? "NOT_PROVIDED" : (expectedMatch ? "MATCH" : "MISMATCH"),
    checks: {
      observation_blob_hash_match: hashMatch,
      observation_byte_length_match: lengthMatch,
      expected_blob_hash_match: expectedMatch,
    },
    technical_result: reasonCodes.length === 0 ? "PASS" : "FAIL",
    reason_codes: reasonCodes,
    verified_at_ms: input.verified_at_ms,
    authority_state: "TECHNICAL_VERIFICATION_ONLY",
    admission_decision: "NOT_PERFORMED",
  });
  return validateSourceVerificationReport({
    ...normalized,
    verification_report_hash: hashCanonical(normalized),
  });
}

export function sourceAdmissionCandidateHashPayload(candidate) {
  return hashPayload(candidate, "admission_candidate_hash");
}

export function validateSourceAdmissionCandidate(value) {
  const candidate = cloneCanonical(value);
  exactKeys(candidate, ADMISSION_CANDIDATE_KEYS, "Source admission candidate");
  invariant(candidate.schema_version === SOURCE_ADMISSION_CANDIDATE_SCHEMA_VERSION, "UNSUPPORTED_SCHEMA", `schema_version must equal ${SOURCE_ADMISSION_CANDIDATE_SCHEMA_VERSION}.`);
  identifier(candidate.admission_candidate_id, "admission_candidate_id");
  identifier(candidate.observation_id, "observation_id");
  identifier(candidate.verification_report_id, "verification_report_id");
  identifier(candidate.intake_case_id, "intake_case_id");
  identifier(candidate.title_id, "title_id");
  identifier(candidate.proposed_revision_id, "proposed_revision_id");
  assertSha256(candidate.observation_hash, "observation_hash");
  assertSha256(candidate.verification_report_hash, "verification_report_hash");
  assertSha256(candidate.blob_sha256, "blob_sha256");
  safeNonnegativeInteger(candidate.byte_length, "byte_length");
  invariant(candidate.byte_length > 0 && candidate.byte_length <= MAX_ALLOWED_SOURCE_BYTES, "INVALID_SOURCE_SIZE", "byte_length is outside the supported source range.");
  invariant(candidate.proposed_evidence_class === "source_revision", "INVALID_EVIDENCE_CLASS", "Source admission candidates may propose only source_revision evidence.");
  nonemptyTrimmedText(candidate.source_title_claim, "source_title_claim", 512);
  invariant(["INTENTIONAL_EXPORT", "SYNTHETIC_FIXTURE"].includes(candidate.source_kind_claim), "SOURCE_NOT_ADMISSION_ELIGIBLE", "Cache leads, unknown sources, and other observations cannot become admission candidates.");
  invariant(SOURCE_INTAKE_MODES.includes(candidate.intake_mode), "INVALID_SOURCE_INTAKE_MODE", "intake_mode is not supported.");
  invariant(
    (candidate.source_kind_claim === "INTENTIONAL_EXPORT" && candidate.intake_mode === "STANDARD")
      || (candidate.source_kind_claim === "SYNTHETIC_FIXTURE" && candidate.intake_mode === "SYNTHETIC_FIXTURE"),
    "SOURCE_INTAKE_MODE_MISMATCH",
    "Synthetic sources require explicit SYNTHETIC_FIXTURE mode; intentional exports require STANDARD mode.",
  );
  invariant(candidate.candidate_state === "PENDING_HUMAN_ADMISSION", "AUTHORITY_LAUNDERING", "A source candidate must remain pending human admission.");
  invariant(candidate.authority_state === "NO_CANONICAL_AUTHORITY", "AUTHORITY_LAUNDERING", "A source candidate has no canonical authority.");
  invariant(candidate.production_gate_effect === "NONE", "AUTHORITY_LAUNDERING", "A source candidate cannot affect the production gate.");
  invariant(
    Array.isArray(candidate.unresolved_controls)
      && equalStringArrays(candidate.unresolved_controls, REQUIRED_ADMISSION_CONTROLS),
    "MISSING_ADMISSION_CONTROLS",
    "A source candidate must retain every unresolved creative, rights, authority, identity, and human-admission control.",
  );
  safeNonnegativeInteger(candidate.created_at_ms, "created_at_ms");
  assertSha256(candidate.admission_candidate_hash, "admission_candidate_hash");
  invariant(timingSafeHashEqual(hashCanonical(sourceAdmissionCandidateHashPayload(candidate)), candidate.admission_candidate_hash), "SOURCE_ADMISSION_CANDIDATE_HASH_MISMATCH", "admission_candidate_hash does not match the canonical candidate.");
  return candidate;
}

export function createSourceAdmissionCandidate(input) {
  exactKeys(input, ADMISSION_CANDIDATE_INPUT_KEYS, "Source admission candidate input");
  const observation = validateSourceObservation(input.observation);
  const report = validateSourceVerificationReport(input.verification_report);
  identifier(input.admission_candidate_id, "admission_candidate_id");
  identifier(input.title_id, "title_id");
  identifier(input.proposed_revision_id, "proposed_revision_id");
  nonemptyTrimmedText(input.source_title_claim, "source_title_claim", 512);
  safeNonnegativeInteger(input.created_at_ms, "created_at_ms");
  invariant(SOURCE_INTAKE_MODES.includes(input.mode), "INVALID_SOURCE_INTAKE_MODE", "mode must be STANDARD or SYNTHETIC_FIXTURE.");
  invariant(report.technical_result === "PASS", "SOURCE_VERIFICATION_REQUIRED", "Only a PASS technical report can produce an admission candidate.");
  invariant(
    report.observation_id === observation.observation_id
      && timingSafeHashEqual(report.observation_hash, observation.observation_hash)
      && timingSafeHashEqual(report.blob_sha256, observation.blob_sha256)
      && report.byte_length === observation.byte_length,
    "SOURCE_CROSS_BINDING_MISMATCH",
    "Observation and technical report identity, hashes, and byte length must agree exactly.",
  );
  invariant(input.created_at_ms >= report.verified_at_ms, "INVALID_CANDIDATE_TIME", "Admission candidate cannot predate its verification report.");
  invariant(
    observation.source_kind_claim === "INTENTIONAL_EXPORT" || observation.source_kind_claim === "SYNTHETIC_FIXTURE",
    "SOURCE_NOT_ADMISSION_ELIGIBLE",
    "Cache leads, unknown sources, and other observations cannot become admission candidates.",
  );
  invariant(
    (observation.source_kind_claim === "INTENTIONAL_EXPORT" && input.mode === "STANDARD")
      || (observation.source_kind_claim === "SYNTHETIC_FIXTURE" && input.mode === "SYNTHETIC_FIXTURE"),
    "SOURCE_INTAKE_MODE_MISMATCH",
    "Synthetic sources require explicit SYNTHETIC_FIXTURE mode; intentional exports require STANDARD mode.",
  );

  const normalized = cloneCanonical({
    schema_version: SOURCE_ADMISSION_CANDIDATE_SCHEMA_VERSION,
    admission_candidate_id: input.admission_candidate_id,
    observation_id: observation.observation_id,
    observation_hash: observation.observation_hash,
    verification_report_id: report.verification_report_id,
    verification_report_hash: report.verification_report_hash,
    blob_sha256: observation.blob_sha256,
    byte_length: observation.byte_length,
    intake_case_id: observation.intake_case_id,
    title_id: input.title_id,
    proposed_evidence_class: "source_revision",
    proposed_revision_id: input.proposed_revision_id,
    source_title_claim: input.source_title_claim,
    source_kind_claim: observation.source_kind_claim,
    intake_mode: input.mode,
    candidate_state: "PENDING_HUMAN_ADMISSION",
    authority_state: "NO_CANONICAL_AUTHORITY",
    production_gate_effect: "NONE",
    unresolved_controls: REQUIRED_ADMISSION_CONTROLS,
    created_at_ms: input.created_at_ms,
  });
  return validateSourceAdmissionCandidate({
    ...normalized,
    admission_candidate_hash: hashCanonical(normalized),
  });
}
