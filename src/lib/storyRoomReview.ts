import { z } from "zod";
import {
  STORY_ROOM_RESULTS,
  type LocalStoryRoomPackPreview,
  type StoryRoomPack,
} from "@/lib/storyRoomPack";
import { canonicalJson } from "@/lib/canonicalJson";
import {
  MAX_STORY_ROOM_BINDING_EVIDENCE_BYTES,
  type LocalStoryRoomContextBundleEvidence,
} from "@/lib/storyRoomBindingPreflight";
import type { StoryRoomWorkspaceContext } from "@/lib/storyRoomWorkspaceContext";

export const STORY_ROOM_REVIEW_DISPOSITIONS = ["ACCEPT", "REVISE", "REJECT"] as const;

export type StoryRoomReviewDisposition =
  (typeof STORY_ROOM_REVIEW_DISPOSITIONS)[number];

const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Expected a lowercase 64-character SHA-256 hash");

const uuidSchema = z.string().uuid();

const boundedText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, "Cannot be blank");

const receiptDecisionSchema = z
  .object({
    episode_index: z.number().int().positive().max(10_000),
    episode_title: boundedText(500),
    assigned_test_id: boundedText(100),
    authored_test_id: boundedText(100).nullable(),
    episode_result: z.enum(STORY_ROOM_RESULTS),
    disposition: z.enum(STORY_ROOM_REVIEW_DISPOSITIONS),
    note: z.string().max(2_000),
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
  });

const reviewWorkspaceContextSchema = z
  .object({
    project_id: uuidSchema,
    entry_id: uuidSchema,
    selected_context_content_hash: sha256Schema,
    route: z
      .object({
        origin: z.literal("STAGE_B_NAVIGATION_CONTEXT"),
        project_id: uuidSchema,
        subject_id: uuidSchema,
        kind: z.literal("entry"),
        verification: z.literal("VALID_SHAPE_UNAUTHENTICATED"),
      })
      .strict(),
    context_bundle: z
      .object({
        selection: z.literal("EXPLICIT_LOCAL_FILE"),
        exact_file_sha256: sha256Schema,
        byte_length: z
          .number()
          .int()
          .positive()
          .max(MAX_STORY_ROOM_BINDING_EVIDENCE_BYTES),
        project_id: uuidSchema,
        entry_id: uuidSchema,
        declared_content_hash: sha256Schema,
        recomputed_content_hash: sha256Schema,
        verification: z.literal("LOCAL_SELF_HASH_AND_ROUTE_MATCH"),
      })
      .strict(),
    binding_state: z.literal(
      "LOCAL_CONTEXT_CORRESPONDENCE_VERIFIED_NOT_AUTHORITY",
    ),
  })
  .strict()
  .superRefine((workspace, ctx) => {
    const identityChecks: Array<{
      path: (string | number)[];
      actual: string;
      expected: string;
      message: string;
    }> = [
      {
        path: ["route", "project_id"],
        actual: workspace.route.project_id,
        expected: workspace.project_id,
        message: "Route project must match the selected project",
      },
      {
        path: ["context_bundle", "project_id"],
        actual: workspace.context_bundle.project_id,
        expected: workspace.project_id,
        message: "Context bundle project must match the selected project",
      },
      {
        path: ["route", "subject_id"],
        actual: workspace.route.subject_id,
        expected: workspace.entry_id,
        message: "Route subject must match the selected entry",
      },
      {
        path: ["context_bundle", "entry_id"],
        actual: workspace.context_bundle.entry_id,
        expected: workspace.entry_id,
        message: "Context bundle entry must match the selected entry",
      },
      {
        path: ["context_bundle", "declared_content_hash"],
        actual: workspace.context_bundle.declared_content_hash,
        expected: workspace.selected_context_content_hash,
        message: "Declared context hash must match the selected context hash",
      },
      {
        path: ["context_bundle", "recomputed_content_hash"],
        actual: workspace.context_bundle.recomputed_content_hash,
        expected: workspace.selected_context_content_hash,
        message: "Recomputed context hash must match the selected context hash",
      },
    ];

    for (const check of identityChecks) {
      if (check.actual !== check.expected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: check.path,
          message: check.message,
        });
      }
    }
  });

