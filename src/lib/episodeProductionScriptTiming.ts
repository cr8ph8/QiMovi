import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import type { EpisodeProductionScriptReviewBasisInput } from "@/lib/episodeProductionScriptReview";

export const EPISODE_PRODUCTION_SCRIPT_REHEARSAL_MODES = [
  "TABLE_READ",
  "BOARDOMATIC",
  "ANIMATIC",
] as const;

export type EpisodeProductionScriptRehearsalMode =
  (typeof EPISODE_PRODUCTION_SCRIPT_REHEARSAL_MODES)[number];

export const MAX_EPISODE_PRODUCTION_SCRIPT_TIMING_MS = 24 * 60 * 60 * 1_000;

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
      byte_length: z.number().int().positive().max(2 * 1024 * 1024),
      sha256: sha256Schema,
      verification: z.literal("EXACT_BYTES_VERIFIED"),
    })
    .strict();

export const episodeProductionScriptTimingReceiptSchema = z
  .object({
    schema_version: z.literal(
      "filmstack-episode-production-script-timing-receipt/v1",
    ),
    receipt_state: z.literal("LOCAL_TIMING_OBSERVATION_DRAFT"),
    authority_state: z.literal("NO_EXTERNAL_AUTHORITY"),
    observation_scope: z.literal("WHOLE_EPISODE_MANUAL_TIMING_ONLY"),
    determinism: z.literal("SAME_RECORDED_INPUTS_SAME_BYTES"),
    observer: z
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
            target_runtime_ms: z
              .number()
              .int()
              .positive()
              .max(MAX_EPISODE_PRODUCTION_SCRIPT_TIMING_MS),
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
    measurement: z
      .object({
        rehearsal_mode: z.enum(EPISODE_PRODUCTION_SCRIPT_REHEARSAL_MODES),
        mode_assurance: z.literal("SELF_ATTESTED_LOCAL"),
        clock_source: z.literal("BROWSER_MONOTONIC_PERFORMANCE_NOW"),
        capture_method: z.literal("MANUAL_START_STOP"),
        measured_runtime_ms: z
          .number()
          .int()
          .positive()
          .max(MAX_EPISODE_PRODUCTION_SCRIPT_TIMING_MS),
        delta_from_target_ms: z
          .number()
          .int()
          .min(-MAX_EPISODE_PRODUCTION_SCRIPT_TIMING_MS)
          .max(MAX_EPISODE_PRODUCTION_SCRIPT_TIMING_MS),
        relation_to_target: z.enum([
          "SHORTER_THAN_TARGET",
          "EXACT_TO_RECORDED_MILLISECOND",
          "LONGER_THAN_TARGET",
        ]),
        result_interpretation: z.literal("RAW_MEASUREMENT_NO_PASS_FAIL"),
        note: z.string().max(2_000),
      })
      .strict(),
    limitations: z
      .object({
        supporting_media: z.literal("NOT_CAPTURED_OR_BOUND"),
        human_click_latency: z.literal("NOT_CALIBRATED"),
        creative_disposition: z.literal("NOT_EVALUATED_BY_THIS_RECEIPT"),
        timing_acceptance: z.literal("NOT_DECIDED"),
        storyboard_readiness: z.literal("NOT_ESTABLISHED"),
        production_authorization: z.literal("NOT_GRANTED"),
      })
      .strict(),
    effects: z
      .object({
        authoritative_state_change: z.literal("NONE"),
        receipt_output: z.literal("LOCAL_EXPORT_ONLY"),
        project_artifact_creation: z.literal("NOT_PERFORMED"),
        admission_candidate_creation: z.literal("NOT_PERFORMED"),
        source_admission: z.literal("NOT_PERFORMED"),
        canon: z.literal("UNCHANGED_NOT_ADMITTED"),
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
    if (
      receipt.measurement.delta_from_target_ms !==
      receipt.measurement.measured_runtime_ms -
        receipt.basis.episode.target_runtime_ms
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["measurement", "delta_from_target_ms"],
        message: "Timing delta must equal measured runtime minus target runtime",
      });
    }
    const expectedRelation =
      receipt.measurement.delta_from_target_ms < 0
        ? "SHORTER_THAN_TARGET"
        : receipt.measurement.delta_from_target_ms > 0
          ? "LONGER_THAN_TARGET"
          : "EXACT_TO_RECORDED_MILLISECOND";
    if (receipt.measurement.relation_to_target !== expectedRelation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["measurement", "relation_to_target"],
        message: "Timing relation must match the derived target delta",
      });
    }
  });

export type EpisodeProductionScriptTimingReceipt = z.infer<
  typeof episodeProductionScriptTimingReceiptSchema
>;

