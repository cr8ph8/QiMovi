import { z } from "zod";
import type {
  LocalEpisodeProductionScriptPreview,
  LocalReadableFile,
} from "@/lib/episodeProductionScript";

export const MAX_REACTOR_GENERATION_INTENT_BYTES = 64 * 1024;

const MAX_CANONICAL_DEPTH = 32;
const MAX_CANONICAL_NODES = 10_000;
const MAX_CANONICAL_BYTES = 1024 * 1024;
const MAX_PORTABLE_BASENAME_LENGTH = 255;

const ARCHI_STORY_ROOM_PACKAGE_ID =
  "prospective-archi-test-23-micro-series-v0.1";
const ARCHI_PRODUCTION_SCRIPT_PACKAGE_ID =
  "prospective-archi-test-23-episode-01-almost-v0.1";
const STORY_ROOM_SHA256 =
  "8178cce801110f09e42dc412c626569c04c2d29c7ae6175128eb0bbf95ec7306";
const MANIFEST_SHA256 =
  "375172486190b1c4d9efa0cad104df0d52286f55e5e42fb36ca61557aff6bff9";
const FOUNTAIN_SHA256 =
  "1fa0aaed527d2850de9d8611f1bb26c8054273f183982cd2313bd77a34b44fad";
const SOURCE_TUPLE_SHA256 =
  "be3a31338bdcb452f10fd366b3b72c0deb5d9d46d709a3bcc01b98fa2c5439fb";

const SEGMENT_TARGETS = {
  "EP01-A": {
    promptSelector:
      "prompt_preparation.segments[segment_id=EP01-A].visual_prompt",
    promptByteLength: 819,
    promptSha256:
      "6626bef573876326df6e307e3234d5985447a3306c06870d27d505c2d223bb10",
  },
  "EP01-B": {
    promptSelector:
      "prompt_preparation.segments[segment_id=EP01-B].visual_prompt",
    promptByteLength: 824,
    promptSha256:
      "9ab8ee66686716a23d4c8b191808a0ef1156dc1c26d1e916ee87e347c9f94bf9",
  },
} as const;

export const REACTOR_GENERATION_INTENT_BLOCKERS = [
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
] as const;

