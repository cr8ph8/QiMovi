import { z } from "zod";
import { canonicalJson } from "./canonicalJson";
import {
  reverifyLocalPreproductionPackPreview,
  type LocalPreproductionPackPreview,
  type PrepPack,
} from "./preproductionPack";

export const MAX_STORYBOARD_REVIEW_BASIS_BYTES = 2 * 1024 * 1024;
export const MAX_STORYBOARD_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_STORYBOARD_IMAGE_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_STORYBOARD_REVIEW_FILES = 65;
const MAX_PORTABLE_BASENAME_LENGTH = 255;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const INPUT_BASENAME_PATTERN = /^[^/\\]+\.(?:json|png)$/i;
const JSON_BASENAME_PATTERN = /^[^/\\]+\.json$/i;
const PNG_BASENAME_PATTERN = /^[^/\\]+\.png$/i;
const hasInlineControl = (value: string): boolean =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
const hasUnsupportedMultilineControl = (value: string): boolean =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (
      code === 0x7f ||
      (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d)
    );
  });

const sha256Schema = z.string().regex(SHA256_PATTERN, "Expected a lowercase SHA-256 hash");
const boundedText = (max: number) =>
  z.string().min(1).max(max).refine((value) => value.trim().length > 0, "Cannot be blank");
const localPathDisclosurePatterns = [
  /file:[\\/]+/i,
  /\/Users\//i,
  /(?:^|[^A-Za-z0-9_])~[\\/]/,
  /(?:^|[^A-Za-z0-9_])\.\.?[\\/][^\s]/,
  /(?:^|[^A-Za-z0-9_/])\/[A-Za-z0-9._-]+(?:[\\/]|$)/,
  /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]/,
  /(?:^|[^A-Za-z0-9_\\])\\\\[^\\\s]+[\\/]/,
] as const;
const portableBoundedText = (max: number) =>
  boundedText(max).refine(
    (value) =>
      !hasInlineControl(value) &&
      !localPathDisclosurePatterns.some((pattern) => pattern.test(value)),
    "Control characters and local filesystem paths are not allowed",
  );
const portableOptionalText = (max: number) =>
  z.string().max(max).refine(
    (value) =>
      !hasUnsupportedMultilineControl(value) &&
      !localPathDisclosurePatterns.some((pattern) => pattern.test(value)),
    "Unsupported control characters and local filesystem paths are not allowed",
  );
const normalizeReceiptText = (value: string): string =>
  value.normalize("NFC").replace(/\r\n?/g, "\n").trim();
const boundedTextArray = (maxItems: number, maxLength: number) =>
  z.array(boundedText(maxLength)).max(maxItems);

const cropSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

const candidateSchema = z
  .object({
    kind: z.enum(["CONTACT_SHEET_PANEL", "STANDALONE_IMAGE"]),
    file_name: z
      .string()
      .min(1)
      .max(255)
      .regex(PNG_BASENAME_PATTERN, "Expected a basename-only PNG file name")
      .refine((value) => !hasInlineControl(value), "Control characters are not allowed"),
    asset_sha256: sha256Schema,
    pixel_width: z.number().int().positive().max(32_768),
    pixel_height: z.number().int().positive().max(32_768),
    panel: z.number().int().positive().max(10_000).optional(),
    crop: cropSchema.optional(),
  })
  .strict()
  .superRefine((candidate, ctx) => {
    if (candidate.kind === "CONTACT_SHEET_PANEL" && (!candidate.panel || !candidate.crop)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["crop"],
        message: "Contact-sheet candidates require a panel number and crop rectangle",
      });
    }
    if (candidate.kind === "STANDALONE_IMAGE" && (candidate.panel || candidate.crop)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["crop"],
        message: "Standalone candidates cannot declare a panel or crop rectangle",
      });
    }
    if (
      candidate.crop &&
      (candidate.crop.x + candidate.crop.width > candidate.pixel_width ||
        candidate.crop.y + candidate.crop.height > candidate.pixel_height)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["crop"],
        message: "Crop rectangle exceeds the declared image bounds",
      });
    }
  });

const reviewFrameSchema = z
  .object({
    frame_id: portableBoundedText(200),
    scene_index: z.number().int().positive().max(10_000),
    shot: portableBoundedText(80),
    description: boundedText(10_000),
    staging: z.string().max(10_000).optional(),
    board_state: boundedText(200),
    base_shot_sha256: sha256Schema,
    identity_reference_ids: boundedTextArray(100, 500),
    continuity_tokens: boundedTextArray(200, 500),
    required_outcomes: boundedTextArray(100, 5_000),
    forbidden_outcomes: boundedTextArray(100, 5_000),
    review_questions: boundedTextArray(50, 5_000),
    rights_scope: z.literal("INTERNAL_PREVISUALIZATION_ONLY"),
    current_disposition: z.literal("PENDING"),
    candidate: candidateSchema,
  })
  .strict();

