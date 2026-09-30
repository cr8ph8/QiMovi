import { z } from "zod";
import {
  MAX_STORY_ROOM_PACK_BYTES,
  STORY_ROOM_RESULTS,
  storyRoomPackSchema,
  type LocalStoryRoomPackPreview,
  type StoryRoomPack,
} from "./storyRoomPack";

export const MAX_EPISODE_PRODUCTION_SCRIPT_MANIFEST_BYTES = 512 * 1024;
export const MAX_EPISODE_PRODUCTION_SCRIPT_FOUNTAIN_BYTES = 512 * 1024;
export const MAX_EPISODE_PRODUCTION_SCRIPT_CHARACTERS = 12;
export const MAX_EPISODE_PRODUCTION_SCRIPT_BEATS = 12;
export const MAX_EPISODE_PRODUCTION_SCRIPT_PROMPT_SEGMENTS = 4;
export const MAX_EPISODE_PRODUCTION_SCRIPT_SCREEN_TEXT_ITEMS = 24;
export const MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_REQUIREMENTS = 12;

const MAX_EPISODE_DURATION_SECONDS = 24 * 60 * 60;

const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Expected a lowercase 64-character SHA-256 hash");

const boundedText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, "Cannot be blank");

const resultSchema = z.enum(STORY_ROOM_RESULTS);

const sourceBindingSchema = z
  .object({
    package_id: boundedText(200),
    file_name: boundedText(255),
    // Declarative package metadata only. The local reader never resolves this value.
    relative_path: boundedText(2_000),
    relative_path_basis: z.literal("PACKAGE_ROOT_DECLARATIVE_ONLY"),
    byte_length: z.number().int().positive().max(MAX_STORY_ROOM_PACK_BYTES),
    sha256: sha256Schema,
    verification: z.literal("EXACT_LOCAL_BYTES_VERIFIED"),
    selection: boundedText(200),
    source_record_state: z.literal("PROSPECTIVE_DRAFT"),
    source_authority_state: z.literal("NO_EXTERNAL_AUTHORITY"),
  })
  .strict();

const screenplayBindingSchema = z
  .object({
    file_name: boundedText(255),
    // Declarative package metadata only. The local reader never resolves this value.
    relative_path: boundedText(2_000),
    relative_path_basis: z.literal("PACKAGE_ROOT_DECLARATIVE_ONLY"),
    byte_length: z
      .number()
      .int()
      .positive()
      .max(MAX_EPISODE_PRODUCTION_SCRIPT_FOUNTAIN_BYTES),
    sha256: sha256Schema,
    format: z.literal("Fountain 1.1-compatible plain text"),
    draft_state: z.literal("PROSPECTIVE_DRAFT"),
    dialogue_state: z.literal("DRAFTED_FOR_HUMAN_REVIEW"),
    timing_state: z.literal("TARGET_TIMECODES_NOT_EDIT_CONFIRMED"),
  })
  .strict();

const testSchema = z
  .object({
    test_id: boundedText(100),
    test_prompt: boundedText(5_000),
    result: resultSchema,
  })
  .strict();

const productionCharacterSchema = z
  .object({
    character_id: boundedText(100),
    name: boundedText(200),
    role: boundedText(1_000),
    episode_function: boundedText(2_000),
  })
  .strict();

const productionBeatSchema = z
  .object({
    beat_index: z.number().int().positive().max(MAX_EPISODE_PRODUCTION_SCRIPT_BEATS),
    script_label: boundedText(500),
    start_seconds: z.number().finite().nonnegative().max(MAX_EPISODE_DURATION_SECONDS),
    end_seconds: z.number().finite().positive().max(MAX_EPISODE_DURATION_SECONDS),
    duration_seconds: z.number().finite().positive().max(MAX_EPISODE_DURATION_SECONDS),
    source_label: boundedText(500),
    objective: boundedText(5_000),
    turn: boundedText(5_000),
    consequence: boundedText(5_000),
    result: resultSchema.optional(),
  })
  .strict()
  .superRefine((beat, ctx) => {
    if (beat.end_seconds <= beat.start_seconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end_seconds"],
        message: "Beat end_seconds must be greater than start_seconds",
      });
    }
    if (beat.duration_seconds !== beat.end_seconds - beat.start_seconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["duration_seconds"],
        message: "Beat duration_seconds must equal end_seconds minus start_seconds",
      });
    }
  });

