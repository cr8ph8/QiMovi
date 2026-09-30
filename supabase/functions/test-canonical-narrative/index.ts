// Edge function: test-canonical-narrative
// Scores a screenplay/entry/text under BOTH Western (causal) and Eastern (relational) lenses,
// optionally measures alignment to the universe's canonical narrative, and persists the run.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI, aiErrorResponse } from "../_shared/ai-router.ts";
import { spendTokens, writeAudit, classifySensitivity, newCorrelationId } from "../_shared/kernel-ops.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CANONICAL_NARRATIVE_AI_ON_HOLD = true;

const SYSTEM_PROMPT = `You are a dual-lens narrative analyst.

You score a screenplay or treatment on TWO independent lenses and never assume one is correct:

CAUSAL (Western engine): Drama = Goal · Obstacle. Tension = Stakes · Uncertainty · Attachment.
  Strong causal narratives have a clear protagonist want, escalating obstacles, modulated tension,
  and an irreversible choice that resolves the external problem.

RELATIONAL (Eastern engine / Kishōtenketsu): Meaning = Pattern + Turn. The Ten reframes the situation
  (it does NOT defeat an antagonist). Strong relational narratives establish a pattern (Ki·Shō),
  introduce a recontextualizing turn (Ten), and reach an equilibrium — restored, transformed,
  or knowingly accepted (Ketsu).

You also detect which lens dominates the work and report your confidence. A weak script under one
lens may be strong under the other — do not penalize a Kishōtenketsu script for lacking a 3-act
climax. Be specific in notes; cite textual signals.

If a canonical narrative is provided (the universe's declared core want / pattern / turn / equilibrium),
score alignment 0–100 and list specific divergences.

Always return your answer by calling the score_dual_lens tool.`;

const TOOL = {
  type: "function" as const,
  function: {
    name: "score_dual_lens",
    description: "Return dual-lens narrative scores and optional canon alignment.",
    parameters: {
      type: "object",
      properties: {
        causal: {
          type: "object",
          properties: {
            goal: { type: "number" },
            obstacle: { type: "number" },
            tension: { type: "number" },
            arc_gap: { type: "number", description: "Quality of |want − need| handling, 0–100" },
            structure: { type: "number" },
            composite: { type: "number" },
            notes: { type: "string" },
          },
          required: ["goal", "obstacle", "tension", "arc_gap", "structure", "composite"],
          additionalProperties: false,
        },
        relational: {
          type: "object",
          properties: {
            pattern: { type: "number" },
            turn: { type: "number" },
            equilibrium: { type: "number" },
            meaning_density: { type: "number" },
            composite: { type: "number" },
            notes: { type: "string" },
          },
          required: ["pattern", "turn", "equilibrium", "meaning_density", "composite"],
          additionalProperties: false,
        },
        tradition_detected: {
          type: "string",
          enum: ["causal_western", "relational_eastern", "hybrid"],
        },
        tradition_confidence: { type: "number", description: "0–1" },
        alignment_to_canon: {
          type: "number",
          description: "0–100. Omit or 0 if no canon provided.",
        },
        divergence_notes: {
          type: "array",
          items: { type: "string" },
          description: "Specific ways the work departs from the universe canon.",
        },
        reasoning: { type: "string", description: "Brief reasoning trace for audit." },
      },
      required: ["causal", "relational", "tradition_detected", "tradition_confidence"],
      additionalProperties: false,
    },
  },
};

interface Body {
  universe_id?: string;
  entry_id?: string;
  brief_id?: string;
  raw_text?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let outerUserId: string | null = null;
  let outerUniverseId: string | null = null;
  let outerCorrelationId: string | null = null;

  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const universeId = body.universe_id;
    const entryId = body.entry_id;
    const briefId = body.brief_id;
    let rawText = (body.raw_text ?? "").toString();

