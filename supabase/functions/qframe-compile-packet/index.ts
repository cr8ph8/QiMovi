import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logGovernanceAction } from "../_shared/audit.ts";
import { mirrorArtifactEdge } from "../_shared/project-mirror.ts";
import { requireQFrameProjectOwner } from "../_shared/qframe-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

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

    const { shot_id } = await req.json();
    if (!shot_id) throw new Error("shot_id required");

    const admin = createClient(supabaseUrl, service);
    const { data: shotAnchor, error: shotAnchorError } = await admin
      .from("qframe_shots")
      .select("id, project_id")
      .eq("id", shot_id)
      .maybeSingle();
    if (shotAnchorError || !shotAnchor) {
      return new Response(JSON.stringify({ error: "Shot not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const projectAccess = await requireQFrameProjectOwner(
      admin,
      user.id,
      shotAnchor.project_id,
      corsHeaders,
    );
    if (projectAccess instanceof Response) return projectAccess;

    const spend = await fetch(`${supabaseUrl}/functions/v1/spend-tokens`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify({ action: "qframe_packet_compile", label: "Q-Frame: packet compile" }),
    });
    if (!spend.ok) return new Response(await spend.text(), { status: spend.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: shot } = await admin.from("qframe_shots").select("*").eq("id", shot_id).single();
    if (!shot) throw new Error("Shot not found");

    const [refsRes, charRes, symRes, bibleRes] = await Promise.all([
      admin.from("qframe_shot_refs")
        .select("asset_id, role, qframe_assets!inner(project_id)")
        .eq("shot_id", shot_id)
        .eq("qframe_assets.project_id", shot.project_id),
      admin.from("qframe_characters").select("name, costume, forbidden_changes").eq("project_id", shot.project_id),
      admin.from("qframe_symbols").select("symbol, must_appear_in").eq("project_id", shot.project_id),
      admin.from("qframe_visual_bible").select("perspective_arc").eq("project_id", shot.project_id).maybeSingle(),
    ]);
    const references = (refsRes.data ?? []).map((ref: any) => ({
      asset_id: ref.asset_id,
      role: ref.role,
    }));

    const lint: string[] = [];
    if (!shot.visual_prompt) lint.push("Missing visual_prompt");
    if (!shot.perspective_mode) lint.push("Missing perspective_mode");
    if (references.length === 0 && (charRes.data ?? []).length > 0) lint.push("No reference assets attached — character continuity at risk");

    // Section-aware checks
    if (shot.section_id && bibleRes.data?.perspective_arc) {
      const { data: sec, error: sectionError } = await admin
        .from("qframe_music_sections")
        .select("name")
        .eq("id", shot.section_id)
        .eq("project_id", shot.project_id)
        .maybeSingle();
      if (sectionError) throw sectionError;
      if (!sec) {
        lint.push("Shot section is missing or does not belong to this project");
      }
      const expectedPersp = (bibleRes.data.perspective_arc as any)?.[sec?.name ?? ""];
      if (expectedPersp && shot.perspective_mode && expectedPersp !== shot.perspective_mode) {
        lint.push(`Perspective '${shot.perspective_mode}' diverges from bible arc '${expectedPersp}' for section '${sec?.name}'`);
      }
      // Symbol presence
      for (const s of symRes.data ?? []) {
        if ((s.must_appear_in ?? []).includes(sec?.name ?? "") && !((shot.visual_prompt ?? "") + " " + (shot.continuity_rules ?? []).join(" ")).toLowerCase().includes(s.symbol.toLowerCase())) {
          lint.push(`Required symbol '${s.symbol}' not referenced in this shot (section ${sec?.name})`);
        }
      }
    }

    const packet = {
      shot_id: shot.id,
      ordinal: shot.ordinal,
      time_start_sec: shot.time_start_sec,
      time_end_sec: shot.time_end_sec,
      narrative_function: shot.narrative_function,
      perspective_mode: shot.perspective_mode,
      camera: shot.camera,
      visual_prompt: shot.visual_prompt,
      motion_prompt: shot.motion_prompt,
      negative_prompt: shot.negative_prompt,
      continuity_rules: shot.continuity_rules,
      references,
      characters: charRes.data ?? [],
    };
    const evidence_hash = await sha256Hex(JSON.stringify(packet));

    await admin.from("qframe_shots").update({
      lint_warnings: lint,
      evidence_hash,
      status: lint.length === 0 ? "compiled" : "compiled_with_warnings",
    }).eq("id", shot_id);

    await logGovernanceAction({
      userId: user.id,
      action: "qframe.packet.compile",
      target: { shot_id, project_id: shot.project_id },
      details: { evidence_hash, lint_count: lint.length },
    });

    // Mirror to unified projects (fire-and-forget, flag-gated).
    try {
      const { data: proj } = await admin
        .from("qframe_projects")
        .select("id, owner_id, title")
        .eq("id", shot.project_id)
        .maybeSingle();
      if (proj) {
        await mirrorArtifactEdge({
          source: "qframe_projects",
          sourceId: (proj as any).id,
          ownerId: (proj as any).owner_id ?? user.id,
          title: (proj as any).title ?? "Q-Frame Project",
          artifactType: "qframe_bundle",
          payload: { shot_id, evidence_hash, lint_count: lint.length },
          userIdForFlag: user.id,
        });
      }
    } catch (e) {
      console.warn("[qframe-compile-packet] mirror failed", e);
    }

    return new Response(JSON.stringify({ ok: true, packet, lint, evidence_hash }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("qframe-compile-packet error", e);
    return new Response(JSON.stringify({ error: e.message ?? "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
