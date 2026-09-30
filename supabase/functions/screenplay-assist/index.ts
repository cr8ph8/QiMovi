import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://esm.sh/zod@3.23.8";
import { callAI, aiErrorResponse, resolveModelHint } from "../_shared/ai-router.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UNCHARGED_SCREENPLAY_ASSIST_ON_HOLD = true;

const BodySchema = z.object({
  action: z.enum(["suggest_rewrites", "continuity_check", "alternative_dialogue"]),
  selection: z.string().max(20_000).optional(),
  scene_context: z.string().max(20_000).optional(),
  full_script: z.string().max(200_000).optional(),
  draft_id: z.string().uuid().optional().nullable(),
  sensitivity: z.string().max(64).optional().nullable(),
});

type Action = "suggest_rewrites" | "continuity_check" | "alternative_dialogue";

const SYSTEM_PROMPTS: Record<Action, string> = {
  suggest_rewrites:
    "You are a senior script doctor. Given a screenplay scene or selection (Fountain format), return 3 short, actionable rewrite suggestions. Be specific and concrete. Use a numbered list, each item 1–2 sentences. No preamble.",
  continuity_check:
    "You are a continuity supervisor. Inspect the provided screenplay context for continuity issues — character knowledge, props, time of day, geography, prior scene references. List concrete issues with line/scene cues. If none, say 'No continuity issues detected.' No preamble.",
  alternative_dialogue:
    "You are an expert dialogue writer. For the selected dialogue (Fountain format), produce 3 alternative versions in different registers (e.g. terse, lyrical, antagonistic). Preserve character voice. Output each as a fenced Fountain block. No preamble.",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireUser(req, corsHeaders);
    if (auth instanceof Response) return auth;
    const user_id = auth.userId;

    if (UNCHARGED_SCREENPLAY_ASSIST_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "Screenplay AI assist is temporarily paused while secure billing is upgraded.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { action, selection, scene_context, full_script, draft_id, sensitivity } = parsed.data;

    const target = (selection && String(selection).trim()) ||
      (scene_context && String(scene_context).trim()) ||
      (full_script && String(full_script).slice(-4000));

    if (!target || target.length < 10) {
      return new Response(JSON.stringify({ error: "Not enough text to analyze." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const correlationId = crypto.randomUUID();
    const modelHint = await resolveModelHint(
      "screenplay-assist",
      "google/gemini-3-flash-preview",
    );

    const userPrompt =
      action === "continuity_check" && full_script
        ? `Full screenplay (Fountain):\n---\n${String(full_script).slice(0, 12000)}\n---\n\nFocus area:\n${target}`
        : scene_context
          ? `Scene context:\n---\n${scene_context}\n---\n\nSelection:\n${selection || "(none — use scene context)"}`
          : target;

    const result = await callAI({
      route: { functionName: "screenplay-assist", modelHint },
      messages: [
        { role: "system", content: SYSTEM_PROMPTS[action as Action] },
        { role: "user", content: userPrompt },
      ],
      meta: {
        userId: user_id || undefined,
        entryId: draft_id || undefined,
        correlationId,
        sensitivity: sensitivity || undefined,
      },
    });

    return new Response(
      JSON.stringify({
        result: result.content,
        model_used: result.modelId,
        action,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("screenplay-assist error:", e);
    return aiErrorResponse(e, corsHeaders);
  }
});