const promptSegmentSchema = z
  .object({
    segment_id: boundedText(100),
    title: boundedText(500),
    start_seconds: z.number().finite().nonnegative().max(MAX_EPISODE_DURATION_SECONDS),
    end_seconds: z.number().finite().positive().max(MAX_EPISODE_DURATION_SECONDS),
    duration_seconds: z.number().finite().positive().max(MAX_EPISODE_DURATION_SECONDS),
    connected_to: boundedText(100).optional(),
    connected_from: boundedText(100).optional(),
    source_story_event: boundedText(5_000),
    emotional_objective: boundedText(5_000),
    visual_prompt: boundedText(20_000),
    camera_and_motion: z.array(boundedText(2_000)).min(1).max(20),
    sound_and_dialogue: z.array(boundedText(2_000)).min(1).max(20),
    continuity_in: boundedText(5_000),
    continuity_out: boundedText(5_000),
    terminal_frame: boundedText(5_000),
    negative_constraints: z.array(boundedText(2_000)).min(1).max(20),
  })
  .strict()
  .superRefine((segment, ctx) => {
    if (segment.end_seconds <= segment.start_seconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end_seconds"],
        message: "Prompt segment end_seconds must be greater than start_seconds",
      });
    }
    if (segment.duration_seconds !== segment.end_seconds - segment.start_seconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["duration_seconds"],
        message: "Prompt segment duration_seconds must equal end_seconds minus start_seconds",
      });
    }
  });

const episodeSchema = z
  .object({
    episode_index: z.number().int().positive().max(10_000),
    title: boundedText(500),
    test_id: boundedText(100),
    duration_seconds: z.number().finite().positive().max(MAX_EPISODE_DURATION_SECONDS),
    result: resultSchema,
    pov: boundedText(500),
    logline: boundedText(5_000),
    archi_objective: boundedText(5_000),
    continuity_in: boundedText(5_000),
    continuity_out: boundedText(5_000),
    state_delta: boundedText(5_000),
    assigned_test: testSchema,
    self_authored_test: testSchema,
    characters: z
      .array(productionCharacterSchema)
      .min(1)
      .max(MAX_EPISODE_PRODUCTION_SCRIPT_CHARACTERS),
    beats: z.array(productionBeatSchema).min(1).max(MAX_EPISODE_PRODUCTION_SCRIPT_BEATS),
  })
  .strict();

const screenTextSchema = z
  .object({
    order: z.number().int().positive().max(MAX_EPISODE_PRODUCTION_SCRIPT_SCREEN_TEXT_ITEMS),
    text: boundedText(5_000),
    authority: z.enum([
      "ASSIGNED_TEST_FROM_SOURCE_PACK",
      "SELF_AUTHORED_TEST_FROM_SOURCE_PACK",
      "RESULT_FROM_SOURCE_PACK",
      "PROSPECTIVE_SCREEN_DIRECTION",
    ]),
  })
  .strict();

const inspectionSchema = z
  .object({
    state: z.literal("LOCAL_FILE_READY_FOR_FUTURE_CONTRACTED_INSPECTION"),
    current_parser_support: z.literal("NOT_CLAIMED"),
    pairing_policy: z.literal("REQUIRE_EXACT_FILENAME_BYTE_LENGTH_AND_SHA256"),
    parser_derived_stats_authoritative: z.literal(false),
    integrity_envelope: z
      .object({
        hash_algorithm: z.literal("SHA-256"),
        story_room_pack_sha256: sha256Schema,
        screenplay_filename: boundedText(255),
        screenplay_byte_length: z
          .number()
          .int()
          .positive()
          .max(MAX_EPISODE_PRODUCTION_SCRIPT_FOUNTAIN_BYTES),
        screenplay_sha256: sha256Schema,
        episode_index: z.number().int().positive().max(10_000),
        episode_title: boundedText(500),
        test_id: boundedText(100),
        mismatch_behavior: z.literal("REJECT_PAIR"),
      })
      .strict(),
    upload: z.literal("DISABLED"),
    persistence: z.literal("DISABLED"),
    model_call: z.literal("DISABLED"),
    token_spend: z.literal("DISABLED"),
    expected_counts: z
      .object({
        episodes: z.literal(1),
        characters: z.number().int().positive().max(MAX_EPISODE_PRODUCTION_SCRIPT_CHARACTERS),
        beats: z.number().int().positive().max(MAX_EPISODE_PRODUCTION_SCRIPT_BEATS),
        prompt_segments: z
          .number()
          .int()
          .positive()
          .max(MAX_EPISODE_PRODUCTION_SCRIPT_PROMPT_SEGMENTS),
        assigned_tests: z.literal(1),
        self_authored_tests: z.literal(1),
      })
      .strict(),
  })
  .strict();

