import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[FULFILL-CHECKOUT] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const auth = await requireUser(req, corsHeaders);
    if (auth instanceof Response) return auth;
    const supabase = auth.admin;
    logStep("User authenticated", { userId: auth.userId });

    const { session_id } = await req.json();
    if (!session_id) throw new Error("Missing session_id");

    // SECURITY CONTAINMENT: this browser endpoint is status-only. Only the
    // signed Stripe webhook may credit tokens or activate a subscription.
    // Bind status lookup to the caller so a session ID cannot enumerate
    // another user's purchase.
    const { data: existing } = await supabase
      .from("purchases")
      .select("id, status, bundle_name, token_amount")
      .eq("stripe_session_id", session_id)
      .eq("user_id", auth.userId)
      .maybeSingle();

    if (existing) {
      logStep("Already fulfilled", { session_id });
      return new Response(JSON.stringify({ success: true, already_fulfilled: true, purchase: existing }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    logStep("Awaiting webhook confirmation", { session_id, userId: auth.userId });
    return new Response(
      JSON.stringify({
        success: true,
        pending: true,
        message: "Awaiting secure payment confirmation",
      }),
      {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
