// The previous deployment-specific demo film corpus is not part of this release.
// Keep the route explicit so callers cannot mistake omitted private data for a seed.
Deno.serve((req) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Content-Type": "application/json",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  return new Response(JSON.stringify({ error: "DEMO_CORPUS_NOT_DISTRIBUTED", seeded: false }), { status: 501, headers });
});