export const episodeProductionScriptPackSchema = z
  .object({
    schema_version: z.literal("filmstack-episode-production-script-pack/v1"),
    package_id: boundedText(200),
    record_state: z.literal("PROSPECTIVE_DRAFT"),
    authority_state: z.literal("NO_EXTERNAL_AUTHORITY"),
    source_status: z.literal("EXACT_UPSTREAM_BYTES_VERIFIED_NOT_ADMITTED"),
    production_gate: z.literal("PRODUCE_BLOCKED"),
    generation_state: z.literal("DISABLED"),
    provider_state: z.literal("PROVIDER_NEUTRAL"),
    relationship_to_source: z.literal("DERIVED_EPISODE_SLICE_DOES_NOT_SUPERSEDE"),
    title: boundedText(500),
    format: boundedText(500),
    target_runtime_seconds: z.number().finite().positive().max(MAX_EPISODE_DURATION_SECONDS),
    source_binding: sourceBindingSchema,
    screenplay_binding: screenplayBindingSchema,
    context_binding: z
      .object({
        state: z.literal("UNBOUND"),
        project_id: z.null(),
        entry_id: z.null(),
        context_hash: z.null(),
        admission_candidate: z.literal(false),
      })
      .strict(),
    episode: episodeSchema,
    screen_text: z
      .array(screenTextSchema)
      .min(1)
      .max(MAX_EPISODE_PRODUCTION_SCRIPT_SCREEN_TEXT_ITEMS),
    prompt_preparation: z
      .object({
        state: z.literal("DRAFTED_NOT_AUTHORIZED"),
        provider_neutral: z.literal(true),
        generation_enabled: z.literal(false),
        segment_count: z
          .number()
          .int()
          .positive()
          .max(MAX_EPISODE_PRODUCTION_SCRIPT_PROMPT_SEGMENTS),
        segments: z
          .array(promptSegmentSchema)
          .min(1)
          .max(MAX_EPISODE_PRODUCTION_SCRIPT_PROMPT_SEGMENTS),
        cross_segment_continuity: z
          .object({
            boundary_seconds: z
              .number()
              .finite()
              .positive()
              .max(MAX_EPISODE_DURATION_SECONDS),
            transition: z.literal("CONTINUOUS_MATCH_FRAME"),
            required_matches: z.array(boundedText(2_000)).min(1).max(20),
            forbidden_transition: boundedText(2_000),
          })
          .strict(),
      })
      .strict(),
    reference_requirements: z
      .array(
        z
          .object({
            item: boundedText(1_000),
            state: z.enum(["MISSING_APPROVAL", "NOT_LOCKED"]),
          })
          .strict(),
      )
      .max(MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_REQUIREMENTS),
    caniscreenwrite_inspection: inspectionSchema,
    effects: z
      .object({
        source_admission: z.literal("UNCHANGED_NOT_READY"),
        canon: z.literal("UNCHANGED_NOT_ADMITTED"),
        project_state: z.literal("UNCHANGED"),
        production_gate: z.literal("UNCHANGED_PRODUCE_BLOCKED"),
        generation: z.literal("NOT_PERFORMED"),
        provider_call: z.literal("NOT_PERFORMED"),
        persistence: z.literal("NOT_PERFORMED"),
        spend: z.literal("NOT_PERFORMED"),
      })
      .strict(),
  })
  .strict()
  .superRefine((pack, ctx) => {
    if (pack.target_runtime_seconds !== pack.episode.duration_seconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["target_runtime_seconds"],
        message: "Target runtime must equal the episode duration",
      });
    }

    if (
      pack.episode.assigned_test.test_id !== pack.episode.test_id ||
      pack.episode.assigned_test.result !== pack.episode.result
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["episode", "assigned_test"],
        message: "Assigned test identity and result must match the episode",
      });
    }
    if (
      pack.episode.self_authored_test.test_id.toLocaleLowerCase() ===
      pack.episode.assigned_test.test_id.toLocaleLowerCase()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["episode", "self_authored_test", "test_id"],
        message: "Self-authored and assigned test ids must differ",
      });
    }

    const characterIds = new Set<string>();
    for (const [index, character] of pack.episode.characters.entries()) {
      const characterId = character.character_id.toLocaleLowerCase();
      if (characterIds.has(characterId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["episode", "characters", index, "character_id"],
          message: `Duplicate character id ${character.character_id}`,
        });
      }
      characterIds.add(characterId);
    }

    let expectedBeatStart = 0;
    for (const [index, beat] of pack.episode.beats.entries()) {
      if (beat.beat_index !== index + 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["episode", "beats", index, "beat_index"],
          message: "Beat indices must be contiguous and begin at 1",
        });
      }
      if (beat.start_seconds !== expectedBeatStart) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["episode", "beats", index, "start_seconds"],
          message: "Beats must provide contiguous coverage beginning at zero",
        });
      }
      expectedBeatStart = beat.end_seconds;
    }
    if (expectedBeatStart !== pack.episode.duration_seconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["episode", "beats"],
        message: "Beats must end at the episode duration",
      });
    }

    const screenTextOrders = new Set<number>();
    let previousOrder = 0;
    for (const [index, item] of pack.screen_text.entries()) {
      if (screenTextOrders.has(item.order) || item.order <= previousOrder) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["screen_text", index, "order"],
          message: "Screen-text order values must be unique and strictly increasing",
        });
      }
      screenTextOrders.add(item.order);
      previousOrder = item.order;
    }

    if (pack.prompt_preparation.segment_count !== pack.prompt_preparation.segments.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["prompt_preparation", "segment_count"],
        message: "segment_count must equal the number of prompt segments",
      });
    }

    let expectedSegmentStart = 0;
    const segmentIds = new Set<string>();
    for (const [index, segment] of pack.prompt_preparation.segments.entries()) {
      const segmentId = segment.segment_id.toLocaleLowerCase();
      if (segmentIds.has(segmentId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["prompt_preparation", "segments", index, "segment_id"],
          message: `Duplicate prompt segment id ${segment.segment_id}`,
        });
      }
      if (segment.start_seconds !== expectedSegmentStart) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["prompt_preparation", "segments", index, "start_seconds"],
          message: "Prompt segments must provide contiguous coverage beginning at zero",
        });
      }
      if (index > 0 && segment.connected_from !== pack.prompt_preparation.segments[index - 1].segment_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["prompt_preparation", "segments", index, "connected_from"],
          message: "Prompt segment connected_from must name the previous segment",
        });
      }
      if (
        index < pack.prompt_preparation.segments.length - 1 &&
        segment.connected_to !== pack.prompt_preparation.segments[index + 1].segment_id
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["prompt_preparation", "segments", index, "connected_to"],
          message: "Prompt segment connected_to must name the next segment",
        });
      }
      segmentIds.add(segmentId);
      expectedSegmentStart = segment.end_seconds;
    }
    if (expectedSegmentStart !== pack.episode.duration_seconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["prompt_preparation", "segments"],
        message: "Prompt segments must end at the episode duration",
      });
    }
    if (pack.prompt_preparation.segments.length > 1) {
      const boundary = pack.prompt_preparation.segments[0].end_seconds;
      if (pack.prompt_preparation.cross_segment_continuity.boundary_seconds !== boundary) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["prompt_preparation", "cross_segment_continuity", "boundary_seconds"],
          message: "Continuity boundary must equal the first prompt-segment boundary",
        });
      }
    }

    const expectedCounts = pack.caniscreenwrite_inspection.expected_counts;
    if (
      expectedCounts.characters !== pack.episode.characters.length ||
      expectedCounts.beats !== pack.episode.beats.length ||
      expectedCounts.prompt_segments !== pack.prompt_preparation.segments.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["caniscreenwrite_inspection", "expected_counts"],
        message: "Inspection counts must equal the bounded package contents",
      });
    }

    const envelope = pack.caniscreenwrite_inspection.integrity_envelope;
    if (
      envelope.story_room_pack_sha256 !== pack.source_binding.sha256 ||
      envelope.screenplay_filename !== pack.screenplay_binding.file_name ||
      envelope.screenplay_byte_length !== pack.screenplay_binding.byte_length ||
      envelope.screenplay_sha256 !== pack.screenplay_binding.sha256 ||
      envelope.episode_index !== pack.episode.episode_index ||
      envelope.episode_title !== pack.episode.title ||
      envelope.test_id !== pack.episode.test_id
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["caniscreenwrite_inspection", "integrity_envelope"],
        message: "Inspection envelope must exactly repeat the source, screenplay, and episode bindings",
      });
    }
  });

