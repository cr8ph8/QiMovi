/**
 * CriterionDecompositionCard
 *
 * Shows the continuous per-criterion scores drawn from `judge_consensus`
 * (`expected_scores` + `score_distributions`) against the labels defined in
 * `rubric_versions`. This is the panel-level continuous decomposition — one
 * row per rubric criterion, not per judge.
 *
 * Data source: `loadRubricDecomposition` (shared with the evidence bundle).
 */
import { useEffect, useState } from "react";
import { Layers, Sigma, Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  loadRubricDecomposition,
  type RubricDecomposition,
} from "@/lib/consensus/loadDecomposition";

interface Props {
  entryId: string | null;
  paused?: boolean;
}

function fmt(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toFixed(digits);
}

/** Compact 10-tier PMF sparkline (score 1 → 10). */
function PmfBar({ pmf }: { pmf: number[] | null }) {
  if (!pmf || pmf.length === 0) {
    return <div className="h-4 w-24 rounded bg-muted/20" aria-hidden="true" />;
  }
  const max = Math.max(...pmf, 1e-6);
  return (
    <div
      className="flex items-end gap-[1px] h-4 w-24"
      role="img"
      aria-label={`Averaged score distribution over 10 tiers: ${pmf.map((p, i) => `${i + 1}=${(p * 100).toFixed(0)}%`).join(", ")}`}
    >
      {pmf.map((p, i) => (
        <div
          key={i}
          className="flex-1 bg-primary/70 rounded-t-[1px]"
          style={{ height: `${Math.max(6, (p / max) * 100)}%` }}
          title={`P(score=${i + 1}) ≈ ${(p * 100).toFixed(1)}%`}
        />
      ))}
    </div>
  );
}

export function CriterionDecompositionCard({ entryId, paused }: Props) {
  const [data, setData] = useState<RubricDecomposition | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entryId || paused) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadRubricDecomposition(entryId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error)?.message ?? "Failed to load decomposition");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entryId, paused]);

  if (!entryId) return null;

  return (
    <TooltipProvider delayDuration={150}>
      <section
        aria-label="Per-criterion continuous decomposition"
        className="rounded-md border border-border/40 bg-background/40 p-4 space-y-3"
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              <Layers className="h-3 w-3" aria-hidden="true" />
              Per-criterion continuous scores
              <Tooltip>
                <TooltipTrigger className="inline-flex items-center" aria-label="What is this?">
                  <Info className="h-3 w-3 text-muted-foreground/70" aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  Continuous logit-expectation of each rubric criterion, averaged
                  across non-outlier judges. Reads <code>expected_scores</code>{" "}
                  and <code>score_distributions</code> from{" "}
                  <code>judge_consensus</code> and criterion labels from{" "}
                  <code>rubric_versions</code>.
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {data?.rubric_label ?? data?.rubric_preset ?? "Rubric"}
              {data?.rubric_version != null && (
                <span className="ml-1">v{data.rubric_version}</span>
              )}
              {data && (
                <span className="ml-2 text-muted-foreground/70">
                  · {data.panel_size} judge{data.panel_size === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>
          {data?.weighted_total != null && (
            <div className="text-right">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Weighted (0–10)
              </div>
              <div className="text-lg font-mono text-foreground">{fmt(data.weighted_total, 2)}</div>
            </div>
          )}
        </div>

        {loading && !data && (
          <div className="space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-2/3" />
          </div>
        )}

        {error && (
          <div className="text-xs text-destructive-foreground/80" role="alert">
            Failed to load decomposition: {error}
          </div>
        )}

        {data && data.criteria.length === 0 && !loading && (
          <div className="text-xs text-muted-foreground">
            No rubric criteria defined for this entry yet.
          </div>
        )}

        {data && data.criteria.length > 0 && (
          <div className="overflow-x-auto -mx-2 px-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[9px] font-mono uppercase tracking-wider text-muted-foreground border-b border-border/30">
                  <th className="py-1 pr-2 font-normal">Criterion</th>
                  <th className="py-1 px-2 font-normal text-right">μ</th>
                  <th className="py-1 px-2 font-normal text-right">σ</th>
                  <th className="py-1 px-2 font-normal text-right">
                    <span className="inline-flex items-center gap-0.5"><Sigma className="h-2.5 w-2.5" /> H</span>
                  </th>
                  <th className="py-1 px-2 font-normal">Distribution (1→10)</th>
                  <th className="py-1 px-2 font-normal text-right">w</th>
                  <th className="py-1 px-2 font-normal text-right">n</th>
                  <th className="py-1 pl-2 font-normal">Method</th>
                </tr>
              </thead>
              <tbody>
                {data.criteria.map((c) => (
                  <tr key={c.key} className="border-b border-border/10 last:border-0">
                    <td className="py-1.5 pr-2 text-foreground">{c.label}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{fmt(c.expected_mean, 2)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">{fmt(c.expected_stddev, 2)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-muted-foreground" title="Average PMF entropy (bits)">
                      {fmt(c.entropy_avg, 2)}
                    </td>
                    <td className="py-1.5 px-2">
                      <PmfBar pmf={c.pmf_avg} />
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">{c.weight}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">{c.judge_count}</td>
                    <td className="py-1.5 pl-2">
                      {c.methods.length === 0 ? (
                        <span className="text-muted-foreground/70">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {c.methods.map((m) => (
                            <Badge key={m} variant="outline" className="text-[8px] font-mono">
                              {m}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </TooltipProvider>
  );
}
