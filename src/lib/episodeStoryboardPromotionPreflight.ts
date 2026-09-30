import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import type {
  LocalEpisodeProductionScriptPreview,
  LocalReadableFile,
} from "@/lib/episodeProductionScript";
import {
  episodeProductionScriptReviewReceiptSchema,
  type EpisodeProductionScriptReviewReceipt,
} from "@/lib/episodeProductionScriptReview";
import {
  episodeProductionScriptTimingReceiptSchema,
  type EpisodeProductionScriptTimingReceipt,
} from "@/lib/episodeProductionScriptTiming";
import {
  episodeProductionScriptReferenceReceiptSchema,
  type EpisodeProductionScriptReferenceReceipt,
} from "@/lib/episodeProductionScriptReferences";

export const MAX_EPISODE_STORYBOARD_PREFLIGHT_RECEIPT_BYTES = 2 * 1024 * 1024;
export const MAX_EPISODE_STORYBOARD_PREFLIGHT_RECEIPTS = 3;
export const MAX_EPISODE_STORYBOARD_PREFLIGHT_TOTAL_BYTES =
  MAX_EPISODE_STORYBOARD_PREFLIGHT_RECEIPT_BYTES *
  MAX_EPISODE_STORYBOARD_PREFLIGHT_RECEIPTS;

export const EPISODE_STORYBOARD_PREFLIGHT_RECEIPT_SCHEMAS = [
  "filmstack-episode-production-script-review-receipt/v1",
  "filmstack-episode-production-script-timing-receipt/v1",
  "filmstack-episode-production-script-reference-review-receipt/v1",
] as const;

type SupportedReceiptSchema =
  (typeof EPISODE_STORYBOARD_PREFLIGHT_RECEIPT_SCHEMAS)[number];

const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Expected a lowercase 64-character SHA-256 hash");

const boundedText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, "Cannot be blank");

const localPathDisclosurePatterns = [
  /file:[\\/]+/i,
  /\/Users\//i,
  /(?:^|[^A-Za-z0-9_/])\/[A-Za-z0-9._-]+(?:[\\/]|$)/,
  /(?:^|[^A-Za-z0-9_])~[\\/]/,
  /(?:^|[^A-Za-z0-9_])\.\.?[\\/][^\s]/,
  /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]/,
  /(?:^|[^A-Za-z0-9_\\])\\\\[^\\\s]+[\\/]/,
] as const;

const portableBoundedText = (max: number) =>
  boundedText(max).refine(
    (value) => !localPathDisclosurePatterns.some((pattern) => pattern.test(value)),
    "Local filesystem paths are not allowed",
  );

const basenameJsonSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[^/\\]+\.json$/i, "Expected a basename-only .json file name");

const sourceFileBindingSchema = z
  .object({
    file_name: z.string().min(1).max(255).regex(/^[^/\\]+$/),
    byte_length: z.number().int().positive().max(2 * 1024 * 1024),
    sha256: sha256Schema,
    verification: z.literal("EXACT_BYTES_VERIFIED"),
  })
  .strict();

const receiptFileBindingSchema = z
  .object({
    file_name: basenameJsonSchema,
    byte_length: z
      .number()
      .int()
      .positive()
      .max(MAX_EPISODE_STORYBOARD_PREFLIGHT_RECEIPT_BYTES),
    sha256: sha256Schema,
    schema_version: z.enum(EPISODE_STORYBOARD_PREFLIGHT_RECEIPT_SCHEMAS),
    verification: z.literal("EXACT_CANONICAL_BYTES_VERIFIED"),
  })
  .strict();

const scriptReceiptFileBindingSchema = receiptFileBindingSchema.extend({
  schema_version: z.literal(EPISODE_STORYBOARD_PREFLIGHT_RECEIPT_SCHEMAS[0]),
});
const timingReceiptFileBindingSchema = receiptFileBindingSchema.extend({
  schema_version: z.literal(EPISODE_STORYBOARD_PREFLIGHT_RECEIPT_SCHEMAS[1]),
});
const visualReceiptFileBindingSchema = receiptFileBindingSchema.extend({
  schema_version: z.literal(EPISODE_STORYBOARD_PREFLIGHT_RECEIPT_SCHEMAS[2]),
});

