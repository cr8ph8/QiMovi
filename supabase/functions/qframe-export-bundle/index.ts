import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logGovernanceAction } from "../_shared/audit.ts";
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
      body: JSON.stringify({ action: "qframe_export_bundle", label: "Q-Frame: export bundle" }),
    });
    if (!spend.ok) return new Response(await spend.text(), { status: spend.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const [project, sections, bible, characters, symbols, shots, assets, shotRefs] = await Promise.all([
      admin.from("qframe_projects").select("*").eq("id", project_id).single(),
      admin.from("qframe_music_sections").select("*").eq("project_id", project_id).order("ordinal"),
      admin.from("qframe_visual_bible").select("*").eq("project_id", project_id).maybeSingle(),
      admin.from("qframe_characters").select("*").eq("project_id", project_id),
      admin.from("qframe_symbols").select("*").eq("project_id", project_id),
      admin.from("qframe_shots").select("*").eq("project_id", project_id).order("ordinal"),
      admin.from("qframe_assets").select("*").eq("project_id", project_id),
      admin.from("qframe_shot_refs")
        .select("id, shot_id, asset_id, role, created_at, qframe_shots!inner(project_id), qframe_assets!inner(project_id)")
        .eq("qframe_shots.project_id", project_id)
        .eq("qframe_assets.project_id", project_id),
    ]);

    const projectShotRefs = (shotRefs.data ?? []).map((ref: any) => ({
      id: ref.id,
      shot_id: ref.shot_id,
      asset_id: ref.asset_id,
      role: ref.role,
      created_at: ref.created_at,
    }));

    // Sign reference URLs (1 hour)
    const signed: Record<string, string> = {};
    for (const a of assets.data ?? []) {
      const { data } = await admin.storage.from("qframe-assets").createSignedUrl(a.storage_path, 3600);
      if (data?.signedUrl) signed[a.id] = data.signedUrl;
    }

    const bundle = {
      generated_at: new Date().toISOString(),
      project: project.data,
      music_sections: sections.data ?? [],
      visual_bible: bible.data ?? null,
      characters: characters.data ?? [],
      symbols: symbols.data ?? [],
      shots: shots.data ?? [],
      shot_refs: projectShotRefs,
      assets: (assets.data ?? []).map((a: any) => ({ ...a, signed_url: signed[a.id] ?? null })),
    };

    await logGovernanceAction({
      userId: user.id,
      action: "qframe.bundle.export",
      target: { project_id },
      details: { shot_count: (shots.data ?? []).length, asset_count: (assets.data ?? []).length },
    });

    return new Response(JSON.stringify(bundle), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("qframe-export-bundle error", e);
    return new Response(JSON.stringify({ error: e.message ?? "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
