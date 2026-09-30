// Computes a 7-day Script Club digest for a chapter: reviews, finishers,
// active cycles, leaderboard. Pull-based (callable by any member);
// scheduling can be layered on later via pg_cron without changing this code.
import { z } from "npm:zod@3.23.8";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { hasAdminRole, requireUser } from "../_shared/auth.ts";

const BodySchema = z.object({
  chapter_id: z.string().uuid(),
  window_days: z.number().int().min(1).max(31).optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await requireUser(req, corsHeaders);
    if (auth instanceof Response) return auth;

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { chapter_id, window_days = 7 } = parsed.data;

    const supabase = auth.admin;
    const { data: membership, error: membershipError } = await supabase
      .from("reader_chapter_members")
      .select("user_id")
      .eq("chapter_id", chapter_id)
      .eq("user_id", auth.userId)
      .maybeSingle();
    const isAdmin = await hasAdminRole(supabase, auth.userId);
    if (membershipError || (!membership && !isAdmin)) {
      return new Response(JSON.stringify({ error: "Chapter not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const since = new Date(Date.now() - window_days * 86_400_000).toISOString();

    const [cyclesRes, membersRes] = await Promise.all([
      supabase.from("reading_cycles").select("id, tier, status, screenplay_title, end_date").eq("chapter_id", chapter_id),
      supabase.from("reader_chapter_members").select("user_id").eq("chapter_id", chapter_id),
    ]);

    const cycleIds = (cyclesRes.data ?? []).map((c: any) => c.id);
    const memberIds = (membersRes.data ?? []).map((m: any) => m.user_id);

    let reviewsCount = 0, finishersCount = 0, tokensAwarded = 0;
    let topReviewers: { user_id: string; count: number }[] = [];

    if (cycleIds.length > 0) {
      const { data: reviews } = await supabase
        .from("club_reviews")
        .select("user_id, reward_tokens, status, created_at")
        .in("cycle_id", cycleIds)
        .gte("created_at", since);

      const safe = reviews ?? [];
      reviewsCount = safe.length;
      tokensAwarded = safe
        .filter((r: any) => r.status === "approved")
        .reduce((s: number, r: any) => s + (r.reward_tokens ?? 0), 0);

      const counts = new Map<string, number>();
      for (const r of safe) counts.set(r.user_id, (counts.get(r.user_id) ?? 0) + 1);
      topReviewers = [...counts.entries()]
        .map(([user_id, count]) => ({ user_id, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      const { count: finCount } = await supabase
        .from("reading_cycle_memberships")
        .select("user_id", { count: "exact", head: true })
        .in("cycle_id", cycleIds)
        .gte("completed_at", since);
      finishersCount = finCount ?? 0;
    }

    const payload = {
      chapter_id,
      window_days,
      generated_at: new Date().toISOString(),
      member_count: memberIds.length,
      active_cycles: (cyclesRes.data ?? []).filter((c: any) => c.status === "active"),
      reviews_count: reviewsCount,
      finishers_count: finishersCount,
      tokens_awarded: tokensAwarded,
      top_reviewers: topReviewers,
    };

    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("chapter-weekly-digest error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
