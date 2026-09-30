import { assertSha256, cloneCanonical } from "./canonical-json.mjs";
import { invariant } from "./errors.mjs";

const GATE_STATUSES = new Set([
  "NOT_EVALUATED",
  "BLOCKED",
  "REVIEW_REQUIRED",
  "APPROVED",
  "REVOKED",
  "EXPIRED",
]);

export function validateProductionGateEvaluation(value) {
  const required = new Set([
    "status",
    "blockers",
    "satisfied_evidence_classes",
    "evidence_hashes",
    "policy_version",
    "policy_hash",
    "next_recheck_at_ms",
  ]);
  invariant(value && typeof value === "object" && !Array.isArray(value), "INVALID_GATE_EVALUATION", "Gate evaluation must be an object.");
  invariant(Object.keys(value).every((key) => required.has(key)) && [...required].every((key) => key in value), "INVALID_GATE_EVALUATION", "Gate evaluation keys do not match the v1 contract.");
  invariant(GATE_STATUSES.has(value.status), "INVALID_GATE_STATUS", `Unknown production gate status: ${value.status}.`);
  for (const field of ["blockers", "satisfied_evidence_classes", "evidence_hashes"]) {
    invariant(Array.isArray(value[field]), "INVALID_GATE_EVALUATION", `${field} must be an array.`);
    invariant(new Set(value[field]).size === value[field].length, "INVALID_GATE_EVALUATION", `${field} must not contain duplicates.`);
    invariant(value[field].every((item, index) => index === 0 || value[field][index - 1] < item), "INVALID_GATE_EVALUATION", `${field} must be lexically sorted.`);
  }
  invariant(typeof value.policy_version === "string" && value.policy_version.length > 0, "INVALID_GATE_EVALUATION", "policy_version is required.");
  assertSha256(value.policy_hash, "policy_hash");
  invariant(value.next_recheck_at_ms === null || (Number.isSafeInteger(value.next_recheck_at_ms) && value.next_recheck_at_ms >= 0), "INVALID_GATE_EVALUATION", "next_recheck_at_ms must be null or a non-negative safe integer.");
  cloneCanonical(value);
  return value;
}
