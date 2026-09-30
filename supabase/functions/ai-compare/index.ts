import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI, aiErrorResponse } from "../_shared/ai-router.ts";
import { emitGovernanceEvents } from "../_shared/governance.ts";
import { requireEntryOwner, requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAID_MODEL_COMPARE_ON_HOLD = true;

const ACTION_PROMPTS: Record<string, string> = {
  rewrite: "Rewrite this screenplay text while maintaining the same meaning, tone, and format. Improve clarity and impact.",
  expand: "Expand this screenplay text with more detail, richer description, or additional beats while maintaining the same format and tone.",
  condense: "Condense this screenplay text to be tighter and more economical while preserving the essential meaning and format.",
  punch_up: "Punch up this screenplay text — make it more vivid, surprising, or emotionally impactful while keeping the same format.",
  analyze: "Analyze this screenplay text. Provide a concise, actionable critique covering strengths, weaknesses, and suggestions for improvement.",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireUser(req, corsHeaders);
    if (auth instanceof Response) return auth;
    const user_id = auth.userId;

    if (PAID_MODEL_COMPARE_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "AI model comparison is temporarily paused while secure billing is upgraded.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { selected_text, action, models, entry_id, sensitivity } = await req.json();

    if (!selected_text || !action || !Array.isArray(models) || models.length < 2 || models.length > 3) {
      return new Response(JSON.stringify({ error: "selected_text, action, and models[] (2-3) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (entry_id) {
      const ownerCheck = await requireEntryOwner(
        auth.admin,
        user_id,
        entry_id,
        corsHeaders,
      );
      if (ownerCheck instanceof Response) return ownerCheck;
    }

    const actionPrompt = ACTION_PROMPTS[action] || ACTION_PROMPTS.rewrite;
    const correlationId = crypto.randomUUID();

    const systemPrompt = `You are an expert screenwriter and script doctor. You output ONLY the rewritten/analyzed text — no explanations, no markdown wrapping, no labels. Preserve Fountain screenplay formatting. ${actionPrompt}`;

    const results = await Promise.all(
      models.map(async (model: string) => {
        try {
          const result = await callAI({
            route: {
              functionName: "ai-compare",
              modelHint: model,
            },
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: selected_text },
            ],
            meta: {
              entryId: entry_id || undefined,
              userId: user_id || undefined,
              correlationId,
              sensitivity: sensitivity || undefined,
            },
          });
          return {
            model: result.modelId,
            content: result.content,
            prompt_tokens: result.promptTokens,
            completion_tokens: result.completionTokens,
            estimated_cost_cents: result.estimatedCostCents,
          };
        } catch (e) {
          return {
            model,
            content: null,
            error: (e as Error).message,
            prompt_tokens: 0,
            completion_tokens: 0,
            estimated_cost_cents: 0,
          };
        }
      }),
    );

    // ── Governance events (fire-and-forget) ──
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, serviceKey);

      const govEvents = results.map((r: any) => ({
        entryId: entry_id || null,
        eventType: r.error ? "model_output_received" : "model_output_received",
        eventStatus: r.error ? "error" : "recorded",
        provider: "lovable",
        modelName: r.model,
        metadata: { action, correlation_id: correlationId, error: r.error || null, tokens: (r.prompt_tokens || 0) + (r.completion_tokens || 0) },
      }));
      await emitGovernanceEvents(supabase, govEvents);
    } catch (govErr) {
      console.error("Governance compare event error (non-fatal):", govErr);
    }

    return new Response(JSON.stringify({ results, correlation_id: correlationId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-compare error:", e);
    return aiErrorResponse(e, corsHeaders);
  }
});
