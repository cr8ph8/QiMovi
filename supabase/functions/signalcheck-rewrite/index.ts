// SignalCheck — rewrite text with stronger claim boundaries.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI } from "../_shared/ai-router.ts";
import { logGovernanceAction } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { analysis_id } = await req.json() as { analysis_id?: string };
    if (!analysis_id) {
      return new Response(JSON.stringify({ error: "analysis_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: analysis, error: aErr } = await admin
      .from("signalcheck_analyses")
      .select("id, user_id, original_text, mode")
      .eq("id", analysis_id)
      .eq("user_id", user.id)
      .single();
    if (aErr || !analysis) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: signals } = await admin
      .from("signalcheck_signals")
      .select("phrase, signal_type, replacement_suggestion")
      .eq("analysis_id", analysis_id);
    const { data: claims } = await admin
      .from("signalcheck_claims")
      .select("claim_text, action, suggested_rewrite")
      .eq("analysis_id", analysis_id);

    // Charge tokens
    const spendResp = await fetch(`${supabaseUrl}/functions/v1/spend-tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader, apikey: anonKey },
      body: JSON.stringify({ action: "signalcheck_rewrite", label: "SignalCheck · Rewrite" }),
    });
    if (!spendResp.ok) {
      const err = await spendResp.text();
      return new Response(JSON.stringify({ error: `Token charge failed: ${err}` }), {
        status: spendResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const system = `You are SignalCheck Rewrite. Revise the provided text to:
- Replace synthetic-authority phrasing with concrete mechanism.
- Bound every claim: state what is observed, implemented, hypothesized, or analogous.
- Cite or explicitly label unsupported claims as "Hypothesis" or "Needs source".
- Keep the author's voice, structure, and length roughly intact.
- Do NOT inject sources you cannot verify; label gaps instead.
Return ONLY the revised text. No preamble, no explanation.`;

    const ledger = [
      "FLAGGED PHRASES:",
      ...(signals ?? []).slice(0, 60).map(s => `- "${s.phrase}" (${s.signal_type}) → ${s.replacement_suggestion ?? "tighten"}`),
      "",
      "CLAIMS:",
      ...(claims ?? []).slice(0, 60).map(c => `- [${c.action}] "${c.claim_text}" → ${c.suggested_rewrite ?? "tighten"}`),
    ].join("\n");

    const result = await callAI({
      route: { functionName: "signalcheck-rewrite", modelHint: "google/gemini-2.5-flash" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: `MODE: ${analysis.mode}\n\nORIGINAL:\n${analysis.original_text}\n\nLEDGER:\n${ledger}\n\nReturn the revised text now.` },
      ],
      temperature: 0.3,
      max_completion_tokens: 4000,
      meta: { userId: user.id },
    });

    const revised = (result.content ?? "").trim();

    await admin.from("signalcheck_analyses").update({ revised_text: revised }).eq("id", analysis_id);

    await admin.from("ai_usage_log").insert({
      function_name: "signalcheck-rewrite",
      model_id: result.modelId,
      prompt_tokens: result.promptTokens,
      completion_tokens: result.completionTokens,
      estimated_cost_cents: result.estimatedCostCents,
      status: "ok",
      user_id: user.id,
    });

    await logGovernanceAction({
      userId: user.id,
      action: "signalcheck.rewrite",
      target: { analysis_id },
      details: { model: result.modelId, output_length: revised.length },
    });

    return new Response(JSON.stringify({ revised_text: revised }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[signalcheck-rewrite] Error:", e);
    const status = e.message?.includes("429") ? 429 : e.message?.includes("402") ? 402 : 500;
    return new Response(JSON.stringify({ error: e.message || "Internal error" }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
