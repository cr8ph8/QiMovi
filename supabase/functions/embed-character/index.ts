// Character embeddings remain unavailable until the governed AI router exposes
// a first-class embeddings operation. Keeping this endpoint as an authenticated
// maintenance response prevents raw provider calls from bypassing policy,
// routing, and usage logging.

import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await requireUser(req, corsHeaders);
    if (auth instanceof Response) return auth;

    return new Response(JSON.stringify({
      error: "security_maintenance",
      message: "Character embedding is temporarily paused during a security upgrade.",
    }), {
      status: 503,
      headers: jsonHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[embed-character] maintenance gate error:", message);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
