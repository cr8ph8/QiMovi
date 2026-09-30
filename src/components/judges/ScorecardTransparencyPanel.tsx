/**
 * ScorecardTransparencyPanel
 *
 * Displays the canonical entry total alongside its provenance: which tier
 * of the grading precedence produced the number (finalized > panel consensus
 * > grading reports average), how many contributors backed it, which rubric
 * preset/version it was scored under, and the per-dimension breakdown.
 *
 * All numbers come from `v_entry_scorecard` via `readScorecardResult` so
 * this panel is guaranteed to show the same total as every other scorecard
 * surface (TrustReport, EntryScorecard, BatchResultsSummary, Leaderboard).
 */
import { useEffect, useState } from "react";
import { AlertCircle, ChevronDown, Gauge, Info, RefreshCw, ScrollText, Users, FileCheck2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  readScorecardResult,
  readScorecardBreakdown,
  type DimensionBreakdown,
  type EntryScorecard,
  type ScorecardSource,
} from "@/lib/entryScorecard";
import { CriterionDecompositionCard } from "./CriterionDecompositionCard";
import { PerJudgeDecompositionCard } from "./PerJudgeDecompositionCard";
import { DecompositionProvenanceCard } from "./DecompositionProvenanceCard";
import { RubricVersionCompareCard } from "./RubricVersionCompareCard";

interface Dimension {
  key: keyof EntryScorecard;
  label: string;
}

// Every dimension exposed by v_entry_scorecard, in a stable display order.
// Any rubric that doesn't populate a column simply omits it (null → "—").
const DIMENSIONS: Dimension[] = [
  { key: "originality", label: "Originality" },
  { key: "structure", label: "Structure" },
  { key: "character_depth", label: "Character depth" },
  { key: "character_score", label: "Character" },
  { key: "dialogue", label: "Dialogue" },
  { key: "theme", label: "Theme" },
  { key: "emotion", label: "Emotion" },
  { key: "emotional", label: "Emotional" },
  { key: "narrative", label: "Narrative" },
  { key: "format_adherence", label: "Format adherence" },
  { key: "market", label: "Market" },
  { key: "visual", label: "Visual" },
  { key: "franchise", label: "Franchise" },
  { key: "production", label: "Production" },
  { key: "audience", label: "Audience" },
];

const SOURCE_META: Record<
  ScorecardSource,
  { label: string; explain: string; tone: string }
> = {
  finalized: {
    label: "Finalized",
    explain:
      "Lead judge finalized this score. Overrides panel consensus and grading reports.",
    tone: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
  },
  panel_consensus: {
    label: "Panel consensus",
    explain:
      "Average of non-outlier judge scorecards. Used when no finalized score exists yet.",
    tone: "bg-primary/10 border-primary/30 text-primary",
  },
  grading_reports_avg: {
    label: "Grading reports (avg)",
    explain:
      "Averaged AI grading reports. Falls back here when neither a finalized score nor panel consensus is available.",
    tone: "bg-amber-500/10 border-amber-500/30 text-amber-300",
  },
  none: {
    label: "No score yet",
    explain: "This entry has no scorecard from any tier.",
    tone: "bg-muted/40 border-border/40 text-muted-foreground",
  },
};

function formatTotal(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}

function formatDim(v: number | null): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toFixed(1);
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

interface Props {
  entryId: string | null;
  /** When true, the panel skips the network read (useful in tabs that are lazy). */
  paused?: boolean;
  className?: string;
}

