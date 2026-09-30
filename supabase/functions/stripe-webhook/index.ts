// Stripe webhook — the ONLY place that credits tokens or activates subscriptions
// after Stripe signature verification.
//
// Security model:
// - verify_jwt = false (Stripe cannot send a Supabase JWT)
// - Signature is verified with STRIPE_WEBHOOK_SECRET
// - Token amounts come from server-owned `token_bundles`, never request metadata
// - User resolved via `stripe_customers` link, NEVER trusts metadata.user_id
// - All credits flow through `credit_tokens_atomic` with stripe_session_id as
//   idempotency_key, so Stripe retries are safe.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { logGovernanceAction } from "../_shared/audit.ts";
import { resolveSubscriptionPlanByPrice } from "../_shared/commerce.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "stripe-signature, content-type",
};

const log = (step: string, details?: unknown) => {
  const d = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[STRIPE-WEBHOOK] ${step}${d}`);
};

async function persistSubscriptionState(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  state: {
    plan: "free" | "pro";
    status: string;
    stripe_subscription_id: string | null;
    current_period_end: string | null;
  },
) {
  const { data, error } = await supabase
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
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!stripeKey || !webhookSecret) {
    log("missing_config", { hasStripeKey: !!stripeKey, hasWebhookSecret: !!webhookSecret });
    return new Response(
      JSON.stringify({ error: "stripe_webhook_not_configured" }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return new Response(JSON.stringify({ error: "missing_signature" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, sig, webhookSecret);
  } catch (err) {
    log("signature_verification_failed", { message: (err as Error).message });
    return new Response(JSON.stringify({ error: "invalid_signature" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    log("event_received", { type: event.type, id: event.id });

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(stripe, supabase, session);
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const eventSubscription = event.data.object as Stripe.Subscription;
        // Signed events may still arrive out of order. Re-read Stripe's
        // current object so a delayed active event cannot undo cancellation.
        const currentSubscription = await stripe.subscriptions.retrieve(
          eventSubscription.id,
        );
        await handleSubscriptionChange(supabase, currentSubscription);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await handleSubscriptionCanceled(stripe, supabase, sub);
        break;
      }
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        log("invoice_payment_failed", { invoice_id: inv.id, customer: inv.customer });
        break;
      }
      default:
        log("event_ignored", { type: event.type });
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("handler_error", { type: event.type, message: msg });
    // Return 500 so Stripe retries.
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function resolveUserId(
  supabase: ReturnType<typeof createClient>,
  stripeCustomerId: string,
  fallbackEmail: string | null,
): Promise<string | null> {
  // 1. stripe_customers link table
  const { data: link, error: linkError } = await supabase
    .from("stripe_customers")
    .select("user_id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();
  if (linkError) throw new Error(`customer_link_lookup_failed: ${linkError.message}`);
  if (link?.user_id) return link.user_id as string;

  // 2. Fallback: profiles by email (only if email is provided and matches one user)
  if (fallbackEmail) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id")
      .ilike("email", fallbackEmail)
      .maybeSingle();
    if (profile?.user_id) {
      // Backfill the link so next time we don't need email
      const { error: backfillError } = await supabase
        .from("stripe_customers")
        .upsert({
          stripe_customer_id: stripeCustomerId,
          user_id: profile.user_id,
          email: fallbackEmail,
        });
      if (backfillError) {
        throw new Error(`customer_link_backfill_failed: ${backfillError.message}`);
      }
      return profile.user_id as string;
    }
  }
  return null;
}

async function handleCheckoutCompleted(
  stripe: Stripe,
  supabase: ReturnType<typeof createClient>,
  session: Stripe.Checkout.Session,
) {
  log("checkout_completed_start", { session_id: session.id, mode: session.mode });

  if (session.payment_status !== "paid" && session.mode !== "subscription") {
    log("skip_unpaid", { session_id: session.id });
    return;
  }

  const customerId = typeof session.customer === "string"
    ? session.customer
    : session.customer?.id ?? null;
  if (!customerId) {
    log("no_customer_on_session", { session_id: session.id });
    return;
  }

  const email = session.customer_details?.email ?? session.customer_email ?? null;
  const userId = await resolveUserId(supabase, customerId, email);
  if (!userId) {
    log("user_not_resolved", { session_id: session.id, customerId, email });
    throw new Error("user_not_resolved");
  }

  if (session.mode === "payment") {
    // Resolve bundle from line items → price → token_bundles (server-owned).
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 5 });
    const priceId = items.data[0]?.price?.id ?? null;
    if (!priceId) throw new Error("no_price_on_session");

    const { data: bundle, error: bundleError } = await supabase
      .from("token_bundles")
      .select("id, display_name, token_amount, price_cents")
      .eq("stripe_price_id", priceId)
      .eq("enabled", true)
      .maybeSingle();

    if (bundleError) throw new Error(`bundle_lookup_failed: ${bundleError.message}`);

    if (!bundle) {
      log("bundle_not_found", { session_id: session.id, priceId });
      throw new Error("bundle_not_found_for_price");
    }

    const idemKey = `stripe_session:${session.id}`;
    const { data: creditRows, error: creditErr } = await supabase.rpc("credit_tokens_atomic", {
      p_user_id: userId,
      p_amount: bundle.token_amount,
      p_label: `${bundle.display_name} bundle purchase`,
      p_source: "stripe",
      p_idempotency_key: idemKey,
    });
    if (creditErr) throw new Error(`credit_failed: ${creditErr.message}`);

    const row = Array.isArray(creditRows) ? creditRows[0] : creditRows;
    log("tokens_credited", { userId, amount: bundle.token_amount, replayed: row?.replayed });

    // Idempotent purchase record
    const { error: purchaseError } = await supabase
      .from("purchases")
      .upsert({
        user_id: userId,
        bundle_name: bundle.id,
        token_amount: bundle.token_amount,
        price_cents: session.amount_total ?? bundle.price_cents,
        stripe_session_id: session.id,
        status: "completed",
      }, { onConflict: "stripe_session_id" });
    if (purchaseError) throw new Error(`purchase_record_failed: ${purchaseError.message}`);

    return;
  }

  if (session.mode === "subscription") {
    const subscriptionId = session.subscription as string;
    if (!subscriptionId) throw new Error("subscription_id_missing");
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    await handleSubscriptionChange(supabase, sub, userId);
    return;
  }
}

async function handleSubscriptionChange(
  supabase: ReturnType<typeof createClient>,
  sub: Stripe.Subscription,
  knownUserId?: string,
) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const userId = knownUserId ?? (await resolveUserId(supabase, customerId, null));
  if (!userId) {
    log("subscription_user_not_resolved", { subscription_id: sub.id, customerId });
    throw new Error("user_not_resolved");
  }

  const periodEnd = new Date(sub.current_period_end * 1000).toISOString();
  const priceId = sub.items.data[0]?.price?.id ?? null;
  const recognizedPlan = resolveSubscriptionPlanByPrice(priceId);
  if (!recognizedPlan) {
    log("subscription_price_rejected", { subscription_id: sub.id, priceId });
    throw new Error("unrecognized_subscription_price");
  }
  const plan = sub.status === "active" || sub.status === "trialing"
    ? recognizedPlan.id
    : "free";

  await persistSubscriptionState(supabase, userId, {
    plan,
    stripe_subscription_id: sub.id,
    current_period_end: periodEnd,
    status: sub.status,
  });

  await logGovernanceAction({
    userId: userId,
    action: "subscription_updated_via_webhook",
    details: {
      subscription_id: sub.id,
      status: sub.status,
      plan,
      price_id: priceId,
      period_end: periodEnd,
    },
  });

  log("subscription_synced", { userId, status: sub.status, plan, priceId });
}

async function handleSubscriptionCanceled(
  stripe: Stripe,
  supabase: ReturnType<typeof createClient>,
  sub: Stripe.Subscription,
) {
  const canceledPriceId = sub.items.data[0]?.price?.id ?? null;
  if (!resolveSubscriptionPlanByPrice(canceledPriceId)) {
    log("unrecognized_subscription_cancel_ignored", {
      subscription_id: sub.id,
      priceId: canceledPriceId,
    });
    return;
  }

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const userId = await resolveUserId(supabase, customerId, null);
  if (!userId) throw new Error("subscription_user_not_resolved");

  // A customer can have overlapping subscriptions during plan changes. Do
  // not downgrade while another recognized plan is still active or trialing.
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  });
  const remainingRecognized = subscriptions.data.find((candidate) => {
    if (candidate.id === sub.id) return false;
    if (candidate.status !== "active" && candidate.status !== "trialing") return false;
    return resolveSubscriptionPlanByPrice(candidate.items.data[0]?.price?.id) !== null;
  });
  if (remainingRecognized) {
    await handleSubscriptionChange(supabase, remainingRecognized, userId);
    return;
  }

  await persistSubscriptionState(supabase, userId, {
    plan: "free",
    status: "canceled",
    stripe_subscription_id: sub.id,
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
  });

  await logGovernanceAction({
    userId: userId,
    action: "subscription_canceled_via_webhook",
    details: { subscription_id: sub.id, price_id: canceledPriceId },
  });
}
