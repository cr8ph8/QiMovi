import { z } from "zod";

export const MAX_STORY_ROOM_PACK_BYTES = 1024 * 1024;
export const MAX_STORY_ROOM_EPISODES = 24;
export const MAX_STORY_ROOM_BEATS_PER_EPISODE = 8;
export const MAX_STORY_ROOM_CHARACTERS = 12;
export const MAX_STORY_ROOM_PROMPT_SEGMENTS = 4;
export const MAX_STORY_ROOM_REFERENCE_REQUIREMENTS = 12;

export const STORY_ROOM_RESULTS = [
  "PASS",
  "FAIL",
  "UNKNOWN",
  "REJECTED",
  "PENDING",
  "INCOMPLETE",
] as const;

export const STORY_ROOM_PROMPT_PREPARATION_STATUSES = [
  "NOT_STARTED",
  "DRAFTED_NOT_AUTHORIZED",
] as const;

export type StoryRoomResult = (typeof STORY_ROOM_RESULTS)[number];
export type StoryRoomPromptPreparationStatus =
  (typeof STORY_ROOM_PROMPT_PREPARATION_STATUSES)[number];

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

const optionalBoundedText = (max: number) => boundedText(max).optional();
const resultSchema = z.enum(STORY_ROOM_RESULTS);

const authoredTestSchema = z
  .object({
    test_id: boundedText(100),
    test_prompt: boundedText(5_000),
    result: resultSchema.optional(),
  })
  .strict();

const featureBaselineSchema = z
  .object({
    package_id: boundedText(200),
    relationship: z.literal("DOES_NOT_SUPERSEDE"),
    feature_scene_outline_sha256: sha256Schema,
    feature_package_manifest_sha256: sha256Schema,
    binding_state: z.literal("DECLARED_IN_EXACT_PACK_NOT_REVERIFIED"),
  })
  .strict();

const characterSchema = z
  .object({
    character_id: boundedText(100),
    name: boundedText(200),
    role: boundedText(1_000),
    objective: optionalBoundedText(2_000),
  })
  .strict();

const beatSchema = z
  .object({
    beat_index: z.number().int().positive().max(MAX_STORY_ROOM_BEATS_PER_EPISODE),
    start_seconds: z.number().finite().nonnegative().max(MAX_EPISODE_DURATION_SECONDS),
    end_seconds: z.number().finite().positive().max(MAX_EPISODE_DURATION_SECONDS),
    label: boundedText(500),
    objective: boundedText(5_000),
    turn: optionalBoundedText(5_000),
    consequence: optionalBoundedText(5_000),
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
  });

const promptSegmentSchema = z
  .object({
    segment_id: boundedText(100),
    start_seconds: z.number().finite().nonnegative().max(MAX_EPISODE_DURATION_SECONDS),
    end_seconds: z.number().finite().positive().max(MAX_EPISODE_DURATION_SECONDS),
    story_event: boundedText(5_000),
  })
  .strict()
  .superRefine((segment, ctx) => {
    if (segment.end_seconds <= segment.start_seconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end_seconds"],
        message: "Segment end_seconds must be greater than start_seconds",
      });
    }
  });

const promptPreparationSchema = z
  .object({
    status: z.enum(STORY_ROOM_PROMPT_PREPARATION_STATUSES),
    segments: z.array(promptSegmentSchema).max(MAX_STORY_ROOM_PROMPT_SEGMENTS),
    reference_requirements: z
      .array(boundedText(1_000))
      .max(MAX_STORY_ROOM_REFERENCE_REQUIREMENTS),
  })
  .strict()
  .superRefine((preparation, ctx) => {
    const segmentIds = new Set<string>();
    let previousEnd = 0;

    for (const [index, segment] of preparation.segments.entries()) {
      const segmentId = segment.segment_id.toLocaleLowerCase();
      if (segmentIds.has(segmentId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["segments", index, "segment_id"],
          message: `Duplicate prompt segment id ${segment.segment_id}`,
        });
      }
      if (index > 0 && segment.start_seconds < previousEnd) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["segments", index, "start_seconds"],
          message: "Prompt segments must be chronological and non-overlapping",
        });
      }
      segmentIds.add(segmentId);
      previousEnd = segment.end_seconds;
    }
  });

