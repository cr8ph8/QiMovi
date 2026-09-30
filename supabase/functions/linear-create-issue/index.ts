// linear-create-issue
// Internal-only edge function. Creates a Linear issue via the gateway, mirrors
// it into `linear_tickets`, and writes one audit_log row. Idempotent on
// (source, source_table, source_record_id) via the upsert_linear_ticket RPC.
//
// Authentication: caller must be an authenticated admin OR provide the
// service role key (used by other edge functions calling this internally).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "https://esm.sh/zod@3.23.8";
import {
  createLinearIssue,
  hasLinearCredentials,
  mirrorIssue,
  resolveLabelIds,
  resolveTeamId,
  type LinearTeamSlot,
} from "../_shared/linear.ts";
import { logGovernanceAction } from "../_shared/audit.ts";

const BodySchema = z.object({
  source: z.enum(["submission", "ai_failure", "support", "manual", "governance"]),
  source_table: z.string().nullable().optional(),
  source_record_id: z.string().uuid().nullable().optional(),
  team_slot: z.enum(["review_ops", "ai_systems", "support", "product"]),
  title: z.string().min(1).max(255),
  description: z.string().max(20000).optional(),
  label_slugs: z.array(z.string()).default([]),
  priority: z.number().int().min(0).max(4).optional(),
  correlation_id: z.string().nullable().optional(),
  // Dedup + cooldown. When dedup_key is set, repeated calls within
  // cooldown_minutes collapse into the existing ticket instead of creating
  // a new Linear issue. Recommended for governance_events callers.
  dedup_key: z.string().min(1).max(255).nullable().optional(),
  cooldown_minutes: z.number().int().min(1).max(1440).default(30),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const isServiceCall = authHeader.includes(serviceKey);

    let callerUserId: string | null = null;
    if (!isServiceCall) {
      const userClient = createClient(url, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userRes } = await userClient.auth.getUser();
      if (!userRes?.user) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const admin = createClient(url, serviceKey);
      const { data: roleRow } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", userRes.user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (!roleRow) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      callerUserId = userRes.user.id;
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = parsed.data;

    if (!hasLinearCredentials()) {
      return new Response(
        JSON.stringify({ error: "linear_not_configured", message: "Link the Linear connector first." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(url, serviceKey);

    // Dedup + cooldown gate. If a dedup_key is provided and the RPC says
    // 'increment' or 'throttle', we do NOT call Linear — we just bump the
    // existing row's counters and return.
    if (body.dedup_key) {
      const { data: gate, error: gateErr } = await admin.rpc(
        "linear_dedupe_or_throttle",
        {
          p_dedup_key: body.dedup_key,
          p_cooldown_minutes: body.cooldown_minutes,
          p_title: body.title,
          p_source: body.source,
          p_source_table: body.source_table ?? null,
          p_source_record_id: body.source_record_id ?? null,
          p_correlation_id: body.correlation_id ?? null,
          p_labels: body.label_slugs,
          p_payload: { title: body.title, team_slot: body.team_slot },
        },
      );
      if (gateErr) {
        console.error("[linear-create-issue] dedupe rpc failed", gateErr);
        return new Response(
          JSON.stringify({ error: "dedupe_failed", message: gateErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const action = (gate as { action?: string })?.action;
      if (action === "increment" || action === "throttle") {
        return new Response(
          JSON.stringify({ ok: true, deduped: true, ...gate }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // action === 'create' → fall through and actually create the Linear issue.
    }

    const teamId = await resolveTeamId(body.team_slot as LinearTeamSlot);
    if (!teamId) {
      return new Response(
        JSON.stringify({
          error: "team_not_configured",
          message: `Set site_settings key linear.team.${body.team_slot} to the Linear team UUID.`,
        }),
        { status: 412, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const labelIds = await resolveLabelIds(body.label_slugs);

    const issue = await createLinearIssue({
      teamId,
      title: body.title,
      description: body.description,
      labelIds: labelIds.length ? labelIds : undefined,
      priority: body.priority,
    });

    await mirrorIssue({
      source: body.source,
      sourceTable: body.source_table ?? null,
      sourceRecordId: body.source_record_id ?? null,
      issue,
      labels: body.label_slugs,
      correlationId: body.correlation_id ?? null,
      payload: { title: body.title, team_slot: body.team_slot },
    });

    // If this came in through the dedupe gate, backfill the stub row with
    // the real Linear identifiers so the next call within the cooldown
    // window can short-circuit cleanly.
    if (body.dedup_key) {
      await admin
        .from("linear_tickets")
        .update({
          linear_id: issue.id,
          identifier: issue.identifier,
          url: issue.url,
          state: issue.state ?? null,
        })
        .eq("dedup_key", body.dedup_key);
    }

    await logGovernanceAction({
      userId: callerUserId,
      action: "linear.issue.create",
      target: { linear_id: issue.id, identifier: issue.identifier, source: body.source },
      details: { team_slot: body.team_slot, labels: body.label_slugs },
    });

    return new Response(
      JSON.stringify({ ok: true, issue }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[linear-create-issue]", e);
    return new Response(
      JSON.stringify({ error: "internal_error", message: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
