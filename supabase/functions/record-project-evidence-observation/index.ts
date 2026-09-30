// record-project-evidence-observation
//
// Authenticated R1 lane for recording exact local Story Room / storyboard
// review evidence. The write is an append-only, non-authoritative observation;
// it does not create a project artifact, admit source, change canon/lifecycle,
// clear PRODUCE_BLOCKED, call a model, or spend tokens.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "npm:zod@3.25.76";
import {
  requireProjectEntryAccess,
  requireUser,
} from "../_shared/auth.ts";
import {
  MAX_PROJECT_EVIDENCE_BYTES,
  PERSISTABLE_PROJECT_EVIDENCE_RECORD_KINDS,
  PROJECT_EVIDENCE_SCHEMA_VERSION_BY_KIND,
  ProjectEvidenceSchemaError,
  assertProjectEvidenceExpectedSerialization,
  assertProjectEvidenceTargetCorrespondence,
  parseProjectEvidenceText,
  type ProjectEvidenceRecordKind,
} from "../_shared/project-evidence-schema.ts";
import { classifyProjectEvidenceDatabaseError } from "../_shared/project-evidence-errors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{16,200}$/;
const MAX_BASE64_LENGTH = Math.ceil(MAX_PROJECT_EVIDENCE_BYTES / 3) * 4;
const MAX_REQUEST_BYTES = MAX_BASE64_LENGTH + 16_384;
const PERSISTENCE_EFFECTS = [
  "NONE_IDEMPOTENT_REPLAY",
  "IDEMPOTENCY_REQUEST_APPENDED_REUSING_EXACT_OBSERVATION",
  "EVIDENCE_OBSERVATION_AND_IDEMPOTENCY_REQUEST_APPENDED",
] as const;

const persistenceResultSchema = z
  .object({
    observation_id: z.string().uuid(),
    local_sha256: z.string().regex(SHA256_PATTERN),
    envelope_sha256: z.string().regex(SHA256_PATTERN),
    observation_state: z.literal("RECORDED_NON_AUTHORITATIVE"),
    recording_base_hash: z.string().regex(SHA256_PATTERN),
    replayed: z.boolean(),
    reused_exact_observation: z.boolean(),
    persistence_effect: z.enum(PERSISTENCE_EFFECTS),
  })
  .strict();