const episodeSchema = z
  .object({
    episode_index: z.number().int().positive().max(10_000),
    title: boundedText(500),
    logline: boundedText(5_000),
    duration_seconds: z.number().finite().positive().max(MAX_EPISODE_DURATION_SECONDS),
    result: resultSchema,
    test_id: boundedText(100),
    test_prompt: boundedText(5_000),
    archi_objective: boundedText(5_000),
    continuity_in: boundedText(5_000),
    continuity_out: boundedText(5_000),
    state_delta: boundedText(5_000),
    authored_test: authoredTestSchema.optional(),
    character_ids: z.array(boundedText(100)).max(MAX_STORY_ROOM_CHARACTERS),
    beats: z.array(beatSchema).min(1).max(MAX_STORY_ROOM_BEATS_PER_EPISODE),
    prompt_preparation: promptPreparationSchema.optional(),
  })
  .strict()
  .superRefine((episode, ctx) => {
    const characterIds = new Set<string>();
    for (const [index, characterId] of episode.character_ids.entries()) {
      const key = characterId.toLocaleLowerCase();
      if (characterIds.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["character_ids", index],
          message: `Duplicate episode character id ${characterId}`,
        });
      }
      characterIds.add(key);
    }

    const beatIndices = new Set<number>();
    let previousBeatIndex = 0;
    let previousEnd = 0;
    for (const [index, beat] of episode.beats.entries()) {
      if (beatIndices.has(beat.beat_index)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["beats", index, "beat_index"],
          message: `Duplicate beat index ${beat.beat_index}`,
        });
      }
      if (index > 0 && beat.beat_index <= previousBeatIndex) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["beats", index, "beat_index"],
          message: "Beat indices must be strictly increasing",
        });
      }
      if (index > 0 && beat.start_seconds < previousEnd) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["beats", index, "start_seconds"],
          message: "Beats must be chronological and non-overlapping",
        });
      }
      if (beat.end_seconds > episode.duration_seconds) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["beats", index, "end_seconds"],
          message: "Beat exceeds the episode duration",
        });
      }
      beatIndices.add(beat.beat_index);
      previousBeatIndex = beat.beat_index;
      previousEnd = beat.end_seconds;
    }

    for (const [index, segment] of (episode.prompt_preparation?.segments ?? []).entries()) {
      if (segment.end_seconds > episode.duration_seconds) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["prompt_preparation", "segments", index, "end_seconds"],
          message: "Prompt segment exceeds the episode duration",
        });
      }
    }
  });

export const storyRoomPackSchema = z
  .object({
    schema_version: z.literal("filmstack-story-room-pack/v1"),
    package_id: boundedText(200),
    record_state: z.literal("PROSPECTIVE_DRAFT"),
    source_status: z.literal("DECLARED_NOT_ADMITTED"),
    authority_state: z.literal("NO_EXTERNAL_AUTHORITY"),
    production_gate: z.literal("PRODUCE_BLOCKED"),
    relationship_to_baseline: z.literal("DOES_NOT_SUPERSEDE"),
    format_relationship: z.literal("PENDING_HUMAN_DECISION"),
    feature_baseline: featureBaselineSchema,
    title: boundedText(500),
    season_label: optionalBoundedText(500),
    premise: boundedText(10_000),
    format: optionalBoundedText(500),
    tagline: optionalBoundedText(1_000),
    series_engine: optionalBoundedText(10_000),
    season_arc: optionalBoundedText(10_000),
    source: z
      .object({
        title: boundedText(500),
        revision_label: optionalBoundedText(500),
        revision_sha256: sha256Schema.optional(),
      })
      .strict(),
    characters: z.array(characterSchema).max(MAX_STORY_ROOM_CHARACTERS),
    episodes: z.array(episodeSchema).min(1).max(MAX_STORY_ROOM_EPISODES),
    open_questions: z.array(boundedText(5_000)).max(50),
  })
  .strict()
  .superRefine((pack, ctx) => {
    const characterIds = new Set<string>();
    for (const [index, character] of pack.characters.entries()) {
      const characterId = character.character_id.toLocaleLowerCase();
      if (characterIds.has(characterId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["characters", index, "character_id"],
          message: `Duplicate character id ${character.character_id}`,
        });
      }
      characterIds.add(characterId);
    }

    const episodeIndices = new Set<number>();
    const testIds = new Set<string>();
    let previousEpisodeIndex = 0;
    for (const [index, episode] of pack.episodes.entries()) {
      if (episodeIndices.has(episode.episode_index)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["episodes", index, "episode_index"],
          message: `Duplicate episode index ${episode.episode_index}`,
        });
      }
      if (index > 0 && episode.episode_index <= previousEpisodeIndex) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["episodes", index, "episode_index"],
          message: "Episode indices must be strictly increasing",
        });
      }

      const testId = episode.test_id.toLocaleLowerCase();
      if (testIds.has(testId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["episodes", index, "test_id"],
          message: `Duplicate episode test id ${episode.test_id}`,
        });
      }
      testIds.add(testId);

      if (episode.authored_test) {
        const authoredTestId = episode.authored_test.test_id.toLocaleLowerCase();
        if (testIds.has(authoredTestId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["episodes", index, "authored_test", "test_id"],
            message: `Duplicate authored test id ${episode.authored_test.test_id}`,
          });
        }
        testIds.add(authoredTestId);
      }

      for (const [characterIndex, characterId] of episode.character_ids.entries()) {
        if (!characterIds.has(characterId.toLocaleLowerCase())) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["episodes", index, "character_ids", characterIndex],
            message: `Unknown character id ${characterId}`,
          });
        }
      }

      episodeIndices.add(episode.episode_index);
      previousEpisodeIndex = episode.episode_index;
    }
  });

