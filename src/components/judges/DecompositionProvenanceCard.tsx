/**
 * DecompositionProvenanceCard
 *
 * Explicit provenance panel for the per-criterion decomposition:
 *   • Which `rubric_versions` row (preset, version, label, created_at) supplied
 *     the criterion labels and weights.
 *   • How the per-criterion PMF was aggregated across judges.
 *   • Which `logprob_source` methods each criterion drew from and whether
 *     `expected_scores` (continuous) or `dimension_scores` (discrete fallback)
 *     provided x_i for that judge/criterion.
 */
import { useEffect, useState } from "react";
import { ScrollText, Database, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

const VALUE_SOURCE_LABEL: Record<string, string> = {
  expected_scores: "expected_scores (continuous)",
  dimension_scores: "dimension_scores (discrete)",
};

export function DecompositionProvenanceCard({ entryId, paused }: Props) {
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
        if (!cancelled) setError((e as Error)?.message ?? "Failed to load provenance");
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
        aria-label="Decomposition provenance"
        className="rounded-md border border-border/40 bg-background/40 p-4 space-y-3"
      >
        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          <ScrollText className="h-3 w-3" aria-hidden="true" />
          Decomposition provenance
          <Tooltip>
            <TooltipTrigger className="inline-flex items-center" aria-label="What is this?">
              <Info className="h-3 w-3 text-muted-foreground/70" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              Records the exact <code>rubric_versions</code> row that supplied
              criterion labels and weights, the PMF aggregation formula, and
              the <code>logprob_source</code> / value-source used per criterion.
            </TooltipContent>
          </Tooltip>
        </div>

        {loading && !data && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {error && (
          <div className="text-xs text-destructive-foreground/80" role="alert">
            {error}
          </div>
        )}

        {data && (
          <div className="space-y-3">
            {/* Rubric identity */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
              <div>
                <div className="text-[9px] uppercase text-muted-foreground">Preset</div>
                <div className="text-foreground truncate" title={data.rubric_preset ?? ""}>
                  {data.rubric_preset ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase text-muted-foreground">Version</div>
                <div className="text-foreground">
                  {data.rubric_version != null ? `v${data.rubric_version}` : "—"}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase text-muted-foreground">Label</div>
                <div className="text-foreground truncate" title={data.rubric_label ?? ""}>
                  {data.rubric_label ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase text-muted-foreground">Created</div>
                <div className="text-foreground">{fmtDate(data.rubric_created_at)}</div>
              </div>
            </div>

            {data.rubric_version_id && (
              <div className="text-[10px] font-mono text-muted-foreground flex items-center gap-1.5">
                <Database className="h-2.5 w-2.5" />
                rubric_versions.id ·{" "}
                <span className="text-foreground/80">{data.rubric_version_id}</span>
              </div>
            )}

            {/* PMF aggregation */}
            <div className="rounded border border-border/30 bg-muted/10 p-2">
              <div className="text-[9px] font-mono uppercase text-muted-foreground mb-1">
                PMF aggregation
              </div>
              <div className="text-[11px] text-foreground/90 leading-snug">
                {data.pmf_aggregation}
              </div>
              <div className="mt-1 text-[10px] font-mono text-muted-foreground">
                Panel size · {data.panel_size} · Weighted total ={" "}
                {data.weighted_total != null ? data.weighted_total.toFixed(2) : "—"} (Σw·μ / Σw)
              </div>
            </div>

            {/* Per-criterion provenance */}
            {data.criteria.length > 0 && (
              <div className="overflow-x-auto -mx-2 px-2">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[9px] font-mono uppercase tracking-wider text-muted-foreground border-b border-border/30">
                      <th className="py-1 pr-2 font-normal">Criterion</th>
                      <th className="py-1 px-2 font-normal text-right">n</th>
                      <th className="py-1 px-2 font-normal text-right" title="Judges with valid 10-tier PMF">PMF n</th>
                      <th className="py-1 px-2 font-normal">Value source</th>
                      <th className="py-1 pl-2 font-normal">logprob_source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.criteria.map((c) => (
                      <tr key={c.key} className="border-b border-border/10 last:border-0">
                        <td className="py-1.5 pr-2 text-foreground">
                          {c.label}
                          <span className="ml-1 text-muted-foreground/60 font-mono text-[9px]">
                            ({c.key})
                          </span>
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">
                          {c.judge_count}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">
                          {c.pmf_source_count}
                        </td>
                        <td className="py-1.5 px-2">
                          {c.value_sources.length === 0 ? (
                            <span className="text-muted-foreground/60">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {c.value_sources.map((v) => (
                                <Badge
                                  key={v}
                                  variant="outline"
                                  className="text-[8px] font-mono"
                                  title={VALUE_SOURCE_LABEL[v]}
                                >
                                  {v === "expected_scores" ? "continuous" : "discrete"}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-1.5 pl-2">
                          {c.methods.length === 0 ? (
                            <span className="text-muted-foreground/60">—</span>
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

            <div className="text-[9px] font-mono text-muted-foreground/70">
              Generated {new Date(data.generated_at).toISOString().replace("T", " ").slice(0, 19)}Z
              · from <code>judge_consensus</code> ×{" "}
              <code>rubric_versions</code>
            </div>
          </div>
        )}
      </section>
    </TooltipProvider>
  );
}
