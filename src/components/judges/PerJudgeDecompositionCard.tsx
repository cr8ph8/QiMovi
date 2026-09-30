/**
 * PerJudgeDecompositionCard
 *
 * Breaks the panel-level consensus (μ, σ, H̄) apart into per-judge
 * contributions, one collapsible section per rubric criterion:
 *
 *   • μ  = Σ  x_i / N        → each judge contributes x_i / N
 *   • σ² = Σ (x_i − μ)² / N  → each judge contributes (x_i − μ)² / N
 *   • H̄ = Σ  H_i / N         → each judge contributes H_i / N
 *
 * H_i is the judge's own PMF entropy over the 10 score tiers when
 * `score_distributions` is available, otherwise falls back to the row-level
 * `entropy_avg` recorded on `judge_consensus`.
 *
 * Data source: `loadRubricDecomposition` (extended with per-judge shares).
 */
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Users,
  Sigma,
  Info,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  loadRubricDecomposition,
  type RubricDecomposition,
  type CriterionDecomposition,
} from "@/lib/consensus/loadDecomposition";

interface Props {
  entryId: string | null;
  paused?: boolean;
}

function fmt(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toFixed(digits);
}

/** Short judge label from a model id like "google/gemini-2.5-pro". */
function shortJudge(id: string): string {
  const tail = id.split("/").pop() ?? id;
  return tail.length > 22 ? tail.slice(0, 21) + "…" : tail;
}

/** Compact 10-tier PMF sparkline (score 1 → 10). */
function PmfBar({ pmf }: { pmf: number[] | null }) {
  if (!pmf || pmf.length === 0) {
    return <div className="h-3 w-16 rounded bg-muted/20" aria-hidden="true" />;
  }
  const max = Math.max(...pmf, 1e-6);
  return (
    <div
      className="flex items-end gap-[1px] h-3 w-16"
      role="img"
      aria-label={`Score distribution: ${pmf
        .map((p, i) => `${i + 1}=${(p * 100).toFixed(0)}%`)
        .join(", ")}`}
    >
      {pmf.map((p, i) => (
        <div
          key={i}
          className="flex-1 bg-primary/60 rounded-t-[1px]"
          style={{ height: `${Math.max(6, (p / max) * 100)}%` }}
          title={`P(score=${i + 1}) ≈ ${(p * 100).toFixed(1)}%`}
        />
      ))}
    </div>
  );
}

