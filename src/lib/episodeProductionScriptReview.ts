import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";

export const EPISODE_PRODUCTION_SCRIPT_REVIEW_DISPOSITIONS = [
  "ACCEPT_CANDIDATE",
  "REVISE",
  "REJECT",
] as const;

export type EpisodeProductionScriptReviewDisposition =
  (typeof EPISODE_PRODUCTION_SCRIPT_REVIEW_DISPOSITIONS)[number];

export const MAX_EPISODE_PRODUCTION_SCRIPT_REVIEW_BOUND_FILE_BYTES =
  2 * 1024 * 1024;

const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Expected a lowercase 64-character SHA-256 hash");

const boundedText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, "Cannot be blank");

const basenameSchema = (extension: "json" | "fountain") =>
  z
    .string()
    .min(1)
    .max(255)
    .regex(
      new RegExp(`^[^/\\\\]+\\.${extension}$`, "i"),
      `Expected a basename-only .${extension} file name`,
    );

const exactFileBindingSchema = (extension: "json" | "fountain") =>
  z
    .object({
      file_name: basenameSchema(extension),
      byte_length: z
        .number()
        .int()
        .positive()
        .max(MAX_EPISODE_PRODUCTION_SCRIPT_REVIEW_BOUND_FILE_BYTES),
      sha256: sha256Schema,
      verification: z.literal("EXACT_BYTES_VERIFIED"),
    })
    .strict();

export const episodeProductionScriptReviewReceiptSchema = z
  .object({
    schema_version: z.literal(
      "filmstack-episode-production-script-review-receipt/v1",
    ),
    receipt_state: z.literal("LOCAL_REVIEW_DRAFT"),
    authority_state: z.literal("NO_EXTERNAL_AUTHORITY"),
    review_scope: z.literal("EPISODE_PRODUCTION_SCRIPT_CANDIDATE_ONLY"),
    determinism: z.literal("SAME_INPUTS_SAME_BYTES"),
    reviewer: z
      .object({
        label: boundedText(200),
        identity_assurance: z.literal("SELF_ATTESTED_LOCAL"),
      })
      .strict(),
    basis: z
      .object({
        production_script_package_id: boundedText(200),
        episode: z
          .object({
            episode_index: z.number().int().positive().max(10_000),
            episode_title: boundedText(500),
            assigned_test_id: boundedText(100),
          })
          .strict(),
        story_room_pack: exactFileBindingSchema("json"),
        production_script_manifest: exactFileBindingSchema("json"),
        fountain: exactFileBindingSchema("fountain"),
        source_status: z.literal(
          "EXACT_UPSTREAM_BYTES_VERIFIED_NOT_ADMITTED",
        ),
        production_gate: z.literal("PRODUCE_BLOCKED"),
      })
      .strict(),
    decision: z
      .object({
        disposition: z.enum(EPISODE_PRODUCTION_SCRIPT_REVIEW_DISPOSITIONS),
        note: z.string().max(2_000),
      })
      .strict()
      .superRefine((decision, ctx) => {
        if (
          decision.disposition !== "ACCEPT_CANDIDATE" &&
          !decision.note.trim()
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["note"],
            message: `${decision.disposition} requires a note`,
          });
        }
      }),
    effects: z
      .object({
        authoritative_state_change: z.literal("NONE"),
        receipt_output: z.literal("LOCAL_EXPORT_ONLY"),
        project_artifact_creation: z.literal("NOT_PERFORMED"),
        admission_candidate_creation: z.literal("NOT_PERFORMED"),
        source_admission: z.literal("NOT_PERFORMED"),
        canon: z.literal("UNCHANGED_NOT_ADMITTED"),
        production_gate: z.literal("UNCHANGED_PRODUCE_BLOCKED"),
        persistence: z.literal("NONE"),
        upload: z.literal(false),
        provider_call: z.literal(false),
        token_spend: z.literal(false),
        project_commit: z.literal(false),
      })
      .strict(),
  })
  .strict();

export type EpisodeProductionScriptReviewReceipt = z.infer<
  typeof episodeProductionScriptReviewReceiptSchema
>;

export interface EpisodeProductionScriptExactFileBindingInput {
  fileName: string;
  byteLength: number;
  sha256: string;
}

