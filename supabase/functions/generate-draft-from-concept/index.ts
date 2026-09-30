// generate-draft-from-concept — turn an admitted OKF concept into a Fountain
// screenplay draft. Writes a new versioned `fountain` artifact into
// project_artifacts (source of truth for the unified writer editor) and
// ledgers the action for provenance.

import { callAI, aiErrorResponse } from "../_shared/ai-router.ts";
import { logGovernanceAction } from "../_shared/audit.ts";
import { requireProjectEntryAccess, requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Body {
  project_id: string;
  concept_artifact_id: string;
  entry_id?: string | null;
  draft_id?: string | null;
  pages_target?: "vertical" | "micro" | "short" | "pilot_30" | "pilot_60" | "feature";
  variant_directive?: string | null;
  variant_label?: string | null;
  settings?: DraftSettings | null;
}

interface DraftSettings {
  genre?: string | null;
  tone?: string | null;
  pov?: string | null;              // e.g. "single protagonist", "ensemble"
  tense?: string | null;            // "present" | "past"
  audience?: string | null;         // "PG-13", "R", etc.
  language?: string | null;         // "English", "Spanish", ...
  include_title_page?: boolean;     // default true
  include_scene_numbers?: boolean;  // add #1# style scene numbers
  include_transitions?: boolean;    // CUT TO: / FADE OUT.
  include_parentheticals?: boolean; // allow (beat)/(quietly)
  dual_dialogue?: boolean;          // allow ^ dual dialogue when useful
  scene_heading_style?: "standard" | "with_time" | "compact";
  action_density?: "sparse" | "balanced" | "descriptive";
  dialogue_style?: "naturalistic" | "stylized" | "terse" | "rapid_fire";
  extra_notes?: string | null;      // free-form instructions
}

const PAGE_TARGETS: Record<string, string> = {
  vertical: "2-5 pages",
  micro: "2-5 pages",
  short: "8-15 pages",
  pilot_30: "25-35 pages",
  pilot_60: "50-65 pages",
  feature: "90-110 pages",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    if (!url || !serviceKey || !anonKey) {
      return new Response(JSON.stringify({ error: "missing supabase env" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const auth = await requireUser(req, corsHeaders);
    if (auth instanceof Response) return auth;
    const authHeader = `Bearer ${auth.token}`;

    const body = (await req.json()) as Body;
    if (!body?.project_id || !body?.concept_artifact_id) {
      return new Response(JSON.stringify({ error: "project_id and concept_artifact_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = auth.admin;
    const access = await requireProjectEntryAccess(
      admin,
      auth.userId,
      { projectId: body.project_id, entryId: body.entry_id },
      corsHeaders,
    );
    if (access instanceof Response) return access;
    const projectId = access.projectId;

    // `draft_id` is provenance metadata only. Accept it only when the caller
    // owns that legacy draft and its canonical project mapping matches the
    // already-authorized project; otherwise omit it without revealing whether
    // an arbitrary draft id exists.
    let sourceDraftId: string | null = null;
    if (
      body.draft_id &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.draft_id)
    ) {
      const [{ data: draft }, { data: mapping }] = await Promise.all([
        admin
          .from("screenplay_drafts")
          .select("id")
          .eq("id", body.draft_id)
          .eq("user_id", auth.userId)
          .maybeSingle(),
        admin
          .from("project_legacy_map")
          .select("project_id")
          .eq("source_table", "screenplay_drafts")
          .eq("source_id", body.draft_id)
          .eq("project_id", projectId)
          .maybeSingle(),
      ]);
      if (draft && mapping) sourceDraftId = body.draft_id;
    }

    // Load the OKF concept.
    const { data: conceptRow, error: cErr } = await admin
      .from("project_artifacts")
      .select("id, payload_json, version, project_id, artifact_type")
      .eq("id", body.concept_artifact_id)
      .maybeSingle();
    if (cErr || !conceptRow) {
      return new Response(JSON.stringify({ error: "concept not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if ((conceptRow as any).project_id !== projectId ||
        (conceptRow as any).artifact_type !== "okf_concept") {
      return new Response(JSON.stringify({ error: "concept mismatch" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const concept = (conceptRow as any).payload_json?.concept ?? {};
    const pageTarget = PAGE_TARGETS[body.pages_target ?? "short"];

    // Charge tokens before invoking the model. Any debit rejection or transport
    // failure must stop generation; paid output is never returned unpaid.
    try {
      const spend = await fetch(`${url}/functions/v1/spend-tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify({
          action: "draft_from_concept",
          label: `Draft from concept: ${concept.title ?? "Untitled"}`,
          entry_id: body.entry_id ?? undefined,
        }),
      });
      if (!spend.ok) {
        return new Response(await spend.text(), {
          status: spend.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } catch (error) {
      console.error("generate-draft-from-concept token charge failed:", error);
      return new Response(JSON.stringify({ error: "Token charge unavailable" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const variantDirective = (body.variant_directive ?? "").trim();
    const s: DraftSettings = body.settings ?? {};
    const includeTitlePage = s.include_title_page !== false;
    const includeSceneNumbers = !!s.include_scene_numbers;
    const includeTransitions = s.include_transitions !== false;
    const includeParens = s.include_parentheticals !== false;
    const dualDialogue = !!s.dual_dialogue;
    const headingStyle = s.scene_heading_style ?? "standard";
    const actionDensity = s.action_density ?? "balanced";
    const dialogueStyle = s.dialogue_style ?? "naturalistic";

    const settingsLines: string[] = [];
    if (s.genre) settingsLines.push(`- Genre: ${s.genre}`);
    if (s.tone) settingsLines.push(`- Tone: ${s.tone}`);
    if (s.pov) settingsLines.push(`- POV / focus: ${s.pov}`);
    if (s.tense) settingsLines.push(`- Narrative tense: ${s.tense}`);
    if (s.audience) settingsLines.push(`- Target rating / audience: ${s.audience}`);
    if (s.language) settingsLines.push(`- Language: ${s.language}`);
    settingsLines.push(`- Action density: ${actionDensity}`);
    settingsLines.push(`- Dialogue style: ${dialogueStyle}`);
    settingsLines.push(`- Scene heading style: ${headingStyle === "with_time" ? "always include time-of-day (DAY/NIGHT/DAWN/DUSK)" : headingStyle === "compact" ? "brief location, omit time-of-day when not essential" : "standard INT./EXT. LOCATION - TIME"}`);
    settingsLines.push(`- Title page: ${includeTitlePage ? "include (Title, Credit, Author)" : "omit"}`);
    settingsLines.push(`- Scene numbers: ${includeSceneNumbers ? "include (#1#, #2# style)" : "do not include"}`);
    settingsLines.push(`- Transitions (e.g. CUT TO:, FADE OUT.): ${includeTransitions ? "use sparingly where dramatic" : "do not use"}`);
    settingsLines.push(`- Parentheticals (wrylies): ${includeParens ? "allowed, only when they change meaning" : "do not use"}`);
    settingsLines.push(`- Dual dialogue (^): ${dualDialogue ? "allowed when characters truly speak simultaneously" : "do not use"}`);
    if (s.extra_notes?.trim()) settingsLines.push(`- Additional notes: ${s.extra_notes.trim()}`);

    const systemPrompt = `You are a professional screenwriter. Convert the provided OKF concept card into a ${pageTarget} screenplay draft in valid Fountain format.

Rules:
- Output ONLY Fountain text. No markdown fences, no commentary.
- Use standard Fountain syntax throughout.
- CHARACTER names in caps for dialogue blocks.
- Ground every scene in the concept's premise, tone, and tags.
- Preserve any named entities from the concept exactly.
- Target ${pageTarget}. Keep it cinematic; no filler.

Draft settings (obey strictly):
${settingsLines.join("\n")}${variantDirective ? `\n\nVariant directive (this alternate must express this lens distinctly):\n${variantDirective}` : ""}`;

    const conceptSummary = JSON.stringify({
      type: concept.type,
      title: concept.title,
      status: concept.status,
      tags: concept.tags,
      source: concept.source,
      body: concept.body,
    }, null, 2);

    const result = await callAI({
      route: { functionName: "generate-draft-from-concept", modelHint: "google/gemini-3-flash-preview" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Concept card:\n\n${conceptSummary}` },
      ],
      temperature: 0.7,
      max_completion_tokens: 8000,
      meta: { userId: auth.userId, projectId, entryId: body.entry_id ?? undefined },
    });

    let fountainText = (result.content ?? "").trim();
    // Strip accidental code fences.
    fountainText = fountainText.replace(/^```(?:fountain)?\s*/i, "").replace(/```\s*$/i, "").trim();
    if (fountainText.length < 50) {
      return new Response(JSON.stringify({ error: "AI returned empty draft" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Bump fountain artifact version.
    const { data: latest } = await admin
      .from("project_artifacts")
      .select("id, version")
      .eq("project_id", projectId)
      .eq("artifact_type", "fountain")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = ((latest as any)?.version ?? 0) + 1;

    if (latest) {
      await admin.from("project_artifacts").update({ is_current: false })
        .eq("project_id", projectId).eq("artifact_type", "fountain").eq("is_current", true);
    }

    const { data: inserted, error: insErr } = await admin.from("project_artifacts").insert({
      project_id: projectId,
      artifact_type: "fountain",
      version: nextVersion,
      is_current: true,
      payload_json: {
        fountain_text: fountainText,
        _meta: {
          generated_at: new Date().toISOString(),
          model: result.modelId,
          prompt_tokens: result.promptTokens ?? 0,
          completion_tokens: result.completionTokens ?? 0,
          estimated_cost_cents: result.estimatedCostCents ?? 0,
          source_concept_artifact_id: body.concept_artifact_id,
          source_concept_title: concept.title ?? null,
          source_entry_id: body.entry_id ?? null,
          source_draft_id: sourceDraftId,
          pages_target: body.pages_target ?? "short",
          variant_label: body.variant_label ?? null,
          variant_directive: variantDirective || null,
          settings: s ?? null,

        },
      },
      created_by: auth.userId,
    }).select("id, version, created_at").single();

    if (insErr) {
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mirror into legacy entry surface (guarded on drafts side by trigger).
    if (body.entry_id) {
      await admin.from("entries")
        .update({ fountain_text: fountainText })
        .eq("id", body.entry_id);
    }

    await admin.from("ai_usage_log").insert({
      function_name: "generate-draft-from-concept",
      model_id: result.modelId,
      prompt_tokens: result.promptTokens ?? 0,
      completion_tokens: result.completionTokens ?? 0,
      estimated_cost_cents: result.estimatedCostCents ?? 0,
      status: "ok",
      user_id: auth.userId,
    });

    await logGovernanceAction({
      userId: auth.userId,
      action: "draft.generate_from_concept",
      target: {
        project_id: projectId,
        entry_id: body.entry_id ?? null,
        artifact_id: (inserted as any).id,
        source_concept_artifact_id: body.concept_artifact_id,
      },
      details: {
        version: nextVersion,
        model: result.modelId,
        pages_target: body.pages_target ?? "short",
        concept_title: concept.title ?? null,
      },
    });

    return new Response(JSON.stringify({
      artifact_id: (inserted as any).id,
      version: nextVersion,
      fountain: fountainText,
      model: result.modelId,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("generate-draft-from-concept error:", e);
    return aiErrorResponse(e, corsHeaders);
  }
});