const FORBIDDEN_JSON_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const RESERVED_IDENTIFIERS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "toString",
  "valueOf",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);
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

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const JSON_BASENAME_PATTERN = /^[^/\\]+\.json$/iu;
const REACTOR_API_KEY_PATTERN = /\brk_[A-Za-z0-9_-]{8,}\b/u;
const JWT_PATTERN =
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~-]{8,}\b/iu;
const LOCAL_PATH_PATTERNS = [
  /\bfile:[\\/]+/iu,
  /(?:^|[\s"'(])\/(?:Users|home|private|tmp|var|etc)(?:\/|$)/u,
  /(?:^|[\s"'(])~[\\/]/u,
  /(?:^|[\s"'(])\.\.?[\\/][^\s]/u,
  /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]/u,
  /(?:^|[^A-Za-z0-9_\\])\\\\[^\\\s]+[\\/]/u,
] as const;

const sha256Schema = z
  .string()
  .regex(SHA256_PATTERN, "Expected a lowercase 64-character SHA-256 hash");
const safeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .refine((value) => !Object.is(value, -0), "Negative zero is not permitted");
const safeIdentifierSchema = z
  .string()
  .regex(SAFE_ID_PATTERN, "Expected a safe Hampton identifier")
  .refine((value) => !RESERVED_IDENTIFIERS.has(value), "Reserved identifiers are not permitted");
const safeJsonBasenameSchema = z
  .string()
  .min(1)
  .max(MAX_PORTABLE_BASENAME_LENGTH)
  .regex(JSON_BASENAME_PATTERN, "Expected a safe basename-only JSON filename")
  .refine((value) => !hasInlineControl(value), "Control characters are not permitted");

function hasInlineControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function compareCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function exactArrayBuffer(value: ArrayBuffer): ArrayBuffer {
  if (Object.prototype.toString.call(value) !== "[object ArrayBuffer]") {
    throw new LocalReactorGenerationIntentError(
      "INVALID_FILE_SIZE",
      "The selected Reactor intent did not return an ordinary ArrayBuffer.",
    );
  }
  const source = new Uint8Array(value);
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy.buffer;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function sha256ArrayBuffer(bytes: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new LocalReactorGenerationIntentError(
      "HASH_UNAVAILABLE",
      "This browser cannot compute the required local SHA-256 receipts.",
    );
  }
  return bytesToHex(await subtle.digest("SHA-256", bytes));
}

async function sha256Utf8(value: string): Promise<string> {
  return sha256ArrayBuffer(new TextEncoder().encode(value).buffer);
}

function canonicalizeValue(
  value: unknown,
  context: { nodes: number },
  depth: number,
): unknown {
  if (depth > MAX_CANONICAL_DEPTH) {
    throw new LocalReactorGenerationIntentError(
      "INVALID_INTENT",
      `Canonical Reactor JSON exceeds depth ${MAX_CANONICAL_DEPTH}.`,
    );
  }
  context.nodes += 1;
  if (context.nodes > MAX_CANONICAL_NODES) {
    throw new LocalReactorGenerationIntentError(
      "INVALID_INTENT",
      `Canonical Reactor JSON exceeds ${MAX_CANONICAL_NODES} nodes.`,
    );
  }

  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new LocalReactorGenerationIntentError(
        "INVALID_INTENT",
        "Canonical Reactor JSON numbers must be safe integers and cannot be negative zero.",
      );
    }
    return value;
  }
  if (Array.isArray(value)) {
    const arrayKeys = Reflect.ownKeys(value).filter((key) => key !== "length");
    if (
      arrayKeys.length !== value.length ||
      !Array.from({ length: value.length }, (_, index) =>
        Object.prototype.hasOwnProperty.call(value, index),
      ).every(Boolean) ||
      !arrayKeys.every(
        (key) =>
          typeof key === "string" &&
          /^(?:0|[1-9]\d*)$/u.test(key) &&
          Number(key) < value.length,
      )
    ) {
      throw new LocalReactorGenerationIntentError(
        "INVALID_INTENT",
        "Canonical Reactor JSON arrays must be dense and cannot carry extra properties.",
      );
    }
    return value.map((item) => canonicalizeValue(item, context, depth + 1));
  }
  if (!value || typeof value !== "object") {
    throw new LocalReactorGenerationIntentError(
      "INVALID_INTENT",
      `Unsupported Reactor JSON value type: ${typeof value}.`,
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new LocalReactorGenerationIntentError(
      "INVALID_INTENT",
      "Canonical Reactor JSON accepts plain JSON objects only.",
    );
  }
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort(compareCodepoint)) {
    if (FORBIDDEN_JSON_KEYS.has(key)) {
      throw new LocalReactorGenerationIntentError(
        "INVALID_INTENT",
        `Forbidden Reactor JSON key: ${key}.`,
      );
    }
    output[key] = canonicalizeValue(
      (value as Record<string, unknown>)[key],
      context,
      depth + 1,
    );
  }
  return output;
}

function canonicalReactorJson(value: unknown): string {
  const serialized = JSON.stringify(
    canonicalizeValue(value, { nodes: 0 }, 0),
  );
  if (new TextEncoder().encode(serialized).byteLength > MAX_CANONICAL_BYTES) {
    throw new LocalReactorGenerationIntentError(
      "INVALID_INTENT",
      `Canonical Reactor JSON exceeds ${MAX_CANONICAL_BYTES} bytes.`,
    );
  }
  return serialized;
}

function assertNoSecretOrLocalPathMaterial(value: unknown): void {
  const stack: Array<{ value: unknown; path: string; depth: number }> = [
    { value, path: "intent", depth: 0 },
  ];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > MAX_CANONICAL_NODES || current.depth > MAX_CANONICAL_DEPTH) {
      throw new LocalReactorGenerationIntentError(
        "INVALID_INTENT",
        "The selected Reactor intent exceeds the bounded JSON shape.",
      );
    }
    if (typeof current.value === "string") {
      const stringValue = current.value;
      if (
        REACTOR_API_KEY_PATTERN.test(stringValue) ||
        JWT_PATTERN.test(stringValue) ||
        BEARER_PATTERN.test(stringValue)
      ) {
        throw new LocalReactorGenerationIntentError(
          "SECRET_MATERIAL_FORBIDDEN",
          `${current.path} contains forbidden credential-shaped material.`,
        );
      }
      if (LOCAL_PATH_PATTERNS.some((pattern) => pattern.test(stringValue))) {
        throw new LocalReactorGenerationIntentError(
          "LOCAL_PATH_FORBIDDEN",
          `${current.path} contains a local filesystem path.`,
        );
      }
      continue;
    }
    if (Array.isArray(current.value)) {
      current.value.forEach((child, index) =>
        stack.push({
          value: child,
          path: `${current.path}[${index}]`,
          depth: current.depth + 1,
        }),
      );
      continue;
    }
    if (!current.value || typeof current.value !== "object") continue;
    for (const [key, child] of Object.entries(
      current.value as Record<string, unknown>,
    )) {
      const normalizedKey = key.toLowerCase().replace(/[_-]/gu, "");
      if (FORBIDDEN_SECRET_KEYS.has(normalizedKey)) {
        throw new LocalReactorGenerationIntentError(
          "SECRET_MATERIAL_FORBIDDEN",
          `${current.path}.${key} is a credential-bearing field and is forbidden.`,
        );
      }
      stack.push({
        value: child,
        path: `${current.path}.${key}`,
        depth: current.depth + 1,
      });
    }
  }
}

const exactSourceTupleSchema = z
  .object({
    story_room_pack: z
      .object({
        package_id: z.literal(ARCHI_STORY_ROOM_PACKAGE_ID),
        file_name: z.literal("story-room-pack.v1.json"),
        byte_length: z.literal(33_517),
        sha256: z.literal(STORY_ROOM_SHA256),
      })
      .strict(),
    production_script_manifest: z
      .object({
        package_id: z.literal(ARCHI_PRODUCTION_SCRIPT_PACKAGE_ID),
        file_name: z.literal("episode-production-script-pack.v1.json"),
        byte_length: z.literal(14_290),
        sha256: z.literal(MANIFEST_SHA256),
      })
      .strict(),
    fountain: z
      .object({
        file_name: z.literal("EP01_ALMOST.fountain"),
        byte_length: z.literal(3_569),
        sha256: z.literal(FOUNTAIN_SHA256),
      })
      .strict(),
    episode: z
      .object({
        episode_index: z.literal(1),
        title: z.literal("Almost"),
        assigned_test_id: z.literal("VIBE-001-UNDERSTAND"),
        self_authored_test_id: z.literal("VIBE-002-SELF-QUESTION"),
        target_runtime_seconds: z.literal(60),
      })
      .strict(),
  })
  .strict();

function generationTargetSchema<
  TSegment extends keyof typeof SEGMENT_TARGETS,
>(segmentId: TSegment) {
  const target = SEGMENT_TARGETS[segmentId];
  return z
    .object({
      segment_id: z.literal(segmentId),
      prompt_selector: z.literal(target.promptSelector),
      prompt_byte_length: z.literal(target.promptByteLength),
      prompt_utf8_sha256: z.literal(target.promptSha256),
      planned_content_seconds: z.literal(30),
      media_kind: z.literal("VIDEO"),
      output_candidate_state: z.literal(
        "UNTRUSTED_PROVIDER_OUTPUT_IF_LATER_GENERATED",
      ),
    })
    .strict();
}

const capabilitySnapshotSchema = z
  .object({
    snapshot_state: z.literal("REFERENCE_ONLY_STALE_AT_RUNTIME"),
    captured_on: z.literal("2026-09-02"),
    runtime_refresh_required: z.literal(true),
    runtime_refresh_performed: z.literal(false),
    sources: z.tuple([
      z.literal("https://docs.reactor.inc/authentication.md"),
      z.literal("https://docs.reactor.inc/concepts/recordings.md"),
      z.literal("https://docs.reactor.inc/concepts/sessions.md"),
      z.literal("https://docs.reactor.inc/model-api-reference/helios/overview.md"),
      z.literal("https://docs.reactor.inc/model-api-reference/helios/schema.md"),
    ]),
    sdk_package: z.literal("@reactor-team/js-sdk"),
    sdk_version_observed: z.literal("3.0.1"),
    model_package: z.literal("@reactor-models/helios"),
    model_package_version_observed: z.literal("1.0.1"),
    native_width: z.literal(640),
    native_height: z.literal(384),
    default_output_width: z.literal(1_280),
    default_output_height: z.literal(768),
    default_super_resolution: z.literal("2x"),
    chunk_frames: z.literal(33),
    output_track: z.literal("main_video"),
    output_media: z.tuple([z.literal("VIDEO")]),
    input_modes: z.tuple([
      z.literal("IMAGE_TO_VIDEO"),
      z.literal("TEXT_TO_VIDEO"),
    ]),
    observed_commands: z.tuple([
      z.literal("list_snapshots"),
      z.literal("pause"),
      z.literal("reset"),
      z.literal("resume"),
      z.literal("rewind"),
      z.literal("save_snapshot"),
      z.literal("schedule_prompt"),
      z.literal("set_conditioning"),
      z.literal("set_image"),
      z.literal("set_image_strength"),
      z.literal("set_prompt"),
      z.literal("set_seed"),
      z.literal("set_sr_scale"),
      z.literal("start"),
    ]),
  })
  .strict();

const pricingSnapshotSchema = z
  .object({
    snapshot_state: z.literal("REFERENCE_ONLY_STALE_AT_RUNTIME"),
    captured_on: z.literal("2026-09-02"),
    source: z.literal("https://api.reactor.inc/pricing"),
    catalog_model_name: z.literal("helios"),
    model_name: z.literal("reactor/helios"),
    credits_per_second: z.literal(17),
    credits_per_usd: z.literal(10_000),
    billing_basis: z.literal("READY_GPU_SESSION_WALL_CLOCK_SECONDS"),
    runtime_refresh_required: z.literal(true),
    runtime_refresh_performed: z.literal(false),
    snapshot_authorizes_spend: z.literal(false),
  })
  .strict();

const providerPlanSchema = z
  .object({
    provider: z.literal("REACTOR"),
    provider_role: z.literal("FIRST_GENERATION_BACKEND"),
    execution_family: z.literal("LIVE_MEDIA_SESSION"),
    model_name: z.literal("reactor/helios"),
    transport: z.literal("WEBRTC"),
    output_track: z.literal("main_video"),
    implementation_state: z.literal("NOT_IMPLEMENTED"),
  })
  .strict();

const budgetEnvelopeSchema = z
  .object({
    planned_content_seconds: z.literal(30),
    maximum_ready_session_seconds: z.literal(45),
    maximum_concurrent_sessions: z.literal(1),
    automatic_retry: z.literal(false),
    reference_estimated_max_credits: z.literal(765),
    reference_estimated_max_usd_micros: z.literal(76_500),
    approved_credits: z.literal(0),
    spend_authority: z.literal("NONE"),
    pricing_snapshot_authorizes_spend: z.literal(false),
  })
  .strict();

const executionControlsSchema = z
  .object({
    execution_state: z.literal("BLOCKED"),
    network_access: z.literal("DENIED"),
    api_key_handling: z.literal("NOT_PRESENT"),
    session_authorization: z.literal("NOT_MINTED"),
    session_creation: z.literal("NOT_ALLOWED"),
    webrtc_connection: z.literal("NOT_ALLOWED"),
    media_generation: z.literal("NOT_ALLOWED"),
    recording: z.literal("NOT_ALLOWED"),
    download: z.literal("NOT_ALLOWED"),
    recoverable_disconnect: z.literal(false),
    automatic_retry: z.literal(false),
    human_start_required: z.literal(true),
    human_terminate_required: z.literal(true),
    downloaded_exact_bytes_sha256_required: z.literal(true),
    allowed_commands: z.tuple([]),
  })
  .strict();

const effectsSchema = z
  .object({
    authoritative_state_change: z.literal("NONE"),
    generation: z.literal("NOT_PERFORMED"),
    network_requests: z.literal(0),
    persistence: z.literal("NONE"),
    production_gate: z.literal("UNCHANGED_PRODUCE_BLOCKED"),
    project_commit: z.literal(false),
    provider_call: z.literal(false),
    recording: z.literal("NOT_PERFORMED"),
    session_created: z.literal(false),
    source_admission: z.literal("NOT_PERFORMED"),
    spend_credits: z.literal(0),
    token_spend: z.literal(false),
    upload: z.literal(false),
    webrtc_connected: z.literal(false),
  })
  .strict();

const blockersSchema = z
  .array(z.enum(REACTOR_GENERATION_INTENT_BLOCKERS))
  .length(REACTOR_GENERATION_INTENT_BLOCKERS.length)
  .superRefine((blockers, ctx) => {
    REACTOR_GENERATION_INTENT_BLOCKERS.forEach((expected, index) => {
      if (blockers[index] !== expected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: "Blockers must preserve the exact canonical fail-closed order",
        });
      }
    });
  });