export const storyboardReviewBasisSchema = z
  .object({
    schema_version: z.literal("filmstack-storyboard-review-basis/v1"),
    package_id: portableBoundedText(500),
    record_state: z.literal("PROSPECTIVE_DRAFT"),
    authority_state: z.literal("NO_EXTERNAL_AUTHORITY"),
    production_gate: z.literal("PRODUCE_BLOCKED"),
    review_scope: z.literal("INTERNAL_PREVISUALIZATION_SELECT_FOR_V0_4_ONLY"),
    source_status: z.literal("DECLARED_NOT_ADMITTED"),
    preproduction_pack_sha256: sha256Schema,
    board_register_sha256: sha256Schema,
    acceptance_matrix_sha256: sha256Schema,
    context_hash: sha256Schema,
    source_revision_hash: sha256Schema,
    human_select: z.literal("PENDING"),
    frames: z.array(reviewFrameSchema).min(1).max(64),
  })
  .strict()
  .superRefine((basis, ctx) => {
    const frameIds = new Set<string>();
    const shots = new Set<string>();
    const assets = new Map<string, { sha256: string; width: number; height: number }>();
    let previousSceneIndex = 0;

    for (const [index, frame] of basis.frames.entries()) {
      if (frame.scene_index < previousSceneIndex) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["frames", index, "scene_index"],
          message: "Frames must be ordered by nondecreasing scene index",
        });
      }
      previousSceneIndex = frame.scene_index;
      if (frameIds.has(frame.frame_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["frames", index, "frame_id"],
          message: `Duplicate frame id ${frame.frame_id}`,
        });
      }
      if (shots.has(frame.shot.toLowerCase())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["frames", index, "shot"],
          message: `Duplicate shot ${frame.shot}`,
        });
      }
      frameIds.add(frame.frame_id);
      shots.add(frame.shot.toLowerCase());

      const prior = assets.get(frame.candidate.file_name);
      const next = {
        sha256: frame.candidate.asset_sha256,
        width: frame.candidate.pixel_width,
        height: frame.candidate.pixel_height,
      };
      if (
        prior &&
        (prior.sha256 !== next.sha256 || prior.width !== next.width || prior.height !== next.height)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["frames", index, "candidate", "file_name"],
          message: `Candidate file ${frame.candidate.file_name} has conflicting declarations`,
        });
      }
      assets.set(frame.candidate.file_name, next);
    }
  });

export type StoryboardReviewBasis = z.infer<typeof storyboardReviewBasisSchema>;
export type StoryboardReviewFrame = StoryboardReviewBasis["frames"][number];
export type StoryboardReviewCandidate = StoryboardReviewFrame["candidate"];
export type StoryboardReviewDisposition = "ACCEPT" | "REPAIR" | "REJECT";

export type StoryboardReviewErrorCode =
  | "INVALID_FILE_SET"
  | "INVALID_FILE_NAME"
  | "INVALID_FILE_SIZE"
  | "FILE_TOO_LARGE"
  | "INVALID_ENCODING"
  | "INVALID_JSON"
  | "INVALID_BASIS"
  | "PACK_HASH_MISMATCH"
  | "PACK_COVERAGE_MISMATCH"
  | "CONTEXT_HASH_MISMATCH"
  | "MISSING_IMAGE"
  | "UNEXPECTED_IMAGE"
  | "INVALID_PNG"
  | "IMAGE_HASH_MISMATCH"
  | "IMAGE_DIMENSION_MISMATCH"
  | "HASH_UNAVAILABLE"
  | "INVALID_DECISIONS"
  | "TARGET_INELIGIBLE"
  | "STALE_REVIEW"
  | "INVALID_RECEIPT";

export class StoryboardReviewError extends Error {
  readonly code: StoryboardReviewErrorCode;

  constructor(code: StoryboardReviewErrorCode, message: string) {
    super(message);
    this.name = "StoryboardReviewError";
    this.code = code;
  }
}

export interface LocalReadableFile {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface VerifiedStoryboardAsset {
  readonly fileName: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly bytes: ArrayBuffer;
}

export interface LocalStoryboardReviewPreview {
  readonly basis: StoryboardReviewBasis;
  readonly basisFileName: string;
  readonly basisByteLength: number;
  readonly basisSha256: string;
  readonly basisBytes: ArrayBuffer;
  readonly contextHashVerification: "MATCHED_PACK_DECLARATION" | "DECLARED_ONLY_NOT_VERIFIED";
  readonly assets: Readonly<Record<string, VerifiedStoryboardAsset>>;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Bytes(bytes: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new StoryboardReviewError(
      "HASH_UNAVAILABLE",
      "This browser cannot compute the required local SHA-256 receipt.",
    );
  }
  return bytesToHex(await subtle.digest("SHA-256", bytes));
}

function parseReviewBasis(bytes: ArrayBuffer): StoryboardReviewBasis {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new StoryboardReviewError("INVALID_ENCODING", "The review-basis file is not valid UTF-8 JSON.");
  }

