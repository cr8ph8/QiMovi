import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI, aiErrorResponse, resolveModelHint } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SEED_SCREENPLAY_DRAFT_ON_HOLD = true;

const PAGE_TARGETS: Record<string, string> = {
  vertical: "3-5 pages",
  micro: "3-5 pages",
  short: "8-15 pages",
  pilot_30: "25-35 pages",
  pilot_60: "50-65 pages",
  feature: "90-110 pages",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (SEED_SCREENPLAY_DRAFT_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "AI screenplay drafting is temporarily paused while secure billing is upgraded.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { brief_id, format: requestedFormat } = await req.json();
    if (!brief_id || typeof brief_id !== "string") {
      return new Response(JSON.stringify({ error: "brief_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load the brief (RLS enforced via authed client)
    const { data: brief, error: briefErr } = await supabase
      .from("project_briefs")
      .select("id, user_id, title, organized, raw_dump")
      .eq("id", brief_id)
      .maybeSingle();
    if (briefErr || !brief) {
      return new Response(JSON.stringify({ error: "Brief not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (brief.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const organized = (brief.organized ?? {}) as Record<string, unknown>;
    const format =
      requestedFormat ||
      (organized.suggested_format as string | undefined) ||
      "short";
    const pageTarget = PAGE_TARGETS[format] || "8-15 pages";

    // Spend tokens via the canonical edge function so feature_configs is the
    // source of truth for pricing / gating.
    const spendResp = await admin.functions.invoke("spend-tokens", {
      headers: { Authorization: authHeader },
      body: {
        action: "seed_draft_from_brief",
        metadata: { brief_id, format },
      },
    });
    if (spendResp.error) {
      const msg = spendResp.error.message || "Insufficient tokens or feature locked.";
      return new Response(JSON.stringify({ error: msg }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are a professional screenwriter. Generate a FOUNTAIN-FORMATTED screenplay draft using the provided story brief.

Output rules — STRICT:
- Output ONLY Fountain syntax. No markdown, no headings, no explanations, no preamble.
- Scene headings start with INT. or EXT. (UPPERCASE), followed by location and time (e.g., "INT. KITCHEN - NIGHT").
- Character cues are UPPERCASE on their own line, followed by dialogue on the next line.
- Parentheticals like "(softly)" go on their own line under the character cue.
- Action lines are written in present tense, sentence case.
- Target length: ${pageTarget}.
- Honor the logline, characters, and plot beats provided. Each plot beat should map to one or more scenes.
- Keep dialogue crisp and visual. Show, don't tell.`;

    const userPrompt = JSON.stringify(
      {
        title: brief.title,
        logline: organized.logline,
        premise: organized.premise,
        themes: organized.themes,
        characters: organized.characters,
        world: organized.world,
        plot_beats: organized.plot_beats,
        scene_fragments: organized.scene_fragments,
        format,
      },
      null,
      2,
    );

    const modelHint = await resolveModelHint(
      "seed-screenplay-draft",
      "google/gemini-3-flash-preview",
    );
    const result = await callAI({
      route: { functionName: "seed-screenplay-draft", modelHint },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `BRIEF:\n${userPrompt}\n\nGenerate the Fountain screenplay now.` },
      ],
      max_completion_tokens: 8000,
      temperature: 0.85,
      meta: { userId: user.id },
    });

    const fountain = (result.content || "").trim();
    if (!fountain) {
      return new Response(JSON.stringify({ error: "Empty generation" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert the draft (RLS via authed client)
    const draftTitle =
      (brief.title as string | null)?.slice(0, 200) ||
      ((organized.logline as string | undefined)?.slice(0, 80) ?? "Untitled Screenplay");

    const { data: draft, error: draftErr } = await supabase
      .from("screenplay_drafts")
      .insert({
        user_id: user.id,
        title: draftTitle,
        format,
        fountain_text: fountain,
        brief_id,
      })
      .select("id")
      .single();
    if (draftErr || !draft) {
      return new Response(JSON.stringify({ error: draftErr?.message ?? "Draft insert failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("screenplay_draft_versions").insert({
      draft_id: draft.id,
      user_id: user.id,
      fountain_text: fountain,
      title: draftTitle,
      source: "ai_seed",
    });

    return new Response(
      JSON.stringify({ draft_id: draft.id, fountain, model: result.modelId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("seed-screenplay-draft error:", error);
    return aiErrorResponse(error, corsHeaders);
  }
});
