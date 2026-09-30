import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI } from "../_shared/ai-router.ts";
import { classifySensitivity, spendTokens, writeAudit, newCorrelationId } from "../_shared/kernel-ops.ts";
import { requireEntryOwner } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const characterName = String(body?.character_name ?? "").trim();
    const entryId = String(body?.entry_id ?? "").trim();
    const dialogueLines = Array.isArray(body?.dialogue_lines)
      ? (body.dialogue_lines as unknown[]).map(String).slice(0, 80)
      : [];
    const sceneContext = typeof body?.scene_context === "string"
      ? body.scene_context.slice(0, 2000)
      : "";

    if (!characterName || !entryId) {
      return new Response(
        JSON.stringify({ error: "character_name and entry_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (dialogueLines.length === 0 && !sceneContext) {
      return new Response(
        JSON.stringify({ error: "Not enough dialogue to draft a diamond" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);
    const ownerCheck = await requireEntryOwner(admin, user.id, entryId, corsHeaders);
    if (ownerCheck instanceof Response) return ownerCheck;

    // ── Token spend (Pro-gated via feature_configs.character_diamond_suggest) ──
    const spend = await spendTokens({
      authHeader,
      action: "character_diamond_suggest",
      entry_id: entryId,
      label: `Character Diamond · ${characterName}`,
    });
    if (!spend.ok) {
      return new Response(
        JSON.stringify({ error: spend.error || "Token spend failed" }),
        { status: spend.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const sensitivity = await classifySensitivity(entryId);
    const correlationId = newCorrelationId("chdiamond");

    const dialogueSample = dialogueLines.slice(0, 40).map((l) => `- ${l}`).join("\n").slice(0, 4000);

    const userMessage = `Character name: ${characterName}

Dialogue sample:
${dialogueSample}

${sceneContext ? `Scene context (action/headings):\n${sceneContext}\n` : ""}

Draft a Character Diamond for this character.
- The 4 short corners are each one sentence ≤140 chars.
- Also fill the structured vertices (epistemic / normative / affective / relational) with concrete, behaviorally-anchored items.
- Include a 0-100 confidence score.`;

    const result = await callAI({
      route: { functionName: "suggest-character-diamond", modelHint: "google/gemini-3-flash-preview" },
      messages: [
        {
          role: "system",
          content:
            "You are a screenwriting craft expert. Build a Character Diamond using the return_diamond tool. " +
            "North Star: dominant identity. Counter-Star: contradicting trait creating internal tension. " +
            "Flaw/Mask: how they distort under pressure. Non-Negotiable: line they will not cross. " +
            "Avoid generic words like 'complicated' or 'mysterious'. Use evidence from the dialogue.",
        },
        { role: "user", content: userMessage },
      ],
      tools: [{
        type: "function",
        function: {
          name: "return_diamond",
          description: "Return a Character Diamond with four short corners and structured Q2E vertices.",
          parameters: {
            type: "object",
            properties: {
              north_star: { type: "string" },
              counter_star: { type: "string" },
              flaw_mask: { type: "string" },
              non_negotiable: { type: "string" },
              epistemic: {
                type: "object",
                description: "Factual beliefs, hypotheses, uncertainty",
                properties: {
                  beliefs: { type: "array", items: { type: "string" } },
                  uncertainties: { type: "array", items: { type: "string" } },
                },
                additionalProperties: false,
              },
              normative: {
                type: "object",
                description: "Values, lines they will not cross",
                properties: {
                  values: { type: "array", items: { type: "string" } },
                  lines_not_crossed: { type: "array", items: { type: "string" } },
                },
                additionalProperties: false,
              },
              affective: {
                type: "object",
                description: "Emotional drives, fears, flaws",
                properties: {
                  drives: { type: "array", items: { type: "string" } },
                  fears: { type: "array", items: { type: "string" } },
                  flaws: { type: "array", items: { type: "string" } },
                },
                additionalProperties: false,
              },
              relational: {
                type: "object",
                description: "Push/pull dynamics with other characters",
                properties: {
                  allies: { type: "array", items: { type: "string" } },
                  antagonists: { type: "array", items: { type: "string" } },
                  pressures: { type: "array", items: { type: "string" } },
                },
                additionalProperties: false,
              },
              confidence: { type: "number", description: "0-100 confidence" },
            },
            required: ["north_star", "counter_star", "flaw_mask", "non_negotiable"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "return_diamond" } },
      temperature: 0.7,
      max_completion_tokens: 800,
      meta: { userId: user.id, entryId, sensitivity, correlationId },
    });

    let parsed: Record<string, unknown> = {};
    const toolCall = result.raw?.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try { parsed = JSON.parse(toolCall.function.arguments); } catch { /* ignore */ }
    }

    const trim = (s: unknown) => String(s ?? "").trim().slice(0, 140);
    const diamond = {
      north_star: trim(parsed.north_star),
      counter_star: trim(parsed.counter_star),
      flaw_mask: trim(parsed.flaw_mask),
      non_negotiable: trim(parsed.non_negotiable),
      source: "ai" as const,
    };

    if (!diamond.north_star && !diamond.counter_star && !diamond.flaw_mask && !diamond.non_negotiable) {
      return new Response(JSON.stringify({ error: "AI returned empty diamond" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Persist the richer Q2E vertices on character_diamonds ──
    try {
      const epistemic   = (parsed.epistemic && typeof parsed.epistemic === "object") ? parsed.epistemic : {};
      const normative   = (parsed.normative && typeof parsed.normative === "object") ? parsed.normative : {};
      const affective   = (parsed.affective && typeof parsed.affective === "object") ? parsed.affective : {};
      const relational  = (parsed.relational && typeof parsed.relational === "object") ? parsed.relational : {};
      const confidence  = typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(100, parsed.confidence))
        : null;

      await admin.from("character_diamonds").upsert({
        entry_id: entryId,
        character_name: characterName,
        north_star: diamond.north_star || null,
        counter_star: diamond.counter_star || null,
        flaw_mask: diamond.flaw_mask || null,
        non_negotiable: diamond.non_negotiable || null,
        source: "ai",
        epistemic, normative, affective, relational,
        confidence,
        model_version: result.modelId,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "entry_id,character_name" });
    } catch (e) {
      console.error("[suggest-character-diamond] persist failed (non-fatal):", e);
    }

    await writeAudit({
      user_id: user.id,
      action: "character_kernel.suggest",
      details: {
        entry_id: entryId,
        character_name: characterName,
        model: result.modelId,
        sensitivity,
        correlation_id: correlationId,
        prompt_tokens: result.promptTokens,
        completion_tokens: result.completionTokens,
        confidence: parsed.confidence ?? null,
      },
    });

    return new Response(
      JSON.stringify({
        diamond,
        vertices: {
          epistemic: parsed.epistemic ?? {},
          normative: parsed.normative ?? {},
          affective: parsed.affective ?? {},
          relational: parsed.relational ?? {},
        },
        confidence: parsed.confidence ?? null,
        correlation_id: correlationId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[suggest-character-diamond] Error:", msg);
    const status = msg.includes("429") ? 429 : msg.includes("402") ? 402 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
