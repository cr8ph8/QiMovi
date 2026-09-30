import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { QiSecScores } from "@/lib/reader/types";

const metrics: { key: keyof QiSecScores; label: string; tip: string; color: string }[] = [
  { key: "truthScore", label: "Truth", tip: "Canonical status + approval level", color: "bg-emerald-500" },
  { key: "authorityLevel", label: "Authority", tip: "Draft → Locked progression", color: "bg-primary" },
  { key: "changeRisk", label: "Risk", tip: "Dependencies & version churn", color: "bg-amber-500" },
  { key: "accessScore", label: "Access", tip: "Sensitivity & permission scope", color: "bg-destructive" },
];

interface Props {
  scores: QiSecScores;
  compact?: boolean;
}

export function QiSecScoreBar({ scores, compact }: Props) {
  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-1.5">
        {!compact && (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium block">
            QiSEC Scores
          </span>
        )}
        {metrics.map((m) => {
          const pct = Math.round(scores[m.key] * 100);
          return (
            <Tooltip key={m.key}>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2">
                  <span className={cn("text-[9px] font-mono text-muted-foreground w-12 shrink-0", compact && "w-8")}>
                    {compact ? m.label.slice(0, 3) : m.label}
                  </span>
                  <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all duration-500", m.color)} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[9px] font-mono text-muted-foreground tabular-nums w-7 text-right">{pct}%</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <p className="font-medium">{m.label}: {pct}%</p>
                <p className="text-muted-foreground">{m.tip}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