export const storyRoomReviewReceiptSchema = z
  .object({
    schema_version: z.literal("filmstack-story-room-review-receipt/v2"),
    receipt_state: z.literal("LOCAL_REVIEW_DRAFT"),
    authority_state: z.literal("NO_EXTERNAL_AUTHORITY"),
    review_scope: z.literal("MICRO_EPISODE_STRUCTURE_ONLY"),
    determinism: z.literal("SAME_INPUTS_SAME_BYTES"),
    reviewer: z
      .object({
        label: boundedText(200),
        identity_assurance: z.literal("SELF_ATTESTED_LOCAL"),
      })
      .strict(),
    basis: z
      .object({
        package_id: boundedText(200),
        story_room_pack_sha256: sha256Schema,
        story_room_pack_verification: z.literal("EXACT_BYTES_VERIFIED"),
        workspace_context: reviewWorkspaceContextSchema,
        feature_baseline: z
          .object({
            package_id: boundedText(200),
            relationship: z.literal("DOES_NOT_SUPERSEDE"),
            feature_scene_outline_sha256: sha256Schema,
            feature_package_manifest_sha256: sha256Schema,
            verification: z.literal("DECLARED_IN_EXACT_PACK_NOT_REVERIFIED"),
          })
          .strict(),
        source_status: z.literal("DECLARED_NOT_ADMITTED"),
        format_relationship: z.literal("PENDING_HUMAN_DECISION"),
        production_gate: z.literal("PRODUCE_BLOCKED"),
      })
      .strict(),
    completeness: z.literal("COMPLETE"),
    summary: z
      .object({
        total: z.number().int().positive().max(24),
        accepted: z.number().int().nonnegative().max(24),
        revise: z.number().int().nonnegative().max(24),
        rejected: z.number().int().nonnegative().max(24),
      })
      .strict(),
    decisions: z.array(receiptDecisionSchema).min(1).max(24),
    effects: z
      .object({
        authoritative_state_change: z.literal("NONE"),
        feature_package: z.literal("UNCHANGED"),
        creative_direction: z.literal("PROPOSE_ONLY"),
        format_relationship: z.literal("UNCHANGED_PENDING_HUMAN_DECISION"),
        source_admission: z.literal("UNCHANGED_DECLARED_NOT_ADMITTED"),
        production_gate: z.literal("UNCHANGED_PRODUCE_BLOCKED"),
        prompt_generation: z.literal("BLOCKED"),
        persistence: z.literal("LOCAL_EXPORT_ONLY"),
        upload: z.literal(false),
        provider_call: z.literal(false),
        token_spend: z.literal(false),
        project_commit: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((receipt, ctx) => {
    const indices = new Set<number>();
    let previousIndex = 0;
    for (const [index, decision] of receipt.decisions.entries()) {
      if (indices.has(decision.episode_index)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["decisions", index, "episode_index"],
          message: `Duplicate episode index ${decision.episode_index}`,
        });
      }
      if (index > 0 && decision.episode_index <= previousIndex) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["decisions", index, "episode_index"],
          message: "Receipt decisions must be in increasing episode order",
        });
      }
      indices.add(decision.episode_index);
      previousIndex = decision.episode_index;
    }

    const expectedSummary = {
      total: receipt.decisions.length,
      accepted: receipt.decisions.filter((decision) => decision.disposition === "ACCEPT").length,
      revise: receipt.decisions.filter((decision) => decision.disposition === "REVISE").length,
      rejected: receipt.decisions.filter((decision) => decision.disposition === "REJECT").length,
    };
    for (const key of Object.keys(expectedSummary) as Array<keyof typeof expectedSummary>) {
      if (receipt.summary[key] !== expectedSummary[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["summary", key],
          message: `Receipt summary ${key} does not match decisions`,
        });
      }
    }
  });

export type StoryRoomReviewReceipt = z.infer<typeof storyRoomReviewReceiptSchema>;

export interface StoryRoomReviewDecisionInput {
  episodeIndex: number;
  disposition: StoryRoomReviewDisposition;
  note: string;
}

