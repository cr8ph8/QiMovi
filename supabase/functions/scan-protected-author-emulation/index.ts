// Retroactive scan: sweep ai_usage_log for past prompts that name a
// protected author and create author_emulation_flags rows for admin review.
// Admin-only; invoked from the Fine-Tune Risk panel.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function normalizeForMatch(s: string): string {
  return s.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userData.user.id, _role: "admin" });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load protected authors
    const { data: authorsRaw } = await admin
      .from("protected_authors")
      .select("name_normalized")
      .eq("active", true);
    const authors: string[] = (authorsRaw || []).map((r: any) => r.name_normalized);
    if (authors.length === 0) {
      return new Response(JSON.stringify({ scanned: 0, flagged: 0, note: "No protected authors configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sweep recent ai_usage_log entries (last 90d) that haven't already been flagged
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: logs } = await admin
      .from("ai_usage_log")
      .select("id, user_id, entry_id, function_name, correlation_id, routing_reason, created_at")
      .gte("created_at", since)
      .neq("status", "blocked")
      .limit(5000);

    let flagged = 0;
    // The ai_usage_log does NOT store the prompt body. Retroactive matching
    // therefore uses (a) routing_reason field already containing matches written
    // by the live router, and (b) any persisted entry titles/loglines that may
    // contain a named author. Keep it deterministic and side-effect light.
    const { data: entries } = await admin
      .from("entries")
      .select("id, user_id, title, logline")
      .gte("created_at", since)
      .limit(5000);

    const entryById = new Map<string, any>();
    (entries || []).forEach((e: any) => entryById.set(e.id, e));

    for (const log of (logs || [])) {
      if (!log.entry_id) continue;
      const entry = entryById.get(log.entry_id);
      if (!entry) continue;
      const haystack = " " + normalizeForMatch(`${entry.title || ""} ${entry.logline || ""}`) + " ";
      const match = authors.find((a) => haystack.includes(" " + a + " "));
      if (!match) continue;

      // Skip if we already have a flag for this entry+author
      const { data: existing } = await admin
        .from("author_emulation_flags")
        .select("id")
        .eq("entry_id", log.entry_id)
        .eq("matched_author", match)
        .limit(1);
      if (existing && existing.length > 0) continue;

      const { error: rpcErr } = await admin.rpc("log_author_emulation_flag", {
        _user_id: log.user_id,
        _entry_id: log.entry_id,
        _function_name: log.function_name,
        _matched_author: match,
        _match_kind: "retroactive_scan",
        _correlation_id: log.correlation_id,
      });
      if (!rpcErr) flagged++;
    }

    return new Response(JSON.stringify({
      scanned: (logs || []).length,
      flagged,
      authors_active: authors.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[scan-protected-author-emulation] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
