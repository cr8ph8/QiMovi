// Server-side logger for unauthorized Admin Control / OPS route attempts.
// Captures the requester's IP and User-Agent at the edge (which the browser
// cannot supply itself) and writes a `denied` row to `auth_audit_log` using
// the service role, bypassing the table's "no direct inserts" policy.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";

const BodySchema = z.object({
  // `submit_blocked` is emitted by src/lib/logSubmitBlocked.ts when the
  // submission portal short-circuits (closed gate, insufficient tokens,
  // etc.). Keep this enum in sync with SubmitBlockedReason on the client.
  event_type: z.enum(["admin_route", "judge_route", "entrant_route", "ops_badge", "submit_blocked"]),
  resource: z.string().max(512).optional(),
  reason: z.string().max(512).optional(),
  details: z.record(z.any()).optional(),
});


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Resolve user (if any) from forwarded auth header.
  let userId: string | null = null;
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const { data } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
      userId = data.user?.id ?? null;
    } catch { /* anonymous */ }
  }

  const xff = req.headers.get("x-forwarded-for") ?? "";
  const ip = xff.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || null;
  const ua = req.headers.get("user-agent") ?? null;

  const { error } = await admin.from("auth_audit_log").insert({
    user_id: userId,
    event_type: parsed.data.event_type,
    decision: "denied",
    resource: parsed.data.resource ?? null,
    reason: parsed.data.reason ?? null,
    details: parsed.data.details ?? {},
    ip_address: ip,
    user_agent: ua,
  });

  if (error) {
    console.error("auth_audit_log insert failed", error);
    return new Response(JSON.stringify({ error: "log failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