export const reactorGenerationIntentSchema = z
  .object({
    schema_version: z.literal("filmstack-reactor-generation-intent/v1"),
    intent_id: safeIdentifierSchema,
    created_at_ms: safeIntegerSchema,
    intent_state: z.literal("PROSPECTIVE_NOT_EXECUTABLE"),
    authority_state: z.literal("NO_EXTERNAL_AUTHORITY"),
    source_binding: z
      .object({
        tuple: exactSourceTupleSchema,
        tuple_hash: z.literal(SOURCE_TUPLE_SHA256),
        binding_state: z.literal(
          "EXACT_KNOWN_TUPLE_NOT_REVERIFIED_BY_THIS_CONTRACT",
        ),
      })
      .strict(),
    generation_target: z.discriminatedUnion("segment_id", [
      generationTargetSchema("EP01-A"),
      generationTargetSchema("EP01-B"),
    ]),
    provider_plan: providerPlanSchema,
    capability_snapshot: capabilitySnapshotSchema,
    pricing_snapshot: pricingSnapshotSchema,
    budget_envelope: budgetEnvelopeSchema,
    execution_controls: executionControlsSchema,
    blockers: blockersSchema,
    effects: effectsSchema,
    intent_hash: sha256Schema,
  })
  .strict()
  .superRefine((intent, ctx) => {
    if (
      intent.budget_envelope.planned_content_seconds !==
      intent.generation_target.planned_content_seconds
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["budget_envelope", "planned_content_seconds"],
        message: "Budget and generation target durations must match",
      });
    }
    if (
      intent.budget_envelope.reference_estimated_max_credits !==
      intent.pricing_snapshot.credits_per_second *
        intent.budget_envelope.maximum_ready_session_seconds
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["budget_envelope", "reference_estimated_max_credits"],
        message: "Reference credits must be exactly recomputable",
      });
    }
    const expectedMicros =
      (intent.budget_envelope.reference_estimated_max_credits * 1_000_000) /
      intent.pricing_snapshot.credits_per_usd;
    if (
      !Number.isSafeInteger(expectedMicros) ||
      intent.budget_envelope.reference_estimated_max_usd_micros !==
        expectedMicros
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["budget_envelope", "reference_estimated_max_usd_micros"],
        message: "Reference microdollars must be exactly recomputable",
      });
    }
  });

