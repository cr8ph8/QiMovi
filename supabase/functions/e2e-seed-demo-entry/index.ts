// Test-only seeded demo entry for Playwright E2E of grading UI paths.
// Guards: env E2E_ENABLED === "true" AND caller must have admin role.
// Actions: "status" | "seed" | "reset". Seed uses fixed UUIDs (idempotent upsert).
// State: "finalized" | "panel" | "reports" | "none" — chooses which precedence
// tier v_entry_scorecard will resolve to.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const DEMO_COMPETITION_ID = "e2e00000-0000-0000-0000-0000000000c1";
const DEMO_ENTRY_ID = "e2e00000-0000-0000-0000-0000000000e1";

type Action = "status" | "seed" | "reset";
type State = "finalized" | "panel" | "reports" | "none";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (Deno.env.get("E2E_ENABLED") !== "true") {
    return json({ error: "E2E seed disabled on this environment" }, 403);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing bearer token" }, 401);

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes.user) return json({ error: "Invalid session" }, 401);
  const uid = userRes.user.id;

  const admin = createClient(url, service);
  const { data: hasAdmin, error: roleErr } = await admin.rpc("has_role", {
    _user_id: uid,
    _role: "admin",
  });
  if (roleErr) return json({ error: "Role check failed", detail: roleErr.message }, 500);
  if (!hasAdmin) return json({ error: "Admin role required" }, 403);

  let body: { action?: Action; state?: State } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const action: Action = body.action ?? "status";
  const state: State = body.state ?? "panel";

  const ids = { competition_id: DEMO_COMPETITION_ID, entry_id: DEMO_ENTRY_ID };

  if (action === "status") {
    const { data: view } = await admin
      .from("v_entry_scorecard")
      .select("source,total_score,judge_count,panel_model_count,grading_report_count")
      .eq("entry_id", DEMO_ENTRY_ID)
      .maybeSingle();
    const { data: entry } = await admin
      .from("entries")
      .select("id,title,status")
      .eq("id", DEMO_ENTRY_ID)
      .maybeSingle();
    return json({ ...ids, entry, scorecard: view ?? null });
  }

  // Wipe child rows first (reset AND seed both start clean).
  await admin.from("scores").delete().eq("entry_id", DEMO_ENTRY_ID);
  await admin.from("judge_consensus").delete().eq("entry_id", DEMO_ENTRY_ID);
  await admin.from("grading_reports").delete().eq("entry_id", DEMO_ENTRY_ID);

  if (action === "reset") {
    await admin.from("entries").delete().eq("id", DEMO_ENTRY_ID);
    await admin.from("competitions").delete().eq("id", DEMO_COMPETITION_ID);
    return json({ ok: true, reset: true, ...ids });
  }

  // action === "seed"
  const { error: compErr } = await admin.from("competitions").upsert({
    id: DEMO_COMPETITION_ID,
    name: "[E2E] Demo Competition",
    prompt: "E2E test-only competition. Do not judge.",
    description: "Seeded by e2e-seed-demo-entry for Playwright smoke tests.",
    status: "open",
    judging_tier: "standard",
    blind_review: false,
    kind: "screenplay",
  });
  if (compErr) return json({ error: "Competition upsert failed", detail: compErr.message }, 500);

  const { error: entryErr } = await admin.from("entries").upsert({
    id: DEMO_ENTRY_ID,
    user_id: uid,
    competition_id: DEMO_COMPETITION_ID,
    title: "[E2E] Demo Entry",
    logline: "A test-only entry seeded for grading UI smoke tests.",
    genre: "drama",
    script_text: "INT. TEST LAB - DAY\n\nA screenplay used only by automated tests.\n",
    method_type: "ai",
    status: "judging",
    page_count: 10,
    length_category: "short",
    author: "E2E Bot",
    source: "user",
    rubric_preset: "default",
  });
  if (entryErr) return json({ error: "Entry upsert failed", detail: entryErr.message }, 500);

  const dims = {
    originality: 8, structure: 8, character_depth: 8, dialogue: 8,
    theme: 8, emotion: 8, format_adherence: 8,
  };

  if (state === "reports") {
    const rows = ["report:m1", "report:m2"].map((mid) => ({
      entry_id: DEMO_ENTRY_ID,
      model_id: mid,
      ...dims,
      total_score: 72,
      feedback: "E2E seeded report",
    }));
    const { error } = await admin.from("grading_reports").insert(rows);
    if (error) return json({ error: "grading_reports insert failed", detail: error.message }, 500);
  }

  if (state === "panel" || state === "finalized") {
    const panel = [
      { model_id: "e2e:judge-1", total_score: 78, roll_index: 0 },
      { model_id: "e2e:judge-2", total_score: 82, roll_index: 1 },
      { model_id: "e2e:judge-3", total_score: 80, roll_index: 2 },
    ].map((j) => ({
      entry_id: DEMO_ENTRY_ID,
      roll_index: j.roll_index,
      model_id: j.model_id,
      temperature: 0.7,
      total_score: j.total_score,
      dimension_scores: dims,
      reasoning: "E2E seeded panel judge",
      is_outlier: false,
      is_stability_rerun: false,
      consensus_final: 80,
      consensus_variance: 4,
      judging_tier: "standard",
      rubric_preset: "default",
    }));
    const { error } = await admin.from("judge_consensus").insert(panel);
    if (error) return json({ error: "judge_consensus insert failed", detail: error.message }, 500);
  }

  if (state === "finalized") {
    const { error } = await admin.from("scores").insert({
      entry_id: DEMO_ENTRY_ID,
      ...dims,
      total_score: 85,
      dimension_scores: dims,
      judge_model_id: "e2e:finalizer",
      rubric_preset: "default",
      finalized_by: uid,
      finalized_at: new Date().toISOString(),
      judge_count: 3,
      feedback: "E2E finalized score",
    });
    if (error) return json({ error: "scores insert failed", detail: error.message }, 500);
  }

  const { data: view } = await admin
    .from("v_entry_scorecard")
    .select("source,total_score,judge_count,panel_model_count,grading_report_count")
    .eq("entry_id", DEMO_ENTRY_ID)
    .maybeSingle();

  return json({ ok: true, action, state, ...ids, scorecard: view ?? null });
});
