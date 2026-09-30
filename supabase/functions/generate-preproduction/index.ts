// generate-preproduction — produces a versioned `preproduction_pack` artifact
// with three storyboard-ready tracks (live_action, animation, ai_generation)
// derived from the verified ContentContext bundle. Never reads raw draft text
// directly — always goes through buildContentContext so we inherit hashing,
// governance, and continuity checks.
//
// Tokens: charged via spend-tokens (action=preproduction_generate, default 20).

import { parsePreproductionTracks, parseGeneratedPreproductionContent, serializePreproductionEnvelope, parsePreproductionEnvelope } from "../_shared/preproduction-pack-v2.ts";
import { callAI } from "../_shared/ai-router.ts";
import { logGovernanceAction } from "../_shared/audit.ts";
import {
  hasAdminRole,
  requireProjectEntryAccess,
  requireUser,
} from "../_shared/auth.ts";
import { buildContentContext } from "../_shared/content-context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function sha256Text(text: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}

interface Body {
  entry_id?: string;
  project_id?: string;
  dry_run?: boolean;
  /** Optional subset of tracks. Defaults to all three. */
  tracks?: Array<"live_action" | "animation" | "ai_generation">;
}

const SHOT_SCHEMA = {
  type: "object",
  properties: {
    shot: { type: "string", description: "Shot number, e.g. '1A'" },
    framing: { type: "string", description: "e.g. WIDE, MCU, OTS, INSERT" },
    lens_mm: { type: "number" },
    movement: { type: "string", description: "static / pan / dolly / handheld" },
    description: { type: "string", description: "What we see. 1-2 sentences." },
    beat: { type: "string", description: "Story beat this shot serves" },
  },
  required: ["shot", "framing", "description"],
  additionalProperties: false,
} as const;

const SCENE_BLOCK_SCHEMA = {
  type: "object",
  properties: {
    scene_index: { type: "integer", minimum: 1, maximum: 10000 },
    slug: { type: "string", description: "INT/EXT. LOCATION - TIME" },
    page_estimate: { type: "number" },
    intent: { type: "string" },
    shots: { type: "array", items: SHOT_SCHEMA },
  },
  required: ["scene_index", "slug", "shots"],
  additionalProperties: false,
} as const;

