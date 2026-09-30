import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";

export const PREPRODUCTION_TRACKS = [
  "live_action",
  "animation",
  "ai_generation",
] as const;

export type PreproductionTrack = (typeof PREPRODUCTION_TRACKS)[number];

export const MAX_PREPRODUCTION_PACK_BYTES = 2 * 1024 * 1024;
const MAX_PORTABLE_BASENAME_LENGTH = 255;
const JSON_BASENAME_PATTERN = /^[^/\\]+\.json$/i;
const hasInlineControl = (value: string): boolean =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

const hashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Expected a lowercase 64-character SHA-256 hash");
const shortText = (max = 500) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, "Cannot be blank");
const optionalText = (max = 10_000) => z.string().max(max).optional();

function deepFreezeJson<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreezeJson(nested);
    }
    Object.freeze(value);
  }
  return value;
}

const shotSchema = z
  .object({
    shot: shortText(80),
    framing: shortText(200),
    lens_mm: z.number().positive().max(1_000).optional(),
    movement: optionalText(500),
    description: shortText(10_000),
    beat: optionalText(5_000),
  })
  .strict();

const liveSceneSchema = z
  .object({
    scene_index: z.number().int().positive().max(10_000),
    slug: shortText(500),
    page_estimate: z.number().nonnegative().max(10_000).optional(),
    intent: optionalText(5_000),
    shots: z.array(shotSchema).min(1).max(10),
  })
  .strict()
  .superRefine((scene, ctx) => {
    const seen = new Set<string>();
    for (const [index, shot] of scene.shots.entries()) {
      const key = shot.shot.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["shots", index, "shot"],
          message: `Duplicate shot label ${shot.shot}`,
        });
      }
      seen.add(key);
    }
  });

const packMetaSchema = z
  .object({
    generated_at: z.string().max(100).optional(),
    model: z.string().max(500).optional(),
    tracks: z.array(z.enum(PREPRODUCTION_TRACKS)).max(3).optional(),
    context_hash: hashSchema.optional(),
    context_bundle_id: z.string().max(500).optional(),
    source_hash: hashSchema.optional(),
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
    estimated_cost_cents: z.number().nonnegative().optional(),
    source_entry_id: z.string().max(500).nullable().optional(),
  })
  .strict();

