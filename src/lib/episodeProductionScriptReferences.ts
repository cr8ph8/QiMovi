import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import type {
  LocalEpisodeProductionScriptPreview,
  LocalReadableFile,
} from "@/lib/episodeProductionScript";

export const MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_BASIS_BYTES =
  2 * 1024 * 1024;
export const MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_IMAGE_BYTES =
  8 * 1024 * 1024;
export const MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_TOTAL_IMAGE_BYTES =
  32 * 1024 * 1024;
export const MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_IMAGE_WIDTH = 16_384;
export const MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_IMAGE_HEIGHT = 16_384;
export const MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_IMAGE_PIXELS =
  40_000_000;
export const MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_CANDIDATES_PER_GROUP = 8;
export const MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_CANDIDATES = 32;

export const EPISODE_PRODUCTION_SCRIPT_REFERENCE_GROUP_IDS = [
  "ARCHI_IDENTITY",
  "PATRICK_LIKENESS",
  "INVENTOR_LAB_ENVIRONMENT",
  "ORIGINAL_STYLE_PALETTE",
] as const;

export const EPISODE_PRODUCTION_SCRIPT_REFERENCE_DISPOSITIONS = [
  "ACCEPT_CANDIDATE",
  "REPAIR",
  "REJECT",
] as const;

export type EpisodeProductionScriptReferenceGroupId =
  (typeof EPISODE_PRODUCTION_SCRIPT_REFERENCE_GROUP_IDS)[number];
export type EpisodeProductionScriptReferenceDisposition =
  (typeof EPISODE_PRODUCTION_SCRIPT_REFERENCE_DISPOSITIONS)[number];

export const CURRENT_ARCHI_EPISODE_REFERENCE_BASIS_ID =
  "prospective-archi-test-23-episode-01-visual-reference-review-v0.1";
export const CURRENT_ARCHI_PRODUCTION_SCRIPT_PACKAGE_ID =
  "prospective-archi-test-23-episode-01-almost-v0.1";
export const CURRENT_ARCHI_STORY_ROOM_PACKAGE_ID =
  "prospective-archi-test-23-micro-series-v0.1";
export const CURRENT_ARCHI_REFERENCE_MAPPING_POLICY =
  "ARCHI_EP01_EXACT_VISUAL_REQUIREMENT_MAP_V1";

const CURRENT_STORY_ROOM_BINDING = {
  fileName: "story-room-pack.v1.json",
  byteLength: 33_517,
  sha256:
    "8178cce801110f09e42dc412c626569c04c2d29c7ae6175128eb0bbf95ec7306",
} as const;
const CURRENT_MANIFEST_BINDING = {
  fileName: "episode-production-script-pack.v1.json",
  byteLength: 14_290,
  sha256:
    "375172486190b1c4d9efa0cad104df0d52286f55e5e42fb36ca61557aff6bff9",
} as const;
const CURRENT_FOUNTAIN_BINDING = {
  fileName: "EP01_ALMOST.fountain",
  byteLength: 3_569,
  sha256:
    "1fa0aaed527d2850de9d8611f1bb26c8054273f183982cd2313bd77a34b44fad",
} as const;

const CURRENT_VISUAL_REQUIREMENTS = [
  {
    groupId: "ARCHI_IDENTITY",
    requirementIndex: 1,
    item: "ARCHi Light Seed identity reference",
    state: "MISSING_APPROVAL",
    referenceKind: "CHARACTER_IDENTITY",
    subjectId: "archi",
  },
  {
    groupId: "PATRICK_LIKENESS",
    requirementIndex: 2,
    item: "Patrick character and likeness reference",
    state: "MISSING_APPROVAL",
    referenceKind: "PERSON_LIKENESS",
    subjectId: "patrick",
  },
  {
    groupId: "INVENTOR_LAB_ENVIRONMENT",
    requirementIndex: 3,
    item: "Inventor-laboratory environment",
    state: "NOT_LOCKED",
    referenceKind: "ENVIRONMENT",
    subjectId: null,
  },
  {
    groupId: "ORIGINAL_STYLE_PALETTE",
    requirementIndex: 4,
    item: "Original style and palette reference",
    state: "MISSING_APPROVAL",
    referenceKind: "STYLE_PALETTE",
    subjectId: null,
  },
] as const;

const CURRENT_EXCLUDED_REQUIREMENT = {
  requirementIndex: 5,
  item: "Dialogue and voice plan",
  state: "MISSING_APPROVAL",
  exclusionReason: "NON_VISUAL_OUT_OF_SCOPE",
} as const;

const CURRENT_SOURCE_REQUIREMENTS = [
  ...CURRENT_VISUAL_REQUIREMENTS.map(({ item, state }) => ({ item, state })),
  {
    item: CURRENT_EXCLUDED_REQUIREMENT.item,
    state: CURRENT_EXCLUDED_REQUIREMENT.state,
  },
] as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PNG_SIGNATURE = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
] as const;

const sha256Schema = z
  .string()
  .regex(SHA256_PATTERN, "Expected a lowercase 64-character SHA-256 hash");

const boundedText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, "Cannot be blank");

const LOCAL_PATH_DISCLOSURE_PATTERNS = [
  /file:[\\/]+/i,
  /\/Users\//i,
  /(?:^|[^A-Za-z0-9_])~[\\/]/,
  /(?:^|[^A-Za-z0-9_])\.\.?[\\/][^\s]/,
  /(?:^|[^A-Za-z0-9_/])\/[A-Za-z0-9._-]+(?:[\\/]|$)/,
  /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]/,
  /(?:^|[^A-Za-z0-9_\\])\\\\[^\\\s]+[\\/]/,
] as const;

function containsLocalPathDisclosure(value: string): boolean {
  return LOCAL_PATH_DISCLOSURE_PATTERNS.some((pattern) => pattern.test(value));
}

const portableBoundedText = (max: number, fieldLabel: string) =>
  boundedText(max).refine(
    (value) => !containsLocalPathDisclosure(value),
    `${fieldLabel} must use portable text and cannot disclose absolute or local filesystem paths`,
  );

const portableOptionalText = (max: number, fieldLabel: string) =>
  z
    .string()
    .max(max)
    .refine(
      (value) => !containsLocalPathDisclosure(value),
      `${fieldLabel} must use portable text and cannot disclose absolute or local filesystem paths`,
    );

const basenameSchema = (extension: "json" | "png") =>
  z
    .string()
    .min(1)
    .max(255)
    .regex(
      new RegExp(`^(?!.*[\\u0000-\\u001f\\u007f])[^/\\\\]+\\.${extension}$`, "i"),
      `Expected a safe basename-only .${extension} file name`,
    );

function currentExactFileBindingSchema(
  binding:
    | typeof CURRENT_STORY_ROOM_BINDING
    | typeof CURRENT_MANIFEST_BINDING
    | typeof CURRENT_FOUNTAIN_BINDING,
) {
  return z
    .object({
      file_name: z.literal(binding.fileName),
      byte_length: z.literal(binding.byteLength),
      sha256: z.literal(binding.sha256),
      verification: z.literal("EXACT_BYTES_VERIFIED"),
    })
    .strict();
}

