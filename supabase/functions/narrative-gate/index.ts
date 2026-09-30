// Narrative Gate — pure deterministic continuity verdict over an entry/draft.
// No LLM. Reads character_belief_events (authored + extracted), runs the
// shared invariant evaluator, persists one provenance_nodes row + one
// governance_events row (hash-chained by trigger). Mirrors verdict to
// project_artifacts when project_lifecycle_v2 is on.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  evaluateInvariants,
  INVARIANTS_VERSION,
  type ContinuityEvent,
  type EventKind,
} from "../_shared/narrative-invariants.ts";
import { logGovernanceAction } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NARRATIVE_GATE_ON_HOLD = true;

interface Body {
  entry_id?: string;
  draft_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anonKey) {
    return new Response(JSON.stringify({ error: "missing supabase env" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Identify caller
  const authHeader = req.headers.get("authorization") ?? "";
  const authedClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await authedClient.auth.getUser();
  const user = userData?.user;
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (NARRATIVE_GATE_ON_HOLD) {
    return new Response(JSON.stringify({
      error: "security_maintenance",
      message: "Narrative gate processing is temporarily paused during a security upgrade.",
    }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Body;
  try { body = await req.json(); } catch { body = {}; }
  if (!body.entry_id && !body.draft_id) {
    return new Response(JSON.stringify({ error: "entry_id or draft_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(url, serviceKey);

  // Resolve entry_id (gate is anchored on entries — drafts resolve to source_entry_id when present)
  let entryId = body.entry_id ?? null;
  if (!entryId && body.draft_id) {
    const { data: draft } = await admin
      .from("screenplay_drafts")
      .select("source_entry_id")
      .eq("id", body.draft_id)
      .maybeSingle();
    entryId = (draft as any)?.source_entry_id ?? null;
  }
  if (!entryId) {
    return new Response(JSON.stringify({
      verdict: "PASS",
      violations: [],
      invariants_version: INVARIANTS_VERSION,
      state_root: "",
      scene_count: 0,
      event_count: 0,
      note: "no entry anchor — gate skipped for unsubmitted draft",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Load events. evidence_json may carry scene_ref/scene_order/object/actors
  // for extracted events; authored rows that lack those fields are ignored
  // safely by the evaluator (no scene_ref → grouped under "unscoped").
  const { data: rows, error: loadErr } = await admin
    .from("character_belief_events")
    .select("id, turn_label, kind, event_kind, source, evidence, scene_ref")
    .eq("entry_id", entryId);

  if (loadErr) {
    return new Response(JSON.stringify({ error: loadErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const events: ContinuityEvent[] = (rows ?? [])
    .filter((r: any) => r.event_kind)
    .map((r: any) => {
      const ev = (r.evidence ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        scene_ref: (r.scene_ref ?? ev.scene_ref ?? r.turn_label ?? "unscoped") as string,
        scene_order: Number(ev.scene_order ?? 0),
        event_kind: r.event_kind as EventKind,
        actors: Array.isArray(ev.actors) ? (ev.actors as string[]) : [],
        object: (ev.object as string | undefined) ?? null,
        source: r.source as "authored" | "extracted" | undefined,
        confidence: ev.confidence as number | undefined,
      };
    });

  const verdict = await evaluateInvariants(events);

  // Persist provenance node
  const { data: node, error: nodeErr } = await admin
    .from("provenance_nodes")
    .insert({
      entry_id: entryId,
      node_type: "gate_run",
      label: `narrative_gate · ${verdict.verdict}`,
      metadata_json: {
        verdict: verdict.verdict,
        violations: verdict.violations,
        invariants_version: verdict.invariants_version,
        state_root: verdict.state_root,
        scene_count: verdict.scene_count,
        event_count: verdict.event_count,
        triggered_by: user.id,
      },
    })
    .select("id")
    .single();

  if (nodeErr) console.error("[narrative-gate] provenance insert failed:", nodeErr.message);

  // Hash-chained governance event
  await admin.from("governance_events").insert({
    entry_id: entryId,
    event_type: "narrative_gate",
    event_status: verdict.verdict.toLowerCase(),
    metadata_json: {
      invariants_version: verdict.invariants_version,
      state_root: verdict.state_root,
      violation_count: verdict.violations.length,
      reject_count: verdict.violations.filter((v) => v.severity === "reject").length,
      provenance_node_id: (node as any)?.id ?? null,
      triggered_by: user.id,
    },
  });

  // Unification note: we intentionally do NOT add a new artifact_type to
  // project_artifacts here. Narrative-gate verdicts live in the existing
  // provenance_nodes + governance_events tables (with hash chaining via the
  // governance_events_chain_trg trigger). That keeps the gate inside the
  // same governance spine as SignalCheck, Shield, and ai-judge runs.


  await logGovernanceAction({
    userId: user.id,
    action: "narrative_gate.run",
    target: { entry_id: entryId, provenance_node_id: (node as any)?.id ?? null },
    details: { verdict: verdict.verdict, violation_count: verdict.violations.length },
  });

  return new Response(JSON.stringify({ ...verdict, provenance_node_id: (node as any)?.id ?? null }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
