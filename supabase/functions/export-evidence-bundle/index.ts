import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logGovernanceAction } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller is admin
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);

    // Enforce Pro+ plan requirement
    const { data: userPlanResult } = await serviceClient.rpc("get_user_plan", { p_user_id: user.id });
    const userPlan = userPlanResult || "free";
    if (userPlan === "free") {
      return new Response(JSON.stringify({ error: "This feature requires the Pro plan" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: isAdmin } = await serviceClient.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { entry_id } = await req.json();
    if (!entry_id) {
      return new Response(JSON.stringify({ error: "entry_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all governance data in parallel
    const [entryRes, versionsRes, influenceRes, eventsRes, nodesRes, edgesRes, consensusRes] =
      await Promise.all([
        serviceClient
          .from("entries")
          .select("id, title, user_id, sensitivity, created_at, rubric_preset, rubric_version")
          .eq("id", entry_id)
          .single(),
        serviceClient
          .from("screenplay_versions")
          .select("id, source_type, actor_type, actor_id, text_hash, created_at, parent_version_id")
          .eq("entry_id", entry_id)
          .order("created_at", { ascending: true }),
        serviceClient
          .from("influence_scores")
          .select("ai_influence_score, voice_stability_score, scoring_method")
          .eq("entry_id", entry_id)
          .order("created_at", { ascending: false }),
        serviceClient
          .from("governance_events")
          .select("id, event_type, event_status, provider, model_name, created_at")
          .eq("entry_id", entry_id)
          .order("created_at", { ascending: true }),
        serviceClient
          .from("provenance_nodes")
          .select("id, node_type, label, metadata_json, created_at")
          .eq("entry_id", entry_id)
          .order("created_at", { ascending: true }),
        serviceClient
          .from("provenance_edges")
          .select("id, from_node_id, to_node_id, edge_type")
          .eq("entry_id", entry_id),
        serviceClient
          .from("judge_consensus")
          .select(
            "model_id, dimension_scores, expected_scores, score_distributions, entropy_avg, logprob_source, is_outlier, rubric_preset, rubric_version",
          )
          .eq("entry_id", entry_id),
      ]);

    if (entryRes.error || !entryRes.data) {
      return new Response(
        JSON.stringify({ error: "Entry not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const entry = entryRes.data;
    const versions = versionsRes.data || [];
    const influenceScores = influenceRes.data || [];
    const events = eventsRes.data || [];
    const nodes = nodesRes.data || [];
    const edges = edgesRes.data || [];
    const consensusRows = (consensusRes.data || []) as Array<{
      dimension_scores: Record<string, number> | null;
      expected_scores: Record<string, number> | null;
      score_distributions: Record<string, number[]> | null;
      entropy_avg: number | null;
      logprob_source: string | null;
      is_outlier: boolean;
      rubric_preset: string | null;
      rubric_version: number | null;
    }>;

    // ─── Per-criterion continuous decomposition ───
    // Reads active judge_consensus rows + the rubric_versions definition so
    // governance auditors and future readers can see how the total was built.
    const activePanel = consensusRows.filter((r) => !r.is_outlier);
    const rubricPreset = entry.rubric_preset ?? activePanel[0]?.rubric_preset ?? null;
    const rubricVersion = entry.rubric_version ?? activePanel[0]?.rubric_version ?? null;

    let rubricDef: {
      dimensions?: Array<string | { key: string; label?: string; weight?: number }>;
      labels?: Record<string, string>;
      weights?: Record<string, number>;
    } | null = null;
    let rubricLabel: string | null = null;
    if (rubricPreset) {
      let rq = serviceClient
        .from("rubric_versions")
        .select("preset_id, version, label, definition")
        .eq("preset_id", rubricPreset);
      if (rubricVersion) rq = rq.eq("version", rubricVersion);
      const { data: rv } = await rq.order("version", { ascending: false }).limit(1).maybeSingle();
      rubricDef = (rv?.definition ?? null) as typeof rubricDef;
      rubricLabel = (rv?.label as string | null) ?? null;
    }

    type DimSpec = { key: string; label: string; weight: number };
    const dims: DimSpec[] = Array.isArray(rubricDef?.dimensions)
      ? (rubricDef!.dimensions as Array<string | { key: string; label?: string; weight?: number }>).map((d) => {
          const labels = rubricDef?.labels ?? {};
          const weights = rubricDef?.weights ?? {};
          if (typeof d === "string") {
            return {
              key: d,
              label: labels[d] ?? d.charAt(0).toUpperCase() + d.slice(1),
              weight: Number(weights[d] ?? 1),
            };
          }
          return {
            key: d.key,
            label: d.label ?? labels[d.key] ?? d.key,
            weight: Number(d.weight ?? weights[d.key] ?? 1),
          };
        })
      : [];

    const criteria = dims.map((d) => {
      const values: number[] = [];
      const entropies: number[] = [];
      const pmfs: number[][] = [];
      const methods = new Set<string>();
      for (const row of activePanel) {
        const exp = row.expected_scores?.[d.key];
        const disc = row.dimension_scores?.[d.key];
        const v = typeof exp === "number" ? exp : typeof disc === "number" ? disc : null;
        if (v != null && Number.isFinite(v)) values.push(v);
        const pmf = row.score_distributions?.[d.key];
        if (Array.isArray(pmf) && pmf.length === 10) pmfs.push(pmf as number[]);
        if (row.entropy_avg != null) entropies.push(Number(row.entropy_avg));
        if (row.logprob_source) methods.add(row.logprob_source);
      }
      const mean =
        values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
      const stddev =
        values.length > 0
          ? Math.sqrt(values.reduce((s, v) => s + (v - (mean as number)) ** 2, 0) / values.length)
          : null;
      const pmfAvg =
        pmfs.length > 0
          ? Array.from({ length: 10 }, (_, i) =>
              pmfs.reduce((s, p) => s + p[i], 0) / pmfs.length,
            )
          : null;
      return {
        key: d.key,
        label: d.label,
        weight: d.weight,
        expected_mean: mean,
        expected_stddev: stddev,
        entropy_avg:
          entropies.length > 0 ? entropies.reduce((a, b) => a + b, 0) / entropies.length : null,
        pmf_avg: pmfAvg,
        judge_count: values.length,
        methods: Array.from(methods).sort(),
      };
    });

    let wSum = 0;
    let wVal = 0;
    for (const c of criteria) {
      if (c.expected_mean == null) continue;
      wSum += c.weight;
      wVal += c.weight * c.expected_mean;
    }
    const weightedTotal = wSum > 0 ? wVal / wSum : null;

    const rubricDecomposition = {
      rubric_preset: rubricPreset,
      rubric_version: rubricVersion,
      rubric_label: rubricLabel,
      panel_size: activePanel.length,
      weighted_total: weightedTotal,
      criteria,
    };

    // Compute authorship continuity score
    const humanVersions = versions.filter((v: any) => v.actor_type === "user" || v.actor_type === "human");
    const aiVersions = versions.filter((v: any) => v.actor_type === "ai");
    const totalVersions = versions.length || 1;
    const humanRatio = humanVersions.length / totalVersions;

    // AI influence from latest score or version ratio fallback
    const latestInfluence = influenceScores.length > 0
      ? Number(influenceScores[0].ai_influence_score) || 0
      : aiVersions.length / totalVersions;

    const authorshipContinuity = Math.max(0, Math.min(1, 1 - latestInfluence * 0.5 - (1 - humanRatio) * 0.5));

    // Extract unique contributors
    const contributorIds = new Set<string>();
    versions.forEach((v: any) => {
      if (v.actor_id) contributorIds.add(v.actor_id);
    });
    events.forEach((e: any) => {
      // actor info in metadata if present
    });

    // Build creation timeline
    const creationTimeline = versions.map((v: any) => ({
      version_id: v.id,
      source_type: v.source_type,
      actor_type: v.actor_type,
      text_hash: v.text_hash,
      parent_version_id: v.parent_version_id,
      created_at: v.created_at,
    }));

    // Compute version graph hash (hash of all version hashes concatenated)
    const versionHashInput = versions.map((v: any) => v.text_hash).join("|");
    const versionGraphHash = await sha256(versionHashInput || "empty");

    // Compute governance audit hash (hash of all event IDs + types)
    const auditHashInput = events.map((e: any) => `${e.id}:${e.event_type}:${e.event_status}`).join("|");
    const governanceAuditHash = await sha256(auditHashInput || "empty");

    // Map sensitivity to confidentiality mode
    const confidentialityMap: Record<string, string> = {
      standard: "standard",
      confidential: "confidential",
      nda_protected: "nda_protected",
      embargoed: "embargoed",
    };

    // Assemble the bundle (without evidence_bundle_hash — computed after)
    const bundlePayload = {
      project_id: entry.id,
      project_title: entry.title,
      creation_timeline: creationTimeline,
      authorship_continuity_score: Math.round(authorshipContinuity * 10000) / 10000,
      ai_influence_ratio: Math.round(latestInfluence * 10000) / 10000,
      human_contribution_ratio: Math.round(humanRatio * 10000) / 10000,
      primary_creator_id: entry.user_id,
      contributors: Array.from(contributorIds),
      version_graph_hash: versionGraphHash,
      governance_audit_hash: governanceAuditHash,
      confidentiality_mode: confidentialityMap[entry.sensitivity] || "standard",
      provenance_summary: {
        nodes_count: nodes.length,
        edges_count: edges.length,
      },
      rubric_decomposition: rubricDecomposition,
      generated_at: new Date().toISOString(),
    };

    // Compute evidence bundle hash from the payload
    const evidenceBundleHash = await sha256(JSON.stringify(bundlePayload));
    const bundle = { ...bundlePayload, evidence_bundle_hash: evidenceBundleHash };

    // Store hash on entry and bundle in parsed_metadata
    await serviceClient
      .from("entries")
      .update({
        evidence_bundle_hash: evidenceBundleHash,
        parsed_metadata: {
          tpas_evidence_bundle: bundle,
        },
      })
      .eq("id", entry_id);

    await logGovernanceAction({
      userId: user.id,
      action: "evidence_bundle.export",
      target: { entry_id },
      details: { evidence_bundle_hash: evidenceBundleHash, nodes_count: nodes.length, edges_count: edges.length },
    });

    return new Response(JSON.stringify({ bundle }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[export-evidence-bundle] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