const reviewBasisFileBindingSchema = z
  .object({
    file_name: basenameSchema("json"),
    byte_length: z
      .number()
      .int()
      .positive()
      .max(MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_BASIS_BYTES),
    sha256: sha256Schema,
    verification: z.literal("EXACT_BYTES_VERIFIED"),
  })
  .strict();

export interface EpisodeProductionScriptReferenceCandidate {
  file_name: string;
  byte_length: number;
  sha256: string;
  pixel_width: number;
  pixel_height: number;
  alt_text: string;
  caption: string;
  provenance: {
    declaration: string;
    verification: "DECLARED_ONLY_NOT_VERIFIED";
  };
  rights_state: "DECLARED_ONLY_NOT_VERIFIED";
}

export interface EpisodeProductionScriptReferenceGroup {
  group_id: EpisodeProductionScriptReferenceGroupId;
  requirement_index: number;
  requirement_item: string;
  requirement_source_state: "MISSING_APPROVAL" | "NOT_LOCKED";
  reference_kind:
    | "CHARACTER_IDENTITY"
    | "PERSON_LIKENESS"
    | "ENVIRONMENT"
    | "STYLE_PALETTE";
  subject_id: string | null;
  candidates: EpisodeProductionScriptReferenceCandidate[];
}

const candidateShape = {
    file_name: basenameSchema("png"),
    byte_length: z
      .number()
      .int()
      .positive()
      .max(MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_IMAGE_BYTES),
    sha256: sha256Schema,
    pixel_width: z
      .number()
      .int()
      .positive()
      .max(MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_IMAGE_WIDTH),
    pixel_height: z
      .number()
      .int()
      .positive()
      .max(MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_IMAGE_HEIGHT),
    alt_text: portableBoundedText(1_000, "Alt text"),
    caption: portableBoundedText(2_000, "Captions"),
    provenance: z
      .object({
        declaration: portableBoundedText(2_000, "Provenance declarations"),
        verification: z.literal("DECLARED_ONLY_NOT_VERIFIED"),
      })
      .strict(),
    rights_state: z.literal("DECLARED_ONLY_NOT_VERIFIED"),
} as const;

function addCandidatePixelAreaIssue(
  candidate: { pixel_width: number; pixel_height: number },
  ctx: z.RefinementCtx,
): void {
  if (
    candidate.pixel_width * candidate.pixel_height >
    MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_IMAGE_PIXELS
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pixel_width"],
      message: "Declared image pixel area exceeds the bounded local-review limit",
    });
  }
}

const candidateSchema = z
  .object(candidateShape)
  .strict()
  .superRefine(addCandidatePixelAreaIssue) as z.ZodType<EpisodeProductionScriptReferenceCandidate>;

const referenceGroupSchema = z
  .object({
    group_id: z.enum(EPISODE_PRODUCTION_SCRIPT_REFERENCE_GROUP_IDS),
    requirement_index: z.number().int().min(1).max(4),
    requirement_item: boundedText(1_000),
    requirement_source_state: z.enum(["MISSING_APPROVAL", "NOT_LOCKED"]),
    reference_kind: z.enum([
      "CHARACTER_IDENTITY",
      "PERSON_LIKENESS",
      "ENVIRONMENT",
      "STYLE_PALETTE",
    ]),
    subject_id: boundedText(100).nullable(),
    candidates: z
      .array(candidateSchema)
      .min(1)
      .max(MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_CANDIDATES_PER_GROUP),
  })
  .strict() as z.ZodType<EpisodeProductionScriptReferenceGroup>;

const referenceGroupsSchema = z.array(referenceGroupSchema).length(4);

interface EpisodeProductionScriptReferenceExcludedRequirement {
  requirement_index: 5;
  requirement_item: "Dialogue and voice plan";
  requirement_source_state: "MISSING_APPROVAL";
  exclusion_reason: "NON_VISUAL_OUT_OF_SCOPE";
}

const excludedRequirementSchema = z
  .object({
    requirement_index: z.literal(CURRENT_EXCLUDED_REQUIREMENT.requirementIndex),
    requirement_item: z.literal(CURRENT_EXCLUDED_REQUIREMENT.item),
    requirement_source_state: z.literal(CURRENT_EXCLUDED_REQUIREMENT.state),
    exclusion_reason: z.literal(CURRENT_EXCLUDED_REQUIREMENT.exclusionReason),
  })
  .strict() as z.ZodType<EpisodeProductionScriptReferenceExcludedRequirement>;

const excludedRequirementsSchema = z.array(excludedRequirementSchema).length(1);

function addExactGroupMappingIssues(
  groups: readonly EpisodeProductionScriptReferenceGroup[],
  ctx: z.RefinementCtx,
): void {
  for (const [index, expected] of CURRENT_VISUAL_REQUIREMENTS.entries()) {
    const group = groups[index];
    if (!group) continue;
    const checks = [
      ["group_id", group.group_id, expected.groupId],
      ["requirement_index", group.requirement_index, expected.requirementIndex],
      ["requirement_item", group.requirement_item, expected.item],
      ["requirement_source_state", group.requirement_source_state, expected.state],
      ["reference_kind", group.reference_kind, expected.referenceKind],
      ["subject_id", group.subject_id, expected.subjectId],
    ] as const;
    for (const [field, actual, wanted] of checks) {
      if (actual !== wanted) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["groups", index, field],
          message: `Group ${index + 1} must preserve the exact current-package ${field}`,
        });
      }
    }
  }
}

function addCandidateIntegrityIssues(
  groups: readonly {
    candidates: readonly EpisodeProductionScriptReferenceCandidate[];
  }[],
  ctx: z.RefinementCtx,
): void {
  const names = new Set<string>();
  const hashes = new Set<string>();
  let candidateCount = 0;
  let totalBytes = 0;
  for (const [groupIndex, group] of groups.entries()) {
    for (const [candidateIndex, candidate] of group.candidates.entries()) {
      candidateCount += 1;
      totalBytes += candidate.byte_length;
      const nameKey = candidate.file_name.toLowerCase();
      if (names.has(nameKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["groups", groupIndex, "candidates", candidateIndex, "file_name"],
          message: `Duplicate candidate file name ${candidate.file_name}`,
        });
      }
      if (hashes.has(candidate.sha256)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["groups", groupIndex, "candidates", candidateIndex, "sha256"],
          message: `Duplicate candidate SHA-256 ${candidate.sha256}`,
        });
      }
      names.add(nameKey);
      hashes.add(candidate.sha256);
    }
  }
  if (candidateCount > MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_CANDIDATES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["groups"],
      message: "Reference basis exceeds the total candidate-count limit",
    });
  }
  if (totalBytes > MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_TOTAL_IMAGE_BYTES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["groups"],
      message: "Reference basis exceeds the total declared image-byte limit",
    });
  }
}