export type ReactorGenerationIntent = z.infer<
  typeof reactorGenerationIntentSchema
>;

export type LocalReactorGenerationIntentErrorCode =
  | "INVALID_FILE_TYPE"
  | "INVALID_FILE_NAME"
  | "INVALID_FILE_SIZE"
  | "FILE_TOO_LARGE"
  | "FILE_LENGTH_MISMATCH"
  | "INVALID_ENCODING"
  | "INVALID_JSON"
  | "INVALID_INTENT"
  | "SECRET_MATERIAL_FORBIDDEN"
  | "LOCAL_PATH_FORBIDDEN"
  | "HASH_UNAVAILABLE"
  | "INTENT_HASH_MISMATCH"
  | "SOURCE_TUPLE_HASH_MISMATCH"
  | "INVALID_EPISODE_PREVIEW"
  | "SOURCE_BINDING_MISMATCH"
  | "PROMPT_BINDING_MISMATCH"
  | "STALE_PREVIEW"
  | "INVALID_RECEIPT";

export class LocalReactorGenerationIntentError extends Error {
  readonly code: LocalReactorGenerationIntentErrorCode;

  constructor(code: LocalReactorGenerationIntentErrorCode, message: string) {
    super(message);
    this.name = "LocalReactorGenerationIntentError";
    this.code = code;
  }
}

export interface LocalReactorGenerationIntentPreview {
  readonly intent: ReactorGenerationIntent;
  readonly fileName: string;
  readonly byteLength: number;
  readonly fileSha256: string;
  readonly verification: {
    readonly intentFile: "EXACT_BYTES_VERIFIED";
    readonly schema: "STRICT_V1_SCHEMA_VERIFIED";
    readonly sourceBindings: "EXACT_LOADED_EPISODE_PREVIEW_MATCH";
    readonly prompt: "EXACT_UTF8_LENGTH_AND_SHA256_VERIFIED";
    readonly intentHash: "CANONICAL_PAYLOAD_HASH_VERIFIED";
    readonly sourceTupleHash: "CANONICAL_TUPLE_HASH_VERIFIED";
    readonly providerProfile: "EXACT_REACTOR_HELIOS_NON_EXECUTABLE_PROFILE";
    readonly runtimeCapabilities: "REFERENCE_ONLY_NOT_REFRESHED";
    readonly runtimePricing: "REFERENCE_ONLY_NOT_REFRESHED";
    readonly authority: "NO_EXTERNAL_AUTHORITY";
  };
  readonly bytes: ArrayBuffer;
}

interface ExactEpisodeBindingProjection {
  package: {
    package_id: unknown;
    record_state: unknown;
    authority_state: unknown;
    source_status: unknown;
    production_gate: unknown;
    generation_state: unknown;
    provider_state: unknown;
    source_binding: {
      package_id: unknown;
      file_name: unknown;
      byte_length: unknown;
      sha256: unknown;
    };
    screenplay_binding: {
      file_name: unknown;
      byte_length: unknown;
      sha256: unknown;
    };
    context_binding: {
      state: unknown;
      context_hash: unknown;
      admission_candidate: unknown;
    };
    episode: {
      episode_index: unknown;
      title: unknown;
      test_id: unknown;
      duration_seconds: unknown;
      assigned_test_id: unknown;
      self_authored_test_id: unknown;
    };
    prompt_preparation: {
      state: unknown;
      provider_neutral: unknown;
      generation_enabled: unknown;
      segments: Array<{
        segment_id: unknown;
        duration_seconds: unknown;
        visual_prompt: unknown;
      }>;
    };
  };
  manifest: {
    fileName: unknown;
    byteLength: unknown;
    sha256: unknown;
  };
  screenplay: {
    fileName: unknown;
    byteLength: unknown;
    sha256: unknown;
  };
  sourceStoryRoom: {
    fileName: unknown;
    byteLength: unknown;
    sha256: unknown;
    packageId: unknown;
    episodeIndex: unknown;
  };
  verification: Record<string, unknown>;
}

