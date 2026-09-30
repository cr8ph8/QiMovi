// linear-update-issue
// Admin-only. Update state/assignee/priority or add a comment on an existing
// Linear issue. Mirror table is refreshed via the webhook receiver, so this
// function only forwards the mutation.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "https://esm.sh/zod@3.23.8";
import { commentOnIssue, hasLinearCredentials, updateLinearIssue } from "../_shared/linear.ts";
import { logGovernanceAction } from "../_shared/audit.ts";

const BodySchema = z.object({
  linear_id: z.string().min(1),
  state_id: z.string().optional(),
  assignee_id: z.string().optional(),
  priority: z.number().int().min(0).max(4).optional(),
  comment: z.string().max(20000).optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
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

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = parsed.data;

    if (!hasLinearCredentials()) {
      return new Response(JSON.stringify({ error: "linear_not_configured" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.state_id || body.assignee_id || typeof body.priority === "number") {
      await updateLinearIssue(body.linear_id, {
        stateId: body.state_id,
        assigneeId: body.assignee_id,
        priority: body.priority,
      });
    }
    if (body.comment) {
      await commentOnIssue(body.linear_id, body.comment);
    }

    await logGovernanceAction({
      userId: userRes.user.id,
      action: "linear.issue.update",
      target: { linear_id: body.linear_id },
      details: { has_comment: !!body.comment, state_id: body.state_id ?? null },
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[linear-update-issue]", e);
    return new Response(JSON.stringify({ error: "internal_error", message: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
