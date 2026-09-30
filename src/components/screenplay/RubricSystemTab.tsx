/**
 * RubricSystemTab — read-only view of the rubric used to score this entry,
 * plus the JudgingTransparency explainer of how evaluation works.
 *
 * Mounted as the "Rubric" tab inside AnalysisTabs on the entry dashboard.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Scale, Info, Clock, CheckCircle2, Loader2, Gavel, Send, RotateCcw, CircleDot, CircleCheck, CircleDashed } from "lucide-react";
import JudgingTransparency from "@/components/JudgingTransparency";
import JudgingAuditTimeline from "@/components/screenplay/JudgingAuditTimeline";
import JudgingProgressTracker, { type ProgressStep } from "@/components/screenplay/JudgingProgressTracker";
import { normalizeDefinition, type NormalizedDim } from "@/lib/rubric-diff";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { logAuditEvent, logAuditEvents } from "@/lib/audit";

interface RubricSystemTabProps {
  preset?: string | null;
  version?: number | null;
  entryStatus?: string | null;
  entryId?: string | null;
}

interface RubricVersionRow {
  id: string;
  preset_id: string;
  version: number;
  label: string | null;
  definition: unknown;
  created_at: string;
}

export default function RubricSystemTab({ preset, version, entryStatus, entryId }: RubricSystemTabProps) {
  const navigate = useNavigate();
  const { isAdmin, isJudge } = useAuth();
  const [row, setRow] = useState<RubricVersionRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [judgeStatus, setJudgeStatus] = useState<{ label: string; variant: "emerald" | "blue" | "amber" | "muted"; icon: typeof CircleDot; state?: string } | null>(null);

  const status = (entryStatus || "").toLowerCase();
  const action = useMemo(() => {
    if (!isAdmin && !isJudge) return null;
    const target = entryId ? `/god-mode?entry=${encodeURIComponent(entryId)}#judging` : "/god-mode#judging";
    if (status === "scored") {
      // Only admins can re-open finalized scoring
      if (!isAdmin) return null;
      return { key: "reopen", label: "Re-open Scoring", icon: RotateCcw, variant: "outline" as const, target };
    }
    if (status === "judging") {
      return isAdmin
        ? { key: "submit_final", label: "Submit Final Score", icon: Send, variant: "default" as const, target }
        : { key: "continue", label: "Continue Judging", icon: Gavel, variant: "default" as const, target };
    }
    // submitted / unscored / unknown
    return { key: "start", label: "Start Judging", icon: Gavel, variant: "default" as const, target };
  }, [isAdmin, isJudge, status, entryId]);

  useEffect(() => {
    let cancelled = false;
    if (!isAdmin && !isJudge) {
      setJudgeStatus(null);
      return;
    }
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id ?? null;
      if (!cancelled) setUserId(uid);
      if (!entryId || !uid) {
        if (!cancelled) setJudgeStatus(null);
        return;
      }
      try {
        const { data } = await supabase.rpc("get_entry_judging_audit", { _entry_id: entryId });
        const auditRows = (data as { user_id: string | null; action: string; created_at: string }[]) ?? [];
        const myRows = [...auditRows]
          .filter((r) => r.user_id === uid)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        if (myRows.length === 0) {
          if (!cancelled) setJudgeStatus({ label: "Not started", variant: "muted", icon: CircleDashed, state: "not_started" });
          return;
        }
        const latest = myRows[0].action;
        if (latest === "judging_submit_final") {
          if (!cancelled) setJudgeStatus({ label: "Final submitted", variant: "emerald", icon: CircleCheck, state: "final_submitted" });
        } else if (latest === "judging_reopen") {
          if (!cancelled) setJudgeStatus({ label: "Re-opened — restart", variant: "amber", icon: CircleDashed, state: "not_started" });
        } else {
          if (!cancelled) setJudgeStatus({ label: "In progress", variant: "blue", icon: CircleDot, state: "in_progress" });
        }
      } catch {
        if (!cancelled) setJudgeStatus(null);
      }
    })();
    return () => { cancelled = true; };
  }, [entryId, isAdmin, isJudge]);

  const handleAction = async () => {
    if (!action) return;
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (uid) {
                await logAuditEvent({
          userId: uid,
          action: `judging_${action.key}`,
          details: {
            entry_id: entryId ?? null,
            prior_status: entryStatus ?? null,
            rubric_preset: preset ?? null,
            rubric_version: version ?? null,
            role: isAdmin ? "admin" : "judge",
            button_label: action.label,
            source: "RubricSystemTab",
          },
        });
      }
    } catch (e) {
      // Non-blocking: navigation still proceeds even if audit insert fails
      console.warn("audit_log insert failed", e);
    }
    navigate(action.target);
  };

  const statusMeta = useMemo(() => {
    const s = (entryStatus || "").toLowerCase();
    if (s === "scored") {
      return {
        label: "Finalized",
        sub: "This entry has been scored and the results are ready.",
        variant: "emerald" as const,
        icon: CheckCircle2,
      };
    }
    if (s === "judging") {
      return {
        label: "In Progress",
        sub: "Evaluation is currently running. Results will appear here once complete.",
        variant: "blue" as const,
        icon: Loader2,
      };
    }
    return {
      label: "Unscored",
      sub: "This entry hasn't been evaluated yet. The rubric below will be used when judging begins.",
      variant: "amber" as const,
      icon: Clock,
    };
  }, [entryStatus]);

  const progressSteps: ProgressStep[] = useMemo(() => {
    const steps: ProgressStep[] = [
      { label: "Rubric preset assigned", done: !!preset },
      { label: "Rubric version locked", done: version != null },
      { label: "Judging session started", done: judgeStatus?.state === "in_progress" || judgeStatus?.state === "final_submitted" },
      { label: "Final score submitted", done: judgeStatus?.state === "final_submitted" },
    ];
    return steps;
  }, [preset, version, judgeStatus?.state]);

  // Hydrate checklist state from backend on mount (cross-device persistence)
  useEffect(() => {
    let cancelled = false;
    if (!entryId || !userId) return;
    (async () => {
      try {
        const { data } = await supabase
          .from("judge_checklist_state")
          .select("derived_state")
          .eq("entry_id", entryId)
          .eq("user_id", userId)
          .maybeSingle();
        if (cancelled || !data?.derived_state) return;
        // Only hydrate if local state hasn't been derived yet
        setJudgeStatus((prev) => {
          if (prev) return prev;
          const s = data.derived_state as string;
          if (s === "final_submitted") return { label: "Final submitted", variant: "emerald", icon: CircleCheck, state: "final_submitted" };
          if (s === "in_progress") return { label: "In progress", variant: "blue", icon: CircleDot, state: "in_progress" };
          return { label: "Not started", variant: "muted", icon: CircleDashed, state: "not_started" };
        });
      } catch (e) {
        console.warn("checklist hydrate failed", e);
      }
    })();
    return () => { cancelled = true; };
  }, [entryId, userId]);

  // Persist checklist state to backend whenever it changes
  useEffect(() => {
    if (!entryId || !userId || !judgeStatus) return;
    const completed = progressSteps.filter((s) => s.done).length;
    const payload = {
      entry_id: entryId,
      user_id: userId,
      rubric_preset: preset ?? null,
      rubric_version: version ?? null,
      steps: progressSteps.map((s) => ({ label: s.label, done: s.done })),
      completed_count: completed,
      total_count: progressSteps.length,
      derived_state: judgeStatus.state ?? null,
    };
    (async () => {
      try {
        await supabase
          .from("judge_checklist_state")
          .upsert([payload], { onConflict: "entry_id,user_id" });
      } catch (e) {
        console.warn("checklist persist failed", e);
      }
    })();
  }, [entryId, userId, preset, version, progressSteps, judgeStatus]);

  // Audit trail: record every judging progress change (step completed/uncompleted,
  // reopened, final submitted) into audit_log so it surfaces in the timeline.
  const prevSnapshotRef = useRef<{
    steps: boolean[];
    state: string | null;
  } | null>(null);
  useEffect(() => {
    if (!entryId || !userId || !judgeStatus) return;
    const currentSteps = progressSteps.map((s) => s.done);
    const currentState = judgeStatus.state ?? null;
    const prev = prevSnapshotRef.current;
    // First render — establish baseline without writing audit rows
    if (!prev) {
      prevSnapshotRef.current = { steps: currentSteps, state: currentState };
      return;
    }
    const changes: Array<{ action: string; details: Record<string, unknown> }> = [];
    progressSteps.forEach((step, i) => {
      const was = prev.steps[i];
      const now = currentSteps[i];
      if (was === now) return;
      changes.push({
        action: now ? "judging_progress_step_completed" : "judging_progress_step_uncompleted",
        details: {
          entry_id: entryId,
          step_index: i,
          step_label: step.label,
          completed_count: currentSteps.filter(Boolean).length,
          total_count: currentSteps.length,
          rubric_preset: preset ?? null,
          rubric_version: version ?? null,
          derived_state: currentState,
          source: "RubricSystemTab.progress",
        },
      });
    });
    if (prev.state !== currentState) {
      if (currentState === "final_submitted") {
        changes.push({
          action: "judging_progress_final_submitted",
          details: {
            entry_id: entryId,
            prior_state: prev.state,
            rubric_preset: preset ?? null,
            rubric_version: version ?? null,
            source: "RubricSystemTab.progress",
          },
        });
      } else if (prev.state === "final_submitted" && currentState !== "final_submitted") {
        changes.push({
          action: "judging_progress_reopened",
          details: {
            entry_id: entryId,
            new_state: currentState,
            rubric_preset: preset ?? null,
            rubric_version: version ?? null,
            source: "RubricSystemTab.progress",
          },
        });
      }
    }
    prevSnapshotRef.current = { steps: currentSteps, state: currentState };
    if (changes.length === 0) return;
    (async () => {
      try {
        await logAuditEvents(changes.map((c) => ({ userId, action: c.action, details: c.details as Record<string, unknown> })));
      } catch (e) {
        console.warn("audit_log progress insert failed", e);
      }
    })();
  }, [entryId, userId, progressSteps, judgeStatus, preset, version]);

  useEffect(() => {
    let cancelled = false;
    if (!preset) {
      setRow(null);
      return;
    }
    (async () => {
      setLoading(true);
      setError(null);
      try {
        let query = supabase
          .from("rubric_versions")
          .select("id, preset_id, version, label, definition, created_at")
          .eq("preset_id", preset);
        if (version != null) {
          query = query.eq("version", version);
        } else {
          query = query.order("version", { ascending: false });
        }
        const { data, error: qErr } = await query.limit(1).maybeSingle();
        if (qErr) {
          if (!cancelled) setError(qErr.message);
          return;
        }
        if (!cancelled) setRow((data as RubricVersionRow) ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preset, version]);

  const dims: NormalizedDim[] = useMemo(
    () => (row ? normalizeDefinition(row.definition) : []),
    [row],
  );

  const weightSum = useMemo(
    () =>
      dims.reduce((acc, d) => acc + (typeof d.weight === "number" ? d.weight : 0), 0),
    [dims],
  );
  const showPct = weightSum > 0;

  const StatusIcon = statusMeta.icon;

  return (
    <div className="space-y-4">
      {/* Score Status Banner */}
      <div
        className={cn(
          "rounded-xl border p-4 flex items-start gap-3",
          statusMeta.variant === "emerald" && "border-emerald-500/30 bg-emerald-500/5",
          statusMeta.variant === "blue" && "border-blue-500/30 bg-blue-500/5",
          statusMeta.variant === "amber" && "border-amber-500/30 bg-amber-500/5",
        )}
      >
        <div
          className={cn(
            "mt-0.5 shrink-0",
            statusMeta.variant === "emerald" && "text-emerald-400",
            statusMeta.variant === "blue" && "text-blue-400",
            statusMeta.variant === "amber" && "text-amber-400",
          )}
        >
          <StatusIcon className={cn("h-5 w-5", statusMeta.variant === "blue" && "animate-spin")} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">{statusMeta.label}</span>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-mono",
                statusMeta.variant === "emerald" && "border-emerald-500/40 text-emerald-400",
                statusMeta.variant === "blue" && "border-blue-500/40 text-blue-400",
                statusMeta.variant === "amber" && "border-amber-500/40 text-amber-400",
              )}
            >
              {entryStatus || "unscored"}
            </Badge>
            {(isAdmin || isJudge) && (
              <Badge variant="outline" className="text-[10px] font-mono border-primary/40 text-primary">
                {isAdmin ? "operator" : "judge"}
              </Badge>
            )}
            {judgeStatus && (
              <>
                <JudgingProgressTracker steps={progressSteps} compact />
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] font-mono flex items-center gap-1",
                    judgeStatus.variant === "emerald" && "border-emerald-500/40 text-emerald-400",
                    judgeStatus.variant === "blue" && "border-blue-500/40 text-blue-400",
                    judgeStatus.variant === "amber" && "border-amber-500/40 text-amber-400",
                    judgeStatus.variant === "muted" && "border-muted-foreground/30 text-muted-foreground",
                  )}
                >
                  <judgeStatus.icon className="h-3 w-3" />
                  {judgeStatus.label}
                </Badge>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{statusMeta.sub}</p>
        </div>
        {action && (() => {
          const myStatusLabel = judgeStatus?.label ?? null;
          let disabledReason: string | null = null;
          if (action.key === "start" || action.key === "continue") {
            if (!preset) disabledReason = "Rubric preset not assigned to this entry yet.";
            else if (version == null) disabledReason = "Rubric version not locked yet.";
          } else if (action.key === "submit_final") {
            if (myStatusLabel !== "In progress") {
              disabledReason = myStatusLabel === "Final submitted"
                ? "You already submitted a final score for this entry."
                : "Start judging and complete your scoring pass before submitting a final score.";
            }
          } else if (action.key === "reopen") {
            if (!preset || version == null) disabledReason = "Rubric preset/version missing — cannot re-open.";
          }
          const disabled = disabledReason !== null;
          return (
            <div className="shrink-0 flex flex-col items-end gap-1">
              <Button
                size="sm"
                variant={action.variant}
                onClick={handleAction}
                disabled={disabled}
                title={disabledReason ?? undefined}
                aria-disabled={disabled}
                className="gap-1.5"
              >
                <action.icon className="h-3.5 w-3.5" />
                {action.label}
              </Button>
              {disabledReason && (
                <span className="text-[10px] font-mono text-muted-foreground max-w-[14rem] text-right leading-tight">
                  {disabledReason}
                </span>
              )}
            </div>
          );
        })()}
      </div>


      <div className="rounded-xl border border-border/50 bg-card/80 p-5 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            <h3 className="font-display text-sm font-bold tracking-tight">
              Rubric used for this entry
            </h3>
          </div>
          {preset ? (
            <span className="text-[10px] font-mono text-muted-foreground">
              preset{" "}
              <span className="text-foreground">{preset}</span>
              {version != null && (
                <>
                  {" · "}
                  v<span className="text-foreground">{version}</span>
                </>
              )}
              {row?.label && (
                <>
                  {" · "}
                  <span className="italic">{row.label}</span>
                </>
              )}
            </span>
          ) : null}
        </div>

        {!preset ? (
          <div className="flex items-start gap-2 rounded-md border border-border/30 bg-muted/20 p-3 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <p>
              This entry hasn't been scored yet, so no rubric version is attached.
              The judging system below explains how scoring will work once a
              judge runs evaluation.
            </p>
          </div>
        ) : loading ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-5/6" />
          </div>
        ) : error ? (
          <p className="text-xs font-mono text-destructive">
            Could not load rubric: {error}
          </p>
        ) : !row || dims.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            Rubric definition is empty or unavailable.
          </p>
        ) : (
          <div className="overflow-hidden rounded border border-border/20">
            <table className="w-full text-[11px] font-mono">
              <thead className="bg-muted/30 text-muted-foreground">
                <tr>
                  <th className="text-left px-2 py-1.5 font-semibold">Dimension</th>
                  <th className="text-left px-2 py-1.5 font-semibold">Key</th>
                  <th className="text-right px-2 py-1.5 font-semibold w-24">Weight</th>
                  {showPct && (
                    <th className="text-right px-2 py-1.5 font-semibold w-20">% of total</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {dims.map((d) => {
                  const w = typeof d.weight === "number" ? d.weight : null;
                  const pct =
                    showPct && w != null ? ((w / weightSum) * 100).toFixed(1) : null;
                  return (
                    <tr key={d.key} className="border-t border-border/10">
                      <td className="px-2 py-1.5 text-foreground">{d.label}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{d.key}</td>
                      <td className="px-2 py-1.5 text-right text-foreground">
                        {w != null ? w : <span className="text-muted-foreground">—</span>}
                      </td>
                      {showPct && (
                        <td className="px-2 py-1.5 text-right text-muted-foreground">
                          {pct != null ? `${pct}%` : "—"}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              {showPct && (
                <tfoot className="bg-muted/20 text-muted-foreground">
                  <tr className="border-t border-border/20">
                    <td className="px-2 py-1.5" colSpan={2}>
                      Total
                    </td>
                    <td className="px-2 py-1.5 text-right text-foreground">{weightSum}</td>
                    <td className="px-2 py-1.5 text-right text-foreground">100%</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {row && (
          <p className="text-[10px] font-mono text-muted-foreground">
            Rubric version locked at scoring time on{" "}
            {new Date(row.created_at).toLocaleDateString()}.
          </p>
        )}
      </div>

      <JudgingAuditTimeline entryId={entryId} preset={preset} version={version} />

      <JudgingTransparency />
    </div>
  );
}