export const episodeProductionScriptReferenceBasisSchema = z
  .object({
    schema_version: z.literal(
      "filmstack-episode-production-script-reference-review-basis/v1",
    ),
    package_id: z.literal(CURRENT_ARCHI_EPISODE_REFERENCE_BASIS_ID),
    record_state: z.literal("PROSPECTIVE_DRAFT"),
    authority_state: z.literal("NO_EXTERNAL_AUTHORITY"),
    review_scope: z.literal("EPISODE_VISUAL_REFERENCE_CANDIDATE_REVIEW_ONLY"),
    source_status: z.literal("EXACT_UPSTREAM_BYTES_VERIFIED_NOT_ADMITTED"),
    production_gate: z.literal("PRODUCE_BLOCKED"),
    production_script_package_id: z.literal(
      CURRENT_ARCHI_PRODUCTION_SCRIPT_PACKAGE_ID,
    ),
    story_room_package_id: z.literal(CURRENT_ARCHI_STORY_ROOM_PACKAGE_ID),
    story_room_pack: currentExactFileBindingSchema(CURRENT_STORY_ROOM_BINDING),
    production_script_manifest: currentExactFileBindingSchema(
      CURRENT_MANIFEST_BINDING,
    ),
    fountain: currentExactFileBindingSchema(CURRENT_FOUNTAIN_BINDING),
    episode: z
      .object({
        episode_index: z.literal(1),
        episode_title: z.literal("Almost"),
        assigned_test_id: z.literal("VIBE-001-UNDERSTAND"),
      })
      .strict(),
    mapping_policy: z.literal(CURRENT_ARCHI_REFERENCE_MAPPING_POLICY),
    groups: referenceGroupsSchema,
    excluded_requirements: excludedRequirementsSchema,
  })
  .strict()
  .superRefine((basis, ctx) => {
    addExactGroupMappingIssues(basis.groups, ctx);
    addCandidateIntegrityIssues(basis.groups, ctx);
  });

export type EpisodeProductionScriptReferenceBasis = z.infer<
  typeof episodeProductionScriptReferenceBasisSchema
>;

export type EpisodeProductionScriptReferencesErrorCode =
  | "INVALID_FILE_SET"
  | "INVALID_FILE_TYPE"
  | "INVALID_FILE_SIZE"
  | "FILE_TOO_LARGE"
  | "FILE_LENGTH_MISMATCH"
  | "INVALID_ENCODING"
  | "INVALID_JSON"
  | "INVALID_BASIS"
  | "CURRENT_PACKAGE_MISMATCH"
  | "SOURCE_BINDING_MISMATCH"
  | "MISSING_IMAGE"
  | "UNEXPECTED_IMAGE"
  | "INVALID_PNG"
  | "IMAGE_HASH_MISMATCH"
  | "IMAGE_DIMENSION_MISMATCH"
  | "HASH_UNAVAILABLE"
  | "INVALID_DECISIONS";

export class EpisodeProductionScriptReferencesError extends Error {
  readonly code: EpisodeProductionScriptReferencesErrorCode;

  constructor(code: EpisodeProductionScriptReferencesErrorCode, message: string) {
    super(message);
    this.name = "EpisodeProductionScriptReferencesError";
    this.code = code;
  }
}

export interface VerifiedEpisodeProductionScriptReferenceAsset {
  groupId: EpisodeProductionScriptReferenceGroupId;
  fileName: string;
  byteLength: number;
  sha256: string;
  pixelWidth: number;
  pixelHeight: number;
  bytes: ArrayBuffer;
}

export interface LocalEpisodeProductionScriptReferencesPreview {
  basis: EpisodeProductionScriptReferenceBasis;
  basisFile: {
    fileName: string;
    byteLength: number;
    sha256: string;
    bytes: ArrayBuffer;
  };
  assets: Record<string, VerifiedEpisodeProductionScriptReferenceAsset>;
  verification: {
    currentPackageAdapter: "EXACT_CURRENT_PACKAGE_MATCH";
    sourceBindings: "EXACT_BYTES_MATCHED_TO_LOADED_EPISODE_PREVIEW";
    basis: "STRICT_SCHEMA_AND_EXACT_BYTES_VERIFIED";
    images: "PNG_SIGNATURE_IHDR_LENGTH_HASH_AND_DIMENSIONS_VERIFIED";
    provenance: "DECLARED_ONLY_NOT_VERIFIED";
    rights: "DECLARED_ONLY_NOT_VERIFIED";
    approval: "NOT_EVALUATED";
  };
}

export interface ReadLocalEpisodeProductionScriptReferencesInput {
  basisFile: LocalReadableFile;
  imageFiles: readonly LocalReadableFile[];
  episodePreview: LocalEpisodeProductionScriptPreview;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function exactDigestPayload(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (bytes instanceof Uint8Array) {
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
  }
  return bytes;
}

function cloneExactArrayBuffer(value: unknown): ArrayBuffer | null {
  if (Object.prototype.toString.call(value) !== "[object ArrayBuffer]") {
    return null;
  }
  try {
    const source = new Uint8Array(value as ArrayBuffer);
    const copy = new Uint8Array(source.byteLength);
    copy.set(source);
    return copy.buffer;
  } catch {
    return null;
  }
}

export async function sha256EpisodeProductionScriptReferenceBytes(
  bytes: ArrayBuffer | Uint8Array,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new EpisodeProductionScriptReferencesError(
      "HASH_UNAVAILABLE",
      "This browser cannot compute the required local SHA-256 receipts.",
    );
  }
  return bytesToHex(
    await subtle.digest("SHA-256", exactDigestPayload(bytes)),
  );
}

function parseBasis(bytes: ArrayBuffer): EpisodeProductionScriptReferenceBasis {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new EpisodeProductionScriptReferencesError(
      "INVALID_ENCODING",
      "The selected visual-reference basis is not valid UTF-8 JSON.",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new EpisodeProductionScriptReferencesError(
      "INVALID_JSON",
      "The selected visual-reference basis is not valid JSON.",
    );
  }
  const parsed = episodeProductionScriptReferenceBasisSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 6)
      .map((issue) => `${issue.path.join(".") || "basis"}: ${issue.message}`)
      .join(" · ");
    throw new EpisodeProductionScriptReferencesError(
      "INVALID_BASIS",
      `The JSON does not match the exact Episode 1 visual-reference contract. ${issues}`,
    );
  }
  return parsed.data;
}

function assertSafeFileDeclaration(
  file: LocalReadableFile,
  extension: "json" | "png",
  byteLimit: number,
): void {
  if (!basenameSchema(extension).safeParse(file.name).success) {
    throw new EpisodeProductionScriptReferencesError(
      "INVALID_FILE_TYPE",
      `Expected a safe basename-only .${extension} file name.`,
    );
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new EpisodeProductionScriptReferencesError(
      "INVALID_FILE_SIZE",
      `The declared size for ${file.name} is invalid.`,
    );
  }
  if (file.size > byteLimit) {
    throw new EpisodeProductionScriptReferencesError(
      "FILE_TOO_LARGE",
      `${file.name} exceeds its bounded local-review limit.`,
    );
  }
}

