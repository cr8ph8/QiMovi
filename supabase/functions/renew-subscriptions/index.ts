import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrService } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CYCLE_DURATIONS: Record<string, number> = {
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
  yearly: 365 * 24 * 60 * 60 * 1000,
};
const FEATURE_SUBSCRIPTION_RENEWALS_ON_HOLD = true;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Only admins or trusted server-side cron (service-role bearer) may run this.
    const auth = await requireAdminOrService(req, corsHeaders);
    if (auth instanceof Response) return auth;

    if (FEATURE_SUBSCRIPTION_RENEWALS_ON_HOLD) {
      return new Response(
        JSON.stringify({
          error: "security_maintenance",
          message:
            "Automatic feature-subscription renewals are temporarily paused while secure wallet transactions are upgraded.",
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);


    const now = new Date();

    // Fetch all expired, auto-renew, non-cancelled subscriptions
    const { data: expiredSubs, error: fetchErr } = await admin
      .from("feature_subscriptions")
      .select("*")
      .is("cancelled_at", null)
      .eq("auto_renew", true)
      .lt("cycle_end", now.toISOString());

    if (fetchErr) throw fetchErr;

    const renewed: string[] = [];
    const expired: string[] = [];

    for (const sub of expiredSubs || []) {
      const { data: config } = await admin
        .from("feature_configs")
        .select("*")
        .eq("id", sub.feature_id)
        .single();

      if (!config || !config.subscribable) {
        expired.push(`${sub.user_id}:${sub.feature_id}`);
        await admin.from("feature_subscriptions")
          .update({ cancelled_at: now.toISOString() })
          .eq("id", sub.id);
        await admin.from("user_notifications").insert({
          user_id: sub.user_id,
          title: "Subscription Expired",
          message: `Your ${sub.cycle} subscription to "${sub.feature_id}" has been cancelled because the feature is no longer available.`,
          type: "warning",
          metadata: { feature_id: sub.feature_id, reason: "feature_unavailable" },
        });
        continue;
      }

      const cost = (config as any)[`${sub.cycle}_cost`] as number;
      if (!cost || cost <= 0) {
        expired.push(`${sub.user_id}:${sub.feature_id}`);
        await admin.from("feature_subscriptions")
          .update({ cancelled_at: now.toISOString() })
          .eq("id", sub.id);
        await admin.from("user_notifications").insert({
          user_id: sub.user_id,
          title: "Subscription Expired",
          message: `Your ${sub.cycle} subscription to "${sub.feature_id}" has been cancelled because pricing is no longer available.`,
          type: "warning",
          metadata: { feature_id: sub.feature_id, reason: "no_pricing" },
        });
        continue;
      }

      // Check user balance
      const { data: wallet } = await admin
        .from("token_wallets")
        .select("balance")
        .eq("user_id", sub.user_id)
        .single();

      if (!wallet || wallet.balance < cost) {
        expired.push(`${sub.user_id}:${sub.feature_id}`);
        await admin.from("feature_subscriptions")
          .update({ cancelled_at: now.toISOString() })
          .eq("id", sub.id);
        await admin.from("user_notifications").insert({
          user_id: sub.user_id,
          title: "Subscription Expired — Insufficient Tokens",
          message: `Your ${sub.cycle} subscription to "${sub.feature_id}" could not be renewed. You needed ${cost} tokens but only had ${wallet?.balance ?? 0}. Add tokens and resubscribe to continue.`,
          type: "error",
          metadata: { feature_id: sub.feature_id, reason: "insufficient_tokens", cost, balance: wallet?.balance ?? 0 },
        });
        continue;
      }

      // Renew: deduct tokens and extend cycle
      const newEnd = new Date(now.getTime() + CYCLE_DURATIONS[sub.cycle]);

      await admin.from("token_wallets")
        .update({ balance: wallet.balance - cost, updated_at: now.toISOString() })
        .eq("user_id", sub.user_id);

      await admin.from("feature_subscriptions")
        .update({
          cycle_start: now.toISOString(),
          cycle_end: newEnd.toISOString(),
          tokens_paid: cost,
        })
        .eq("id", sub.id);

      await admin.from("wallet_transactions").insert({
        user_id: sub.user_id,
        amount: -cost,
        label: `Auto-renewal: ${sub.feature_id} (${sub.cycle})`,
        source: "subscription",
      });

      await admin.from("user_notifications").insert({
        user_id: sub.user_id,
        title: "Subscription Renewed",
        message: `Your ${sub.cycle} subscription to "${sub.feature_id}" has been auto-renewed for ${cost} tokens. Next renewal: ${newEnd.toLocaleDateString()}.`,
        type: "success",
        metadata: { feature_id: sub.feature_id, cost, new_balance: wallet.balance - cost, cycle_end: newEnd.toISOString() },
      });

      renewed.push(`${sub.user_id}:${sub.feature_id}`);
    }

    console.log(`Renewal complete: ${renewed.length} renewed, ${expired.length} expired`);

    return new Response(
      JSON.stringify({ success: true, renewed: renewed.length, expired: expired.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Renewal error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
