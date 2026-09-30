import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CYCLE_DURATIONS: Record<string, number> = {
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
  yearly: 365 * 24 * 60 * 60 * 1000,
};
const FEATURE_SUBSCRIPTIONS_ON_HOLD = true;

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
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (FEATURE_SUBSCRIPTIONS_ON_HOLD) {
      return new Response(
        JSON.stringify({
          error: "security_maintenance",
          message:
            "Feature subscriptions are temporarily paused while secure wallet transactions are upgraded.",
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const { action, feature_id, cycle, target_user_id } = body;

    // Admin actions use target_user_id, user actions use own id
    const isAdminAction = !!target_user_id;
    if (isAdminAction) {
      const { data: roleCheck } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (!roleCheck) {
        return new Response(JSON.stringify({ error: "Admin access required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const userId = isAdminAction ? target_user_id : user.id;

    if (action === "subscribe") {
      if (!feature_id || !cycle || !CYCLE_DURATIONS[cycle]) {
        return new Response(JSON.stringify({ error: "Invalid feature_id or cycle" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get feature config
      const { data: config } = await admin
        .from("feature_configs")
        .select("*")
        .eq("id", feature_id)
        .single();

      if (!config || !config.subscribable) {
        return new Response(JSON.stringify({ error: "Feature not subscribable" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const costKey = `${cycle}_cost` as string;
      const cost = (config as any)[costKey] as number;
      if (!cost || cost <= 0) {
        return new Response(JSON.stringify({ error: `No ${cycle} pricing set for this feature` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check balance
      const { data: wallet } = await admin
        .from("token_wallets")
        .select("balance")
        .eq("user_id", userId)
        .single();

      if (!wallet || wallet.balance < cost) {
        return new Response(JSON.stringify({ error: "Insufficient tokens" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check existing active subscription
      const { data: existing } = await admin
        .from("feature_subscriptions")
        .select("*")
        .eq("user_id", userId)
        .eq("feature_id", feature_id)
        .is("cancelled_at", null)
        .single();

      if (existing && new Date(existing.cycle_end) > new Date()) {
        return new Response(JSON.stringify({ error: "Already subscribed to this feature" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const now = new Date();
      const cycleEnd = new Date(now.getTime() + CYCLE_DURATIONS[cycle]);

      // Deduct tokens
      await admin
        .from("token_wallets")
        .update({ balance: wallet.balance - cost, updated_at: now.toISOString() })
        .eq("user_id", userId);

      // Upsert subscription
      await admin.from("feature_subscriptions").upsert({
        user_id: userId,
        feature_id,
        cycle,
        tokens_paid: cost,
        cycle_start: now.toISOString(),
        cycle_end: cycleEnd.toISOString(),
        auto_renew: true,
        cancelled_at: null,
        refund_amount: 0,
      }, { onConflict: "user_id,feature_id" });

      // Log transaction
      await admin.from("wallet_transactions").insert({
        user_id: userId,
        amount: -cost,
        label: `Feature subscription: ${feature_id} (${cycle})`,
        source: "subscription",
      });

      // Log usage
      await admin.from("feature_usage_log").insert({
        user_id: userId,
        action: `subscribe_${feature_id}`,
        tokens_spent: cost,
      });

      return new Response(
        JSON.stringify({ success: true, new_balance: wallet.balance - cost, cycle_end: cycleEnd.toISOString() }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "cancel") {
      if (!feature_id) {
        return new Response(JSON.stringify({ error: "Missing feature_id" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: sub } = await admin
        .from("feature_subscriptions")
        .select("*")
        .eq("user_id", userId)
        .eq("feature_id", feature_id)
        .is("cancelled_at", null)
        .single();

      if (!sub) {
        return new Response(JSON.stringify({ error: "No active subscription found" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const now = new Date();
      const cycleStart = new Date(sub.cycle_start);
      const cycleEnd = new Date(sub.cycle_end);
      const totalTime = cycleEnd.getTime() - cycleStart.getTime();
      const remainingTime = Math.max(0, cycleEnd.getTime() - now.getTime());
      const refund = Math.floor(sub.tokens_paid * (remainingTime / totalTime));

      // Refund tokens
      if (refund > 0) {
        const { data: wallet } = await admin
          .from("token_wallets")
          .select("balance")
          .eq("user_id", userId)
          .single();

        await admin
          .from("token_wallets")
          .update({ balance: (wallet?.balance ?? 0) + refund, updated_at: now.toISOString() })
          .eq("user_id", userId);

        await admin.from("wallet_transactions").insert({
          user_id: userId,
          amount: refund,
          label: `Subscription refund: ${feature_id} (prorated)`,
          source: "refund",
        });
      }

      // Mark cancelled
      await admin
        .from("feature_subscriptions")
        .update({ cancelled_at: now.toISOString(), refund_amount: refund })
        .eq("id", sub.id);

      // Get updated balance
      const { data: updatedWallet } = await admin
        .from("token_wallets")
        .select("balance")
        .eq("user_id", userId)
        .single();

      return new Response(
        JSON.stringify({ success: true, refund_amount: refund, new_balance: updatedWallet?.balance ?? 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "check_renewal") {
      // Check and renew expired subscriptions for this user
      const { data: subs } = await admin
        .from("feature_subscriptions")
        .select("*")
        .eq("user_id", userId)
        .is("cancelled_at", null)
        .eq("auto_renew", true);

      const now = new Date();
      const renewed: string[] = [];
      const expired: string[] = [];

      for (const sub of subs || []) {
        if (new Date(sub.cycle_end) > now) continue;

        // Get config for cost
        const { data: config } = await admin
          .from("feature_configs")
          .select("*")
          .eq("id", sub.feature_id)
          .single();

        if (!config || !config.subscribable) {
          expired.push(sub.feature_id);
          await admin.from("feature_subscriptions").update({ cancelled_at: now.toISOString() }).eq("id", sub.id);
          continue;
        }

        const cost = (config as any)[`${sub.cycle}_cost`] as number;
        const { data: wallet } = await admin.from("token_wallets").select("balance").eq("user_id", userId).single();

        if (!wallet || wallet.balance < cost) {
          expired.push(sub.feature_id);
          await admin.from("feature_subscriptions").update({ cancelled_at: now.toISOString() }).eq("id", sub.id);
          continue;
        }

        // Renew
        const newEnd = new Date(now.getTime() + CYCLE_DURATIONS[sub.cycle]);
        await admin.from("token_wallets").update({ balance: wallet.balance - cost, updated_at: now.toISOString() }).eq("user_id", userId);
        await admin.from("feature_subscriptions").update({
          cycle_start: now.toISOString(),
          cycle_end: newEnd.toISOString(),
          tokens_paid: cost,
        }).eq("id", sub.id);
        await admin.from("wallet_transactions").insert({
          user_id: userId,
          amount: -cost,
          label: `Subscription renewal: ${sub.feature_id} (${sub.cycle})`,
          source: "subscription",
        });
        renewed.push(sub.feature_id);
      }

      return new Response(
        JSON.stringify({ success: true, renewed, expired }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
