import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAdminOrService } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Only admins or trusted server-side cron (service-role bearer) may run this.
    const auth = await requireAdminOrService(req, corsHeaders);
    if (auth instanceof Response) return auth;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );


    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from("news_articles")
      .update({ status: "published", updated_at: nowIso })
      .eq("status", "scheduled")
      .lte("published_at", nowIso)
      .select("id, title, slug");

    if (error) {
      console.error("publish-scheduled-news error:", error);
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const promoted = data?.length || 0;
    console.log(`publish-scheduled-news: promoted ${promoted} article(s)`);

    return new Response(
      JSON.stringify({
        ok: true,
        promoted,
        articles: data || [],
        ran_at: nowIso,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    console.error("publish-scheduled-news unhandled:", e);
    return new Response(
      JSON.stringify({ ok: false, error: String(e) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