const PREPRO_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "object",
      properties: {
        logline: { type: "string" },
        tone: { type: "string" },
        format: { type: "string", description: "vertical / short / pilot / feature" },
        primary_locations: { type: "array", items: { type: "string" } },
      },
      required: ["logline"],
      additionalProperties: false,
    },
    live_action: {
      type: "object",
      description: "Physical production shooting plan.",
      properties: {
        crew_notes: { type: "string" },
        locations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string", description: "practical / stage / hybrid" },
              scenes: { type: "array", items: { type: "number" } },
              notes: { type: "string" },
            },
            required: ["name", "scenes"],
            additionalProperties: false,
          },
        },
        scenes: { type: "array", items: SCENE_BLOCK_SCHEMA, description: "Ordered scene shot lists (≤40 scenes, ≤10 shots each)." },
      },
      required: ["scenes"],
      additionalProperties: false,
    },
    animation: {
      type: "object",
      description: "Animation-specific plan: character sheets, style, key frames.",
      properties: {
        style_target: { type: "string", description: "e.g. 2D limited / 3D stylized / cel-shaded" },
        character_sheets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              silhouette: { type: "string" },
              palette: { type: "array", items: { type: "string" } },
              expression_range: { type: "array", items: { type: "string" } },
            },
            required: ["name"],
            additionalProperties: false,
          },
        },
        key_frames: {
          type: "array",
          items: {
            type: "object",
            properties: {
              scene_index: { type: "integer", minimum: 1, maximum: 10000 },
              shot: { type: "string", description: "Exact shot label in this scene, e.g. 1A." },
              frame: { type: "string", description: "Frame label, e.g. KF-3A" },
              description: { type: "string" },
              staging: { type: "string" },
            },
            required: ["scene_index", "shot", "frame", "description"],
            additionalProperties: false,
          },
        },
        pipeline_notes: { type: "string", description: "Layout → animation → comp notes." },
      },
      required: ["key_frames"],
      additionalProperties: false,
    },
    ai_generation: {
      type: "object",
      description: "Prompt packs for text-to-image / text-to-video generators, anchored to the bundle hash.",
      properties: {
        style_prompt: { type: "string", description: "Global style anchor (used as suffix on every shot prompt)." },
        negative_prompt: { type: "string" },
        aspect_ratio: { type: "string", description: "e.g. 16:9, 9:16, 2.39:1" },
        continuity_tokens: {
          type: "array",
          description: "Character / location tokens to reuse verbatim across prompts.",
          items: {
            type: "object",
            properties: {
              token: { type: "string" },
              refers_to: { type: "string" },
              description: { type: "string" },
            },
            required: ["token", "refers_to"],
            additionalProperties: false,
          },
        },
        shot_prompts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              scene_index: { type: "integer", minimum: 1, maximum: 10000 },
              shot: { type: "string" },
              image_prompt: { type: "string", description: "Single-line prompt for a still frame." },
              motion_prompt: { type: "string", description: "Optional prompt for a 3-6s video clip." },
              seed_hint: { type: "string" },
            },
            required: ["scene_index", "shot", "image_prompt"],
            additionalProperties: false,
          },
        },
      },
      required: ["style_prompt", "shot_prompts"],
      additionalProperties: false,
    },
    open_questions: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "open_questions"],
  additionalProperties: false,
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { ...corsHeaders, Allow: "POST, OPTIONS" } });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anonKey) {
    return new Response(JSON.stringify({ error: "missing supabase env" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const auth = await requireUser(req, corsHeaders);
  if (auth instanceof Response) return auth;
  const authHeader = `Bearer ${auth.token}`;

  let body: Body;
  let requestedTracks;
  try {
    const text = await req.text();
    if (new TextEncoder().encode(text).byteLength > 16_384) throw new Error("request_too_large");
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid_request");
    const value = raw as Record<string, unknown>;
    if (Object.keys(value).some(key => !["entry_id", "project_id", "dry_run", "tracks"].includes(key))) throw new Error("unknown_request_field");
    if (!value.entry_id && !value.project_id) throw new Error("entry_id or project_id required");
    for (const key of ["entry_id", "project_id"]) {
      if (value[key] !== undefined && (typeof value[key] !== "string" || !UUID.test(value[key] as string))) throw new Error("invalid_identity");
    }
    if (value.dry_run !== undefined && typeof value.dry_run !== "boolean") throw new Error("dry_run must be a boolean");
    requestedTracks = parsePreproductionTracks(value.tracks);
    body = value as Body;
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "invalid_request" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const tracks = new Set(requestedTracks);

  const admin = auth.admin;
  if (body.dry_run && !(await hasAdminRole(admin, auth.userId))) {
    return new Response(JSON.stringify({ error: "Admin access required for dry_run" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const access = await requireProjectEntryAccess(
    admin,
    auth.userId,
    { projectId: body.project_id, entryId: body.entry_id },
    corsHeaders,
  );
  if (access instanceof Response) return access;
  const projectId = access.projectId;

  const { data: current, error: currentError } = await admin.from("project_artifacts")
    .select("id").eq("project_id", projectId).eq("artifact_type", "preproduction_pack")
    .eq("is_current", true).maybeSingle();
  if (currentError) return new Response(JSON.stringify({ error: "current_pack_unavailable" }), {
    status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  const expectedCurrentId = current?.id ?? null;

  // Build canonical ContentContext (the verified spine).
  let builtContext;
  try {
    builtContext = await buildContentContext(
      admin,
      projectId,
      {
        mode: "production",
        task: "preproduction.generate",
        scope: "project",
        model_hint: "google/gemini-3-flash-preview",
      },
      auth.userId,
    );
  } catch (e: any) {
    console.error("[generate-preproduction] context build failed:", e);
    return new Response(JSON.stringify({ error: `context build failed: ${e?.message ?? e}` }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const fountain = builtContext.context.script_text.fountain;
  if (!fountain || fountain.trim().length < 100) {
    return new Response(JSON.stringify({ error: "no screenplay text found for this project" }), {
      status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!builtContext.context.entry_id || !UUID.test(builtContext.context.entry_id)) {
    return new Response(JSON.stringify({ error: "entry_bound_context_required" }), {
      status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // Charge tokens (skip on dry_run).
  if (!body.dry_run) {
    const spend = await fetch(`${url}/functions/v1/spend-tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({
        amount: 20,
        action: "preproduction_generate",
        label: "Preproduction Pack: generate",
        entry_id: body.entry_id ?? undefined,
      }),
    });
    if (!spend.ok) {
      return new Response(await spend.text(), {
        status: spend.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Use only the story plan already captured in this exact ContentContext.
  const storyPlan = builtContext.context.story_plan;

  const trackList = Array.from(tracks).join(", ");
  let structuredOutput: string | null = null;
  let modelId = "google/gemini-3-flash-preview";
  let promptTokens = 0, completionTokens = 0, estCost = 0;
  try {
    const result = await callAI({
      route: { functionName: "generate-preproduction", modelHint: "google/gemini-3-flash-preview" },
      messages: [
        {
          role: "system",
          content:
            "You are a preproduction planner. From the screenplay + optional story plan, produce a storyboard-ready " +
            "preproduction pack for the requested tracks (" + trackList + "). Be concrete, terse, and grounded in the text. " +
            "Number shots per scene (1A, 1B, 1C…). Cap at 40 scenes. Cap at 10 shots per scene. " +
            "For animation, define reusable character sheets and only pick key frames that materially change staging. " +
            "Each keyframe must include scene_index and shot; when live_action is requested, reuse its exact scene and shot label. " +
            "For ai_generation, define continuity_tokens FIRST (e.g. <SARAH>, <DINER>) and REUSE them verbatim in every " +
            "shot prompt so downstream image/video models keep characters and locations consistent. " +
            "Prompts must include lens/framing/lighting cues and end with the style_prompt suffix implicitly (do not repeat it). " +
            "If a track was not requested, omit that top-level key. Use the return_preproduction_pack tool — never return prose.",
        },
        {
          role: "user",
          content:
            (storyPlan ? `Story plan (JSON):\n${JSON.stringify(storyPlan).slice(0, 12000)}\n\n` : "") +
            `Requested tracks: ${trackList}\n\n` +
            `Screenplay text (truncated to first 60k chars):\n\n${fountain.slice(0, 60000)}`,
        },
      ],
      tools: [{
        type: "function",
        function: {
          name: "return_preproduction_pack",
          description: "Return the storyboard-ready preproduction pack as structured JSON.",
          parameters: PREPRO_SCHEMA,
        },
      }],
      tool_choice: { type: "function", function: { name: "return_preproduction_pack" } },
      temperature: 0.3,
      max_completion_tokens: 8000,
      context_ref: { bundle_id: builtContext.bundle_id, payload_hash: builtContext.context_hash },
      meta: {
        userId: auth.userId,
        projectId,
        entryId: builtContext.context.entry_id ?? undefined,
        sensitivity: builtContext.context.sensitivity,
      },
    });
    modelId = result.modelId;
    promptTokens = result.promptTokens ?? 0;
    completionTokens = result.completionTokens ?? 0;
    estCost = result.estimatedCostCents ?? 0;
    const toolCalls = result.raw?.choices?.[0]?.message?.tool_calls;
    if (toolCalls?.[0]?.function?.arguments) {
      structuredOutput = toolCalls[0].function.arguments;
    } else if (result.content) {
      structuredOutput = result.content;
    }
  } catch (e: any) {
    console.error("[generate-preproduction] AI error:", e);
    const status = e.message?.includes("429") ? 429 : e.message?.includes("402") ? 402 : 500;
    return new Response(JSON.stringify({ error: e.message ?? "AI generation failed" }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let envelope;
  let canonicalText: string;
  let payloadSha256: string;
  try {
    if (typeof structuredOutput !== "string" || new TextEncoder().encode(structuredOutput).byteLength > 2 * 1024 * 1024) throw new Error("invalid_output_bytes");
    const content = parseGeneratedPreproductionContent(JSON.parse(structuredOutput), requestedTracks);
    envelope = parsePreproductionEnvelope({
      schema_version: "filmstack-preproduction-pack/v2",
      package_id: crypto.randomUUID(),
      document_state: "PROSPECTIVE_DRAFT",
      authority_state: "NO_EXTERNAL_AUTHORITY",
      basis: {
        project_id: projectId,
        entry_id: builtContext.context.entry_id,
        context_bundle_id: builtContext.bundle_id,
        context_hash: builtContext.context_hash,
        source_hash: await sha256Text(fountain),
        source_hash_scope: "CONTENT_CONTEXT_FOUNTAIN_UTF8",
      },
      tracks: requestedTracks,
      generation: {
        generated_at: new Date().toISOString(), model: modelId,
        prompt_tokens: promptTokens, completion_tokens: completionTokens,
        estimated_cost_cents: estCost,
      },
      content,
    });
    canonicalText = serializePreproductionEnvelope(envelope);
    payloadSha256 = await sha256Text(canonicalText);
  } catch {
    return new Response(JSON.stringify({ error: "invalid_generated_preproduction_pack" }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (body.dry_run) {
    return new Response(JSON.stringify({ pack: envelope, payload_canonical_text: canonicalText, payload_sha256: payloadSha256, persisted: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: persisted, error: persistError } = await admin.rpc("persist_preproduction_pack_v2", {
    p_project_id: projectId,
    p_entry_id: builtContext.context.entry_id,
    p_context_bundle_id: builtContext.bundle_id,
    p_expected_context_hash: builtContext.context_hash,
    p_expected_source_hash: envelope.basis.source_hash,
    p_expected_current_artifact_id: expectedCurrentId,
    p_package_id: envelope.package_id,
    p_payload_canonical_text: canonicalText,
    p_payload_sha256: payloadSha256,
    p_recorded_by: auth.userId,
  });
  if (persistError) {
    const conflict = /stale_current|current.*conflict|package.*conflict/.test(persistError.message);
    return new Response(JSON.stringify({ error: conflict ? "preproduction_version_conflict" : "preproduction_persistence_failed" }), {
      status: conflict ? 409 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const inserted = Array.isArray(persisted) ? persisted[0] : persisted;
  if (!inserted || !UUID.test(inserted.artifact_id) || !Number.isSafeInteger(inserted.version) || inserted.version < 1 ||
      inserted.payload_canonical_text !== canonicalText || inserted.payload_sha256 !== payloadSha256) {
    return new Response(JSON.stringify({ error: "invalid_persistence_result" }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const nextVersion = inserted.version;

  await admin.from("ai_usage_log").insert({
    function_name: "generate-preproduction",
    model_id: modelId,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    estimated_cost_cents: estCost,
    status: "ok",
    user_id: auth.userId,
  });
  await logGovernanceAction({
    userId: auth.userId,
    action: "preproduction.generate",
    target: { project_id: projectId, entry_id: body.entry_id ?? null, artifact_id: inserted.artifact_id },
    details: {
      version: nextVersion,
      model: modelId,
      tracks: Array.from(tracks),
      context_bundle_id: builtContext.bundle_id,
      context_hash: builtContext.context_hash,
    },
  });

  return new Response(JSON.stringify({
    artifact_id: inserted.artifact_id,
    version: nextVersion,
    pack: envelope,
    payload_canonical_text: canonicalText,
    payload_sha256: payloadSha256,
    persisted: true,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
