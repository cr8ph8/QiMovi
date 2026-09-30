/**
 * PromoteStepDetailsDrawer
 *
 * Side sheet that reveals the inner workings of a single promote phase:
 *  - live status + duration
 *  - chronological log stream with level filtering
 *  - generated artifacts (metadata, Fountain preview, ids, routes…)
 *  - last error for the step, if any
 *
 * Driven entirely by the shared `usePromoteBrief` controller so the
 * panel updates in real time even while the run is still in flight.
 */

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, Loader2, AlertCircle, FileText, Sparkles, X, Search, ChevronDown, ChevronRight, Pin } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  PROMOTE_STEPS,
  type PromoteLogEntry,
  type PromoteStepArtifact,
  type PromoteStepId,
  type PromoteStepState,
} from "@/hooks/usePromoteBrief";
import type { usePromoteBrief } from "@/hooks/usePromoteBrief";

type Controller = ReturnType<typeof usePromoteBrief>;
type LogLevel = PromoteLogEntry["level"];

interface Props {
  controller: Controller;
  stepId: PromoteStepId | null;
  onOpenChange: (open: boolean) => void;
}

const STATE_ICON: Record<PromoteStepState, JSX.Element> = {
  pending: <Circle className="h-4 w-4 text-muted-foreground/60" />,
  running: <Loader2 className="h-4 w-4 animate-spin text-primary" />,
  done: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
  error: <AlertCircle className="h-4 w-4 text-destructive" />,
};

const LOG_LEVEL_META: Record<LogLevel, { label: string; activeClass: string; countClass: string; badgeBorder: string }> = {
  info: {
    label: "Info",
    activeClass: "bg-muted/80 text-muted-foreground ring-1 ring-muted-foreground/20",
    countClass: "bg-muted text-muted-foreground",
    badgeBorder: "border-muted-foreground/20",
  },
  warn: {
    label: "Warn",
    activeClass: "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40",
    countClass: "bg-amber-500/15 text-amber-400",
    badgeBorder: "border-amber-500/30",
  },
  error: {
    label: "Error",
    activeClass: "bg-destructive/20 text-destructive ring-1 ring-destructive/40",
    countClass: "bg-destructive/15 text-destructive",
    badgeBorder: "border-destructive/30",
  },
  success: {
    label: "Success",
    activeClass: "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40",
    countClass: "bg-emerald-500/15 text-emerald-400",
    badgeBorder: "border-emerald-500/30",
  },
};

const LOG_BADGE: Record<LogLevel, string> = {
  info: "bg-muted/60 text-muted-foreground",
  warn: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
  error: "bg-destructive/15 text-destructive border border-destructive/30",
  success: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
};

function formatClock(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour12: false }) + "." +
    d.getMilliseconds().toString().padStart(3, "0");
}

function ArtifactBlock({ artifact }: { artifact: PromoteStepArtifact }) {
  const copy = () => {
    navigator.clipboard.writeText(artifact.value).then(
      () => toast.success(`Copied "${artifact.label}"`),
      () => toast.error("Copy failed"),
    );
  };
  const isCode = artifact.language === "json" || artifact.language === "fountain";
  return (
    <div className="rounded-md border border-border/50 bg-card/60">
      <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium truncate">{artifact.label}</span>
          {artifact.language && (
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-mono uppercase">
              {artifact.language}
            </Badge>
          )}
        </div>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={copy}>
          Copy
        </Button>
      </div>
      {isCode ? (
        <pre className="max-h-72 overflow-auto p-3 text-[11px] leading-relaxed font-mono text-foreground/90 whitespace-pre-wrap break-words">
          {artifact.value}
        </pre>
      ) : (
        <div className="p-3 text-xs text-foreground/90 break-words whitespace-pre-wrap">
          {artifact.value}
        </div>
      )}
    </div>
  );
}

