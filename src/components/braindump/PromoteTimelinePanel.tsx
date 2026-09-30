/**
 * PromoteTimelinePanel
 *
 * Always-visible inline progress card shown on the Brain Dump page once
 * a promotion run has been started. Live-ticks elapsed time, animates
 * headline transitions, and mirrors the modal stepper.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, RotateCcw, Sparkles, X, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PromoteTimeline } from "@/components/braindump/PromoteTimeline";
import { PromoteStepDetailsDrawer } from "@/components/braindump/PromoteStepDetailsDrawer";
import { cn } from "@/lib/utils";
import type { usePromoteBrief, PromoteStepId } from "@/hooks/usePromoteBrief";

type Controller = ReturnType<typeof usePromoteBrief>;

interface Props {
  controller: Controller;
  onReopen?: () => void;
}

export function PromoteTimelinePanel({ controller, onReopen }: Props) {
  const navigate = useNavigate();
  const {
    states,
    errorMessage,
    running,
    resultDraftId,
    allDone,
    startedAt,
    finishedAt,
    reset,
    logs,
  } = controller;

  const [openStep, setOpenStep] = useState<PromoteStepId | null>(null);

  const logCounts = useMemo(() => {
    const out: Partial<Record<PromoteStepId, number>> = {};
    (Object.keys(logs) as PromoteStepId[]).forEach((k) => { out[k] = logs[k].length; });
    return out;
  }, [logs]);

  // Live-tick elapsed time while running, so the timer feels real.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [running]);

  const elapsedMs = startedAt
    ? (finishedAt?.getTime() ?? (running ? now : startedAt.getTime())) - startedAt.getTime()
    : 0;

  const phase: "running" | "error" | "done" | "idle" = running
    ? "running"
    : errorMessage
    ? "error"
    : allDone
    ? "done"
    : "idle";

  const headline =
    phase === "running"
      ? "Promoting brief to draft…"
      : phase === "error"
      ? "Promotion failed"
      : phase === "done"
      ? "Draft ready"
      : "Promotion timeline";

  return (
    <Card
      className={cn(
        "animate-fade-in border transition-colors duration-300",
        phase === "running" && "border-primary/40 bg-primary/[0.04]",
        phase === "done" && "border-emerald-500/40 bg-emerald-500/[0.04]",
        phase === "error" && "border-destructive/40 bg-destructive/[0.04]",
        phase === "idle" && "border-primary/20 bg-primary/[0.02]",
      )}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-base font-display">
          <span
            key={phase}
            className="flex items-center gap-2 animate-fade-in"
          >
            {phase === "running" && <Sparkles className="h-4 w-4 text-primary animate-pulse" />}
            {phase === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
            {phase === "error" && <AlertCircle className="h-4 w-4 text-destructive" />}
            {phase === "idle" && <Sparkles className="h-4 w-4 text-primary" />}
            {headline}
          </span>
          <span className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            {elapsedMs > 0 && (
              <span
                className={cn(
                  "tabular-nums transition-colors",
                  running && "text-primary",
                )}
                aria-live="polite"
              >
                {(elapsedMs / 1000).toFixed(1)}s
              </span>
            )}
            {!running && (
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={reset}
                title="Dismiss timeline"
                aria-label="Dismiss promotion timeline"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <PromoteTimeline
          states={states}
          compact
          onSelectStep={setOpenStep}
          selectedStep={openStep}
          badgeCounts={logCounts}
        />
        <p className="text-[10px] text-muted-foreground/80 -mt-1">
          Tap a step to inspect live logs, generated artifacts, and any errors.
        </p>

        {errorMessage && (
          <div className="animate-fade-in rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {errorMessage}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {resultDraftId && (
            <Button
              size="sm"
              variant="default"
              className="animate-scale-in"
              onClick={() => navigate(`/entry/${resultDraftId}#write`)}
            >
              Open draft <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          )}
          {errorMessage && onReopen && (
            <Button size="sm" variant="outline" onClick={onReopen}>
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Retry
            </Button>
          )}
          {!running && onReopen && !errorMessage && !resultDraftId && (
            <Button size="sm" variant="ghost" onClick={onReopen}>
              Open dialog
            </Button>
          )}
        </div>
      </CardContent>
      <PromoteStepDetailsDrawer
        controller={controller}
        stepId={openStep}
        onOpenChange={(open) => { if (!open) setOpenStep(null); }}
      />
    </Card>
  );
}