export type EpisodeProductionScriptPack = z.infer<typeof episodeProductionScriptPackSchema>;

export interface EpisodeProductionScriptMetrics {
  characters: number;
  beats: number;
  promptSegments: number;
  screenTextItems: number;
  targetRuntimeSeconds: number;
}

export interface ExactLocalFileReceipt {
  fileName: string;
  byteLength: number;
  sha256: string;
}

export interface LocalEpisodeProductionScriptPreview {
  pack: EpisodeProductionScriptPack;
  manifest: ExactLocalFileReceipt;
  screenplay: ExactLocalFileReceipt & { text: string };
  sourceStoryRoom: ExactLocalFileReceipt & { packageId: string; episodeIndex: number };
  metrics: EpisodeProductionScriptMetrics;
  verification: {
    manifest: "STRICT_SCHEMA_AND_EXACT_BYTES_VERIFIED";
    screenplay: "EXACT_FILENAME_LENGTH_AND_SHA256_VERIFIED";
    storyRoom: "EXACT_LOADED_PREVIEW_VERIFIED";
    episodeSlice: "SOURCE_FIELDS_EXACTLY_VERIFIED";
    relativePaths: "DECLARATIVE_ONLY_NOT_RESOLVED";
    fountainParser: "NOT_USED";
  };
}