function assertExactCurrentPackage(
  preview: LocalEpisodeProductionScriptPreview,
): void {
  const parsed = z
    .object({
      pack: z.object({
        package_id: z.literal(CURRENT_ARCHI_PRODUCTION_SCRIPT_PACKAGE_ID),
        record_state: z.literal("PROSPECTIVE_DRAFT"),
        authority_state: z.literal("NO_EXTERNAL_AUTHORITY"),
        source_status: z.literal("EXACT_UPSTREAM_BYTES_VERIFIED_NOT_ADMITTED"),
        production_gate: z.literal("PRODUCE_BLOCKED"),
        source_binding: z.object({
          package_id: z.literal(CURRENT_ARCHI_STORY_ROOM_PACKAGE_ID),
          file_name: z.literal(CURRENT_STORY_ROOM_BINDING.fileName),
          byte_length: z.literal(CURRENT_STORY_ROOM_BINDING.byteLength),
          sha256: z.literal(CURRENT_STORY_ROOM_BINDING.sha256),
        }),
        screenplay_binding: z.object({
          file_name: z.literal(CURRENT_FOUNTAIN_BINDING.fileName),
          byte_length: z.literal(CURRENT_FOUNTAIN_BINDING.byteLength),
          sha256: z.literal(CURRENT_FOUNTAIN_BINDING.sha256),
        }),
        episode: z.object({
          episode_index: z.literal(1),
          title: z.literal("Almost"),
          test_id: z.literal("VIBE-001-UNDERSTAND"),
        }),
        reference_requirements: z.tuple([
          z.object({
            item: z.literal(CURRENT_SOURCE_REQUIREMENTS[0].item),
            state: z.literal(CURRENT_SOURCE_REQUIREMENTS[0].state),
          }).strict(),
          z.object({
            item: z.literal(CURRENT_SOURCE_REQUIREMENTS[1].item),
            state: z.literal(CURRENT_SOURCE_REQUIREMENTS[1].state),
          }).strict(),
          z.object({
            item: z.literal(CURRENT_SOURCE_REQUIREMENTS[2].item),
            state: z.literal(CURRENT_SOURCE_REQUIREMENTS[2].state),
          }).strict(),
          z.object({
            item: z.literal(CURRENT_SOURCE_REQUIREMENTS[3].item),
            state: z.literal(CURRENT_SOURCE_REQUIREMENTS[3].state),
          }).strict(),
          z.object({
            item: z.literal(CURRENT_SOURCE_REQUIREMENTS[4].item),
            state: z.literal(CURRENT_SOURCE_REQUIREMENTS[4].state),
          }).strict(),
        ]),
      }),
      manifest: z.object({
        fileName: z.literal(CURRENT_MANIFEST_BINDING.fileName),
        byteLength: z.literal(CURRENT_MANIFEST_BINDING.byteLength),
        sha256: z.literal(CURRENT_MANIFEST_BINDING.sha256),
      }),
      screenplay: z.object({
        fileName: z.literal(CURRENT_FOUNTAIN_BINDING.fileName),
        byteLength: z.literal(CURRENT_FOUNTAIN_BINDING.byteLength),
        sha256: z.literal(CURRENT_FOUNTAIN_BINDING.sha256),
      }),
      sourceStoryRoom: z.object({
        fileName: z.literal(CURRENT_STORY_ROOM_BINDING.fileName),
        byteLength: z.literal(CURRENT_STORY_ROOM_BINDING.byteLength),
        sha256: z.literal(CURRENT_STORY_ROOM_BINDING.sha256),
        packageId: z.literal(CURRENT_ARCHI_STORY_ROOM_PACKAGE_ID),
        episodeIndex: z.literal(1),
      }),
      verification: z.object({
        manifest: z.literal("STRICT_SCHEMA_AND_EXACT_BYTES_VERIFIED"),
        screenplay: z.literal("EXACT_FILENAME_LENGTH_AND_SHA256_VERIFIED"),
        storyRoom: z.literal("EXACT_LOADED_PREVIEW_VERIFIED"),
        episodeSlice: z.literal("SOURCE_FIELDS_EXACTLY_VERIFIED"),
      }),
    })
    .safeParse(preview);
  if (!parsed.success) {
    throw new EpisodeProductionScriptReferencesError(
      "CURRENT_PACKAGE_MISMATCH",
      "Load the exact current ARCHi Episode 1 production-script package before reviewing visual references.",
    );
  }
}

function assertBasisMatchesPreview(
  basis: EpisodeProductionScriptReferenceBasis,
  preview: LocalEpisodeProductionScriptPreview,
): void {
  const comparisons: readonly [unknown, unknown, string][] = [
    [basis.production_script_package_id, preview.pack.package_id, "production_script_package_id"],
    [basis.story_room_package_id, preview.sourceStoryRoom.packageId, "story_room_package_id"],
    [basis.story_room_pack.file_name, preview.sourceStoryRoom.fileName, "story_room_pack.file_name"],
    [basis.story_room_pack.byte_length, preview.sourceStoryRoom.byteLength, "story_room_pack.byte_length"],
    [basis.story_room_pack.sha256, preview.sourceStoryRoom.sha256, "story_room_pack.sha256"],
    [basis.production_script_manifest.file_name, preview.manifest.fileName, "production_script_manifest.file_name"],
    [basis.production_script_manifest.byte_length, preview.manifest.byteLength, "production_script_manifest.byte_length"],
    [basis.production_script_manifest.sha256, preview.manifest.sha256, "production_script_manifest.sha256"],
    [basis.fountain.file_name, preview.screenplay.fileName, "fountain.file_name"],
    [basis.fountain.byte_length, preview.screenplay.byteLength, "fountain.byte_length"],
    [basis.fountain.sha256, preview.screenplay.sha256, "fountain.sha256"],
    [basis.episode.episode_index, preview.pack.episode.episode_index, "episode.episode_index"],
    [basis.episode.episode_title, preview.pack.episode.title, "episode.episode_title"],
    [basis.episode.assigned_test_id, preview.pack.episode.test_id, "episode.assigned_test_id"],
  ];
  const mismatch = comparisons.find(([actual, expected]) => actual !== expected);
  if (mismatch) {
    throw new EpisodeProductionScriptReferencesError(
      "SOURCE_BINDING_MISMATCH",
      `Exact source binding mismatch at ${mismatch[2]}.`,
    );
  }
}

function readPngDimensions(bytes: ArrayBuffer): {
  width: number;
  height: number;
} {
  const data = new Uint8Array(bytes);
  const view = new DataView(bytes);
  if (
    data.byteLength < 24 ||
    !PNG_SIGNATURE.every((value, index) => data[index] === value) ||
    view.getUint32(8, false) !== 13 ||
    data[12] !== 0x49 ||
    data[13] !== 0x48 ||
    data[14] !== 0x44 ||
    data[15] !== 0x52
  ) {
    throw new EpisodeProductionScriptReferencesError(
      "INVALID_PNG",
      "A selected reference image is not a PNG with the required signature and IHDR header.",
    );
  }
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (
    width <= 0 ||
    height <= 0 ||
    width > MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_IMAGE_WIDTH ||
    height > MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_IMAGE_HEIGHT ||
    width * height > MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_IMAGE_PIXELS
  ) {
    throw new EpisodeProductionScriptReferencesError(
      "INVALID_PNG",
      "A selected reference PNG has invalid or unsupported dimensions.",
    );
  }
  return { width, height };
}

