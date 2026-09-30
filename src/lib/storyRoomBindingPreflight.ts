import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import type { LocalStoryRoomPackPreview } from "@/lib/storyRoomPack";
import type { StoryRoomWorkspaceContext } from "@/lib/storyRoomWorkspaceContext";

export const MAX_STORY_ROOM_BINDING_EVIDENCE_BYTES = 16 * 1024 * 1024;

export const STORY_ROOM_BINDING_EVIDENCE_ROLES = [
  "SOURCE_REVISION",
  "FEATURE_SCENE_OUTLINE",
  "FEATURE_PACKAGE_MANIFEST",
] as const;

export type StoryRoomBindingEvidenceRole =
  (typeof STORY_ROOM_BINDING_EVIDENCE_ROLES)[number];

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

const BINDING_REASON_CODES = [
  "CONTEXT_BUNDLE_BINDING_NOT_VERIFIED",
  "FEATURE_PACKAGE_MANIFEST_NOT_VERIFIED",
  "FEATURE_SCENE_OUTLINE_NOT_VERIFIED",
  "SOURCE_REVISION_BYTES_NOT_VERIFIED",
  "SOURCE_REVISION_HASH_NOT_DECLARED",
] as const;

type StoryRoomBindingReasonCode = (typeof BINDING_REASON_CODES)[number];

export type StoryRoomContextBundleVerification =
  | "NOT_SELECTED"
  | "LOCAL_SELF_HASH_AND_ROUTE_MATCH"
  | "SELF_HASH_MISMATCH"
  | "PROJECT_MISMATCH"
  | "SUBJECT_MISMATCH"
  | "DRAFT_SUBJECT_UNBINDABLE"
  | "ROUTE_UNBOUND";

const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Expected a lowercase 64-character SHA-256 hash");

const boundedText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, "Cannot be blank");

const uuidSchema = z.string().uuid();

function hasUnsafeFileNameCharacters(value: string): boolean {
  return (
    value.includes("/") ||
    value.includes("\\") ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    })
  );
}

const boundEvidenceSchema = z
  .object({
    byte_length: z.number().int().positive().max(MAX_STORY_ROOM_BINDING_EVIDENCE_BYTES),
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
    verification: z.enum(["ABSENT_OR_INVALID", "VALID_SHAPE_UNAUTHENTICATED"]),
  })
  .strict();

