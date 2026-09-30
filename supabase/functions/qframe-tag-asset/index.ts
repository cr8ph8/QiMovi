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

    const { asset_id } = await req.json();
    if (!asset_id) throw new Error("asset_id required");

    const admin = createClient(supabaseUrl, service);
    const { data: assetAnchor, error: assetAnchorError } = await admin
      .from("qframe_assets")
      .select("id, project_id")
      .eq("id", asset_id)
      .maybeSingle();
    if (assetAnchorError || !assetAnchor) {
      return new Response(JSON.stringify({ error: "Asset not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const projectAccess = await requireQFrameProjectOwner(
      admin,
      user.id,
      assetAnchor.project_id,
      corsHeaders,
    );
    if (projectAccess instanceof Response) return projectAccess;

    // Spend tokens
    const spend = await fetch(`${supabaseUrl}/functions/v1/spend-tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify({ action: "qframe_asset_tag", label: "Q-Frame: asset tag" }),
    });
    if (!spend.ok) {
      const t = await spend.text();
      return new Response(t, { status: spend.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: asset } = await admin.from("qframe_assets").select("*").eq("id", asset_id).single();
    if (!asset) throw new Error("Asset not found");

    // Signed URL for the image
    const { data: signed } = await admin.storage.from("qframe-assets").createSignedUrl(asset.storage_path, 300);
    if (!signed?.signedUrl) throw new Error("Could not sign asset URL");

    const result = await callAI({
      route: { functionName: "qframe-tag-asset", modelHint: "google/gemini-2.5-flash" },
      messages: [
        { role: "system", content: "You tag visual reference assets for a music video previz pipeline. Be concise and concrete. Use the return_asset_tags tool." },
        { role: "user", content: [
            { type: "text", text: "Tag this asset for use in a music-video shot package." },
            { type: "image_url", image_url: { url: signed.signedUrl } },
          ] as any },
      ],
      tools: [{
        type: "function",
        function: {
          name: "return_asset_tags",
          description: "Return tags describing the visual asset.",
          parameters: {
            type: "object",
            properties: {
              subject: { type: "string", description: "Primary subject (e.g. main_character, alley, mirror)" },
              mood: { type: "array", items: { type: "string" } },
              color_notes: { type: "array", items: { type: "string" } },
              usable_for: { type: "array", items: { type: "string" }, description: "e.g. sprite_reference, scene_reference, memory_flashback" },
              quality_score: { type: "number", description: "0..1 visual quality" },
              role_hint: { type: "string", description: "Suggested role: sprite_ref, scene_ref, symbol, texture" },
            },
            required: ["subject","mood","color_notes","usable_for","quality_score"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "return_asset_tags" } },
      max_completion_tokens: 400,
      meta: { userId: user.id },
    });

    const tc = result.raw?.choices?.[0]?.message?.tool_calls?.[0];
    if (!tc) throw new Error("No tool call returned");
    const tags = JSON.parse(tc.function.arguments);

    await admin.from("qframe_assets").update({
      subject: tags.subject ?? null,
      mood: tags.mood ?? [],
      color_notes: tags.color_notes ?? [],
      usable_for: tags.usable_for ?? [],
      quality_score: tags.quality_score ?? null,
      role: asset.role ?? tags.role_hint ?? null,
      ai_tags: tags,
      tagged_at: new Date().toISOString(),
    }).eq("id", asset_id);

    return new Response(JSON.stringify({ ok: true, tags }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("qframe-tag-asset error", e);
    return new Response(JSON.stringify({ error: e.message ?? "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