export async function readLocalEpisodeProductionScriptReferences(
  input: ReadLocalEpisodeProductionScriptReferencesInput,
): Promise<LocalEpisodeProductionScriptReferencesPreview> {
  assertExactCurrentPackage(input.episodePreview);
  assertSafeFileDeclaration(
    input.basisFile,
    "json",
    MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_BASIS_BYTES,
  );
  if (
    input.imageFiles.length < CURRENT_VISUAL_REQUIREMENTS.length ||
    input.imageFiles.length > MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_CANDIDATES
  ) {
    throw new EpisodeProductionScriptReferencesError(
      "INVALID_FILE_SET",
      "Choose the exact 4-32 PNG files declared by one Episode 1 visual-reference basis.",
    );
  }

  const selectedNames = new Set<string>();
  let declaredSelectedBytes = 0;
  for (const file of input.imageFiles) {
    assertSafeFileDeclaration(
      file,
      "png",
      MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_IMAGE_BYTES,
    );
    const key = file.name.toLowerCase();
    if (selectedNames.has(key)) {
      throw new EpisodeProductionScriptReferencesError(
        "INVALID_FILE_SET",
        `Duplicate selected image file name ${file.name}.`,
      );
    }
    selectedNames.add(key);
    declaredSelectedBytes += file.size;
  }
  if (
    declaredSelectedBytes >
    MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_TOTAL_IMAGE_BYTES
  ) {
    throw new EpisodeProductionScriptReferencesError(
      "FILE_TOO_LARGE",
      "The selected reference PNGs exceed the total local-review byte limit.",
    );
  }

  const selectedBasisBytes = await input.basisFile.arrayBuffer();
  const basisBytes = selectedBasisBytes.slice(0);
  if (
    basisBytes.byteLength >
    MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_BASIS_BYTES
  ) {
    throw new EpisodeProductionScriptReferencesError(
      "FILE_TOO_LARGE",
      "The visual-reference basis exceeds the local-review byte limit.",
    );
  }
  if (basisBytes.byteLength !== input.basisFile.size) {
    throw new EpisodeProductionScriptReferencesError(
      "FILE_LENGTH_MISMATCH",
      "The visual-reference basis actual bytes do not match its selected-file size.",
    );
  }
  const basis = parseBasis(basisBytes);
  assertBasisMatchesPreview(basis, input.episodePreview);

  const declarations = new Map<
    string,
    {
      groupId: EpisodeProductionScriptReferenceGroupId;
      candidate: EpisodeProductionScriptReferenceCandidate;
    }
  >();
  for (const group of basis.groups) {
    for (const candidate of group.candidates) {
      declarations.set(candidate.file_name, {
        groupId: group.group_id,
        candidate,
      });
    }
  }
  const selected = new Map(input.imageFiles.map((file) => [file.name, file]));
  for (const fileName of declarations.keys()) {
    if (!selected.has(fileName)) {
      throw new EpisodeProductionScriptReferencesError(
        "MISSING_IMAGE",
        `Missing required visual-reference image ${fileName}.`,
      );
    }
  }
  for (const fileName of selected.keys()) {
    if (!declarations.has(fileName)) {
      throw new EpisodeProductionScriptReferencesError(
        "UNEXPECTED_IMAGE",
        `Unexpected visual-reference image ${fileName}.`,
      );
    }
  }

  const assets: Record<string, VerifiedEpisodeProductionScriptReferenceAsset> = {};
  let actualTotalBytes = 0;
  for (const [fileName, declaration] of declarations.entries()) {
    const file = selected.get(fileName)!;
    const selectedBytes = await file.arrayBuffer();
    const bytes = selectedBytes.slice(0);
    actualTotalBytes += bytes.byteLength;
    if (
      bytes.byteLength >
        MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_IMAGE_BYTES ||
      actualTotalBytes >
        MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_TOTAL_IMAGE_BYTES
    ) {
      throw new EpisodeProductionScriptReferencesError(
        "FILE_TOO_LARGE",
        "The actual reference PNG bytes exceed the bounded local-review limits.",
      );
    }
    if (
      bytes.byteLength !== file.size ||
      bytes.byteLength !== declaration.candidate.byte_length
    ) {
      throw new EpisodeProductionScriptReferencesError(
        "FILE_LENGTH_MISMATCH",
        `Reference image ${fileName} does not match its selected or declared byte length.`,
      );
    }
    const dimensions = readPngDimensions(bytes);
    const sha256 = await sha256EpisodeProductionScriptReferenceBytes(bytes);
    if (sha256 !== declaration.candidate.sha256) {
      throw new EpisodeProductionScriptReferencesError(
        "IMAGE_HASH_MISMATCH",
        `Reference image ${fileName} does not match its exact-byte SHA-256.`,
      );
    }
    if (
      dimensions.width !== declaration.candidate.pixel_width ||
      dimensions.height !== declaration.candidate.pixel_height
    ) {
      throw new EpisodeProductionScriptReferencesError(
        "IMAGE_DIMENSION_MISMATCH",
        `Reference image ${fileName} does not match its declared pixel dimensions.`,
      );
    }
    assets[fileName] = {
      groupId: declaration.groupId,
      fileName,
      byteLength: bytes.byteLength,
      sha256,
      pixelWidth: dimensions.width,
      pixelHeight: dimensions.height,
      bytes,
    };
  }

  return {
    basis,
    basisFile: {
      fileName: input.basisFile.name,
      byteLength: basisBytes.byteLength,
      sha256: await sha256EpisodeProductionScriptReferenceBytes(basisBytes),
      bytes: basisBytes.slice(0),
    },
    assets,
    verification: {
      currentPackageAdapter: "EXACT_CURRENT_PACKAGE_MATCH",
      sourceBindings: "EXACT_BYTES_MATCHED_TO_LOADED_EPISODE_PREVIEW",
      basis: "STRICT_SCHEMA_AND_EXACT_BYTES_VERIFIED",
      images: "PNG_SIGNATURE_IHDR_LENGTH_HASH_AND_DIMENSIONS_VERIFIED",
      provenance: "DECLARED_ONLY_NOT_VERIFIED",
      rights: "DECLARED_ONLY_NOT_VERIFIED",
      approval: "NOT_EVALUATED",
    },
  };
}

interface EpisodeProductionScriptReferenceReceiptCandidate
  extends EpisodeProductionScriptReferenceCandidate {
  asset_verification: "EXACT_BYTES_VERIFIED";
}

interface EpisodeProductionScriptReferenceReceiptGroup {
  group_id: EpisodeProductionScriptReferenceGroupId;
  requirement_index: number;
  requirement_item: string;
  requirement_source_state: "MISSING_APPROVAL" | "NOT_LOCKED";
  reference_kind: EpisodeProductionScriptReferenceGroup["reference_kind"];
  subject_id: string | null;
  presented_candidates: EpisodeProductionScriptReferenceReceiptCandidate[];
  presentation_state: "SELF_ATTESTED_RENDERED_IN_LOCAL_REVIEW";
  presentation_assurance: "NOT_HUMAN_ATTENTION_PROOF";
  disposition: EpisodeProductionScriptReferenceDisposition;
  selected_candidate_sha256: string | null;
  note: string;
  approval_state: "NOT_EVALUATED";
  selection_effect: "LOCAL_RECEIPT_ONLY_NOT_APPROVAL";
  source_requirement_effect: "UNCHANGED";
}

const receiptCandidateSchema = z
  .object({
    ...candidateShape,
    asset_verification: z.literal("EXACT_BYTES_VERIFIED"),
  })
  .strict()
  .superRefine(addCandidatePixelAreaIssue) as z.ZodType<EpisodeProductionScriptReferenceReceiptCandidate>;

