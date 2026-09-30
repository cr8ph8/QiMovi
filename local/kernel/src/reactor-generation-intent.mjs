import {
  canonicalValue,
  cloneCanonical,
  hashCanonical,
  timingSafeHashEqual,
} from "./canonical-json.mjs";
import { SCHEMA } from "./constants.mjs";
import { invariant } from "./errors.mjs";

export const REACTOR_GENERATION_INTENT_SCHEMA_VERSION = SCHEMA.reactorGenerationIntent;

const RESERVED_IDENTIFIERS = "(?:__proto__|constructor|prototype|hasOwnProperty|isPrototypeOf|propertyIsEnumerable|toLocaleString|toString|valueOf|__defineGetter__|__defineSetter__|__lookupGetter__|__lookupSetter__)";
const ID_PATTERN = new RegExp(`^(?!${RESERVED_IDENTIFIERS}$)[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`);
const REACTOR_API_KEY_PATTERN = /\brk_[A-Za-z0-9_-]{8,}\b/u;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~-]{8,}\b/iu;
const FORBIDDEN_SECRET_KEYS = new Set([
  "apikey",
  "accesstoken",
  "authorization",
  "bearertoken",
  "clientsecret",
  "credential",
  "credentials",
  "jwt",
  "password",
  "secret",
  "token",
]);

const INTENT_KEYS = Object.freeze([
  "schema_version",
  "intent_id",
  "created_at_ms",
  "intent_state",
  "authority_state",
  "source_binding",
  "generation_target",
  "provider_plan",
  "capability_snapshot",
  "pricing_snapshot",
  "budget_envelope",
  "execution_controls",
  "blockers",
  "effects",
  "intent_hash",
]);
const DRAFT_KEYS = Object.freeze(INTENT_KEYS.filter((key) => key !== "intent_hash"));
const SOURCE_BINDING_KEYS = Object.freeze(["tuple", "tuple_hash", "binding_state"]);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function frozenCanonical(value) {
  return deepFreeze(canonicalValue(value));
}

function assertExactKeys(value, expected, field) {
  invariant(value !== null && typeof value === "object" && !Array.isArray(value), "INVALID_REACTOR_GENERATION_INTENT", `${field} must be an object.`);
  const actual = Object.keys(value).sort(compareText);
  const wanted = [...expected].sort(compareText);
  invariant(
    actual.length === wanted.length && actual.every((key, index) => key === wanted[index]),
    "INVALID_REACTOR_GENERATION_INTENT",
    `${field} must contain exactly: ${wanted.join(", ")}.`,
    { actual },
  );
}

