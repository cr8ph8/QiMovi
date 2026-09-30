// Restores a previously snapshotted Character Diamond from
// character_diamond_versions. Writes audit_log and a kernel-run row.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { spendTokens, writeAudit, newCorrelationId } from "../_shared/kernel-ops.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RESTORABLE_FIELDS = [
  "north_star", "counter_star", "flaw_mask", "non_negotiable",
  "epistemic", "normative", "affective", "relational",
  "confidence", "model_version",
] as const;
const CHARACTER_ROLLBACK_ON_HOLD = true;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (CHARACTER_ROLLBACK_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "Character rollback is temporarily paused during a security upgrade.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const versionId = String(body?.version_id ?? "").trim();
    if (!versionId) {
      return new Response(JSON.stringify({ error: "version_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const spend = await spendTokens({
      authHeader,
      action: "character_rollback",
      label: "Character Diamond rollback",
    });
    if (!spend.ok) {
      return new Response(JSON.stringify({ error: spend.error || "Token spend failed" }), {
        status: spend.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: version, error: vErr } = await admin
      .from("character_diamond_versions")
      .select("*")
      .eq("id", versionId)
      .maybeSingle();
    if (vErr || !version) {
      return new Response(JSON.stringify({ error: "Version not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const snap = (version.snapshot ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const f of RESTORABLE_FIELDS) if (f in snap) patch[f] = snap[f];
    patch["verifier_state"] = "stable";
    patch["last_verified_at"] = new Date().toISOString();
    patch["source"] = "rollback";

    await admin.from("character_diamonds").update(patch).eq("id", version.diamond_id);

    const correlationId = newCorrelationId("chrollback");
    await admin.from("character_kernel_runs").insert({
      entry_id: version.entry_id,
      diamond_id: version.diamond_id,
      character_name: String(snap?.character_name ?? "unknown"),
      function_name: "rollback-character-diamond",
      decision: "rollback",
      correlation_id: correlationId,
      user_id: user.id,
      notes: `restored from version ${versionId}`,
    });

    await writeAudit({
      user_id: user.id,
      action: "character_kernel.rollback",
      details: {
        entry_id: version.entry_id,
        diamond_id: version.diamond_id,
        version_id: versionId,
        correlation_id: correlationId,
      },
    });

    return new Response(JSON.stringify({ ok: true, diamond_id: version.diamond_id, correlation_id: correlationId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[rollback-character-diamond] error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
