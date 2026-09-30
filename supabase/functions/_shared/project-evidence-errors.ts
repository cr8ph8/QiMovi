export interface ProjectEvidenceDatabaseErrorResponse {
  error: string;
  status: number;
}

const PROJECT_EVIDENCE_DATABASE_ERROR_STATUS = {
  production_review_evidence_disabled: 503,
  project_evidence_request_quota_exhausted: 429,
  project_evidence_observation_quota_exhausted: 429,
  idempotency_key_conflict: 409,
  stale_recording_base: 409,
  evidence_hash_collision_or_contract_conflict: 409,
  project_state_not_recordable: 409,
  entry_project_mismatch: 409,
  context_bundle_mismatch: 409,
  context_canonical_bytes_unavailable: 409,
  context_payload_hash_mismatch: 409,
  context_payload_integrity_failure: 409,
  context_payload_identity_failure: 409,
  local_project_context_correspondence_failure: 409,
  not_authorized: 403,
  entry_actor_mismatch: 403,
  project_not_found: 404,
  entry_not_found: 404,
  local_byte_length_mismatch: 400,
  local_sha256_mismatch: 400,
  invalid_base64: 400,
  invalid_utf8_or_json: 400,
  local_serialization_missing_trailing_lf: 400,
  noncanonical_local_serialization: 400,
  local_schema_mismatch: 400,
  local_authority_contract_violation: 400,
  service_role_required: 500,
  idempotency_observation_missing: 500,
} as const;

export type ProjectEvidenceDatabaseErrorCode =
  keyof typeof PROJECT_EVIDENCE_DATABASE_ERROR_STATUS;

const KNOWN_CODES = Object.keys(
  PROJECT_EVIDENCE_DATABASE_ERROR_STATUS,
) as ProjectEvidenceDatabaseErrorCode[];

/**
 * Convert an untrusted PostgREST error message into a bounded public code and
 * an HTTP status. Unknown database failures are server errors, never a caller
 * validation error, and their underlying text is not exposed.
 */
export function classifyProjectEvidenceDatabaseError(
  message: string,
): ProjectEvidenceDatabaseErrorResponse {
  const code = KNOWN_CODES.find((candidate) => message.includes(candidate));
  if (!code) {
    return { error: "evidence_recording_failed", status: 500 };
  }
  return {
    error: code,
    status: PROJECT_EVIDENCE_DATABASE_ERROR_STATUS[code],
  };
}
