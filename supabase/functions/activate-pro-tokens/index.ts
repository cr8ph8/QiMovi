import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logGovernanceAction } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PRO_TOKEN_COST = 200;
const PRO_DURATION_DAYS = 30;
const PRO_MONTHLY_TOKENS = 200;
const TOKEN_PLAN_ACTIVATION_ON_HOLD = true;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify user
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    if (TOKEN_PLAN_ACTIVATION_ON_HOLD) {
      return new Response(
        JSON.stringify({
          error: "security_maintenance",
          message:
            "Token-based plan activation is temporarily paused while secure subscription billing is upgraded.",
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { action } = await req.json();
    if (!action || !["activate", "deactivate"].includes(action)) {
      throw new Error("Invalid action. Must be 'activate' or 'deactivate'.");
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Get current subscription
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("plan, stripe_subscription_id")
      .eq("user_id", user.id)
      .single();

    if (action === "activate") {
      // Must be on free plan
      if (sub?.plan !== "free") {
        throw new Error("You must be on the Free plan to activate Pro with tokens.");
      }

      // Check balance
      const { data: wallet } = await supabase
        .from("token_wallets")
        .select("balance")
        .eq("user_id", user.id)
        .single();

      if (!wallet || wallet.balance < PRO_TOKEN_COST) {
        throw new Error(`Insufficient tokens. You need ${PRO_TOKEN_COST} but have ${wallet?.balance ?? 0}.`);
      }

      // Spend tokens via add_tokens RPC (negative amount)
      const { data: newBalance, error: spendError } = await supabase.rpc("add_tokens", {
        p_user_id: user.id,
        p_amount: -PRO_TOKEN_COST,
        p_label: "Pro Plan — Token Activation (30 days)",
        p_source: "subscription",
      });
      if (spendError) throw new Error(spendError.message);

      // Set subscription to pro with 30-day period
      const now = new Date();
      const periodEnd = new Date(now.getTime() + PRO_DURATION_DAYS * 24 * 60 * 60 * 1000);

      const { error: updateError } = await supabase
        .from("subscriptions")
        .update({
          plan: "pro",
          stripe_subscription_id: "token_activated",
          current_period_start: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
          monthly_tokens_remaining: PRO_MONTHLY_TOKENS,
          status: "active",
          updated_at: now.toISOString(),
        })
        .eq("user_id", user.id);

      if (updateError) throw new Error(updateError.message);

      // Log subscription change
      await supabase.from("subscription_changes").insert({
        user_id: user.id,
        changed_by: user.id,
        old_plan: "free",
        new_plan: "pro",
      });

      // Audit log
      await logGovernanceAction({
        userId: user.id,
        action: "activate_pro_tokens",
        details: { tokens_spent: PRO_TOKEN_COST, period_end: periodEnd.toISOString(), new_balance: newBalance },
      });

      return new Response(
        JSON.stringify({ success: true, plan: "pro", period_end: periodEnd.toISOString(), new_balance: newBalance }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "deactivate") {
      // Must be token-activated pro
      if (sub?.plan !== "pro" || sub?.stripe_subscription_id !== "token_activated") {
        throw new Error("Can only deactivate a token-activated Pro plan.");
      }

      const { error: updateError } = await supabase
        .from("subscriptions")
        .update({
          plan: "free",
          stripe_subscription_id: null,
          current_period_start: null,
          current_period_end: null,
          monthly_tokens_remaining: 0,
          status: "active",
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);

      if (updateError) throw new Error(updateError.message);

      // Log
      await supabase.from("subscription_changes").insert({
        user_id: user.id,
        changed_by: user.id,
        old_plan: "pro",
        new_plan: "free",
      });

      await logGovernanceAction({
        userId: user.id,
        action: "deactivate_pro_tokens",
        details: { note: "No refund — tokens consumed at activation" },
      });

      // Get current balance for response
      const { data: wallet } = await supabase
        .from("token_wallets")
        .select("balance")
        .eq("user_id", user.id)
        .single();

      return new Response(
        JSON.stringify({ success: true, plan: "free", new_balance: wallet?.balance ?? 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new Error("Invalid action.");
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