export const preproductionPackSchema = z
  .object({
    summary: z
      .object({
        logline: shortText(5_000),
        tone: optionalText(1_000),
        format: optionalText(500),
        primary_locations: z.array(shortText(500)).max(100).optional(),
      })
      .strict(),
    live_action: z
      .object({
        crew_notes: optionalText(20_000),
        locations: z
          .array(
            z
              .object({
                name: shortText(500),
                type: optionalText(200),
                scenes: z.array(z.number().int().positive().max(10_000)).max(40),
                notes: optionalText(5_000),
              })
              .strict(),
          )
          .max(100)
          .optional(),
        scenes: z.array(liveSceneSchema).min(1).max(40),
      })
      .strict()
      .optional(),
    animation: z
      .object({
        style_target: optionalText(5_000),
        character_sheets: z
          .array(
            z
              .object({
                name: shortText(500),
                silhouette: optionalText(5_000),
                palette: z.array(z.string().max(100)).max(32).optional(),
                expression_range: z.array(z.string().max(500)).max(64).optional(),
              })
              .strict(),
          )
          .max(100)
          .optional(),
        key_frames: z
          .array(
            z
              .object({
                scene_index: z.number().int().positive().max(10_000),
                frame: shortText(200),
                description: shortText(10_000),
                staging: optionalText(10_000),
              })
              .strict(),
          )
          .max(400),
        pipeline_notes: optionalText(20_000),
      })
      .strict()
      .optional(),
    ai_generation: z
      .object({
        style_prompt: shortText(20_000),
        negative_prompt: optionalText(20_000),
        aspect_ratio: optionalText(100),
        continuity_tokens: z
          .array(
            z
              .object({
                token: shortText(500),
                refers_to: shortText(2_000),
                description: optionalText(5_000),
              })
              .strict(),
          )
          .max(200)
          .optional(),
        shot_prompts: z
          .array(
            z
              .object({
                scene_index: z.number().int().positive().max(10_000),
                shot: shortText(80),
                image_prompt: shortText(20_000),
                motion_prompt: optionalText(20_000),
                seed_hint: optionalText(500),
              })
              .strict(),
          )
          .max(400),
      })
      .strict()
      .optional(),
    open_questions: z.array(z.string().max(10_000)).max(100),
    _meta: packMetaSchema.optional(),
    _artifact_id: z.string().max(500).optional(),
    _version: z.number().int().positive().max(1_000_000).optional(),
  })
  .strict()
  .superRefine((pack, ctx) => {
    if (!pack.live_action && !pack.animation && !pack.ai_generation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "At least one preproduction track is required",
      });
    }

    const sceneIndices = new Set<number>();
    for (const [index, scene] of (pack.live_action?.scenes ?? []).entries()) {
      if (sceneIndices.has(scene.scene_index)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["live_action", "scenes", index, "scene_index"],
          message: `Duplicate scene index ${scene.scene_index}`,
        });
      }
      sceneIndices.add(scene.scene_index);
    }

    const promptKeys = new Set<string>();
    const liveShotKeys = new Set(
      (pack.live_action?.scenes ?? []).flatMap((scene) =>
        scene.shots.map((shot) => `${scene.scene_index}:${shot.shot.toLowerCase()}`),
      ),
    );
    for (const [index, prompt] of (pack.ai_generation?.shot_prompts ?? []).entries()) {
      const key = `${prompt.scene_index}:${prompt.shot.toLowerCase()}`;
      if (promptKeys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ai_generation", "shot_prompts", index, "shot"],
          message: `Duplicate prompt target ${prompt.scene_index}:${prompt.shot}`,
        });
      }
      if (pack.live_action && !liveShotKeys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ai_generation", "shot_prompts", index, "shot"],
          message: `Prompt target ${prompt.scene_index}:${prompt.shot} has no matching live-action shot`,
        });
      }
      promptKeys.add(key);
    }

    const keyFrameIds = new Set<string>();
    const keyFrameCoordinates = new Set<string>();
    for (const [index, keyFrame] of (pack.animation?.key_frames ?? []).entries()) {
      const frameId = keyFrame.frame.toLowerCase();
      const coordinate = `${keyFrame.scene_index}:${frameId}`;
      if (keyFrameIds.has(frameId) || keyFrameCoordinates.has(coordinate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["animation", "key_frames", index, "frame"],
          message: `Duplicate keyframe identity ${keyFrame.scene_index}:${keyFrame.frame}`,
        });
      }
      keyFrameIds.add(frameId);
      keyFrameCoordinates.add(coordinate);
    }
  });

export type PrepPack = z.infer<typeof preproductionPackSchema>;

export interface PreproductionPackMetrics {
  scenes: number;
  shots: number;
  characters: number;
  keyFrames: number;
  prompts: number;
  continuityTokens: number;
  openQuestions: number;
}

export function getPreproductionPackMetrics(pack: PrepPack): PreproductionPackMetrics {
  return {
    scenes: pack.live_action?.scenes.length ?? 0,
    shots:
      pack.live_action?.scenes.reduce((total, scene) => total + scene.shots.length, 0) ?? 0,
    characters: pack.animation?.character_sheets?.length ?? 0,
    keyFrames: pack.animation?.key_frames.length ?? 0,
    prompts: pack.ai_generation?.shot_prompts.length ?? 0,
    continuityTokens: pack.ai_generation?.continuity_tokens?.length ?? 0,
    openQuestions: pack.open_questions.length,
  };
}

