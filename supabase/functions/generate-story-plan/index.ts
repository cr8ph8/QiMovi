// generate-story-plan — produces the canonical story_plan artifact for a project.
// Versioned, hash-friendly, JSON-only output (logline, theme, act beats,
// character arcs, scene index, open questions). Consumed by the Context
// Bundler and (later) by rubric scoring.
//
// Tokens: charged via spend-tokens (action=story_plan_generate, default 8).

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

interface Body {
  entry_id?: string;
  project_id?: string;
  dry_run?: boolean;
}

const STORY_PLAN_SCHEMA = {
  type: "object",
  properties: {
    logline: { type: "string", description: "One-sentence pitch (≤200 chars)" },
    theme: { type: "string", description: "Single dominant theme / question" },
    genre: { type: "string" },
    tone: { type: "string" },
    act_beats: {
      type: "array",
      description: "Major story beats in order. 6–18 entries.",
      items: {
        type: "object",
        properties: {
          act: { type: "string", enum: ["I", "II", "III"] },
          beat: { type: "string", description: "Beat name, e.g. 'Inciting Incident'" },
          summary: { type: "string" },
          page_estimate: { type: "number" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["act", "beat", "summary", "confidence"],
        additionalProperties: false,
      },
    },
    character_arcs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          want: { type: "string" },
          need: { type: "string" },
          arc: { type: "string", description: "From-to summary" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["name", "want", "need", "arc", "confidence"],
        additionalProperties: false,
      },
    },
    scene_index: {
      type: "array",
      description: "Compact scene list (max 80 entries).",
      items: {
        type: "object",
        properties: {
          index: { type: "number" },
          slug: { type: "string", description: "INT/EXT. LOCATION - TIME" },
          purpose: { type: "string" },
        },
        required: ["index", "slug"],
        additionalProperties: false,
      },
    },
    scene_tree: {
      type: "array",
      description:
        "OPTIONAL hierarchical Scene → Beat tree (Fabula-style). When provided, " +
        "each scene lists ordered beats and per-beat continuity invariants the " +
        "Narrative Gate can verify. Cap at 40 scenes; cap beats at 8 per scene.",
      items: {
        type: "object",
        properties: {
          scene_index: { type: "number" },
          slug: { type: "string" },
          summary: { type: "string" },
          beats: {
            type: "array",
            items: {
              type: "object",
              properties: {
                beat: { type: "string" },
                intent: { type: "string", description: "Dramatic intent / function" },
                invariants: {
                  type: "array",
                  description:
                    "Beat-scoped continuity invariants (I_EXIST, I_LIVE, I_KNOWS, I_LOCATION, I_TIME).",
                  items: { type: "string" },
                },
              },
              required: ["beat", "intent"],
              additionalProperties: false,
            },
          },
        },
        required: ["scene_index", "slug", "beats"],
        additionalProperties: false,
      },
    },
    open_questions: {
      type: "array",
      description: "Unresolved structural questions the writer should answer.",
      items: { type: "string" },
    },
  },
  required: ["logline", "theme", "act_beats", "character_arcs", "open_questions"],
  additionalProperties: false,
} as const;

async function resolveFountain(admin: any, projectId: string): Promise<string | null> {
  const { data } = await admin
    .from("project_artifacts")
    .select("payload_json")
    .eq("project_id", projectId)
    .eq("artifact_type", "fountain")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const text = (data as any)?.payload_json?.fountain_text;
  return typeof text === "string" ? text : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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
  try { body = await req.json(); } catch { body = {}; }
  if (!body.entry_id && !body.project_id) {
    return new Response(JSON.stringify({ error: "entry_id or project_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
    return new Response(JSON.stringify({ error: "dry_run must be a boolean" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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

  // Charge tokens (skip on dry_run).
  if (!body.dry_run) {
    const spend = await fetch(`${url}/functions/v1/spend-tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({
        action: "story_plan_generate",
        label: "Story Plan: generate",
        entry_id: body.entry_id ?? undefined,
      }),
    });
    if (!spend.ok) {
      return new Response(await spend.text(), {
        status: spend.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Build canonical ContentContext (the spine). This persists a versioned,
  // hash-chained context_bundles row and gives us the context_ref to pass
  // into ai-router for hash-verified, replayable model calls.
  let builtContext;
  try {
    builtContext = await buildContentContext(
      admin,
      projectId,
      {
        mode: "divergent",
        task: "story_plan.generate",
        scope: "project",
        model_hint: "google/gemini-3-flash-preview",
      },
      auth.userId,
    );
  } catch (e: any) {
    console.error("[generate-story-plan] context build failed:", e);
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

  // Call AI with structured tool — pass context_ref so the router verifies
  // we are still calling against the exact bundle we built.
  let plan: Record<string, unknown> | null = null;
  let modelId = "google/gemini-3-flash-preview";
  let promptTokens = 0, completionTokens = 0, estCost = 0;
  try {
    const result = await callAI({
      route: { functionName: "generate-story-plan", modelHint: "google/gemini-3-flash-preview" },
      messages: [
        {
          role: "system",
          content:
            "You are a story-analysis engine. Read the screenplay and return a canonical structured story plan. " +
            "Be terse, evidence-grounded, no marketing language. Include a confidence score (0-1) per beat/arc. " +
            "Cap scene_index at 80 entries (sample evenly if the script is longer). " +
            "When the script structure is clear, ALSO populate scene_tree (≤40 scenes, ≤8 beats per scene) with " +
            "per-beat invariants drawn from {I_EXIST, I_LIVE, I_KNOWS, I_LOCATION, I_TIME} so the Narrative Gate " +
            "can verify continuity. Use the return_story_plan tool — never return prose.",
        },
        {
          role: "user",
          content: `Screenplay text (truncated to first 60k chars):\n\n${fountain.slice(0, 60000)}`,
        },
      ],
      tools: [{
        type: "function",
        function: {
          name: "return_story_plan",
          description: "Return the canonical story plan as structured JSON.",
          parameters: STORY_PLAN_SCHEMA,
        },
      }],
      tool_choice: { type: "function", function: { name: "return_story_plan" } },
      temperature: 0.2,
      max_completion_tokens: 4000,
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
      plan = JSON.parse(toolCalls[0].function.arguments);
    } else if (result.content) {
      // Fallback: try to find JSON in content.
      const match = result.content.match(/\{[\s\S]*\}/);
      if (match) plan = JSON.parse(match[0]);
    }
  } catch (e: any) {
    console.error("[generate-story-plan] AI error:", e);
    const status = e.message?.includes("429") ? 429 : e.message?.includes("402") ? 402 : 500;
    return new Response(JSON.stringify({ error: e.message ?? "AI generation failed" }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!plan || typeof plan !== "object") {
    return new Response(JSON.stringify({ error: "AI returned no structured plan" }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (body.dry_run) {
    return new Response(JSON.stringify({ plan, model: modelId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Determine next version, mark old current=false, insert new artifact.
  const { data: latest } = await admin
    .from("project_artifacts")
    .select("id, version")
    .eq("project_id", projectId)
    .eq("artifact_type", "story_plan")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = ((latest as any)?.version ?? 0) + 1;

  if (latest) {
    await admin.from("project_artifacts").update({ is_current: false })
      .eq("project_id", projectId).eq("artifact_type", "story_plan").eq("is_current", true);
  }

  const { data: inserted, error: insErr } = await admin.from("project_artifacts").insert({
    project_id: projectId,
    artifact_type: "story_plan",
    version: nextVersion,
    is_current: true,
    payload_json: {
      ...plan,
      _meta: {
        generated_at: new Date().toISOString(),
        model: modelId,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        estimated_cost_cents: estCost,
        source_entry_id: body.entry_id ?? null,
        context_bundle_id: builtContext.bundle_id,
        context_hash: builtContext.context_hash,
      },
    },
    created_by: auth.userId,
  }).select("id, version, created_at").single();

  if (insErr) {
    return new Response(JSON.stringify({ error: insErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Usage log + audit.
  await admin.from("ai_usage_log").insert({
    function_name: "generate-story-plan",
    model_id: modelId,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    estimated_cost_cents: estCost,
    status: "ok",
    user_id: auth.userId,
  });
  await logGovernanceAction({
    userId: auth.userId,
    action: "story_plan.generate",
    target: { project_id: projectId, entry_id: body.entry_id ?? null, artifact_id: (inserted as any).id },
    details: { version: nextVersion, model: modelId, context_bundle_id: builtContext.bundle_id, context_hash: builtContext.context_hash },
  });

  return new Response(JSON.stringify({
    artifact_id: (inserted as any).id,
    version: nextVersion,
    plan,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
