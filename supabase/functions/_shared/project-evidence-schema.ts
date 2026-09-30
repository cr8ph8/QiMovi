import { z } from "npm:zod@3.25.76";

/**
 * Server-side validation for local, non-authoritative production-review evidence.
 *
 * These records remain evidence of a local review/preflight. Parsing or storing one
 * must not upgrade its authority, admit source material, change canon, or clear the
 * production gate.
 */

export const MAX_PROJECT_EVIDENCE_BYTES = 2 * 1024 * 1024;

export const PROJECT_EVIDENCE_RECORD_KINDS = [
  "STORY_ROOM_REVIEW_RECEIPT",
  "STORYBOARD_REVIEW_RECEIPT",
  "STORY_ROOM_BINDING_PREFLIGHT",
] as const;

export const PERSISTABLE_PROJECT_EVIDENCE_RECORD_KINDS = [
  "STORY_ROOM_REVIEW_RECEIPT",
  "STORYBOARD_REVIEW_RECEIPT",
  "STORY_ROOM_BINDING_PREFLIGHT",
] as const;

export type PersistableProjectEvidenceRecordKind =
  (typeof PERSISTABLE_PROJECT_EVIDENCE_RECORD_KINDS)[number];

export type ProjectEvidenceRecordKind =
  (typeof PROJECT_EVIDENCE_RECORD_KINDS)[number];

export const PROJECT_EVIDENCE_SCHEMA_VERSION_BY_KIND = {
  STORY_ROOM_REVIEW_RECEIPT: "filmstack-story-room-review-receipt/v2",
  STORYBOARD_REVIEW_RECEIPT: "filmstack-storyboard-review-receipt/v2",
  STORY_ROOM_BINDING_PREFLIGHT:
    "filmstack-story-room-binding-preflight/v1",
} as const satisfies Record<ProjectEvidenceRecordKind, string>;

export type ProjectEvidenceSchemaVersion =
  (typeof PROJECT_EVIDENCE_SCHEMA_VERSION_BY_KIND)[ProjectEvidenceRecordKind];

export const PROJECT_EVIDENCE_KIND_BY_SCHEMA_VERSION = {
  "filmstack-story-room-review-receipt/v2": "STORY_ROOM_REVIEW_RECEIPT",
  "filmstack-storyboard-review-receipt/v2": "STORYBOARD_REVIEW_RECEIPT",
  "filmstack-story-room-binding-preflight/v1":
    "STORY_ROOM_BINDING_PREFLIGHT",
} as const satisfies Record<ProjectEvidenceSchemaVersion, ProjectEvidenceRecordKind>;

export const STORY_ROOM_UNAVAILABLE_R3_CONTROLS = [
  "ACTIVE_POLICY_BINDING_UNAVAILABLE",
  "ADMISSION_CANDIDATE_UNAVAILABLE",
  "ADMITTED_EVIDENCE_ENVELOPE_UNAVAILABLE",
  "AUTHENTICATED_ADMITTING_ACTOR_UNAVAILABLE",
  "CREATIVE_APPROVAL_RECORD_UNAVAILABLE",
  "INTENTIONAL_EXPORT_ATTESTATION_UNAVAILABLE",
  "ISOLATED_R3_TRANSACTION_NOT_INVOKED",
  "OPERATION_SPECIFIC_VERIFIER_RECEIPTS_UNAVAILABLE",
  "PROPOSAL_AND_IDEMPOTENCY_BINDING_UNAVAILABLE",
  "RIGHTS_BASIS_RECORD_UNAVAILABLE",
  "SOURCE_AUTHORITY_RECORD_UNAVAILABLE",
  "SOURCE_OBSERVATION_AND_TECHNICAL_REPORT_UNAVAILABLE",
  "STABLE_TITLE_BASE_STATE_UNAVAILABLE",
  "TITLE_REVISION_IDENTITY_RECORD_UNAVAILABLE",
  "TRUSTED_STORAGE_RELOAD_AND_CAS_UNAVAILABLE",
] as const;

const STORY_ROOM_RESULTS = [
  "PASS",
  "FAIL",
  "UNKNOWN",
  "REJECTED",
  "PENDING",
  "INCOMPLETE",
] as const;

const BINDING_REASON_CODES = [
  "CONTEXT_BUNDLE_BINDING_NOT_VERIFIED",
  "FEATURE_PACKAGE_MANIFEST_NOT_VERIFIED",
  "FEATURE_SCENE_OUTLINE_NOT_VERIFIED",
  "SOURCE_REVISION_BYTES_NOT_VERIFIED",
  "SOURCE_REVISION_HASH_NOT_DECLARED",
] as const;

type StoryRoomBindingReasonCode = (typeof BINDING_REASON_CODES)[number];