export interface LocalReadableFile {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ReadLocalEpisodeProductionScriptInput {
  manifestFile: LocalReadableFile;
  screenplayFile: LocalReadableFile;
  storyRoomPreview: LocalStoryRoomPackPreview;
}

export type LocalEpisodeProductionScriptErrorCode =
  | "INVALID_FILE_TYPE"
  | "INVALID_FILE_SIZE"
  | "FILE_TOO_LARGE"
  | "INVALID_ENCODING"
  | "INVALID_JSON"
  | "INVALID_PACK"
  | "INVALID_SCREENPLAY"
  | "HASH_UNAVAILABLE"
  | "INVALID_STORY_ROOM_PREVIEW"
  | "SCREENPLAY_BINDING_MISMATCH"
  | "SOURCE_BINDING_MISMATCH"
  | "EPISODE_BINDING_MISMATCH";

export class LocalEpisodeProductionScriptError extends Error {
  readonly code: LocalEpisodeProductionScriptErrorCode;

  constructor(code: LocalEpisodeProductionScriptErrorCode, message: string) {
    super(message);
    this.name = "LocalEpisodeProductionScriptError";
    this.code = code;
  }
}

export function getEpisodeProductionScriptMetrics(
  pack: EpisodeProductionScriptPack,
): EpisodeProductionScriptMetrics {
  return {
    characters: pack.episode.characters.length,
    beats: pack.episode.beats.length,
    promptSegments: pack.prompt_preparation.segments.length,
    screenTextItems: pack.screen_text.length,
    targetRuntimeSeconds: pack.target_runtime_seconds,
  };
}

export function formatEpisodeProductionScriptIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "pack"}: ${issue.message}`)
    .join(" · ");
}

export function parseEpisodeProductionScriptPackJson(text: string): EpisodeProductionScriptPack {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new LocalEpisodeProductionScriptError(
      "INVALID_JSON",
      "The selected production-script manifest is not valid JSON.",
    );
  }

  const parsed = episodeProductionScriptPackSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LocalEpisodeProductionScriptError(
      "INVALID_PACK",
      `The JSON does not match the episode-production-script contract. ${formatEpisodeProductionScriptIssues(parsed.error)}`,
    );
  }
  return parsed.data;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertFileDeclaration(file: LocalReadableFile, extension: string, limit: number): void {
  if (!file.name.toLocaleLowerCase().endsWith(extension)) {
    throw new LocalEpisodeProductionScriptError(
      "INVALID_FILE_TYPE",
      `Choose separate ${extension} production-script files.`,
    );
  }
  if (!Number.isSafeInteger(file.size) || file.size < 0) {
    throw new LocalEpisodeProductionScriptError(
      "INVALID_FILE_SIZE",
      `The declared size for ${file.name} is invalid.`,
    );
  }
  if (file.size > limit) {
    throw new LocalEpisodeProductionScriptError(
      "FILE_TOO_LARGE",
      `${file.name} exceeds its bounded local-inspection limit.`,
    );
  }
}

function assertActualByteLimit(fileName: string, bytes: ArrayBuffer, limit: number): void {
  if (bytes.byteLength > limit) {
    throw new LocalEpisodeProductionScriptError(
      "FILE_TOO_LARGE",
      `${fileName} exceeds its bounded local-inspection limit.`,
    );
  }
}

function decodeUtf8(fileName: string, bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new LocalEpisodeProductionScriptError(
      "INVALID_ENCODING",
      `${fileName} is not valid UTF-8.`,
    );
  }
}

function bindingMismatch(
  code:
    | "SCREENPLAY_BINDING_MISMATCH"
    | "SOURCE_BINDING_MISMATCH"
    | "EPISODE_BINDING_MISMATCH",
  path: string,
): never {
  throw new LocalEpisodeProductionScriptError(code, `Exact binding mismatch at ${path}.`);
}

function assertExact<T>(
  actual: T,
  expected: T,
  code:
    | "SCREENPLAY_BINDING_MISMATCH"
    | "SOURCE_BINDING_MISMATCH"
    | "EPISODE_BINDING_MISMATCH",
  path: string,
): void {
  if (actual !== expected) bindingMismatch(code, path);
}

function assertStoryRoomPreview(preview: LocalStoryRoomPackPreview): StoryRoomPack {
  const parsedPack = storyRoomPackSchema.safeParse(preview.pack);
  const identity = z
    .object({
      fileName: boundedText(255).refine(
        (value) => value.toLocaleLowerCase().endsWith(".json"),
        "Expected a JSON file name",
      ),
      byteLength: z.number().int().positive().max(MAX_STORY_ROOM_PACK_BYTES),
      sha256: sha256Schema,
    })
    .safeParse(preview);

  if (!parsedPack.success || !identity.success) {
    throw new LocalEpisodeProductionScriptError(
      "INVALID_STORY_ROOM_PREVIEW",
      "Load a valid exact-byte Story Room preview before pairing the production script.",
    );
  }
  return parsedPack.data;
}

function verifySourceAndEpisodeBindings(
  pack: EpisodeProductionScriptPack,
  preview: LocalStoryRoomPackPreview,
): void {
  const sourcePack = assertStoryRoomPreview(preview);
  const sourceBinding = pack.source_binding;

  assertExact(sourceBinding.package_id, sourcePack.package_id, "SOURCE_BINDING_MISMATCH", "source_binding.package_id");
  assertExact(sourceBinding.file_name, preview.fileName, "SOURCE_BINDING_MISMATCH", "source_binding.file_name");
  assertExact(sourceBinding.byte_length, preview.byteLength, "SOURCE_BINDING_MISMATCH", "source_binding.byte_length");
  assertExact(sourceBinding.sha256, preview.sha256, "SOURCE_BINDING_MISMATCH", "source_binding.sha256");
  assertExact(
    sourceBinding.source_record_state,
    sourcePack.record_state,
    "SOURCE_BINDING_MISMATCH",
    "source_binding.source_record_state",
  );
  assertExact(
    sourceBinding.source_authority_state,
    sourcePack.authority_state,
    "SOURCE_BINDING_MISMATCH",
    "source_binding.source_authority_state",
  );

  const sourceEpisode = sourcePack.episodes.find(
    (episode) => episode.episode_index === pack.episode.episode_index,
  );
  if (!sourceEpisode) bindingMismatch("EPISODE_BINDING_MISMATCH", "episode.episode_index");

  assertExact(
    sourceBinding.selection,
    `episodes[episode_index=${sourceEpisode.episode_index}]`,
    "SOURCE_BINDING_MISMATCH",
    "source_binding.selection",
  );

  for (const field of [
    "episode_index",
    "title",
    "logline",
    "duration_seconds",
    "result",
    "test_id",
    "archi_objective",
    "continuity_in",
    "continuity_out",
    "state_delta",
  ] as const) {
    assertExact(
      pack.episode[field],
      sourceEpisode[field],
      "EPISODE_BINDING_MISMATCH",
      `episode.${field}`,
    );
  }

  assertExact(
    pack.episode.assigned_test.test_id,
    sourceEpisode.test_id,
    "EPISODE_BINDING_MISMATCH",
    "episode.assigned_test.test_id",
  );
  assertExact(
    pack.episode.assigned_test.test_prompt,
    sourceEpisode.test_prompt,
    "EPISODE_BINDING_MISMATCH",
    "episode.assigned_test.test_prompt",
  );
  assertExact(
    pack.episode.assigned_test.result,
    sourceEpisode.result,
    "EPISODE_BINDING_MISMATCH",
    "episode.assigned_test.result",
  );

  if (!sourceEpisode.authored_test) {
    bindingMismatch("EPISODE_BINDING_MISMATCH", "episode.self_authored_test");
  }
  for (const field of ["test_id", "test_prompt", "result"] as const) {
    assertExact(
      pack.episode.self_authored_test[field],
      sourceEpisode.authored_test[field],
      "EPISODE_BINDING_MISMATCH",
      `episode.self_authored_test.${field}`,
    );
  }

  const actualCharacterIds = pack.episode.characters.map((character) => character.character_id);
  if (JSON.stringify(actualCharacterIds) !== JSON.stringify(sourceEpisode.character_ids)) {
    bindingMismatch("EPISODE_BINDING_MISMATCH", "episode.characters");
  }
  const sourceCharacters = new Map(
    sourcePack.characters.map((character) => [character.character_id, character]),
  );
  for (const [index, character] of pack.episode.characters.entries()) {
    const sourceCharacter = sourceCharacters.get(character.character_id);
    if (!sourceCharacter || sourceCharacter.name !== character.name) {
      bindingMismatch("EPISODE_BINDING_MISMATCH", `episode.characters.${index}.name`);
    }
  }

  if (pack.episode.beats.length !== sourceEpisode.beats.length) {
    bindingMismatch("EPISODE_BINDING_MISMATCH", "episode.beats");
  }
  for (const [index, beat] of pack.episode.beats.entries()) {
    const sourceBeat = sourceEpisode.beats[index];
    for (const [productionField, sourceField] of [
      ["beat_index", "beat_index"],
      ["start_seconds", "start_seconds"],
      ["end_seconds", "end_seconds"],
      ["source_label", "label"],
      ["objective", "objective"],
      ["turn", "turn"],
      ["consequence", "consequence"],
      ["result", "result"],
    ] as const) {
      assertExact(
        beat[productionField],
        sourceBeat[sourceField],
        "EPISODE_BINDING_MISMATCH",
        `episode.beats.${index}.${productionField}`,
      );
    }
  }

  const sourcePromptPreparation = sourceEpisode.prompt_preparation;
  if (!sourcePromptPreparation) {
    bindingMismatch("EPISODE_BINDING_MISMATCH", "prompt_preparation");
  }
  assertExact(
    pack.prompt_preparation.state,
    sourcePromptPreparation.status,
    "EPISODE_BINDING_MISMATCH",
    "prompt_preparation.state",
  );
  if (pack.prompt_preparation.segments.length !== sourcePromptPreparation.segments.length) {
    bindingMismatch("EPISODE_BINDING_MISMATCH", "prompt_preparation.segments");
  }
  for (const [index, segment] of pack.prompt_preparation.segments.entries()) {
    const sourceSegment = sourcePromptPreparation.segments[index];
    for (const [productionField, sourceField] of [
      ["segment_id", "segment_id"],
      ["start_seconds", "start_seconds"],
      ["end_seconds", "end_seconds"],
      ["source_story_event", "story_event"],
    ] as const) {
      assertExact(
        segment[productionField],
        sourceSegment[sourceField],
        "EPISODE_BINDING_MISMATCH",
        `prompt_preparation.segments.${index}.${productionField}`,
      );
    }
  }
}

/**
 * Reads a user-selected manifest and Fountain file as exact byte objects.
 *
 * `relative_path` values are never resolved. The Fountain body is intentionally
 * left untouched and is not passed through the application's generic Fountain
 * parser; the returned text is only a fatal UTF-8 decoding of the hashed bytes.
 */
export async function readLocalEpisodeProductionScript(
  input: ReadLocalEpisodeProductionScriptInput,
): Promise<LocalEpisodeProductionScriptPreview> {
  assertFileDeclaration(
    input.manifestFile,
    ".json",
    MAX_EPISODE_PRODUCTION_SCRIPT_MANIFEST_BYTES,
  );
  assertFileDeclaration(
    input.screenplayFile,
    ".fountain",
    MAX_EPISODE_PRODUCTION_SCRIPT_FOUNTAIN_BYTES,
  );

  const [manifestBytes, screenplayBytes] = await Promise.all([
    input.manifestFile.arrayBuffer(),
    input.screenplayFile.arrayBuffer(),
  ]);
  assertActualByteLimit(
    input.manifestFile.name,
    manifestBytes,
    MAX_EPISODE_PRODUCTION_SCRIPT_MANIFEST_BYTES,
  );
  assertActualByteLimit(
    input.screenplayFile.name,
    screenplayBytes,
    MAX_EPISODE_PRODUCTION_SCRIPT_FOUNTAIN_BYTES,
  );

  const manifestText = decodeUtf8(input.manifestFile.name, manifestBytes);
  const screenplayText = decodeUtf8(input.screenplayFile.name, screenplayBytes);
  if (screenplayText.trim().length === 0) {
    throw new LocalEpisodeProductionScriptError(
      "INVALID_SCREENPLAY",
      "The selected Fountain screenplay is blank.",
    );
  }

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new LocalEpisodeProductionScriptError(
      "HASH_UNAVAILABLE",
      "This browser cannot compute the required local SHA-256 receipts.",
    );
  }
  const [manifestDigest, screenplayDigest] = await Promise.all([
    subtle.digest("SHA-256", manifestBytes),
    subtle.digest("SHA-256", screenplayBytes),
  ]);
  const manifestSha256 = bytesToHex(manifestDigest);
  const screenplaySha256 = bytesToHex(screenplayDigest);
  const pack = parseEpisodeProductionScriptPackJson(manifestText);

  assertExact(
    pack.screenplay_binding.file_name,
    input.screenplayFile.name,
    "SCREENPLAY_BINDING_MISMATCH",
    "screenplay_binding.file_name",
  );
  assertExact(
    pack.screenplay_binding.byte_length,
    screenplayBytes.byteLength,
    "SCREENPLAY_BINDING_MISMATCH",
    "screenplay_binding.byte_length",
  );
  assertExact(
    pack.screenplay_binding.sha256,
    screenplaySha256,
    "SCREENPLAY_BINDING_MISMATCH",
    "screenplay_binding.sha256",
  );

  verifySourceAndEpisodeBindings(pack, input.storyRoomPreview);

  return {
    pack,
    manifest: {
      fileName: input.manifestFile.name,
      byteLength: manifestBytes.byteLength,
      sha256: manifestSha256,
    },
    screenplay: {
      fileName: input.screenplayFile.name,
      byteLength: screenplayBytes.byteLength,
      sha256: screenplaySha256,
      text: screenplayText,
    },
    sourceStoryRoom: {
      fileName: input.storyRoomPreview.fileName,
      byteLength: input.storyRoomPreview.byteLength,
      sha256: input.storyRoomPreview.sha256,
      packageId: input.storyRoomPreview.pack.package_id,
      episodeIndex: pack.episode.episode_index,
    },
    metrics: getEpisodeProductionScriptMetrics(pack),
    verification: {
      manifest: "STRICT_SCHEMA_AND_EXACT_BYTES_VERIFIED",
      screenplay: "EXACT_FILENAME_LENGTH_AND_SHA256_VERIFIED",
      storyRoom: "EXACT_LOADED_PREVIEW_VERIFIED",
      episodeSlice: "SOURCE_FIELDS_EXACTLY_VERIFIED",
      relativePaths: "DECLARATIVE_ONLY_NOT_RESOLVED",
      fountainParser: "NOT_USED",
    },
  };
}