export interface BuildEpisodeProductionScriptTimingReceiptInput {
  observerLabel: string;
  rehearsalMode: EpisodeProductionScriptRehearsalMode;
  targetRuntimeMs: number;
  measuredRuntimeMs: number;
  note: string;
  basis: EpisodeProductionScriptReviewBasisInput;
}

export class EpisodeProductionScriptTimingError extends Error {
  readonly code: "INVALID_TIMING" | "HASH_UNAVAILABLE";

  constructor(
    code: EpisodeProductionScriptTimingError["code"],
    message: string,
  ) {
    super(message);
    this.name = "EpisodeProductionScriptTimingError";
    this.code = code;
  }
}

function normalizeHumanText(value: string): string {
  return value.normalize("NFC").replace(/\r\n?/g, "\n").trim();
}

function exactBinding(
  input: EpisodeProductionScriptReviewBasisInput["storyRoomPack"],
) {
  return {
    file_name: input.fileName,
    byte_length: input.byteLength,
    sha256: input.sha256,
    verification: "EXACT_BYTES_VERIFIED" as const,
  };
}

export function buildEpisodeProductionScriptTimingReceipt(
  input: BuildEpisodeProductionScriptTimingReceiptInput,
): EpisodeProductionScriptTimingReceipt {
  const receipt = {
    schema_version:
      "filmstack-episode-production-script-timing-receipt/v1" as const,
    receipt_state: "LOCAL_TIMING_OBSERVATION_DRAFT" as const,
    authority_state: "NO_EXTERNAL_AUTHORITY" as const,
    observation_scope:
      "WHOLE_EPISODE_MANUAL_TIMING_ONLY" as const,
    determinism: "SAME_RECORDED_INPUTS_SAME_BYTES" as const,
    observer: {
      label: normalizeHumanText(input.observerLabel),
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
        target_runtime_ms: input.targetRuntimeMs,
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
    measurement: {
      rehearsal_mode: input.rehearsalMode,
      mode_assurance: "SELF_ATTESTED_LOCAL" as const,
      clock_source: "BROWSER_MONOTONIC_PERFORMANCE_NOW" as const,
      capture_method: "MANUAL_START_STOP" as const,
      measured_runtime_ms: input.measuredRuntimeMs,
      delta_from_target_ms: input.measuredRuntimeMs - input.targetRuntimeMs,
      relation_to_target:
        input.measuredRuntimeMs < input.targetRuntimeMs
          ? ("SHORTER_THAN_TARGET" as const)
          : input.measuredRuntimeMs > input.targetRuntimeMs
            ? ("LONGER_THAN_TARGET" as const)
            : ("EXACT_TO_RECORDED_MILLISECOND" as const),
      result_interpretation: "RAW_MEASUREMENT_NO_PASS_FAIL" as const,
      note: normalizeHumanText(input.note),
    },
    limitations: {
      supporting_media: "NOT_CAPTURED_OR_BOUND" as const,
      human_click_latency: "NOT_CALIBRATED" as const,
      creative_disposition: "NOT_EVALUATED_BY_THIS_RECEIPT" as const,
      timing_acceptance: "NOT_DECIDED" as const,
      storyboard_readiness: "NOT_ESTABLISHED" as const,
      production_authorization: "NOT_GRANTED" as const,
    },
    effects: {
      authoritative_state_change: "NONE" as const,
      receipt_output: "LOCAL_EXPORT_ONLY" as const,
      project_artifact_creation: "NOT_PERFORMED" as const,
      admission_candidate_creation: "NOT_PERFORMED" as const,
      source_admission: "NOT_PERFORMED" as const,
      canon: "UNCHANGED_NOT_ADMITTED" as const,
      storyboard_promotion: "NOT_PERFORMED" as const,
      production_gate: "UNCHANGED_PRODUCE_BLOCKED" as const,
      persistence: "NONE" as const,
      upload: false as const,
      provider_call: false as const,
      token_spend: false as const,
      project_commit: false as const,
    },
  };

  const parsed = episodeProductionScriptTimingReceiptSchema.safeParse(receipt);
  if (!parsed.success) {
    throw new EpisodeProductionScriptTimingError(
      "INVALID_TIMING",
      `The local timing receipt is incomplete or invalid. ${
        parsed.error.issues[0]?.message ?? "Unknown error"
      }`,
    );
  }
  return parsed.data;
}

export function serializeEpisodeProductionScriptTimingReceipt(
  receipt: EpisodeProductionScriptTimingReceipt,
): Uint8Array {
  return new TextEncoder().encode(`${canonicalJson(receipt)}\n`);
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function sha256EpisodeProductionScriptTimingBytes(
  bytes: Uint8Array,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new EpisodeProductionScriptTimingError(
      "HASH_UNAVAILABLE",
      "This browser cannot compute the required local SHA-256 timing receipt.",
    );
  }
  const payload = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return bytesToHex(await subtle.digest("SHA-256", payload));
}
