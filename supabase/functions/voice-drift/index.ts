import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";
import { callAI, aiErrorResponse, resolveModelHint } from "../_shared/ai-router.ts";
import { emitGovernanceEvent } from "../_shared/governance.ts";
import { requireUser, requireEntryOwner } from "../_shared/auth.ts";

const BodySchema = z.object({
  entry_id: z.string().uuid(),
  correlation_id: z.string().max(120).optional().nullable(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const VOICE_DRIFT_ON_HOLD = true;

const returnDriftAnalysisTool = {
  type: "function" as const,
  function: {
    name: "return_drift_analysis",
    description: "Return structured voice drift analysis results for a screenplay",
    parameters: {
      type: "object",
      properties: {
        drift_score: { type: "number", description: "Voice drift score 0-100 where 0 = perfectly consistent, 100 = completely inconsistent" },
        flagged: { type: "boolean", description: "True if drift_score > 30" },
        summary: { type: "string", description: "1-2 sentence summary of voice consistency findings" },
        flagged_sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              section: { type: "string", description: "Location in screenplay" },
              reason: { type: "string", description: "Why this section has voice drift" },
              severity: { type: "string", enum: ["low", "medium", "high"] },
            },
            required: ["section", "reason", "severity"],
          },
          description: "Up to 5 most significant voice drift sections",
        },
        tone_shifts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              from: { type: "string", description: "Original tone" },
              to: { type: "string", description: "Shifted tone" },
              location: { type: "string", description: "Where in screenplay" },
            },
            required: ["from", "to", "location"],
          },
          description: "Up to 5 most notable tone shifts",
        },
      },
      required: ["drift_score", "flagged", "summary", "flagged_sections", "tone_shifts"],
      additionalProperties: false,
    },
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const input = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!input.success) {
      return new Response(
        JSON.stringify({ error: "Invalid input", details: input.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { entry_id, correlation_id } = input.data;

    const auth = await requireUser(req, corsHeaders);
    if (auth instanceof Response) return auth;
    const supabase = auth.admin;

    const ownerCheck = await requireEntryOwner(supabase, auth.userId, entry_id, corsHeaders);
    if (ownerCheck instanceof Response) return ownerCheck;

    if (VOICE_DRIFT_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "Voice-drift analysis is temporarily paused while secure billing is upgraded.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: entry, error: fetchErr } = await supabase
      .from("entries")
      .select("id, title, script_text, method_type, sensitivity, page_count")
      .eq("id", entry_id)
      .single();

    if (fetchErr || !entry) throw new Error("Entry not found");
    const entrySensitivity = entry.sensitivity || "standard";
    const entryPageCount = entry.page_count || undefined;

    const scriptText = (entry.script_text || "").slice(0, 80000);
    if (scriptText.length < 200) {
      await supabase.from("voice_drift_analysis").upsert({
        entry_id,
        drift_score: 0,
        flagged: false,
        details: { summary: "Script too short for voice drift analysis.", flagged_sections: [], tone_shifts: [] },
      }, { onConflict: "entry_id" });

      return new Response(JSON.stringify({ success: true, drift_score: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are an expert literary analyst specializing in authorial voice consistency. Analyze the screenplay for voice drift — inconsistencies in tone, style, vocabulary, or narrative voice that suggest multiple authors, AI-assisted sections, or tonal shifts.

You MUST call the return_drift_analysis function with your results.

Guidelines:
- Evaluate vocabulary consistency, sentence rhythm, dialogue voice distinctiveness
- Flag sections where the narrative voice changes abruptly
- Consider whether tone shifts are intentional (character-driven) vs unintentional (author drift)
- AI-generated scripts often show drift in emotional register and metaphor density
- For "${entry.method_type}" scripts, calibrate expectations accordingly
- Keep flagged_sections to the 5 most significant issues max
- Keep tone_shifts to the 5 most notable shifts max`;

    const modelHint = await resolveModelHint("voice-drift", "google/gemini-2.5-flash");
    const result = await callAI({
      route: {
        functionName: "voice-drift",
        modelHint,
      },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Title: ${entry.title}\n\nScreenplay:\n${scriptText}` },
      ],
      max_completion_tokens: 1500,
      temperature: 0.3,
      tools: [returnDriftAnalysisTool],
      tool_choice: { type: "function", function: { name: "return_drift_analysis" } },
      meta: {
        entryId: entry_id,
        correlationId: correlation_id || undefined,
        sensitivity: entrySensitivity,
        pageCount: entryPageCount,
      },
    });

    let parsedResult: Record<string, unknown>;
    try {
      parsedResult = JSON.parse(result.content) as Record<string, unknown>;
    } catch {
      throw new Error("Failed to parse voice drift AI response");
    }

    const driftScore = Math.max(0, Math.min(100, Math.round(Number(parsedResult.drift_score ?? 0))));
    const flagged = driftScore > 30 || Boolean(parsedResult.flagged);
    const details = {
      summary: parsedResult.summary || "No summary available.",
      flagged_sections: Array.isArray(parsedResult.flagged_sections) ? parsedResult.flagged_sections.slice(0, 5) : [],
      tone_shifts: Array.isArray(parsedResult.tone_shifts) ? parsedResult.tone_shifts.slice(0, 5) : [],
    };

    const { error: insertErr } = await supabase.from("voice_drift_analysis").upsert(
      { entry_id, drift_score: driftScore, flagged, details },
      { onConflict: "entry_id" },
    );
    if (insertErr) throw new Error(`Insert error: ${insertErr.message}`);

    console.log(`Voice drift: entry=${entry_id}, score=${driftScore}, flagged=${flagged}`);

    // ── Governance: event + update influence_scores (fire-and-forget) ──
    try {
      await emitGovernanceEvent(supabase, {
        entryId: entry_id,
        eventType: "voice_stability_scored",
        metadata: { drift_score: driftScore, flagged, correlation_id: correlation_id },
      });

      // Update voice_stability_score on the latest influence_scores row for this entry
      const voiceStabilityNormalized = Math.round((1 - driftScore / 100) * 10000) / 10000;
      const { data: latestScore } = await supabase
        .from("influence_scores")
        .select("id")
        .eq("entry_id", entry_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (latestScore) {
        await supabase
          .from("influence_scores")
          .update({ voice_stability_score: voiceStabilityNormalized })
          .eq("id", latestScore.id);
      }
    } catch (e) {
      console.error("Governance voice drift error (non-fatal):", e);
    }

    return new Response(
      JSON.stringify({ success: true, drift_score: driftScore, flagged, details }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Voice drift error:", error);
    return aiErrorResponse(error, corsHeaders);
  }
});
