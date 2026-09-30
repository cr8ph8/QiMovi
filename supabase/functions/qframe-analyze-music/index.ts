import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireQFrameProjectOwner } from "../_shared/qframe-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Stub: seeds 5 default sections. Full Gemini audio analysis lands in a follow-up.
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
      body: JSON.stringify({ action: "qframe_music_analyze", label: "Q-Frame: music analyze" }),
    });
    if (!spend.ok) return new Response(await spend.text(), { status: spend.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { count } = await admin.from("qframe_music_sections").select("*", { count: "exact", head: true }).eq("project_id", project_id);
    if ((count ?? 0) > 0) {
      return new Response(JSON.stringify({ ok: true, skipped: "sections already exist" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const defaults = [
      { name: "intro", ordinal: 0, start_sec: 0, end_sec: 14, energy: 0.25, emotion: "memory opening", visual_mode: "slow reveal" },
      { name: "verse_1", ordinal: 1, start_sec: 14, end_sec: 45, energy: 0.5, emotion: "search", visual_mode: "tracking" },
      { name: "chorus_1", ordinal: 2, start_sec: 45, end_sec: 75, energy: 0.86, emotion: "release", visual_mode: "large-scale motion" },
      { name: "bridge", ordinal: 3, start_sec: 110, end_sec: 140, energy: 0.4, emotion: "fracture", visual_mode: "dream distortion" },
      { name: "finale", ordinal: 4, start_sec: 170, end_sec: 200, energy: 0.95, emotion: "transcendence", visual_mode: "transformation" },
    ].map(d => ({ ...d, project_id }));
    await admin.from("qframe_music_sections").insert(defaults);

    return new Response(JSON.stringify({ ok: true, inserted: defaults.length, note: "Default sections seeded. Audio-based analysis lands in a follow-up." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message ?? "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
