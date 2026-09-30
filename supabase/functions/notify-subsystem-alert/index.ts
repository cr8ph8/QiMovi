import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify calling user is admin
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: isAdmin } = await adminClient.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { subsystemId, title, errorCount, totalCalls } = body;

    if (!subsystemId || !title) {
      return new Response(JSON.stringify({ error: "Missing subsystemId or title" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Dedup check: skip if a similar notification was sent in last 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await adminClient
      .from("user_notifications")
      .select("id")
      .eq("type", "error")
      .gte("created_at", since)
      .like("title", `%${title}%`)
      .limit(1);

    if (existing && existing.length > 0) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "Notification already sent within 24h" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get all admin user IDs
    const { data: adminRoles } = await adminClient
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    if (!adminRoles || adminRoles.length === 0) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "No admins found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const errorRate = totalCalls > 0 ? Math.round((errorCount / totalCalls) * 100) : 0;

    const notifications = adminRoles.map((admin: { user_id: string }) => ({
      user_id: admin.user_id,
      title: `⚠ ${title} — Error State`,
      message: `Subsystem "${title}" has entered error state with ${errorCount} errors out of ${totalCalls} calls (${errorRate}% error rate) in the last 24 hours. Investigate via God Mode → Dev Log → System Architecture.`,
      type: "error",
      metadata: {
        alert_type: "subsystem_failure",
        subsystem_id: subsystemId,
        error_count: errorCount,
        total_calls: totalCalls,
        error_rate: errorRate,
      },
    }));

    await adminClient.from("user_notifications").insert(notifications);

    // Log to system_audits for historical record
    await adminClient.from("system_audits").insert({
      user_id: user.id,
      title: `Subsystem Alert: ${title}`,
      summary: `${errorCount} errors / ${totalCalls} calls (${errorRate}%)`,
      audit_type: "subsystem_alert",
      status: "alert",
      system_snapshot: { subsystemId, errorCount, totalCalls, errorRate },
      changes: { triggered_by: "auto_health_check" },
    });

    return new Response(
      JSON.stringify({
        success: true,
        admins_notified: adminRoles.length,
        subsystem: subsystemId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