const loadedEpisodeBindingProjectionSchema = z
  .object({
    package: z
      .object({
        package_id: z.literal(ARCHI_PRODUCTION_SCRIPT_PACKAGE_ID),
        record_state: z.literal("PROSPECTIVE_DRAFT"),
        authority_state: z.literal("NO_EXTERNAL_AUTHORITY"),
        source_status: z.literal("EXACT_UPSTREAM_BYTES_VERIFIED_NOT_ADMITTED"),
        production_gate: z.literal("PRODUCE_BLOCKED"),
        generation_state: z.literal("DISABLED"),
        provider_state: z.literal("PROVIDER_NEUTRAL"),
        source_binding: z
          .object({
            package_id: z.literal(ARCHI_STORY_ROOM_PACKAGE_ID),
            file_name: z.literal("story-room-pack.v1.json"),
            byte_length: z.literal(33_517),
            sha256: z.literal(STORY_ROOM_SHA256),
          })
          .strict(),
        screenplay_binding: z
          .object({
            file_name: z.literal("EP01_ALMOST.fountain"),
            byte_length: z.literal(3_569),
            sha256: z.literal(FOUNTAIN_SHA256),
          })
          .strict(),
        context_binding: z
          .object({
            state: z.literal("UNBOUND"),
            context_hash: z.null(),
            admission_candidate: z.literal(false),
          })
          .strict(),
        episode: z
          .object({
            episode_index: z.literal(1),
            title: z.literal("Almost"),
            test_id: z.literal("VIBE-001-UNDERSTAND"),
            duration_seconds: z.literal(60),
            assigned_test_id: z.literal("VIBE-001-UNDERSTAND"),
            self_authored_test_id: z.literal("VIBE-002-SELF-QUESTION"),
          })
          .strict(),
        prompt_preparation: z
          .object({
            state: z.literal("DRAFTED_NOT_AUTHORIZED"),
            provider_neutral: z.literal(true),
            generation_enabled: z.literal(false),
            segments: z.tuple([
              z
                .object({
                  segment_id: z.literal("EP01-A"),
                  duration_seconds: z.literal(30),
                  visual_prompt: z.string().min(1).max(20_000),
                })
                .strict(),
              z
                .object({
                  segment_id: z.literal("EP01-B"),
                  duration_seconds: z.literal(30),
                  visual_prompt: z.string().min(1).max(20_000),
                })
                .strict(),
            ]),
          })
          .strict(),
      })
      .strict(),
    manifest: z
      .object({
        fileName: z.literal("episode-production-script-pack.v1.json"),
        byteLength: z.literal(14_290),
        sha256: z.literal(MANIFEST_SHA256),
      })
      .strict(),
    screenplay: z
      .object({
        fileName: z.literal("EP01_ALMOST.fountain"),
        byteLength: z.literal(3_569),
        sha256: z.literal(FOUNTAIN_SHA256),
      })
      .strict(),
    sourceStoryRoom: z
      .object({
        fileName: z.literal("story-room-pack.v1.json"),
        byteLength: z.literal(33_517),
        sha256: z.literal(STORY_ROOM_SHA256),
        packageId: z.literal(ARCHI_STORY_ROOM_PACKAGE_ID),
        episodeIndex: z.literal(1),
      })
      .strict(),
    verification: z
      .object({
        manifest: z.literal("STRICT_SCHEMA_AND_EXACT_BYTES_VERIFIED"),
        screenplay: z.literal("EXACT_FILENAME_LENGTH_AND_SHA256_VERIFIED"),
        storyRoom: z.literal("EXACT_LOADED_PREVIEW_VERIFIED"),
        episodeSlice: z.literal("SOURCE_FIELDS_EXACTLY_VERIFIED"),
        relativePaths: z.literal("DECLARATIVE_ONLY_NOT_RESOLVED"),
        fountainParser: z.literal("NOT_USED"),
      })
      .strict(),
  })
  .strict();

function projectLoadedEpisodePreview(
  preview: LocalEpisodeProductionScriptPreview,
): ExactEpisodeBindingProjection {
  const pack = preview?.pack;
  return {
    package: {
      package_id: pack?.package_id,
      record_state: pack?.record_state,
      authority_state: pack?.authority_state,
      source_status: pack?.source_status,
      production_gate: pack?.production_gate,
      generation_state: pack?.generation_state,
      provider_state: pack?.provider_state,
      source_binding: {
        package_id: pack?.source_binding?.package_id,
        file_name: pack?.source_binding?.file_name,
        byte_length: pack?.source_binding?.byte_length,
        sha256: pack?.source_binding?.sha256,
      },
      screenplay_binding: {
        file_name: pack?.screenplay_binding?.file_name,
        byte_length: pack?.screenplay_binding?.byte_length,
        sha256: pack?.screenplay_binding?.sha256,
      },
      context_binding: {
        state: pack?.context_binding?.state,
        context_hash: pack?.context_binding?.context_hash,
        admission_candidate: pack?.context_binding?.admission_candidate,
      },
      episode: {
        episode_index: pack?.episode?.episode_index,
        title: pack?.episode?.title,
        test_id: pack?.episode?.test_id,
        duration_seconds: pack?.episode?.duration_seconds,
        assigned_test_id: pack?.episode?.assigned_test?.test_id,
        self_authored_test_id: pack?.episode?.self_authored_test?.test_id,
      },
      prompt_preparation: {
        state: pack?.prompt_preparation?.state,
        provider_neutral: pack?.prompt_preparation?.provider_neutral,
        generation_enabled: pack?.prompt_preparation?.generation_enabled,
        segments: (pack?.prompt_preparation?.segments ?? []).map((segment) => ({
          segment_id: segment.segment_id,
          duration_seconds: segment.duration_seconds,
          visual_prompt: segment.visual_prompt,
        })),
      },
    },
    manifest: {
      fileName: preview?.manifest?.fileName,
      byteLength: preview?.manifest?.byteLength,
      sha256: preview?.manifest?.sha256,
    },
    screenplay: {
      fileName: preview?.screenplay?.fileName,
      byteLength: preview?.screenplay?.byteLength,
      sha256: preview?.screenplay?.sha256,
    },
    sourceStoryRoom: {
      fileName: preview?.sourceStoryRoom?.fileName,
      byteLength: preview?.sourceStoryRoom?.byteLength,
      sha256: preview?.sourceStoryRoom?.sha256,
      packageId: preview?.sourceStoryRoom?.packageId,
      episodeIndex: preview?.sourceStoryRoom?.episodeIndex,
    },
    verification: {
      manifest: preview?.verification?.manifest,
      screenplay: preview?.verification?.screenplay,
      storyRoom: preview?.verification?.storyRoom,
      episodeSlice: preview?.verification?.episodeSlice,
      relativePaths: preview?.verification?.relativePaths,
      fountainParser: preview?.verification?.fountainParser,
    },
  };
}