const requestSchema = z
  .object({
    schema_version: z.literal(
      "filmstack-project-evidence-observation-request/v1",
    ),
    project_id: z.string().uuid(),
    entry_id: z.string().uuid(),
    context_bundle_id: z.string().uuid(),
    expected_context_payload_hash: z.string().regex(SHA256_PATTERN),
    expected_recording_base_hash: z.string().regex(SHA256_PATTERN),
    record_kind: z.enum(PERSISTABLE_PROJECT_EVIDENCE_RECORD_KINDS),
    local_schema_version: z.enum([
      "filmstack-story-room-review-receipt/v2",
      "filmstack-storyboard-review-receipt/v2",
      "filmstack-story-room-binding-preflight/v1",
    ]),
    exact_bytes_base64: z.string().min(4).max(MAX_BASE64_LENGTH),
    expected_local_byte_length: z
      .number()
      .int()
      .positive()
      .max(MAX_PROJECT_EVIDENCE_BYTES),
    expected_local_sha256: z.string().regex(SHA256_PATTERN),
    idempotency_key: z.string().regex(IDEMPOTENCY_PATTERN),
  })
  .strict()
  .superRefine((request, ctx) => {
    const expectedSchema =
      PROJECT_EVIDENCE_SCHEMA_VERSION_BY_KIND[request.record_kind];
    if (request.local_schema_version !== expectedSchema) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["local_schema_version"],
        message: "The local schema does not match the selected record kind.",
      });
    }
  });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeCanonicalBase64(value: string): Uint8Array {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new Error("INVALID_BASE64");
  }

  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error("INVALID_BASE64");
  }
  if (btoa(binary) !== value) throw new Error("INVALID_BASE64");

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") ?? "")) {
    return json({ error: "application_json_required" }, 415);
  }

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return json({ error: "request_too_large" }, 413);
  }

  const auth = await requireUser(req, corsHeaders);
  if (auth instanceof Response) return auth;

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return json({ error: "invalid_request_body" }, 400);
  }
  if (new TextEncoder().encode(bodyText).byteLength > MAX_REQUEST_BYTES) {
    return json({ error: "request_too_large" }, 413);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(bodyText);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsedRequest = requestSchema.safeParse(raw);
  if (!parsedRequest.success) {
    return json(
      {
        error: "invalid_evidence_request",
        issues: parsedRequest.error.issues.slice(0, 5).map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      400,
    );
  }
  const request = parsedRequest.data;

  const access = await requireProjectEntryAccess(
    auth.admin,
    auth.userId,
    { projectId: request.project_id, entryId: request.entry_id },
    corsHeaders,
  );
  if (access instanceof Response) return access;

  let exactBytes: Uint8Array;
  let exactText: string;
  try {
    exactBytes = decodeCanonicalBase64(request.exact_bytes_base64);
    if (
      exactBytes.byteLength <= 0 ||
      exactBytes.byteLength > MAX_PROJECT_EVIDENCE_BYTES ||
      exactBytes.byteLength !== request.expected_local_byte_length
    ) {
      return json({ error: "local_byte_length_mismatch" }, 400);
    }
    exactText = new TextDecoder("utf-8", { fatal: true }).decode(exactBytes);
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error && error.message === "INVALID_BASE64"
            ? "invalid_base64"
            : "invalid_utf8",
      },
      400,
    );
  }

  const observedSha256 = await sha256Hex(exactBytes);
  if (observedSha256 !== request.expected_local_sha256) {
    return json({ error: "local_sha256_mismatch" }, 400);
  }

  try {
    const record = parseProjectEvidenceText(
      request.record_kind,
      request.local_schema_version,
      exactText,
    );
    assertProjectEvidenceExpectedSerialization(
      request.record_kind as ProjectEvidenceRecordKind,
      record.parsedJson,
      exactText,
    );
    assertProjectEvidenceTargetCorrespondence(record, {
      projectId: request.project_id,
      entryId: request.entry_id,
      contextPayloadHash: request.expected_context_payload_hash,
    });
  } catch (error) {
    if (error instanceof ProjectEvidenceSchemaError) {
      return json(
        {
          error: "invalid_local_evidence",
          code: error.code,
          issues: error.issues.slice(0, 5).map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    }
    return json({ error: "invalid_local_evidence" }, 400);
  }

  const { data, error } = await auth.admin.rpc(
    "record_project_evidence_observation_v1",
    {
      p_project_id: request.project_id,
      p_entry_id: request.entry_id,
      p_context_bundle_id: request.context_bundle_id,
      p_expected_context_payload_hash:
        request.expected_context_payload_hash,
      p_expected_recording_base_hash: request.expected_recording_base_hash,
      p_record_kind: request.record_kind,
      p_local_schema_version: request.local_schema_version,
      p_local_exact_bytes_base64: request.exact_bytes_base64,
      p_expected_local_byte_length: request.expected_local_byte_length,
      p_expected_local_sha256: request.expected_local_sha256,
      p_idempotency_key: request.idempotency_key,
      p_recorded_by: auth.userId,
    },
  );

  if (error) {
    const classified = classifyProjectEvidenceDatabaseError(error.message);
    return json({ error: classified.error }, classified.status);
  }

  const parsedResult = persistenceResultSchema.safeParse(
    Array.isArray(data) ? data[0] : data,
  );
  if (!parsedResult.success) {
    return json({ error: "invalid_persistence_result" }, 502);
  }
  const result = parsedResult.data;

  return json({
    schema_version: "filmstack-project-evidence-observation-response/v1",
    observation_id: result.observation_id,
    observation_state: "RECORDED_NON_AUTHORITATIVE",
    authority_state: "NO_EXTERNAL_AUTHORITY",
    local_sha256: result.local_sha256,
    envelope_sha256: result.envelope_sha256,
    recording_base_hash: result.recording_base_hash,
    replayed: result.replayed === true,
    reused_exact_observation: result.reused_exact_observation === true,
    effects: {
      persistent_state_change: result.persistence_effect,
      authoritative_project_state_change: "NONE",
      project_artifact_creation: "NOT_PERFORMED",
      source_admission: "NOT_PERFORMED",
      admission_candidate_creation: "NOT_PERFORMED",
      lifecycle_transition: "NOT_PERFORMED",
      production_gate: "UNCHANGED_PRODUCE_BLOCKED",
      provider_call: false,
      token_spend: false,
    },
  });
});