export function formatPreproductionPackIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "pack"}: ${issue.message}`)
    .join(" · ");
}

export function parsePreproductionPackJson(text: string): PrepPack {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new LocalPreproductionPackError(
      "INVALID_JSON",
      "The selected file is not valid JSON.",
    );
  }

  const parsed = preproductionPackSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LocalPreproductionPackError(
      "INVALID_PACK",
      `The JSON does not match the preproduction-pack contract. ${formatPreproductionPackIssues(parsed.error)}`,
    );
  }
  return parsed.data;
}

export type LocalPreproductionPackErrorCode =
  | "INVALID_FILE_TYPE"
  | "INVALID_FILE_NAME"
  | "INVALID_FILE_SIZE"
  | "FILE_TOO_LARGE"
  | "INVALID_ENCODING"
  | "INVALID_JSON"
  | "INVALID_PACK"
  | "HASH_UNAVAILABLE"
  | "STALE_PREVIEW";

export class LocalPreproductionPackError extends Error {
  readonly code: LocalPreproductionPackErrorCode;

  constructor(code: LocalPreproductionPackErrorCode, message: string) {
    super(message);
    this.name = "LocalPreproductionPackError";
    this.code = code;
  }
}

export interface LocalPreproductionPackPreview {
  readonly pack: PrepPack;
  readonly fileName: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly metrics: PreproductionPackMetrics;
  readonly bytes: ArrayBuffer;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function readLocalPreproductionPack(
  file: Pick<File, "name" | "size" | "arrayBuffer">,
): Promise<LocalPreproductionPackPreview> {
  const selectedName = file.name;
  const selectedSize = file.size;
  if (
    selectedName.length > MAX_PORTABLE_BASENAME_LENGTH ||
    !JSON_BASENAME_PATTERN.test(selectedName) ||
    hasInlineControl(selectedName)
  ) {
    throw new LocalPreproductionPackError(
      selectedName.toLowerCase().endsWith(".json")
        ? "INVALID_FILE_NAME"
        : "INVALID_FILE_TYPE",
      "Choose a basename-only .json preproduction-pack file.",
    );
  }
  if (!Number.isSafeInteger(selectedSize) || selectedSize <= 0) {
    throw new LocalPreproductionPackError(
      "INVALID_FILE_SIZE",
      "The selected file has an invalid declared byte length.",
    );
  }
  if (selectedSize > MAX_PREPRODUCTION_PACK_BYTES) {
    throw new LocalPreproductionPackError(
      "FILE_TOO_LARGE",
      "The selected file exceeds the 2 MiB local-preview limit.",
    );
  }

  const bytes = (await file.arrayBuffer()).slice(0);
  if (bytes.byteLength !== selectedSize) {
    throw new LocalPreproductionPackError(
      "INVALID_FILE_SIZE",
      "The selected file byte length changed while it was being read.",
    );
  }
  if (bytes.byteLength > MAX_PREPRODUCTION_PACK_BYTES) {
    throw new LocalPreproductionPackError(
      "FILE_TOO_LARGE",
      "The selected file exceeds the 2 MiB local-preview limit.",
    );
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new LocalPreproductionPackError(
      "INVALID_ENCODING",
      "The selected file is not valid UTF-8 JSON.",
    );
  }
  const pack = parsePreproductionPackJson(text);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new LocalPreproductionPackError(
      "HASH_UNAVAILABLE",
      "This browser cannot compute the required local SHA-256 receipt.",
    );
  }
  const digest = await subtle.digest("SHA-256", bytes);

  const retainedBytes = bytes.slice(0);
  const frozenPack = deepFreezeJson(pack);
  const frozenMetrics = deepFreezeJson(getPreproductionPackMetrics(pack));
  return Object.freeze({
    pack: frozenPack,
    fileName: selectedName,
    byteLength: bytes.byteLength,
    sha256: bytesToHex(digest),
    metrics: frozenMetrics,
    get bytes() {
      return retainedBytes.slice(0);
    },
  });
}

/**
 * Re-reads the retained exact bytes and refuses a preview whose parsed object,
 * metrics, hash, filename, or declared length has drifted since selection.
 */
export async function reverifyLocalPreproductionPackPreview(
  preview: LocalPreproductionPackPreview,
): Promise<LocalPreproductionPackPreview> {
  const retainedBytes = preview.bytes.slice(0);
  let reverified: LocalPreproductionPackPreview;
  try {
    reverified = await readLocalPreproductionPack({
      name: preview.fileName,
      size: retainedBytes.byteLength,
      async arrayBuffer() {
        return retainedBytes.slice(0);
      },
    });
  } catch (error) {
    if (error instanceof LocalPreproductionPackError && error.code === "HASH_UNAVAILABLE") {
      throw error;
    }
    throw new LocalPreproductionPackError(
      "STALE_PREVIEW",
      "The retained preproduction preview can no longer be verified from its exact selected bytes.",
    );
  }
  if (
    preview.byteLength !== reverified.byteLength ||
    preview.sha256 !== reverified.sha256 ||
    canonicalJson(preview.pack) !== canonicalJson(reverified.pack) ||
    canonicalJson(preview.metrics) !== canonicalJson(reverified.metrics)
  ) {
    throw new LocalPreproductionPackError(
      "STALE_PREVIEW",
      "The retained preproduction preview no longer matches its exact selected bytes.",
    );
  }
  return reverified;
}
