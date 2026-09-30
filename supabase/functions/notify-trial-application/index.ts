import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logGovernanceAction } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TRIAL_APPLICATION_NOTIFICATIONS_ON_HOLD = true;

/**
 * SECURITY: Public endpoint called after the unauthenticated trial form
 * persists into `closed_trial_applications`. We validate a real recent row
 * exists and use only trusted DB fields in the notification.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || email.length > 255) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (TRIAL_APPLICATION_NOTIFICATIONS_ON_HOLD) {
      return new Response(JSON.stringify({
        ok: false,
        error: "security_maintenance",
        message: "Trial-application notifications are temporarily paused during a security upgrade.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: application } = await supabase
      .from("closed_trial_applications")
      .select("id, name, email, role, created_at")
      .ilike("email", email)
      .gte("created_at", twoMinAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!application) {
      return new Response(JSON.stringify({ ok: false, error: "No matching recent application" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: adminRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    if (!adminRoles || adminRoles.length === 0) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const safeName = String(application.name ?? "").slice(0, 100);
    const safeEmail = String(application.email ?? "").slice(0, 255);
    const safeRole = String(application.role ?? "applicant").slice(0, 50);

    const notifications = adminRoles.map((r: { user_id: string }) => ({
      user_id: r.user_id,
      title: "New Trial Application",
      message: `${safeName} (${safeEmail}) applied for the closed testing program as a ${safeRole}.`,
      type: "trial_application",
      metadata: { application_id: application.id },
    }));

    const { error } = await supabase.from("user_notifications").insert(notifications);
    if (error) {
      console.error("Failed to create notifications:", error);
      return new Response(JSON.stringify({ ok: false, error: "Internal error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await logGovernanceAction({
      userId: null,
      action: "trial_application",
      details: { application_id: application.id, admins_notified: adminRoles.length },
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("notify-trial-application error:", err);
    return new Response(JSON.stringify({ ok: false, error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
