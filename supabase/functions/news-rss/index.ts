import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SITE_URL = "https://caniscreenwrite.com";

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await supabase
      .from("news_articles")
      .select("title, slug, excerpt, category, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    const items = (data || [])
      .map((a: any) => {
        const link = `${SITE_URL}/news?article=${a.slug}`;
        const pubDate = a.published_at
          ? new Date(a.published_at).toUTCString()
          : new Date().toUTCString();
        return `    <item>
      <title>${xmlEscape(a.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${pubDate}</pubDate>
      <category>${xmlEscape(a.category)}</category>
      <description>${xmlEscape(a.excerpt || "")}</description>
    </item>`;
      })
      .join("\n");

    const lastBuild = data?.[0]?.published_at
      ? new Date(data[0].published_at).toUTCString()
      : new Date().toUTCString();

    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>CanIScreenwrite — News &amp; Updates</title>
    <link>${SITE_URL}/news</link>
    <description>Releases, system changes, competitions, and legal updates from CanIScreenwrite.</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
${items}
  </channel>
</rss>`;

    return new Response(rss, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (e) {
    console.error("news-rss error:", e);
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><error>${xmlEscape(String(e))}</error>`,
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/xml" },
      }
    );
  }
});
