import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI, AIRouterError } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Strict admin-only auth (anonymous and anon-key callers are rejected)
    let callerUserId: string | null = null;
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // Allow service-role bearer (used by scheduled cron) without user auth
    if (token && token === serviceRoleKey) {
      // trusted internal caller
    } else {
      if (!token || token === anonKey) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }
      const { data: { user } } = await admin.auth.getUser(token);
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }
      const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403, headers: corsHeaders });
      }
      callerUserId = user.id;
    }

    // Parse optional body for schedule changes
    let scheduleAction: string | null = null;
    try {
      const body = await req.json();
      scheduleAction = body?.schedule ?? null;
    } catch { /* no body or not JSON — that's fine */ }

    // Handle schedule changes
    if (scheduleAction && ["off", "hourly", "daily"].includes(scheduleAction)) {
      await admin.from("site_settings").upsert(
        { key: "auto_audit_schedule", value: scheduleAction !== "off", text_value: scheduleAction },
        { onConflict: "key" }
      );
      return new Response(JSON.stringify({ ok: true, schedule: scheduleAction }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Capture system snapshot ──
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const oneDayAgo = new Date(Date.now() - 86400000).toISOString();

    const [
      entries, features, users, aiUsage, competitions,
      overrides, rewrites, sensUpgrades,
      govEvents24h, flaggedEntries, totalEntries, provenanceEntries,
      newEntries24h, newUsers24h, errorLogs24h
    ] = await Promise.all([
      admin.from("entries").select("id", { count: "exact", head: true }),
      admin.from("feature_configs").select("id", { count: "exact", head: true }).eq("enabled", true),
      admin.from("profiles").select("id", { count: "exact", head: true }),
      admin.from("ai_usage_log").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
      admin.from("competitions").select("id", { count: "exact", head: true }).eq("status", "open"),
      admin.from("ai_usage_log").select("id", { count: "exact", head: true }).not("routing_reason", "is", null).gte("created_at", sevenDaysAgo),
      admin.from("feature_usage_log").select("id", { count: "exact", head: true }).not("parent_log_id", "is", null).gte("created_at", sevenDaysAgo),
      admin.from("ai_usage_log").select("id", { count: "exact", head: true }).eq("routing_reason", "sensitivity_upgrade").gte("created_at", sevenDaysAgo),
      admin.from("governance_events").select("id", { count: "exact", head: true }).gte("created_at", oneDayAgo),
      admin.from("influence_scores").select("id", { count: "exact", head: true }).gt("ai_influence_score", 0.8),
      admin.from("entries").select("id", { count: "exact", head: true }),
      admin.from("provenance_nodes").select("entry_id", { count: "exact", head: true }),
      admin.from("entries").select("id", { count: "exact", head: true }).gte("created_at", oneDayAgo),
      admin.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", oneDayAgo),
      admin.from("ai_usage_log").select("id", { count: "exact", head: true }).eq("status", "error").gte("created_at", oneDayAgo),
    ]);

    const totalCount = totalEntries.count ?? 1;
    const provenanceCoverage = totalCount > 0
      ? Math.round(((provenanceEntries.count ?? 0) / totalCount) * 100)
      : 0;

    const snapshot = {
      entries_count: entries.count ?? 0,
      active_features: features.count ?? 0,
      total_users: users.count ?? 0,
      ai_usage_7d: aiUsage.count ?? 0,
      active_competitions: competitions.count ?? 0,
      model_overrides_7d: overrides.count ?? 0,
      rewrite_chains_7d: rewrites.count ?? 0,
      sensitivity_upgrades_7d: sensUpgrades.count ?? 0,
      governance_events_24h: govEvents24h.count ?? 0,
      flagged_entries: flaggedEntries.count ?? 0,
      provenance_coverage_pct: provenanceCoverage,
      new_entries_24h: newEntries24h.count ?? 0,
      new_users_24h: newUsers24h.count ?? 0,
      error_logs_24h: errorLogs24h.count ?? 0,
    };

    // ── Call Lovable AI for structured audit ──
    const systemPrompt = `You are a system health auditor for a screenwriting competition platform called QiCa. 
Analyze the system snapshot and recent activity data provided. Produce a structured audit report.
Be specific and actionable. Flag any concerning patterns. Note positive trends too.
If there are no entries or users, note this is likely a pre-launch or development environment.`;

    const userPrompt = `System snapshot (current state):
${JSON.stringify(snapshot, null, 2)}

Produce a structured audit report analyzing the platform health, risks, and recommendations.`;

    let aiResult;
    try {
      aiResult = await callAI({
        route: { functionName: "auto-audit", modelHint: "google/gemini-3-flash-preview" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "create_audit_report",
              description: "Create a structured system audit report",
              parameters: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Concise audit title (5-10 words)" },
                  summary: { type: "string", description: "2-3 sentence analysis of overall system health" },
                  changes: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        type: { type: "string", enum: ["added", "removed", "fixed", "broken"] },
                        description: { type: "string" },
                      },
                      required: ["type", "description"],
                      additionalProperties: false,
                    },
                  },
                  risk_level: { type: "string", enum: ["low", "medium", "high"] },
                  recommendations: { type: "array", items: { type: "string" } },
                },
                required: ["title", "summary", "changes", "risk_level", "recommendations"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "create_audit_report" } },
        meta: { userId: callerUserId ?? undefined },
      });
    } catch (e) {
      if (e instanceof AIRouterError) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: e.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw e;
    }

    if (!aiResult.content) throw new Error("AI did not produce structured output");
    const report = JSON.parse(aiResult.content);

    // ── Store the audit ──
    // Mark previous current as superseded
    await admin.from("system_audits").update({ status: "superseded" }).eq("status", "current");

    // Find an admin user id if this is a cron call
    if (!callerUserId) {
      const { data: adminRoles } = await admin.from("user_roles").select("user_id").eq("role", "admin").limit(1);
      callerUserId = adminRoles?.[0]?.user_id ?? "00000000-0000-0000-0000-000000000000";
    }

    const { error: insertErr } = await admin.from("system_audits").insert({
      user_id: callerUserId,
      title: report.title,
      summary: report.summary,
      audit_type: "automated",
      changes: report.changes,
      system_snapshot: { ...snapshot, risk_level: report.risk_level, recommendations: report.recommendations },
      status: "current",
    });

    if (insertErr) throw insertErr;

    return new Response(
      JSON.stringify({
        ok: true,
        title: report.title,
        risk_level: report.risk_level,
        recommendations_count: report.recommendations.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("auto-audit error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