function assertNoSecretMaterial(value, path = "intent") {
  if (typeof value === "string") {
    invariant(
      !REACTOR_API_KEY_PATTERN.test(value) && !JWT_PATTERN.test(value) && !BEARER_PATTERN.test(value),
      "SECRET_MATERIAL_FORBIDDEN",
      `${path} must not contain Reactor API keys, bearer credentials, or JWTs.`,
    );
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoSecretMaterial(child, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replaceAll("_", "").replaceAll("-", "");
    invariant(!FORBIDDEN_SECRET_KEYS.has(normalizedKey), "SECRET_MATERIAL_FORBIDDEN", `${path}.${key} is a credential-bearing field and is forbidden.`);
    assertNoSecretMaterial(child, `${path}.${key}`);
  }
}

function assertIdentifier(value, field) {
  invariant(typeof value === "string" && ID_PATTERN.test(value), "INVALID_REACTOR_GENERATION_INTENT", `${field} must be a safe Hampton identifier.`);
}

function assertSafeTimestamp(value, field) {
  invariant(Number.isSafeInteger(value) && value >= 0, "INVALID_REACTOR_GENERATION_INTENT", `${field} must be a non-negative safe integer.`);
}

function assertExactSnapshot(value, expected, code, message) {
  invariant(hashCanonical(value) === hashCanonical(expected), code, message);
}

export const ARCHI_EPISODE_01_SOURCE_TUPLE = frozenCanonical({
  story_room_pack: {
    package_id: "prospective-archi-test-23-micro-series-v0.1",
    file_name: "story-room-pack.v1.json",
    byte_length: 33517,
    sha256: "8178cce801110f09e42dc412c626569c04c2d29c7ae6175128eb0bbf95ec7306",
  },
  production_script_manifest: {
    package_id: "prospective-archi-test-23-episode-01-almost-v0.1",
    file_name: "episode-production-script-pack.v1.json",
    byte_length: 14290,
    sha256: "375172486190b1c4d9efa0cad104df0d52286f55e5e42fb36ca61557aff6bff9",
  },
  fountain: {
    file_name: "EP01_ALMOST.fountain",
    byte_length: 3569,
    sha256: "1fa0aaed527d2850de9d8611f1bb26c8054273f183982cd2313bd77a34b44fad",
  },
  episode: {
    episode_index: 1,
    title: "Almost",
    assigned_test_id: "VIBE-001-UNDERSTAND",
    self_authored_test_id: "VIBE-002-SELF-QUESTION",
    target_runtime_seconds: 60,
  },
});

export const ARCHI_EPISODE_01_SOURCE_TUPLE_HASH = hashCanonical(ARCHI_EPISODE_01_SOURCE_TUPLE);

const GENERATION_TARGETS = frozenCanonical({
  "EP01-A": {
    segment_id: "EP01-A",
    prompt_selector: "prompt_preparation.segments[segment_id=EP01-A].visual_prompt",
    prompt_byte_length: 819,
    prompt_utf8_sha256: "6626bef573876326df6e307e3234d5985447a3306c06870d27d505c2d223bb10",
    planned_content_seconds: 30,
    media_kind: "VIDEO",
    output_candidate_state: "UNTRUSTED_PROVIDER_OUTPUT_IF_LATER_GENERATED",
  },
  "EP01-B": {
    segment_id: "EP01-B",
    prompt_selector: "prompt_preparation.segments[segment_id=EP01-B].visual_prompt",
    prompt_byte_length: 824,
    prompt_utf8_sha256: "9ab8ee66686716a23d4c8b191808a0ef1156dc1c26d1e916ee87e347c9f94bf9",
    planned_content_seconds: 30,
    media_kind: "VIDEO",
    output_candidate_state: "UNTRUSTED_PROVIDER_OUTPUT_IF_LATER_GENERATED",
  },
});

export const REACTOR_HELIOS_CAPABILITY_SNAPSHOT = frozenCanonical({
  snapshot_state: "REFERENCE_ONLY_STALE_AT_RUNTIME",
  captured_on: "2026-09-02",
  runtime_refresh_required: true,
  runtime_refresh_performed: false,
  sources: [
    "https://docs.reactor.inc/authentication.md",
    "https://docs.reactor.inc/concepts/recordings.md",
    "https://docs.reactor.inc/concepts/sessions.md",
    "https://docs.reactor.inc/model-api-reference/helios/overview.md",
    "https://docs.reactor.inc/model-api-reference/helios/schema.md",
  ],
  sdk_package: "@reactor-team/js-sdk",
  sdk_version_observed: "3.0.1",
  model_package: "@reactor-models/helios",
  model_package_version_observed: "1.0.1",
  native_width: 640,
  native_height: 384,
  default_output_width: 1280,
  default_output_height: 768,
  default_super_resolution: "2x",
  chunk_frames: 33,
  output_track: "main_video",
  output_media: ["VIDEO"],
  input_modes: ["IMAGE_TO_VIDEO", "TEXT_TO_VIDEO"],
  observed_commands: [
    "list_snapshots",
    "pause",
    "reset",
    "resume",
    "rewind",
    "save_snapshot",
    "schedule_prompt",
    "set_conditioning",
    "set_image",
    "set_image_strength",
    "set_prompt",
    "set_seed",
    "set_sr_scale",
    "start",
  ],
});

export const REACTOR_HELIOS_PRICING_SNAPSHOT = frozenCanonical({
  snapshot_state: "REFERENCE_ONLY_STALE_AT_RUNTIME",
  captured_on: "2026-09-02",
  source: "https://api.reactor.inc/pricing",
  catalog_model_name: "helios",
  model_name: "reactor/helios",
  credits_per_second: 17,
  credits_per_usd: 10000,
  billing_basis: "READY_GPU_SESSION_WALL_CLOCK_SECONDS",
  runtime_refresh_required: true,
  runtime_refresh_performed: false,
  snapshot_authorizes_spend: false,
});

const PROVIDER_PLAN = frozenCanonical({
  provider: "REACTOR",
  provider_role: "FIRST_GENERATION_BACKEND",
  execution_family: "LIVE_MEDIA_SESSION",
  model_name: "reactor/helios",
  transport: "WEBRTC",
  output_track: "main_video",
  implementation_state: "NOT_IMPLEMENTED",
});

const BUDGET_ENVELOPE = frozenCanonical({
  planned_content_seconds: 30,
  maximum_ready_session_seconds: 45,
  maximum_concurrent_sessions: 1,
  automatic_retry: false,
  reference_estimated_max_credits: 765,
  reference_estimated_max_usd_micros: 76500,
  approved_credits: 0,
  spend_authority: "NONE",
  pricing_snapshot_authorizes_spend: false,
});

const EXECUTION_CONTROLS = frozenCanonical({
  execution_state: "BLOCKED",
  network_access: "DENIED",
  api_key_handling: "NOT_PRESENT",
  session_authorization: "NOT_MINTED",
  session_creation: "NOT_ALLOWED",
  webrtc_connection: "NOT_ALLOWED",
  media_generation: "NOT_ALLOWED",
  recording: "NOT_ALLOWED",
  download: "NOT_ALLOWED",
  recoverable_disconnect: false,
  automatic_retry: false,
  human_start_required: true,
  human_terminate_required: true,
  downloaded_exact_bytes_sha256_required: true,
  allowed_commands: [],
});

const BLOCKERS = frozenCanonical([
  "AUTHENTICATED_HUMAN_START_REQUIRED",
  "CONTEXT_HASH_BINDING_REQUIRED",
  "CREATIVE_SCRIPT_ACCEPTANCE_REQUIRED",
  "EXACT_SOURCE_REVERIFICATION_REQUIRED",
  "OUTPUT_CAPTURE_AND_HASH_WORKFLOW_REQUIRED",
  "PROMPT_OR_STORYBOARD_PROMOTION_AUTHORIZATION_REQUIRED",
  "PROVIDER_ADAPTER_NOT_IMPLEMENTED",
  "REFERENCE_IMAGE_APPROVAL_REQUIRED",
  "RUNTIME_CAPABILITY_REFRESH_REQUIRED",
  "RUNTIME_PRICING_REFRESH_REQUIRED",
  "SERVER_SIDE_SCOPED_SESSION_AUTHORIZATION_REQUIRED",
  "SOURCE_REVISION_ADMISSION_REQUIRED",
  "SPEND_BUDGET_APPROVAL_REQUIRED",
  "TARGET_STORYBOARD_PACK_REQUIRED",
  "VOICE_AND_AUDIO_APPROVAL_REQUIRED",
]);

const EFFECTS = frozenCanonical({
  authoritative_state_change: "NONE",
  generation: "NOT_PERFORMED",
  network_requests: 0,
  persistence: "NONE",
  production_gate: "UNCHANGED_PRODUCE_BLOCKED",
  project_commit: false,
  provider_call: false,
  recording: "NOT_PERFORMED",
  session_created: false,
  source_admission: "NOT_PERFORMED",
  spend_credits: 0,
  token_spend: false,
  upload: false,
  webrtc_connected: false,
});

function validateCanonicalIntent(intent, { requireHash }) {
  assertNoSecretMaterial(intent);
  assertExactKeys(intent, requireHash ? INTENT_KEYS : DRAFT_KEYS, "Reactor generation intent");
  invariant(intent.schema_version === REACTOR_GENERATION_INTENT_SCHEMA_VERSION, "UNSUPPORTED_SCHEMA", `schema_version must equal ${REACTOR_GENERATION_INTENT_SCHEMA_VERSION}.`);
  assertIdentifier(intent.intent_id, "intent_id");
  assertSafeTimestamp(intent.created_at_ms, "created_at_ms");
  invariant(intent.intent_state === "PROSPECTIVE_NOT_EXECUTABLE", "AUTHORITY_LAUNDERING", "Reactor generation intent must remain prospective and non-executable.");
  invariant(intent.authority_state === "NO_EXTERNAL_AUTHORITY", "AUTHORITY_LAUNDERING", "Reactor generation intent cannot carry external authority.");

  assertExactKeys(intent.source_binding, SOURCE_BINDING_KEYS, "source_binding");
  invariant(intent.source_binding.binding_state === "EXACT_KNOWN_TUPLE_NOT_REVERIFIED_BY_THIS_CONTRACT", "INVALID_REACTOR_SOURCE_BINDING", "source binding state must disclose that this contract does not reread source bytes.");
  assertExactSnapshot(intent.source_binding.tuple, ARCHI_EPISODE_01_SOURCE_TUPLE, "REACTOR_SOURCE_TUPLE_MISMATCH", "Reactor intent must bind the exact current ARCHi Episode 1 source tuple.");
  invariant(intent.source_binding.tuple_hash === ARCHI_EPISODE_01_SOURCE_TUPLE_HASH, "REACTOR_SOURCE_TUPLE_MISMATCH", "source tuple hash does not match the exact ARCHi Episode 1 tuple.");
  invariant(hashCanonical(intent.source_binding.tuple) === intent.source_binding.tuple_hash, "REACTOR_SOURCE_TUPLE_MISMATCH", "source tuple hash does not match the supplied tuple bytes.");

  const expectedTarget = GENERATION_TARGETS[intent.generation_target?.segment_id];
  invariant(expectedTarget, "INVALID_REACTOR_GENERATION_TARGET", "generation_target.segment_id must be EP01-A or EP01-B.");
  assertExactSnapshot(intent.generation_target, expectedTarget, "INVALID_REACTOR_GENERATION_TARGET", "generation target must match the exact selected Episode 1 prompt selector and UTF-8 hash.");
  assertExactSnapshot(intent.provider_plan, PROVIDER_PLAN, "INVALID_REACTOR_PROVIDER_PLAN", "provider plan must remain the non-executable Reactor Helios profile.");
  assertExactSnapshot(intent.capability_snapshot, REACTOR_HELIOS_CAPABILITY_SNAPSHOT, "STALE_REACTOR_CAPABILITY_SNAPSHOT", "capability snapshot drifted from the recorded stale-at-runtime reference.");
  assertExactSnapshot(intent.pricing_snapshot, REACTOR_HELIOS_PRICING_SNAPSHOT, "STALE_REACTOR_PRICING_SNAPSHOT", "pricing snapshot drifted from the recorded stale-at-runtime reference.");
  assertExactSnapshot(intent.budget_envelope, BUDGET_ENVELOPE, "INVALID_REACTOR_BUDGET", "budget envelope must remain zero-authority and bounded to one prospective session.");
  assertExactSnapshot(intent.execution_controls, EXECUTION_CONTROLS, "LIVE_EFFECT_FORBIDDEN", "execution controls must keep network, session, WebRTC, generation, recording, and download disabled.");
  assertExactSnapshot(intent.blockers, BLOCKERS, "INVALID_REACTOR_BLOCKERS", "execution blockers must remain complete and canonically ordered.");
  assertExactSnapshot(intent.effects, EFFECTS, "LIVE_EFFECT_FORBIDDEN", "prospective Reactor intent must record zero live effects, spend, persistence, or authority.");

  invariant(intent.capability_snapshot.runtime_refresh_required && !intent.capability_snapshot.runtime_refresh_performed, "STALE_REACTOR_CAPABILITY_SNAPSHOT", "capabilities must be refreshed outside this contract before any future execution.");
  invariant(intent.pricing_snapshot.runtime_refresh_required && !intent.pricing_snapshot.runtime_refresh_performed && !intent.pricing_snapshot.snapshot_authorizes_spend, "STALE_REACTOR_PRICING_SNAPSHOT", "pricing snapshot must remain stale-at-runtime and unable to authorize spend.");
  invariant(intent.budget_envelope.planned_content_seconds === intent.generation_target.planned_content_seconds, "INVALID_REACTOR_BUDGET", "budget target seconds must match the selected content segment.");
  invariant(intent.budget_envelope.reference_estimated_max_credits === intent.pricing_snapshot.credits_per_second * intent.budget_envelope.maximum_ready_session_seconds, "INVALID_REACTOR_BUDGET", "reference credit estimate must be recomputable from the stale pricing snapshot.");
  invariant(intent.budget_envelope.reference_estimated_max_usd_micros === (intent.budget_envelope.reference_estimated_max_credits * 1000000) / intent.pricing_snapshot.credits_per_usd, "INVALID_REACTOR_BUDGET", "reference dollar estimate must be recomputable in integer microdollars.");

  if (requireHash) {
    invariant(typeof intent.intent_hash === "string" && /^[0-9a-f]{64}$/u.test(intent.intent_hash), "INVALID_REACTOR_GENERATION_INTENT", "intent_hash must be a lowercase SHA-256.");
    const observed = hashCanonical(reactorGenerationIntentHashPayloadCanonical(intent));
    invariant(timingSafeHashEqual(intent.intent_hash, observed), "REACTOR_GENERATION_INTENT_HASH_MISMATCH", "intent_hash does not match the canonical intent payload.");
  }
}

function reactorGenerationIntentHashPayloadCanonical(intent) {
  const payload = cloneCanonical(intent);
  delete payload.intent_hash;
  return payload;
}

export function reactorGenerationIntentHashPayload(intent) {
  const snapshot = canonicalValue(intent);
  assertExactKeys(snapshot, INTENT_KEYS, "Reactor generation intent");
  return reactorGenerationIntentHashPayloadCanonical(snapshot);
}

export function sealReactorGenerationIntent(draft) {
  const input = canonicalValue(draft);
  validateCanonicalIntent(input, { requireHash: false });
  const intent = { ...input, intent_hash: hashCanonical(input) };
  validateCanonicalIntent(intent, { requireHash: true });
  return cloneCanonical(intent);
}

export function validateReactorGenerationIntent(intent) {
  const snapshot = canonicalValue(intent);
  validateCanonicalIntent(snapshot, { requireHash: true });
  return deepFreeze(snapshot);
}

export function createArchiEpisode01ReactorGenerationIntent({
  intentId,
  segmentId = "EP01-A",
  createdAtMs,
} = {}) {
  assertIdentifier(intentId, "intentId");
  assertSafeTimestamp(createdAtMs, "createdAtMs");
  const generationTarget = GENERATION_TARGETS[segmentId];
  invariant(generationTarget, "INVALID_REACTOR_GENERATION_TARGET", "segmentId must be EP01-A or EP01-B.");
  return sealReactorGenerationIntent({
    schema_version: REACTOR_GENERATION_INTENT_SCHEMA_VERSION,
    intent_id: intentId,
    created_at_ms: createdAtMs,
    intent_state: "PROSPECTIVE_NOT_EXECUTABLE",
    authority_state: "NO_EXTERNAL_AUTHORITY",
    source_binding: {
      tuple: ARCHI_EPISODE_01_SOURCE_TUPLE,
      tuple_hash: ARCHI_EPISODE_01_SOURCE_TUPLE_HASH,
      binding_state: "EXACT_KNOWN_TUPLE_NOT_REVERIFIED_BY_THIS_CONTRACT",
    },
    generation_target: generationTarget,
    provider_plan: PROVIDER_PLAN,
    capability_snapshot: REACTOR_HELIOS_CAPABILITY_SNAPSHOT,
    pricing_snapshot: REACTOR_HELIOS_PRICING_SNAPSHOT,
    budget_envelope: BUDGET_ENVELOPE,
    execution_controls: EXECUTION_CONTROLS,
    blockers: BLOCKERS,
    effects: EFFECTS,
  });
}