    if (!universeId) {
      return json({ error: "universe_id is required" }, 400);
    }
    outerUniverseId = universeId;

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !supabaseUrl || !serviceKey) {
      return json({ error: "Authentication required" }, 401);
    }

    // Identify user
    const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: authHeader },
    });
    if (!userResp.ok) return json({ error: "Invalid session" }, 401);
    const userData = await userResp.json();
    const userId: string | null = userData?.id ?? null;
    outerUserId = userId;
    if (!userId) return json({ error: "Invalid session" }, 401);

    if (CANONICAL_NARRATIVE_AI_ON_HOLD) {
      return json({
        error: "security_maintenance",
        message: "AI narrative testing is temporarily paused while secure billing is upgraded.",
      }, 503);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Ownership check on universe
    const { data: universe } = await admin
      .from("project_universes")
      .select("id, user_id, name")
      .eq("id", universeId)
      .maybeSingle();
    if (!universe || universe.user_id !== userId) {
      return json({ error: "Universe not found or access denied" }, 403);
    }

    // Pull source text
    if (entryId && !rawText) {
      const { data } = await admin
        .from("entries")
        .select("script_text, logline, title")
        .eq("id", entryId)
        .maybeSingle();
      rawText = (data?.script_text ?? data?.logline ?? "").toString();
    }
    if (briefId && !rawText) {
      const { data } = await admin
        .from("project_briefs")
        .select("content")
        .eq("id", briefId)
        .maybeSingle();
      rawText = JSON.stringify(data?.content ?? {});
    }
    if (!rawText || rawText.trim().length < 80) {
      return json({ error: "Not enough source text to analyze" }, 400);
    }

    // Pull canon (optional)
    const { data: canon } = await admin
      .from("universe_canonical_narrative")
      .select("*")
      .eq("universe_id", universeId)
      .maybeSingle();

    const sensitivity = await classifySensitivity(entryId ?? null);
    const correlationId = newCorrelationId("narrative_test");
    outerCorrelationId = correlationId;

    // Token spend
    const spend = await spendTokens({
      authHeader,
      action: "canonical_narrative_test",
      entry_id: entryId ?? null,
      label: "test-canonical-narrative",
    });
    if (!spend.ok) {
      const status = spend.status === 402 || spend.status === 403 ? spend.status : 402;
      return json(
        {
          error: spend.error || "Insufficient tokens",
          code: status === 403 ? "plan_required" : "insufficient_tokens",
        },
        status,
      );
    }

    // Build prompt
    const canonBlock = canon
      ? `UNIVERSE CANON (declared by owner):
- Tradition: ${canon.tradition}
- Structure model: ${canon.structure_model}
- Core want: ${canon.core_want ?? "—"}
- Core need: ${canon.core_need ?? "—"}
- Core obstacle: ${canon.core_obstacle ?? "—"}
- Central pattern (Ki·Shō): ${canon.central_pattern ?? "—"}
- Intended turn (Ten): ${canon.intended_turn ?? "—"}
- Equilibrium (Ketsu): ${canon.equilibrium_state ?? "—"}
- Theme claim: ${canon.theme_claim ?? "—"}
- Theme counterclaim: ${canon.theme_counterclaim ?? "—"}

Score alignment_to_canon (0–100) and list specific divergences in divergence_notes.`
      : `No universe canon declared. Set alignment_to_canon to 0 and leave divergence_notes empty.`;

    const TRUNC = 24_000;
    const text = rawText.length > TRUNC ? rawText.slice(0, TRUNC) + "\n…[truncated]" : rawText;

    const result = await callAI({
      route: { functionName: "test-canonical-narrative", modelHint: "google/gemini-3-flash-preview" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `${canonBlock}\n\nWORK TO SCORE:\n${text}` },
      ],
      tools: [TOOL],
      tool_choice: { type: "function", function: { name: "score_dual_lens" } },
      max_completion_tokens: 1800,
      temperature: 0.2,
      meta: { userId, entryId: entryId ?? null, correlationId, sensitivity, pageCount: 0 },
    });

    const toolCalls = (result.raw as any)?.choices?.[0]?.message?.tool_calls;
    const rawArgs = toolCalls?.[0]?.function?.arguments;
    if (!rawArgs) throw new Error("Model did not return a tool call");
    let args: Record<string, unknown>;
    try {
      args = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
    } catch {
      throw new Error("Model returned invalid JSON tool arguments");
    }

    const causalScore = args.causal as Record<string, unknown>;
    const relationalScore = args.relational as Record<string, unknown>;
    const traditionDetected = args.tradition_detected as string;
    const alignment =
      typeof args.alignment_to_canon === "number" ? (args.alignment_to_canon as number) : null;
    const divergenceNotes = Array.isArray(args.divergence_notes)
      ? (args.divergence_notes as string[])
      : [];

    // Persist
    const { data: row, error: insertErr } = await admin
      .from("universe_narrative_tests")
      .insert({
        universe_id: universeId,
        entry_id: entryId ?? null,
        brief_id: briefId ?? null,
        causal_score: causalScore,
        relational_score: relationalScore,
        alignment_to_canon: alignment,
        divergence_notes: divergenceNotes,
        tradition_detected: traditionDetected,
        model_id: result.modelId,
        run_by: userId,
      })
      .select()
      .single();
    if (insertErr) throw insertErr;

    await writeAudit({
      user_id: userId,
      action: "narrative_test.run",
      details: {
        universe_id: universeId,
        entry_id: entryId ?? null,
        brief_id: briefId ?? null,
        tradition_detected: traditionDetected,
        alignment,
        correlation_id: correlationId,
        sensitivity,
        model_id: result.modelId,
      },
    });

    return json({ test: row, reasoning: args.reasoning ?? null });
  } catch (error) {
    console.error("test-canonical-narrative error:", error);
    await writeAudit({
      user_id: outerUserId,
      action: "narrative_test.run",
      details: {
        success: false,
        universe_id: outerUniverseId,
        correlation_id: outerCorrelationId,
        error: error instanceof Error ? error.message : String(error),
      },
    }).catch(() => {});
    return aiErrorResponse(error, corsHeaders);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