const receiptGroupSchema = z
  .object({
    group_id: z.enum(EPISODE_PRODUCTION_SCRIPT_REFERENCE_GROUP_IDS),
    requirement_index: z.number().int().min(1).max(4),
    requirement_item: boundedText(1_000),
    requirement_source_state: z.enum(["MISSING_APPROVAL", "NOT_LOCKED"]),
    reference_kind: z.enum([
      "CHARACTER_IDENTITY",
      "PERSON_LIKENESS",
      "ENVIRONMENT",
      "STYLE_PALETTE",
    ]),
    subject_id: boundedText(100).nullable(),
    presented_candidates: z
      .array(receiptCandidateSchema)
      .min(1)
      .max(MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_CANDIDATES_PER_GROUP),
    presentation_state: z.literal("SELF_ATTESTED_RENDERED_IN_LOCAL_REVIEW"),
    presentation_assurance: z.literal("NOT_HUMAN_ATTENTION_PROOF"),
    disposition: z.enum(EPISODE_PRODUCTION_SCRIPT_REFERENCE_DISPOSITIONS),
    selected_candidate_sha256: sha256Schema.nullable(),
    note: portableOptionalText(2_000, "Decision notes"),
    approval_state: z.literal("NOT_EVALUATED"),
    selection_effect: z.literal("LOCAL_RECEIPT_ONLY_NOT_APPROVAL"),
    source_requirement_effect: z.literal("UNCHANGED"),
  })
  .strict()
  .superRefine((group, ctx) => {
    if (
      (group.disposition === "ACCEPT_CANDIDATE" ||
        group.disposition === "REPAIR") &&
      group.selected_candidate_sha256 === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selected_candidate_sha256"],
        message: `${group.disposition} requires a selected candidate`,
      });
    }
    if (
      (group.disposition === "REPAIR" || group.disposition === "REJECT") &&
      !group.note.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["note"],
        message: `${group.disposition} requires a note`,
      });
    }
    if (
      group.selected_candidate_sha256 !== null &&
      !group.presented_candidates.some(
        (candidate) => candidate.sha256 === group.selected_candidate_sha256,
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selected_candidate_sha256"],
        message: "Selected candidate must be one of the presented exact-byte candidates",
      });
    }
  }) as z.ZodType<EpisodeProductionScriptReferenceReceiptGroup>;

const receiptGroupsSchema = z.array(receiptGroupSchema).length(4);

interface EpisodeProductionScriptReferenceReceiptExcludedRequirement
  extends EpisodeProductionScriptReferenceExcludedRequirement {
  approval_state: "NOT_EVALUATED";
  source_requirement_effect: "UNCHANGED";
}

const receiptExcludedRequirementSchema = z
  .object({
    requirement_index: z.literal(CURRENT_EXCLUDED_REQUIREMENT.requirementIndex),
    requirement_item: z.literal(CURRENT_EXCLUDED_REQUIREMENT.item),
    requirement_source_state: z.literal(CURRENT_EXCLUDED_REQUIREMENT.state),
    exclusion_reason: z.literal(CURRENT_EXCLUDED_REQUIREMENT.exclusionReason),
    approval_state: z.literal("NOT_EVALUATED"),
    source_requirement_effect: z.literal("UNCHANGED"),
  })
  .strict() as z.ZodType<EpisodeProductionScriptReferenceReceiptExcludedRequirement>;

const receiptExcludedRequirementsSchema = z
  .array(receiptExcludedRequirementSchema)
  .length(1);

export const episodeProductionScriptReferenceReceiptSchema = z
  .object({
    schema_version: z.literal(
      "filmstack-episode-production-script-reference-review-receipt/v1",
    ),
    receipt_state: z.literal("LOCAL_REFERENCE_REVIEW_DRAFT"),
    authority_state: z.literal("NO_EXTERNAL_AUTHORITY"),
    review_scope: z.literal("EPISODE_VISUAL_REFERENCE_CANDIDATE_REVIEW_ONLY"),
    determinism: z.literal("SAME_RECORDED_INPUTS_SAME_BYTES"),
    reviewer: z
      .object({
        label: portableBoundedText(200, "Reviewer labels"),
        identity_assurance: z.literal("SELF_ATTESTED_LOCAL"),
      })
      .strict(),
    basis: z
      .object({
        production_script_package_id: z.literal(
          CURRENT_ARCHI_PRODUCTION_SCRIPT_PACKAGE_ID,
        ),
        review_basis: reviewBasisFileBindingSchema,
        story_room_pack: currentExactFileBindingSchema(
          CURRENT_STORY_ROOM_BINDING,
        ),
        production_script_manifest: currentExactFileBindingSchema(
          CURRENT_MANIFEST_BINDING,
        ),
        fountain: currentExactFileBindingSchema(CURRENT_FOUNTAIN_BINDING),
        episode: z
          .object({
            episode_index: z.literal(1),
            episode_title: z.literal("Almost"),
            assigned_test_id: z.literal("VIBE-001-UNDERSTAND"),
          })
          .strict(),
        mapping_policy: z.literal(CURRENT_ARCHI_REFERENCE_MAPPING_POLICY),
        source_status: z.literal("EXACT_UPSTREAM_BYTES_VERIFIED_NOT_ADMITTED"),
        production_gate: z.literal("PRODUCE_BLOCKED"),
      })
      .strict(),
    completeness: z.literal("COMPLETE"),
    summary: z
      .object({
        total: z.literal(4),
        accepted: z.number().int().nonnegative().max(4),
        repair: z.number().int().nonnegative().max(4),
        rejected: z.number().int().nonnegative().max(4),
      })
      .strict(),
    groups: receiptGroupsSchema,
    excluded_requirements: receiptExcludedRequirementsSchema,
    effects: z
      .object({
        authoritative_state_change: z.literal("NONE"),
        receipt_output: z.literal("LOCAL_EXPORT_ONLY"),
        project_artifact_creation: z.literal("NOT_PERFORMED"),
        admission_candidate_creation: z.literal("NOT_PERFORMED"),
        source_admission: z.literal("NOT_PERFORMED"),
        canon: z.literal("UNCHANGED_NOT_ADMITTED"),
        reference_approval: z.literal("NOT_PERFORMED"),
        likeness_rights: z.literal("NOT_VERIFIED"),
        prompt_generation: z.literal("BLOCKED"),
        storyboard_promotion: z.literal("NOT_PERFORMED"),
        production_gate: z.literal("UNCHANGED_PRODUCE_BLOCKED"),
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
    addExactGroupMappingIssues(
      receipt.groups.map((group) => ({
        ...group,
        candidates: group.presented_candidates,
      })),
      ctx,
    );
    addCandidateIntegrityIssues(
      receipt.groups.map((group) => ({
        candidates: group.presented_candidates,
      })),
      ctx,
    );
    const accepted = receipt.groups.filter(
      (group) => group.disposition === "ACCEPT_CANDIDATE",
    ).length;
    const repair = receipt.groups.filter(
      (group) => group.disposition === "REPAIR",
    ).length;
    const rejected = receipt.groups.filter(
      (group) => group.disposition === "REJECT",
    ).length;
    if (
      receipt.summary.accepted !== accepted ||
      receipt.summary.repair !== repair ||
      receipt.summary.rejected !== rejected ||
      accepted + repair + rejected !== receipt.summary.total
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary"],
        message: "Receipt summary must exactly equal the four group dispositions",
      });
    }
  });

