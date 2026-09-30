import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { announce } from "@/lib/a11y/announce";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExternalLink, Save, Send, Crown, CheckCircle2, Users, Gauge, MessageSquareWarning, List, AlertCircle, RefreshCw, ScrollText, ShieldCheck } from "lucide-react";
import { UnifiedScorecard } from "@/components/scoring/UnifiedScorecard";
import ProofVerificationSection from "@/components/evidence/ProofVerificationSection";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { readScorecardResult, type ScorecardSource } from "@/lib/entryScorecard";

const sourceBadgeMeta: Record<
  ScorecardSource,
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  finalized: { label: "Finalized", variant: "default" },
  panel_consensus: { label: "Panel consensus", variant: "secondary" },
  grading_reports_avg: { label: "Grading reports", variant: "outline" },
  none: { label: "None", variant: "outline" },
};

function ScorecardProvenanceBadge({ source }: { source: ScorecardSource | null }) {
  const { label, variant } = sourceBadgeMeta[source ?? "none"];
  return (
    <Badge variant={variant} className="text-[10px] capitalize">
      {label}
    </Badge>
  );
}

import { logAuditEvent } from "@/lib/audit";
import { sanitizeErrorForAudit } from "@/lib/auditSanitize";

import { useAuth } from "@/hooks/useAuth";
import { useRubricForEntry } from "@/hooks/useRubric";
import { useFinalizeEntry } from "@/hooks/useFinalizeEntry";
import { useJudgePanelComments } from "@/hooks/useJudgePanelComments";
import { toast } from "sonner";
import { PanelDiscussion } from "./PanelDiscussion";
import { WeightBreakdown } from "./WeightBreakdown";
import { BlockingThreadsDrawer } from "./BlockingThreadsDrawer";
import { COIAttestationGate } from "./COIAttestationGate";
import { LeadChecklistCard } from "./LeadChecklistCard";
import { RecusalManager } from "./RecusalManager";
import { StabilityMeter } from "./StabilityMeter";
import { ForceBreakdownCard } from "./ForceBreakdownCard";
import { EntryAiActivityLog } from "./EntryAiActivityLog";
import { ScorecardTransparencyPanel } from "./ScorecardTransparencyPanel";
import { BlindedScreenplayPreview } from "./BlindedScreenplayPreview";

interface EntryDetail {
  id: string;
  title: string | null;
  // Identity fields are NOT projected by v_judge_entry_blind — the view
  // strips them server-side. Left in the type as `null` so downstream code
  // that references them keeps compiling, but they are always null now.
  writer_name: null;
  author: null;
  page_count: number | null;
  genre: string | null;
  external_script_url: null;
  pdf_url: null;
  status: string;
  competition_id: string | null;
}


interface PanelRow {
  user_id: string;
  display: string;
  is_self: boolean;
  submitted: boolean;
  total: number | null;
  dimension_scores: Record<string, number>;
  reasoning: string | null;
  updated_at: string;
}

interface Props {
  entryId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  canFinalize?: boolean;
  blind?: boolean;
}

