/**
 * DevelopmentTrajectoryPanel — descriptive insight into how projects evolve
 * structurally over time. Computes revision trajectory signals and development
 * rhythm indicators from canonical draft history. No predictive models.
 */
import { useMemo } from "react";
import { parseFountain } from "@/lib/fountain-parser";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  TrendingUp, Activity, Layers, Calendar, BarChart3, Info,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip,
  CartesianGrid, AreaChart, Area,
} from "recharts";

/* ── types ── */
interface DraftInput {
  draft_number: number;
  script_text: string;
  created_at?: string;
}

interface DevelopmentTrajectoryPanelProps {
  drafts: DraftInput[];
  compact?: boolean;
}

/* ── helpers ── */
interface DraftSnapshot {
  draft_number: number;
  created_at?: string;
  sceneCount: number;
  wordCount: number;
  pageCount: number;
  dialogueBlocks: number;
  actionLines: number;
  charCount: number;
  dialogueDensity: number; // dialogue / (dialogue + action)
}

function classifyPeriod(changeRatio: number): { label: string; color: string } {
  if (changeRatio < 0.05) return { label: "Stabilization", color: "text-emerald-400" };
  if (changeRatio < 0.20) return { label: "Refinement", color: "text-amber-400" };
  return { label: "Exploration", color: "text-primary" };
}

function trendLabel(values: number[]): string {
  if (values.length < 2) return "—";
  const first = values[0];
  const last = values[values.length - 1];
  const delta = last - first;
  const pctChange = first > 0 ? Math.abs(delta / first) * 100 : 0;
  if (pctChange < 5) return "Stable";
  return delta > 0 ? "Expanding" : "Contracting";
}

function trendColor(values: number[]): string {
  if (values.length < 2) return "text-muted-foreground";
  const first = values[0];
  const last = values[values.length - 1];
  const delta = last - first;
  const pctChange = first > 0 ? Math.abs(delta / first) * 100 : 0;
  if (pctChange < 5) return "text-emerald-400";
  return delta > 0 ? "text-primary" : "text-amber-400";
}