const contextBundleEvidenceSchema = z
  .object({
    exact_file_sha256: sha256Schema.nullable(),
    byte_length: z
      .number()
      .int()
      .positive()
      .max(MAX_STORY_ROOM_BINDING_EVIDENCE_BYTES)
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

function expectedFeatureVerification(
  evidence: z.infer<typeof featureEvidenceSchema>,
): "NOT_SELECTED" | "EXACT_MATCH" | "MISMATCH" {
  if (!evidence.observed) return "NOT_SELECTED";
  return evidence.observed.sha256 === evidence.expected_sha256 ? "EXACT_MATCH" : "MISMATCH";
}

function expectedSourceVerification(
  source: z.infer<typeof sourceEvidenceSchema>,
): z.infer<typeof sourceEvidenceSchema>["verification"] {
  if (!source.observed) return "NOT_SELECTED";
  if (!source.declared_sha256) return "OBSERVED_UNBOUND_NO_DECLARED_HASH";
  return source.observed.sha256 === source.declared_sha256
    ? "LOCAL_EXACT_HASH_MATCH_NOT_QUARANTINED"
    : "LOCAL_HASH_MISMATCH_NOT_QUARANTINED";
}

function routeIsPresent(route: z.infer<typeof workspaceRouteSchema>): boolean {
  return Boolean(route.project_id && route.subject_id && route.kind);
}

function contextBundleIsSelected(
  bundle: z.infer<typeof contextBundleEvidenceSchema>,
): boolean {
  return Boolean(
    bundle.exact_file_sha256 &&
      bundle.byte_length &&
      bundle.project_id &&
      bundle.declared_content_hash &&
      bundle.recomputed_content_hash,
  );
}

function expectedContextVerification(
  route: z.infer<typeof workspaceRouteSchema>,
  bundle: z.infer<typeof contextBundleEvidenceSchema>,
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
  if (!input.contextVerified) reasons.push("CONTEXT_BUNDLE_BINDING_NOT_VERIFIED");
  if (!input.featureManifestVerified) {
    reasons.push("FEATURE_PACKAGE_MANIFEST_NOT_VERIFIED");
  }
  if (!input.featureSceneVerified) reasons.push("FEATURE_SCENE_OUTLINE_NOT_VERIFIED");
  if (!input.sourceVerified) reasons.push("SOURCE_REVISION_BYTES_NOT_VERIFIED");
  if (!input.sourceDeclared) reasons.push("SOURCE_REVISION_HASH_NOT_DECLARED");
  return reasons.sort();
}

function deriveBindingResult(input: {
  sourceDeclared: boolean;
  sourceVerification: z.infer<typeof sourceEvidenceSchema>["verification"];
  featureSceneVerification: z.infer<typeof featureEvidenceSchema>["verification"];
  featureManifestVerification: z.infer<typeof featureEvidenceSchema>["verification"];
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
    binding_result: z.enum(["REQUIRED_BINDINGS_MATCH", "INCOMPLETE", "MISMATCH"]),
    admission_readiness: z.literal("NOT_EVALUATED"),
    reason_codes: z.array(z.enum(BINDING_REASON_CODES)),
    unavailable_r3_controls: z.array(z.enum(STORY_ROOM_UNAVAILABLE_R3_CONTROLS)).min(1),
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
    for (const key of ["feature_scene_outline", "feature_package_manifest"] as const) {
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
        message: "Source verification does not match the declared and observed hashes",
      });
    }

    const workspace = preflight.basis.workspace_context;
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
    const selectedFieldCount = selectedContextFields.filter((value) => value !== null).length;
    if (selectedFieldCount !== 0 && selectedFieldCount !== selectedContextFields.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["basis", "workspace_context", "context_bundle"],
        message: "Context bundle evidence must be complete or absent",
      });
    }
    const expectedContextState = expectedContextVerification(
      workspace.route,
      contextBundle,
    );
    if (contextBundle.verification !== expectedContextState) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["basis", "workspace_context", "context_bundle", "verification"],
        message: "Context bundle verification does not match its hashes and route",
      });
    }

    const expectedReasonCodes = deriveBindingReasonCodes({
      sourceDeclared: Boolean(source.declared_sha256),
      sourceVerified: source.verification === "LOCAL_EXACT_HASH_MATCH_NOT_QUARANTINED",
      featureSceneVerified:
        preflight.basis.feature_scene_outline.verification === "EXACT_MATCH",
      featureManifestVerified:
        preflight.basis.feature_package_manifest.verification === "EXACT_MATCH",
      contextVerified: contextBundle.verification === "LOCAL_SELF_HASH_AND_ROUTE_MATCH",
    });
    if (
      preflight.reason_codes.length !== expectedReasonCodes.length ||
      preflight.reason_codes.some((reason, index) => reason !== expectedReasonCodes[index])
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
      featureSceneVerification: preflight.basis.feature_scene_outline.verification,
      featureManifestVerification: preflight.basis.feature_package_manifest.verification,
      contextVerification: contextBundle.verification,
    });
    if (preflight.binding_result !== expectedBindingResult) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["binding_result"],
        message: "Binding result does not match the local evidence states",
      });
    }

    const expectedUnavailable = [...STORY_ROOM_UNAVAILABLE_R3_CONTROLS].sort();
    if (
      preflight.unavailable_r3_controls.length !== expectedUnavailable.length ||
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

export interface LocalStoryRoomBindingEvidence {
  role: StoryRoomBindingEvidenceRole;
  fileName: string;
  byteLength: number;
  sha256: string;
  custodyState: "LOCAL_BYTES_OBSERVED_NOT_QUARANTINED";
}

export interface LocalStoryRoomContextBundleEvidence {
  fileName: string;
  exactFileSha256: string;
  byteLength: number;
  projectId: string;
  entryId: string | null;
  declaredContentHash: string;
  recomputedContentHash: string;
  verification: Exclude<StoryRoomContextBundleVerification, "NOT_SELECTED">;
}

export class StoryRoomBindingPreflightError extends Error {
  readonly code:
    | "FILE_TOO_LARGE"
    | "INVALID_FILE_NAME"
    | "EMPTY_FILE"
    | "HASH_UNAVAILABLE"
    | "INVALID_ENCODING"
    | "INVALID_JSON"
    | "INVALID_CONTEXT_BUNDLE"
    | "INVALID_PREFLIGHT";

  constructor(code: StoryRoomBindingPreflightError["code"], message: string) {
    super(message);
    this.name = "StoryRoomBindingPreflightError";
    this.code = code;
  }
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateLocalFile(file: Pick<File, "name" | "size">): void {
  if (!file.name || hasUnsafeFileNameCharacters(file.name) || file.name.length > 255) {
    throw new StoryRoomBindingPreflightError(
      "INVALID_FILE_NAME",
      "Choose a local evidence file with a bounded file name.",
    );
  }
  if (file.size <= 0) {
    throw new StoryRoomBindingPreflightError("EMPTY_FILE", "The selected evidence file is empty.");
  }
  if (file.size > MAX_STORY_ROOM_BINDING_EVIDENCE_BYTES) {
    throw new StoryRoomBindingPreflightError(
      "FILE_TOO_LARGE",
      "The selected evidence file exceeds the 16 MiB local-verifier limit.",
    );
  }
}

async function readAndHashLocalFile(
  file: Pick<File, "name" | "size" | "arrayBuffer">,
): Promise<{ bytes: ArrayBuffer; sha256: string }> {
  validateLocalFile(file);
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength <= 0) {
    throw new StoryRoomBindingPreflightError("EMPTY_FILE", "The selected evidence file is empty.");
  }
  if (bytes.byteLength > MAX_STORY_ROOM_BINDING_EVIDENCE_BYTES) {
    throw new StoryRoomBindingPreflightError(
      "FILE_TOO_LARGE",
      "The selected evidence file exceeds the 16 MiB local-verifier limit.",
    );
  }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new StoryRoomBindingPreflightError(
      "HASH_UNAVAILABLE",
      "This browser cannot compute the required local SHA-256 evidence hash.",
    );
  }
  return { bytes, sha256: bytesToHex(await subtle.digest("SHA-256", bytes)) };
}

