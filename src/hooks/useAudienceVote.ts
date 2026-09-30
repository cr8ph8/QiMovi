import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

const FP_KEY = "festival_voter_fp";
const MY_RATING_PREFIX = "festival_voter_rating:";

function getFingerprint(): string {
  let fp = localStorage.getItem(FP_KEY);
  if (!fp) {
    fp = crypto.randomUUID();
    localStorage.setItem(FP_KEY, fp);
  }
  return fp;
}

function readCachedRating(sessionId: string): number | null {
  const raw = localStorage.getItem(MY_RATING_PREFIX + sessionId);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function writeCachedRating(sessionId: string, rating: number) {
  localStorage.setItem(MY_RATING_PREFIX + sessionId, String(rating));
}

export interface AudienceStats {
  count: number;
  average: number | null;
  myRating: number | null;
}

/**
 * Runtime guard: enforces that any read against the audience-vote aggregate
 * view uses ONLY the allowlisted, non-PII columns. Any attempt to select a
 * disallowed column (e.g. `voter_fingerprint`, `user_id`, `rating`, or `*`)
 * throws immediately — before the query is issued — so a regression cannot
 * silently bypass the aggregate boundary.
 */
export const AGGREGATE_VIEW = "screening_audience_vote_aggregates" as const;
export const ALLOWED_AGGREGATE_COLUMNS = new Set([
  "session_id",
  "vote_count",
  "average_rating",
]);

export function assertAggregateSelect(columns: string): void {

  const requested = columns
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (requested.length === 0) {
    throw new Error(
      `[useAudienceVote] Empty select on ${AGGREGATE_VIEW} is not allowed — enumerate aggregate columns explicitly.`,
    );
  }
  const disallowed = requested.filter((c) => !ALLOWED_AGGREGATE_COLUMNS.has(c));
  if (disallowed.length > 0) {
    throw new Error(
      `[useAudienceVote] Disallowed column(s) [${disallowed.join(
        ", ",
      )}] on ${AGGREGATE_VIEW}. Per-voter data must never be selected; use the aggregate view only. Allowed: ${[
        ...ALLOWED_AGGREGATE_COLUMNS,
      ].join(", ")}.`,
    );
  }
}

function selectAggregates(columns: string) {
  assertAggregateSelect(columns);
  return supabase.from(AGGREGATE_VIEW).select(columns);
}

type AggregateRow = {
  session_id: string;
  vote_count: number | null;
  average_rating: number | null;
};




/**
 * Audience-vote UI hook.
 *
 * PII boundary: this hook NEVER reads per-voter rows or `voter_fingerprint`
 * from the base table. It only reads aggregate counts/averages from
 * `screening_audience_vote_aggregates` (a security_invoker view exposed to
 * anon + authenticated) plus, for authenticated users, their OWN row via the
 * "Voters can read their own audience vote" RLS policy. For anonymous
 * voters, the user's own rating is remembered client-side in localStorage
 * so it survives reloads without exposing anyone else's fingerprint.
 */
export function useAudienceVote(sessionId: string | null) {
  const [stats, setStats] = useState<AudienceStats>({ count: 0, average: null, myRating: null });
  const fp = getFingerprint();

  const load = useCallback(async () => {
    if (!sessionId) return;
    // Aggregates only — no per-voter data.
    const { data: aggRaw } = await selectAggregates("vote_count, average_rating")
      .eq("session_id", sessionId)
      .maybeSingle();
    const agg = aggRaw as unknown as Pick<AggregateRow, "vote_count" | "average_rating"> | null;
    const count = Number(agg?.vote_count ?? 0);
    const average = agg?.average_rating != null ? Number(agg.average_rating) : null;


    // My rating: authenticated users can read their own row (RLS-scoped).
    // Anonymous voters fall back to a client-side cache — the fingerprint
    // is never sent to or read from the server for aggregate display.
    let myRating: number | null = readCachedRating(sessionId);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: mine } = await supabase
        .from("screening_audience_votes")
        .select("rating")
        .eq("session_id", sessionId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (mine?.rating != null) myRating = Number(mine.rating);
    }

    setStats({ count, average, myRating });
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    load();
    const ch = supabase
      .channel(`audience:${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "screening_audience_votes", filter: `session_id=eq.${sessionId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [sessionId, load]);

  const vote = async (rating: number) => {
    if (!sessionId) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("screening_audience_votes").insert({
      session_id: sessionId,
      rating,
      voter_fingerprint: fp,
      user_id: user?.id ?? null,
    });
    if (error) throw error;
    writeCachedRating(sessionId, rating);
    await load();
  };

  return { stats, vote, fingerprint: fp };
}

/**
 * Per-entry audience totals for a competition. Reads only session→entry
 * mapping plus the aggregate view — never per-voter rows.
 */
export function useCompetitionAudienceTotals(competitionId: string | null) {
  const [totals, setTotals] = useState<Record<string, { count: number; average: number }>>({});

  useEffect(() => {
    if (!competitionId) return;
    let active = true;
    const load = async () => {
      const { data: sessions } = await supabase
        .from("screening_sessions")
        .select("id,entry_id")
        .eq("competition_id", competitionId);
      const sessionIds = (sessions ?? []).map((s) => s.id);
      if (!sessionIds.length) {
        if (active) setTotals({});
        return;
      }
      const { data: aggsRaw } = await selectAggregates("session_id, vote_count, average_rating")
        .in("session_id", sessionIds);
      const aggs = (aggsRaw ?? []) as unknown as AggregateRow[];

      const sessionToEntry: Record<string, string> = {};
      for (const s of sessions ?? []) sessionToEntry[s.id] = s.entry_id;
      // Combine multi-session entries by weighted average.
      const acc: Record<string, { sum: number; count: number }> = {};
      for (const a of aggs ?? []) {
        const eid = sessionToEntry[a.session_id as string];
        if (!eid) continue;
        const c = Number(a.vote_count ?? 0);
        const avg = a.average_rating != null ? Number(a.average_rating) : 0;
        if (!acc[eid]) acc[eid] = { sum: 0, count: 0 };
        acc[eid].sum += avg * c;
        acc[eid].count += c;
      }
      const t: Record<string, { count: number; average: number }> = {};
      for (const [eid, { sum, count }] of Object.entries(acc)) {
        if (count > 0) t[eid] = { count, average: sum / count };
      }
      if (active) setTotals(t);
    };
    load();
    const ch = supabase
      .channel(`audience-totals:${competitionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "screening_audience_votes" },
        () => load(),
      )
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(ch);
    };
  }, [competitionId]);

  return totals;
}
