import { Flame, PenLine, Target, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWritingStats } from "@/hooks/useWritingStats";

interface Props {
  userId: string | null | undefined;
}

export function WritingProgressCard({ userId }: Props) {
  const { today, series, goals, streak, loading } = useWritingStats(userId, 14);

  const wordsToday = today?.words_written ?? 0;
  const goal = goals.daily_word_goal || 0;
  const pct = goal > 0 ? Math.min(100, Math.round((wordsToday / goal) * 100)) : 0;
  const max = Math.max(1, ...series.map((s) => s.words_written));
  const totalWordsWindow = series.reduce((acc, s) => acc + s.words_written, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-display flex items-center gap-2">
          <PenLine className="h-4 w-4 text-primary" /> Writing Progress
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <Stat icon={<Target className="h-3.5 w-3.5" />} label="Today" value={`${wordsToday}`} sub={`/ ${goal} words`} />
              <Stat icon={<Flame className="h-3.5 w-3.5 text-orange-400" />} label="Streak" value={`${streak.current}d`} sub={`best ${streak.longest}d`} />
              <Stat icon={<Trophy className="h-3.5 w-3.5 text-yellow-400" />} label="14-day" value={`${totalWordsWindow}`} sub="words" />
            </div>

            {/* Daily ring */}
            <div className="flex items-center gap-3">
              <Ring pct={pct} />
              <div className="text-xs text-muted-foreground">
                {pct}% of daily goal
                {pct >= 100 && <span className="ml-2 text-emerald-400">Goal hit ✓</span>}
              </div>
            </div>

            {/* Sparkline */}
            <div>
              <div className="flex items-end gap-0.5 h-10">
                {series.map((s) => (
                  <div
                    key={s.day}
                    className="flex-1 bg-primary/30 hover:bg-primary/60 rounded-sm transition-colors"
                    style={{ height: `${Math.max(4, (s.words_written / max) * 100)}%` }}
                    title={`${s.day}: ${s.words_written} words`}
                  />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>{series[0]?.day.slice(5)}</span>
                <span>{series[series.length - 1]?.day.slice(5)}</span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-md border border-border/60 p-2.5">
      <div className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-0.5 font-medium text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 18, c = 2 * Math.PI * r;
  const dash = c * (pct / 100);
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" className="-rotate-90">
      <circle cx="24" cy="24" r={r} className="stroke-muted/40 fill-none" strokeWidth="5" />
      <circle
        cx="24" cy="24" r={r}
        className="stroke-primary fill-none transition-all"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`}
      />
    </svg>
  );
}