export async function readLocalStoryRoomBindingEvidence(
  file: Pick<File, "name" | "size" | "arrayBuffer">,
  role: StoryRoomBindingEvidenceRole,
): Promise<LocalStoryRoomBindingEvidence> {
  const { bytes, sha256 } = await readAndHashLocalFile(file);
  return {
    role,
    fileName: file.name,
    byteLength: bytes.byteLength,
    sha256,
    custodyState: "LOCAL_BYTES_OBSERVED_NOT_QUARANTINED",
  };
}

const contextBundlePayloadSchema = z
  .object({
    project_id: uuidSchema,
    entry_id: uuidSchema.nullable(),
    content_hash: sha256Schema,
  })
  .passthrough();

export async function readLocalStoryRoomContextBundle(
  file: Pick<File, "name" | "size" | "arrayBuffer">,
  workspaceContext: StoryRoomWorkspaceContext | null,
): Promise<LocalStoryRoomContextBundleEvidence> {
  const { bytes, sha256 } = await readAndHashLocalFile(file);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new StoryRoomBindingPreflightError(
      "INVALID_ENCODING",
      "The selected context bundle is not valid UTF-8 JSON.",
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new StoryRoomBindingPreflightError(
      "INVALID_JSON",
      "The selected context bundle is not valid JSON.",
    );
  }
  const parsed = contextBundlePayloadSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new StoryRoomBindingPreflightError(
      "INVALID_CONTEXT_BUNDLE",
      `The selected JSON is not a bounded Content Context bundle. ${parsed.error.issues[0]?.message ?? "Unknown error"}`,
    );
  }

  const { content_hash: declaredContentHash, ...base } = parsed.data;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new StoryRoomBindingPreflightError(
      "HASH_UNAVAILABLE",
      "This browser cannot recompute the context bundle content hash.",
    );
  }
  const canonicalBytes = new TextEncoder().encode(canonicalJson(base));
  const recomputedContentHash = bytesToHex(
    await subtle.digest("SHA-256", canonicalBytes),
  );

  let verification: LocalStoryRoomContextBundleEvidence["verification"];
  if (declaredContentHash !== recomputedContentHash) {
    verification = "SELF_HASH_MISMATCH";
  } else if (!workspaceContext) {
    verification = "ROUTE_UNBOUND";
  } else if (parsed.data.project_id !== workspaceContext.projectId) {
    verification = "PROJECT_MISMATCH";
  } else if (workspaceContext.kind === "draft") {
    verification = "DRAFT_SUBJECT_UNBINDABLE";
  } else if (parsed.data.entry_id !== workspaceContext.subjectId) {
    verification = "SUBJECT_MISMATCH";
  } else {
    verification = "LOCAL_SELF_HASH_AND_ROUTE_MATCH";
  }

  return {
    fileName: file.name,
    exactFileSha256: sha256,
    byteLength: bytes.byteLength,
    projectId: parsed.data.project_id,
    entryId: parsed.data.entry_id,
    declaredContentHash,
    recomputedContentHash,
    verification,
  };
}