const BLOCKER_REASONS = {
  scriptMissing: "No exact local production-script review receipt was supplied.",
  scriptAccept:
    "ACCEPT_CANDIDATE is a local review disposition, not creative approval or admission.",
  scriptRevise:
    "The local production-script disposition is REVISE and carries no external authority.",
  scriptReject:
    "The local production-script disposition is REJECT and carries no external authority.",
  timingMissing: "No exact local timing observation receipt was supplied.",
  timingPresent:
    "The exact timing receipt is a raw manual measurement and does not record timing acceptance.",
  visualMissing: "No exact local visual-reference review receipt was supplied.",
  visualIncomplete:
    "The local visual review still contains repair or reject decisions; approval and likeness rights are also unverified.",
  visualComplete:
    "Local candidate selections do not approve visual identity, style, environment, or likeness rights.",
  voice: "No approved dialogue and voice plan is bound to this episode source set.",
  authority:
    "No verified human authorization permits promotion into storyboard generation.",
  target:
    "No exact crosswalk binds this production-script evidence set to a selected preproduction or storyboard target pack.",
} as const;

const BLOCKER_REASON_VALUES = [
  BLOCKER_REASONS.scriptMissing,
  BLOCKER_REASONS.scriptAccept,
  BLOCKER_REASONS.scriptRevise,
  BLOCKER_REASONS.scriptReject,
  BLOCKER_REASONS.timingMissing,
  BLOCKER_REASONS.timingPresent,
  BLOCKER_REASONS.visualMissing,
  BLOCKER_REASONS.visualIncomplete,
  BLOCKER_REASONS.visualComplete,
  BLOCKER_REASONS.voice,
  BLOCKER_REASONS.authority,
  BLOCKER_REASONS.target,
] as const;

const blockerSchema = z
  .object({
    blocker_id: z.enum([
      "SCRIPT_CREATIVE_AUTHORITY",
      "TIMING_ACCEPTANCE",
      "VISUAL_APPROVAL_AND_RIGHTS",
      "DIALOGUE_AND_VOICE_PLAN",
      "STORYBOARD_PROMOTION_AUTHORIZATION",
      "TARGET_STORYBOARD_CORRESPONDENCE",
    ]),
    state: z.literal("BLOCKING"),
    reason: z.enum(BLOCKER_REASON_VALUES).and(portableBoundedText(500)),
  })
  .strict();

