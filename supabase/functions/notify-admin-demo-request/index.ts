import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logGovernanceAction } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEMO_REQUEST_NOTIFICATIONS_ON_HOLD = true;

/**
 * SECURITY: This endpoint is public (called right after the unauthenticated
 * demo request form submits). To prevent attackers from flooding admin
 * inboxes with arbitrary content, we:
 *   1. Require a real DB row in `demo_access_requests` matching the email
 *      that was created in the last 2 minutes.
 *   2. Use ONLY trusted fields fetched from that row when composing the
 *      notification — never the raw request body.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || email.length > 255) {
      return new Response(JSON.stringify({ error: "Invalid email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (DEMO_REQUEST_NOTIFICATIONS_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "Demo-request notifications are temporarily paused during a security upgrade.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify a corresponding request row exists and was created very recently.
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: request } = await supabaseAdmin
      .from("demo_access_requests")
      .select("id, name, email, reason, created_at")
      .ilike("email", email)
      .gte("created_at", twoMinAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!request) {
      return new Response(JSON.stringify({ error: "No matching recent request" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: adminRoles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    if (!adminRoles || adminRoles.length === 0) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const safeName = String(request.name ?? "").slice(0, 100);
    const safeEmail = String(request.email ?? "").slice(0, 255);
    const safeReason = String(request.reason ?? "").slice(0, 500);

    const notifications = adminRoles.map((r) => ({
      user_id: r.user_id,
      title: "New Demo Access Request",
      message: `${safeName} (${safeEmail}) requested demo access.${
        safeReason ? ` Reason: "${safeReason}"` : ""
      }`,
      type: "info",
      metadata: { request_id: request.id, source: "demo_request" },
    }));

    await supabaseAdmin.from("user_notifications").insert(notifications);

    await logGovernanceAction({
      userId: null,
      action: "admin_notified_demo_request",
      details: { request_id: request.id, admins_notified: adminRoles.length },
    });

    // Do not leak admin count to anonymous callers.
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("notify-admin-demo-request error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