type StoryRoomContextBundleVerification =
  | "NOT_SELECTED"
  | "LOCAL_SELF_HASH_AND_ROUTE_MATCH"
  | "SELF_HASH_MISMATCH"
  | "PROJECT_MISMATCH"
  | "SUBJECT_MISMATCH"
  | "DRAFT_SUBJECT_UNBINDABLE"
  | "ROUTE_UNBOUND";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const sha256Schema = z
  .string()
  .regex(SHA256_PATTERN, "Expected a lowercase 64-character SHA-256 hash");
const uuidSchema = z.string().uuid();

const boundedText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, "Cannot be blank");

const boundedTextArray = (maxItems: number, maxLength: number) =>
  z.array(boundedText(maxLength)).max(maxItems);

function addSummaryIssues(
  ctx: z.RefinementCtx,
  summary: Record<string, number>,
  expected: Record<string, number>,
): void {
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (summary[key] !== expectedValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary", key],
        message: `Receipt summary ${key} does not match decisions`,
      });
    }
  }
}

// ── Story Room review receipt ─────────────────────────────────────────────

const storyRoomReviewDecisionSchema = z
  .object({
    episode_index: z.number().int().positive().max(10_000),
    episode_title: boundedText(500),
    assigned_test_id: boundedText(100),
    authored_test_id: boundedText(100).nullable(),
    episode_result: z.enum(STORY_ROOM_RESULTS),
    disposition: z.enum(["ACCEPT", "REVISE", "REJECT"]),
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

const storyRoomReviewWorkspaceContextSchema = z
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
          .max(16 * 1024 * 1024),
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
    const projectIds = [
      workspace.project_id,
      workspace.route.project_id,
      workspace.context_bundle.project_id,
    ];
    if (projectIds.some((projectId) => projectId !== workspace.project_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["project_id"],
        message: "Story Room review project bindings must match",
      });
    }

    const entryIds = [
      workspace.entry_id,
      workspace.route.subject_id,
      workspace.context_bundle.entry_id,
    ];
    if (entryIds.some((entryId) => entryId !== workspace.entry_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entry_id"],
        message: "Story Room review entry bindings must match",
      });
    }

    const contextHashes = [
      workspace.selected_context_content_hash,
      workspace.context_bundle.declared_content_hash,
      workspace.context_bundle.recomputed_content_hash,
    ];
    if (
      contextHashes.some(
        (contextHash) =>
          contextHash !== workspace.selected_context_content_hash,
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selected_context_content_hash"],
        message: "Story Room review context hashes must match",
      });
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
        feature_baseline: z
          .object({
            package_id: boundedText(200),
            relationship: z.literal("DOES_NOT_SUPERSEDE"),
            feature_scene_outline_sha256: sha256Schema,
            feature_package_manifest_sha256: sha256Schema,
            verification: z.literal(
              "DECLARED_IN_EXACT_PACK_NOT_REVERIFIED",
            ),
          })
          .strict(),
        source_status: z.literal("DECLARED_NOT_ADMITTED"),
        format_relationship: z.literal("PENDING_HUMAN_DECISION"),
        production_gate: z.literal("PRODUCE_BLOCKED"),
        workspace_context: storyRoomReviewWorkspaceContextSchema,
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
    decisions: z.array(storyRoomReviewDecisionSchema).min(1).max(24),
    effects: z
      .object({
        authoritative_state_change: z.literal("NONE"),
        feature_package: z.literal("UNCHANGED"),
        creative_direction: z.literal("PROPOSE_ONLY"),
        format_relationship: z.literal(
          "UNCHANGED_PENDING_HUMAN_DECISION",
        ),
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
    const episodeIndices = new Set<number>();
    let previousEpisodeIndex = 0;
    for (const [index, decision] of receipt.decisions.entries()) {
      if (episodeIndices.has(decision.episode_index)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["decisions", index, "episode_index"],
          message: `Duplicate episode index ${decision.episode_index}`,
        });
      }
      if (index > 0 && decision.episode_index <= previousEpisodeIndex) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["decisions", index, "episode_index"],
          message: "Receipt decisions must be in increasing episode order",
        });
      }
      episodeIndices.add(decision.episode_index);
      previousEpisodeIndex = decision.episode_index;
    }

    addSummaryIssues(ctx, receipt.summary, {
      total: receipt.decisions.length,
      accepted: receipt.decisions.filter(
        (decision) => decision.disposition === "ACCEPT",
      ).length,
      revise: receipt.decisions.filter(
        (decision) => decision.disposition === "REVISE",
      ).length,
      rejected: receipt.decisions.filter(
        (decision) => decision.disposition === "REJECT",
      ).length,
    });
  });

export type StoryRoomReviewReceipt = z.infer<
  typeof storyRoomReviewReceiptSchema
>;

// ── Storyboard review receipt ──────────────────────────────────────────────

const storyboardCropSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

