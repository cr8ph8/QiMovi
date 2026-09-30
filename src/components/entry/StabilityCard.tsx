/**
 * StabilityCard — displays stability metrics for an entry's evaluation history.
 * Reads canonical grading_reports and evaluation_runs, computes stability in-browser.
 */
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  computeEntryStability,
  overallStabilityScore,
  type StabilityResult,
  type EntryStabilityInput,
} from "@/lib/stability";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Activity, TrendingDown, TrendingUp, Minus, ShieldCheck } from "lucide-react";

const METRIC_LABELS: Record<string, string> = {
  scoring_drift: "Scoring Drift",
  evaluation_consistency: "Eval Consistency",
  narrative_stability: "Narrative Stability",
  confidence_volatility: "Confidence Volatility",
};

const statusIcon = (label: StabilityResult["metric_label"]) => {
  if (label === "stable") return <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />;
  if (label === "moderate drift") return <Minus className="h-3.5 w-3.5 text-amber-500" />;
  return <TrendingDown className="h-3.5 w-3.5 text-destructive" />;
};

const statusBadgeClass = (label: StabilityResult["metric_label"]) => {
  if (label === "stable") return "bg-emerald-500/10 text-emerald-500 border-emerald-500/30";
  if (label === "moderate drift") return "bg-amber-500/10 text-amber-500 border-amber-500/30";
  return "bg-destructive/10 text-destructive border-destructive/30";
};

export default function StabilityCard({ entryId }: { entryId: string }) {
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<StabilityResult[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [{ data: reports }, { data: runs }] = await Promise.all([
        // eslint-disable-next-line no-restricted-syntax -- stability/drift computation, not display total
        supabase
          .from("grading_reports")
          .select("total_score, model_id, created_at, originality, structure, character_depth, dialogue, theme, emotion, format_adherence")


          .eq("entry_id", entryId)
          .order("created_at", { ascending: true }),
        supabase
          .from("evaluation_runs")
          .select("quotient_scores_json")
          .eq("entry_id", entryId)
          .order("created_at", { ascending: true }),
      ]);

      const input: EntryStabilityInput = {
        gradingReports: (reports || []) as any,
        quotientRuns: (runs || []).map((r: any) => {
          const q = typeof r.quotient_scores_json === "string"
            ? JSON.parse(r.quotient_scores_json)
            : r.quotient_scores_json || {};
          return q;
        }),
      };

      setResults(computeEntryStability(input));
      setLoading(false);
    }
    load();
  }, [entryId]);

  const overall = useMemo(() => overallStabilityScore(results), [results]);
  const hasData = overall.confidence > 0;

  if (loading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/80 p-4">
        <Skeleton className="h-5 w-40 mb-3" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="text-sm font-display font-semibold">Evaluation Stability</span>
        </div>
        {hasData && (
          <Badge variant="outline" className={`text-[10px] font-mono ${statusBadgeClass(overall.label)}`}>
            {overall.score}% — {overall.label}
          </Badge>
        )}
      </div>

      {!hasData ? (
        <p className="text-xs text-muted-foreground">
          Stability metrics require multiple evaluation runs. Run additional grading passes to see drift analysis.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {results.filter((r) => r.confidence > 0).map((r) => (
            <Tooltip key={r.metric_name}>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/30 bg-muted/20 cursor-default">
                  {statusIcon(r.metric_label)}
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-mono text-muted-foreground truncate">
                      {METRIC_LABELS[r.metric_name] || r.metric_name}
                    </p>
                    <p className="text-xs font-display font-bold">{r.metric_value}%</p>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs max-w-48">
                <p className="font-semibold">{r.metric_label}</p>
                <p className="text-muted-foreground">
                  Confidence: {Math.round(r.confidence * 100)}% · Source: {r.source_context}
                </p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}
