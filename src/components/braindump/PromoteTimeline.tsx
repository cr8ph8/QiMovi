/**
 * PromoteTimeline
 *
 * Presentational timeline for the Brain Dump → Draft promotion. Shared
 * between the modal stepper (PromoteBriefDialog) and the always-visible
 * inline panel on the Brain Dump page.
 *
 * Optimistic UI:
 *  - Each step animates in on mount.
 *  - The running step shows an indeterminate shimmer bar so progress
 *    feels alive even between async events.
 *  - State changes cross-fade icons and pills via transition utilities.
 *  - A top-level progress bar reflects completed steps / total.
 */

import { useMemo } from "react";
import { CheckCircle2, Circle, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PROMOTE_STEPS,
  type PromoteStepId,
  type PromoteStepState,
} from "@/hooks/usePromoteBrief";

interface Props {
  states: Record<PromoteStepId, PromoteStepState>;
  compact?: boolean;
  /** Show the overall progress bar above the list. */
  showProgress?: boolean;
  /** When provided, each step becomes a button that opens its details drawer. */
  onSelectStep?: (id: PromoteStepId) => void;
  /** Highlight a step (e.g. one currently open in the details drawer). */
  selectedStep?: PromoteStepId | null;
  /** Optional badge counts shown after the step state pill (e.g. log count). */
  badgeCounts?: Partial<Record<PromoteStepId, number>>;
}

const STATE_RING: Record<PromoteStepState, string> = {
  pending: "border-border/40 bg-background/40 opacity-70",
  running: "border-primary/50 bg-primary/[0.06] ring-1 ring-primary/40 shadow-[0_0_0_3px_hsl(var(--primary)/0.08)]",
  done: "border-emerald-500/40 bg-emerald-500/[0.06]",
  error: "border-destructive/50 bg-destructive/[0.08]",
};

const STATE_PILL: Record<PromoteStepState, string> = {
  pending: "text-muted-foreground/70",
  running: "text-primary",
  done: "text-emerald-400",
  error: "text-destructive",
};

function StepIcon({ state }: { state: PromoteStepState }) {
  // Single root so we can cross-fade via key change.
  return (
    <span
      key={state}
      className="inline-flex items-center justify-center animate-fade-in"
      aria-hidden="true"
    >
      {state === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
      {state === "running" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
      {state === "error" && <AlertCircle className="h-4 w-4 text-destructive" />}
      {state === "pending" && <Circle className="h-4 w-4 text-muted-foreground/60" />}
    </span>
  );
}

export function PromoteTimeline({ states, compact = false, showProgress = true, onSelectStep, selectedStep, badgeCounts }: Props) {
  const { doneCount, totalCount, percent, anyError } = useMemo(() => {
    const total = PROMOTE_STEPS.length;
    const done = PROMOTE_STEPS.filter((s) => states[s.id] === "done").length;
    const running = PROMOTE_STEPS.some((s) => states[s.id] === "running");
    // Optimistic bump while a step is running so the bar always feels in motion.
    const optimistic = running ? 0.5 : 0;
    const pct = Math.min(100, Math.round(((done + optimistic) / total) * 100));
    return {
      doneCount: done,
      totalCount: total,
      percent: pct,
      anyError: PROMOTE_STEPS.some((s) => states[s.id] === "error"),
    };
  }, [states]);

  return (
    <div className="space-y-3">
      {showProgress && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            <span>Progress</span>
            <span>
              {doneCount}/{totalCount} · {percent}%
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1.5 w-full overflow-hidden rounded-full bg-border/40"
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500 ease-out",
                anyError
                  ? "bg-gradient-to-r from-destructive to-destructive/70"
                  : "bg-gradient-to-r from-primary via-primary to-primary/80",
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      <ol className={cn("space-y-2", compact && "space-y-1.5")}>
        {PROMOTE_STEPS.map((step, idx) => {
          const state = states[step.id];
          const isRunning = state === "running";
          const isSelected = selectedStep === step.id;
          const clickable = !!onSelectStep;
          const badge = badgeCounts?.[step.id];
          const content = (
            <>
              {/* Indeterminate shimmer for the active step. */}
              {isRunning && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden"
                >
                  <span className="block h-full w-1/3 animate-[slide-in-right_1.2s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-primary to-transparent" />
                </span>
              )}

              <div className="mt-0.5 shrink-0 transition-transform duration-200 group-aria-[current=step]:scale-110">
                <StepIcon state={state} />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      "text-sm font-medium truncate transition-colors duration-200",
                      state === "pending" ? "text-foreground/80" : "text-foreground",
                    )}
                  >
                    {idx + 1}. {step.label}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {typeof badge === "number" && badge > 0 && (
                      <span className="rounded-full bg-muted/70 px-1.5 py-0 text-[10px] font-mono text-muted-foreground tabular-nums">
                        {badge}
                      </span>
                    )}
                    <span
                      className={cn(
                        "text-[10px] font-mono uppercase tracking-wider transition-colors duration-200",
                        STATE_PILL[state],
                      )}
                    >
                      {state}
                    </span>
                  </span>
                </div>
                {!compact && (
                  <p className="text-xs text-muted-foreground mt-0.5">{step.hint}</p>
                )}
              </div>
            </>
          );

          const baseClasses = cn(
            "group relative flex w-full items-start gap-3 overflow-hidden rounded-md border px-3 py-2",
            "transition-all duration-300 ease-out",
            STATE_RING[state],
            compact && "py-1.5",
            isSelected && "ring-2 ring-primary/60 ring-offset-1 ring-offset-background",
            clickable && "cursor-pointer hover:border-primary/40 hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
          );

          return (
            <li
              key={step.id}
              aria-current={isRunning ? "step" : undefined}
              style={{ animationDelay: `${idx * 40}ms` }}
            >
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onSelectStep?.(step.id)}
                  className={baseClasses}
                  aria-label={`Open details for step ${idx + 1}: ${step.label}`}
                >
                  {content}
                </button>
              ) : (
                <div className={baseClasses}>{content}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