const storyboardCandidateSchema = z
  .object({
    kind: z.enum(["CONTACT_SHEET_PANEL", "STANDALONE_IMAGE"]),
    file_name: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[^/\\]+\.png$/i, "Expected a basename-only PNG file name"),
    asset_sha256: sha256Schema,
    pixel_width: z.number().int().positive().max(32_768),
    pixel_height: z.number().int().positive().max(32_768),
    panel: z.number().int().positive().max(10_000).optional(),
    crop: storyboardCropSchema.optional(),
  })
  .strict()
  .superRefine((candidate, ctx) => {
    if (
      candidate.kind === "CONTACT_SHEET_PANEL" &&
      (!candidate.panel || !candidate.crop)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["crop"],
        message: "Contact-sheet candidates require a panel number and crop rectangle",
      });
    }
    if (
      candidate.kind === "STANDALONE_IMAGE" &&
      (candidate.panel || candidate.crop)
    ) {
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

const storyboardReviewDecisionSchema = z
  .object({
    frame_id: boundedText(200),
    scene_index: z.number().int().positive().max(10_000),
    shot: boundedText(80),
    base_shot_sha256: sha256Schema,
    base_shot_verification: z.literal("DECLARED_ONLY_NOT_VERIFIED"),
    candidate: storyboardCandidateSchema,
    candidate_asset_verification: z.literal("EXACT_BYTES_VERIFIED"),
    disposition: z.enum(["ACCEPT", "REPAIR", "REJECT"]),
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

const storyboardBindingVerificationSchema = z.enum([
  "EXACT_BYTES_VERIFIED",
  "MATCHED_PACK_DECLARATION",
  "DECLARED_ONLY_NOT_VERIFIED",
]);

export const storyboardReviewReceiptSchema = z
  .object({
    schema_version: z.literal("filmstack-storyboard-review-receipt/v2"),
    receipt_id: boundedText(200),
    created_at: z.string().datetime({ offset: true }),
    receipt_state: z.literal("LOCAL_REVIEW_DRAFT"),
    authority_state: z.literal("NO_EXTERNAL_AUTHORITY"),
    review_scope: z.literal(
      "INTERNAL_PREVISUALIZATION_SELECT_FOR_V0_4_ONLY",
    ),
    reviewer: z
      .object({
        label: boundedText(200),
        identity_assurance: z.literal("SELF_ATTESTED_LOCAL"),
      })
      .strict(),
    basis: z
      .object({
        package_id: boundedText(500),
        preproduction_pack_sha256: sha256Schema,
        review_basis_sha256: sha256Schema,
        board_register_sha256: sha256Schema,
        acceptance_matrix_sha256: sha256Schema,
        context_hash: sha256Schema,
        source_revision_hash: sha256Schema,
        source_status: z.literal("DECLARED_NOT_ADMITTED"),
        verification: z
          .object({
            preproduction_pack: z.literal("EXACT_BYTES_VERIFIED"),
            review_basis: z.literal("EXACT_BYTES_VERIFIED"),
            board_register: z.literal("DECLARED_ONLY_NOT_VERIFIED"),
            acceptance_matrix: z.literal("DECLARED_ONLY_NOT_VERIFIED"),
            context_hash: storyboardBindingVerificationSchema,
            source_revision: z.literal("DECLARED_ONLY_NOT_VERIFIED"),
          })
          .strict(),
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
    decisions: z.array(storyboardReviewDecisionSchema).min(1).max(64),
    effects: z
      .object({
        authoritative_state_change: z.literal("NONE"),
        assembly: z.literal("PROPOSE_ONLY"),
        source_admission: z.literal("UNCHANGED_PENDING_HUMAN_ADMISSION"),
        production_gate: z.literal("UNCHANGED_PRODUCE_BLOCKED"),
        motion_generation: z.literal("BLOCKED"),
        persistence: z.literal("LOCAL_EXPORT_ONLY"),
        upload: z.literal(false),
        provider_call: z.literal(false),
        token_spend: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((receipt, ctx) => {
    const frameIds = new Set<string>();
    const shots = new Set<string>();
    let previousSceneIndex = 0;
    for (const [index, decision] of receipt.decisions.entries()) {
      if (frameIds.has(decision.frame_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["decisions", index, "frame_id"],
          message: `Duplicate frame id ${decision.frame_id}`,
        });
      }
      const normalizedShot = decision.shot.toLocaleLowerCase();
      if (shots.has(normalizedShot)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["decisions", index, "shot"],
          message: `Duplicate shot ${decision.shot}`,
        });
      }
      if (index > 0 && decision.scene_index < previousSceneIndex) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["decisions", index, "scene_index"],
          message: "Storyboard decisions must preserve increasing scene order",
        });
      }
      frameIds.add(decision.frame_id);
      shots.add(normalizedShot);
      previousSceneIndex = decision.scene_index;
    }

    addSummaryIssues(ctx, receipt.summary, {
      total: receipt.decisions.length,
      accepted: receipt.decisions.filter(
        (decision) => decision.disposition === "ACCEPT",
      ).length,
      repair: receipt.decisions.filter(
        (decision) => decision.disposition === "REPAIR",
      ).length,
      rejected: receipt.decisions.filter(
        (decision) => decision.disposition === "REJECT",
      ).length,
    });
  });

export type StoryboardReviewReceipt = z.infer<
  typeof storyboardReviewReceiptSchema
>;

// ── Story Room binding preflight ──────────────────────────────────────────

const boundEvidenceSchema = z
  .object({
    byte_length: z
      .number()
      .int()
      .positive()
      .max(16 * 1024 * 1024),
    sha256: sha256Schema,
    custody_state: z.literal("LOCAL_BYTES_OBSERVED_NOT_QUARANTINED"),
  })
  .strict();

const featureEvidenceSchema = z
  .object({
    expected_sha256: sha256Schema,
    observed: boundEvidenceSchema.nullable(),
    verification: z.enum(["NOT_SELECTED", "EXACT_MATCH", "MISMATCH"]),
  })
  .strict();

const sourceEvidenceSchema = z
  .object({
    declared_sha256: sha256Schema.nullable(),
    observed: boundEvidenceSchema.nullable(),
    verification: z.enum([
      "NOT_SELECTED",
      "LOCAL_EXACT_HASH_MATCH_NOT_QUARANTINED",
      "LOCAL_HASH_MISMATCH_NOT_QUARANTINED",
      "OBSERVED_UNBOUND_NO_DECLARED_HASH",
    ]),
  })
  .strict();

const workspaceRouteSchema = z
  .object({
    project_id: uuidSchema.nullable(),
    subject_id: uuidSchema.nullable(),
    kind: z.enum(["draft", "entry"]).nullable(),
    origin: z.literal("STAGE_B_NAVIGATION_CONTEXT"),
    verification: z.enum([
      "ABSENT_OR_INVALID",
      "VALID_SHAPE_UNAUTHENTICATED",
    ]),
  })
  .strict();

const contextBundleEvidenceSchema = z
  .object({
    exact_file_sha256: sha256Schema.nullable(),
    byte_length: z
      .number()
      .int()
      .positive()
      .max(16 * 1024 * 1024)
      .nullable(),
    project_id: uuidSchema.nullable(),
    entry_id: uuidSchema.nullable(),
    declared_content_hash: sha256Schema.nullable(),
    recomputed_content_hash: sha256Schema.nullable(),
    verification: z.enum([
      "NOT_SELECTED",
      "LOCAL_SELF_HASH_AND_ROUTE_MATCH",
      "SELF_HASH_MISMATCH",
      "PROJECT_MISMATCH",
      "SUBJECT_MISMATCH",
      "DRAFT_SUBJECT_UNBINDABLE",
      "ROUTE_UNBOUND",
    ]),
  })
  .strict();

const workspaceContextSchema = z
  .object({
    route: workspaceRouteSchema,
    context_bundle: contextBundleEvidenceSchema,
    authoritative_context_hash: z.null(),
  })
  .strict();

type FeatureEvidence = z.infer<typeof featureEvidenceSchema>;
type SourceEvidence = z.infer<typeof sourceEvidenceSchema>;
type WorkspaceRoute = z.infer<typeof workspaceRouteSchema>;
type ContextBundleEvidence = z.infer<typeof contextBundleEvidenceSchema>;

function expectedFeatureVerification(
  evidence: FeatureEvidence,
): FeatureEvidence["verification"] {
  if (!evidence.observed) return "NOT_SELECTED";
  return evidence.observed.sha256 === evidence.expected_sha256
    ? "EXACT_MATCH"
    : "MISMATCH";
}

function expectedSourceVerification(
  source: SourceEvidence,
): SourceEvidence["verification"] {
  if (!source.observed) return "NOT_SELECTED";
  if (!source.declared_sha256) return "OBSERVED_UNBOUND_NO_DECLARED_HASH";
  return source.observed.sha256 === source.declared_sha256
    ? "LOCAL_EXACT_HASH_MATCH_NOT_QUARANTINED"
    : "LOCAL_HASH_MISMATCH_NOT_QUARANTINED";
}

function routeIsPresent(route: WorkspaceRoute): boolean {
  return Boolean(route.project_id && route.subject_id && route.kind);
}

function contextBundleIsSelected(bundle: ContextBundleEvidence): boolean {
  return Boolean(
    bundle.exact_file_sha256 &&
      bundle.byte_length &&
      bundle.project_id &&
      bundle.declared_content_hash &&
      bundle.recomputed_content_hash,
  );
}

function expectedContextVerification(
  route: WorkspaceRoute,
  bundle: ContextBundleEvidence,
): StoryRoomContextBundleVerification {
  if (!contextBundleIsSelected(bundle)) return "NOT_SELECTED";
  if (bundle.declared_content_hash !== bundle.recomputed_content_hash) {
    return "SELF_HASH_MISMATCH";
  }
  if (!routeIsPresent(route)) return "ROUTE_UNBOUND";
  if (bundle.project_id !== route.project_id) return "PROJECT_MISMATCH";
  if (route.kind === "draft") return "DRAFT_SUBJECT_UNBINDABLE";
  if (bundle.entry_id !== route.subject_id) return "SUBJECT_MISMATCH";
  return "LOCAL_SELF_HASH_AND_ROUTE_MATCH";
}

function deriveBindingReasonCodes(input: {
  sourceDeclared: boolean;
  sourceVerified: boolean;
  featureSceneVerified: boolean;
  featureManifestVerified: boolean;
  contextVerified: boolean;
}): StoryRoomBindingReasonCode[] {
  const reasons: StoryRoomBindingReasonCode[] = [];
  if (!input.contextVerified) {
    reasons.push("CONTEXT_BUNDLE_BINDING_NOT_VERIFIED");
  }
  if (!input.featureManifestVerified) {
    reasons.push("FEATURE_PACKAGE_MANIFEST_NOT_VERIFIED");
  }
  if (!input.featureSceneVerified) {
    reasons.push("FEATURE_SCENE_OUTLINE_NOT_VERIFIED");
  }
  if (!input.sourceVerified) {
    reasons.push("SOURCE_REVISION_BYTES_NOT_VERIFIED");
  }
  if (!input.sourceDeclared) {
    reasons.push("SOURCE_REVISION_HASH_NOT_DECLARED");
  }
  return reasons.sort();
}

function deriveBindingResult(input: {
  sourceDeclared: boolean;
  sourceVerification: SourceEvidence["verification"];
  featureSceneVerification: FeatureEvidence["verification"];
  featureManifestVerification: FeatureEvidence["verification"];
  contextVerification: StoryRoomContextBundleVerification;
}): "REQUIRED_BINDINGS_MATCH" | "INCOMPLETE" | "MISMATCH" {
  if (
    input.featureSceneVerification === "MISMATCH" ||
    input.featureManifestVerification === "MISMATCH" ||
    (input.sourceDeclared &&
      input.sourceVerification === "LOCAL_HASH_MISMATCH_NOT_QUARANTINED") ||
    ["SELF_HASH_MISMATCH", "PROJECT_MISMATCH", "SUBJECT_MISMATCH"].includes(
      input.contextVerification,
    )
  ) {
    return "MISMATCH";
  }

  const sourceRequirementSatisfied =
    !input.sourceDeclared ||
    input.sourceVerification === "LOCAL_EXACT_HASH_MATCH_NOT_QUARANTINED";
  if (
    sourceRequirementSatisfied &&
    input.featureSceneVerification === "EXACT_MATCH" &&
    input.featureManifestVerification === "EXACT_MATCH" &&
    input.contextVerification === "LOCAL_SELF_HASH_AND_ROUTE_MATCH"
  ) {
    return "REQUIRED_BINDINGS_MATCH";
  }
  return "INCOMPLETE";
}

export const storyRoomBindingPreflightSchema = z
  .object({
    schema_version: z.literal("filmstack-story-room-binding-preflight/v1"),
    preflight_state: z.literal("LOCAL_VERIFICATION_ONLY"),
    authority_state: z.literal("NO_EXTERNAL_AUTHORITY"),
    purpose: z.literal("ADMISSION_INPUT_BINDING_PREFLIGHT_ONLY"),
    basis: z
      .object({
        package_id: boundedText(200),
        story_room_pack_sha256: sha256Schema,
        story_room_pack_verification: z.literal("EXACT_BYTES_VERIFIED"),
        source: sourceEvidenceSchema,
        feature_scene_outline: featureEvidenceSchema,
        feature_package_manifest: featureEvidenceSchema,
        workspace_context: workspaceContextSchema,
      })
      .strict(),
    binding_result: z.enum([
      "REQUIRED_BINDINGS_MATCH",
      "INCOMPLETE",
      "MISMATCH",
    ]),
    admission_readiness: z.literal("NOT_EVALUATED"),
    reason_codes: z.array(z.enum(BINDING_REASON_CODES)),
    unavailable_r3_controls: z
      .array(z.enum(STORY_ROOM_UNAVAILABLE_R3_CONTROLS))
      .min(1),
    kernel_boundary: z
      .object({
        operation: z.literal("ADMIT_SOURCE_REVISION"),
        risk_tier: z.literal("R3"),
        admission_candidate_creation: z.literal("NOT_PERFORMED"),
        admission_proposal_creation: z.literal("NOT_PERFORMED"),
        kernel_submission: z.literal("NOT_PERFORMED"),
        admission_record_creation: z.literal("NOT_PERFORMED"),
      })
      .strict(),
    effects: z
      .object({
        authoritative_state_change: z.literal("NONE"),
        source_admission: z.literal("NOT_PERFORMED"),
        feature_package: z.literal("UNCHANGED"),
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
  .superRefine((preflight, ctx) => {
    for (const key of [
      "feature_scene_outline",
      "feature_package_manifest",
    ] as const) {
      const evidence = preflight.basis[key];
      if (evidence.verification !== expectedFeatureVerification(evidence)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["basis", key, "verification"],
          message: `${key} verification does not match the observed bytes`,
        });
      }
    }

    const source = preflight.basis.source;
    if (source.verification !== expectedSourceVerification(source)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["basis", "source", "verification"],
        message:
          "Source verification does not match the declared and observed hashes",
      });
    }

    const workspace = preflight.basis.workspace_context;
    const routeFields = [
      workspace.route.project_id,
      workspace.route.subject_id,
      workspace.route.kind,
    ];
    const routeFieldCount = routeFields.filter((value) => value !== null).length;
    if (routeFieldCount !== 0 && routeFieldCount !== routeFields.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["basis", "workspace_context", "route"],
        message: "Workspace route must be complete or absent",
      });
    }
    const expectedRouteState = routeIsPresent(workspace.route)
      ? "VALID_SHAPE_UNAUTHENTICATED"
      : "ABSENT_OR_INVALID";
    if (workspace.route.verification !== expectedRouteState) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["basis", "workspace_context", "route", "verification"],
        message: "Route verification overstates the available navigation context",
      });
    }

    const contextBundle = workspace.context_bundle;
    const selectedContextFields = [
      contextBundle.exact_file_sha256,
      contextBundle.byte_length,
      contextBundle.project_id,
      contextBundle.declared_content_hash,
      contextBundle.recomputed_content_hash,
    ];
    const selectedFieldCount = selectedContextFields.filter(
      (value) => value !== null,
    ).length;
    if (
      selectedFieldCount !== 0 &&
      selectedFieldCount !== selectedContextFields.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["basis", "workspace_context", "context_bundle"],
        message: "Context bundle evidence must be complete or absent",
      });
    }
    if (selectedFieldCount === 0 && contextBundle.entry_id !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["basis", "workspace_context", "context_bundle", "entry_id"],
        message: "An absent context bundle cannot declare an entry id",
      });
    }
    const expectedContextState = expectedContextVerification(
      workspace.route,
      contextBundle,
    );
    if (contextBundle.verification !== expectedContextState) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [
          "basis",
          "workspace_context",
          "context_bundle",
          "verification",
        ],
        message: "Context bundle verification does not match its hashes and route",
      });
    }

    const expectedReasonCodes = deriveBindingReasonCodes({
      sourceDeclared: Boolean(source.declared_sha256),
      sourceVerified:
        source.verification === "LOCAL_EXACT_HASH_MATCH_NOT_QUARANTINED",
      featureSceneVerified:
        preflight.basis.feature_scene_outline.verification === "EXACT_MATCH",
      featureManifestVerified:
        preflight.basis.feature_package_manifest.verification === "EXACT_MATCH",
      contextVerified:
        contextBundle.verification === "LOCAL_SELF_HASH_AND_ROUTE_MATCH",
    });
    if (
      preflight.reason_codes.length !== expectedReasonCodes.length ||
      preflight.reason_codes.some(
        (reason, index) => reason !== expectedReasonCodes[index],
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason_codes"],
        message: "Preflight reason codes are incomplete or not in canonical order",
      });
    }

    const expectedBindingResult = deriveBindingResult({
      sourceDeclared: Boolean(source.declared_sha256),
      sourceVerification: source.verification,
      featureSceneVerification:
        preflight.basis.feature_scene_outline.verification,
      featureManifestVerification:
        preflight.basis.feature_package_manifest.verification,
      contextVerification: contextBundle.verification,
    });
    if (preflight.binding_result !== expectedBindingResult) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["binding_result"],
        message: "Binding result does not match the local evidence states",
      });
    }

    const expectedUnavailable = [
      ...STORY_ROOM_UNAVAILABLE_R3_CONTROLS,
    ].sort();
    if (
      preflight.unavailable_r3_controls.length !==
        expectedUnavailable.length ||
      preflight.unavailable_r3_controls.some(
        (control, index) => control !== expectedUnavailable[index],
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unavailable_r3_controls"],
        message: "Unavailable R3 controls cannot be weakened or reordered",
      });
    }
  });