async function verifyIntentAgainstLoadedEpisode(
  intent: ReactorGenerationIntent,
  episodePreview: LocalEpisodeProductionScriptPreview,
): Promise<void> {
  const projected = loadedEpisodeBindingProjectionSchema.safeParse(
    projectLoadedEpisodePreview(episodePreview),
  );
  if (!projected.success) {
    throw new LocalReactorGenerationIntentError(
      "INVALID_EPISODE_PREVIEW",
      "Load the exact current ARCHi Episode 1 production-script preview before inspecting this Reactor intent.",
    );
  }
  const tuple = intent.source_binding.tuple;
  const comparisons: readonly [unknown, unknown, string][] = [
    [tuple.story_room_pack.package_id, projected.data.package.source_binding.package_id, "story_room_pack.package_id"],
    [tuple.story_room_pack.file_name, projected.data.sourceStoryRoom.fileName, "story_room_pack.file_name"],
    [tuple.story_room_pack.byte_length, projected.data.sourceStoryRoom.byteLength, "story_room_pack.byte_length"],
    [tuple.story_room_pack.sha256, projected.data.sourceStoryRoom.sha256, "story_room_pack.sha256"],
    [tuple.production_script_manifest.package_id, projected.data.package.package_id, "production_script_manifest.package_id"],
    [tuple.production_script_manifest.file_name, projected.data.manifest.fileName, "production_script_manifest.file_name"],
    [tuple.production_script_manifest.byte_length, projected.data.manifest.byteLength, "production_script_manifest.byte_length"],
    [tuple.production_script_manifest.sha256, projected.data.manifest.sha256, "production_script_manifest.sha256"],
    [tuple.fountain.file_name, projected.data.screenplay.fileName, "fountain.file_name"],
    [tuple.fountain.byte_length, projected.data.screenplay.byteLength, "fountain.byte_length"],
    [tuple.fountain.sha256, projected.data.screenplay.sha256, "fountain.sha256"],
    [tuple.episode.episode_index, projected.data.package.episode.episode_index, "episode.episode_index"],
    [tuple.episode.title, projected.data.package.episode.title, "episode.title"],
    [tuple.episode.assigned_test_id, projected.data.package.episode.assigned_test_id, "episode.assigned_test_id"],
    [tuple.episode.self_authored_test_id, projected.data.package.episode.self_authored_test_id, "episode.self_authored_test_id"],
    [tuple.episode.target_runtime_seconds, projected.data.package.episode.duration_seconds, "episode.target_runtime_seconds"],
  ];
  const mismatch = comparisons.find(([actual, expected]) => actual !== expected);
  if (mismatch) {
    throw new LocalReactorGenerationIntentError(
      "SOURCE_BINDING_MISMATCH",
      `The Reactor intent does not match the exact loaded Episode 1 preview at ${mismatch[2]}.`,
    );
  }

  const segments = projected.data.package.prompt_preparation.segments as readonly {
    segment_id: "EP01-A" | "EP01-B";
    duration_seconds: 30;
    visual_prompt: string;
  }[];
  const segment = segments.find(
    (candidate) => candidate.segment_id === intent.generation_target.segment_id,
  );
  if (!segment) {
    throw new LocalReactorGenerationIntentError(
      "PROMPT_BINDING_MISMATCH",
      "The Reactor target segment is absent from the exact loaded Episode 1 preview.",
    );
  }
  const promptBytes = new TextEncoder().encode(segment.visual_prompt);
  const promptSha256 = await sha256ArrayBuffer(promptBytes.buffer);
  if (
    promptBytes.byteLength !== intent.generation_target.prompt_byte_length ||
    promptSha256 !== intent.generation_target.prompt_utf8_sha256 ||
    segment.duration_seconds !== intent.generation_target.planned_content_seconds
  ) {
    throw new LocalReactorGenerationIntentError(
      "PROMPT_BINDING_MISMATCH",
      "The Reactor target does not match the exact UTF-8 prompt bytes and duration in the loaded Episode 1 preview.",
    );
  }
}

function formatIntentIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 6)
    .map((issue) => `${issue.path.join(".") || "intent"}: ${issue.message}`)
    .join(" · ");
}

function intentHashPayload(intent: ReactorGenerationIntent): unknown {
  const payload = JSON.parse(canonicalReactorJson(intent)) as Record<
    string,
    unknown
  >;
  delete payload.intent_hash;
  return payload;
}

export async function readLocalReactorGenerationIntent(
  file: LocalReadableFile,
  episodePreview: LocalEpisodeProductionScriptPreview,
): Promise<LocalReactorGenerationIntentPreview> {
  if (
    file.name.length > MAX_PORTABLE_BASENAME_LENGTH ||
    !JSON_BASENAME_PATTERN.test(file.name) ||
    hasInlineControl(file.name)
  ) {
    throw new LocalReactorGenerationIntentError(
      file.name.toLowerCase().endsWith(".json")
        ? "INVALID_FILE_NAME"
        : "INVALID_FILE_TYPE",
      "Choose a safe basename-only Reactor generation-intent JSON file.",
    );
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new LocalReactorGenerationIntentError(
      "INVALID_FILE_SIZE",
      "The selected Reactor intent has an invalid declared byte length.",
    );
  }
  if (file.size > MAX_REACTOR_GENERATION_INTENT_BYTES) {
    throw new LocalReactorGenerationIntentError(
      "FILE_TOO_LARGE",
      "The selected Reactor intent exceeds the 64 KiB local-inspection limit.",
    );
  }

  const bytes = exactArrayBuffer(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) {
    throw new LocalReactorGenerationIntentError(
      "FILE_LENGTH_MISMATCH",
      "The Reactor intent byte length changed while the file was being read.",
    );
  }
  if (bytes.byteLength > MAX_REACTOR_GENERATION_INTENT_BYTES) {
    throw new LocalReactorGenerationIntentError(
      "FILE_TOO_LARGE",
      "The selected Reactor intent exceeds the 64 KiB local-inspection limit.",
    );
  }

  const raw = new Uint8Array(bytes);
  if (raw.byteLength >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    throw new LocalReactorGenerationIntentError(
      "INVALID_ENCODING",
      "The Reactor intent must not contain a UTF-8 byte-order mark.",
    );
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new LocalReactorGenerationIntentError(
      "INVALID_ENCODING",
      "The selected Reactor intent is not valid UTF-8 JSON.",
    );
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    throw new LocalReactorGenerationIntentError(
      "INVALID_JSON",
      "The selected Reactor intent is not valid JSON.",
    );
  }
  assertNoSecretOrLocalPathMaterial(parsedJson);
  const parsed = reactorGenerationIntentSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new LocalReactorGenerationIntentError(
      "INVALID_INTENT",
      `The JSON does not match the exact non-executable Reactor intent contract. ${formatIntentIssues(parsed.error)}`,
    );
  }
  const intent = parsed.data;
  const [fileSha256, tupleSha256, observedIntentHash] = await Promise.all([
    sha256ArrayBuffer(bytes),
    sha256Utf8(canonicalReactorJson(intent.source_binding.tuple)),
    sha256Utf8(canonicalReactorJson(intentHashPayload(intent))),
  ]);
  if (tupleSha256 !== intent.source_binding.tuple_hash) {
    throw new LocalReactorGenerationIntentError(
      "SOURCE_TUPLE_HASH_MISMATCH",
      "The Reactor source tuple does not match its canonical SHA-256.",
    );
  }
  if (observedIntentHash !== intent.intent_hash) {
    throw new LocalReactorGenerationIntentError(
      "INTENT_HASH_MISMATCH",
      "The Reactor intent does not match its canonical payload SHA-256.",
    );
  }
  await verifyIntentAgainstLoadedEpisode(intent, episodePreview);

  const retainedBytes = bytes.slice(0);
  const frozenIntent = deepFreeze(intent);
  const verification = deepFreeze({
    intentFile: "EXACT_BYTES_VERIFIED" as const,
    schema: "STRICT_V1_SCHEMA_VERIFIED" as const,
    sourceBindings: "EXACT_LOADED_EPISODE_PREVIEW_MATCH" as const,
    prompt: "EXACT_UTF8_LENGTH_AND_SHA256_VERIFIED" as const,
    intentHash: "CANONICAL_PAYLOAD_HASH_VERIFIED" as const,
    sourceTupleHash: "CANONICAL_TUPLE_HASH_VERIFIED" as const,
    providerProfile: "EXACT_REACTOR_HELIOS_NON_EXECUTABLE_PROFILE" as const,
    runtimeCapabilities: "REFERENCE_ONLY_NOT_REFRESHED" as const,
    runtimePricing: "REFERENCE_ONLY_NOT_REFRESHED" as const,
    authority: "NO_EXTERNAL_AUTHORITY" as const,
  });
  return Object.freeze({
    intent: frozenIntent,
    fileName: file.name,
    byteLength: bytes.byteLength,
    fileSha256,
    verification,
    get bytes() {
      return retainedBytes.slice(0);
    },
  });
}