  if (text.startsWith("\uFEFF")) {
    throw new StoryboardReviewError(
      "INVALID_ENCODING",
      "The review-basis file must not contain a UTF-8 byte-order mark.",
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new StoryboardReviewError("INVALID_JSON", "The review-basis file is not valid JSON.");
  }

  const parsed = storyboardReviewBasisSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "basis"}: ${issue.message}`)
      .join(" · ");
    throw new StoryboardReviewError(
      "INVALID_BASIS",
      `The JSON does not match the storyboard-review-basis contract. ${issues}`,
    );
  }
  return parsed.data;
}

function readPngDimensions(bytes: ArrayBuffer): { width: number; height: number } {
  const data = new Uint8Array(bytes);
  if (
    data.byteLength < 24 ||
    !PNG_SIGNATURE.every((value, index) => data[index] === value) ||
    data[12] !== 0x49 ||
    data[13] !== 0x48 ||
    data[14] !== 0x44 ||
    data[15] !== 0x52
  ) {
    throw new StoryboardReviewError("INVALID_PNG", "A selected image is not a valid PNG with an IHDR header.");
  }
  const view = new DataView(bytes);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (!width || !height || width > 32_768 || height > 32_768) {
    throw new StoryboardReviewError("INVALID_PNG", "A selected PNG has invalid or unsupported dimensions.");
  }
  return { width, height };
}

function assertBasisMatchesPack(
  basis: StoryboardReviewBasis,
  preview: LocalPreproductionPackPreview,
): void {
  if (basis.preproduction_pack_sha256 !== preview.sha256.toLowerCase()) {
    throw new StoryboardReviewError(
      "PACK_HASH_MISMATCH",
      "This review basis is not bound to the exact preproduction pack currently loaded.",
    );
  }
  if (preview.pack._meta?.context_hash && basis.context_hash !== preview.pack._meta.context_hash) {
    throw new StoryboardReviewError(
      "CONTEXT_HASH_MISMATCH",
      "The review basis declares a different context hash than the loaded pack.",
    );
  }

  const keyFrames = preview.pack.animation?.key_frames ?? [];
  if (keyFrames.length !== basis.frames.length) {
    throw new StoryboardReviewError(
      "PACK_COVERAGE_MISMATCH",
      "The review basis must cover every keyframe in the loaded pack exactly once.",
    );
  }
  const liveShots = new Map(
    (preview.pack.live_action?.scenes ?? []).flatMap((scene) =>
      scene.shots.map((shot) => [
        `${scene.scene_index}:${shot.shot.toLowerCase()}`,
        shot,
      ] as const),
    ),
  );
  if (liveShots.size === 0) {
    throw new StoryboardReviewError(
      "PACK_COVERAGE_MISMATCH",
      "Storyboard review requires a live-action shot plan for exact internal keyframe-to-shot matching.",
    );
  }
  const framesById = new Map(basis.frames.map((frame) => [frame.frame_id, frame]));
  for (const keyFrame of keyFrames) {
    const basisFrame = framesById.get(keyFrame.frame);
    const liveShot = basisFrame
      ? liveShots.get(`${basisFrame.scene_index}:${basisFrame.shot.toLowerCase()}`)
      : undefined;
    if (
      !basisFrame ||
      basisFrame.scene_index !== keyFrame.scene_index ||
      basisFrame.description !== keyFrame.description ||
      (basisFrame.staging ?? undefined) !== (keyFrame.staging ?? undefined) ||
      !liveShot ||
      liveShot.description !== keyFrame.description
    ) {
      throw new StoryboardReviewError(
        "PACK_COVERAGE_MISMATCH",
        `Review frame ${keyFrame.frame} does not exactly match the loaded pack and shot plan.`,
      );
    }
  }
}

export async function readLocalStoryboardReview(
  files: readonly LocalReadableFile[],
  packPreview: LocalPreproductionPackPreview,
): Promise<LocalStoryboardReviewPreview> {
  const reverifiedPack = await reverifyLocalPreproductionPackPreview(packPreview);
  if (!files.length || files.length > MAX_STORYBOARD_REVIEW_FILES) {
    throw new StoryboardReviewError(
      "INVALID_FILE_SET",
      `Choose one review-basis JSON and its PNG assets (maximum ${MAX_STORYBOARD_REVIEW_FILES} files).`,
    );
  }

  const selectedFiles = files.map((file) => ({
    file,
    name: file.name,
    size: file.size,
  }));
  const names = new Set<string>();
  for (const selected of selectedFiles) {
    if (
      selected.name.length > MAX_PORTABLE_BASENAME_LENGTH ||
      !INPUT_BASENAME_PATTERN.test(selected.name) ||
      hasInlineControl(selected.name)
    ) {
      throw new StoryboardReviewError(
        "INVALID_FILE_NAME",
        "Storyboard review inputs must use basename-only .json or .png names.",
      );
    }
    if (!Number.isSafeInteger(selected.size) || selected.size <= 0) {
      throw new StoryboardReviewError(
        "INVALID_FILE_SIZE",
        `Storyboard review input ${selected.name} has an invalid declared byte length.`,
      );
    }
    if (names.has(selected.name)) {
      throw new StoryboardReviewError("INVALID_FILE_SET", `Duplicate selected file name ${selected.name}.`);
    }
    names.add(selected.name);
  }

  const jsonFiles = selectedFiles.filter((selected) => selected.name.toLowerCase().endsWith(".json"));
  const imageFiles = selectedFiles.filter((selected) => selected.name.toLowerCase().endsWith(".png"));
  if (jsonFiles.length !== 1 || jsonFiles.length + imageFiles.length !== selectedFiles.length) {
    throw new StoryboardReviewError(
      "INVALID_FILE_SET",
      "Choose exactly one .json review basis and only its referenced .png files.",
    );
  }
  const basisFile = jsonFiles[0];
  if (basisFile.size > MAX_STORYBOARD_REVIEW_BASIS_BYTES) {
    throw new StoryboardReviewError("FILE_TOO_LARGE", "The review-basis JSON exceeds the 2 MiB limit.");
  }
  if (imageFiles.some((file) => file.size > MAX_STORYBOARD_IMAGE_BYTES)) {
    throw new StoryboardReviewError("FILE_TOO_LARGE", "A storyboard PNG exceeds the 8 MiB per-image limit.");
  }
  const declaredImageBytes = imageFiles.reduce((total, selected) => total + selected.size, 0);
  if (declaredImageBytes > MAX_STORYBOARD_IMAGE_TOTAL_BYTES) {
    throw new StoryboardReviewError("FILE_TOO_LARGE", "The selected storyboard PNGs exceed the 20 MiB total limit.");
  }

  const basisBytes = (await basisFile.file.arrayBuffer()).slice(0);
  if (basisBytes.byteLength !== basisFile.size) {
    throw new StoryboardReviewError(
      "INVALID_FILE_SIZE",
      "The review-basis byte length changed while it was being read.",
    );
  }
  if (basisBytes.byteLength > MAX_STORYBOARD_REVIEW_BASIS_BYTES) {
    throw new StoryboardReviewError("FILE_TOO_LARGE", "The review-basis JSON exceeds the 2 MiB limit.");
  }
  const basis = parseReviewBasis(basisBytes);
  assertBasisMatchesPack(basis, reverifiedPack);

  const declarations = new Map<string, StoryboardReviewCandidate>();
  for (const frame of basis.frames) declarations.set(frame.candidate.file_name, frame.candidate);
  const selected = new Map(imageFiles.map((entry) => [entry.name, entry]));
  for (const fileName of declarations.keys()) {
    if (!selected.has(fileName)) {
      throw new StoryboardReviewError("MISSING_IMAGE", `Missing required storyboard image ${fileName}.`);
    }
  }
  for (const fileName of selected.keys()) {
    if (!declarations.has(fileName)) {
      throw new StoryboardReviewError("UNEXPECTED_IMAGE", `Unexpected storyboard image ${fileName}.`);
    }
  }

  const assets: Record<string, VerifiedStoryboardAsset> = {};
  let actualTotal = 0;
  for (const [fileName, declaration] of declarations.entries()) {
    const file = selected.get(fileName)!;
    const bytes = (await file.file.arrayBuffer()).slice(0);
    if (bytes.byteLength !== file.size) {
      throw new StoryboardReviewError(
        "INVALID_FILE_SIZE",
        `Storyboard image ${fileName} byte length changed while it was being read.`,
      );
    }
    actualTotal += bytes.byteLength;
    if (bytes.byteLength > MAX_STORYBOARD_IMAGE_BYTES || actualTotal > MAX_STORYBOARD_IMAGE_TOTAL_BYTES) {
      throw new StoryboardReviewError("FILE_TOO_LARGE", "The selected storyboard PNG bytes exceed the local limits.");
    }
    const dimensions = readPngDimensions(bytes);
    const sha256 = await sha256Bytes(bytes);
    if (sha256 !== declaration.asset_sha256) {
      throw new StoryboardReviewError(
        "IMAGE_HASH_MISMATCH",
        `Storyboard image ${fileName} does not match its declared exact-byte SHA-256.`,
      );
    }
    if (
      dimensions.width !== declaration.pixel_width ||
      dimensions.height !== declaration.pixel_height
    ) {
      throw new StoryboardReviewError(
        "IMAGE_DIMENSION_MISMATCH",
        `Storyboard image ${fileName} does not match its declared pixel dimensions.`,
      );
    }
    assets[fileName] = Object.freeze({
      fileName,
      byteLength: bytes.byteLength,
      sha256,
      pixelWidth: dimensions.width,
      pixelHeight: dimensions.height,
      bytes: bytes.slice(0),
    });
  }

  return Object.freeze({
    basis,
    basisFileName: basisFile.name,
    basisByteLength: basisBytes.byteLength,
    basisSha256: await sha256Bytes(basisBytes),
    basisBytes: basisBytes.slice(0),
    contextHashVerification: reverifiedPack.pack._meta?.context_hash
      ? "MATCHED_PACK_DECLARATION"
      : "DECLARED_ONLY_NOT_VERIFIED",
    assets: Object.freeze(assets),
  });
}

/**
 * Replays every exact-byte check against retained local bytes immediately before
 * a receipt is built. The returned object is a fresh snapshot, so later caller
 * mutation cannot alter the bytes being serialized.
 */
export async function reverifyLocalStoryboardReviewPreview(input: {
  review: LocalStoryboardReviewPreview;
  packPreview: LocalPreproductionPackPreview;
}): Promise<LocalStoryboardReviewPreview> {
  const reverifiedPack = await reverifyLocalPreproductionPackPreview(input.packPreview);
  if (
    input.review.basisFileName.length > MAX_PORTABLE_BASENAME_LENGTH ||
    !JSON_BASENAME_PATTERN.test(input.review.basisFileName) ||
    hasInlineControl(input.review.basisFileName)
  ) {
    throw new StoryboardReviewError(
      "STALE_REVIEW",
      "The retained storyboard review basis filename is not a safe basename-only JSON name.",
    );
  }
  const basisBytes = input.review.basisBytes.slice(0);
  if (
    basisBytes.byteLength !== input.review.basisByteLength ||
    (await sha256Bytes(basisBytes)) !== input.review.basisSha256
  ) {
    throw new StoryboardReviewError(
      "STALE_REVIEW",
      "The retained storyboard review basis no longer matches its verified exact bytes.",
    );
  }
  const basis = parseReviewBasis(basisBytes);
  if (canonicalJson(basis) !== canonicalJson(input.review.basis)) {
    throw new StoryboardReviewError(
      "STALE_REVIEW",
      "The retained storyboard review basis object drifted from its exact selected bytes.",
    );
  }
  assertBasisMatchesPack(basis, reverifiedPack);

  const declarations = new Map(
    basis.frames.map((frame) => [frame.candidate.file_name, frame.candidate]),
  );
  const assetNames = Object.keys(input.review.assets);
  if (
    assetNames.length !== declarations.size ||
    assetNames.some((fileName) => !declarations.has(fileName))
  ) {
    throw new StoryboardReviewError(
      "STALE_REVIEW",
      "The retained storyboard asset set no longer matches the exact review basis.",
    );
  }

  const assets: Record<string, VerifiedStoryboardAsset> = {};
  let actualTotal = 0;
  for (const [fileName, declaration] of declarations.entries()) {
    const retained = input.review.assets[fileName];
    if (!retained) {
      throw new StoryboardReviewError(
        "STALE_REVIEW",
        `The retained storyboard asset ${fileName} is missing.`,
      );
    }
    if (retained.fileName !== fileName) {
      throw new StoryboardReviewError(
        "STALE_REVIEW",
        `The retained storyboard asset label for ${fileName} drifted from its exact review basis.`,
      );
    }
    const bytes = retained.bytes.slice(0);
    actualTotal += bytes.byteLength;
    if (
      bytes.byteLength !== retained.byteLength ||
      bytes.byteLength > MAX_STORYBOARD_IMAGE_BYTES ||
      actualTotal > MAX_STORYBOARD_IMAGE_TOTAL_BYTES
    ) {
      throw new StoryboardReviewError(
        "STALE_REVIEW",
        `The retained storyboard asset ${fileName} has an invalid byte length.`,
      );
    }
    const dimensions = readPngDimensions(bytes);
    const sha256 = await sha256Bytes(bytes);
    if (
      sha256 !== retained.sha256 ||
      sha256 !== declaration.asset_sha256 ||
      dimensions.width !== retained.pixelWidth ||
      dimensions.height !== retained.pixelHeight ||
      dimensions.width !== declaration.pixel_width ||
      dimensions.height !== declaration.pixel_height
    ) {
      throw new StoryboardReviewError(
        "STALE_REVIEW",
        `The retained storyboard asset ${fileName} no longer matches its exact verified declaration.`,
      );
    }
    assets[fileName] = Object.freeze({
      fileName,
      byteLength: bytes.byteLength,
      sha256,
      pixelWidth: dimensions.width,
      pixelHeight: dimensions.height,
      bytes,
    });
  }

  return Object.freeze({
    basis,
    basisFileName: input.review.basisFileName,
    basisByteLength: basisBytes.byteLength,
    basisSha256: input.review.basisSha256,
    basisBytes,
    contextHashVerification: reverifiedPack.pack._meta?.context_hash
      ? "MATCHED_PACK_DECLARATION"
      : "DECLARED_ONLY_NOT_VERIFIED",
    assets: Object.freeze(assets),
  });
}

export interface StoryboardReviewDecisionInput {
  frameId: string;
  disposition: StoryboardReviewDisposition;
  note: string;
}

const receiptCandidateSchema = candidateSchema;
const exactJsonBindingSchema = z
  .object({
    file_name: z
      .string()
      .min(1)
      .max(255)
      .regex(JSON_BASENAME_PATTERN)
      .refine((value) => !hasInlineControl(value), "Control characters are not allowed"),
    byte_length: z.number().int().positive().max(MAX_STORYBOARD_REVIEW_BASIS_BYTES),
    sha256: sha256Schema,
    verification: z.literal("EXACT_BYTES_REVERIFIED"),
  })
  .strict();

export const storyboardReviewReceiptSchema = z
  .object({
    schema_version: z.literal("filmstack-storyboard-review-receipt/v3"),
    receipt_state: z.literal("LOCAL_REVIEW_DRAFT"),
    authority_state: z.literal("NO_EXTERNAL_AUTHORITY"),
    review_scope: z.literal("INTERNAL_PREVISUALIZATION_SELECT_FOR_V0_4_ONLY"),
    determinism: z.literal("SAME_EXACT_INPUTS_SAME_BYTES"),
    target_evidence_scope: z.literal(
      "EXACT_LOCAL_BYTES_AND_INTERNAL_FRAME_CROSSWALK_VERIFIED",
    ),
    source_to_target_correspondence: z.literal(
      "INCOMPLETE_SOURCE_REVISION_NOT_VERIFIED",
    ),
    reviewer: z
      .object({
        label: portableBoundedText(200),
        identity_assurance: z.literal("SELF_ATTESTED_LOCAL"),
      })
      .strict(),
    basis: z
      .object({
        package_id: portableBoundedText(500),
        keyframe_correspondence: z.literal(
          "MATCHED_PACK_FRAME_SCENE_DESCRIPTION_AND_STAGING",
        ),
        shot_binding: z.literal("MATCHED_PACK_LIVE_SHOT_BY_SCENE_AND_EXACT_DESCRIPTION"),
        preproduction_pack: exactJsonBindingSchema,
        review_basis: exactJsonBindingSchema,
        board_register: z
          .object({
            sha256: sha256Schema,
            verification: z.literal("DECLARED_ONLY_NOT_VERIFIED"),
          })
          .strict(),
        acceptance_matrix: z
          .object({
            sha256: sha256Schema,
            verification: z.literal("DECLARED_ONLY_NOT_VERIFIED"),
          })
          .strict(),
        context: z
          .object({
            sha256: sha256Schema,
            verification: z.literal("MATCHED_PACK_DECLARATION"),
          })
          .strict(),
        source_revision: z
          .object({
            sha256: sha256Schema,
            verification: z.literal("DECLARED_ONLY_NOT_VERIFIED"),
          })
          .strict(),
        source_status: z.literal("DECLARED_NOT_ADMITTED"),
        production_gate: z.literal("PRODUCE_BLOCKED"),
      })
      .strict(),
    completeness: z.literal("COMPLETE"),
    summary: z
      .object({
        total: z.number().int().positive().max(64),
        accepted: z.number().int().nonnegative().max(64),
        repair: z.number().int().nonnegative().max(64),
        rejected: z.number().int().nonnegative().max(64),
      })
      .strict(),
    decisions: z
      .array(
        z
          .object({
            frame_id: portableBoundedText(200),
            scene_index: z.number().int().positive().max(10_000),
            shot: portableBoundedText(80),
            base_shot_sha256: sha256Schema,
            base_shot_verification: z.literal("DECLARED_ONLY_NOT_VERIFIED"),
            candidate: receiptCandidateSchema,
            candidate_asset_verification: z.literal("EXACT_BYTES_REVERIFIED"),
            disposition: z.enum(["ACCEPT", "REPAIR", "REJECT"]),
            note: portableOptionalText(2_000),
          })
          .strict()
          .superRefine((decision, ctx) => {
            if (decision.disposition !== "ACCEPT" && !decision.note.trim()) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["note"],
                message: `${decision.disposition} requires a note`,
              });
            }
          }),
      )
      .min(1)
      .max(64),
    effects: z
      .object({
        authoritative_state_change: z.literal("NONE"),
        receipt_output: z.literal("LOCAL_EXPORT_ONLY"),
        project_artifact_creation: z.literal("NOT_PERFORMED"),
        admission_candidate_creation: z.literal("NOT_PERFORMED"),
        source_admission: z.literal("NOT_PERFORMED"),
        storyboard_promotion: z.literal("NOT_PERFORMED"),
        production_gate: z.literal("UNCHANGED_PRODUCE_BLOCKED"),
        motion_generation: z.literal("BLOCKED"),
        persistence: z.literal("NONE"),
        upload: z.literal(false),
        provider_call: z.literal(false),
        token_spend: z.literal(false),
        project_commit: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((receipt, ctx) => {
    const ids = new Set<string>();
    const shots = new Set<string>();
    let previousSceneIndex = 0;
    for (const [index, decision] of receipt.decisions.entries()) {
      const shotKey = decision.shot.toLowerCase();
      if (ids.has(decision.frame_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["decisions", index, "frame_id"],
          message: `Duplicate decision frame id ${decision.frame_id}`,
        });
      }
      if (shots.has(shotKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["decisions", index, "shot"],
          message: `Duplicate decision shot ${decision.shot}`,
        });
      }
      if (decision.scene_index < previousSceneIndex) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["decisions", index, "scene_index"],
          message: "Decisions must be ordered by nondecreasing scene index",
        });
      }
      ids.add(decision.frame_id);
      shots.add(shotKey);
      previousSceneIndex = decision.scene_index;
    }
    const expected = {
      total: receipt.decisions.length,
      accepted: receipt.decisions.filter((item) => item.disposition === "ACCEPT").length,
      repair: receipt.decisions.filter((item) => item.disposition === "REPAIR").length,
      rejected: receipt.decisions.filter((item) => item.disposition === "REJECT").length,
    };
    if (
      receipt.summary.total !== expected.total ||
      receipt.summary.accepted !== expected.accepted ||
      receipt.summary.repair !== expected.repair ||
      receipt.summary.rejected !== expected.rejected
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary"],
        message: "Receipt summary must exactly match the unique recorded decisions",
      });
    }
  });

export type StoryboardReviewReceipt = z.infer<typeof storyboardReviewReceiptSchema>;

export async function buildStoryboardReviewReceipt(input: {
  review: LocalStoryboardReviewPreview;
  packPreview: LocalPreproductionPackPreview;
  reviewerLabel: string;
  decisions: readonly StoryboardReviewDecisionInput[];
}): Promise<StoryboardReviewReceipt> {
  const reviewerLabel = normalizeReceiptText(input.reviewerLabel);
  const decisionSnapshot = input.decisions.map((decision) => ({
    frameId: decision.frameId,
    disposition: decision.disposition,
    note: normalizeReceiptText(decision.note),
  }));
  const packSnapshot = await reverifyLocalPreproductionPackPreview(input.packPreview);
  const reviewSnapshot = await reverifyLocalStoryboardReviewPreview({
    review: input.review,
    packPreview: packSnapshot,
  });
  const { basis } = reviewSnapshot;
  if (reviewSnapshot.contextHashVerification !== "MATCHED_PACK_DECLARATION") {
    throw new StoryboardReviewError(
      "TARGET_INELIGIBLE",
      "A deterministic target receipt requires the exact review context hash to match the loaded pack declaration.",
    );
  }
  const decisionsByFrame = new Map(decisionSnapshot.map((decision) => [decision.frameId, decision]));
  if (decisionsByFrame.size !== decisionSnapshot.length || decisionsByFrame.size !== basis.frames.length) {
    throw new StoryboardReviewError(
      "INVALID_DECISIONS",
      "A complete receipt requires exactly one decision for every review frame.",
    );
  }

  const decisions = basis.frames.map((frame) => {
    const decision = decisionsByFrame.get(frame.frame_id);
    if (!decision || (decision.disposition !== "ACCEPT" && !decision.note.trim())) {
      throw new StoryboardReviewError(
        "INVALID_DECISIONS",
        `Frame ${frame.frame_id} needs a valid disposition and repair/reject note.`,
      );
    }
    return {
      frame_id: frame.frame_id,
      scene_index: frame.scene_index,
      shot: frame.shot,
      base_shot_sha256: frame.base_shot_sha256,
      base_shot_verification: "DECLARED_ONLY_NOT_VERIFIED" as const,
      candidate: frame.candidate,
      candidate_asset_verification: "EXACT_BYTES_REVERIFIED" as const,
      disposition: decision.disposition,
      note: decision.note,
    };
  });
  const receipt = {
    schema_version: "filmstack-storyboard-review-receipt/v3" as const,
    receipt_state: "LOCAL_REVIEW_DRAFT" as const,
    authority_state: "NO_EXTERNAL_AUTHORITY" as const,
    review_scope: "INTERNAL_PREVISUALIZATION_SELECT_FOR_V0_4_ONLY" as const,
    determinism: "SAME_EXACT_INPUTS_SAME_BYTES" as const,
    target_evidence_scope:
      "EXACT_LOCAL_BYTES_AND_INTERNAL_FRAME_CROSSWALK_VERIFIED" as const,
    source_to_target_correspondence:
      "INCOMPLETE_SOURCE_REVISION_NOT_VERIFIED" as const,
    reviewer: {
      label: reviewerLabel,
      identity_assurance: "SELF_ATTESTED_LOCAL" as const,
    },
    basis: {
      package_id: basis.package_id,
      keyframe_correspondence: "MATCHED_PACK_FRAME_SCENE_DESCRIPTION_AND_STAGING" as const,
      shot_binding: "MATCHED_PACK_LIVE_SHOT_BY_SCENE_AND_EXACT_DESCRIPTION" as const,
      preproduction_pack: {
        file_name: packSnapshot.fileName,
        byte_length: packSnapshot.byteLength,
        sha256: packSnapshot.sha256,
        verification: "EXACT_BYTES_REVERIFIED" as const,
      },
      review_basis: {
        file_name: reviewSnapshot.basisFileName,
        byte_length: reviewSnapshot.basisByteLength,
        sha256: reviewSnapshot.basisSha256,
        verification: "EXACT_BYTES_REVERIFIED" as const,
      },
      board_register: {
        sha256: basis.board_register_sha256,
        verification: "DECLARED_ONLY_NOT_VERIFIED" as const,
      },
      acceptance_matrix: {
        sha256: basis.acceptance_matrix_sha256,
        verification: "DECLARED_ONLY_NOT_VERIFIED" as const,
      },
      context: {
        sha256: basis.context_hash,
        verification: reviewSnapshot.contextHashVerification,
      },
      source_revision: {
        sha256: basis.source_revision_hash,
        verification: "DECLARED_ONLY_NOT_VERIFIED" as const,
      },
      source_status: basis.source_status,
      production_gate: "PRODUCE_BLOCKED" as const,
    },
    completeness: "COMPLETE" as const,
    summary: {
      total: decisions.length,
      accepted: decisions.filter((decision) => decision.disposition === "ACCEPT").length,
      repair: decisions.filter((decision) => decision.disposition === "REPAIR").length,
      rejected: decisions.filter((decision) => decision.disposition === "REJECT").length,
    },
    decisions,
    effects: {
      authoritative_state_change: "NONE" as const,
      receipt_output: "LOCAL_EXPORT_ONLY" as const,
      project_artifact_creation: "NOT_PERFORMED" as const,
      admission_candidate_creation: "NOT_PERFORMED" as const,
      source_admission: "NOT_PERFORMED" as const,
      storyboard_promotion: "NOT_PERFORMED" as const,
      production_gate: "UNCHANGED_PRODUCE_BLOCKED" as const,
      motion_generation: "BLOCKED" as const,
      persistence: "NONE" as const,
      upload: false as const,
      provider_call: false as const,
      token_spend: false as const,
      project_commit: false as const,
    },
  };
  const parsed = storyboardReviewReceiptSchema.safeParse(receipt);
  if (!parsed.success) {
    throw new StoryboardReviewError(
      "INVALID_DECISIONS",
      `The local receipt is incomplete or invalid. ${parsed.error.issues[0]?.message ?? "Unknown error"}`,
    );
  }
  return parsed.data;
}

export function serializeStoryboardReviewReceipt(receipt: StoryboardReviewReceipt): Uint8Array {
  const parsed = storyboardReviewReceiptSchema.safeParse(receipt);
  if (!parsed.success) {
    throw new StoryboardReviewError(
      "INVALID_RECEIPT",
      "Refusing to serialize an invalid or weakened storyboard review receipt.",
    );
  }
  return new TextEncoder().encode(`${canonicalJson(parsed.data)}\n`);
}

export function getPackKeyFrames(pack: PrepPack) {
  return pack.animation?.key_frames ?? [];
}
