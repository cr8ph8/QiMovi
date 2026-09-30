// Reading speed analyzer — ported from ScriptScout donor, restyled to Cinema Aurea.
// Note: peer comparison uses static club benchmarks (not user data) — same as donor.
import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from "recharts";
import { Gauge, Clock, BookOpen, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface Props {
  pagesRead: number;
  totalPages: number;
  readTimeMinutes: number;
  pageTimeMap?: Record<number, number>;
}

const PEER_STATS = [
  { name: "DraftHunter", wpm: 228 },
  { name: "InkWell", wpm: 195 },
  { name: "ScreenSage", wpm: 212 },
  { name: "CutToBlack", wpm: 187 },
  { name: "PageTurner", wpm: 241 },
  { name: "ReelTalk", wpm: 163 },
  { name: "ScriptNova", wpm: 178 },
];

const WORDS_PER_PAGE = 250;

export function ReadingAnalyzer({ pagesRead, totalPages, readTimeMinutes, pageTimeMap = {} }: Props) {
  const stats = useMemo(() => {
    const totalSeconds = readTimeMinutes * 60;
    const totalWords = pagesRead * WORDS_PER_PAGE;
    const wpm = totalSeconds > 0 ? Math.round(totalWords / (totalSeconds / 60)) : 0;
    const avgSecPerPage = pagesRead > 0 ? Math.round(totalSeconds / pagesRead) : 0;

    const pageData = Array.from({ length: Math.min(pagesRead, 30) }, (_, i) => ({
      page: i + 1,
      seconds: Math.round(pageTimeMap[i] ?? avgSecPerPage),
    }));

    const allWpms = [...PEER_STATS.map((p) => p.wpm), wpm].sort((a, b) => b - a);
    const rank = allWpms.indexOf(wpm) + 1;
    const peerAvgWpm = Math.round(PEER_STATS.reduce((s, p) => s + p.wpm, 0) / PEER_STATS.length);
    const wpmDiff = wpm - peerAvgWpm;
    const percentile = Math.round(((allWpms.length - rank) / (allWpms.length - 1)) * 100);

    const sorted = [...pageData].sort((a, b) => a.seconds - b.seconds);
    return {
      wpm, avgSecPerPage, pageData, peerAvgWpm, wpmDiff, percentile, totalWords,
      fastest: sorted[0], slowest: sorted[sorted.length - 1],
    };
  }, [pagesRead, readTimeMinutes, pageTimeMap]);

  const peerChartData = useMemo(
    () =>
      [
        ...PEER_STATS.map((p) => ({ name: p.name, wpm: p.wpm, isYou: false })),
        { name: "You", wpm: stats.wpm, isYou: true },
      ].sort((a, b) => b.wpm - a.wpm),
    [stats.wpm]
  );

  if (pagesRead === 0 || readTimeMinutes === 0) return null;

  return (
    <div className="mt-8 space-y-6">
      <h2 className="font-semibold text-lg flex items-center gap-2">
        <Gauge className="h-4 w-4 text-primary" /> Reading Speed Analysis
      </h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={String(stats.wpm)} label="Words / Min" />
        <Stat value={`${stats.avgSecPerPage}s`} label="Avg / Page" />
        <Stat value={stats.totalWords.toLocaleString()} label="Words Read" />
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-1.5">
            <p className="text-2xl font-bold tabular-nums">
              {stats.percentile}
              <span className="text-sm font-normal text-muted-foreground">th</span>
            </p>
            {stats.wpmDiff > 0 ? (
              <TrendingUp className="h-4 w-4 text-emerald-400" />
            ) : stats.wpmDiff < 0 ? (
              <TrendingDown className="h-4 w-4 text-destructive" />
            ) : (
              <Minus className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">Percentile</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" /> Time Per Page
            </h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Seconds spent on each page — spikes indicate dense scenes
            </p>
          </div>
          {stats.fastest && stats.slowest && (
            <div className="flex gap-4 text-[10px]">
              <span className="text-emerald-400">
                Fastest: p.{stats.fastest.page} ({stats.fastest.seconds}s)
              </span>
              <span className="text-destructive">
                Slowest: p.{stats.slowest.page} ({stats.slowest.seconds}s)
              </span>
            </div>
          )}
        </div>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.pageData} barSize={stats.pageData.length > 20 ? 6 : 12}>
              <XAxis dataKey="page" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} interval={stats.pageData.length > 15 ? 2 : 0} />
              <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={28} tickFormatter={(v) => `${v}s`} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} formatter={(v: number) => [`${v}s`, "Time"]} labelFormatter={(l) => `Page ${l}`} />
              <ReferenceLine y={stats.avgSecPerPage} stroke="hsl(var(--primary))" strokeDasharray="4 4" />
              <Bar dataKey="seconds" radius={[3, 3, 0, 0]} fill="hsl(var(--primary))" fillOpacity={0.7} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5 text-muted-foreground" /> Club Pace Comparison
          </h3>
          <p className={`text-xs font-medium tabular-nums ${stats.wpmDiff > 0 ? "text-emerald-400" : stats.wpmDiff < 0 ? "text-destructive" : "text-muted-foreground"}`}>
            {stats.wpmDiff > 0 ? "+" : ""}{stats.wpmDiff} wpm vs avg
          </p>
        </div>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={peerChartData} layout="vertical" barSize={14}>
              <XAxis type="number" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={80} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} formatter={(v: number) => [`${v} wpm`, "Speed"]} />
              <ReferenceLine x={stats.peerAvgWpm} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
              <Bar dataKey="wpm" radius={[0, 4, 4, 0]}>
                {peerChartData.map((entry, i) => (
                  <Cell key={i} fill={entry.isYou ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"} fillOpacity={entry.isYou ? 0.85 : 0.25} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  );
}