export interface EpisodeProductionScriptReviewBasisInput {
  productionScriptPackageId: string;
  episodeIndex: number;
  episodeTitle: string;
  assignedTestId: string;
  storyRoomPack: EpisodeProductionScriptExactFileBindingInput;
  productionScriptManifest: EpisodeProductionScriptExactFileBindingInput;
  fountain: EpisodeProductionScriptExactFileBindingInput;
}

export interface BuildEpisodeProductionScriptReviewReceiptInput {
  reviewerLabel: string;
  disposition: EpisodeProductionScriptReviewDisposition;
  note: string;
  basis: EpisodeProductionScriptReviewBasisInput;
}

export class EpisodeProductionScriptReviewError extends Error {
  readonly code: "INVALID_REVIEW" | "HASH_UNAVAILABLE";

  constructor(
    code: EpisodeProductionScriptReviewError["code"],
    message: string,
  ) {
    super(message);
    this.name = "EpisodeProductionScriptReviewError";
    this.code = code;
  }
}

function normalizeHumanText(value: string): string {
  return value.normalize("NFC").replace(/\r\n?/g, "\n").trim();
}

function exactBinding(
  input: EpisodeProductionScriptExactFileBindingInput,
) {
  return {
    file_name: input.fileName,
    byte_length: input.byteLength,
    sha256: input.sha256,
    verification: "EXACT_BYTES_VERIFIED" as const,
  };
}

export function buildEpisodeProductionScriptReviewReceipt(
  input: BuildEpisodeProductionScriptReviewReceiptInput,
): EpisodeProductionScriptReviewReceipt {
  const receipt = {
    schema_version:
      "filmstack-episode-production-script-review-receipt/v1" as const,
    receipt_state: "LOCAL_REVIEW_DRAFT" as const,
    authority_state: "NO_EXTERNAL_AUTHORITY" as const,
    review_scope: "EPISODE_PRODUCTION_SCRIPT_CANDIDATE_ONLY" as const,
    determinism: "SAME_INPUTS_SAME_BYTES" as const,
    reviewer: {
      label: normalizeHumanText(input.reviewerLabel),
      identity_assurance: "SELF_ATTESTED_LOCAL" as const,
    },
    basis: {
      production_script_package_id: normalizeHumanText(
        input.basis.productionScriptPackageId,
      ),
      episode: {
        episode_index: input.basis.episodeIndex,
        episode_title: normalizeHumanText(input.basis.episodeTitle),
        assigned_test_id: normalizeHumanText(input.basis.assignedTestId),
      },
      story_room_pack: exactBinding(input.basis.storyRoomPack),
      production_script_manifest: exactBinding(
        input.basis.productionScriptManifest,
      ),
      fountain: exactBinding(input.basis.fountain),
      source_status:
        "EXACT_UPSTREAM_BYTES_VERIFIED_NOT_ADMITTED" as const,
      production_gate: "PRODUCE_BLOCKED" as const,
    },
    decision: {
      disposition: input.disposition,
      note: normalizeHumanText(input.note),
    },
    effects: {
      authoritative_state_change: "NONE" as const,
      receipt_output: "LOCAL_EXPORT_ONLY" as const,
      project_artifact_creation: "NOT_PERFORMED" as const,
      admission_candidate_creation: "NOT_PERFORMED" as const,
      source_admission: "NOT_PERFORMED" as const,
      canon: "UNCHANGED_NOT_ADMITTED" as const,
      production_gate: "UNCHANGED_PRODUCE_BLOCKED" as const,
      persistence: "NONE" as const,
      upload: false as const,
      provider_call: false as const,
      token_spend: false as const,
      project_commit: false as const,
    },
  };

  const parsed = episodeProductionScriptReviewReceiptSchema.safeParse(receipt);
  if (!parsed.success) {
    throw new EpisodeProductionScriptReviewError(
      "INVALID_REVIEW",
      `The local review receipt is incomplete or invalid. ${
        parsed.error.issues[0]?.message ?? "Unknown error"
      }`,
    );
  }
  return parsed.data;
}

export function serializeEpisodeProductionScriptReviewReceipt(
  receipt: EpisodeProductionScriptReviewReceipt,
): Uint8Array {
  return new TextEncoder().encode(`${canonicalJson(receipt)}\n`);
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function sha256EpisodeProductionScriptReviewBytes(
  bytes: Uint8Array,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new EpisodeProductionScriptReviewError(
      "HASH_UNAVAILABLE",
      "This browser cannot compute the required local SHA-256 receipt.",
    );
  }
  const payload = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return bytesToHex(await subtle.digest("SHA-256", payload));
}