export const episodeStoryboardPromotionPreflightReportSchema = z
  .object({
    schema_version: z.literal(
      "filmstack-episode-storyboard-promotion-preflight-report/v1",
    ),
    report_state: z.literal("LOCAL_BLOCKED_GAP_REPORT"),
    authority_state: z.literal("NO_EXTERNAL_AUTHORITY"),
    assessment_scope: z.literal(
      "EPISODE_STORYBOARD_PROMOTION_PREFLIGHT_ONLY",
    ),
    determinism: z.literal("SAME_EXACT_INPUTS_SAME_BYTES"),
    basis: z
      .object({
        production_script_package_id: portableBoundedText(200),
        episode: z
          .object({
            episode_index: z.number().int().positive().max(10_000),
            episode_title: portableBoundedText(500),
            assigned_test_id: portableBoundedText(100),
            dramatic_result: z.enum(["PASS", "FAIL", "UNKNOWN"]),
            target_runtime_ms: z.number().int().positive().max(24 * 60 * 60 * 1_000),
          })
          .strict(),
        story_room_pack: sourceFileBindingSchema,
        production_script_manifest: sourceFileBindingSchema,
        fountain: sourceFileBindingSchema,
        correspondence: z.literal("MATCHED_CURRENT_VERIFIED_PREVIEW_BINDINGS"),
        target_storyboard_correspondence: z.literal(
          "INCOMPLETE_NO_TARGET_PACK_BOUND",
        ),
        source_status: z.literal("EXACT_BYTES_VERIFIED_NOT_ADMITTED"),
        production_gate: z.literal("PRODUCE_BLOCKED"),
      })
      .strict(),
    evidence: z
      .object({
        script_review: z
          .object({
            state: z.enum([
              "MISSING_LOCAL_RECEIPT",
              "PRESENT_LOCAL_REVIEW_NOT_AUTHORITY",
            ]),
            receipt: scriptReceiptFileBindingSchema.nullable(),
            disposition: z
              .enum(["ACCEPT_CANDIDATE", "REVISE", "REJECT"])
              .nullable(),
            authority_assurance: z.literal("NOT_ESTABLISHED"),
          })
          .strict(),
        timing_observation: z
          .object({
            state: z.enum([
              "MISSING_LOCAL_RECEIPT",
              "PRESENT_RAW_MEASUREMENT_NOT_ACCEPTED",
            ]),
            receipt: timingReceiptFileBindingSchema.nullable(),
            rehearsal_mode: z
              .enum(["TABLE_READ", "BOARDOMATIC", "ANIMATIC"])
              .nullable(),
            measured_runtime_ms: z.number().int().positive().nullable(),
            delta_from_target_ms: z.number().int().nullable(),
            timing_acceptance: z.literal("NOT_ESTABLISHED"),
          })
          .strict(),
        visual_reference_review: z
          .object({
            state: z.enum([
              "MISSING_LOCAL_RECEIPT",
              "PRESENT_LOCAL_REVIEW_NOT_APPROVAL",
            ]),
            receipt: visualReceiptFileBindingSchema.nullable(),
            summary: z
              .object({
                total: z.literal(4),
                accepted: z.number().int().nonnegative().max(4),
                repair: z.number().int().nonnegative().max(4),
                rejected: z.number().int().nonnegative().max(4),
              })
              .strict()
              .nullable(),
            reference_approval: z.literal("NOT_ESTABLISHED"),
            likeness_rights: z.literal("NOT_VERIFIED"),
          })
          .strict(),
        dialogue_and_voice_plan: z
          .object({
            state: z.literal("MISSING_REQUIRED_EVIDENCE"),
            approval: z.literal("NOT_ESTABLISHED"),
          })
          .strict(),
        promotion_authorization: z
          .object({
            state: z.literal("MISSING_REQUIRED_EVIDENCE"),
            authority: z.literal("NOT_ESTABLISHED"),
          })
          .strict(),
      })
      .strict(),
    blockers: z.array(blockerSchema).length(6),
    outcome: z
      .object({
        promotion_candidate: z.literal("NOT_ESTABLISHED"),
        storyboard_promotion: z.literal("BLOCKED"),
        prompt_generation: z.literal("BLOCKED"),
        target_storyboard_correspondence: z.literal(
          "INCOMPLETE_NO_TARGET_PACK_BOUND",
        ),
        production_gate: z.literal("PRODUCE_BLOCKED"),
        next_action: z.literal("OBTAIN_AND_VERIFY_REQUIRED_HUMAN_EVIDENCE"),
      })
      .strict(),
    effects: z
      .object({
        authoritative_state_change: z.literal("NONE"),
        report_output: z.literal("LOCAL_EXPORT_ONLY"),
        project_artifact_creation: z.literal("NOT_PERFORMED"),
        admission_candidate_creation: z.literal("NOT_PERFORMED"),
        source_admission: z.literal("NOT_PERFORMED"),
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
  .superRefine((report, ctx) => {
    const expectedIds = [
      "SCRIPT_CREATIVE_AUTHORITY",
      "TIMING_ACCEPTANCE",
      "VISUAL_APPROVAL_AND_RIGHTS",
      "DIALOGUE_AND_VOICE_PLAN",
      "STORYBOARD_PROMOTION_AUTHORIZATION",
      "TARGET_STORYBOARD_CORRESPONDENCE",
    ];
    if (
      report.blockers.some(
        (blocker, index) => blocker.blocker_id !== expectedIds[index],
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockers"],
        message: "All six promotion blockers must remain present in fixed order",
      });
    }

    const script = report.evidence.script_review;
    const scriptPresent = script.state === "PRESENT_LOCAL_REVIEW_NOT_AUTHORITY";
    if (
      scriptPresent !== (script.receipt !== null) ||
      scriptPresent !== (script.disposition !== null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence", "script_review"],
        message: "Script evidence state, receipt binding, and disposition must agree",
      });
    }

    const timing = report.evidence.timing_observation;
    const timingPresent =
      timing.state === "PRESENT_RAW_MEASUREMENT_NOT_ACCEPTED";
    const timingValuesPresent =
      timing.rehearsal_mode !== null &&
      timing.measured_runtime_ms !== null &&
      timing.delta_from_target_ms !== null;
    if (timingPresent !== (timing.receipt !== null) || timingPresent !== timingValuesPresent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence", "timing_observation"],
        message: "Timing evidence state, receipt binding, and measurement must agree",
      });
    }
    if (
      timingPresent &&
      timing.measured_runtime_ms !== null &&
      timing.delta_from_target_ms !== null &&
      timing.measured_runtime_ms - report.basis.episode.target_runtime_ms !==
        timing.delta_from_target_ms
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence", "timing_observation", "delta_from_target_ms"],
        message: "Timing delta must match the report target runtime",
      });
    }

    const visual = report.evidence.visual_reference_review;
    const visualPresent = visual.state === "PRESENT_LOCAL_REVIEW_NOT_APPROVAL";
    if (
      visualPresent !== (visual.receipt !== null) ||
      visualPresent !== (visual.summary !== null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence", "visual_reference_review"],
        message: "Visual evidence state, receipt binding, and summary must agree",
      });
    }
    if (
      visual.summary &&
      visual.summary.accepted + visual.summary.repair + visual.summary.rejected !==
        visual.summary.total
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence", "visual_reference_review", "summary"],
        message: "Visual summary counts must total four",
      });
    }

    const expectedReasons = [
      !scriptPresent
        ? BLOCKER_REASONS.scriptMissing
        : script.disposition === "REVISE"
          ? BLOCKER_REASONS.scriptRevise
          : script.disposition === "REJECT"
            ? BLOCKER_REASONS.scriptReject
            : BLOCKER_REASONS.scriptAccept,
      timingPresent ? BLOCKER_REASONS.timingPresent : BLOCKER_REASONS.timingMissing,
      !visualPresent || visual.summary === null
        ? BLOCKER_REASONS.visualMissing
        : visual.summary.repair > 0 || visual.summary.rejected > 0
          ? BLOCKER_REASONS.visualIncomplete
          : BLOCKER_REASONS.visualComplete,
      BLOCKER_REASONS.voice,
      BLOCKER_REASONS.authority,
      BLOCKER_REASONS.target,
    ];
    if (
      report.blockers.some(
        (blocker, index) => blocker.reason !== expectedReasons[index],
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockers"],
        message: "Blocker reasons must match the exact evidence state",
      });
    }
  });

