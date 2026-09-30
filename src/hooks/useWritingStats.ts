import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface DailyStat {
  day: string; // YYYY-MM-DD
  words_written: number;
  active_minutes: number;
  sessions_count: number;
}

export interface WritingGoals {
  daily_word_goal: number;
  weekly_word_goal: number;
  streak_grace_days: number;
}

const DEFAULT_GOALS: WritingGoals = {
  daily_word_goal: 500,
  weekly_word_goal: 3000,
  streak_grace_days: 1,
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function lastNDates(n: number): string[] {
  const out: string[] = [];
  const base = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function computeStreaks(days: DailyStat[], graceDays: number): { current: number; longest: number } {
  const byDay = new Map(days.map((d) => [d.day, d.words_written]));
  const sorted = [...byDay.keys()].sort();
  if (sorted.length === 0) return { current: 0, longest: 0 };

  let longest = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const day of sorted) {
    const dt = new Date(day);
    if ((byDay.get(day) ?? 0) <= 0) continue;
    if (prev) {
      const gap = Math.round((dt.getTime() - prev.getTime()) / 86400000);
      if (gap <= 1 + graceDays) run += 1;
      else run = 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    prev = dt;
  }

  // Current streak: walk backwards from today.
  let current = 0;
  const today = new Date(todayISO());
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if ((byDay.get(key) ?? 0) > 0) current += 1;
    else if (i === 0) continue; // today not yet started counts as 0, not a break
    else break;
  }
  return { current, longest };
}

export function useWritingStats(userId: string | null | undefined, windowDays = 30) {
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState<DailyStat | null>(null);
  const [series, setSeries] = useState<DailyStat[]>([]);
  const [goals, setGoals] = useState<WritingGoals>(DEFAULT_GOALS);
  const [streak, setStreak] = useState<{ current: number; longest: number }>({ current: 0, longest: 0 });

  const refresh = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const since = new Date();
    since.setDate(since.getDate() - windowDays);
    const sinceISO = since.toISOString().slice(0, 10);
    const [{ data: rows }, { data: goalRow }] = await Promise.all([
      supabase
        .from("writing_daily_stats")
        .select("day, words_written, active_minutes, sessions_count")
        .eq("user_id", userId)
        .gte("day", sinceISO)
        .order("day", { ascending: true }),
      supabase
        .from("writing_goals")
        .select("daily_word_goal, weekly_word_goal, streak_grace_days")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    const stats = (rows ?? []) as DailyStat[];
    // Fill missing days with zeros for sparkline.
    const dayMap = new Map(stats.map((s) => [s.day, s]));
    const filled = lastNDates(windowDays).map(
      (d) => dayMap.get(d) ?? { day: d, words_written: 0, active_minutes: 0, sessions_count: 0 },
    );
    setSeries(filled);
    setToday(filled[filled.length - 1] ?? null);
    const g = (goalRow as WritingGoals | null) ?? DEFAULT_GOALS;
    setGoals(g);
    setStreak(computeStreaks(stats, g.streak_grace_days ?? 1));
    setLoading(false);
  }, [userId, windowDays]);

  useEffect(() => { void refresh(); }, [refresh]);

  const updateGoals = async (patch: Partial<WritingGoals>) => {
    if (!userId) return;
    const next = { ...goals, ...patch };
    setGoals(next);
    await supabase.from("writing_goals").upsert(
      { user_id: userId, ...next, updated_at: new Date().toISOString() } as never,
      { onConflict: "user_id" } as never,
    );
  };

  return { loading, today, series, goals, streak, refresh, updateGoals };
}
