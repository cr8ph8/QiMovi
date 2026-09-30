import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logGovernanceAction } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// SECURITY CONTAINMENT: the legacy transfer used a read/update/credit
// sequence that could double-spend under concurrency. Re-enable only after
// the single-transaction transfer RPC is deployed.
const TOKEN_TRANSFERS_ON_HOLD = true;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (TOKEN_TRANSFERS_ON_HOLD) {
    return new Response(
      JSON.stringify({
        error: "Token transfers are temporarily unavailable while security upgrades are applied.",
        code: "security_maintenance",
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const { recipient_id, amount } = await req.json();
    if (!recipient_id || !amount || amount <= 0) throw new Error("Invalid transfer params");
    if (recipient_id === user.id) throw new Error("Cannot transfer to yourself");

    const supabase = createClient(supabaseUrl, serviceKey);

    // Debit sender
    const { data: senderWallet } = await supabase
      .from("token_wallets")
      .select("balance")
      .eq("user_id", user.id)
      .single();

    if (!senderWallet || senderWallet.balance < amount) {
      throw new Error("Insufficient balance");
    }

    await supabase
      .from("token_wallets")
      .update({ balance: senderWallet.balance - amount, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);

    // Credit recipient (compensating pattern)
    const { error: creditError } = await supabase.rpc("add_tokens", {
      p_user_id: recipient_id,
      p_amount: amount,
      p_label: `Transfer from user`,
      p_source: "transfer",
    });

    if (creditError) {
      // Refund sender
      await supabase
        .from("token_wallets")
        .update({ balance: senderWallet.balance, updated_at: new Date().toISOString() })
        .eq("user_id", user.id);
      throw new Error("Transfer failed, sender refunded");
    }

    // Log sender debit transaction
    await supabase.from("wallet_transactions").insert({
      user_id: user.id,
      amount: -amount,
      label: `Transfer to user`,
      source: "transfer",
    });

    // Audit
    await logGovernanceAction({
      userId: user.id,
      action: "transfer_tokens",
      details: { recipient_id, amount },
    });

    return new Response(
      JSON.stringify({ success: true, new_balance: senderWallet.balance - amount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unable to transfer tokens" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