export function PromoteStepDetailsDrawer({ controller, stepId, onOpenChange }: Props) {
  const step = useMemo(
    () => (stepId ? PROMOTE_STEPS.find((s) => s.id === stepId) ?? null : null),
    [stepId],
  );
  const open = stepId !== null;

  const state = stepId ? controller.states[stepId] : "pending";
  const stepLogs = stepId ? controller.logs[stepId] : [];
  const stepArtifacts = stepId ? controller.artifacts[stepId] : [];
  const stepError = stepId ? controller.errors[stepId] : null;
  const timing = stepId ? controller.timings[stepId] : { startedAt: null, finishedAt: null };

  const durationMs =
    timing.startedAt
      ? (timing.finishedAt ?? (state === "running" ? Date.now() : timing.startedAt)) - timing.startedAt
      : 0;

  const idx = stepId ? PROMOTE_STEPS.findIndex((s) => s.id === stepId) : -1;

  // ---- filtering state ----
  const [activeLevels, setActiveLevels] = useState<Set<LogLevel>>(new Set(["info", "warn", "error", "success"]));
  const [query, setQuery] = useState("");

  const levelCounts = useMemo(() => {
    const counts: Record<LogLevel, number> = { info: 0, warn: 0, error: 0, success: 0 };
    stepLogs.forEach((l) => { counts[l.level]++; });
    return counts;
  }, [stepLogs]);

  const filteredLogs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stepLogs.filter((entry) => {
      const levelOk = activeLevels.has(entry.level);
      const textOk = q === "" || entry.message.toLowerCase().includes(q);
      return levelOk && textOk;
    });
  }, [stepLogs, activeLevels, query]);

  // ---- rule-based grouping: pin errors, attach related preceding logs ----
  type LogGroup = {
    errorIndex: number; // index in stepLogs of the anchoring error
    error: PromoteLogEntry;
    related: PromoteLogEntry[]; // logs between previous error and this one (exclusive of errors)
  };

  const errorGroups = useMemo<LogGroup[]>(() => {
    const groups: LogGroup[] = [];
    let bucket: PromoteLogEntry[] = [];
    stepLogs.forEach((entry, i) => {
      if (entry.level === "error") {
        groups.push({ errorIndex: i, error: entry, related: bucket });
        bucket = [];
      } else {
        bucket.push(entry);
      }
    });
    return groups;
  }, [stepLogs]);

  const trailingLogs = useMemo(() => {
    // logs that occurred after the last error (no anchoring error)
    if (errorGroups.length === 0) return [] as PromoteLogEntry[];
    const lastErrIdx = errorGroups[errorGroups.length - 1].errorIndex;
    return stepLogs.slice(lastErrIdx + 1);
  }, [stepLogs, errorGroups]);

  const hasErrors = errorGroups.length > 0;
  const [autoFocusErrors, setAutoFocusErrors] = useState(true);
  const [expandedErrors, setExpandedErrors] = useState<Set<number>>(new Set());

  // When new errors stream in, auto-expand the most recent one so users see context.
  useEffect(() => {
    if (!hasErrors) return;
    const latest = errorGroups[errorGroups.length - 1].errorIndex;
    setExpandedErrors((prev) => (prev.has(latest) ? prev : new Set([...prev, latest])));
  }, [hasErrors, errorGroups]);

  const toggleErrorExpansion = (errorIndex: number) => {
    setExpandedErrors((prev) => {
      const next = new Set(prev);
      if (next.has(errorIndex)) next.delete(errorIndex);
      else next.add(errorIndex);
      return next;
    });
  };

  const toggleLevel = (level: LogLevel) => {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  };

  const selectOnly = (levels: LogLevel[]) => {
    setActiveLevels(new Set(levels));
  };

  const allLevelsActive = activeLevels.size === 4;
  const onlyWarningsAndErrors = activeLevels.size === 2 && activeLevels.has("warn") && activeLevels.has("error");
  const focusMode = autoFocusErrors && hasErrors;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onOpenChange(false); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col">
        <SheetHeader className="px-5 py-4 border-b border-border/50">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              <SheetTitle className="font-display text-base truncate">
                {step ? `${idx + 1}. ${step.label}` : "Step details"}
              </SheetTitle>
            </div>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-mono uppercase tracking-wider",
                state === "running" && "border-primary/40 text-primary",
                state === "done" && "border-emerald-500/40 text-emerald-400",
                state === "error" && "border-destructive/40 text-destructive",
              )}
            >
              <span className="mr-1.5 inline-flex">{STATE_ICON[state]}</span>
              {state}
            </Badge>
          </div>
          <SheetDescription className="text-xs">
            {step?.hint}
          </SheetDescription>
          <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground pt-1">
            {timing.startedAt && (
              <span>started {new Date(timing.startedAt).toLocaleTimeString()}</span>
            )}
            {durationMs > 0 && (
              <span className={cn("tabular-nums", state === "running" && "text-primary")}>
                {(durationMs / 1000).toFixed(2)}s
              </span>
            )}
            <span>{stepLogs.length} log{stepLogs.length === 1 ? "" : "s"}</span>
            <span>{stepArtifacts.length} artifact{stepArtifacts.length === 1 ? "" : "s"}</span>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="p-5 space-y-5">
            {stepError && (
              <section className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-destructive">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Last error
                </div>
                <p className="mt-1 text-xs text-destructive/90 break-words font-mono">
                  {stepError}
                </p>
              </section>
            )}

            <section>
              <div className="flex items-center justify-between mb-2 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    Live log
                  </h3>
                  {hasErrors && (
                    <button
                      onClick={() => setAutoFocusErrors((v) => !v)}
                      className={cn(
                        "inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded transition-colors",
                        autoFocusErrors
                          ? "bg-destructive/15 text-destructive ring-1 ring-destructive/30"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                      )}
                      title="Pin errors at the top and expand related logs on demand"
                    >
                      <Pin className="h-2.5 w-2.5" />
                      Auto-focus errors
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => selectOnly(["warn", "error"])}
                    className={cn(
                      "text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded transition-colors",
                      onlyWarningsAndErrors
                        ? "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                  >
                    Warnings & Errors
                  </button>
                  <div className="w-px h-3 bg-border/60" />
                  <button
                    onClick={() => setActiveLevels(new Set(["info", "warn", "error", "success"]))}
                    className={cn(
                      "text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded transition-colors",
                      allLevelsActive
                        ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                  >
                    All
                  </button>
                </div>
              </div>

              {/* Level toggles */}
              <div className="flex flex-wrap items-center gap-1.5 mb-3">
                {(Object.keys(LOG_LEVEL_META) as LogLevel[]).map((level) => {
                  const meta = LOG_LEVEL_META[level];
                  const count = levelCounts[level];
                  const isActive = activeLevels.has(level);
                  return (
                    <button
                      key={level}
                      onClick={() => toggleLevel(level)}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium transition-all",
                        isActive ? meta.activeClass : "text-muted-foreground/50 bg-muted/30 hover:bg-muted/50"
                      )}
                      title={`${meta.label} entries`}
                    >
                      <span
                        className={cn(
                          "inline-block w-1.5 h-1.5 rounded-full",
                          level === "info" && "bg-muted-foreground/50",
                          level === "warn" && "bg-amber-400",
                          level === "error" && "bg-destructive",
                          level === "success" && "bg-emerald-400",
                        )}
                      />
                      {meta.label}
                      <span
                        className={cn(
                          "ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[9px] font-mono px-1",
                          isActive ? meta.countClass : "bg-transparent text-muted-foreground/40"
                        )}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Search */}
              <div className="relative mb-3">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
                <Input
                  placeholder="Filter logs..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-8 h-8 text-xs bg-muted/30 border-border/40"
                />
              </div>

              {focusMode ? (
                <FocusedErrorView
                  groups={errorGroups}
                  trailing={trailingLogs}
                  expanded={expandedErrors}
                  onToggle={toggleErrorExpansion}
                  activeLevels={activeLevels}
                  query={query.trim().toLowerCase()}
                />
              ) : filteredLogs.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  {stepLogs.length === 0
                    ? "No log entries yet for this step."
                    : "No logs match the current filters."}
                </p>
              ) : (
                <ol className="space-y-1.5">
                  {filteredLogs.map((entry, i) => (
                    <li
                      key={`${entry.ts}-${i}`}
                      className="animate-fade-in flex items-start gap-2 text-xs"
                    >
                      <span className="font-mono text-[10px] text-muted-foreground/70 mt-0.5 shrink-0 tabular-nums">
                        {formatClock(entry.ts)}
                      </span>
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-mono uppercase shrink-0",
                          LOG_BADGE[entry.level],
                        )}
                      >
                        {entry.level}
                      </span>
                      <span className="text-foreground/90 break-words">{entry.message}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>


            <section>
              <h3 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                Generated artifacts
              </h3>
              {stepArtifacts.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  This step hasn't produced any artifacts yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {stepArtifacts.map((a) => (
                    <ArtifactBlock key={a.key} artifact={a} />
                  ))}
                </div>
              )}
            </section>
          </div>
        </ScrollArea>

        <div className="border-t border-border/50 px-5 py-3 flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            <X className="h-3.5 w-3.5 mr-1" /> Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---- Focused error view (rule-based auto-filter) ----

interface FocusedErrorViewProps {
  groups: {
    errorIndex: number;
    error: PromoteLogEntry;
    related: PromoteLogEntry[];
  }[];
  trailing: PromoteLogEntry[];
  expanded: Set<number>;
  onToggle: (errorIndex: number) => void;
  activeLevels: Set<LogLevel>;
  query: string;
}

function matchesFilter(entry: PromoteLogEntry, levels: Set<LogLevel>, q: string): boolean {
  if (!levels.has(entry.level)) return false;
  if (q && !entry.message.toLowerCase().includes(q)) return false;
  return true;
}

function LogRow({ entry }: { entry: PromoteLogEntry }) {
  return (
    <li className="animate-fade-in flex items-start gap-2 text-xs">
      <span className="font-mono text-[10px] text-muted-foreground/70 mt-0.5 shrink-0 tabular-nums">
        {new Date(entry.ts).toLocaleTimeString(undefined, { hour12: false })}.
        {new Date(entry.ts).getMilliseconds().toString().padStart(3, "0")}
      </span>
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-[10px] font-mono uppercase shrink-0",
          LOG_BADGE[entry.level],
        )}
      >
        {entry.level}
      </span>
      <span className="text-foreground/90 break-words">{entry.message}</span>
    </li>
  );
}

function FocusedErrorView({
  groups,
  trailing,
  expanded,
  onToggle,
  activeLevels,
  query,
}: FocusedErrorViewProps) {
  const errorLevelOn = activeLevels.has("error");
  const visibleGroups = errorLevelOn
    ? groups.filter((g) => !query || g.error.message.toLowerCase().includes(query))
    : [];
  const visibleTrailing = trailing.filter((e) => matchesFilter(e, activeLevels, query));

  if (visibleGroups.length === 0 && visibleTrailing.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No logs match the current filters.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {visibleGroups.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-destructive/80">
            <Pin className="h-2.5 w-2.5" />
            Pinned errors ({visibleGroups.length})
          </div>
          <ul className="space-y-2">
            {visibleGroups.map((g) => {
              const isOpen = expanded.has(g.errorIndex);
              const relatedVisible = g.related.filter((e) =>
                matchesFilter(e, activeLevels, query),
              );
              return (
                <li
                  key={g.errorIndex}
                  className="rounded-md border border-destructive/40 bg-destructive/5 overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => onToggle(g.errorIndex)}
                    className="w-full flex items-start gap-2 text-left px-3 py-2 hover:bg-destructive/10 transition-colors"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5 text-destructive/80 mt-0.5 shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-destructive/80 mt-0.5 shrink-0" />
                    )}
                    <span className="font-mono text-[10px] text-destructive/70 mt-0.5 shrink-0 tabular-nums">
                      {new Date(g.error.ts).toLocaleTimeString(undefined, { hour12: false })}
                    </span>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-mono uppercase shrink-0",
                        LOG_BADGE.error,
                      )}
                    >
                      error
                    </span>
                    <span className="text-xs text-destructive break-words flex-1">
                      {g.error.message}
                    </span>
                    <span className="text-[10px] font-mono text-destructive/60 shrink-0 mt-0.5">
                      {g.related.length} ctx
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-destructive/30 bg-background/40 px-3 py-2">
                      {relatedVisible.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground italic">
                          {g.related.length === 0
                            ? "No preceding context logs for this error."
                            : "Related logs are hidden by current filters."}
                        </p>
                      ) : (
                        <>
                          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
                            Related context ({relatedVisible.length})
                          </div>
                          <ol className="space-y-1.5">
                            {relatedVisible.map((entry, i) => (
                              <LogRow key={`${entry.ts}-${i}`} entry={entry} />
                            ))}
                          </ol>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {visibleTrailing.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            After last error
          </div>
          <ol className="space-y-1.5">
            {visibleTrailing.map((entry, i) => (
              <LogRow key={`trail-${entry.ts}-${i}`} entry={entry} />
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
