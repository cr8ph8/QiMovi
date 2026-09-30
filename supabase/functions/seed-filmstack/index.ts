import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI, aiErrorResponse } from "../_shared/ai-router.ts";
import { requireUser, requireEntryOwner } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UNCHARGED_FILMSTACK_AI_ON_HOLD = true;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { entry_id } = await req.json();
    if (!entry_id) {
      return new Response(JSON.stringify({ error: "entry_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const auth = await requireUser(req, corsHeaders);
    if (auth instanceof Response) return auth;
    const supabase = auth.admin;

    const ownerCheck = await requireEntryOwner(supabase, auth.userId, entry_id, corsHeaders);
    if (ownerCheck instanceof Response) return ownerCheck;

    if (UNCHARGED_FILMSTACK_AI_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "AI development-document generation is temporarily paused while secure billing is upgraded.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: entry, error } = await supabase
      .from("entries")
      .select("id, title, logline, genre, script_text, parsed_metadata, user_id")
      .eq("id", entry_id)
      .single();

    if (error || !entry) throw new Error("Entry not found");

    const modelId = "google/gemini-2.5-flash";
    const scriptExcerpt = (entry.script_text || "").slice(0, 8000);
    const meta = `Title: ${entry.title}\nLogline: ${entry.logline || "N/A"}\nGenre: ${entry.genre || "N/A"}`;

    const prompt = `You are a screenplay development assistant. Based on this screenplay, generate six project documents as JSON.

${meta}

Screenplay excerpt:
${scriptExcerpt}

Return valid JSON with exactly this structure:
{
  "logline_doc": "A polished, expanded logline document (2-3 paragraphs) covering the core premise, protagonist, conflict, and stakes.",
  "synopsis": "A 1-2 page synopsis covering the full story arc: setup, rising action, climax, resolution. Include key character decisions and turning points.",
  "film_prd": "A Film PRD (Product Requirements Document) covering target audience, tone, comparable films, key themes, visual style, and production notes. 3-4 paragraphs.",
  "character_bible": "A character bible covering the main characters (up to 5), their arcs, motivations, relationships, and key traits. Use bullet points within prose.",
  "world_bible": "A world bible covering the setting, time period, rules of the world, geography, culture, technology level, and any unique elements. 2-3 paragraphs.",
  "beat_sheet": "A beat sheet listing 12-15 major structural beats: Opening Image, Theme Stated, Set-Up, Catalyst, Debate, Break Into Two, B Story, Midpoint, Bad Guys Close In, All Is Lost, Dark Night of the Soul, Break Into Three, Finale, Final Image. For each beat provide a 1-2 sentence description."
}`;

    let result;
    try {
      result = await callAI({
        route: { functionName: "seed-filmstack", modelHint: modelId },
        messages: [
          { role: "system", content: "You are a screenplay development assistant. Return only valid JSON." },
          { role: "user", content: prompt },
        ],
        max_completion_tokens: 5000,
        temperature: 0.5,
        response_format: { type: "json_object" },
        meta: { entryId: entry_id, userId: entry.user_id },
      });
    } catch (e) {
      return aiErrorResponse(e, corsHeaders);
    }

    const content = result.content || "{}";

    let rawDocs;
    try {
      rawDocs = JSON.parse(content);
    } catch {
      throw new Error("Failed to parse FilmStack response");
    }

    const now = new Date().toISOString();

    // Build the 6 auto-seeded docs with proper structure
    const seedableKeys = ["logline_doc", "synopsis", "film_prd", "character_bible", "world_bible", "beat_sheet"];
    const categoryMap: Record<string, string> = {
      logline_doc: "writing",
      synopsis: "writing",
      film_prd: "development",
      character_bible: "writing",
      world_bible: "writing",
      beat_sheet: "writing",
    };
    const titleMap: Record<string, string> = {
      logline_doc: "Logline",
      synopsis: "Synopsis",
      film_prd: "Film PRD",
      character_bible: "Character Bible",
      world_bible: "World Bible",
      beat_sheet: "Beat Sheet",
    };

    const filmstack: Record<string, any> = {};
    for (const key of seedableKeys) {
      const docContent = rawDocs[key] || "";
      filmstack[key] = {
        title: titleMap[key],
        content: docContent,
        category: categoryMap[key],
        status: docContent ? "draft" : "missing",
        generated_at: docContent ? now : null,
      };
    }

    // Preserve existing filmstack data for non-seeded docs
    const existingMeta = (entry.parsed_metadata as Record<string, any>) || {};
    const existingFilmstack = existingMeta.filmstack || {};
    const mergedFilmstack = { ...existingFilmstack, ...filmstack };

    await supabase
      .from("entries")
      .update({ parsed_metadata: { ...existingMeta, filmstack: mergedFilmstack } })
      .eq("id", entry_id);

    // Telemetry already logged by callAI() — no double-write needed.

    return new Response(
      JSON.stringify({ success: true, filmstack: mergedFilmstack }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("FilmStack seed error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
