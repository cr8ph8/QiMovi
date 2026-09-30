import { useEffect, useState } from "react";
import { Flame, Target, Timer } from "lucide-react";
import { useWritingStats } from "@/hooks/useWritingStats";
import { computeCompletionPct, countWords, targetPagesFor } from "@/lib/writingProgress";
import { GoalsSheet } from "@/components/writer/GoalsSheet";
import { cn } from "@/lib/utils";

interface Props {
  userId: string | null | undefined;
  draftId: string | null;
  fountainText: string;
  format: string | null;
  targetPageCount: number | null;
  onTargetChange: (n: number | null) => void;
  pageCount: number;
  refreshKey?: number;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ProgressStrip({
  userId,
  draftId,
  fountainText,
  format,
  targetPageCount,
  onTargetChange,
  pageCount,
  refreshKey = 0,
}: Props) {
  const { today, goals, streak, refresh, updateGoals } = useWritingStats(userId, 30);
  const [sessionStart] = useState<Date>(new Date());
  const [sessionDuration, setSessionDuration] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setSessionDuration(Math.round((Date.now() - sessionStart.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [sessionStart]);

  useEffect(() => { void refresh(); }, [refreshKey, refresh]);

  const totalWords = countWords(fountainText);
  const wordsToday = today?.words_written ?? 0;
  const dailyGoal = goals.daily_word_goal || 0;
  const dailyPct = dailyGoal > 0 ? Math.min(100, Math.round((wordsToday / dailyGoal) * 100)) : 0;

  const target = targetPagesFor(format, targetPageCount);
  const completionPct = computeCompletionPct(pageCount, target);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <Metric label="Today" value={`${wordsToday}`} sub={`/ ${dailyGoal} words`} pct={dailyPct} accent="primary" />
      <Metric
        label="Script"
        value={`${completionPct}%`}
        sub={`${pageCount}/${target} pp · ${totalWords} words`}
        pct={completionPct}
        accent="emerald"
      />
      <div className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Timer className="h-3.5 w-3.5" />
        <span className="tabular-nums">{formatDuration(sessionDuration)}</span>
        <span className="opacity-60">session</span>
      </div>
      <div className={cn("inline-flex items-center gap-1.5", streak.current > 0 ? "text-orange-400" : "text-muted-foreground")}>
        <Flame className="h-3.5 w-3.5" />
        <span className="tabular-nums">{streak.current}d</span>
        <span className="opacity-60">streak</span>
      </div>
      <GoalsSheet
        userId={userId}
        draftId={draftId}
        dailyGoal={dailyGoal}
        targetPages={targetPageCount}
        onUpdated={({ dailyGoal: dg, targetPages: tp }) => {
          if (typeof dg === "number") void updateGoals({ daily_word_goal: dg });
          if (tp !== undefined) onTargetChange(tp);
        }}
      />
    </div>
  );
}

function Metric({
  label, value, sub, pct, accent,
}: { label: string; value: string; sub: string; pct: number; accent: "primary" | "emerald" }) {
  const ring = accent === "primary" ? "stroke-primary" : "stroke-emerald-400";
  const r = 10, c = 2 * Math.PI * r;
  const dash = c * (pct / 100);
  return (
    <div className="inline-flex items-center gap-2">
      <svg width="28" height="28" viewBox="0 0 28 28" className="-rotate-90">
        <circle cx="14" cy="14" r={r} className="stroke-muted/40 fill-none" strokeWidth="3" />
        <circle
          cx="14" cy="14" r={r}
          className={cn("fill-none transition-all", ring)}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
        />
      </svg>
      <div className="leading-tight">
        <div className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Target className="h-3 w-3" /> {label}
        </div>
        <div className="text-foreground font-medium">
          {value} <span className="text-muted-foreground font-normal">{sub}</span>
        </div>
      </div>
    </div>
  );
}