export type StoryRoomBindingPreflight = z.infer<
  typeof storyRoomBindingPreflightSchema
>;

export const PROJECT_EVIDENCE_SCHEMA_BY_KIND = {
  STORY_ROOM_REVIEW_RECEIPT: storyRoomReviewReceiptSchema,
  STORYBOARD_REVIEW_RECEIPT: storyboardReviewReceiptSchema,
  STORY_ROOM_BINDING_PREFLIGHT: storyRoomBindingPreflightSchema,
} as const satisfies Record<ProjectEvidenceRecordKind, z.ZodTypeAny>;

export interface ProjectEvidenceRecordByKind {
  STORY_ROOM_REVIEW_RECEIPT: StoryRoomReviewReceipt;
  STORYBOARD_REVIEW_RECEIPT: StoryboardReviewReceipt;
  STORY_ROOM_BINDING_PREFLIGHT: StoryRoomBindingPreflight;
}

export type ProjectEvidenceRecord =
  ProjectEvidenceRecordByKind[ProjectEvidenceRecordKind];

export interface ParsedProjectEvidence<
  Kind extends ProjectEvidenceRecordKind = ProjectEvidenceRecordKind,
> {
  recordKind: Kind;
  schemaVersion: (typeof PROJECT_EVIDENCE_SCHEMA_VERSION_BY_KIND)[Kind];
  packageId: string;
  parsedJson: ProjectEvidenceRecordByKind[Kind];
}

