import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logGovernanceAction } from "../_shared/audit.ts";
import { requireEntryOwner } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify the user
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const { amount, label = "Token spend", action, entry_id, model, idempotency_key } = await req.json();

    const supabase = createClient(supabaseUrl, serviceKey);

    // An entry ID affects prize-pool attribution and the usage ledger. Bind it
    // to the authenticated owner/admin before any service-role read or debit.
    if (entry_id) {
      const entryAccess = await requireEntryOwner(
        supabase,
        user.id,
        entry_id,
        corsHeaders,
      );
      if (entryAccess instanceof Response) return entryAccess;
    }

    // Look up authoritative token cost from feature_configs if action provided
    let finalAmount = amount;
    let requiredTier: string | null = null;
    if (action) {
      const { data: config } = await supabase
        .from("feature_configs")
        .select("token_cost, enabled, tier")
        .eq("id", action)
        .single();

      if (config) {
        if (!config.enabled) throw new Error("Feature is currently disabled");
        finalAmount = config.token_cost;
        requiredTier = config.tier || null;
      }
    }

    if (!finalAmount || finalAmount <= 0) throw new Error("Invalid amount");

    // Look up user's plan for discount and tier enforcement
    const discountMap: Record<string, number> = {
      free: 0, pro: 10, studio: 0,
    };
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("plan")
      .eq("user_id", user.id)
      .single();
    const userPlan = (sub?.plan as string) || "free";
    const planDiscount = discountMap[userPlan] || 0;

    // Enforce plan tier requirement
    if (requiredTier && requiredTier !== "free") {
      const tierOrder = ["free", "pro", "studio"];
      const userTierIndex = tierOrder.indexOf(userPlan);
      const requiredTierIndex = tierOrder.indexOf(requiredTier);
      if (userTierIndex < requiredTierIndex) {
        return new Response(
          JSON.stringify({ error: `This feature requires the ${requiredTier === "pro" ? "Pro" : "Studio"} plan` }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const discountedAmount = planDiscount > 0
      ? Math.ceil(finalAmount * (1 - planDiscount / 100))
      : finalAmount;

    // ── Look up model tier surcharge ──
    let surchargeMultiplier = 1.0;
    let surchargeTier = "standard";
    if (model) {
      // Look up model tier from ai_models
      const { data: modelRow } = await supabase
        .from("ai_models")
        .select("tier")
        .eq("id", model)
        .maybeSingle();
      const tier = modelRow?.tier || "standard";
      surchargeTier = tier;

      // Look up surcharge from model_surcharges
      const { data: surchargeRow } = await supabase
        .from("model_surcharges")
        .select("multiplier, flat_surcharge, enabled")
        .eq("tier", tier)
        .maybeSingle();

      if (surchargeRow && surchargeRow.enabled) {
        surchargeMultiplier = surchargeRow.multiplier || 1.0;
      }
    }

    const finalCharge = Math.ceil(discountedAmount * surchargeMultiplier);

    // ── Compute prize pool contribution first (pure read, no mutation) ──
    let prizeContribution = 0;
    let prizePct = 0;
    let entryCompetitionId: string | null = null;
    if (action && action.startsWith("entry_") && entry_id) {
      const { data: entryRow } = await supabase
        .from("entries")
        .select("competition_id")
        .eq("id", entry_id)
        .maybeSingle();
      if (entryRow?.competition_id) {
        entryCompetitionId = entryRow.competition_id;
        const { data: pool } = await supabase
          .from("prize_pools")
          .select("contribution_pct")
          .eq("competition_id", entryCompetitionId)
          .maybeSingle();
        prizePct = pool?.contribution_pct ?? 5;
        prizeContribution = Math.floor(finalCharge * prizePct / 100);
      }
    }

    const surchargeLabel = surchargeMultiplier > 1 ? ` (${surchargeMultiplier}× ${surchargeTier})` : "";
    const discountLabel = planDiscount > 0 ? ` (${planDiscount}% off)` : "";
    const prizeLabel = prizeContribution > 0 ? ` (incl. ${prizeContribution}⊘ prize pool)` : "";
    const txLabel = `${label}${discountLabel}${surchargeLabel}${prizeLabel}`;

    // ── Atomic debit via SECURITY DEFINER RPC (balance check + decrement + tx insert) ──
    // Browser retry keys live in a user-and-operation namespace. They can no
    // longer collide with trusted credit/refund keys such as stripe_session:*
    // or withdraw-entry:* in the globally unique wallet ledger.
    const spendIdempotencyKey = idempotency_key
      ? `user-spend:${user.id}:${String(idempotency_key).slice(0, 120)}`
      : null;
    const { data: spendData, error: spendErr } = await supabase.rpc("spend_tokens_atomic", {
      p_user_id: user.id,
      p_amount: finalCharge,
      p_label: txLabel,
      p_source: "user",
      p_idempotency_key: spendIdempotencyKey,
    });
    if (spendErr) {
      const msg = spendErr.message || "spend_failed";
      const status = msg.includes("insufficient_balance") ? 402 : 400;
      return new Response(
        JSON.stringify({ error: msg }),
        { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const spendRow = Array.isArray(spendData) ? spendData[0] : spendData;
    const newBalance = spendRow?.new_balance ?? null;
    const replayed = spendRow?.replayed ?? false;

    // ── Apply prize pool contribution post-debit (informational, no extra charge) ──
    if (!replayed && prizeContribution > 0 && entryCompetitionId) {
      const { data: existingPool } = await supabase
        .from("prize_pools")
        .select("total_tokens")
        .eq("competition_id", entryCompetitionId)
        .maybeSingle();
      if (existingPool) {
        await supabase
          .from("prize_pools")
          .update({
            total_tokens: existingPool.total_tokens + prizeContribution,
            updated_at: new Date().toISOString(),
          })
          .eq("competition_id", entryCompetitionId);
      } else {
        await supabase.from("prize_pools").insert({
          competition_id: entryCompetitionId,
          contribution_pct: prizePct,
          total_tokens: prizeContribution,
        });
      }
      // Informational record (zero amount) for human-readable ledger context.
      await supabase.from("wallet_transactions").insert({
        user_id: user.id,
        amount: 0,
        label: `Prize pool allocation: ${prizeContribution}⊘ (${prizePct}% of ${finalCharge}⊘)`,
        source: "prize_pool",
      });
    }

    // Log feature usage
    if (action) {
      await supabase.from("feature_usage_log").insert({
        user_id: user.id,
        action,
        tokens_spent: finalCharge,
        entry_id: entry_id || null,
        metadata: model ? { model, surcharge_multiplier: surchargeMultiplier, tier: surchargeTier } : {},
      });
    }

    // Log audit
    await logGovernanceAction({
      userId: user.id,
      action: "spend_tokens",
      details: {
        original_amount: finalAmount,
        discounted_amount: discountedAmount,
        surcharge_multiplier: surchargeMultiplier,
        surcharge_tier: surchargeTier,
        final_charge: finalCharge,
        discount_percent: planDiscount,
        model: model || null,
        label,
        feature_action: action || null,
        prize_contribution: prizeContribution,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        new_balance: newBalance,
        final_charge: finalCharge,
        discounted_amount: discountedAmount,
        discount_percent: planDiscount,
        surcharge_multiplier: surchargeMultiplier,
        surcharge_tier: surchargeTier,
        prize_contribution: prizeContribution,
        replayed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unable to spend tokens" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
