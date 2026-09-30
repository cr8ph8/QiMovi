import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CircleCheck, CircleDot, CircleDashed, CheckCircle2 } from "lucide-react";

export interface ProgressStep {
  label: string;
  done: boolean;
}

interface JudgingProgressTrackerProps {
  steps: ProgressStep[];
  compact?: boolean;
  className?: string;
}

export default function JudgingProgressTracker({ steps, compact, className }: JudgingProgressTrackerProps) {
  const completedCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const allDone = completedCount === total && total > 0;

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <div className="flex items-center gap-1">
          {steps.map((step, i) => (
            <div
              key={i}
              className={cn(
                "h-1.5 w-4 rounded-full transition-colors",
                step.done ? "bg-emerald-500" : "bg-muted-foreground/20"
              )}
              title={step.label}
            />
          ))}
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">
          {completedCount}/{total}
        </span>
        {allDone && (
          <Badge variant="outline" className="text-[10px] font-mono border-emerald-500/40 text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Complete
          </Badge>
        )}
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Judging checklist
        </span>
        <span className="text-[10px] font-mono text-muted-foreground">
          {completedCount}/{total}
        </span>
      </div>
      <div className="space-y-1.5">
        {steps.map((step, i) => (
          <div
            key={i}
            className={cn(
              "flex items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors",
              step.done
                ? "border-emerald-500/20 bg-emerald-500/5"
                : "border-border/20 bg-background/40"
            )}
          >
            {step.done ? (
              <CircleCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            ) : (
              <CircleDashed className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
            )}
            <span
              className={cn(
                "text-[11px] leading-snug",
                step.done ? "text-emerald-300 font-medium" : "text-muted-foreground"
              )}
            >
              {step.label}
            </span>
          </div>
        ))}
      </div>
      {allDone && (
        <div className="mt-2 flex items-center gap-1.5 text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span className="text-[11px] font-medium">All steps complete — ready to submit</span>
        </div>
      )}
    </div>
  );
}