export type StoryRoomPack = z.infer<typeof storyRoomPackSchema>;

export interface StoryRoomPackMetrics {
  episodes: number;
  beats: number;
  characters: number;
  promptSegments: number;
  totalDurationSeconds: number;
  openQuestions: number;
  episodeResults: Record<StoryRoomResult, number>;
  beatResults: Record<StoryRoomResult, number>;
}

function emptyResultCounts(): Record<StoryRoomResult, number> {
  return Object.fromEntries(STORY_ROOM_RESULTS.map((result) => [result, 0])) as Record<
    StoryRoomResult,
    number
  >;
}

export function getStoryRoomPackMetrics(pack: StoryRoomPack): StoryRoomPackMetrics {
  const episodeResults = emptyResultCounts();
  const beatResults = emptyResultCounts();

  for (const episode of pack.episodes) {
    episodeResults[episode.result] += 1;
    for (const beat of episode.beats) {
      if (beat.result) beatResults[beat.result] += 1;
    }
  }

  return {
    episodes: pack.episodes.length,
    beats: pack.episodes.reduce((total, episode) => total + episode.beats.length, 0),
    characters: pack.characters.length,
    promptSegments: pack.episodes.reduce(
      (total, episode) => total + (episode.prompt_preparation?.segments.length ?? 0),
      0,
    ),
    totalDurationSeconds: pack.episodes.reduce(
      (total, episode) => total + episode.duration_seconds,
      0,
    ),
    openQuestions: pack.open_questions.length,
    episodeResults,
    beatResults,
  };
}

export function formatStoryRoomPackIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "pack"}: ${issue.message}`)
    .join(" · ");
}

export function parseStoryRoomPackJson(text: string): StoryRoomPack {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new LocalStoryRoomPackError("INVALID_JSON", "The selected file is not valid JSON.");
  }

  const parsed = storyRoomPackSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LocalStoryRoomPackError(
      "INVALID_PACK",
      `The JSON does not match the story-room-pack contract. ${formatStoryRoomPackIssues(parsed.error)}`,
    );
  }
  return parsed.data;
}

export type LocalStoryRoomPackErrorCode =
  | "INVALID_FILE_TYPE"
  | "FILE_TOO_LARGE"
  | "INVALID_ENCODING"
  | "INVALID_JSON"
  | "INVALID_PACK"
  | "HASH_UNAVAILABLE";

export class LocalStoryRoomPackError extends Error {
  readonly code: LocalStoryRoomPackErrorCode;

  constructor(code: LocalStoryRoomPackErrorCode, message: string) {
    super(message);
    this.name = "LocalStoryRoomPackError";
    this.code = code;
  }
}

export interface LocalStoryRoomPackPreview {
  pack: StoryRoomPack;
  fileName: string;
  byteLength: number;
  sha256: string;
  metrics: StoryRoomPackMetrics;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function readLocalStoryRoomPack(
  file: Pick<File, "name" | "size" | "arrayBuffer">,
): Promise<LocalStoryRoomPackPreview> {
  if (!file.name.toLocaleLowerCase().endsWith(".json")) {
    throw new LocalStoryRoomPackError(
      "INVALID_FILE_TYPE",
      "Choose a .json story-room-pack file.",
    );
  }
  if (file.size > MAX_STORY_ROOM_PACK_BYTES) {
    throw new LocalStoryRoomPackError(
      "FILE_TOO_LARGE",
      "The selected file exceeds the 1 MiB local-preview limit.",
    );
  }

  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_STORY_ROOM_PACK_BYTES) {
    throw new LocalStoryRoomPackError(
      "FILE_TOO_LARGE",
      "The selected file exceeds the 1 MiB local-preview limit.",
    );
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new LocalStoryRoomPackError(
      "INVALID_ENCODING",
      "The selected file is not valid UTF-8 JSON.",
    );
  }
  const pack = parseStoryRoomPackJson(text);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new LocalStoryRoomPackError(
      "HASH_UNAVAILABLE",
      "This browser cannot compute the required local SHA-256 receipt.",
    );
  }
  const digest = await subtle.digest("SHA-256", bytes);

  return {
    pack,
    fileName: file.name,
    byteLength: bytes.byteLength,
    sha256: bytesToHex(digest),
    metrics: getStoryRoomPackMetrics(pack),
  };
}
