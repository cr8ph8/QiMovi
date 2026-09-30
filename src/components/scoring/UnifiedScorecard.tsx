import { useScorecard, type ScorecardBundle } from "@/hooks/useScorecard";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Gauge, Users, FileText, ScrollText, AlertTriangle, RefreshCw, Loader2 } from "lucide-react";
import { useState } from "react";

/**
 * Canonical scorecard renderer. Every surface (Insights, Leaderboard,
 * Judges Console) MUST render entry scores through this component so
 * totals, dimensions, and qualitative reviews stay structurally identical.
 *
 * Backed by `useScorecard(entryId)` which merges `v_entry_scorecard`
 * with `structured_reviews`. Includes shared skeleton and retry/error
 * handling so all three surfaces get consistent loading and failure UX.
 */

const DIM_LABEL: Record<string, string> = {
  originality: "Originality",
  structure: "Structure",
  character_depth: "Character",
  dialogue: "Dialogue",
  theme: "Theme",
  emotion: "Emotion",
  format_adherence: "Format",
  market: "Market",
  visual: "Visual",
  narrative: "Narrative",
  character_score: "Character",
  emotional: "Emotional",
  franchise: "Franchise",
  production: "Production",
  audience: "Audience",
};

const SOURCE_LABEL: Record<string, string> = {
  finalized: "Finalized",
  panel_consensus: "Panel consensus",
  grading_reports_avg: "Reports avg",
  none: "No score yet",
};

interface Props {
  entryId: string | null | undefined;
  /** Optional pre-fetched bundle. When provided, `entryId` is ignored. */
  bundle?: ScorecardBundle | null;
  compact?: boolean;
}

function ScorecardSkeleton({ compact }: { compact?: boolean }) {
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-label="Loading scorecard">
      {/* Header row */}
      <Card className="p-4 bg-background/40 border-border/40 flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-20" />
        </div>
        <div className="space-y-1.5 text-right">
          <Skeleton className="h-3 w-24 ml-auto" />
          <Skeleton className="h-3 w-20 ml-auto" />
          <Skeleton className="h-3 w-16 ml-auto" />
        </div>
      </Card>
      {/* Dimensions grid */}
      <Card className="p-4 bg-background/30 border-border/40 space-y-3">
        <Skeleton className="h-3 w-20" />
        <div className={`grid gap-2 ${compact ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4"}`}>
          {Array.from({ length: compact ? 6 : 8 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </Card>
      {/* Review card */}
      <Card className="p-4 bg-background/30 border-border/40 space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-16 w-full" />
      </Card>
      <span className="sr-only">Loading entry scorecard…</span>
    </div>
  );
}

function ScorecardError({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <Card
      role="alert"
      className="p-4 bg-destructive/5 border-destructive/30 text-sm text-destructive space-y-3"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Failed to load scorecard</div>
          <div className="text-xs text-destructive/80 mt-0.5 break-words">{message}</div>
        </div>
      </div>
      {onRetry && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={onRetry}
            disabled={retrying}
            className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            {retrying ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Retrying…</>
            ) : (
              <><RefreshCw className="h-3.5 w-3.5" /> Retry</>
            )}
          </Button>
        </div>
      )}
    </Card>
  );
}