function featureVerification(
  expectedSha256: string,
  observed: LocalStoryRoomBindingEvidence | null,
) {
  if (!observed) return "NOT_SELECTED" as const;
  return observed.sha256 === expectedSha256 ? ("EXACT_MATCH" as const) : ("MISMATCH" as const);
}

function sourceVerification(
  declaredSha256: string | null,
  observed: LocalStoryRoomBindingEvidence | null,
) {
  if (!observed) return "NOT_SELECTED" as const;
  if (!declaredSha256) return "OBSERVED_UNBOUND_NO_DECLARED_HASH" as const;
  return observed.sha256 === declaredSha256
    ? ("LOCAL_EXACT_HASH_MATCH_NOT_QUARANTINED" as const)
    : ("LOCAL_HASH_MISMATCH_NOT_QUARANTINED" as const);
}

function assertEvidenceRole(
  evidence: LocalStoryRoomBindingEvidence | null,
  expectedRole: StoryRoomBindingEvidenceRole,
) {
  if (evidence && evidence.role !== expectedRole) {
    throw new StoryRoomBindingPreflightError(
      "INVALID_PREFLIGHT",
      `Local evidence role ${evidence.role} cannot satisfy ${expectedRole}.`,
    );
  }
}

function toBoundEvidence(evidence: LocalStoryRoomBindingEvidence) {
  return boundEvidenceSchema.parse({
    byte_length: evidence.byteLength,
    sha256: evidence.sha256,
    custody_state: evidence.custodyState,
  });
}