export type EpisodeStoryboardPromotionPreflightReport = z.infer<
  typeof episodeStoryboardPromotionPreflightReportSchema
>;

interface ParsedReceipt<T> {
  receipt: T;
  binding: z.infer<typeof receiptFileBindingSchema>;
}

export interface LocalEpisodeStoryboardPromotionPreflightPreview {
  report: EpisodeStoryboardPromotionPreflightReport;
  reportBytes: Uint8Array;
  reportSha256: string;
  selectedReceiptCount: number;
  receipts: {
    scriptReview: ParsedReceipt<EpisodeProductionScriptReviewReceipt> | null;
    timing: ParsedReceipt<EpisodeProductionScriptTimingReceipt> | null;
    visualReference: ParsedReceipt<EpisodeProductionScriptReferenceReceipt> | null;
  };
}

export type EpisodeStoryboardPromotionPreflightErrorCode =
  | "INVALID_FILE_SET"
  | "INVALID_FILE_NAME"
  | "INVALID_FILE_SIZE"
  | "FILE_TOO_LARGE"
  | "INVALID_ENCODING"
  | "INVALID_JSON"
  | "UNSUPPORTED_RECEIPT"
  | "DUPLICATE_RECEIPT"
  | "INVALID_RECEIPT"
  | "NON_CANONICAL_RECEIPT"
  | "STALE_RECEIPT"
  | "HASH_UNAVAILABLE"
  | "INVALID_REPORT";

export class EpisodeStoryboardPromotionPreflightError extends Error {
  readonly code: EpisodeStoryboardPromotionPreflightErrorCode;