export function UnifiedScorecard({ entryId, bundle: preloaded, compact }: Props) {
  const skip = !!preloaded;
  const { bundle: fetched, loading, error, refresh } = useScorecard(skip ? null : entryId);
  const bundle = preloaded ?? fetched;
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    setRetrying(true);
    try {
      await refresh();
    } finally {
      setRetrying(false);
    }
  }

  if (!skip && loading && !bundle?.scorecard) {
    return <ScorecardSkeleton compact={compact} />;
  }
  if (error && !bundle?.scorecard) {
    return (
      <ScorecardError
        message={error}
        onRetry={skip ? undefined : handleRetry}
        retrying={retrying}
      />
    );
  }
  if (!bundle) {
    return (
      <Card className="p-4 bg-background/30 border-border/40 text-sm text-muted-foreground">
        No entry selected.
      </Card>
    );
  }


  const sc = bundle.scorecard;
  const source = sc?.source ?? "none";
  const dims = extractDimensions(bundle);

  return (
    <div className="space-y-4">
      {/* Header: canonical total + source */}
      <Card className="p-4 bg-background/40 border-border/40 flex items-center justify-between gap-4">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Gauge className="h-3 w-3" /> {SOURCE_LABEL[source]}
            {sc?.rubric_preset && (
              <Badge variant="outline" className="ml-1 text-[9px] font-mono">
                {sc.rubric_preset} v{sc.rubric_version ?? "?"}
              </Badge>
            )}
          </div>
          <div className="mt-1 font-display text-3xl text-gradient-gold">
            {sc?.total_score != null ? sc.total_score.toFixed(1) : "—"}
          </div>
        </div>
        <div className="text-right text-[11px] font-mono text-muted-foreground space-y-0.5">
          {sc?.judge_count != null && sc.judge_count > 0 && (
            <div className="flex items-center gap-1 justify-end">
              <Users className="h-3 w-3" /> {sc.judge_count} judge{sc.judge_count === 1 ? "" : "s"}
            </div>
          )}
          {sc?.grading_report_count != null && sc.grading_report_count > 0 && (
            <div className="flex items-center gap-1 justify-end">
              <FileText className="h-3 w-3" /> {sc.grading_report_count} report{sc.grading_report_count === 1 ? "" : "s"}
            </div>
          )}
          {bundle.reviews.length > 0 && (
            <div className="flex items-center gap-1 justify-end">
              <ScrollText className="h-3 w-3" /> {bundle.reviews.length} review{bundle.reviews.length === 1 ? "" : "s"}
            </div>
          )}
        </div>
      </Card>

      {/* Dimensions */}
      {dims.length > 0 && (
        <Card className="p-4 bg-background/30 border-border/40">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
            Dimensions
          </div>
          <div className={`grid gap-2 ${compact ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4"}`}>
            {dims.map(({ key, value }) => (
              <div
                key={key}
                className="flex items-center justify-between rounded-md border border-border/30 bg-background/40 px-2.5 py-1.5"
              >
                <span className="text-[11px] font-body text-muted-foreground truncate">
                  {DIM_LABEL[key] ?? key}
                </span>
                <span className="font-mono text-xs text-primary">
                  {value != null ? value.toFixed(1) : "—"}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Structured reviews */}
      {bundle.reviews.length > 0 && (
        <Card className="p-4 bg-background/30 border-border/40 space-y-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Structured reviews
          </div>
          <div className="space-y-3">
            {bundle.reviews.map((r) => (
              <div key={r.id} className="rounded-md border border-border/30 bg-background/40 p-3 space-y-2">
                <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  <span>Reviewer · {r.reviewer_id.slice(0, 8)}</span>
                  <span>{new Date(r.updated_at).toLocaleDateString()}</span>
                </div>
                {r.strengths && <ReviewField label="Strengths" body={r.strengths} tone="success" />}
                {r.concerns && <ReviewField label="Concerns" body={r.concerns} tone="warn" />}
                {r.narrative_observations && (
                  <ReviewField label="Narrative" body={r.narrative_observations} />
                )}
                {r.clarity_signals && <ReviewField label="Clarity" body={r.clarity_signals} />}
                {r.overall_notes && <ReviewField label="Overall" body={r.overall_notes} />}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function ReviewField({
  label,
  body,
  tone,
}: {
  label: string;
  body: string;
  tone?: "success" | "warn";
}) {
  const color =
    tone === "success"
      ? "text-emerald-400"
      : tone === "warn"
        ? "text-amber-400"
        : "text-muted-foreground";
  return (
    <div className="text-xs">
      <span className={`font-mono uppercase tracking-wider text-[10px] mr-2 ${color}`}>{label}</span>
      <span className="text-foreground/90 whitespace-pre-wrap">{body}</span>
    </div>
  );
}

function extractDimensions(bundle: ScorecardBundle): Array<{ key: string; value: number | null }> {
  const sc = bundle.scorecard;
  const keys = [
    "originality",
    "structure",
    "character_depth",
    "dialogue",
    "theme",
    "emotion",
    "format_adherence",
    "market",
    "visual",
    "narrative",
    "character_score",
    "emotional",
    "franchise",
    "production",
    "audience",
  ] as const;
  const finalized = bundle.breakdown.finalized ?? {};
  const panel = bundle.breakdown.panel?.averages ?? {};
  const reports = bundle.breakdown.reports?.averages ?? {};
  const out: Array<{ key: string; value: number | null }> = [];
  for (const k of keys) {
    const fromCard = sc ? (sc as any)[k] : null;
    const v =
      typeof fromCard === "number"
        ? fromCard
        : finalized[k] ?? panel[k] ?? reports[k] ?? null;
    if (v != null) out.push({ key: k, value: v });
  }
  return out;
}