export function buildStoryRoomBindingPreflight(input: {
  preview: LocalStoryRoomPackPreview;
  workspaceContext: StoryRoomWorkspaceContext | null;
  evidence?: Partial<Record<StoryRoomBindingEvidenceRole, LocalStoryRoomBindingEvidence>>;
  contextBundle?: LocalStoryRoomContextBundleEvidence | null;
}): StoryRoomBindingPreflight {
  const source = input.evidence?.SOURCE_REVISION ?? null;
  const featureScene = input.evidence?.FEATURE_SCENE_OUTLINE ?? null;
  const featureManifest = input.evidence?.FEATURE_PACKAGE_MANIFEST ?? null;
  assertEvidenceRole(source, "SOURCE_REVISION");
  assertEvidenceRole(featureScene, "FEATURE_SCENE_OUTLINE");
  assertEvidenceRole(featureManifest, "FEATURE_PACKAGE_MANIFEST");

  const sourceDeclared = input.preview.pack.source.revision_sha256 ?? null;
  const featureSceneState = featureVerification(
    input.preview.pack.feature_baseline.feature_scene_outline_sha256,
    featureScene,
  );
  const featureManifestState = featureVerification(
    input.preview.pack.feature_baseline.feature_package_manifest_sha256,
    featureManifest,
  );
  const sourceState = sourceVerification(sourceDeclared, source);
  const contextBundle = input.contextBundle ?? null;
  const contextVerification = contextBundle?.verification ?? "NOT_SELECTED";
  const bindingResult = deriveBindingResult({
    sourceDeclared: Boolean(sourceDeclared),
    sourceVerification: sourceState,
    featureSceneVerification: featureSceneState,
    featureManifestVerification: featureManifestState,
    contextVerification,
  });

  const preflight = {
    schema_version: "filmstack-story-room-binding-preflight/v1" as const,
    preflight_state: "LOCAL_VERIFICATION_ONLY" as const,
    authority_state: "NO_EXTERNAL_AUTHORITY" as const,
    purpose: "ADMISSION_INPUT_BINDING_PREFLIGHT_ONLY" as const,
    basis: {
      package_id: input.preview.pack.package_id,
      story_room_pack_sha256: input.preview.sha256,
      story_room_pack_verification: "EXACT_BYTES_VERIFIED" as const,
      source: {
        declared_sha256: sourceDeclared,
        observed: source ? toBoundEvidence(source) : null,
        verification: sourceState,
      },
      feature_scene_outline: {
        expected_sha256: input.preview.pack.feature_baseline.feature_scene_outline_sha256,
        observed: featureScene ? toBoundEvidence(featureScene) : null,
        verification: featureSceneState,
      },
      feature_package_manifest: {
        expected_sha256: input.preview.pack.feature_baseline.feature_package_manifest_sha256,
        observed: featureManifest ? toBoundEvidence(featureManifest) : null,
        verification: featureManifestState,
      },
      workspace_context: {
        route: {
          project_id: input.workspaceContext?.projectId ?? null,
          subject_id: input.workspaceContext?.subjectId ?? null,
          kind: input.workspaceContext?.kind ?? null,
          origin: "STAGE_B_NAVIGATION_CONTEXT" as const,
          verification: input.workspaceContext
            ? ("VALID_SHAPE_UNAUTHENTICATED" as const)
            : ("ABSENT_OR_INVALID" as const),
        },
        context_bundle: contextBundle
          ? {
              exact_file_sha256: contextBundle.exactFileSha256,
              byte_length: contextBundle.byteLength,
              project_id: contextBundle.projectId,
              entry_id: contextBundle.entryId,
              declared_content_hash: contextBundle.declaredContentHash,
              recomputed_content_hash: contextBundle.recomputedContentHash,
              verification: contextBundle.verification,
            }
          : {
              exact_file_sha256: null,
              byte_length: null,
              project_id: null,
              entry_id: null,
              declared_content_hash: null,
              recomputed_content_hash: null,
              verification: "NOT_SELECTED" as const,
            },
        authoritative_context_hash: null,
      },
    },
    binding_result: bindingResult,
    admission_readiness: "NOT_EVALUATED" as const,
    reason_codes: deriveBindingReasonCodes({
      sourceDeclared: Boolean(sourceDeclared),
      sourceVerified: sourceState === "LOCAL_EXACT_HASH_MATCH_NOT_QUARANTINED",
      featureSceneVerified: featureSceneState === "EXACT_MATCH",
      featureManifestVerified: featureManifestState === "EXACT_MATCH",
      contextVerified: contextVerification === "LOCAL_SELF_HASH_AND_ROUTE_MATCH",
    }),
    unavailable_r3_controls: [...STORY_ROOM_UNAVAILABLE_R3_CONTROLS].sort(),
    kernel_boundary: {
      operation: "ADMIT_SOURCE_REVISION" as const,
      risk_tier: "R3" as const,
      admission_candidate_creation: "NOT_PERFORMED" as const,
      admission_proposal_creation: "NOT_PERFORMED" as const,
      kernel_submission: "NOT_PERFORMED" as const,
      admission_record_creation: "NOT_PERFORMED" as const,
    },
    effects: {
      authoritative_state_change: "NONE" as const,
      source_admission: "NOT_PERFORMED" as const,
      feature_package: "UNCHANGED" as const,
      production_gate: "UNCHANGED_PRODUCE_BLOCKED" as const,
      persistence: "NONE" as const,
      upload: false as const,
      provider_call: false as const,
      token_spend: false as const,
      project_commit: false as const,
    },
  };

  const parsed = storyRoomBindingPreflightSchema.safeParse(preflight);
  if (!parsed.success) {
    throw new StoryRoomBindingPreflightError(
      "INVALID_PREFLIGHT",
      `The local binding preflight is invalid. ${parsed.error.issues[0]?.message ?? "Unknown error"}`,
    );
  }
  return parsed.data;
}

export function serializeStoryRoomBindingPreflight(
  preflight: StoryRoomBindingPreflight,
): string {
  const parsed = storyRoomBindingPreflightSchema.safeParse(preflight);
  if (!parsed.success) {
    throw new StoryRoomBindingPreflightError(
      "INVALID_PREFLIGHT",
      `The local binding preflight is invalid. ${parsed.error.issues[0]?.message ?? "Unknown error"}`,
    );
  }
  return `${canonicalJson(parsed.data)}\n`;
}