  constructor(code: EpisodeStoryboardPromotionPreflightErrorCode, message: string) {
    super(message);
    this.name = "EpisodeStoryboardPromotionPreflightError";
    this.code = code;
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function sha256EpisodeStoryboardPromotionPreflightBytes(
  bytes: Uint8Array,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new EpisodeStoryboardPromotionPreflightError(
      "HASH_UNAVAILABLE",
      "This browser cannot compute the required local SHA-256 preflight hash.",
    );
  }
  const payload = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return bytesToHex(await subtle.digest("SHA-256", payload));
}

function canonicalReceiptBytes(receipt: unknown): Uint8Array {
  return new TextEncoder().encode(`${canonicalJson(receipt)}\n`);
}

function assertSourceBinding(
  label: string,
  actual: {
    file_name?: unknown;
    byte_length?: unknown;
    sha256?: unknown;
  },
  expected: { fileName: string; byteLength: number; sha256: string },
) {
  if (
    typeof actual.file_name !== "string" ||
    typeof actual.byte_length !== "number" ||
    typeof actual.sha256 !== "string" ||
    actual.file_name !== expected.fileName ||
    actual.byte_length !== expected.byteLength ||
    actual.sha256 !== expected.sha256
  ) {
    throw new EpisodeStoryboardPromotionPreflightError(
      "STALE_RECEIPT",
      `${label} does not correspond to the exact source bytes loaded in this workspace.`,
    );
  }
}

function assertReceiptCorrespondence(
  receipt:
    | EpisodeProductionScriptReviewReceipt
    | EpisodeProductionScriptTimingReceipt
    | EpisodeProductionScriptReferenceReceipt,
  preview: LocalEpisodeProductionScriptPreview,
) {
  const basis = receipt.basis;
  if (
    basis.production_script_package_id !== preview.pack.package_id ||
    basis.episode.episode_index !== preview.pack.episode.episode_index ||
    basis.episode.episode_title !== preview.pack.episode.title ||
    basis.episode.assigned_test_id !== preview.pack.episode.test_id
  ) {
    throw new EpisodeStoryboardPromotionPreflightError(
      "STALE_RECEIPT",
      "The selected receipt belongs to a different episode or production-script package.",
    );
  }
  assertSourceBinding("Story Room binding", basis.story_room_pack, preview.sourceStoryRoom);
  assertSourceBinding(
    "Production-script manifest binding",
    basis.production_script_manifest,
    preview.manifest,
  );
  assertSourceBinding("Fountain binding", basis.fountain, preview.screenplay);
  if (
    "target_runtime_ms" in basis.episode &&
    basis.episode.target_runtime_ms !== preview.pack.target_runtime_seconds * 1_000
  ) {
    throw new EpisodeStoryboardPromotionPreflightError(
      "STALE_RECEIPT",
      "The timing receipt target does not match the loaded episode target runtime.",
    );
  }
}

async function parseReceiptFile(
  file: LocalReadableFile,
  preview: LocalEpisodeProductionScriptPreview,
): Promise<{
  schema: SupportedReceiptSchema;
  parsed:
    | ParsedReceipt<EpisodeProductionScriptReviewReceipt>
    | ParsedReceipt<EpisodeProductionScriptTimingReceipt>
    | ParsedReceipt<EpisodeProductionScriptReferenceReceipt>;
}> {
  if (!basenameJsonSchema.safeParse(file.name).success) {
    throw new EpisodeStoryboardPromotionPreflightError(
      "INVALID_FILE_NAME",
      "Receipt files must use a basename-only .json name.",
    );
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new EpisodeStoryboardPromotionPreflightError(
      "INVALID_FILE_SIZE",
      `Receipt ${file.name} has an invalid declared size.`,
    );
  }
  if (file.size > MAX_EPISODE_STORYBOARD_PREFLIGHT_RECEIPT_BYTES) {
    throw new EpisodeStoryboardPromotionPreflightError(
      "FILE_TOO_LARGE",
      `Receipt ${file.name} exceeds the 2 MiB per-file limit.`,
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) {
    throw new EpisodeStoryboardPromotionPreflightError(
      "INVALID_FILE_SIZE",
      `Receipt ${file.name} byte length changed while it was being read.`,
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new EpisodeStoryboardPromotionPreflightError(
      "INVALID_ENCODING",
      `Receipt ${file.name} is not valid UTF-8 JSON.`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new EpisodeStoryboardPromotionPreflightError(
      "INVALID_JSON",
      `Receipt ${file.name} is not valid JSON.`,
    );
  }
  const schema =
    typeof raw === "object" && raw !== null && "schema_version" in raw
      ? (raw as { schema_version?: unknown }).schema_version
      : null;
  if (
    typeof schema !== "string" ||
    !EPISODE_STORYBOARD_PREFLIGHT_RECEIPT_SCHEMAS.includes(
      schema as SupportedReceiptSchema,
    )
  ) {
    throw new EpisodeStoryboardPromotionPreflightError(
      "UNSUPPORTED_RECEIPT",
      `Receipt ${file.name} does not use a supported exact schema version.`,
    );
  }

  const parser =
    schema === EPISODE_STORYBOARD_PREFLIGHT_RECEIPT_SCHEMAS[0]
      ? episodeProductionScriptReviewReceiptSchema
      : schema === EPISODE_STORYBOARD_PREFLIGHT_RECEIPT_SCHEMAS[1]
        ? episodeProductionScriptTimingReceiptSchema
        : episodeProductionScriptReferenceReceiptSchema;
  const result = parser.safeParse(raw);
  if (!result.success) {
    throw new EpisodeStoryboardPromotionPreflightError(
      "INVALID_RECEIPT",
      `Receipt ${file.name} is invalid. ${result.error.issues[0]?.message ?? "Unknown error"}`,
    );
  }
  const receipt = result.data as
    | EpisodeProductionScriptReviewReceipt
    | EpisodeProductionScriptTimingReceipt
    | EpisodeProductionScriptReferenceReceipt;
  if (!bytesEqual(bytes, canonicalReceiptBytes(receipt))) {
    throw new EpisodeStoryboardPromotionPreflightError(
      "NON_CANONICAL_RECEIPT",
      `Receipt ${file.name} is semantically valid but not the exact deterministic export bytes.`,
    );
  }
  assertReceiptCorrespondence(receipt, preview);
  return {
    schema: schema as SupportedReceiptSchema,
    parsed: {
      receipt,
      binding: {
        file_name: file.name,
        byte_length: bytes.byteLength,
        sha256: await sha256EpisodeStoryboardPromotionPreflightBytes(bytes),
        schema_version: schema as SupportedReceiptSchema,
        verification: "EXACT_CANONICAL_BYTES_VERIFIED",
      },
    } as
      | ParsedReceipt<EpisodeProductionScriptReviewReceipt>
      | ParsedReceipt<EpisodeProductionScriptTimingReceipt>
      | ParsedReceipt<EpisodeProductionScriptReferenceReceipt>,
  };
}

function sourceBinding(input: { fileName: string; byteLength: number; sha256: string }) {
  return {
    file_name: input.fileName,
    byte_length: input.byteLength,
    sha256: input.sha256,
    verification: "EXACT_BYTES_VERIFIED" as const,
  };
}

function scriptBlockerReason(
  receipt: EpisodeProductionScriptReviewReceipt | null,
): string {
  if (!receipt) return BLOCKER_REASONS.scriptMissing;
  if (receipt.decision.disposition === "REVISE") {
    return BLOCKER_REASONS.scriptRevise;
  }
  if (receipt.decision.disposition === "REJECT") {
    return BLOCKER_REASONS.scriptReject;
  }
  return BLOCKER_REASONS.scriptAccept;
}

function visualBlockerReason(
  receipt: EpisodeProductionScriptReferenceReceipt | null,
): string {
  if (!receipt) return BLOCKER_REASONS.visualMissing;
  if (receipt.summary.repair > 0 || receipt.summary.rejected > 0) {
    return BLOCKER_REASONS.visualIncomplete;
  }
  return BLOCKER_REASONS.visualComplete;
}

export function serializeEpisodeStoryboardPromotionPreflightReport(
  report: EpisodeStoryboardPromotionPreflightReport,
): Uint8Array {
  const parsed = episodeStoryboardPromotionPreflightReportSchema.safeParse(report);
  if (!parsed.success) {
    throw new EpisodeStoryboardPromotionPreflightError(
      "INVALID_REPORT",
      "Refusing to serialize an invalid or weakened storyboard-promotion gap report.",
    );
  }
  return new TextEncoder().encode(`${canonicalJson(parsed.data)}\n`);
}

export async function readLocalEpisodeStoryboardPromotionPreflight(input: {
  receiptFiles: readonly LocalReadableFile[];
  episodePreview: LocalEpisodeProductionScriptPreview;
}): Promise<LocalEpisodeStoryboardPromotionPreflightPreview> {
  const { receiptFiles, episodePreview } = input;
  if (receiptFiles.length > MAX_EPISODE_STORYBOARD_PREFLIGHT_RECEIPTS) {
    throw new EpisodeStoryboardPromotionPreflightError(
      "INVALID_FILE_SET",
      "Select at most one script, timing, and visual-reference receipt.",
    );
  }
  if (new Set(receiptFiles.map((file) => file.name)).size !== receiptFiles.length) {
    throw new EpisodeStoryboardPromotionPreflightError(
      "INVALID_FILE_SET",
      "Duplicate receipt file names are not allowed.",
    );
  }
  const declaredTotal = receiptFiles.reduce((total, file) => total + file.size, 0);
  if (!Number.isSafeInteger(declaredTotal) || declaredTotal > MAX_EPISODE_STORYBOARD_PREFLIGHT_TOTAL_BYTES) {
    throw new EpisodeStoryboardPromotionPreflightError(
      "FILE_TOO_LARGE",
      "The selected receipts exceed the 6 MiB local preflight limit.",
    );
  }

  let scriptReview: ParsedReceipt<EpisodeProductionScriptReviewReceipt> | null = null;
  let timing: ParsedReceipt<EpisodeProductionScriptTimingReceipt> | null = null;
  let visualReference: ParsedReceipt<EpisodeProductionScriptReferenceReceipt> | null = null;

  for (const file of receiptFiles) {
    const { schema, parsed } = await parseReceiptFile(file, episodePreview);
    if (schema === EPISODE_STORYBOARD_PREFLIGHT_RECEIPT_SCHEMAS[0]) {
      if (scriptReview) {
        throw new EpisodeStoryboardPromotionPreflightError(
          "DUPLICATE_RECEIPT",
          "Only one production-script review receipt may be inspected.",
        );
      }
      scriptReview = parsed as ParsedReceipt<EpisodeProductionScriptReviewReceipt>;
    } else if (schema === EPISODE_STORYBOARD_PREFLIGHT_RECEIPT_SCHEMAS[1]) {
      if (timing) {
        throw new EpisodeStoryboardPromotionPreflightError(
          "DUPLICATE_RECEIPT",
          "Only one timing receipt may be inspected.",
        );
      }
      timing = parsed as ParsedReceipt<EpisodeProductionScriptTimingReceipt>;
    } else {
      if (visualReference) {
        throw new EpisodeStoryboardPromotionPreflightError(
          "DUPLICATE_RECEIPT",
          "Only one visual-reference review receipt may be inspected.",
        );
      }
      visualReference = parsed as ParsedReceipt<EpisodeProductionScriptReferenceReceipt>;
    }
  }

  const report = {
    schema_version:
      "filmstack-episode-storyboard-promotion-preflight-report/v1" as const,
    report_state: "LOCAL_BLOCKED_GAP_REPORT" as const,
    authority_state: "NO_EXTERNAL_AUTHORITY" as const,
    assessment_scope: "EPISODE_STORYBOARD_PROMOTION_PREFLIGHT_ONLY" as const,
    determinism: "SAME_EXACT_INPUTS_SAME_BYTES" as const,
    basis: {
      production_script_package_id: episodePreview.pack.package_id,
      episode: {
        episode_index: episodePreview.pack.episode.episode_index,
        episode_title: episodePreview.pack.episode.title,
        assigned_test_id: episodePreview.pack.episode.test_id,
        dramatic_result: episodePreview.pack.episode.result,
        target_runtime_ms: episodePreview.pack.target_runtime_seconds * 1_000,
      },
      story_room_pack: sourceBinding(episodePreview.sourceStoryRoom),
      production_script_manifest: sourceBinding(episodePreview.manifest),
      fountain: sourceBinding(episodePreview.screenplay),
      correspondence: "MATCHED_CURRENT_VERIFIED_PREVIEW_BINDINGS" as const,
      target_storyboard_correspondence:
        "INCOMPLETE_NO_TARGET_PACK_BOUND" as const,
      source_status: "EXACT_BYTES_VERIFIED_NOT_ADMITTED" as const,
      production_gate: "PRODUCE_BLOCKED" as const,
    },
    evidence: {
      script_review: {
        state: scriptReview
          ? ("PRESENT_LOCAL_REVIEW_NOT_AUTHORITY" as const)
          : ("MISSING_LOCAL_RECEIPT" as const),
        receipt: scriptReview?.binding ?? null,
        disposition: scriptReview?.receipt.decision.disposition ?? null,
        authority_assurance: "NOT_ESTABLISHED" as const,
      },
      timing_observation: {
        state: timing
          ? ("PRESENT_RAW_MEASUREMENT_NOT_ACCEPTED" as const)
          : ("MISSING_LOCAL_RECEIPT" as const),
        receipt: timing?.binding ?? null,
        rehearsal_mode: timing?.receipt.measurement.rehearsal_mode ?? null,
        measured_runtime_ms: timing?.receipt.measurement.measured_runtime_ms ?? null,
        delta_from_target_ms: timing?.receipt.measurement.delta_from_target_ms ?? null,
        timing_acceptance: "NOT_ESTABLISHED" as const,
      },
      visual_reference_review: {
        state: visualReference
          ? ("PRESENT_LOCAL_REVIEW_NOT_APPROVAL" as const)
          : ("MISSING_LOCAL_RECEIPT" as const),
        receipt: visualReference?.binding ?? null,
        summary: visualReference?.receipt.summary ?? null,
        reference_approval: "NOT_ESTABLISHED" as const,
        likeness_rights: "NOT_VERIFIED" as const,
      },
      dialogue_and_voice_plan: {
        state: "MISSING_REQUIRED_EVIDENCE" as const,
        approval: "NOT_ESTABLISHED" as const,
      },
      promotion_authorization: {
        state: "MISSING_REQUIRED_EVIDENCE" as const,
        authority: "NOT_ESTABLISHED" as const,
      },
    },
    blockers: [
      {
        blocker_id: "SCRIPT_CREATIVE_AUTHORITY" as const,
        state: "BLOCKING" as const,
        reason: scriptBlockerReason(scriptReview?.receipt ?? null),
      },
      {
        blocker_id: "TIMING_ACCEPTANCE" as const,
        state: "BLOCKING" as const,
        reason: timing ? BLOCKER_REASONS.timingPresent : BLOCKER_REASONS.timingMissing,
      },
      {
        blocker_id: "VISUAL_APPROVAL_AND_RIGHTS" as const,
        state: "BLOCKING" as const,
        reason: visualBlockerReason(visualReference?.receipt ?? null),
      },
      {
        blocker_id: "DIALOGUE_AND_VOICE_PLAN" as const,
        state: "BLOCKING" as const,
        reason: BLOCKER_REASONS.voice,
      },
      {
        blocker_id: "STORYBOARD_PROMOTION_AUTHORIZATION" as const,
        state: "BLOCKING" as const,
        reason: BLOCKER_REASONS.authority,
      },
      {
        blocker_id: "TARGET_STORYBOARD_CORRESPONDENCE" as const,
        state: "BLOCKING" as const,
        reason: BLOCKER_REASONS.target,
      },
    ],
    outcome: {
      promotion_candidate: "NOT_ESTABLISHED" as const,
      storyboard_promotion: "BLOCKED" as const,
      prompt_generation: "BLOCKED" as const,
      target_storyboard_correspondence:
        "INCOMPLETE_NO_TARGET_PACK_BOUND" as const,
      production_gate: "PRODUCE_BLOCKED" as const,
      next_action: "OBTAIN_AND_VERIFY_REQUIRED_HUMAN_EVIDENCE" as const,
    },
    effects: {
      authoritative_state_change: "NONE" as const,
      report_output: "LOCAL_EXPORT_ONLY" as const,
      project_artifact_creation: "NOT_PERFORMED" as const,
      admission_candidate_creation: "NOT_PERFORMED" as const,
      source_admission: "NOT_PERFORMED" as const,
      storyboard_promotion: "NOT_PERFORMED" as const,
      production_gate: "UNCHANGED_PRODUCE_BLOCKED" as const,
      persistence: "NONE" as const,
      upload: false as const,
      provider_call: false as const,
      token_spend: false as const,
      project_commit: false as const,
    },
  };
  const parsedReport = episodeStoryboardPromotionPreflightReportSchema.safeParse(report);
  if (!parsedReport.success) {
    throw new EpisodeStoryboardPromotionPreflightError(
      "INVALID_REPORT",
      `The local preflight report is invalid. ${parsedReport.error.issues[0]?.message ?? "Unknown error"}`,
    );
  }
  const reportBytes = serializeEpisodeStoryboardPromotionPreflightReport(parsedReport.data);
  return {
    report: parsedReport.data,
    reportBytes,
    reportSha256: await sha256EpisodeStoryboardPromotionPreflightBytes(reportBytes),
    selectedReceiptCount: receiptFiles.length,
    receipts: { scriptReview, timing, visualReference },
  };
}
