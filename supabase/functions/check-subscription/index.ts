import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { resolveSubscriptionPlanByPrice } from "../_shared/commerce.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[CHECK-SUBSCRIPTION] ${step}${detailsStr}`);
};

async function persistSubscriptionState(
  supabaseClient: ReturnType<typeof createClient>,
  userId: string,
  state: {
    plan: "free" | "pro";
    status: string;
    stripe_subscription_id: string | null;
    current_period_end: string | null;
  },
) {
  const { data, error } = await supabaseClient
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        ...state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select("user_id")
    .single();

  if (error || !data) {
    throw new Error(`subscription_sync_failed: ${error?.message ?? "no row returned"}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { userId: user.id, email: user.email });

    const { data: customerLink, error: customerLinkError } = await supabaseClient
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (customerLinkError) throw new Error("Unable to resolve Stripe customer link");
    if (!customerLink?.stripe_customer_id) {
      // No verified Stripe association means no verified paid entitlement.
      // Fail closed locally instead of leaving a stale Pro row active.
      await persistSubscriptionState(supabaseClient, user.id, {
        plan: "free",
        status: "unverified",
        stripe_subscription_id: null,
        current_period_end: null,
      });
      logStep("No verified Stripe customer link found; downgraded locally");
      return new Response(JSON.stringify({ subscribed: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const customerId = customerLink.stripe_customer_id as string;
    logStep("Found verified Stripe customer link", { customerId });

    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10,
    });

    const recognizedSubscription = subscriptions.data.find((subscription) => {
      const isActive = subscription.status === "active" || subscription.status === "trialing";
      const priceId = subscription.items.data[0]?.price?.id ?? null;
      return isActive && resolveSubscriptionPlanByPrice(priceId) !== null;
    });
    const hasActiveSub = Boolean(recognizedSubscription);
    let productId = null;
    let subscriptionEnd = null;
    let stripeSubId = null;

    if (hasActiveSub) {
      const subscription = recognizedSubscription!;
      stripeSubId = subscription.id;
      subscriptionEnd = new Date(subscription.current_period_end * 1000).toISOString();
      const price = subscription.items.data[0].price;
      productId = price.product;
      logStep("Recognized active subscription found", {
        subscriptionId: stripeSubId,
        priceId: price.id,
        endDate: subscriptionEnd,
      });

      await persistSubscriptionState(supabaseClient, user.id, {
        plan: "pro",
        stripe_subscription_id: stripeSubId,
        current_period_end: subscriptionEnd,
        status: subscription.status,
      });
      logStep("Synced subscription to DB");
    } else {
      // The Stripe list call succeeded and no configured active/trialing price
      // exists, so a previous local Pro entitlement must not survive.
      await persistSubscriptionState(supabaseClient, user.id, {
        plan: "free",
        status: "inactive",
        stripe_subscription_id: null,
        current_period_end: null,
      });
      logStep("No recognized active subscription found; downgraded locally");
    }

    return new Response(
      JSON.stringify({
        subscribed: hasActiveSub,
        subscription_id: stripeSubId,
        product_id: productId,
        subscription_end: subscriptionEnd,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
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
