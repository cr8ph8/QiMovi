import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI } from "../_shared/ai-router.ts";
import { requireQFrameProjectOwner } from "../_shared/qframe-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { project_id } = await req.json();
    if (!project_id) throw new Error("project_id required");

    const admin = createClient(supabaseUrl, service);
    const projectAccess = await requireQFrameProjectOwner(
      admin,
      user.id,
      project_id,
      corsHeaders,
    );
    if (projectAccess instanceof Response) return projectAccess;

    const spend = await fetch(`${supabaseUrl}/functions/v1/spend-tokens`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify({ action: "qframe_bible_draft", label: "Q-Frame: bible draft" }),
    });
    if (!spend.ok) return new Response(await spend.text(), { status: spend.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const [project, sections, assets] = await Promise.all([
      admin.from("qframe_projects").select("title, song_title, story_summary").eq("id", project_id).single(),
      admin.from("qframe_music_sections").select("name, emotion, energy").eq("project_id", project_id).order("ordinal"),
      admin.from("qframe_assets").select("subject, mood, color_notes").eq("project_id", project_id).not("tagged_at", "is", null).limit(30),
    ]);

    const ctx = {
      title: project.data?.title,
      song: project.data?.song_title,
      summary: project.data?.story_summary,
      sections: sections.data ?? [],
      tagged_assets: assets.data ?? [],
    };

    const result = await callAI({
      route: { functionName: "qframe-draft-bible", modelHint: "google/gemini-2.5-pro" },
      messages: [
        { role: "system", content: "You draft a Visual Story Bible for a music video. Return concise, evocative, actionable values. Use the return_bible tool." },
        { role: "user", content: `Context:\n${JSON.stringify(ctx, null, 2)}` },
      ],
      tools: [{
        type: "function",
        function: {
          name: "return_bible",
          description: "Return a visual story bible.",
          parameters: {
            type: "object",
            properties: {
              core_theme: { type: "string" },
              visual_question: { type: "string" },
              color_arc: { type: "object", additionalProperties: { type: "string" } },
              perspective_arc: { type: "object", additionalProperties: { type: "string" } },
              symbols: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    symbol: { type: "string" },
                    meaning: { type: "string" },
                    evolution: { type: "array", items: { type: "string" } },
                    must_appear_in: { type: "array", items: { type: "string" } },
                  },
                  required: ["symbol","meaning"],
                  additionalProperties: false,
                },
              },
            },
            required: ["core_theme","visual_question","color_arc","perspective_arc","symbols"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "return_bible" } },
      max_completion_tokens: 1500,
      meta: { userId: user.id },
    });

    const tc = result.raw?.choices?.[0]?.message?.tool_calls?.[0];
    if (!tc) throw new Error("No tool call returned");
    const bible = JSON.parse(tc.function.arguments);

    await admin.from("qframe_visual_bible").upsert({
      project_id,
      core_theme: bible.core_theme,
      visual_question: bible.visual_question,
      color_arc: bible.color_arc ?? {},
      perspective_arc: bible.perspective_arc ?? {},
    });

    // Insert symbols (skip if already present by name)
    const { data: existing } = await admin.from("qframe_symbols").select("symbol").eq("project_id", project_id);
    const existingNames = new Set((existing ?? []).map((x: any) => x.symbol));
    const toInsert = (bible.symbols ?? []).filter((s: any) => !existingNames.has(s.symbol)).map((s: any) => ({
      project_id, symbol: s.symbol, meaning: s.meaning ?? null,
      evolution: s.evolution ?? [], must_appear_in: s.must_appear_in ?? [],
    }));
    if (toInsert.length) await admin.from("qframe_symbols").insert(toInsert);

    return new Response(JSON.stringify({ ok: true, bible }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("qframe-draft-bible error", e);
    return new Response(JSON.stringify({ error: e.message ?? "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