export function EntryScorecard({ entryId, open, onOpenChange, canFinalize, blind }: Props) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { rubric } = useRubricForEntry(entryId);
  const { finalize, pending: finalizing } = useFinalizeEntry();
  const [entry, setEntry] = useState<EntryDetail | null>(null);
  const { comments: panelComments } = useJudgePanelComments(entryId, entry?.competition_id ?? null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [autosaveState, setAutosaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastAutosavedAt, setLastAutosavedAt] = useState<Date | null>(null);
  const hydratedRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef(false);
  const entryRetryRef = useRef<HTMLButtonElement | null>(null);
  const scorecardRetryRef = useRef<HTMLButtonElement | null>(null);
  const prevEntryErrorRef = useRef<string | null>(null);
  const prevScorecardErrorRef = useRef<string | null>(null);
  const scorecardErrorRenderedLoggedRef = useRef(false);
  // Tracks the entryId whose data currently populates entry/panel/scorecard
  // state. When the user switches entries we keep the previous entry's UI
  // visible (no loading skeleton, no cleared error) until the new reads
  // actually complete — this prevents flicker when an in-flight request is
  // aborted by a rapid selection change.
  const loadedEntryIdRef = useRef<string | null>(null);
  const loadedScorecardEntryIdRef = useRef<string | null>(null);

  const [panelRows, setPanelRows] = useState<PanelRow[]>([]);
  const [finalMedian, setFinalMedian] = useState<number | null>(null);
  const [scorecardSource, setScorecardSource] = useState<ScorecardSource | null>(null);
  const [scorecardLoading, setScorecardLoading] = useState(false);
  const [scorecardError, setScorecardError] = useState<string | null>(null);

  const [entryLoading, setEntryLoading] = useState(false);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [unresolvedThreads, setUnresolvedThreads] = useState(0);
  const [unresolvedByDim, setUnresolvedByDim] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<string>("score");
  const [focusDim, setFocusDim] = useState<string | null>(null);
  const [blockingOpen, setBlockingOpen] = useState(false);
  const [focusCommentId, setFocusCommentId] = useState<string | null>(null);

  const jumpToDimension = (key: string) => {
    setFocusDim(key);
    setActiveTab("panel");
    setTimeout(() => setFocusDim(null), 3000);
  };

  const handleJumpToComment = (commentId: string, dimensionKey: string | null) => {
    setFocusCommentId(commentId);
    setActiveTab("panel");
    setFocusDim(dimensionKey === null ? "__general__" : dimensionKey);
    setTimeout(() => setFocusCommentId(null), 3000);
  };

  // Load entry
  const loadEntry = async (signal?: AbortSignal) => {
    if (!entryId) return;
    const targetEntryId = entryId;
    // Only surface loading/clear-error UI when we have no prior data to
    // display. If we're switching from a previously loaded entry, keep the
    // old header visible until the new fetch resolves — otherwise a
    // canceled request flashes a skeleton for one paint before the new
    // data arrives.
    const hasPriorData = loadedEntryIdRef.current !== null;
    if (!hasPriorData) {
      setEntryLoading(true);
      setEntryError(null);
    }
    let q: any = supabase
      .from("v_judge_entry_blind")
      .select("id,title,page_count,genre,status,competition_id")
      .eq("id", targetEntryId)
      .maybeSingle();
    if (signal && typeof q.abortSignal === "function") q = q.abortSignal(signal);
    const { data, error } = await q;
    // Aborted / superseded: leave prior UI intact. A newer loadEntry call
    // (or the unmount) owns the state now.
    if (signal?.aborted) return;
    if (error) {
      const msg = (error as { message?: string }).message ?? "";
      if (/abort/i.test(msg)) return;
      setEntry(null);
      setEntryError(msg || "Failed to load entry");
      loadedEntryIdRef.current = null;
    } else {
      // Coerce to EntryDetail — identity columns are absent from the view
      // and typed as `null` in the interface.
      setEntry(data ? ({ ...data, writer_name: null, author: null, external_script_url: null, pdf_url: null } as EntryDetail) : null);

      setEntryError(null);
      loadedEntryIdRef.current = targetEntryId;
    }
    setEntryLoading(false);
  };

  useEffect(() => {
    if (!entryId || !open) return;
    const ctrl = new AbortController();
    loadEntry(ctrl.signal);
    return () => { ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, open]);

  // Move keyboard focus to the Retry control when a load error first appears,
  // so screen-reader / keyboard users land on the recovery action instead of
  // needing to hunt for it after the aria-live announcement.
  useEffect(() => {
    if (entryError && prevEntryErrorRef.current !== entryError) {
      entryRetryRef.current?.focus();
    }
    prevEntryErrorRef.current = entryError;
  }, [entryError]);

  useEffect(() => {
    if (scorecardError && prevScorecardErrorRef.current !== scorecardError) {
      scorecardRetryRef.current?.focus();
    }
    prevScorecardErrorRef.current = scorecardError;
  }, [scorecardError]);

  // Log the first time a scorecard read error is rendered so operators can
  // detect failures before a user ever clicks retry. Reset when the error
  // clears or the entry changes so a new failure on the same entry is logged.
  useEffect(() => {
    if (!scorecardError || !entryId) {
      scorecardErrorRenderedLoggedRef.current = false;
      return;
    }
    if (scorecardErrorRenderedLoggedRef.current) return;
    scorecardErrorRenderedLoggedRef.current = true;
    const safeErr = sanitizeErrorForAudit(scorecardError);
    const role = canFinalize ? "lead_judge" : "judge";
    void logAuditEvent({
      action: "scorecard.read_error_rendered",
      target: { internal_id: entryId },
      details: {
        role,
        error_message: safeErr.message,
        ...(safeErr.code ? { error_code: safeErr.code } : {}),
        competition_id: entry?.competition_id ?? null,
      },
    });
  }, [scorecardError, entryId, canFinalize, entry?.competition_id]);




  const loadPanel = async (signal?: AbortSignal) => {
    if (!entryId || !userId) return;
    const targetEntryId = entryId;
    const myModel = `judge:${userId}`;
    // Skip the loading/error reset when we already have data from a prior
    // entry — we want that UI to remain visible until the new reads finish
    // (or the new call is itself aborted, in which case yet another call
    // owns state). This eliminates the skeleton/error flicker that used to
    // appear for a single paint whenever entryId changed rapidly.
    const hasPriorScorecardData = loadedScorecardEntryIdRef.current !== null;
    if (!hasPriorScorecardData) {
      setScorecardLoading(true);
      setScorecardError(null);
    }
    // Remember the error state we're about to clear so we can emit a
    // one-shot "recovered" audit event if this load succeeds.
    const errorBeforeLoad = scorecardError;
    let rowsQ: any = supabase
      .from("judge_consensus")
      .select("model_id,dimension_scores,reasoning,is_outlier,total_score,created_at")
      .eq("entry_id", targetEntryId)
      .like("model_id", "judge:%");
    if (signal && typeof rowsQ.abortSignal === "function") rowsQ = rowsQ.abortSignal(signal);
    const [{ data: rows, error: rowsError }, scResult] = await Promise.all([
      rowsQ,
      readScorecardResult(targetEntryId, signal),
    ]);
    // Aborted or superseded: leave prior UI intact.
    if (signal?.aborted || scResult.aborted) return;
    if (scResult.error) {
      setScorecardError(scResult.error);
      setFinalMedian(null);
      setScorecardSource(null);
      loadedScorecardEntryIdRef.current = null;
    } else {
      setScorecardError(null);
      setFinalMedian(scResult.scorecard?.total_score ?? null);
      setScorecardSource(scResult.scorecard?.source ?? null);
      loadedScorecardEntryIdRef.current = targetEntryId;
      // Transition: previously errored → now loaded. Emit a governance
      // event so operators can pair each read_error_retry with its outcome.
      if (errorBeforeLoad) {
        const safePrev = sanitizeErrorForAudit(errorBeforeLoad);
        const role = canFinalize ? "lead_judge" : "judge";
        void logAuditEvent({
          action: "scorecard.read_recovered",
          target: { internal_id: targetEntryId },
          details: {
            role,
            previous_error_message: safePrev.message,
            ...(safePrev.code ? { previous_error_code: safePrev.code } : {}),
            source: scResult.scorecard?.source ?? "none",
            total_score: scResult.scorecard?.total_score ?? null,
            competition_id: entry?.competition_id ?? null,
          },
        });
      }
    }
    setScorecardLoading(false);

    if (rowsError) {
      const msg = (rowsError as { message?: string }).message ?? "";
      if (/abort/i.test(msg)) return;
      // Non-fatal — panel view will show empty state.
      console.warn("[EntryScorecard] panel rows load failed", msg);
    }

    const judgeRows = (rows ?? []) as Array<{
      model_id: string;
      dimension_scores: Record<string, number> | null;
      reasoning: string | null;
      is_outlier: boolean;
      total_score: number | null;
      created_at: string;
    }>;

    const ids = judgeRows.map((r) => r.model_id.replace(/^judge:/, ""));
    const profileMap = new Map<string, { display_name: string | null; pen_name: string | null }>();
    if (ids.length) {
      let profQ: any = supabase
        .from("profiles")
        .select("user_id,display_name,pen_name")
        .in("user_id", ids);
      if (signal && typeof profQ.abortSignal === "function") profQ = profQ.abortSignal(signal);
      const { data: profiles } = await profQ;
      if (signal?.aborted) return;
      (profiles ?? []).forEach((p: { user_id: string; display_name: string | null; pen_name: string | null }) =>
        profileMap.set(p.user_id, { display_name: p.display_name, pen_name: p.pen_name }),
      );
    }

    const built: PanelRow[] = judgeRows.map((r) => {
      const uid = r.model_id.replace(/^judge:/, "");
      const prof = profileMap.get(uid);
      const isSelf = uid === userId;
      return {
        user_id: uid,
        display: isSelf
          ? "You"
          : prof?.display_name || prof?.pen_name || `Judge ${uid.slice(0, 6)}`,
        is_self: isSelf,
        submitted: !r.is_outlier,
        total: r.total_score ?? null,
        dimension_scores: (r.dimension_scores ?? {}) as Record<string, number>,
        reasoning: r.reasoning,
        updated_at: r.created_at,
      };
    });
    built.sort((a, b) => (a.is_self ? -1 : b.is_self ? 1 : a.display.localeCompare(b.display)));
    if (signal?.aborted) return;
    setPanelRows(built);

    const mine = judgeRows.find((r) => r.model_id === myModel);
    if (mine?.dimension_scores) {
      setScores(mine.dimension_scores);
      setNotes(mine.reasoning ?? "");
      setSubmitted(!mine.is_outlier);
      if (!mine.is_outlier) setLastAutosavedAt(new Date(mine.created_at));
    }
    // mark hydrated on next tick so the autosave effect doesn't fire from this hydration
    setTimeout(() => { hydratedRef.current = true; }, 0);
  };

  // Initial load + realtime subscription for collaboration
  useEffect(() => {
    if (!entryId || !userId || !open) return;
    hydratedRef.current = false;
    setAutosaveState("idle");
    const ctrl = new AbortController();
    loadPanel(ctrl.signal);
    const ch = supabase
      .channel(`judge_panel:${entryId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "judge_consensus", filter: `entry_id=eq.${entryId}` },
        () => loadPanel(),
      )
      .subscribe();
    return () => {
      ctrl.abort();
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, userId, open]);

  // When the sheet closes, forget which entry we're displaying so the next
  // open shows a proper loading state instead of stale data from the last
  // session. (The anti-flicker "keep previous UI" behavior above is scoped
  // to in-session entry switches, not close→reopen.)
  useEffect(() => {
    if (!open) {
      loadedEntryIdRef.current = null;
      loadedScorecardEntryIdRef.current = null;
    }
  }, [open]);



  const setScore = (key: string, value: number) =>
    setScores((s) => ({ ...s, [key]: value }));

  const weightedTotal = useMemo(() => {
    let sum = 0;
    let weight = 0;
    for (const d of rubric.dimensions) {
      const v = scores[d.key];
      if (typeof v !== "number") continue;
      const w = d.weight ?? 1;
      sum += v * w;
      weight += w;
    }
    return weight > 0 ? +(sum / weight).toFixed(2) : 0;
  }, [scores, rubric.dimensions]);

  const save = async (markSubmitted: boolean) => {
    if (!entryId || !userId) return;
    setSaving(true);
    try {
      const myModel = `judge:${userId}`;
      const rollIndex = Math.abs(hashCode(userId)) % 1000;
      const payload = {
        entry_id: entryId,
        model_id: myModel,
        roll_index: rollIndex,
        temperature: 0,
        total_score: weightedTotal,
        dimension_scores: scores,
        reasoning: notes,
        is_outlier: !markSubmitted,
        is_stability_rerun: false,
        judging_tier: "standard" as const,
      };
      await supabase
        .from("judge_consensus")
        .delete()
        .eq("entry_id", entryId)
        .eq("model_id", myModel);
      const { error } = await supabase.from("judge_consensus").insert([payload]);
      if (error) toast.error("Could not save scorecard", { description: error.message });
      else {
        toast.success(markSubmitted ? "Score submitted" : "Draft saved");
        setSubmitted(markSubmitted);
      }
    } finally {
      setSaving(false);
    }
  };

  // Autosave draft on score/notes change (debounced 1.2s).
  // Skip while a submitted score exists (we don't want autosave to revert "submitted" → "draft").
  useEffect(() => {
    if (!open || !entryId || !userId) return;
    if (!hydratedRef.current) return;
    if (submitted) return;
    if (Object.keys(scores).length === 0 && !notes) return;

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      if (inflightRef.current) return;
      inflightRef.current = true;
      setAutosaveState("saving");
      try {
        const myModel = `judge:${userId}`;
        const rollIndex = Math.abs(hashCode(userId)) % 1000;
        const payload = {
          entry_id: entryId,
          model_id: myModel,
          roll_index: rollIndex,
          temperature: 0,
          total_score: weightedTotal,
          dimension_scores: scores,
          reasoning: notes,
          is_outlier: true, // draft
          is_stability_rerun: false,
          judging_tier: "standard" as const,
        };
        await supabase
          .from("judge_consensus")
          .delete()
          .eq("entry_id", entryId)
          .eq("model_id", myModel);
        const { error } = await supabase.from("judge_consensus").insert([payload]);
        if (error) {
          setAutosaveState("error");
        } else {
          setAutosaveState("saved");
          setLastAutosavedAt(new Date());
        }
      } finally {
        inflightRef.current = false;
      }
    }, 1200);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores, notes, open, entryId, userId, submitted, weightedTotal]);


  const handleFinalize = async () => {
    if (!entryId) return;
    const res = await finalize(entryId);
    if (res) onOpenChange(false);
  };

  // Judges never see the raw script URL or writer identity — those fields
  // are stripped from v_judge_entry_blind server-side.
  const scriptUrl: string | null = null;
  const displayWriter = "— blind review —";

  const submittedCount = panelRows.filter((r) => r.submitted).length;

  // Radix wires the sheet title and description to the dialog automatically.
  // Keep a stable id only for the focusable scorecard landmark and announce
  // open/close transitions so screen readers know the sheet moved.
  const mainId = useId();
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true;
      announce(
        `Judges scorecard opened for ${entry?.title || "entry"}.`,
      );
    } else if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
      announce("Judges scorecard closed.");
    }
  }, [open, entry?.title]);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full sm:max-w-3xl overflow-y-auto bg-background border-border/60"
        onOpenAutoFocus={(event) => {
          // Radix default focuses the close (X) button; keep keyboard users
          // on the content instead by focusing the landmark region.
          const main = document.getElementById(mainId);
          if (!main) return;
          event.preventDefault();
          main.focus({ preventScroll: false });
        }}
      >
        {/* Skip link — visually hidden until focused; lets keyboard users
            jump over the header directly to the scorecard body. */}
        <a
          href={`#${mainId}`}
          onClick={(e) => {
            e.preventDefault();
            const el = document.getElementById(mainId);
            if (el) {
              el.focus();
              el.scrollIntoView({ block: "start" });
            }
          }}
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:border focus:border-primary/40 focus:bg-background focus:px-3 focus:py-1.5 focus:text-xs focus:font-mono focus:uppercase focus:tracking-wider focus:text-primary focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Skip to scorecard content
        </a>
        <SheetHeader>
          {entryLoading && !entry ? (
            <>
              <SheetTitle className="sr-only">Loading scorecard</SheetTitle>
              <SheetDescription className="sr-only">Loading entry details.</SheetDescription>
              <Skeleton aria-hidden="true" className="h-8 w-2/3" />
              <Skeleton aria-hidden="true" className="h-3 w-1/2 mt-2" />
            </>
          ) : (
            <>
              <SheetTitle className="font-display text-2xl">{entry?.title || "Untitled"}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2 text-xs font-mono uppercase tracking-wider">
                <span>{displayWriter}</span>
                {entry?.page_count && <span>· {entry.page_count} pages</span>}
                {entry?.genre && <span>· {entry.genre}</span>}
                {entry?.status && (
                  <Badge variant="outline" className="ml-2 text-[10px]">{entry.status}</Badge>
                )}
              </SheetDescription>
            </>
          )}
        </SheetHeader>
        <div
          id={mainId}
          tabIndex={-1}
          aria-label={`Scorecard content for ${entry?.title || "entry"}`}
          className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >

        {entryError && (
          <div
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            className="mt-3 border border-destructive/40 bg-destructive/10 rounded-md p-3 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2 text-xs text-destructive-foreground/90">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <span>Could not load entry: {entryError}</span>
            </div>
            <Button
              ref={entryRetryRef}
              size="sm"
              variant="outline"
              onClick={() => loadEntry()}
              aria-label={`Retry loading entry (previous error: ${entryError})`}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Retry
            </Button>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
          {scriptUrl && (
            <a
              href={scriptUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open script
            </a>
          )}
          <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-3">
            <span><Users className="inline h-3 w-3 mr-1" />{panelRows.length} on panel · {submittedCount} submitted</span>
            {/* aria-live wrapper announces scorecard status transitions
                (loading → error → finalized/empty) without moving focus. */}
            <span
              role="status"
              aria-live={scorecardError ? "assertive" : "polite"}
              aria-atomic="true"
            >
              {scorecardLoading ? (
                <>
                  <Skeleton className="h-4 w-24 inline-block" aria-hidden="true" />
                  <span className="sr-only">Loading scorecard…</span>
                </>
              ) : scorecardError ? (
                <button
                  ref={scorecardRetryRef}
                  type="button"
                  onClick={async () => {
                    // Governance: capture that a judge/lead had to manually recover
                    // from a canonical scorecard read failure. internal_id = entryId
                    // (the record being scored); role reflects the panel authority
                    // held by the current user in this scorecard context.
                    const role = canFinalize ? "lead_judge" : "judge";
                    const safeErr = sanitizeErrorForAudit(scorecardError);
                    void logAuditEvent({
                      action: "scorecard.read_error_retry",
                      target: { internal_id: entryId },
                      details: {
                        role,
                        error_message: safeErr.message,
                        ...(safeErr.code ? { error_code: safeErr.code } : {}),
                        competition_id: entry?.competition_id ?? null,
                      },
                    });

                    await loadPanel();
                  }}
                  className="inline-flex items-center gap-1 text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive rounded-sm"
                  title={scorecardError}
                  aria-label={`Scorecard unavailable: ${scorecardError}. Activate to retry.`}
                >
                  <AlertCircle className="h-3 w-3" aria-hidden="true" /> Scorecard unavailable · retry
                </button>
              ) : finalMedian != null ? (
                scorecardSource === "finalized" ? (
                  <span><Gauge className="inline h-3 w-3 mr-1" aria-hidden="true" />Finalized {finalMedian.toFixed(2)}</span>
                ) : (
                  <span><Gauge className="inline h-3 w-3 mr-1" aria-hidden="true" />Total {finalMedian.toFixed(2)}</span>
                )
              ) : scorecardSource === null ? (
                <span className="text-muted-foreground/70">
                  <Gauge className="inline h-3 w-3 mr-1" aria-hidden="true" />No scorecard found
                </span>
              ) : (
                <span className="text-muted-foreground/70">
                  <Gauge className="inline h-3 w-3 mr-1" aria-hidden="true" />No consensus yet
                </span>
              )}
            </span>
            {!scorecardLoading && !scorecardError && (
              <span data-testid="scorecard-provenance-badge">
                <ScorecardProvenanceBadge source={scorecardSource} />
              </span>
            )}
          </div>
        </div>


        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
          <TabsList
            aria-label="Scorecard sections"
            className="bg-background/40 border border-border/40"
          >
            <TabsTrigger value="score" aria-label="My scorecard">
              My Scorecard
            </TabsTrigger>
            <TabsTrigger
              value="panel"
              aria-label={
                `Panel · ${panelRows.length} judge${panelRows.length === 1 ? "" : "s"}` +
                (unresolvedThreads > 0
                  ? `, ${unresolvedThreads} unresolved comment${unresolvedThreads === 1 ? "" : "s"}`
                  : "")
              }
            >
              <Users className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Panel · {panelRows.length}
              {unresolvedThreads > 0 && (
                <Badge
                  variant="outline"
                  aria-hidden="true"
                  className="ml-1.5 bg-amber-500/10 border-amber-500/30 text-amber-300 text-[9px] font-mono px-1.5 py-0"
                >
                  {unresolvedThreads}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="transparency"
              aria-label="Transparency: unified total and scoring provenance"
            >
              <Gauge className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Transparency
            </TabsTrigger>
            <TabsTrigger value="reviews" aria-label="Structured reviews and canonical scorecard">
              <ScrollText className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Reviews
            </TabsTrigger>
            <TabsTrigger
              value="script"
              aria-label="Blinded screenplay preview with author metadata stripped"
            >
              <ShieldCheck className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Script (blinded)
            </TabsTrigger>
          </TabsList>



          <TabsContent value="score" className="mt-4 space-y-5">
            {canFinalize && entry?.competition_id && (
              <LeadChecklistCard entryId={entryId!} canEdit={!!canFinalize} />
            )}
            {entryId && (
              <RecusalManager
                entryId={entryId}
                competitionId={entry?.competition_id ?? null}
                canEdit={!!canFinalize}
              />
            )}


            <COIAttestationGate entryId={entryId!}>
            <div className="flex items-center justify-between border border-border/40 rounded-md p-3 bg-background/40">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Rubric</div>
                <div className="text-sm">{rubric.label}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Your weighted total</div>
                <div className="text-2xl font-display text-gradient-gold">{weightedTotal.toFixed(2)}</div>
              </div>
            </div>

            {unresolvedThreads > 0 && (
              <div className="border border-amber-500/30 bg-amber-500/5 rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-amber-300 text-xs font-mono uppercase tracking-wider">
                    <MessageSquareWarning className="h-3.5 w-3.5" />
                    {unresolvedThreads} unresolved thread{unresolvedThreads === 1 ? "" : "s"} blocking finalize
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-amber-200 hover:text-amber-100"
                    onClick={() => setBlockingOpen(true)}
                  >
                    <List className="h-3 w-3 mr-1" />
                    View blocking threads
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(unresolvedByDim).map(([key, count]) => {
                    const label =
                      key === "__general__"
                        ? "General"
                        : rubric.dimensions.find((d) => d.key === key)?.label || key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => jumpToDimension(key)}
                        className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-amber-500/40 text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
                        title="Jump to panel discussion"
                      >
                        {label}
                        <span className="text-amber-300/80">· {count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-4">
              {rubric.dimensions.map((d) => {
                const v = scores[d.key] ?? 0;
                const dimUnresolved = unresolvedByDim[d.key] ?? 0;
                return (
                  <div
                    key={d.key}
                    className={
                      dimUnresolved > 0
                        ? "rounded-md border border-amber-500/30 bg-amber-500/5 p-2 -mx-2"
                        : undefined
                    }
                  >
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="flex items-center gap-2">
                        {d.label}
                        {dimUnresolved > 0 && (
                          <button
                            type="button"
                            onClick={() => jumpToDimension(d.key)}
                            className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-300 bg-amber-500/10 hover:bg-amber-500/20"
                            title={`${dimUnresolved} unresolved comment${dimUnresolved === 1 ? "" : "s"} — click to review`}
                          >
                            <MessageSquareWarning className="h-2.5 w-2.5" />
                            {dimUnresolved} unresolved
                          </button>
                        )}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">{v.toFixed(1)} / 10</span>
                    </div>
                    <Slider min={0} max={10} step={0.5} value={[v]} onValueChange={(vals) => setScore(d.key, vals[0])} />
                  </div>
                );
              })}
            </div>

            <WeightBreakdown
              dimensions={rubric.dimensions}
              scores={scores}
              total={weightedTotal}
            />

            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
                Notes (visible to other judges & leads)
              </div>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={4000} />
            </div>

            <Separator className="bg-border/40" />

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              {submitted ? (
                <span className="inline-flex items-center gap-1 text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" /> You submitted
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Draft mode
                  {!submitted && (
                    <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/80">
                      {autosaveState === "saving" && "· autosaving…"}
                      {autosaveState === "saved" && lastAutosavedAt &&
                        `· autosaved ${lastAutosavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                      {autosaveState === "error" && (
                        <span className="text-amber-400">· autosave failed</span>
                      )}
                    </span>
                  )}
                </span>
              )}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={saving} onClick={() => save(false)}>
                  <Save className="h-3.5 w-3.5 mr-1.5" /> Save draft
                </Button>
                <Button size="sm" disabled={saving} onClick={() => save(true)} className="bg-gold-gradient">
                  <Send className="h-3.5 w-3.5 mr-1.5" /> Submit
                </Button>
                {canFinalize && (
                  <Button
                    size="sm"
                    disabled={finalizing === entryId || submittedCount < 1 || unresolvedThreads > 0}
                    onClick={handleFinalize}
                    title={
                      unresolvedThreads > 0
                        ? `Resolve ${unresolvedThreads} panel thread${unresolvedThreads === 1 ? "" : "s"} first`
                        : undefined
                    }
                  >
                    <Crown className="h-3.5 w-3.5 mr-1.5" />
                    {finalizing === entryId
                      ? "Finalizing…"
                      : unresolvedThreads > 0
                        ? `Finalize (${unresolvedThreads} unresolved)`
                        : "Finalize"}
                  </Button>
                )}
              </div>
            </div>
            </COIAttestationGate>
          </TabsContent>


          <TabsContent value="panel" className="mt-4">
            <StabilityMeter
              rows={panelRows}
              dimensions={rubric.dimensions.map((d) => ({ key: d.key, label: d.label }))}
            />
            <ForceBreakdownCard
              rows={panelRows}
              dimensions={rubric.dimensions.map((d) => ({ key: d.key, label: d.label, weight: (d as any).weight }))}
            />
            <EntryAiActivityLog entryId={entryId} />
            <PanelView rows={panelRows} dimensions={rubric.dimensions.map((d) => ({ key: d.key, label: d.label }))} />
            {entryId && (
              <PanelDiscussion
                entryId={entryId}
                competitionId={entry?.competition_id ?? null}
                dimensions={rubric.dimensions.map((d) => ({ key: d.key, label: d.label }))}
                onUnresolvedChange={setUnresolvedThreads}
                onUnresolvedBreakdownChange={setUnresolvedByDim}
                focusDimension={focusDim}
                focusCommentId={focusCommentId}
              />
            )}
          </TabsContent>

          <TabsContent
            value="transparency"
            className="mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-md"
            aria-label="Transparency: unified total, provenance, and per-dimension breakdown"
          >
            <ScorecardTransparencyPanel entryId={entryId} paused={activeTab !== "transparency"} />
          </TabsContent>

          <TabsContent
            value="reviews"
            className="mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-md"
            aria-label="Structured reviews merged with canonical scorecard"
          >
            {entryId && (
              <div className="space-y-4">
                <ProofVerificationSection entryId={entryId} />
                <UnifiedScorecard entryId={entryId} />
              </div>
            )}
          </TabsContent>

          <TabsContent
            value="script"
            className="mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-md"
            aria-label="Blinded screenplay preview"
          >
            <BlindedScreenplayPreview entryId={entryId} />
          </TabsContent>

        </Tabs>
        </div>
      </SheetContent>
    </Sheet>
    <BlockingThreadsDrawer
      open={blockingOpen}
      onOpenChange={setBlockingOpen}
      comments={panelComments}
      dimensions={rubric.dimensions.map((d) => ({ key: d.key, label: d.label }))}
      onJump={handleJumpToComment}
    />
  </>
  );
}

function PanelView({
  rows,
  dimensions,
}: {
  rows: PanelRow[];
  dimensions: { key: string; label: string }[];
}) {
  if (rows.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-8">
        No judges have started scoring yet. Be the first.
      </div>
    );
  }

  const median = (arr: number[]) => {
    if (arr.length === 0) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : +((s[m - 1] + s[m]) / 2).toFixed(2);
  };

  return (
    <div className="border border-border/40 rounded-md overflow-hidden">
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-background/60 text-[10px] font-mono uppercase tracking-wider text-muted-foreground sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 text-left">Judge</th>
              {dimensions.map((d) => (
                <th key={d.key} className="px-2 py-2 text-center">{d.label}</th>
              ))}
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id} className={`border-t border-border/30 ${r.is_self ? "bg-primary/5" : ""}`}>
                <td className="px-3 py-2 font-body">
                  <div className="flex items-center gap-1.5">
                    {r.display}
                    {r.is_self && <Badge variant="outline" className="text-[9px] font-mono">you</Badge>}
                  </div>
                </td>
                {dimensions.map((d) => {
                  const v = r.dimension_scores[d.key];
                  return (
                    <td key={d.key} className="px-2 py-2 text-center font-mono text-xs">
                      {typeof v === "number" ? v.toFixed(1) : <span className="text-muted-foreground">—</span>}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right font-mono text-sm">
                  {r.total != null ? r.total.toFixed(2) : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {r.submitted ? (
                    <Badge variant="outline" className="bg-emerald-500/10 border-emerald-500/30 text-emerald-300 text-[10px]">
                      submitted
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">draft</Badge>
                  )}
                </td>
              </tr>
            ))}
            <tr className="border-t border-border/50 bg-background/60">
              <td className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Panel median</td>
              {dimensions.map((d) => {
                const vals = rows
                  .map((r) => r.dimension_scores[d.key])
                  .filter((v): v is number => typeof v === "number");
                const m = median(vals);
                return (
                  <td key={d.key} className="px-2 py-2 text-center font-mono text-xs text-primary">
                    {m != null ? m.toFixed(1) : "—"}
                  </td>
                );
              })}
              <td className="px-3 py-2 text-right font-mono text-sm text-gradient-gold">
                {(() => {
                  const m = median(rows.map((r) => r.total ?? NaN).filter((v) => Number.isFinite(v)));
                  return m != null ? m.toFixed(2) : "—";
                })()}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {rows.some((r) => r.reasoning) && (
        <div className="border-t border-border/40 p-3 space-y-2 bg-background/30">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Judge notes</div>
          {rows.filter((r) => r.reasoning).map((r) => (
            <div key={r.user_id} className="text-xs">
              <span className="font-mono text-muted-foreground mr-2">{r.display}:</span>
              <span className="text-foreground/90">{r.reasoning}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
