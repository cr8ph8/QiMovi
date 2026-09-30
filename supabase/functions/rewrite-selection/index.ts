import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";
import { callAI, aiErrorResponse, resolveModelHint } from "../_shared/ai-router.ts";
import { recordRewriteGovernance } from "../_shared/governance.ts";
import { requireEntryOwner, requireUser } from "../_shared/auth.ts";
import { buildContentContext } from "../_shared/content-context.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAID_REWRITE_TOOLS_ON_HOLD = true;

const BodySchema = z.object({
  selected_text: z.string().min(1).max(20_000),
  action: z.enum(["rewrite", "expand", "condense", "punch_up"]),
  context: z.string().max(20_000).optional(),
  entry_id: z.string().uuid().optional().nullable(),
  element_index: z.number().int().nonnegative().optional().nullable(),
  parent_log_id: z.string().uuid().optional().nullable(),
  sensitivity: z.string().max(64).optional().nullable(),
});

const ACTION_PROMPTS: Record<string, string> = {
  rewrite: "Rewrite this screenplay text while maintaining the same meaning, tone, and format. Improve clarity and impact.",
  expand: "Expand this screenplay text with more detail, richer description, or additional beats while maintaining the same format and tone.",
  condense: "Condense this screenplay text to be tighter and more economical while preserving the essential meaning and format.",
  punch_up: "Punch up this screenplay text — make it more vivid, surprising, or emotionally impactful while keeping the same format.",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireUser(req, corsHeaders);
    if (auth instanceof Response) return auth;
    const user_id = auth.userId;
    const supabase = auth.admin;

    if (PAID_REWRITE_TOOLS_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "AI rewriting is temporarily paused while secure billing is upgraded.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success || !ACTION_PROMPTS[parsed.data.action]) {
      return new Response(
        JSON.stringify({ error: parsed.success ? "Invalid action" : parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { selected_text, action, context, entry_id, element_index, parent_log_id, sensitivity } = parsed.data;
    if (entry_id) {
      const ownerCheck = await requireEntryOwner(
        supabase,
        user_id,
        entry_id,
        corsHeaders,
      );
      if (ownerCheck instanceof Response) return ownerCheck;
    }

    const correlationId = crypto.randomUUID();

    const systemPrompt = `You are an expert screenwriter and script doctor. You output ONLY the rewritten text — no explanations, no markdown, no labels. Preserve Fountain screenplay formatting (scene headings in caps, character names in caps, parentheticals in parens, etc.). ${ACTION_PROMPTS[action]}`;

    const userPrompt = context
      ? `Context around the selection:\n---\n${context}\n---\n\nSelected text to ${action}:\n${selected_text}`
      : `Selected text to ${action}:\n${selected_text}`;

    const modelHint = await resolveModelHint("rewrite-selection", "google/gemini-3-flash-preview");

    // Build hash-verified content context when an entry anchor exists.
    let contextRef: { bundle_id: string; payload_hash: string } | undefined;
    let projectId: string | null = null;
    if (entry_id) {
      try {
        const { data: leg } = await supabase
          .from("project_legacy_map")
          .select("project_id")
          .eq("source_table", "entries")
          .eq("source_id", entry_id)
          .maybeSingle();
        projectId = (leg as any)?.project_id ?? null;
        if (projectId) {
          const built = await buildContentContext(
            supabase,
            projectId,
            { mode: "convergent", task: `rewrite.${action}`, scope: "scene", model_hint: modelHint },
            user_id,
          );
          contextRef = { bundle_id: built.bundle_id, payload_hash: built.context_hash };
        }
      } catch (ctxErr) {
        console.error("[rewrite-selection] context build failed (non-fatal):", ctxErr);
      }
    }

    const result = await callAI({
      route: {
        functionName: "rewrite-selection",
        modelHint,
      },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      context_ref: contextRef,
      meta: {
        entryId: entry_id || undefined,
        userId: user_id || undefined,
        correlationId,
        sensitivity: sensitivity || undefined,
        projectId: projectId || undefined,
      },
    });


    // Persist rewrite history into feature_usage_log
    let logId: string | null = null;
    try {
      const { data: logRow } = await supabase.from("feature_usage_log").insert({
        user_id: user_id || null,
        action: `ai_rewrite_${action}`,
        entry_id: entry_id || null,
        tokens_spent: 0,
        input_text: selected_text.slice(0, 5000),
        output_text: result.content.slice(0, 5000),
        metadata: { action, element_index: element_index ?? null },
        parent_log_id: parent_log_id || null,
        correlation_id: correlationId,
      }).select("id").single();
      logId = logRow?.id ?? null;
    } catch (logErr) {
      console.error("Rewrite history log error (non-fatal):", logErr);
    }

    // ── Governance layer (fire-and-forget) ──
    let governanceVersionId: string | null = null;
    try {
      const gov = await recordRewriteGovernance(supabase, {
        entryId: entry_id || undefined,
        inputText: selected_text,
        outputText: result.content,
        action,
        modelUsed: result.modelId,
        provider: "lovable",
        userId: user_id || null,
        sensitivity,
        correlationId,
      });
      governanceVersionId = gov.versionId;
    } catch (govErr) {
      console.error("Governance recording error (non-fatal):", govErr);
    }

    return new Response(JSON.stringify({ result: result.content, log_id: logId, version_id: governanceVersionId, model_used: result.modelId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("rewrite-selection error:", e);
    return aiErrorResponse(e, corsHeaders);
  }
});
