import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { logGovernanceAction } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Admin-only token crediting endpoint.
 *
 * SECURITY: This function MUST remain admin-only. Self-service token grants
 * (referral bonuses, upload rewards, etc.) must go through dedicated
 * server-side RPCs that credit a fixed, hard-coded amount — never through
 * this generic endpoint.
 *
 * Phase 1A: routes through credit_tokens_atomic with optional idempotency_key
 * so replays from admin retries do not double-credit.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await requireAdmin(req, corsHeaders);
    if (auth instanceof Response) return auth;
    const { admin, userId } = auth;

    const body = await req.json().catch(() => ({}));
    const {
      user_id,
      amount,
      label = "credit",
      source = "admin_grant",
      idempotency_key = null,
    } = body ?? {};

    if (!user_id || typeof user_id !== "string") {
      return new Response(
        JSON.stringify({ error: "user_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 1_000_000) {
      return new Response(
        JSON.stringify({ error: "amount must be a positive number ≤ 1,000,000" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data, error: rpcError } = await admin.rpc("credit_tokens_atomic", {
      p_user_id: user_id,
      p_amount: numericAmount,
      p_label: String(label).slice(0, 200),
      p_source: String(source).slice(0, 50),
      p_idempotency_key: idempotency_key ? String(idempotency_key).slice(0, 200) : null,
    });
    if (rpcError) throw new Error(rpcError.message);

    const row = Array.isArray(data) ? data[0] : data;

    await logGovernanceAction({
      userId: userId,
      action: "add_tokens",
      details: {
        target_user_id: user_id,
        amount: numericAmount,
        label,
        source,
        idempotency_key,
        replayed: row?.replayed ?? false,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        new_balance: row?.new_balance ?? null,
        transaction_id: row?.transaction_id ?? null,
        replayed: row?.replayed ?? false,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
