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
      body: JSON.stringify({ action: "qframe_shots_suggest", label: "Q-Frame: shots suggest" }),
    });
    if (!spend.ok) return new Response(await spend.text(), { status: spend.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const [sectionsRes, bibleRes, symRes, charRes] = await Promise.all([
      admin.from("qframe_music_sections").select("*").eq("project_id", project_id).order("ordinal"),
      admin.from("qframe_visual_bible").select("*").eq("project_id", project_id).maybeSingle(),
      admin.from("qframe_symbols").select("symbol, meaning").eq("project_id", project_id),
      admin.from("qframe_characters").select("name, costume").eq("project_id", project_id),
    ]);

    const ctx = {
      sections: sectionsRes.data ?? [],
      bible: bibleRes.data ?? {},
      symbols: symRes.data ?? [],
      characters: charRes.data ?? [],
    };

    const result = await callAI({
      route: { functionName: "qframe-suggest-shots", modelHint: "google/gemini-2.5-pro" },
      messages: [
        { role: "system", content: "You draft a music video shot list. Cuts mean things; do not cut on every beat. Use the return_shots tool." },
        { role: "user", content: `Context:\n${JSON.stringify(ctx, null, 2)}\n\nReturn 8–14 shots that span the whole song.` },
      ],
      tools: [{
        type: "function",
        function: {
          name: "return_shots",
          description: "Return a draft shot list.",
          parameters: {
            type: "object",
            properties: {
              shots: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    section_name: { type: "string" },
                    time_start_sec: { type: "number" },
                    time_end_sec: { type: "number" },
                    narrative_function: { type: "string" },
                    perspective_mode: { type: "string" },
                    visual_prompt: { type: "string" },
                    motion_prompt: { type: "string" },
                    negative_prompt: { type: "string" },
                    continuity_rules: { type: "array", items: { type: "string" } },
                  },
                  required: ["time_start_sec","time_end_sec","narrative_function","perspective_mode","visual_prompt"],
                  additionalProperties: false,
                },
              },
            },
            required: ["shots"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "return_shots" } },
      max_completion_tokens: 3500,
      meta: { userId: user.id },
    });

    const tc = result.raw?.choices?.[0]?.message?.tool_calls?.[0];
    if (!tc) throw new Error("No tool call returned");
    const parsed = JSON.parse(tc.function.arguments);

    const sectionByName = new Map((sectionsRes.data ?? []).map((s: any) => [s.name, s.id]));
    const { data: existing } = await admin.from("qframe_shots").select("ordinal").eq("project_id", project_id);
    let next = existing?.length ? Math.max(...existing.map((e: any) => e.ordinal)) + 1 : 0;
    const rows = (parsed.shots ?? []).map((s: any) => ({
      project_id,
      section_id: s.section_name ? sectionByName.get(s.section_name) ?? null : null,
      ordinal: next++,
      time_start_sec: s.time_start_sec,
      time_end_sec: s.time_end_sec,
      narrative_function: s.narrative_function,
      perspective_mode: s.perspective_mode,
      visual_prompt: s.visual_prompt,
      motion_prompt: s.motion_prompt ?? null,
      negative_prompt: s.negative_prompt ?? null,
      continuity_rules: s.continuity_rules ?? [],
      status: "draft",
    }));
    if (rows.length) await admin.from("qframe_shots").insert(rows);

    return new Response(JSON.stringify({ ok: true, inserted: rows.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("qframe-suggest-shots error", e);
    return new Response(JSON.stringify({ error: e.message ?? "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