export type EpisodeProductionScriptReferenceReceipt = z.infer<
  typeof episodeProductionScriptReferenceReceiptSchema
>;

export interface EpisodeProductionScriptReferenceDecisionInput {
  groupId: EpisodeProductionScriptReferenceGroupId;
  disposition: EpisodeProductionScriptReferenceDisposition;
  presentedCandidateSha256s: readonly string[];
  selectedCandidateSha256: string | null;
  note: string;
}

export interface BuildEpisodeProductionScriptReferenceReceiptInput {
  review: LocalEpisodeProductionScriptReferencesPreview;
  reviewerLabel: string;
  decisions: readonly EpisodeProductionScriptReferenceDecisionInput[];
}

function normalizeHumanText(value: string): string {
  return value.normalize("NFC").replace(/\r\n?/g, "\n").trim();
}

function exactBinding(
  binding:
    | typeof CURRENT_STORY_ROOM_BINDING
    | typeof CURRENT_MANIFEST_BINDING
    | typeof CURRENT_FOUNTAIN_BINDING,
) {
  return {
    file_name: binding.fileName,
    byte_length: binding.byteLength,
    sha256: binding.sha256,
    verification: "EXACT_BYTES_VERIFIED" as const,
  };
}

interface ValidatedReferenceReviewForReceipt {
  basis: EpisodeProductionScriptReferenceBasis;
  basisFile: {
    byteLength: number;
    fileName: string;
    sha256: string;
  };
}

async function validateReviewForReceipt(
  review: LocalEpisodeProductionScriptReferencesPreview,
): Promise<ValidatedReferenceReviewForReceipt> {
  const basisFile = {
    fileName: review.basisFile.fileName,
    byteLength: review.basisFile.byteLength,
    sha256: review.basisFile.sha256,
  };
  if (
    !basenameSchema("json").safeParse(basisFile.fileName).success ||
    !Number.isSafeInteger(basisFile.byteLength) ||
    basisFile.byteLength <= 0 ||
    basisFile.byteLength > MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_BASIS_BYTES ||
    !SHA256_PATTERN.test(basisFile.sha256)
  ) {
    throw new EpisodeProductionScriptReferencesError(
      "INVALID_DECISIONS",
      "The loaded reference review has an invalid exact basis-file receipt.",
    );
  }
  const basisBytes = cloneExactArrayBuffer(review.basisFile.bytes);
  if (!basisBytes) {
    throw new EpisodeProductionScriptReferencesError(
      "INVALID_DECISIONS",
      "The current visual-reference basis bytes cannot be independently verified.",
    );
  }
  if (basisBytes.byteLength !== basisFile.byteLength) {
    throw new EpisodeProductionScriptReferencesError(
      "FILE_LENGTH_MISMATCH",
      "The current visual-reference basis bytes do not match the exact recorded length.",
    );
  }
  const basis = parseBasis(basisBytes);
  const expectedCandidates = basis.groups.flatMap((group) =>
    group.candidates.map((candidate) => ({
      candidate,
      groupId: group.group_id,
    })),
  );
  const assetKeys = Object.keys(review.assets);
  if (assetKeys.length !== expectedCandidates.length) {
    throw new EpisodeProductionScriptReferencesError(
      "INVALID_DECISIONS",
      "The loaded reference review does not contain every exact verified candidate.",
    );
  }
  const snapshots: Array<{
    bytes: ArrayBuffer;
    candidate: EpisodeProductionScriptReferenceCandidate;
  }> = [];
  let actualTotalBytes = 0;
  for (const { candidate, groupId } of expectedCandidates) {
    const asset = review.assets[candidate.file_name];
    if (
      !asset ||
      asset.groupId !== groupId ||
      asset.fileName !== candidate.file_name ||
      asset.byteLength !== candidate.byte_length ||
      asset.sha256 !== candidate.sha256 ||
      asset.pixelWidth !== candidate.pixel_width ||
      asset.pixelHeight !== candidate.pixel_height
    ) {
      throw new EpisodeProductionScriptReferencesError(
        "INVALID_DECISIONS",
        "The loaded reference review does not contain every exact verified candidate.",
      );
    }
    const bytes = cloneExactArrayBuffer(asset.bytes);
    if (!bytes) {
      throw new EpisodeProductionScriptReferencesError(
        "INVALID_DECISIONS",
        `The current bytes for ${candidate.file_name} cannot be independently verified.`,
      );
    }
    actualTotalBytes += bytes.byteLength;
    if (
      bytes.byteLength > MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_IMAGE_BYTES ||
      actualTotalBytes > MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_TOTAL_IMAGE_BYTES
    ) {
      throw new EpisodeProductionScriptReferencesError(
        "FILE_TOO_LARGE",
        "The current reference PNG bytes exceed the bounded local-review limits.",
      );
    }
    if (
      bytes.byteLength !== asset.byteLength ||
      bytes.byteLength !== candidate.byte_length
    ) {
      throw new EpisodeProductionScriptReferencesError(
        "FILE_LENGTH_MISMATCH",
        `The current bytes for ${candidate.file_name} do not match the exact declared length.`,
      );
    }
    snapshots.push({ bytes, candidate });
  }
  const basisSha256 = await sha256EpisodeProductionScriptReferenceBytes(
    basisBytes,
  );
  if (basisSha256 !== basisFile.sha256) {
    throw new EpisodeProductionScriptReferencesError(
      "SOURCE_BINDING_MISMATCH",
      "The current visual-reference basis bytes do not match the exact recorded SHA-256.",
    );
  }
  for (const { bytes, candidate } of snapshots) {
    const dimensions = readPngDimensions(bytes);
    if (
      dimensions.width !== candidate.pixel_width ||
      dimensions.height !== candidate.pixel_height
    ) {
      throw new EpisodeProductionScriptReferencesError(
        "IMAGE_DIMENSION_MISMATCH",
        `The current bytes for ${candidate.file_name} do not match the exact PNG dimensions.`,
      );
    }
    const sha256 = await sha256EpisodeProductionScriptReferenceBytes(bytes);
    if (sha256 !== candidate.sha256) {
      throw new EpisodeProductionScriptReferencesError(
        "IMAGE_HASH_MISMATCH",
        `The current bytes for ${candidate.file_name} do not match the exact SHA-256.`,
      );
    }
  }
  return { basis, basisFile };
}