/** Horizontal contribution bar. `signed` colors negative deviations. */
function ShareBar({
  value,
  max,
  signed = false,
}: {
  value: number;
  max: number;
  signed?: boolean;
}) {
  const denom = max > 0 ? max : 1;
  const pct = Math.min(100, Math.max(2, (Math.abs(value) / denom) * 100));
  const negative = signed && value < 0;
  return (
    <div className="h-1.5 w-16 rounded-full bg-muted/40 overflow-hidden">
      <div
        className={cn(
          "h-full",
          negative ? "bg-amber-500/70" : "bg-primary/70",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function CriterionSection({
  criterion,
  defaultOpen,
}: {
  criterion: CriterionDecomposition;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const totals = useMemo(() => {
    const muSum = criterion.judges.reduce((a, j) => a + j.mu_contribution, 0);
    const varSum = criterion.judges.reduce((a, j) => a + j.var_contribution, 0);
    const hSum = criterion.judges.reduce((a, j) => a + j.entropy_contribution, 0);
    const muMax = Math.max(...criterion.judges.map((j) => Math.abs(j.mu_contribution)), 1e-6);
    const varMax = Math.max(...criterion.judges.map((j) => j.var_contribution), 1e-6);
    const hMax = Math.max(...criterion.judges.map((j) => j.entropy_contribution), 1e-6);
    const devMax = Math.max(
      ...criterion.judges.map((j) =>
        j.expected != null && criterion.expected_mean != null
          ? Math.abs(j.expected - criterion.expected_mean)
          : 0,
      ),
      1e-6,
    );
    return { muSum, varSum, hSum, muMax, varMax, hMax, devMax };
  }, [criterion]);

  const derivedSigma = Math.sqrt(totals.varSum);

  return (
    <div className="rounded-md border border-border/40 bg-background/40">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/20 transition-colors"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
          )}
          <span className="text-xs font-medium text-foreground truncate">
            {criterion.label}
          </span>
          <Badge variant="outline" className="text-[8px] font-mono">
            w {criterion.weight}
          </Badge>
          <Badge variant="outline" className="text-[8px] font-mono">
            n {criterion.judge_count}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground shrink-0">
          <span>μ <span className="text-foreground">{fmt(criterion.expected_mean, 2)}</span></span>
          <span>σ <span className="text-foreground">{fmt(criterion.expected_stddev, 2)}</span></span>
          <span className="inline-flex items-center gap-0.5">
            <Sigma className="h-2.5 w-2.5" /> H{" "}
            <span className="text-foreground">{fmt(criterion.entropy_avg, 2)}</span>
          </span>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2">
          {criterion.judges.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">
              No active judge contributions.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto -mx-1 px-1">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[9px] font-mono uppercase tracking-wider text-muted-foreground border-b border-border/30">
                      <th className="py-1 pr-2 font-normal">Judge</th>
                      <th className="py-1 px-2 font-normal text-right">x_i</th>
                      <th className="py-1 px-2 font-normal text-right" title="x_i − μ">Δμ</th>
                      <th className="py-1 px-2 font-normal">Share of μ</th>
                      <th className="py-1 px-2 font-normal">Share of σ²</th>
                      <th className="py-1 px-2 font-normal">Share of H̄</th>
                      <th className="py-1 px-2 font-normal">PMF</th>
                      <th className="py-1 pl-2 font-normal">Method</th>
                    </tr>
                  </thead>
                  <tbody>
                    {criterion.judges
                      .slice()
                      .sort((a, b) => b.var_contribution - a.var_contribution)
                      .map((j) => {
                        const dev =
                          j.expected != null && criterion.expected_mean != null
                            ? j.expected - criterion.expected_mean
                            : null;
                        return (
                          <tr
                            key={j.model_id}
                            className="border-b border-border/10 last:border-0 align-middle"
                          >
                            <td className="py-1.5 pr-2 text-foreground truncate max-w-[160px]" title={j.model_id}>
                              {shortJudge(j.model_id)}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono">
                              {fmt(j.expected, 2)}
                            </td>
                            <td
                              className={cn(
                                "py-1.5 px-2 text-right font-mono",
                                dev == null
                                  ? "text-muted-foreground"
                                  : dev < 0
                                    ? "text-amber-400"
                                    : "text-emerald-400",
                              )}
                            >
                              {dev == null ? "—" : (dev >= 0 ? "+" : "") + dev.toFixed(2)}
                            </td>
                            <td className="py-1.5 px-2">
                              <div className="flex items-center gap-1.5">
                                <ShareBar value={j.mu_contribution} max={totals.muMax} />
                                <span className="text-[9px] font-mono text-muted-foreground w-10 text-right">
                                  {fmt(j.mu_contribution, 2)}
                                </span>
                              </div>
                            </td>
                            <td className="py-1.5 px-2">
                              <div className="flex items-center gap-1.5">
                                <ShareBar value={j.var_contribution} max={totals.varMax} />
                                <span className="text-[9px] font-mono text-muted-foreground w-10 text-right">
                                  {fmt(j.var_contribution, 3)}
                                </span>
                              </div>
                            </td>
                            <td className="py-1.5 px-2">
                              <div className="flex items-center gap-1.5">
                                <ShareBar value={j.entropy_contribution} max={totals.hMax} />
                                <span className="text-[9px] font-mono text-muted-foreground w-10 text-right">
                                  {fmt(j.entropy_contribution, 2)}
                                </span>
                              </div>
                            </td>
                            <td className="py-1.5 px-2">
                              <PmfBar pmf={j.pmf} />
                            </td>
                            <td className="py-1.5 pl-2">
                              {j.method ? (
                                <Badge variant="outline" className="text-[8px] font-mono">
                                  {j.method}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground/60">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                  <tfoot>
                    <tr className="text-[9px] font-mono text-muted-foreground border-t border-border/30">
                      <td className="py-1 pr-2 uppercase">Sum</td>
                      <td className="py-1 px-2 text-right">—</td>
                      <td className="py-1 px-2 text-right">—</td>
                      <td className="py-1 px-2 text-right text-foreground">
                        μ = {fmt(totals.muSum, 2)}
                      </td>
                      <td className="py-1 px-2 text-right text-foreground">
                        σ² = {fmt(totals.varSum, 3)} · σ = {fmt(derivedSigma, 2)}
                      </td>
                      <td className="py-1 px-2 text-right text-foreground">
                        H̄ = {fmt(totals.hSum, 2)}
                      </td>
                      <td className="py-1 px-2" colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function PerJudgeDecompositionCard({ entryId, paused }: Props) {
  const [data, setData] = useState<RubricDecomposition | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandAll, setExpandAll] = useState(false);

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
        if (!cancelled)
          setError((e as Error)?.message ?? "Failed to load decomposition");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entryId, paused]);

  if (!entryId) return null;

  const active = data?.criteria ?? [];
  const hasJudges = active.some((c) => c.judges.length > 0);

  return (
    <TooltipProvider delayDuration={150}>
      <section
        aria-label="Per-judge decomposition of consensus"
        className="rounded-md border border-border/40 bg-background/40 p-4 space-y-3"
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              <Users className="h-3 w-3" aria-hidden="true" />
              Per-judge contributions to μ, σ, H̄
              <Tooltip>
                <TooltipTrigger className="inline-flex items-center" aria-label="What is this?">
                  <Info className="h-3 w-3 text-muted-foreground/70" aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  For each rubric criterion, each active judge contributes{" "}
                  <code>x_i/N</code> to the consensus mean μ,{" "}
                  <code>(x_i−μ)²/N</code> to the variance σ², and{" "}
                  <code>H_i/N</code> to the average PMF entropy H̄. Rows are
                  sorted by variance contribution — the judges most responsible
                  for spread appear first.
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
          {active.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px]"
              onClick={() => setExpandAll((v) => !v)}
            >
              {expandAll ? "Collapse all" : "Expand all"}
            </Button>
          )}
        </div>

        {loading && !data && (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        )}

        {error && (
          <div className="text-xs text-destructive-foreground/80" role="alert">
            Failed to load decomposition: {error}
          </div>
        )}

        {data && active.length === 0 && !loading && (
          <div className="text-xs text-muted-foreground">
            No rubric criteria defined for this entry yet.
          </div>
        )}

        {data && active.length > 0 && !hasJudges && (
          <div className="text-xs text-muted-foreground">
            No active judge contributions to decompose yet.
          </div>
        )}

        {data && hasJudges && (
          <div className="space-y-2">
            {active.map((c, i) => (
              <CriterionSection
                key={c.key}
                criterion={c}
                defaultOpen={expandAll || i === 0}
              />
            ))}
          </div>
        )}
      </section>
    </TooltipProvider>
  );
}
