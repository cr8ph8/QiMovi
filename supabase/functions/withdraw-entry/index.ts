import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// SECURITY CONTAINMENT: deletion and refund previously happened as separate
// operations. Keep this endpoint fail-closed until one locked database
// transaction owns eligibility, deletion, credit, ledger, and idempotency.
serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      error: "security_maintenance",
      message:
        "Withdrawals are temporarily paused while atomic refunds are upgraded. Your entry and token balance remain unchanged.",
    }),
    {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
