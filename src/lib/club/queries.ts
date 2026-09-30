// Supabase queries + mutations for Script Club / Reader systems.
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PAID_AI_SECURITY_HOLD, PAID_AI_SECURITY_MESSAGE } from "@/lib/securityMaintenance";

export type CycleTier = "weekly" | "monthly";
export type CycleStatus = "upcoming" | "active" | "closed" | "archived";

export interface ReadingCycle {
  id: string;
  chapter_id: string | null;
  entry_id: string | null;
  tier: CycleTier;
  status: CycleStatus;
  screenplay_title: string;
  screenplay_author: string | null;
  screenplay_genre: string | null;
  total_pages: number;
  start_date: string;
  end_date: string;
}

export interface CycleMembership {
  cycle_id: string;
  user_id: string;
  progress_pct: number;
  pages_read: number;
  read_minutes: number;
  page_time_map: Record<string, number>;
  completed_at: string | null;
}

export interface ReaderChapter {
  id: string;
  name: string;
  description: string | null;
  color: string;
  is_public: boolean;
  creator_id: string;
  member_count: number;
  token_config: {
    weeklyCost: number;
    monthlyCost: number;
    reviewReward: number;
    charityFee: number;
  };
}

export interface ClubReview {
  id: string;
  cycle_id: string;
  user_id: string;
  ratings: Record<string, number>;
  what_worked: string;
  what_didnt: string;
  one_improvement: string;
  ai_verdict: "approve" | "review" | "reject" | null;
  ai_flags: Array<{ type: string; severity: string; detail: string }>;
  ai_rationale: string | null;
  reward_tokens: number;
  status: "submitted" | "approved" | "disputed" | "rejected" | "withdrawn";
  created_at: string;
}

export interface ReadingHistoryRow {
  id: string;
  user_id: string;
  entry_id: string | null;
  cycle_id: string | null;
  status: "in_progress" | "finished" | "abandoned";
  pages_read: number;
  read_minutes: number;
  genre: string | null;
  started_at: string;
  finished_at: string | null;
}

export function useActiveCycles() {
  const [cycles, setCycles] = useState<ReadingCycle[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("reading_cycles" as any)
      .select("*")
      .eq("status", "active")
      .order("end_date", { ascending: true });
    if (!error && data) setCycles(data as unknown as ReadingCycle[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  return { cycles, loading, reload: load };
}

export function useChapters() {
  const [chapters, setChapters] = useState<ReaderChapter[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("reader_chapters" as any)
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) setChapters(data as unknown as ReaderChapter[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  return { chapters, loading, reload: load };
}

export function useMyCycleMembership(cycleId: string | null) {
  const { user } = useAuth();
  const [membership, setMembership] = useState<CycleMembership | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!cycleId || !user) { setMembership(null); return; }
    setLoading(true);
    const { data } = await supabase
      .from("reading_cycle_memberships" as any)
      .select("*")
      .eq("cycle_id", cycleId)
      .eq("user_id", user.id)
      .maybeSingle();
    setMembership((data as unknown as CycleMembership) ?? null);
    setLoading(false);
  }, [cycleId, user]);

  useEffect(() => { load(); }, [load]);

  const upsertProgress = useCallback(
    async (patch: Partial<Omit<CycleMembership, "cycle_id" | "user_id">>) => {
      if (!cycleId || !user) return;
      const row = {
        cycle_id: cycleId,
        user_id: user.id,
        progress_pct: patch.progress_pct ?? membership?.progress_pct ?? 0,
        pages_read: patch.pages_read ?? membership?.pages_read ?? 0,
        read_minutes: patch.read_minutes ?? membership?.read_minutes ?? 0,
        page_time_map: patch.page_time_map ?? membership?.page_time_map ?? {},
        completed_at:
          patch.completed_at ??
          ((patch.progress_pct ?? 0) >= 100 ? new Date().toISOString() : membership?.completed_at ?? null),
      };
      await supabase.from("reading_cycle_memberships" as any).upsert(row, {
        onConflict: "cycle_id,user_id",
      });
      await load();
    },
    [cycleId, user, membership, load]
  );

  return { membership, loading, upsertProgress, reload: load };
}

export interface SubmitReviewInput {
  cycleId: string;
  ratings: Record<string, number>;
  whatWorked: string;
  whatDidnt: string;
  oneImprovement: string;
}

export async function submitReview(
  input: SubmitReviewInput,
  rewardTokens: number
): Promise<{ ok: true; review: ClubReview } | { ok: false; error: string }> {
  if (PAID_AI_SECURITY_HOLD) {
    return { ok: false, error: PAID_AI_SECURITY_MESSAGE };
  }
  // First call AI screener
  const { data: ai, error: aiErr } = await supabase.functions.invoke("validate-review-ai", {
    body: {
      whatWorked: input.whatWorked,
      whatDidnt: input.whatDidnt,
      oneImprovement: input.oneImprovement,
      ratings: input.ratings,
    },
  });
  if (aiErr) return { ok: false, error: aiErr.message };

  const verdict: "approve" | "reject" = ai?.verdict === "reject" ? "reject" : "approve";
  const flags = Array.isArray(ai?.flags) ? ai.flags : [];
  const rationale: string | null = ai?.rationale ?? null;

  if (verdict === "reject") {
    return {
      ok: false,
      error:
        flags.length > 0
          ? flags.map((f: any) => `${(f.type || "issue").replace("_", " ")}: ${f.detail}`).join(" • ")
          : rationale || "Review rejected by AI screening.",
    };
  }

  const { data, error } = await supabase
    .from("club_reviews" as any)
    .insert({
      cycle_id: input.cycleId,
      user_id: (await supabase.auth.getUser()).data.user?.id,
      ratings: input.ratings,
      what_worked: input.whatWorked,
      what_didnt: input.whatDidnt,
      one_improvement: input.oneImprovement,
      ai_verdict: "approve",
      ai_flags: flags,
      ai_rationale: rationale,
      reward_tokens: rewardTokens,
      status: "approved",
    })
    .select("*")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, review: data as unknown as ClubReview };
}

export function useMyReadingHistory(limit = 50) {
  const { user } = useAuth();
  const [rows, setRows] = useState<ReadingHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setRows([]); setLoading(false); return; }
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("reading_history" as any)
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(limit);
      setRows((data as unknown as ReadingHistoryRow[]) ?? []);
      setLoading(false);
    })();
  }, [user, limit]);

  return { rows, loading };
}

export async function joinChapter(chapterId: string) {
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) return { ok: false, error: "Sign in required" };
  const { error } = await supabase
    .from("reader_chapter_members" as any)
    .insert({ chapter_id: chapterId, user_id: userRes.user.id });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function createChapter(input: {
  name: string;
  description: string;
  color: string;
  isPublic: boolean;
}) {
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) return { ok: false, error: "Sign in required" };
  const { data, error } = await supabase
    .from("reader_chapters" as any)
    .insert({
      name: input.name,
      description: input.description,
      color: input.color,
      is_public: input.isPublic,
      creator_id: userRes.user.id,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, chapter: data as unknown as ReaderChapter };
}
