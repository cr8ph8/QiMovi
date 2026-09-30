// Edge function: compute Authorship Shield score for an entry (or raw text).
// Deterministic, no AI calls. Writes authorship_submissions + authorship_scores
// + provenance nodes/edges. Throttled per entry.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { computeShieldScores, type ShieldInputs, type AIUsageType, type RightsStatus, type IntendedMarket } from "../_shared/shield-scoring.ts";
import { logGovernanceAction } from "../_shared/audit.ts";
import { requireEntryOwner } from "../_shared/auth.ts";

interface Body {
  entry_id?: string;
  text?: string;
  project_title?: string;
  writer_name?: string;
  draft_number?: string;
  analysis_type?: string;
  ai_used?: boolean;
  ai_usage_type?: AIUsageType;
  human_revision_level?: number;
  rights_status?: RightsStatus;
  intended_market?: IntendedMarket;
  declared_influences?: string[];
  protected_voice_concern?: boolean;
  source?: "standalone" | "entry_auto" | "entry_manual" | "admin_recompute";
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing bearer token" }, 401);
    }

    // Resolve caller from their JWT.
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userResult, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userResult.user) return json({ error: "Unauthorized" }, 401);
    const user = userResult.user;

    // Service client for writes that bypass RLS (provenance nodes, recompute on owned entries).
    const svc = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = (await req.json().catch(() => ({}))) as Body;
    const source = body.source ?? (body.entry_id ? "entry_auto" : "standalone");

    // Defaults for declared metadata when called automatically from an entry.
    const declared = {
      ai_used: body.ai_used ?? false,
      ai_usage_type: (body.ai_usage_type ?? "none") as AIUsageType,
      human_revision_level: clamp(body.human_revision_level ?? 70, 0, 100),
      rights_status: (body.rights_status ?? "original") as RightsStatus,
      intended_market: (body.intended_market ?? "feature") as IntendedMarket,
      declared_influences: body.declared_influences ?? [],
      protected_voice_concern: body.protected_voice_concern ?? false,
    };

    let entryRow: any = null;
    let textLength = 0;
    let sceneCount = 0;
    let characterCount = 0;
    let projectTitle = body.project_title?.trim() || "Untitled";
    let writerName: string | null = body.writer_name?.trim() || null;
    let draftNumber: string | null = body.draft_number?.trim() || null;
    let competitionId: string | null = null;
    let entryId: string | null = body.entry_id ?? null;

    if (body.entry_id) {
      // Authorize through a metadata-only lookup before the service role reads
      // screenplay text or any other user-owned entry content.
      const entryAccess = await requireEntryOwner(
        svc,
        user.id,
        body.entry_id,
        corsHeaders,
      );
      if (entryAccess instanceof Response) return entryAccess;

      const { data: entry, error: eErr } = await svc
        .from("entries")
        .select("id, user_id, title, author, script_text, page_count, draft_number, competition_id, method_type")
        .eq("id", body.entry_id)
        .single();
      if (eErr || !entry) return json({ error: "Entry not found" }, 404);

      // Throttle: skip if a Shield run already exists for this entry in last 60s.
      const { data: recent } = await svc
        .from("authorship_submissions")
        .select("id, created_at")
        .eq("entry_id", entry.id)
        .gt("created_at", new Date(Date.now() - 60_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(1);
      if (recent && recent.length > 0 && source === "entry_auto") {
        return json({ submission_id: recent[0].id, throttled: true });
      }

      entryRow = entry;
      const text = entry.script_text ?? "";
      textLength = text.length;
      sceneCount = (text.match(/\b(INT\.|EXT\.)/gi) || []).length;
      characterCount = new Set((text.match(/^[A-Z][A-Z\s]{2,}$/gm) || []).map((s: string) => s.trim())).size;
      projectTitle = body.project_title?.trim() || entry.title || "Untitled";
      writerName = body.writer_name?.trim() || entry.author || null;
      draftNumber = body.draft_number?.trim() || String(entry.draft_number ?? "1");
      competitionId = entry.competition_id ?? null;
      entryId = entry.id;

      // Method-type derived AI defaults when caller didn't provide them.
      if (body.ai_used === undefined) {
        declared.ai_used = entry.method_type === "ai";
        declared.ai_usage_type = entry.method_type === "ai" ? "full_gen" : "none";
      }
    } else {
      // Standalone form path: use provided text.
      const text = body.text ?? "";
      if (!text.trim()) return json({ error: "text or entry_id is required" }, 400);
      textLength = text.length;
      sceneCount = (text.match(/\b(INT\.|EXT\.)/gi) || []).length;
      characterCount = new Set((text.match(/^[A-Z][A-Z\s]{2,}$/gm) || []).map((s: string) => s.trim())).size;
    }

    // Pull stylometrics + emulation flags if we have an entry.
    let stylo: any = null;
    let emulationCount = 0;
    if (entryId) {
      const [{ data: sRows }, { data: flagRows }] = await Promise.all([
        svc.from("submission_stylometrics")
          .select("cliche_density, lexical_diversity, sentence_length_variance, multi_signal_score, word_count, features")
          .eq("entry_id", entryId)
          .order("computed_at", { ascending: false })
          .limit(1),
        svc.from("author_emulation_flags")
          .select("id", { count: "exact" })
          .eq("entry_id", entryId),
      ]);
      stylo = sRows?.[0] ?? null;
      emulationCount = flagRows?.length ?? 0;
    }

    const inputs: ShieldInputs = {
      cliche_density: stylo?.cliche_density ?? undefined,
      mattr: stylo?.lexical_diversity ?? undefined,
      burstiness: stylo?.sentence_length_variance ?? undefined,
      multi_signal_risk: stylo?.multi_signal_score ?? undefined,
      dialogue_density: typeof stylo?.features?.dialogue_density === "number"
        ? stylo.features.dialogue_density : undefined,
      text_length: textLength,
      scene_count: sceneCount,
      character_count: characterCount,
      ai_used: declared.ai_used,
      ai_usage_type: declared.ai_usage_type,
      human_revision_level: declared.human_revision_level,
      rights_status: declared.rights_status,
      intended_market: declared.intended_market,
      declared_influences: declared.declared_influences,
      protected_voice_concern: declared.protected_voice_concern || emulationCount > 0,
      emulation_flag_count: emulationCount,
    };

    const scores = computeShieldScores(inputs);

    // Insert submission as the user (so RLS-anchored user_id is correct) — use svc to set entry/competition.
    const { data: submission, error: subErr } = await svc
      .from("authorship_submissions")
      .insert({
        user_id: user.id,
        entry_id: entryId,
        competition_id: competitionId,
        project_title: projectTitle,
        writer_name: writerName,
        draft_number: draftNumber,
        draft_date: new Date().toISOString().slice(0, 10),
        analysis_type: body.analysis_type ?? "full_shield",
        ai_used: declared.ai_used,
        ai_usage_type: declared.ai_usage_type,
        human_revision_level: declared.human_revision_level,
        intended_market: declared.intended_market,
        rights_status: declared.rights_status,
        declared_influences: declared.declared_influences,
        protected_voice_concern: declared.protected_voice_concern,
        text_length: textLength,
        scene_count: sceneCount,
        character_count: characterCount,
        status: "scored",
        source,
      })
      .select()
      .single();
    if (subErr) throw subErr;

    const { error: scoreErr } = await svc.from("authorship_scores").insert({
      submission_id: submission.id,
      user_id: user.id,
      ...scores,
      signals: scores.signals as any,
    });
    if (scoreErr) throw scoreErr;

    // Provenance: add a shield_score node + edge to most recent draft node (if any).
    if (entryId) {
      const { data: node } = await svc.from("provenance_nodes").insert({
        entry_id: entryId,
        node_type: "shield_score",
        label: `Shield: ${scores.risk_band} risk · integrity ${Math.round(scores.authorship_integrity_score)}`,
        metadata_json: {
          submission_id: submission.id,
          risk_band: scores.risk_band,
          authorship_integrity_score: scores.authorship_integrity_score,
          market_substitution_risk: scores.market_substitution_risk,
          source,
        },
      }).select("id").single();

      const { data: draftNode } = await svc
        .from("provenance_nodes")
        .select("id, created_at")
        .eq("entry_id", entryId)
        .in("node_type", ["draft", "revision", "screenplay_draft"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (node && draftNode) {
        await svc.from("provenance_edges").insert({
          entry_id: entryId,
          from_node_id: draftNode.id,
          to_node_id: node.id,
          edge_type: "shield_scored",
          metadata_json: {},
        });
      }
    }

    await logGovernanceAction({
      userId: user.id,
      action: "shield.compute",
      target: { submission_id: submission.id, entry_id: entryId ?? null },
      details: { risk_band: scores.risk_band, authorship_integrity_score: scores.authorship_integrity_score, source },
    });

    return json({
      submission_id: submission.id,
      scores,
      source,
      throttled: false,
    });
  } catch (err) {
    console.error("compute-shield error:", err);
    return json({ error: (err as Error).message ?? "Internal error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