/* ── main ── */
export default function DevelopmentTrajectoryPanel({ drafts, compact }: DevelopmentTrajectoryPanelProps) {
  const sorted = useMemo(
    () => [...drafts].sort((a, b) => a.draft_number - b.draft_number),
    [drafts],
  );

  const snapshots: DraftSnapshot[] = useMemo(() => {
    return sorted.map((d) => {
      const p = parseFountain(d.script_text || "");
      const total = p.stats.dialogueBlockCount + p.stats.actionLineCount;
      return {
        draft_number: d.draft_number,
        created_at: d.created_at,
        sceneCount: p.stats.sceneCount,
        wordCount: p.stats.wordCount,
        pageCount: p.stats.pageCount,
        dialogueBlocks: p.stats.dialogueBlockCount,
        actionLines: p.stats.actionLineCount,
        charCount: p.stats.uniqueCharacters.length,
        dialogueDensity: total > 0 ? p.stats.dialogueBlockCount / total : 0,
      };
    });
  }, [sorted]);

  // Rhythm: classify each transition
  const transitions = useMemo(() => {
    if (snapshots.length < 2) return [];
    return snapshots.slice(1).map((curr, i) => {
      const prev = snapshots[i];
      const sceneDelta = Math.abs(curr.sceneCount - prev.sceneCount);
      const wordDelta = Math.abs(curr.wordCount - prev.wordCount);
      const maxWords = Math.max(prev.wordCount, 1);
      const changeRatio = (sceneDelta * 50 + wordDelta) / (maxWords + 50);
      const period = classifyPeriod(changeRatio);

      // Time between drafts
      let daysBetween: number | null = null;
      if (curr.created_at && prev.created_at) {
        daysBetween = Math.round(
          (new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime()) / 86400000,
        );
      }

      return {
        from: prev.draft_number,
        to: curr.draft_number,
        sceneDelta: curr.sceneCount - prev.sceneCount,
        wordDelta: curr.wordCount - prev.wordCount,
        charDelta: curr.charCount - prev.charCount,
        changeRatio,
        period,
        daysBetween,
      };
    });
  }, [snapshots]);

  if (snapshots.length < 2) {
    return (
      <div className="p-6 text-center">
        <TrendingUp className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">At least two drafts are needed to show development trajectory.</p>
      </div>
    );
  }

  // Chart data
  const chartData = snapshots.map((s) => ({
    name: `v${s.draft_number}`,
    scenes: s.sceneCount,
    words: s.wordCount,
    dialogue: Math.round(s.dialogueDensity * 100),
    characters: s.charCount,
  }));

  const sceneTrend = trendLabel(snapshots.map((s) => s.sceneCount));
  const wordTrend = trendLabel(snapshots.map((s) => s.wordCount));
  const dialogueTrend = trendLabel(snapshots.map((s) => s.dialogueDensity));

  /* ── compact mode ── */
  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={cn("text-[9px] font-mono", trendColor(snapshots.map((s) => s.sceneCount)))}>
            Scenes: {sceneTrend}
          </Badge>
          <Badge variant="outline" className={cn("text-[9px] font-mono", trendColor(snapshots.map((s) => s.wordCount)))}>
            Words: {wordTrend}
          </Badge>
          <Badge variant="outline" className={cn("text-[9px] font-mono", trendColor(snapshots.map((s) => s.dialogueDensity)))}>
            Dialogue: {dialogueTrend}
          </Badge>
        </div>
        <div className="flex gap-1 flex-wrap">
          {transitions.map((t) => (
            <Badge key={t.to} variant="outline" className={cn("text-[8px] font-mono", t.period.color)}>
              v{t.from}→v{t.to}: {t.period.label}
            </Badge>
          ))}
        </div>
      </div>
    );
  }

  /* ── full mode ── */
  return (
    <div className="space-y-4">
      {/* Trajectory overview */}
      <div className="flex items-center gap-2 mb-1">
        <TrendingUp className="h-4 w-4 text-primary" />
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Revision Trajectory</span>
        <Badge variant="outline" className="text-[8px] font-mono ml-auto">{snapshots.length} drafts</Badge>
      </div>

      {/* Trend summary */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Scene Count", trend: sceneTrend, color: trendColor(snapshots.map((s) => s.sceneCount)), hint: "How scene count evolves across drafts." },
          { label: "Word Volume", trend: wordTrend, color: trendColor(snapshots.map((s) => s.wordCount)), hint: "Overall word count trajectory." },
          { label: "Dialogue Density", trend: dialogueTrend, color: trendColor(snapshots.map((s) => s.dialogueDensity)), hint: "Proportion of dialogue vs action over time." },
        ].map((t) => (
          <div key={t.label} className="rounded-lg border border-border/30 bg-card/60 p-3 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <span className="text-[9px] font-mono text-muted-foreground uppercase">{t.label}</span>
              <Tooltip>
                <TooltipTrigger asChild><Info className="h-2.5 w-2.5 text-muted-foreground/40 cursor-help" /></TooltipTrigger>
                <TooltipContent side="top" className="max-w-[200px] text-xs">{t.hint}</TooltipContent>
              </Tooltip>
            </div>
            <span className={cn("text-sm font-mono font-bold", t.color)}>{t.trend}</span>
          </div>
        ))}
      </div>

      {/* Structural evolution chart */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Structural Evolution</span>
        </div>
        <div className="h-[140px] w-full rounded-lg border border-border/30 bg-card/50 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" />
              <XAxis dataKey="name" tick={{ fontSize: 8, fontFamily: "monospace" }} />
              <YAxis tick={{ fontSize: 8, fontFamily: "monospace" }} />
              <RechartsTooltip contentStyle={{ fontSize: 10, fontFamily: "monospace", background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              <Line type="monotone" dataKey="scenes" name="Scenes" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="characters" name="Characters" stroke="hsl(var(--accent-foreground))" strokeWidth={1.5} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Dialogue density area chart */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Dialogue Density Trend</span>
        </div>
        <div className="h-[100px] w-full rounded-lg border border-border/30 bg-card/50 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="dialogueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" />
              <XAxis dataKey="name" tick={{ fontSize: 8, fontFamily: "monospace" }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 8, fontFamily: "monospace" }} tickFormatter={(v) => `${v}%`} />
              <RechartsTooltip contentStyle={{ fontSize: 10, fontFamily: "monospace", background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} formatter={(v: number) => `${v}%`} />
              <Area type="monotone" dataKey="dialogue" name="Dialogue %" stroke="hsl(var(--primary))" fill="url(#dialogueGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Development rhythm timeline */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="h-4 w-4 text-primary" />
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Development Rhythm</span>
        </div>
        <div className="space-y-1.5">
          {transitions.map((t) => (
            <div key={t.to} className="flex items-center gap-2 rounded-lg border border-border/30 bg-card/60 px-3 py-2">
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] font-mono text-muted-foreground">v{t.from}</span>
                <span className="text-[8px] text-muted-foreground">→</span>
                <span className="text-[10px] font-mono text-foreground">v{t.to}</span>
              </div>
              <Badge variant="outline" className={cn("text-[8px] font-mono", t.period.color)}>
                {t.period.label}
              </Badge>
              <div className="flex-1" />
              <div className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground">
                <span className={t.sceneDelta > 0 ? "text-emerald-400" : t.sceneDelta < 0 ? "text-destructive" : ""}>
                  {t.sceneDelta > 0 ? "+" : ""}{t.sceneDelta}sc
                </span>
                <span className={t.wordDelta > 0 ? "text-emerald-400" : t.wordDelta < 0 ? "text-destructive" : ""}>
                  {t.wordDelta > 0 ? "+" : ""}{t.wordDelta}w
                </span>
                {t.daysBetween !== null && (
                  <span>{t.daysBetween}d</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