export type ProjectEvidenceSchemaErrorCode =
  | "INVALID_RECORD_KIND"
  | "SCHEMA_MISMATCH"
  | "EMPTY_RECORD"
  | "FILE_TOO_LARGE"
  | "INVALID_JSON"
  | "INVALID_RECORD"
  | "NON_CANONICAL_SERIALIZATION"
  | "TARGET_CORRESPONDENCE_FAILURE";

export class ProjectEvidenceSchemaError extends Error {
  readonly code: ProjectEvidenceSchemaErrorCode;
  readonly issues: readonly z.ZodIssue[];

  constructor(
    code: ProjectEvidenceSchemaErrorCode,
    message: string,
    issues: readonly z.ZodIssue[] = [],
  ) {
    super(message);
    this.name = "ProjectEvidenceSchemaError";
    this.code = code;
    this.issues = issues;
  }
}

export interface ProjectEvidenceRecordingTarget {
  projectId: string;
  entryId: string;
  contextPayloadHash: string;
}

/**
 * Prove only that the local record identifies the exact project context chosen
 * for this recording transaction. This is not pack provenance, source
 * admission, creative approval, context-currentness, or production authority.
 */
export function assertProjectEvidenceTargetCorrespondence(
  record: ParsedProjectEvidence,
  target: ProjectEvidenceRecordingTarget,
): void {
  if (record.recordKind === "STORY_ROOM_REVIEW_RECEIPT") {
    const review = record.parsedJson as StoryRoomReviewReceipt;
    const workspace = review.basis.workspace_context;
    if (
      workspace.project_id !== target.projectId ||
      workspace.entry_id !== target.entryId ||
      workspace.selected_context_content_hash !== target.contextPayloadHash ||
      workspace.route.project_id !== target.projectId ||
      workspace.route.subject_id !== target.entryId ||
      workspace.route.kind !== "entry" ||
      workspace.route.verification !== "VALID_SHAPE_UNAUTHENTICATED" ||
      workspace.context_bundle.project_id !== target.projectId ||
      workspace.context_bundle.entry_id !== target.entryId ||
      workspace.context_bundle.declared_content_hash !==
        target.contextPayloadHash ||
      workspace.context_bundle.recomputed_content_hash !==
        target.contextPayloadHash ||
      workspace.context_bundle.verification !==
        "LOCAL_SELF_HASH_AND_ROUTE_MATCH" ||
      workspace.binding_state !==
        "LOCAL_CONTEXT_CORRESPONDENCE_VERIFIED_NOT_AUTHORITY"
    ) {
      throw new ProjectEvidenceSchemaError(
        "TARGET_CORRESPONDENCE_FAILURE",
        "The Story Room review does not match the selected project entry and context snapshot.",
      );
    }
    return;
  }

  if (record.recordKind === "STORYBOARD_REVIEW_RECEIPT") {
    const review = record.parsedJson as StoryboardReviewReceipt;
    if (review.basis.context_hash !== target.contextPayloadHash) {
      throw new ProjectEvidenceSchemaError(
        "TARGET_CORRESPONDENCE_FAILURE",
        "The storyboard review context hash does not match the selected project context.",
      );
    }
    return;
  }

  const preflight = record.parsedJson as StoryRoomBindingPreflight;
  const workspace = preflight.basis.workspace_context;
  if (
    workspace.route.project_id !== target.projectId ||
    workspace.route.subject_id !== target.entryId ||
    workspace.route.kind !== "entry" ||
    workspace.route.verification !== "VALID_SHAPE_UNAUTHENTICATED" ||
    workspace.context_bundle.project_id !== target.projectId ||
    workspace.context_bundle.entry_id !== target.entryId ||
    workspace.context_bundle.declared_content_hash !==
      target.contextPayloadHash ||
    workspace.context_bundle.recomputed_content_hash !==
      target.contextPayloadHash ||
    workspace.context_bundle.verification !==
      "LOCAL_SELF_HASH_AND_ROUTE_MATCH"
  ) {
    throw new ProjectEvidenceSchemaError(
      "TARGET_CORRESPONDENCE_FAILURE",
      "The Story Room preflight does not match the selected project entry and context snapshot.",
    );
  }
}

