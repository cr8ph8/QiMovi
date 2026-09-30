// Ops diagnostic — intentionally bypasses _shared/ai-router.ts to probe each
// model directly. Admin-gated, never user-facing. Every probe is logged to
// ai_usage_log with status + latency so governance audits can see it.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODELS = [
  "google/gemini-2.5-pro",
  "google/gemini-3.1-pro-preview",
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "openai/gpt-5",
  "openai/gpt-5-mini",
  "openai/gpt-5-nano",
  "openai/gpt-5.2",
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    // Check admin role
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);
    const { data: roleRow } = await sb
      .from("user_roles")
      .select("id")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) throw new Error("Admin access required");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const results = [];

    for (const model of MODELS) {
      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: "Reply with exactly: OK" }],
            max_completion_tokens: 10,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);
        const elapsed = Date.now() - start;

        if (!resp.ok) {
          const errText = await resp.text();
          results.push({
            model,
            status: "error",
            latency_ms: elapsed,
            error: `HTTP ${resp.status}: ${errText.slice(0, 200)}`,
          });
          continue;
        }

        const json = await resp.json();
        const content = json.choices?.[0]?.message?.content?.trim() || "";

        results.push({
          model,
          status: "ok",
          latency_ms: elapsed,
          response: content.slice(0, 50),
          error: null,
        });
      } catch (e) {
        const elapsed = Date.now() - start;
        results.push({
          model,
          status: "error",
          latency_ms: elapsed,
          error: e.name === "AbortError" ? "Timeout (15s)" : (e as Error).message?.slice(0, 200),
        });
      }
    }

    // Log every probe to ai_usage_log so even diagnostic calls are audited.
    try {
      await sb.from("ai_usage_log").insert(
        results.map((r) => ({
          function_name: "model-health-check",
          model_id: r.model,
          prompt_tokens: 0,
          completion_tokens: 0,
          estimated_cost_cents: 0,
          status: r.status === "ok" ? "success" : "error",
          user_id: user.id,
          routing_reason: `health_probe:${r.latency_ms}ms${r.error ? `:${String(r.error).slice(0, 60)}` : ""}`,
          sensitivity: "standard",
        })),
      );
    } catch (e) {
      console.error("[model-health-check] probe log failed (non-fatal):", e);
    }

    return new Response(JSON.stringify({ results, tested_at: new Date().toISOString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
