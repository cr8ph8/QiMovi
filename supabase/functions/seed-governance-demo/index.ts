import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Admin-only
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!token || token === anonKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Find up to 5 existing entries to attach governance data to
    const { data: entries, error: entriesErr } = await supabase
      .from("entries")
      .select("id, title, sensitivity, method_type, script_text")
      .order("created_at", { ascending: false })
      .limit(5);

    if (entriesErr || !entries?.length) {
      return new Response(JSON.stringify({ error: "No entries found to seed governance data" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Record<string, any> = {};

    // Helper: SHA-256 hash
    async function hashText(text: string): Promise<string> {
      const data = new TextEncoder().encode(text);
      const buf = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    }

    // ─── Scenario 1: Human-only edits (low AI influence) ───
    const e1 = entries[0];
    const e1Text = (e1.script_text || "Demo screenplay text for human-only scenario").slice(0, 500);
    const e1Hash = await hashText(e1Text);

    const { data: v1 } = await supabase.from("screenplay_versions").insert({
      entry_id: e1.id, source_type: "import", actor_type: "user", text_hash: e1Hash, text_excerpt: e1Text.slice(0, 200),
    }).select("id").single();

    const { data: v1b } = await supabase.from("screenplay_versions").insert({
      entry_id: e1.id, source_type: "human_edit", actor_type: "user", parent_version_id: v1?.id, text_hash: await hashText(e1Text + " revised"), text_excerpt: (e1Text + " revised").slice(0, 200),
    }).select("id").single();

    await supabase.from("governance_events").insert([
      { entry_id: e1.id, version_id: v1?.id, event_type: "baseline_snapshot_created", event_status: "recorded" },
      { entry_id: e1.id, version_id: v1b?.id, event_type: "output_accepted", event_status: "recorded", metadata_json: { source: "human_edit" } },
    ]);

    await supabase.from("influence_scores").insert({
      entry_id: e1.id, version_id: v1b?.id || v1?.id || crypto.randomUUID(),
      semantic_drift_score: 0.05, voice_stability_score: 0.95, originality_distance_score: 0.03,
      structural_integrity_score: 0.98, ai_influence_score: 0.02, scoring_method: "heuristic_v1",
    });

    // Provenance
    const { data: n1a } = await supabase.from("provenance_nodes").insert({
      entry_id: e1.id, node_type: "version", related_version_id: v1?.id, label: "Original import",
    }).select("id").single();
    const { data: n1b } = await supabase.from("provenance_nodes").insert({
      entry_id: e1.id, node_type: "version", related_version_id: v1b?.id, label: "Human revision",
    }).select("id").single();
    if (n1a && n1b) {
      await supabase.from("provenance_edges").insert({
        entry_id: e1.id, from_node_id: n1a.id, to_node_id: n1b.id, edge_type: "derived_from",
      });
    }
    results.scenario_1 = { entry_id: e1.id, title: e1.title, type: "human_only" };

    // ─── Scenario 2: One AI rewrite, low drift ───
    if (entries.length >= 2) {
      const e2 = entries[1];
      const e2Text = (e2.script_text || "Demo text for low-drift AI rewrite").slice(0, 500);
      const { data: v2a } = await supabase.from("screenplay_versions").insert({
        entry_id: e2.id, source_type: "import", actor_type: "user", text_hash: await hashText(e2Text), text_excerpt: e2Text.slice(0, 200),
      }).select("id").single();
      const { data: v2b } = await supabase.from("screenplay_versions").insert({
        entry_id: e2.id, source_type: "ai_rewrite", actor_type: "ai", parent_version_id: v2a?.id,
        text_hash: await hashText(e2Text + " AI polished"), text_excerpt: (e2Text + " AI polished").slice(0, 200),
      }).select("id").single();

      await supabase.from("governance_events").insert([
        { entry_id: e2.id, version_id: v2a?.id, event_type: "baseline_snapshot_created" },
        { entry_id: e2.id, version_id: v2b?.id, event_type: "ai_request_received", provider: "lovable", model_name: "google/gemini-2.5-flash" },
        { entry_id: e2.id, version_id: v2b?.id, event_type: "provider_called", provider: "lovable", model_name: "google/gemini-2.5-flash" },
        { entry_id: e2.id, version_id: v2b?.id, event_type: "model_output_received", provider: "lovable", model_name: "google/gemini-2.5-flash", metadata_json: { output_length: 1200 } },
        { entry_id: e2.id, version_id: v2b?.id, event_type: "output_accepted", metadata_json: { action: "polish" } },
      ]);

      await supabase.from("influence_scores").insert({
        entry_id: e2.id, version_id: v2b?.id || crypto.randomUUID(),
        semantic_drift_score: 0.15, voice_stability_score: 0.88, originality_distance_score: 0.12,
        structural_integrity_score: 0.95, ai_influence_score: 0.18, scoring_method: "heuristic_v1",
        metadata_json: { action: "polish", model: "google/gemini-2.5-flash" },
      });

      const { data: n2a } = await supabase.from("provenance_nodes").insert({
        entry_id: e2.id, node_type: "version", related_version_id: v2a?.id, label: "Original",
      }).select("id").single();
      const { data: n2b } = await supabase.from("provenance_nodes").insert({
        entry_id: e2.id, node_type: "rewrite_event", related_version_id: v2b?.id, label: "AI Polish",
        metadata_json: { model: "google/gemini-2.5-flash", action: "polish" },
      }).select("id").single();
      if (n2a && n2b) {
        await supabase.from("provenance_edges").insert({
          entry_id: e2.id, from_node_id: n2a.id, to_node_id: n2b.id, edge_type: "transformed_by",
          metadata_json: { action: "polish" },
        });
      }
      results.scenario_2 = { entry_id: e2.id, title: e2.title, type: "single_ai_low_drift" };
    }

    // ─── Scenario 3: Multiple AI rewrites, high drift ───
    if (entries.length >= 3) {
      const e3 = entries[2];
      const e3Text = (e3.script_text || "Demo text for high-drift scenario").slice(0, 500);
      const versions3: string[] = [];

      const { data: v3a } = await supabase.from("screenplay_versions").insert({
        entry_id: e3.id, source_type: "import", actor_type: "user",
        text_hash: await hashText(e3Text), text_excerpt: e3Text.slice(0, 200),
      }).select("id").single();
      if (v3a) versions3.push(v3a.id);

      const rewrites = ["rewrite", "intensify", "reimagine"];
      for (let i = 0; i < rewrites.length; i++) {
        const parentId = versions3[versions3.length - 1];
        const modText = e3Text + ` ${rewrites[i]} pass ${i + 1}`;
        const { data: vn } = await supabase.from("screenplay_versions").insert({
          entry_id: e3.id, source_type: "ai_rewrite", actor_type: "ai", parent_version_id: parentId,
          text_hash: await hashText(modText), text_excerpt: modText.slice(0, 200),
        }).select("id").single();
        if (vn) versions3.push(vn.id);

        await supabase.from("governance_events").insert([
          { entry_id: e3.id, version_id: vn?.id, event_type: "ai_request_received", provider: "lovable", model_name: "google/gemini-2.5-flash" },
          { entry_id: e3.id, version_id: vn?.id, event_type: "model_output_received", provider: "lovable", model_name: "google/gemini-2.5-flash" },
        ]);

        const driftMultiplier = (i + 1) * 0.25;
        await supabase.from("influence_scores").insert({
          entry_id: e3.id, version_id: vn?.id || crypto.randomUUID(),
          semantic_drift_score: Math.min(0.85, 0.2 + driftMultiplier),
          voice_stability_score: Math.max(0.15, 0.9 - driftMultiplier),
          originality_distance_score: Math.min(0.8, 0.15 + driftMultiplier),
          structural_integrity_score: Math.max(0.5, 0.95 - driftMultiplier * 0.3),
          ai_influence_score: Math.min(0.9, 0.2 + driftMultiplier),
          scoring_method: "heuristic_v1",
          metadata_json: { action: rewrites[i], pass: i + 1 },
        });
      }

      // Build provenance chain
      const nodeIds3: string[] = [];
      for (let i = 0; i < versions3.length; i++) {
        const label = i === 0 ? "Original" : `AI ${rewrites[i - 1]}`;
        const { data: nd } = await supabase.from("provenance_nodes").insert({
          entry_id: e3.id, node_type: i === 0 ? "version" : "rewrite_event",
          related_version_id: versions3[i], label,
        }).select("id").single();
        if (nd) nodeIds3.push(nd.id);
      }
      for (let i = 0; i < nodeIds3.length - 1; i++) {
        await supabase.from("provenance_edges").insert({
          entry_id: e3.id, from_node_id: nodeIds3[i], to_node_id: nodeIds3[i + 1],
          edge_type: "transformed_by", metadata_json: { action: rewrites[i] },
        });
      }
      results.scenario_3 = { entry_id: e3.id, title: e3.title, type: "multi_ai_high_drift" };
    }

    // ─── Scenario 4: Protected/confidential mode ───
    if (entries.length >= 4) {
      const e4 = entries[3];
      const e4Text = (e4.script_text || "Confidential screenplay text").slice(0, 500);
      const { data: v4 } = await supabase.from("screenplay_versions").insert({
        entry_id: e4.id, source_type: "submission_snapshot", actor_type: "system",
        text_hash: await hashText(e4Text), text_excerpt: e4Text.slice(0, 200),
      }).select("id").single();

      await supabase.from("governance_events").insert([
        { entry_id: e4.id, version_id: v4?.id, event_type: "baseline_snapshot_created", privacy_mode: "confidential" },
        { entry_id: e4.id, version_id: v4?.id, event_type: "sensitivity_evaluated", privacy_mode: "confidential", metadata_json: { sensitivity: "confidential", policy: "no_third_party" } },
        { entry_id: e4.id, version_id: v4?.id, event_type: "routing_decided", privacy_mode: "confidential", routing_reason: "sensitivity_upgrade", provider: "lovable", model_name: "google/gemini-2.5-pro" },
        { entry_id: e4.id, version_id: v4?.id, event_type: "governance_decision_made", privacy_mode: "confidential", metadata_json: { decision: "allow_with_restrictions", restrictions: ["no_data_retention", "premium_model_only"] } },
      ]);

      await supabase.from("influence_scores").insert({
        entry_id: e4.id, version_id: v4?.id || crypto.randomUUID(),
        semantic_drift_score: 0.0, voice_stability_score: 1.0, originality_distance_score: 0.0,
        structural_integrity_score: 1.0, ai_influence_score: 0.0, scoring_method: "heuristic_v1",
      });

      const { data: n4 } = await supabase.from("provenance_nodes").insert({
        entry_id: e4.id, node_type: "submission_milestone", related_version_id: v4?.id,
        label: "Confidential submission snapshot",
      }).select("id").single();
      results.scenario_4 = { entry_id: e4.id, title: e4.title, type: "confidential_protected" };
    }

    // ─── Scenario 5: Full provenance chain with governance events ───
    if (entries.length >= 5) {
      const e5 = entries[4];
      const e5Text = (e5.script_text || "Full provenance demo screenplay").slice(0, 500);

      // Version chain: import → human_edit → ai_rewrite → review_snapshot
      const vIds: string[] = [];
      const stages = [
        { source: "import", actor: "user", suffix: "" },
        { source: "human_edit", actor: "user", suffix: " draft 2" },
        { source: "ai_rewrite", actor: "ai", suffix: " AI enhanced" },
        { source: "review_snapshot", actor: "system", suffix: " submitted" },
      ];

      for (const stage of stages) {
        const text = e5Text + stage.suffix;
        const parentId = vIds.length ? vIds[vIds.length - 1] : null;
        const { data: v } = await supabase.from("screenplay_versions").insert({
          entry_id: e5.id, source_type: stage.source, actor_type: stage.actor,
          parent_version_id: parentId, text_hash: await hashText(text), text_excerpt: text.slice(0, 200),
        }).select("id").single();
        if (v) vIds.push(v.id);
      }

      // Full event timeline
      await supabase.from("governance_events").insert([
        { entry_id: e5.id, version_id: vIds[0], event_type: "baseline_snapshot_created" },
        { entry_id: e5.id, version_id: vIds[1], event_type: "output_accepted", metadata_json: { source: "human_edit" } },
        { entry_id: e5.id, version_id: vIds[2], event_type: "ai_request_received", provider: "lovable", model_name: "google/gemini-2.5-flash" },
        { entry_id: e5.id, version_id: vIds[2], event_type: "sensitivity_evaluated", metadata_json: { sensitivity: "standard" } },
        { entry_id: e5.id, version_id: vIds[2], event_type: "routing_decided", routing_reason: "default", provider: "lovable", model_name: "google/gemini-2.5-flash" },
        { entry_id: e5.id, version_id: vIds[2], event_type: "provider_called", provider: "lovable", model_name: "google/gemini-2.5-flash" },
        { entry_id: e5.id, version_id: vIds[2], event_type: "model_output_received", provider: "lovable", model_name: "google/gemini-2.5-flash" },
        { entry_id: e5.id, version_id: vIds[2], event_type: "semantic_drift_scored", metadata_json: { score: 0.35 } },
        { entry_id: e5.id, version_id: vIds[2], event_type: "voice_stability_scored", metadata_json: { score: 0.78 } },
        { entry_id: e5.id, version_id: vIds[2], event_type: "ai_influence_scored", metadata_json: { score: 0.32 } },
        { entry_id: e5.id, version_id: vIds[2], event_type: "output_accepted", metadata_json: { action: "enhance" } },
        { entry_id: e5.id, version_id: vIds[3], event_type: "submission_snapshot_created" },
        { entry_id: e5.id, version_id: vIds[3], event_type: "governance_decision_made", metadata_json: { decision: "approved_for_competition" } },
      ]);

      // Influence scores for AI rewrite version
      await supabase.from("influence_scores").insert({
        entry_id: e5.id, version_id: vIds[2] || crypto.randomUUID(),
        semantic_drift_score: 0.35, voice_stability_score: 0.78, originality_distance_score: 0.28,
        structural_integrity_score: 0.88, ai_influence_score: 0.32, scoring_method: "heuristic_v1",
        metadata_json: { action: "enhance", model: "google/gemini-2.5-flash" },
      });

      // Full provenance graph
      const nTypes = ["version", "version", "rewrite_event", "submission_milestone"];
      const nLabels = ["Original import", "Human draft 2", "AI enhancement", "Competition submission"];
      const nIds: string[] = [];
      for (let i = 0; i < 4; i++) {
        const { data: nd } = await supabase.from("provenance_nodes").insert({
          entry_id: e5.id, node_type: nTypes[i], related_version_id: vIds[i], label: nLabels[i],
        }).select("id").single();
        if (nd) nIds.push(nd.id);
      }
      const edgeTypes = ["derived_from", "transformed_by", "submitted_as"];
      for (let i = 0; i < nIds.length - 1; i++) {
        await supabase.from("provenance_edges").insert({
          entry_id: e5.id, from_node_id: nIds[i], to_node_id: nIds[i + 1], edge_type: edgeTypes[i],
        });
      }
      results.scenario_5 = { entry_id: e5.id, title: e5.title, type: "full_provenance_chain" };
    }

    return new Response(
      JSON.stringify({ success: true, scenarios_seeded: Object.keys(results).length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Seed governance demo error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