export async function buildEpisodeProductionScriptReferenceReceipt(
  input: BuildEpisodeProductionScriptReferenceReceiptInput,
): Promise<EpisodeProductionScriptReferenceReceipt> {
  const reviewerLabel = normalizeHumanText(input.reviewerLabel);
  const decisionSnapshots = input.decisions.map((decision) => ({
    groupId: decision.groupId,
    disposition: decision.disposition,
    presentedCandidateSha256s: [...decision.presentedCandidateSha256s],
    selectedCandidateSha256: decision.selectedCandidateSha256,
    note: normalizeHumanText(decision.note),
  }));
  const validatedReview = await validateReviewForReceipt(input.review);
  const basis = validatedReview.basis;
  const decisionsByGroup = new Map<
    EpisodeProductionScriptReferenceGroupId,
    EpisodeProductionScriptReferenceDecisionInput
  >();
  for (const decision of decisionSnapshots) {
    if (decisionsByGroup.has(decision.groupId)) {
      throw new EpisodeProductionScriptReferencesError(
        "INVALID_DECISIONS",
        `Duplicate decision for ${decision.groupId}.`,
      );
    }
    decisionsByGroup.set(decision.groupId, decision);
  }
  if (decisionsByGroup.size !== CURRENT_VISUAL_REQUIREMENTS.length) {
    throw new EpisodeProductionScriptReferencesError(
      "INVALID_DECISIONS",
      "A complete batch receipt requires one decision for each of the four visual-reference groups.",
    );
  }

  const groups = basis.groups.map((group) => {
    const decision = decisionsByGroup.get(group.group_id);
    if (!decision) {
      throw new EpisodeProductionScriptReferencesError(
        "INVALID_DECISIONS",
        `Missing decision for ${group.group_id}.`,
      );
    }
    const expectedHashes = group.candidates.map((candidate) => candidate.sha256);
    const presentedHashes = decision.presentedCandidateSha256s;
    const presentedSet = new Set(presentedHashes);
    if (
      presentedSet.size !== presentedHashes.length ||
      presentedSet.size !== expectedHashes.length ||
      expectedHashes.some((hash) => !presentedSet.has(hash))
    ) {
      throw new EpisodeProductionScriptReferencesError(
        "INVALID_DECISIONS",
        `${group.group_id} must attest presentation of every exact candidate once.`,
      );
    }
    if (
      (decision.disposition === "ACCEPT_CANDIDATE" ||
        decision.disposition === "REPAIR") &&
      decision.selectedCandidateSha256 === null
    ) {
      throw new EpisodeProductionScriptReferencesError(
        "INVALID_DECISIONS",
        `${decision.disposition} requires a selected candidate for ${group.group_id}.`,
      );
    }
    if (
      decision.selectedCandidateSha256 !== null &&
      !presentedSet.has(decision.selectedCandidateSha256)
    ) {
      throw new EpisodeProductionScriptReferencesError(
        "INVALID_DECISIONS",
        `The selected candidate for ${group.group_id} was not among its presented exact candidates.`,
      );
    }
    const note = normalizeHumanText(decision.note);
    if (
      (decision.disposition === "REPAIR" ||
        decision.disposition === "REJECT") &&
      !note
    ) {
      throw new EpisodeProductionScriptReferencesError(
        "INVALID_DECISIONS",
        `${decision.disposition} requires a note for ${group.group_id}.`,
      );
    }
    return {
      group_id: group.group_id,
      requirement_index: group.requirement_index,
      requirement_item: group.requirement_item,
      requirement_source_state: group.requirement_source_state,
      reference_kind: group.reference_kind,
      subject_id: group.subject_id,
      presented_candidates: group.candidates.map((candidate) => ({
        ...candidate,
        asset_verification: "EXACT_BYTES_VERIFIED" as const,
      })),
      presentation_state: "SELF_ATTESTED_RENDERED_IN_LOCAL_REVIEW" as const,
      presentation_assurance: "NOT_HUMAN_ATTENTION_PROOF" as const,
      disposition: decision.disposition,
      selected_candidate_sha256: decision.selectedCandidateSha256,
      note,
      approval_state: "NOT_EVALUATED" as const,
      selection_effect: "LOCAL_RECEIPT_ONLY_NOT_APPROVAL" as const,
      source_requirement_effect: "UNCHANGED" as const,
    };
  });

  const receipt = {
    schema_version:
      "filmstack-episode-production-script-reference-review-receipt/v1" as const,
    receipt_state: "LOCAL_REFERENCE_REVIEW_DRAFT" as const,
    authority_state: "NO_EXTERNAL_AUTHORITY" as const,
    review_scope: "EPISODE_VISUAL_REFERENCE_CANDIDATE_REVIEW_ONLY" as const,
    determinism: "SAME_RECORDED_INPUTS_SAME_BYTES" as const,
    reviewer: {
      label: reviewerLabel,
      identity_assurance: "SELF_ATTESTED_LOCAL" as const,
    },
    basis: {
      production_script_package_id: basis.production_script_package_id,
      review_basis: {
        file_name: validatedReview.basisFile.fileName,
        byte_length: validatedReview.basisFile.byteLength,
        sha256: validatedReview.basisFile.sha256,
        verification: "EXACT_BYTES_VERIFIED" as const,
      },
      story_room_pack: exactBinding(CURRENT_STORY_ROOM_BINDING),
      production_script_manifest: exactBinding(CURRENT_MANIFEST_BINDING),
      fountain: exactBinding(CURRENT_FOUNTAIN_BINDING),
      episode: basis.episode,
      mapping_policy: basis.mapping_policy,
      source_status: basis.source_status,
      production_gate: basis.production_gate,
    },
    completeness: "COMPLETE" as const,
    summary: {
      total: 4 as const,
      accepted: groups.filter(
        (group) => group.disposition === "ACCEPT_CANDIDATE",
      ).length,
      repair: groups.filter((group) => group.disposition === "REPAIR").length,
      rejected: groups.filter((group) => group.disposition === "REJECT").length,
    },
    groups,
    excluded_requirements: basis.excluded_requirements.map((requirement) => ({
      ...requirement,
      approval_state: "NOT_EVALUATED" as const,
      source_requirement_effect: "UNCHANGED" as const,
    })),
    effects: {
      authoritative_state_change: "NONE" as const,
      receipt_output: "LOCAL_EXPORT_ONLY" as const,
      project_artifact_creation: "NOT_PERFORMED" as const,
      admission_candidate_creation: "NOT_PERFORMED" as const,
      source_admission: "NOT_PERFORMED" as const,
      canon: "UNCHANGED_NOT_ADMITTED" as const,
      reference_approval: "NOT_PERFORMED" as const,
      likeness_rights: "NOT_VERIFIED" as const,
      prompt_generation: "BLOCKED" as const,
      storyboard_promotion: "NOT_PERFORMED" as const,
      production_gate: "UNCHANGED_PRODUCE_BLOCKED" as const,
      persistence: "NONE" as const,
      upload: false as const,
      provider_call: false as const,
      token_spend: false as const,
      project_commit: false as const,
    },
  };
  const parsed = episodeProductionScriptReferenceReceiptSchema.safeParse(receipt);
  if (!parsed.success) {
    throw new EpisodeProductionScriptReferencesError(
      "INVALID_DECISIONS",
      `The deterministic reference-review receipt is invalid. ${
        parsed.error.issues[0]?.message ?? "Unknown error"
      }`,
    );
  }
  return parsed.data;
}

export function serializeEpisodeProductionScriptReferenceReceipt(
  receipt: EpisodeProductionScriptReferenceReceipt,
): Uint8Array {
  const parsed = episodeProductionScriptReferenceReceiptSchema.safeParse(receipt);
  if (!parsed.success) {
    throw new EpisodeProductionScriptReferencesError(
      "INVALID_DECISIONS",
      "Refusing to serialize an invalid or weakened reference-review receipt.",
    );
  }
  return new TextEncoder().encode(`${canonicalJson(parsed.data)}\n`);
}
