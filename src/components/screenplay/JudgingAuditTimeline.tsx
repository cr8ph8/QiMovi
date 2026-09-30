/**
 * JudgingAuditTimeline — shows the chronological log of judging events
 * (start / continue / submit final / re-open) for a single entry.
 *
 * Backed by the SECURITY DEFINER RPC `get_entry_judging_audit`, which only
 * returns rows for admins and judges. Writers see an empty/unauthorized state.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  History,
  Gavel,
  Send,
  RotateCcw,
  PlayCircle,
  Lock,
  CircleDot,
  CircleCheck,
  CircleDashed,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import JudgingProgressTracker, { type ProgressStep } from "./JudgingProgressTracker";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ArrowRight, Minus, Plus } from "lucide-react";

interface JudgingAuditTimelineProps {
  entryId?: string | null;
  preset?: string | null;
  version?: number | null;
}

interface AuditRow {
  id: string;
  user_id: string | null;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
  actor_email: string | null;
}

const ACTION_META: Record<
  string,
  { label: string; icon: typeof Gavel; tone: "blue" | "amber" | "emerald" | "rose" }
> = {
  judging_start: { label: "Started judging", icon: PlayCircle, tone: "amber" },
  judging_continue: { label: "Continued judging", icon: Gavel, tone: "blue" },
  judging_submit_final: { label: "Submitted final score", icon: Send, tone: "emerald" },
  judging_reopen: { label: "Re-opened scoring", icon: RotateCcw, tone: "rose" },
};

function formatActor(row: AuditRow): string {
  if (row.actor_email) return row.actor_email;
  if (row.user_id) return `${row.user_id.slice(0, 8)}…`;
  return "system";
}

export default function JudgingAuditTimeline({ entryId, preset, version }: JudgingAuditTimelineProps) {
  const { isAdmin, isJudge } = useAuth();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const canView = isAdmin || isJudge;

  useEffect(() => {
    let cancelled = false;
    if (!canView) {
      setRows([]);
      return;
    }
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id ?? null;
      if (!cancelled) setUserId(uid);
      if (!entryId || !uid) {
        setRows([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const { data, error: qErr } = await supabase.rpc("get_entry_judging_audit", {
          _entry_id: entryId,
        });
        if (qErr) {
          if (!cancelled) setError(qErr.message);
          return;
        }
        if (!cancelled) setRows((data as AuditRow[]) ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entryId, canView]);

  const myStatus = useMemo(() => {
    if (!userId) return { state: "not_started" as const, label: "Not started", variant: "muted" as const, icon: CircleDashed };
    const myRows = [...rows]
      .filter((r) => r.user_id === userId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (myRows.length === 0) return { state: "not_started" as const, label: "Not started", variant: "muted" as const, icon: CircleDashed };
    const latest = myRows[0].action;
    if (latest === "judging_submit_final") {
      return { state: "final_submitted" as const, label: "Final submitted", variant: "emerald" as const, icon: CircleCheck };
    }
    if (latest === "judging_reopen") {
      return { state: "not_started" as const, label: "Re-opened — restart", variant: "amber" as const, icon: CircleDashed };
    }
    return { state: "in_progress" as const, label: "In progress", variant: "blue" as const, icon: CircleDot };
  }, [rows, userId]);

  const progressSteps: ProgressStep[] = useMemo(() => {
    const steps: ProgressStep[] = [
      { label: "Rubric preset assigned", done: !!preset },
      { label: "Rubric version locked", done: version != null },
      { label: "Judging session started", done: myStatus.state === "in_progress" || myStatus.state === "final_submitted" },
      { label: "Final score submitted", done: myStatus.state === "final_submitted" },
    ];
    return steps;
  }, [preset, version, myStatus.state]);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  type StepShape = { label: string; done: boolean };
  type EventDiff = {
    current: AuditRow;
    previous: AuditRow | null;
    stateChange: { from: string | null; to: string | null } | null;
    presetChange: { from: string | null; to: string | null } | null;
    versionChange: { from: number | string | null; to: number | string | null } | null;
    countChange: { from: { c: number | null; t: number | null }; to: { c: number | null; t: number | null } } | null;
    stepsAdded: StepShape[];
    stepsRemoved: StepShape[];
    stepLabelChanged: { index: number; from: string; to: string }[];
  };

  const eventDiff: EventDiff | null = useMemo(() => {
    if (!selectedId) return null;
    const sortedAsc = [...rows].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    const idx = sortedAsc.findIndex((r) => r.id === selectedId);
    if (idx < 0) return null;
    const current = sortedAsc[idx];
    // Find most recent previous event by the same actor (falls back to global previous)
    let previous: AuditRow | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (sortedAsc[i].user_id === current.user_id) {
        previous = sortedAsc[i];
        break;
      }
    }
    if (!previous && idx > 0) previous = sortedAsc[idx - 1];

    const cd = current.details ?? {};
    const pd = previous?.details ?? {};

    const cState = (cd.derived_state as string) ?? null;
    const pState = (pd.derived_state as string) ?? null;
    const cPreset = (cd.rubric_preset as string) ?? null;
    const pPreset = (pd.rubric_preset as string) ?? null;
    const cVersion = (cd.rubric_version as number | string | null) ?? null;
    const pVersion = (pd.rubric_version as number | string | null) ?? null;
    const cCount = {
      c: typeof cd.completed_count === "number" ? cd.completed_count : null,
      t: typeof cd.total_count === "number" ? cd.total_count : null,
    };
    const pCount = {
      c: typeof pd.completed_count === "number" ? pd.completed_count : null,
      t: typeof pd.total_count === "number" ? pd.total_count : null,
    };

    const cSteps: StepShape[] = Array.isArray(cd.steps) ? (cd.steps as StepShape[]) : [];
    const pSteps: StepShape[] = Array.isArray(pd.steps) ? (pd.steps as StepShape[]) : [];

    const cDone = new Set(cSteps.filter((s) => s?.done).map((s) => s.label));
    const pDone = new Set(pSteps.filter((s) => s?.done).map((s) => s.label));
    const stepsAdded = [...cDone].filter((l) => !pDone.has(l)).map((label) => ({ label, done: true }));
    const stepsRemoved = [...pDone].filter((l) => !cDone.has(l)).map((label) => ({ label, done: false }));

    const stepLabelChanged: { index: number; from: string; to: string }[] = [];
    const maxLen = Math.max(cSteps.length, pSteps.length);
    for (let i = 0; i < maxLen; i++) {
      const a = pSteps[i]?.label;
      const b = cSteps[i]?.label;
      if (a && b && a !== b) stepLabelChanged.push({ index: i, from: a, to: b });
    }

    // For single-step toggle events (judging_progress_step_completed/uncompleted),
    // synthesize the diff from the event payload itself.
    if (
      current.action === "judging_progress_step_completed" ||
      current.action === "judging_progress_step_uncompleted"
    ) {
      const label = (cd.step_label as string) || `Step ${(cd.step_index as number) ?? "?"}`;
      if (current.action === "judging_progress_step_completed" && stepsAdded.length === 0) {
        stepsAdded.push({ label, done: true });
      }
      if (current.action === "judging_progress_step_uncompleted" && stepsRemoved.length === 0) {
        stepsRemoved.push({ label, done: false });
      }
    }

    return {
      current,
      previous,
      stateChange: pState !== cState ? { from: pState, to: cState } : null,
      presetChange: pPreset !== cPreset ? { from: pPreset, to: cPreset } : null,
      versionChange: pVersion !== cVersion ? { from: pVersion, to: cVersion } : null,
      countChange:
        pCount.c !== cCount.c || pCount.t !== cCount.t ? { from: pCount, to: cCount } : null,
      stepsAdded,
      stepsRemoved,
      stepLabelChanged,
    };
  }, [selectedId, rows]);

  if (!canView) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/80 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-display text-sm font-bold tracking-tight">Judging audit timeline</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Only judges and operators can view the per-event audit trail for this entry.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 p-5 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-primary" />
          <h3 className="font-display text-sm font-bold tracking-tight">
            Judging audit timeline
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {!loading && (
            <JudgingProgressTracker steps={progressSteps} compact className="mr-1" />
          )}
          {!loading && (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-mono flex items-center gap-1",
                myStatus.variant === "emerald" && "border-emerald-500/40 text-emerald-400",
                myStatus.variant === "blue" && "border-blue-500/40 text-blue-400",
                myStatus.variant === "amber" && "border-amber-500/40 text-amber-400",
                myStatus.variant === "muted" && "border-muted-foreground/30 text-muted-foreground",
              )}
            >
              <myStatus.icon className="h-3 w-3" />
              Your status: {myStatus.label}
            </Badge>
          )}
          {!loading && rows.length > 0 && (
            <span className="text-[10px] font-mono text-muted-foreground">
              {rows.length} event{rows.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-5/6" />
        </div>
      ) : error ? (
        <p className="text-xs font-mono text-destructive">Could not load audit: {error}</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center rounded-lg border border-dashed border-border/40 bg-muted/20 p-6 gap-4">
          <div className="flex flex-col items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-mono flex items-center gap-1",
                myStatus.variant === "emerald" && "border-emerald-500/40 text-emerald-400",
                myStatus.variant === "blue" && "border-blue-500/40 text-blue-400",
                myStatus.variant === "amber" && "border-amber-500/40 text-amber-400",
                myStatus.variant === "muted" && "border-muted-foreground/30 text-muted-foreground",
              )}
            >
              <myStatus.icon className="h-3 w-3" />
              Your status: {myStatus.label}
            </Badge>
            <div className="rounded-full bg-primary/10 p-3">
              <History className="h-5 w-5 text-primary/70" />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">No judging events yet</p>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto leading-relaxed">
              This entry hasn't been evaluated. Use the action button above to begin scoring.
            </p>
          </div>
          <div className="w-full max-w-xs">
            <JudgingProgressTracker steps={progressSteps} />
          </div>
          <div className="flex flex-col items-center gap-1 text-[10px] font-mono text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <PlayCircle className="h-3 w-3 text-amber-400" />
              Start judging to record your first event
            </span>
            <span className="inline-flex items-center gap-1">
              <Send className="h-3 w-3 text-emerald-400" />
              Submit final score when complete
            </span>
          </div>
        </div>
      ) : (
        <ol className="relative border-l border-border/30 ml-2 space-y-3">
          {rows.map((row) => {
            const meta = ACTION_META[row.action] ?? {
              label: row.action,
              icon: Gavel,
              tone: "blue" as const,
            };
            const Icon = meta.icon;
            const d = row.details ?? {};
            const role = (d.role as string) || null;
            const preset = (d.rubric_preset as string) || null;
            const version = (d.rubric_version as number | string | null) ?? null;
            const priorStatus = (d.prior_status as string) || null;
            const ts = new Date(row.created_at);
            return (
              <li key={row.id} className="pl-4 relative">
                <span
                  className={cn(
                    "absolute -left-[7px] top-1.5 h-3 w-3 rounded-full border-2 border-background",
                    meta.tone === "emerald" && "bg-emerald-500",
                    meta.tone === "blue" && "bg-blue-500",
                    meta.tone === "amber" && "bg-amber-500",
                    meta.tone === "rose" && "bg-rose-500",
                  )}
                />
                <button
                  type="button"
                  onClick={() => setSelectedId(row.id)}
                  className="w-full text-left rounded-md border border-border/20 bg-muted/10 p-2.5 hover:bg-muted/20 hover:border-primary/30 transition-colors focus:outline-none focus:ring-1 focus:ring-primary/40"
                  aria-label={`View details for ${meta.label}`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <Icon
                      className={cn(
                        "h-3.5 w-3.5",
                        meta.tone === "emerald" && "text-emerald-400",
                        meta.tone === "blue" && "text-blue-400",
                        meta.tone === "amber" && "text-amber-400",
                        meta.tone === "rose" && "text-rose-400",
                      )}
                    />
                    <span className="text-xs font-semibold text-foreground">{meta.label}</span>
                    {role && (
                      <Badge
                        variant="outline"
                        className="text-[10px] font-mono border-primary/40 text-primary"
                      >
                        {role}
                      </Badge>
                    )}
                    {priorStatus && (
                      <Badge variant="outline" className="text-[10px] font-mono">
                        from: {priorStatus}
                      </Badge>
                    )}
                    <span className="ml-auto text-[10px] font-mono text-muted-foreground">
                      {ts.toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 flex-wrap text-[10px] font-mono text-muted-foreground">
                    <span>by {formatActor(row)}</span>
                    {preset && (
                      <span>
                        · rubric{" "}
                        <span className="text-foreground">{preset}</span>
                        {version != null && (
                          <>
                            {" "}
                            v<span className="text-foreground">{String(version)}</span>
                          </>
                        )}
                      </span>
                    )}
                    <span className="ml-auto text-primary/70">View details →</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <Sheet open={!!selectedId} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          {eventDiff && (() => {
            const meta = ACTION_META[eventDiff.current.action] ?? {
              label: eventDiff.current.action,
              icon: Gavel,
              tone: "blue" as const,
            };
            const HeadIcon = meta.icon;
            const ts = new Date(eventDiff.current.created_at);
            const hasAnyDiff =
              eventDiff.stateChange ||
              eventDiff.presetChange ||
              eventDiff.versionChange ||
              eventDiff.countChange ||
              eventDiff.stepsAdded.length > 0 ||
              eventDiff.stepsRemoved.length > 0 ||
              eventDiff.stepLabelChanged.length > 0;
            return (
              <>
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    <HeadIcon
                      className={cn(
                        "h-4 w-4",
                        meta.tone === "emerald" && "text-emerald-400",
                        meta.tone === "blue" && "text-blue-400",
                        meta.tone === "amber" && "text-amber-400",
                        meta.tone === "rose" && "text-rose-400",
                      )}
                    />
                    {meta.label}
                  </SheetTitle>
                  <SheetDescription className="text-xs font-mono">
                    {ts.toLocaleString()} · by {formatActor(eventDiff.current)}
                  </SheetDescription>
                </SheetHeader>

                <div className="mt-5 space-y-4 text-xs">
                  <div>
                    <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      What changed
                    </h4>
                    {!eventDiff.previous && (
                      <p className="text-muted-foreground italic">
                        First recorded event for this judge — no prior state to compare against.
                      </p>
                    )}
                    {eventDiff.previous && !hasAnyDiff && (
                      <p className="text-muted-foreground italic">
                        No measurable change between this event and the prior snapshot.
                      </p>
                    )}
                    <div className="space-y-2">
                      {eventDiff.stateChange && (
                        <DiffRow
                          label="Derived status"
                          from={eventDiff.stateChange.from ?? "—"}
                          to={eventDiff.stateChange.to ?? "—"}
                        />
                      )}
                      {eventDiff.presetChange && (
                        <DiffRow
                          label="Rubric preset"
                          from={eventDiff.presetChange.from ?? "—"}
                          to={eventDiff.presetChange.to ?? "—"}
                        />
                      )}
                      {eventDiff.versionChange && (
                        <DiffRow
                          label="Rubric version"
                          from={
                            eventDiff.versionChange.from != null
                              ? `v${eventDiff.versionChange.from}`
                              : "—"
                          }
                          to={
                            eventDiff.versionChange.to != null
                              ? `v${eventDiff.versionChange.to}`
                              : "—"
                          }
                        />
                      )}
                      {eventDiff.countChange && (
                        <DiffRow
                          label="Checklist progress"
                          from={`${eventDiff.countChange.from.c ?? 0}/${eventDiff.countChange.from.t ?? 0}`}
                          to={`${eventDiff.countChange.to.c ?? 0}/${eventDiff.countChange.to.t ?? 0}`}
                        />
                      )}
                    </div>
                  </div>

                  {(eventDiff.stepsAdded.length > 0 || eventDiff.stepsRemoved.length > 0) && (
                    <div>
                      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                        Checklist deltas
                      </h4>
                      <div className="space-y-1.5">
                        {eventDiff.stepsAdded.map((s, i) => (
                          <div
                            key={`add-${i}`}
                            className="flex items-center gap-2 rounded border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1.5 text-emerald-300"
                          >
                            <Plus className="h-3 w-3" />
                            <span className="text-[11px]">Completed: {s.label}</span>
                          </div>
                        ))}
                        {eventDiff.stepsRemoved.map((s, i) => (
                          <div
                            key={`rm-${i}`}
                            className="flex items-center gap-2 rounded border border-rose-500/20 bg-rose-500/5 px-2.5 py-1.5 text-rose-300"
                          >
                            <Minus className="h-3 w-3" />
                            <span className="text-[11px]">Uncompleted: {s.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {eventDiff.stepLabelChanged.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                        Step labels renamed
                      </h4>
                      <div className="space-y-1.5">
                        {eventDiff.stepLabelChanged.map((c) => (
                          <DiffRow key={c.index} label={`Step ${c.index + 1}`} from={c.from} to={c.to} />
                        ))}
                      </div>
                    </div>
                  )}

                  <details className="rounded-md border border-border/20 bg-muted/10 p-2.5">
                    <summary className="cursor-pointer text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      Raw event payload
                    </summary>
                    <pre className="mt-2 text-[10px] font-mono whitespace-pre-wrap break-all text-muted-foreground">
{JSON.stringify(eventDiff.current.details ?? {}, null, 2)}
                    </pre>
                  </details>
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DiffRow({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <div className="rounded-md border border-border/20 bg-muted/10 p-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </div>
      <div className="flex items-center gap-2 text-[11px] font-mono">
        <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-300 line-through">
          {from}
        </span>
        <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">
          {to}
        </span>
      </div>
    </div>
  );
}