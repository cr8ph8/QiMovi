import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { resolveCheckoutOrigin } from "../_shared/checkout-origin.ts";
import { resolveSubscriptionPlan } from "../_shared/commerce.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Price, checkout mode, and quantity are resolved exclusively from
 * operations-owned plan configuration or the `token_bundles` table. Stripe
 * customer ↔ Supabase user linkage is persisted for webhook verification.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  );
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");

    // Both switches must agree. `launch_state` is the public product state;
    // `payments_open` remains the independent operational interlock.
    const { data: settings, error: settingsError } = await serviceClient
      .from("site_settings")
      .select("key, value, text_value")
      .in("key", ["launch_state", "payments_open"]);
    if (settingsError) throw new Error("Unable to verify payment availability");

    const launchState = settings?.find((setting) => setting.key === "launch_state")
      ?.text_value;
    const paymentsOpen = settings?.find((setting) => setting.key === "payments_open")
      ?.value === true;
    if (launchState !== "open" || !paymentsOpen) {
      return new Response(JSON.stringify({ error: "Payments are currently disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 403,
      });
    }

    const body = await req.json() as Record<string, unknown>;
    const planId = typeof body.plan_id === "string" ? body.plan_id : null;
    const bundleId = typeof body.bundle_id === "string" ? body.bundle_id : null;
    if ((planId ? 1 : 0) + (bundleId ? 1 : 0) !== 1) {
      throw new Error("Supply exactly one supported plan_id or bundle_id");
    }

    let resolvedPriceId: string;
    let resolvedMode: "subscription" | "payment";
    let resolvedPlanId: string | null = null;
    let resolvedBundle: { id: string; display_name: string; token_amount: number } | null = null;
    if (planId) {
      const plan = resolveSubscriptionPlan(planId);
      if (!plan) throw new Error("Unknown plan or subscription checkout is not configured");
      resolvedPriceId = plan.stripePriceId;
      resolvedMode = "subscription";
      resolvedPlanId = plan.id;
    } else {
      const { data: bundle, error: bundleErr } = await serviceClient
        .from("token_bundles")
        .select("id, display_name, token_amount, stripe_price_id, enabled")
        .eq("id", bundleId)
        .maybeSingle();
      if (bundleErr || !bundle || !bundle.enabled) throw new Error("Unknown or disabled bundle");
      if (!bundle.stripe_price_id) throw new Error("Bundle missing stripe_price_id (ops setup required)");
      resolvedPriceId = bundle.stripe_price_id;
      resolvedMode = "payment";
      resolvedBundle = bundle;
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // Resolve only through the verified Supabase-user mapping. Email searches
    // can attach checkout to the wrong legacy Stripe customer.
    const { data: customerLink, error: customerLinkError } = await serviceClient
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (customerLinkError) throw new Error("Unable to resolve Stripe customer link");

    let customerId: string | undefined = customerLink?.stripe_customer_id;
    if (!customerId) {
      const created = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = created.id;
    }

    // Persist the link so the webhook does not have to trust session metadata.
    const { error: customerLinkWriteError } = await serviceClient
      .from("stripe_customers")
      .upsert({
      stripe_customer_id: customerId,
      user_id: user.id,
      email: user.email,
      });
    if (customerLinkWriteError) {
      throw new Error("Unable to persist Stripe customer link");
    }

    const origin = resolveCheckoutOrigin(
      req.headers.get("origin"),
      Deno.env.get("CHECKOUT_ALLOWED_ORIGINS") ?? "",
    );

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: resolvedPriceId, quantity: 1 }],
      mode: resolvedMode,
      success_url: `${origin}/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pricing?checkout=canceled`,
      // Metadata is informational only. The webhook never trusts it.
      metadata: {
        supabase_user_id: user.id,
        plan_id: resolvedPlanId ?? "",
        bundle_id: resolvedBundle?.id ?? "",
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