function isProjectEvidenceRecordKind(
  value: string,
): value is ProjectEvidenceRecordKind {
  return (PROJECT_EVIDENCE_RECORD_KINDS as readonly string[]).includes(value);
}

/**
 * Canonical JSON used by the two deterministic local Story Room records.
 * Object keys are sorted recursively; array order remains significant.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "null";
    return JSON.stringify(value);
  }
  if (typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  return "null";
}

/**
 * Rebuild the exact text shape emitted by the corresponding local exporter.
 * Storyboard v2 deliberately remains pretty-printed; both Story Room records
 * use recursively key-sorted canonical JSON. All three end in one LF byte.
 */
export function expectedProjectEvidenceText(
  recordKind: ProjectEvidenceRecordKind,
  record: unknown,
): string {
  const parsed = PROJECT_EVIDENCE_SCHEMA_BY_KIND[recordKind].safeParse(record);
  if (!parsed.success) {
    throw new ProjectEvidenceSchemaError(
      "INVALID_RECORD",
      `The ${recordKind} record does not match its strict local contract.`,
      parsed.error.issues,
    );
  }
  return recordKind === "STORYBOARD_REVIEW_RECEIPT"
    ? `${JSON.stringify(parsed.data, null, 2)}\n`
    : `${canonicalJson(parsed.data)}\n`;
}