export function ScorecardTransparencyPanel({ entryId, paused, className }: Props) {
  const [scorecard, setScorecard] = useState<EntryScorecard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<DimensionBreakdown | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [openDim, setOpenDim] = useState<string | null>(null);

  const load = async () => {
    if (!entryId) return;
    setLoading(true);
    setError(null);
    const res = await readScorecardResult(entryId);
    if (res.error) {
      setError(res.error);
      setScorecard(null);
    } else {
      setScorecard(res.scorecard);
    }
    setLoading(false);
  };

  const ensureBreakdown = async () => {
    if (!entryId || breakdown || breakdownLoading) return;
    setBreakdownLoading(true);
    const b = await readScorecardBreakdown(entryId);
    setBreakdown(b);
    setBreakdownLoading(false);
  };

  useEffect(() => {
    if (!entryId || paused) return;
    load();
    setBreakdown(null);
    setOpenDim(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, paused]);

  if (!entryId) {
    return null;
  }

  // Only render rows for dimensions the current row actually populates,
  // so different rubrics don't leave a wall of "—" values.
  const populatedDims = DIMENSIONS.filter((d) => {
    const v = scorecard ? (scorecard[d.key] as number | null) : null;
    return v != null && Number.isFinite(Number(v));
  });

  const source: ScorecardSource = scorecard?.source ?? "none";
  const meta = SOURCE_META[source];

  return (
    <TooltipProvider delayDuration={150}>
      <section
        aria-label="Scorecard transparency"
        aria-busy={loading || undefined}
        className={
          "rounded-md border border-border/40 bg-background/40 p-4 space-y-4 " +
          (className ?? "")
        }
      >
        {/* Header: total + source */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-label={
              loading && !scorecard
                ? "Loading unified total"
                : `Unified total: ${
                    scorecard?.total_score == null
                      ? "no score yet"
                      : `${formatTotal(scorecard.total_score)} out of 100`
                  }`
            }
          >
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              <Gauge className="h-3 w-3" aria-hidden="true" /> Unified total
              <Tooltip>
                <TooltipTrigger className="inline-flex items-center" aria-label="What is the unified total?">
                  <Info className="h-3 w-3 text-muted-foreground/70" aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  Single canonical total for this entry, read from
                  <code className="mx-1 font-mono">v_entry_scorecard</code>.
                  Every surface (TrustReport, judges console, batch summary,
                  leaderboard) displays this same number.
                </TooltipContent>
              </Tooltip>
            </div>
            {loading && !scorecard ? (
              <>
                <Skeleton className="h-9 w-24 mt-1" aria-hidden="true" />
                <span className="sr-only">Loading scorecard…</span>
              </>
            ) : (
              <div className="text-3xl font-display text-gradient-gold leading-none mt-1" aria-hidden="true">
                {formatTotal(scorecard?.total_score ?? null)}
              </div>
            )}
          </div>


          <div className="text-right space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Provenance
            </div>
            {loading && !scorecard ? (
              <Skeleton className="h-5 w-32 ml-auto" />
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className={`text-[10px] ${meta.tone}`}>
                    {meta.label}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  {meta.explain}
                </TooltipContent>
              </Tooltip>
            )}
            <div className="text-[10px] font-mono text-muted-foreground/80">
              Updated {formatTimestamp(scorecard?.updated_at ?? null)}
            </div>
          </div>
        </div>

        {/* Inline explanation of provenance precedence and blind review / disclosure. */}
        <div className="rounded-md border border-border/40 bg-background/60 p-3 text-xs">
          <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
            <Info className="h-3 w-3" aria-hidden="true" />
            How this total is chosen
          </div>
          <p className="text-muted-foreground mb-2">
            The total score is drawn from the highest available tier. This order
            determines what is visible during blind review and what is ultimately
            disclosed.
          </p>
          <ul className="space-y-1">
            <li className={source === "finalized" ? "text-foreground" : "text-muted-foreground"}>
              <span className="font-medium">Finalized</span> — a lead judge confirmed the score.
              This is the official, disclosed result and overrides every blind tier.
            </li>
            <li className={source === "panel_consensus" ? "text-foreground" : "text-muted-foreground"}>
              <span className="font-medium">Panel consensus</span> — average of non-outlier judge
              scorecards. Judge identities are masked to entrants during blind review.
            </li>
            <li className={source === "grading_reports_avg" ? "text-foreground" : "text-muted-foreground"}>
              <span className="font-medium">Grading reports</span> — average of AI reports. No
              human judge attribution; used only as a fully blind fallback.
            </li>
            <li className={source === "none" ? "text-foreground" : "text-muted-foreground"}>
              <span className="font-medium">No score yet</span> — no scorecard exists, so nothing is
              disclosed.
            </li>
          </ul>
        </div>

        {/* Error / empty */}
        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="border border-destructive/40 bg-destructive/10 rounded-md p-3 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2 text-xs text-destructive-foreground/90">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              Scorecard read failed: {error}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={load}
              aria-label="Retry loading the scorecard"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Retry
            </Button>
          </div>
        )}

        {!loading && !error && (!scorecard || scorecard.total_score == null) && (
          <div className="border border-border/40 rounded-md p-3 text-xs text-muted-foreground text-center">
            No consensus yet — no finalized score, no non-outlier panel scorecards,
            and no grading reports for this entry.
          </div>
        )}

        {/* Contributor / rubric stats */}
        {(scorecard || loading) && (
          <>
            <Separator className="bg-border/40" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <ProvenanceStat
                icon={FileCheck2}
                label="Judges (finalized)"
                value={loading ? null : scorecard?.judge_count}
              />
              <ProvenanceStat
                icon={Users}
                label="Panel models"
                value={loading ? null : scorecard?.panel_model_count}
              />
              <ProvenanceStat
                icon={ScrollText}
                label="Grading reports"
                value={loading ? null : scorecard?.grading_report_count}
              />
              <ProvenanceStat
                icon={Info}
                label="Rubric"
                value={
                  loading
                    ? null
                    : scorecard?.rubric_preset
                      ? `${scorecard.rubric_preset}${
                          scorecard.rubric_version != null
                            ? ` v${scorecard.rubric_version}`
                            : ""
                        }`
                      : "—"
                }
              />
            </div>
            {source === "finalized" && scorecard?.finalized_model_id && (
              <div className="text-[10px] font-mono text-muted-foreground/80">
                Finalized by <span className="text-foreground/80">{scorecard.finalized_model_id}</span>
              </div>
            )}
          </>
        )}

        {/* Dimension breakdown */}
        {(scorecard || loading) && (
          <>
            <Separator className="bg-border/40" />
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                Dimension breakdown
              </div>
              {loading && !scorecard ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : populatedDims.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  The winning tier ({meta.label.toLowerCase()}) did not populate any per-dimension values.
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="text-[10px] text-muted-foreground/80 mb-1">
                    Click a dimension to see which tier(s) contributed a value and why the winning number was chosen.
                  </div>
                  {populatedDims.map((d) => {
                    const dimKey = d.key as string;
                    const winnerVal = scorecard?.[d.key] as number | null;
                    const isOpen = openDim === dimKey;
                    return (
                      <Collapsible
                        key={dimKey}
                        open={isOpen}
                        onOpenChange={(o) => {
                          setOpenDim(o ? dimKey : null);
                          if (o) void ensureBreakdown();
                        }}
                      >
                        <CollapsibleTrigger
                          className="w-full flex items-center justify-between text-xs border-b border-border/20 py-1.5 hover:bg-background/60 rounded-sm px-1 -mx-1 transition-colors"
                          aria-label={`Drill into ${d.label}`}
                        >
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <ChevronDown
                              className={`h-3 w-3 transition-transform ${isOpen ? "rotate-0" : "-rotate-90"}`}
                              aria-hidden="true"
                            />
                            {d.label}
                          </span>
                          <span className="flex items-center gap-2">
                            <Badge variant="outline" className={`text-[9px] ${meta.tone}`}>
                              {meta.label}
                            </Badge>
                            <span className="font-mono text-foreground">
                              {formatDim(winnerVal)}
                            </span>
                          </span>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <DimensionDrilldown
                            dimKey={dimKey}
                            dimLabel={d.label}
                            winningSource={source}
                            winningValue={winnerVal}
                            breakdown={breakdown}
                            loading={breakdownLoading}
                          />
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* Continuous per-criterion decomposition (rubric_versions × judge_consensus). */}
        <CriterionDecompositionCard entryId={entryId} paused={paused} />

        {/* Per-judge decomposition: how each judge contributes to μ, σ, and H̄. */}
        <PerJudgeDecompositionCard entryId={entryId} paused={paused} />

        {/* Provenance: which rubric_versions row, PMF aggregation, logprob_source per criterion. */}
        <DecompositionProvenanceCard entryId={entryId} paused={paused} />

        {/* Compare criterion decompositions across rubric_versions for the same preset. */}
        <RubricVersionCompareCard entryId={entryId} paused={paused} />
      </section>
    </TooltipProvider>
  );
}

function ProvenanceStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string | null | undefined;
}) {
  return (
    <div className="rounded-md border border-border/30 bg-background/60 p-2">
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-1 text-sm font-mono">
        {value == null || value === "" ? (
          <Skeleton className="h-4 w-10" />
        ) : (
          <span>{value}</span>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Per-dimension drill-down: shows which source tier(s) had a value for this
// dimension, which one was chosen by the precedence rule, and why the
// subordinate tiers did NOT contribute to the displayed number.
// -----------------------------------------------------------------------------

const TIER_ORDER: Array<{ id: "finalized" | "panel" | "reports"; label: string; source: ScorecardSource }> = [
  { id: "finalized", label: "Finalized score",      source: "finalized" },
  { id: "panel",     label: "Panel consensus",      source: "panel_consensus" },
  { id: "reports",   label: "Grading reports (avg)", source: "grading_reports_avg" },
];

function DimensionDrilldown({
  dimKey,
  dimLabel,
  winningSource,
  winningValue,
  breakdown,
  loading,
}: {
  dimKey: string;
  dimLabel: string;
  winningSource: ScorecardSource;
  winningValue: number | null;
  breakdown: DimensionBreakdown | null;
  loading: boolean;
}) {
  if (loading && !breakdown) {
    return (
      <div className="px-2 py-2 space-y-1.5 bg-background/30 border-l-2 border-primary/30 ml-1">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    );
  }

  // Read this dimension's value from each tier, if present.
  const tierValues: Record<"finalized" | "panel" | "reports", { value: number | null; contributors: number | null }> = {
    finalized: {
      value: breakdown?.finalized?.[dimKey] ?? null,
      contributors: breakdown?.finalized?.[dimKey] != null ? 1 : null,
    },
    panel: {
      value: breakdown?.panel?.averages[dimKey] ?? null,
      contributors: breakdown?.panel?.averages[dimKey] != null ? breakdown?.panel?.contributors ?? null : null,
    },
    reports: {
      value: breakdown?.reports?.averages[dimKey] ?? null,
      contributors: breakdown?.reports?.averages[dimKey] != null ? breakdown?.reports?.contributors ?? null : null,
    },
  };

  const tiersWithData = TIER_ORDER.filter((t) => tierValues[t.id].value != null);
  const winningTier = TIER_ORDER.find((t) => t.source === winningSource);
  const higherTiersMissing = winningTier
    ? TIER_ORDER.slice(0, TIER_ORDER.findIndex((t) => t.id === winningTier.id))
        .filter((t) => tierValues[t.id].value == null)
    : [];

  const precedenceSentence = (() => {
    if (winningSource === "none") {
      return "No tier has data for this entry, so no value can be shown.";
    }
    if (!winningTier) return "";
    if (higherTiersMissing.length === 0 && winningTier.id === "finalized") {
      return `Finalized scores override every other tier, so ${dimLabel.toLowerCase()} is taken from the finalized row.`;
    }
    if (higherTiersMissing.length === 0) {
      return `${winningTier.label} is the highest-priority tier available for this entry, so ${dimLabel.toLowerCase()} is taken from it.`;
    }
    const missingLabels = higherTiersMissing.map((t) => t.label.toLowerCase()).join(" and ");
    return `No ${missingLabels} available — the precedence rule falls through to ${winningTier.label.toLowerCase()}, so ${dimLabel.toLowerCase()} is taken from it.`;
  })();

  return (
    <div className="px-2 py-2 space-y-2 bg-background/30 border-l-2 border-primary/30 ml-1 rounded-r-sm">
      {tiersWithData.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">
          No tier reported a value for {dimLabel.toLowerCase()}.
        </div>
      ) : (
        <div className="space-y-1">
          {TIER_ORDER.map((t) => {
            const tv = tierValues[t.id];
            const isWinner = t.source === winningSource && tv.value != null;
            const missing = tv.value == null;
            return (
              <div
                key={t.id}
                className={`flex items-center justify-between text-[11px] px-1.5 py-1 rounded ${
                  isWinner ? "bg-primary/10 border border-primary/30" : "border border-transparent"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                    missing ? "bg-muted-foreground/30" : isWinner ? "bg-primary" : "bg-muted-foreground/60"
                  }`} />
                  <span className={missing ? "text-muted-foreground/60" : "text-foreground/90"}>
                    {t.label}
                  </span>
                  {isWinner && (
                    <Badge variant="outline" className="text-[9px] border-primary/40 text-primary">
                      contributed
                    </Badge>
                  )}
                  {tv.contributors != null && tv.contributors > 1 && (
                    <span className="text-[10px] font-mono text-muted-foreground">
                      · avg of {tv.contributors}
                    </span>
                  )}
                </span>
                <span className={`font-mono ${missing ? "text-muted-foreground/50" : "text-foreground"}`}>
                  {missing ? "no data" : Number(tv.value).toFixed(1)}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        {precedenceSentence}
        {winningValue != null && winningTier && tierValues[winningTier.id].value != null &&
          Math.abs(Number(tierValues[winningTier.id].value) - Number(winningValue)) > 0.05 && (
          <>
            {" "}
            <span className="text-amber-500/90">
              Note: displayed value ({Number(winningValue).toFixed(1)}) differs slightly
              from the recomputed tier average — the view uses the stored canonical row.
            </span>
          </>
        )}
      </p>
    </div>
  );
}