export async function reverifyLocalReactorGenerationIntentPreview(
  preview: LocalReactorGenerationIntentPreview,
  episodePreview: LocalEpisodeProductionScriptPreview,
): Promise<LocalReactorGenerationIntentPreview> {
  const retainedBytes = preview.bytes.slice(0);
  let reverified: LocalReactorGenerationIntentPreview;
  try {
    reverified = await readLocalReactorGenerationIntent(
      {
        name: preview.fileName,
        size: retainedBytes.byteLength,
        async arrayBuffer() {
          return retainedBytes.slice(0);
        },
      },
      episodePreview,
    );
  } catch (error) {
    if (
      error instanceof LocalReactorGenerationIntentError &&
      error.code === "HASH_UNAVAILABLE"
    ) {
      throw error;
    }
    throw new LocalReactorGenerationIntentError(
      "STALE_PREVIEW",
      "The retained Reactor intent can no longer be verified against its exact bytes and loaded Episode 1 preview.",
    );
  }
  if (
    preview.byteLength !== reverified.byteLength ||
    preview.fileSha256 !== reverified.fileSha256 ||
    canonicalReactorJson(preview.intent) !==
      canonicalReactorJson(reverified.intent) ||
    canonicalReactorJson(preview.verification) !==
      canonicalReactorJson(reverified.verification)
  ) {
    throw new LocalReactorGenerationIntentError(
      "STALE_PREVIEW",
      "The retained Reactor intent preview drifted from its exact selected bytes.",
    );
  }
  return reverified;
}

const receiptEffectsSchema = z
  .object({
    authoritative_state_change: z.literal("NONE"),
    receipt_output: z.literal("LOCAL_EXPORT_ONLY"),
    source_admission: z.literal("NOT_PERFORMED"),
    generation: z.literal("NOT_PERFORMED"),
    recording: z.literal("NOT_PERFORMED"),
    network_requests: z.literal(0),
    persistence: z.literal("NONE"),
    production_gate: z.literal("UNCHANGED_PRODUCE_BLOCKED"),
    project_commit: z.literal(false),
    provider_call: z.literal(false),
    session_created: z.literal(false),
    spend_credits: z.literal(0),
    token_spend: z.literal(false),
    upload: z.literal(false),
    webrtc_connected: z.literal(false),
  })
  .strict();

export const reactorGenerationIntentInspectionReceiptSchema = z
  .object({
    schema_version: z.literal(
      "filmstack-reactor-generation-intent-inspection-receipt/v1",
    ),
    receipt_state: z.literal("LOCAL_INSPECTION_RECEIPT"),
    authority_state: z.literal("NO_EXTERNAL_AUTHORITY"),
    inspection_scope: z.literal(
      "PROSPECTIVE_REACTOR_GENERATION_INTENT_ONLY",
    ),
    determinism: z.literal("SAME_EXACT_INPUTS_SAME_BYTES"),
    intent_file: z
      .object({
        file_name: safeJsonBasenameSchema,
        byte_length: z.number().int().positive().max(MAX_REACTOR_GENERATION_INTENT_BYTES),
        sha256: sha256Schema,
        verification: z.literal("EXACT_BYTES_REVERIFIED"),
      })
      .strict(),
    intent_binding: z
      .object({
        schema_version: z.literal("filmstack-reactor-generation-intent/v1"),
        intent_id: safeIdentifierSchema,
        created_at_ms: safeIntegerSchema,
        intent_hash: sha256Schema,
        intent_hash_verification: z.literal(
          "CANONICAL_PAYLOAD_HASH_REVERIFIED",
        ),
        source_tuple_hash: z.literal(SOURCE_TUPLE_SHA256),
        source_tuple_hash_verification: z.literal(
          "CANONICAL_TUPLE_HASH_REVERIFIED",
        ),
        source_binding_verification: z.literal(
          "EXACT_LOADED_EPISODE_PREVIEW_MATCH",
        ),
        kernel_origin_verification: z.literal("NOT_VERIFIED_BY_BROWSER"),
        segment_id: z.enum(["EP01-A", "EP01-B"]),
        prompt_selector: z.enum([
          SEGMENT_TARGETS["EP01-A"].promptSelector,
          SEGMENT_TARGETS["EP01-B"].promptSelector,
        ]),
        prompt_byte_length: z.union([z.literal(819), z.literal(824)]),
        prompt_utf8_sha256: z.enum([
          SEGMENT_TARGETS["EP01-A"].promptSha256,
          SEGMENT_TARGETS["EP01-B"].promptSha256,
        ]),
        prompt_verification: z.literal(
          "EXACT_UTF8_LENGTH_AND_SHA256_REVERIFIED",
        ),
      })
      .strict(),
    provider_profile: providerPlanSchema.extend({
      verification: z.literal(
        "EXACT_REACTOR_HELIOS_NON_EXECUTABLE_PROFILE",
      ),
    }).strict(),
    reference_pricing: z
      .object({
        captured_on: z.literal("2026-09-02"),
        credits_per_second: z.literal(17),
        credits_per_usd: z.literal(10_000),
        maximum_ready_session_seconds: z.literal(45),
        reference_estimated_max_credits: z.literal(765),
        reference_estimated_max_usd_micros: z.literal(76_500),
        verification: z.literal(
          "REFERENCE_ONLY_NOT_REFRESHED_NOT_SPEND_AUTHORITY",
        ),
      })
      .strict(),
    blockers: blockersSchema,
    effects: receiptEffectsSchema,
  })
  .strict()
  .superRefine((receipt, ctx) => {
    const target = SEGMENT_TARGETS[receipt.intent_binding.segment_id];
    if (
      receipt.intent_binding.prompt_selector !== target.promptSelector ||
      receipt.intent_binding.prompt_byte_length !== target.promptByteLength ||
      receipt.intent_binding.prompt_utf8_sha256 !== target.promptSha256
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["intent_binding"],
        message: "Receipt prompt binding must match its exact target segment",
      });
    }
  });