/**
 * Keep exact serialization checking separate from semantic parsing so callers
 * must make the byte-preservation decision explicitly before persistence.
 */
export function assertProjectEvidenceExpectedSerialization(
  recordKind: ProjectEvidenceRecordKind,
  parsedJson: unknown,
  exactText: string,
): void {
  if (exactText !== expectedProjectEvidenceText(recordKind, parsedJson)) {
    throw new ProjectEvidenceSchemaError(
      "NON_CANONICAL_SERIALIZATION",
      `The ${recordKind} text is valid JSON but does not match the exact local exporter serialization.`,
    );
  }
}

/**
 * Parse an exact local JSON record while binding the caller-declared kind and
 * schema version. This validates evidence only; it performs no admission or
 * authoritative state transition.
 */
export function parseProjectEvidenceText(
  recordKind: string,
  declaredSchemaVersion: string,
  text: string,
): ParsedProjectEvidence {
  if (!isProjectEvidenceRecordKind(recordKind)) {
    throw new ProjectEvidenceSchemaError(
      "INVALID_RECORD_KIND",
      "The production-review evidence kind is not allowlisted.",
    );
  }

  const expectedSchemaVersion =
    PROJECT_EVIDENCE_SCHEMA_VERSION_BY_KIND[recordKind];
  if (declaredSchemaVersion !== expectedSchemaVersion) {
    throw new ProjectEvidenceSchemaError(
      "SCHEMA_MISMATCH",
      `The declared schema does not match ${recordKind}.`,
    );
  }

  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength === 0) {
    throw new ProjectEvidenceSchemaError(
      "EMPTY_RECORD",
      "The production-review evidence text is empty.",
    );
  }
  if (byteLength > MAX_PROJECT_EVIDENCE_BYTES) {
    throw new ProjectEvidenceSchemaError(
      "FILE_TOO_LARGE",
      "The production-review evidence text exceeds the 2 MiB limit.",
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectEvidenceSchemaError(
      "INVALID_JSON",
      "The production-review evidence text is not valid JSON.",
    );
  }

  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    (raw as Record<string, unknown>).schema_version !==
      declaredSchemaVersion
  ) {
    throw new ProjectEvidenceSchemaError(
      "SCHEMA_MISMATCH",
      "The JSON schema_version does not match the declared schema.",
    );
  }

  const parsed = PROJECT_EVIDENCE_SCHEMA_BY_KIND[recordKind].safeParse(raw);
  if (!parsed.success) {
    throw new ProjectEvidenceSchemaError(
      "INVALID_RECORD",
      `The ${recordKind} record does not match its strict local contract.`,
      parsed.error.issues,
    );
  }

  const parsedJson = parsed.data as ProjectEvidenceRecord;
  return {
    recordKind,
    schemaVersion: expectedSchemaVersion,
    packageId: parsedJson.basis.package_id,
    parsedJson,
  } as ParsedProjectEvidence;
}