export class StoryRoomReviewError extends Error {
  readonly code:
    | "INVALID_DECISIONS"
    | "CONTEXT_BINDING_REQUIRED"
    | "HASH_UNAVAILABLE";

  constructor(code: StoryRoomReviewError["code"], message: string) {
    super(message);
    this.name = "StoryRoomReviewError";
    this.code = code;
  }
}

export function hasExactStoryRoomReviewContextBinding(
  workspaceContext: StoryRoomWorkspaceContext | null,
  contextBundle: LocalStoryRoomContextBundleEvidence | null,
): boolean {
  return Boolean(
    workspaceContext?.kind === "entry" &&
      contextBundle?.verification === "LOCAL_SELF_HASH_AND_ROUTE_MATCH" &&
      uuidSchema.safeParse(workspaceContext.projectId).success &&
      uuidSchema.safeParse(workspaceContext.subjectId).success &&
      sha256Schema.safeParse(contextBundle.exactFileSha256).success &&
      sha256Schema.safeParse(contextBundle.declaredContentHash).success &&
      sha256Schema.safeParse(contextBundle.recomputedContentHash).success &&
      Number.isInteger(contextBundle.byteLength) &&
      contextBundle.byteLength > 0 &&
      contextBundle.byteLength <= MAX_STORY_ROOM_BINDING_EVIDENCE_BYTES &&
      contextBundle.projectId === workspaceContext.projectId &&
      contextBundle.entryId === workspaceContext.subjectId &&
      contextBundle.declaredContentHash === contextBundle.recomputedContentHash,
  );
}

function normalizeHumanText(value: string): string {
  return value.normalize("NFC").replace(/\r\n?/g, "\n").trim();
}

function decisionForEpisode(
  pack: StoryRoomPack,
  decisionByEpisode: Map<number, StoryRoomReviewDecisionInput>,
) {
  return pack.episodes.map((episode) => {
    const decision = decisionByEpisode.get(episode.episode_index);
    const normalizedNote = decision ? normalizeHumanText(decision.note) : "";
    if (!decision || (decision.disposition !== "ACCEPT" && !normalizedNote)) {
      throw new StoryRoomReviewError(
        "INVALID_DECISIONS",
        `Episode ${episode.episode_index} needs a valid disposition and revise/reject note.`,
      );
    }
    return {
      episode_index: episode.episode_index,
      episode_title: episode.title,
      assigned_test_id: episode.test_id,
      authored_test_id: episode.authored_test?.test_id ?? null,
      episode_result: episode.result,
      disposition: decision.disposition,
      note: normalizedNote,
    };
  });
}