export type ReactorGenerationIntentInspectionReceipt = z.infer<
  typeof reactorGenerationIntentInspectionReceiptSchema
>;

export async function buildLocalReactorGenerationIntentInspectionReceipt(
  preview: LocalReactorGenerationIntentPreview,
  episodePreview: LocalEpisodeProductionScriptPreview,
): Promise<ReactorGenerationIntentInspectionReceipt> {
  const reverified = await reverifyLocalReactorGenerationIntentPreview(
    preview,
    episodePreview,
  );
  const { intent } = reverified;
  const receipt = {
    schema_version:
      "filmstack-reactor-generation-intent-inspection-receipt/v1" as const,
    receipt_state: "LOCAL_INSPECTION_RECEIPT" as const,
    authority_state: "NO_EXTERNAL_AUTHORITY" as const,
    inspection_scope:
      "PROSPECTIVE_REACTOR_GENERATION_INTENT_ONLY" as const,
    determinism: "SAME_EXACT_INPUTS_SAME_BYTES" as const,
    intent_file: {
      file_name: reverified.fileName,
      byte_length: reverified.byteLength,
      sha256: reverified.fileSha256,
      verification: "EXACT_BYTES_REVERIFIED" as const,
    },
    intent_binding: {
      schema_version: intent.schema_version,
      intent_id: intent.intent_id,
      created_at_ms: intent.created_at_ms,
      intent_hash: intent.intent_hash,
      intent_hash_verification:
        "CANONICAL_PAYLOAD_HASH_REVERIFIED" as const,
      source_tuple_hash: intent.source_binding.tuple_hash,
      source_tuple_hash_verification:
        "CANONICAL_TUPLE_HASH_REVERIFIED" as const,
      source_binding_verification:
        "EXACT_LOADED_EPISODE_PREVIEW_MATCH" as const,
      kernel_origin_verification: "NOT_VERIFIED_BY_BROWSER" as const,
      segment_id: intent.generation_target.segment_id,
      prompt_selector: intent.generation_target.prompt_selector,
      prompt_byte_length: intent.generation_target.prompt_byte_length,
      prompt_utf8_sha256: intent.generation_target.prompt_utf8_sha256,
      prompt_verification:
        "EXACT_UTF8_LENGTH_AND_SHA256_REVERIFIED" as const,
    },
    provider_profile: {
      ...intent.provider_plan,
      verification:
        "EXACT_REACTOR_HELIOS_NON_EXECUTABLE_PROFILE" as const,
    },
    reference_pricing: {
      captured_on: intent.pricing_snapshot.captured_on,
      credits_per_second: intent.pricing_snapshot.credits_per_second,
      credits_per_usd: intent.pricing_snapshot.credits_per_usd,
      maximum_ready_session_seconds:
        intent.budget_envelope.maximum_ready_session_seconds,
      reference_estimated_max_credits:
        intent.budget_envelope.reference_estimated_max_credits,
      reference_estimated_max_usd_micros:
        intent.budget_envelope.reference_estimated_max_usd_micros,
      verification:
        "REFERENCE_ONLY_NOT_REFRESHED_NOT_SPEND_AUTHORITY" as const,
    },
    blockers: [...intent.blockers],
    effects: {
      authoritative_state_change: "NONE" as const,
      receipt_output: "LOCAL_EXPORT_ONLY" as const,
      source_admission: "NOT_PERFORMED" as const,
      generation: "NOT_PERFORMED" as const,
      recording: "NOT_PERFORMED" as const,
      network_requests: 0 as const,
      persistence: "NONE" as const,
      production_gate: "UNCHANGED_PRODUCE_BLOCKED" as const,
      project_commit: false as const,
      provider_call: false as const,
      session_created: false as const,
      spend_credits: 0 as const,
      token_spend: false as const,
      upload: false as const,
      webrtc_connected: false as const,
    },
  };
  const parsed = reactorGenerationIntentInspectionReceiptSchema.safeParse(
    receipt,
  );
  if (!parsed.success) {
    throw new LocalReactorGenerationIntentError(
      "INVALID_RECEIPT",
      `The local Reactor inspection receipt is invalid. ${formatIntentIssues(parsed.error)}`,
    );
  }
  return deepFreeze(parsed.data);
}

export function serializeReactorGenerationIntentInspectionReceipt(
  receipt: ReactorGenerationIntentInspectionReceipt,
): string {
  const parsed = reactorGenerationIntentInspectionReceiptSchema.safeParse(
    receipt,
  );
  if (!parsed.success) {
    throw new LocalReactorGenerationIntentError(
      "INVALID_RECEIPT",
      `The local Reactor inspection receipt is invalid. ${formatIntentIssues(parsed.error)}`,
    );
  }
  return `${canonicalReactorJson(parsed.data)}\n`;
}
