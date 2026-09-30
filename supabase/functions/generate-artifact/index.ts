import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  computeContinuityLabel,
  computeVoiceStabilityLabel,
  computeOriginalityRiskLabel,
  detectStructuralFlags,
} from "../_shared/governance.ts";
import { requireUser, requireEntryOwner } from "../_shared/auth.ts";
import { logGovernanceAction } from "../_shared/audit.ts";
import { mirrorArtifactEdge } from "../_shared/project-mirror.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALL_TYPES = [
  "authorship_continuity",
  "ai_influence_map",
  "provenance_graph",
  "model_behavior",
  "confidentiality_boundary",
  "originality_distance",
];

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Unconditional auth — reject anonymous and anon-key callers
    const auth = await requireUser(req, corsHeaders);
    if (auth instanceof Response) return auth;

    // Enforce Pro+ plan requirement
    const { data: userPlanResult } = await supabase.rpc("get_user_plan", { p_user_id: auth.userId });
    const userPlan = userPlanResult || "free";
    if (userPlan === "free") {
      return new Response(JSON.stringify({ error: "This feature requires the Pro plan" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const entryId = body.entry_id;
    if (!entryId) {
      return new Response(JSON.stringify({ error: "entry_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the entry belongs to the caller (admins can access all)
    const ownerCheck = await requireEntryOwner(supabase, auth.userId, entryId, corsHeaders);
    if (ownerCheck instanceof Response) return ownerCheck;

    const artifactTypes: string[] = body.artifact_types || ALL_TYPES;

    // ─── Status Workflow: Mark existing ready artifacts as stale ───
    await supabase
      .from("artifacts")
      .update({ status: "stale" })
      .eq("entry_id", entryId)
      .eq("status", "ready");

    // Fetch all governance data for this entry in parallel
    const [
      { data: entry },
      { data: versions },
      { data: influenceScores },
      { data: events },
      { data: nodes },
      { data: edges },
      { data: evalRuns },
    ] = await Promise.all([
      supabase.from("entries").select("id, title, user_id, sensitivity, method_type, script_text").eq("id", entryId).single(),
      supabase.from("screenplay_versions").select("*").eq("entry_id", entryId).order("created_at", { ascending: true }),
      supabase.from("influence_scores").select("*").eq("entry_id", entryId).order("created_at", { ascending: true }),
      supabase.from("governance_events").select("*").eq("entry_id", entryId).order("created_at", { ascending: true }),
      supabase.from("provenance_nodes").select("*").eq("entry_id", entryId).order("created_at", { ascending: true }),
      supabase.from("provenance_edges").select("*").eq("entry_id", entryId),
      supabase.from("evaluation_runs").select("*").eq("entry_id", entryId).order("created_at", { ascending: true }),
    ]);

    if (!entry) {
      return new Response(JSON.stringify({ error: "Entry not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allVersions = versions || [];
    const allScores = influenceScores || [];
    const allEvents = events || [];
    const allNodes = nodes || [];
    const allEdges = edges || [];
    const allRuns = evalRuns || [];

    const generatedArtifacts: any[] = [];

    // Compute integrity hashes upfront
    const versionHashInput = allVersions.map((v: any) => v.text_hash).join("|");
    const versionGraphHash = await sha256(versionHashInput || "empty");
    const govLogInput = allEvents.map((e: any) => `${e.id}:${e.event_type}:${e.event_status}`).join("|");
    const governanceLogHash = await sha256(govLogInput || "empty");
    const textHash = entry.script_text ? await sha256(entry.script_text) : null;

    // Determine next artifact_version per type
    async function getNextVersion(type: string): Promise<number> {
      const { data: existing } = await supabase
        .from("artifacts")
        .select("artifact_version")
        .eq("entry_id", entryId)
        .eq("artifact_type", type)
        .order("artifact_version", { ascending: false })
        .limit(1);
      return (existing?.[0]?.artifact_version ?? 0) + 1;
    }

    // Helper to store artifact with status workflow + integrity fields
    async function storeArtifact(type: string, data: Record<string, any>, metrics: { name: string; value: number; confidence?: number }[]) {
      const hash = await sha256(JSON.stringify(data));
      const version = await getNextVersion(type);

      // Insert as 'generating'
      const { data: artifact, error } = await supabase
        .from("artifacts")
        .insert({
          entry_id: entryId,
          artifact_type: type,
          artifact_data: data,
          artifact_hash: hash,
          artifact_version: version,
          text_hash: textHash,
          version_graph_hash: versionGraphHash,
          governance_log_hash: governanceLogHash,
          status: "generating",
        })
        .select("id")
        .single();

      if (error) {
        console.error(`[artifact] Failed to store ${type}:`, error.message);
        await supabase.from("artifacts").insert({
          entry_id: entryId, artifact_type: type, artifact_data: { error: error.message },
          artifact_hash: hash, status: "failed",
        });
        return null;
      }

      // Store metrics with method and source_context
      if (artifact && metrics.length > 0) {
        const metricRows = metrics.map((m) => ({
          artifact_id: artifact.id,
          metric_name: m.name,
          metric_value: m.value,
          metric_confidence: m.confidence ?? null,
          method: "heuristic_v1",
          source_context: type,
        }));
        await supabase.from("artifact_metrics").insert(metricRows);
      }

      // Mark as ready
      if (artifact) {
        await supabase.from("artifacts").update({ status: "ready" }).eq("id", artifact.id);
      }

      generatedArtifacts.push({ id: artifact?.id, type, hash, version, data, metrics });
      return artifact?.id;
    }

    // ─── 1. Authorship Continuity ───
    if (artifactTypes.includes("authorship_continuity")) {
      const humanVersions = allVersions.filter((v) => v.actor_type === "user");
      const aiVersions = allVersions.filter((v) => v.actor_type === "ai");
      const totalVersions = allVersions.length;
      const humanRatio = totalVersions > 0 ? humanVersions.length / totalVersions : 1;

      // Enhanced stability curve with per-version subscores
      const stabilityCurve = allScores.map((s) => ({
        version_id: s.version_id,
        voice_stability: Number(s.voice_stability_score) || 0,
        structural_integrity: Number(s.structural_integrity_score) || 0,
        semantic_drift: Number(s.semantic_drift_score) || 0,
        ai_influence: Number(s.ai_influence_score) || 0,
        timestamp: s.created_at,
      }));

      const avgVoiceStability = stabilityCurve.length > 0
        ? stabilityCurve.reduce((sum, s) => sum + s.voice_stability, 0) / stabilityCurve.length
        : 1;
      const avgDrift = allScores.length > 0
        ? allScores.reduce((sum, s) => sum + (Number(s.semantic_drift_score) || 0), 0) / allScores.length
        : 0;
      const avgStructural = stabilityCurve.length > 0
        ? stabilityCurve.reduce((sum, s) => sum + s.structural_integrity, 0) / stabilityCurve.length
        : 1;

      // AI dominance penalty: if AI versions dominate, reduce score
      const aiDominancePenalty = totalVersions > 0 ? Math.max(0, (aiVersions.length / totalVersions) - 0.5) * 0.4 : 0;

      const continuityScore = Math.max(0, Math.min(1,
        Math.round((humanRatio * 0.3 + avgVoiceStability * 0.25 + avgStructural * 0.2 + (1 - avgDrift) * 0.25 - aiDominancePenalty) * 10000) / 10000
      ));
      const continuityLabel = computeContinuityLabel(continuityScore);

      // Baseline and parent drift
      const baselineDriftScore = allScores.length > 0
        ? Number(allScores[allScores.length - 1].semantic_drift_score) || 0
        : 0;
      const parentDriftScore = allScores.length > 1
        ? Number(allScores[allScores.length - 1].semantic_drift_score) || 0
        : 0;
      const cumulativeDriftScore = avgDrift;

      await storeArtifact("authorship_continuity", {
        continuity_score: continuityScore,
        continuity_label: continuityLabel,
        drift_score: Math.round(avgDrift * 10000) / 10000,
        baseline_drift_score: Math.round(baselineDriftScore * 10000) / 10000,
        parent_drift_score: Math.round(parentDriftScore * 10000) / 10000,
        cumulative_drift_score: Math.round(cumulativeDriftScore * 10000) / 10000,
        revision_count: totalVersions,
        human_version_count: humanVersions.length,
        ai_version_count: aiVersions.length,
        stability_curve: stabilityCurve,
      }, [
        { name: "continuity_score", value: continuityScore, confidence: Math.min(totalVersions / 5, 1) },
        { name: "drift_score", value: avgDrift },
        { name: "baseline_drift_score", value: baselineDriftScore },
        { name: "revision_count", value: totalVersions },
      ]);
    }

    // ─── 2. AI Influence Map ───
    if (artifactTypes.includes("ai_influence_map")) {
      const aiRewriteEvents = allEvents.filter((e) => e.event_type === "ai_request_received" || e.event_type === "model_output_received");
      const humanEditEvents = allVersions.filter((v) => v.actor_type === "user");

      // Human restoration factor: ratio of human edits after AI rewrites
      let humanAfterAi = 0;
      for (let i = 1; i < allVersions.length; i++) {
        if (allVersions[i].actor_type === "user" && allVersions[i - 1].actor_type === "ai") {
          humanAfterAi++;
        }
      }
      const humanRestorationFactor = allVersions.length > 1 ? humanAfterAi / (allVersions.length - 1) : 0;

      const perVersion = allScores.map((s) => ({
        version_id: s.version_id,
        ai_token_ratio: Number(s.ai_influence_score) || 0,
        human_edit_ratio: 1 - (Number(s.ai_influence_score) || 0),
        semantic_change_magnitude: Number(s.semantic_drift_score) || 0,
        rewrite_intensity: Number(s.originality_distance_score) || 0,
        timestamp: s.created_at,
      }));

      const avgAiInfluence = perVersion.length > 0
        ? perVersion.reduce((sum, v) => sum + v.ai_token_ratio, 0) / perVersion.length
        : 0;

      await storeArtifact("ai_influence_map", {
        overall_ai_influence: Math.round(avgAiInfluence * 10000) / 10000,
        overall_human_ratio: Math.round((1 - avgAiInfluence) * 10000) / 10000,
        ai_rewrite_event_count: aiRewriteEvents.length,
        human_edit_count: humanEditEvents.length,
        human_restoration_factor: Math.round(humanRestorationFactor * 10000) / 10000,
        per_version: perVersion,
      }, [
        { name: "ai_influence_ratio", value: avgAiInfluence },
        { name: "human_edit_ratio", value: 1 - avgAiInfluence },
        { name: "human_restoration_factor", value: humanRestorationFactor },
        { name: "ai_rewrite_event_count", value: aiRewriteEvents.length },
      ]);
    }

    // ─── 3. Provenance Graph ───
    if (artifactTypes.includes("provenance_graph")) {
      const graphData = {
        nodes: allNodes.map((n) => ({
          id: n.id,
          node_type: n.node_type,
          label: n.label,
          related_version_id: n.related_version_id,
          related_event_id: n.related_event_id,
          timestamp: n.created_at,
          metadata: n.metadata_json,
        })),
        edges: allEdges.map((e) => ({
          id: e.id,
          from: e.from_node_id,
          to: e.to_node_id,
          edge_type: e.edge_type,
          metadata: e.metadata_json,
        })),
        node_count: allNodes.length,
        edge_count: allEdges.length,
      };

      await storeArtifact("provenance_graph", graphData, [
        { name: "node_count", value: allNodes.length },
        { name: "edge_count", value: allEdges.length },
        { name: "graph_depth", value: Math.max(allNodes.length - 1, 0) },
      ]);
    }

    // ─── 4. Model Behavior Report ───
    if (artifactTypes.includes("model_behavior")) {
      const modelEvents = allEvents.filter((e) => e.model_name);
      const modelGroups: Record<string, any[]> = {};
      modelEvents.forEach((e) => {
        const key = e.model_name || "unknown";
        if (!modelGroups[key]) modelGroups[key] = [];
        modelGroups[key].push(e);
      });

      const modelReports = Object.entries(modelGroups).map(([modelId, evts]) => {
        const outputEvents = evts.filter((e) => e.event_type === "model_output_received");
        const avgOutputLength = outputEvents.length > 0
          ? outputEvents.reduce((s, e) => s + (Number((e as any).metadata_json?.output_length) || 0), 0) / outputEvents.length
          : 0;

        const versionIds = new Set(evts.map((e) => e.version_id).filter(Boolean));
        const matchedScores = allScores.filter((s) => versionIds.has(s.version_id));
        const avgDrift = matchedScores.length > 0
          ? matchedScores.reduce((s, sc) => s + (Number(sc.semantic_drift_score) || 0), 0) / matchedScores.length
          : 0;
        const avgVoice = matchedScores.length > 0
          ? matchedScores.reduce((s, sc) => s + (Number(sc.voice_stability_score) || 0), 0) / matchedScores.length
          : 0;
        const avgStructural = matchedScores.length > 0
          ? matchedScores.reduce((s, sc) => s + (Number(sc.structural_integrity_score) || 0), 0) / matchedScores.length
          : 0;

        return {
          model_id: modelId,
          event_count: evts.length,
          output_length_avg: Math.round(avgOutputLength),
          semantic_distance: Math.round(avgDrift * 10000) / 10000,
          tone_shift_score: Math.round((1 - avgVoice) * 10000) / 10000,
          structure_distance: Math.round((1 - avgStructural) * 10000) / 10000,
          hallucination_flag: avgDrift > 0.8,
        };
      });

      const evalData = allRuns.map((r) => ({
        model_id: r.model_used,
        temperature: r.temperature,
        quotient_scores: r.quotient_scores_json,
        timestamp: r.created_at,
      }));

      await storeArtifact("model_behavior", {
        models: modelReports,
        evaluation_runs: evalData,
        total_model_interactions: modelEvents.length,
      }, modelReports.map((m) => ({
        name: `model_drift_${m.model_id.replace(/\//g, "_")}`,
        value: m.semantic_distance,
      })));
    }

    // ─── 5. Confidentiality Boundary Report ───
    if (artifactTypes.includes("confidentiality_boundary")) {
      const providers = new Set(allEvents.map((e) => e.provider).filter(Boolean));
      const models = new Set(allEvents.map((e) => e.model_name).filter(Boolean));
      const privacyModes = new Set(allEvents.map((e) => e.privacy_mode).filter(Boolean));
      const routingReasons = allEvents.filter((e) => e.routing_reason).map((e) => ({
        reason: e.routing_reason,
        model: e.model_name,
        timestamp: e.created_at,
      }));

      const sensitivityMap: Record<string, string> = {
        standard: "standard",
        confidential: "confidential",
        nda_protected: "nda_protected",
        embargoed: "embargoed",
      };

      await storeArtifact("confidentiality_boundary", {
        sensitivity_level: entry.sensitivity,
        confidentiality_mode: sensitivityMap[entry.sensitivity] || "standard",
        providers_used: Array.from(providers),
        models_used: Array.from(models),
        privacy_modes_active: Array.from(privacyModes),
        routing_decisions: routingReasons,
        external_tool_usage: false,
      }, [
        { name: "provider_count", value: providers.size },
        { name: "model_count", value: models.size },
        { name: "is_confidential", value: entry.sensitivity !== "standard" ? 1 : 0 },
      ]);
    }

    // ─── 6. Originality Distance Metric ───
    if (artifactTypes.includes("originality_distance")) {
      const perVersion = allScores.map((s) => ({
        version_id: s.version_id,
        distance_score: Number(s.originality_distance_score) || 0,
        semantic_drift: Number(s.semantic_drift_score) || 0,
        transformation_intensity: (Number(s.originality_distance_score) || 0) * 0.6 + (Number(s.semantic_drift_score) || 0) * 0.4,
        novelty_index: Math.max(0, 1 - (Number(s.voice_stability_score) || 0)),
        timestamp: s.created_at,
      }));

      const avgDistance = perVersion.length > 0
        ? perVersion.reduce((sum, v) => sum + v.distance_score, 0) / perVersion.length
        : 0;
      const avgNovelty = perVersion.length > 0
        ? perVersion.reduce((sum, v) => sum + v.novelty_index, 0) / perVersion.length
        : 0;

      const originalityRiskLabel = computeOriginalityRiskLabel(avgDistance);

      // Structural flags from versions
      const structuralFlags = detectStructuralFlags(allVersions);

      // Voice stability label
      const avgVoice = allScores.length > 0
        ? allScores.reduce((s, sc) => s + (Number(sc.voice_stability_score) || 0), 0) / allScores.length
        : 1;
      const voiceStabilityLabel = computeVoiceStabilityLabel(avgVoice);

      // Structural integrity score
      const avgStructuralScore = allScores.length > 0
        ? allScores.reduce((s, sc) => s + (Number(sc.structural_integrity_score) || 0), 0) / allScores.length
        : 1;

      await storeArtifact("originality_distance", {
        overall_distance: Math.round(avgDistance * 10000) / 10000,
        overall_novelty: Math.round(avgNovelty * 10000) / 10000,
        originality_risk_label: originalityRiskLabel,
        voice_stability_score: Math.round(avgVoice * 10000) / 10000,
        voice_stability_label: voiceStabilityLabel,
        structural_integrity_score: Math.round(avgStructuralScore * 10000) / 10000,
        structural_flags: structuralFlags,
        per_version: perVersion,
      }, [
        { name: "distance_score", value: avgDistance },
        { name: "novelty_index", value: avgNovelty },
        { name: "voice_stability_score", value: avgVoice },
        { name: "structural_integrity_score", value: avgStructuralScore },
      ]);
    }

    await logGovernanceAction({
      userId: auth.userId,
      action: "artifact.generate",
      target: { entry_id: entryId },
      details: { artifact_count: generatedArtifacts.length, artifact_types: artifactTypes },
    });

    // Mirror each generated artifact into unified projects (flag-gated, fire-and-forget).
    try {
      const entryRec = entry as any;
      for (const art of generatedArtifacts) {
        const artifactType = art.type === "originality_distance" ? "scorecard" : "coverage";
        await mirrorArtifactEdge({
          source: "entries",
          sourceId: entryId,
          ownerId: entryRec?.user_id ?? auth.userId,
          title: entryRec?.title ?? "Entry",
          artifactType,
          payload: { artifact_id: art.id, type: art.type, version: art.version, hash: art.hash },
          userIdForFlag: auth.userId,
        });
      }
    } catch (e) {
      console.warn("[generate-artifact] mirror failed", e);
    }

    return new Response(
      JSON.stringify({ success: true, entry_id: entryId, artifacts: generatedArtifacts }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[generate-artifact] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