export function buildStoryRoomReviewReceipt(input: {
  preview: LocalStoryRoomPackPreview;
  reviewerLabel: string;
  decisions: readonly StoryRoomReviewDecisionInput[];
  workspaceContext: StoryRoomWorkspaceContext | null;
  contextBundle: LocalStoryRoomContextBundleEvidence | null;
}): StoryRoomReviewReceipt {
  if (
    !input.workspaceContext ||
    !input.contextBundle ||
    !input.contextBundle.entryId ||
    !hasExactStoryRoomReviewContextBinding(input.workspaceContext, input.contextBundle)
  ) {
    throw new StoryRoomReviewError(
      "CONTEXT_BINDING_REQUIRED",
      "A context-bound receipt requires an explicitly selected, self-hash-verified Content Context export matching this Stage B project entry.",
    );
  }
  const workspaceContext = input.workspaceContext;
  const contextBundle = input.contextBundle;
  const decisionByEpisode = new Map(
    input.decisions.map((decision) => [decision.episodeIndex, decision]),
  );
  if (
    decisionByEpisode.size !== input.decisions.length ||
    decisionByEpisode.size !== input.preview.pack.episodes.length
  ) {
    throw new StoryRoomReviewError(
      "INVALID_DECISIONS",
      "A complete receipt requires exactly one decision for every episode.",
    );
  }

  const decisions = decisionForEpisode(input.preview.pack, decisionByEpisode);
  const receipt = {
    schema_version: "filmstack-story-room-review-receipt/v2" as const,
    receipt_state: "LOCAL_REVIEW_DRAFT" as const,
    authority_state: "NO_EXTERNAL_AUTHORITY" as const,
    review_scope: "MICRO_EPISODE_STRUCTURE_ONLY" as const,
    determinism: "SAME_INPUTS_SAME_BYTES" as const,
    reviewer: {
      label: normalizeHumanText(input.reviewerLabel),
      identity_assurance: "SELF_ATTESTED_LOCAL" as const,
    },
    basis: {
      package_id: input.preview.pack.package_id,
      story_room_pack_sha256: input.preview.sha256,
      story_room_pack_verification: "EXACT_BYTES_VERIFIED" as const,
      workspace_context: {
        project_id: workspaceContext.projectId,
        entry_id: workspaceContext.subjectId,
        selected_context_content_hash: contextBundle.declaredContentHash,
        route: {
          origin: "STAGE_B_NAVIGATION_CONTEXT" as const,
          project_id: workspaceContext.projectId,
          subject_id: workspaceContext.subjectId,
          kind: "entry" as const,
          verification: "VALID_SHAPE_UNAUTHENTICATED" as const,
        },
        context_bundle: {
          selection: "EXPLICIT_LOCAL_FILE" as const,
          exact_file_sha256: contextBundle.exactFileSha256,
          byte_length: contextBundle.byteLength,
          project_id: contextBundle.projectId,
          entry_id: contextBundle.entryId,
          declared_content_hash: contextBundle.declaredContentHash,
          recomputed_content_hash: contextBundle.recomputedContentHash,
          verification: "LOCAL_SELF_HASH_AND_ROUTE_MATCH" as const,
        },
        binding_state:
          "LOCAL_CONTEXT_CORRESPONDENCE_VERIFIED_NOT_AUTHORITY" as const,
      },
      feature_baseline: {
        package_id: input.preview.pack.feature_baseline.package_id,
        relationship: input.preview.pack.feature_baseline.relationship,
        feature_scene_outline_sha256:
          input.preview.pack.feature_baseline.feature_scene_outline_sha256,
        feature_package_manifest_sha256:
          input.preview.pack.feature_baseline.feature_package_manifest_sha256,
        verification: input.preview.pack.feature_baseline.binding_state,
      },
      source_status: input.preview.pack.source_status,
      format_relationship: input.preview.pack.format_relationship,
      production_gate: input.preview.pack.production_gate,
    },
    completeness: "COMPLETE" as const,
    summary: {
      total: decisions.length,
      accepted: decisions.filter((decision) => decision.disposition === "ACCEPT").length,
      revise: decisions.filter((decision) => decision.disposition === "REVISE").length,
      rejected: decisions.filter((decision) => decision.disposition === "REJECT").length,
    },
    decisions,
    effects: {
      authoritative_state_change: "NONE" as const,
      feature_package: "UNCHANGED" as const,
      creative_direction: "PROPOSE_ONLY" as const,
      format_relationship: "UNCHANGED_PENDING_HUMAN_DECISION" as const,
      source_admission: "UNCHANGED_DECLARED_NOT_ADMITTED" as const,
      production_gate: "UNCHANGED_PRODUCE_BLOCKED" as const,
      prompt_generation: "BLOCKED" as const,
      persistence: "LOCAL_EXPORT_ONLY" as const,
      upload: false as const,
      provider_call: false as const,
      token_spend: false as const,
      project_commit: false as const,
    },
  };

  const parsed = storyRoomReviewReceiptSchema.safeParse(receipt);
  if (!parsed.success) {
    throw new StoryRoomReviewError(
      "INVALID_DECISIONS",
      `The local receipt is incomplete or invalid. ${parsed.error.issues[0]?.message ?? "Unknown error"}`,
    );
  }
  return parsed.data;
}

export function serializeStoryRoomReviewReceipt(receipt: StoryRoomReviewReceipt): Uint8Array {
  return new TextEncoder().encode(`${canonicalJson(receipt)}\n`);
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256StoryRoomReviewBytes(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new StoryRoomReviewError(
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
