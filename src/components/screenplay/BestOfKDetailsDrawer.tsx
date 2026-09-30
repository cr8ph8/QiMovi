import { useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Trophy, Sigma, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RankingResult } from "@/lib/ranking/bestOfK";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ranking: RankingResult | null;
  /** Label for each caller-side variant index (matches ranking.ranking[].index). */
  variantLabel: (variantIndex: number) => string;
}

function prefColor(p: number): string {
  if (p >= 0.75) return "bg-emerald-500/25 text-emerald-300";
  if (p >= 0.55) return "bg-emerald-500/10 text-emerald-400/90";
  if (p <= 0.25) return "bg-red-500/25 text-red-300";
  if (p <= 0.45) return "bg-red-500/10 text-red-400/90";
  return "bg-muted/40 text-muted-foreground";
}

export default function BestOfKDetailsDrawer({
  open,
  onOpenChange,
  ranking,
  variantLabel,
}: Props) {
  const details = useMemo(() => {
    if (!ranking) return null;
    const P = ranking.preferenceMatrix;
    const C = ranking.countsMatrix ?? [];
    const K = P.length;
    const matrixVariantIndices = ranking.matrixVariantIndices ?? P.map((_, i) => i);
    // Label per matrix row/col (server order).
    const labels = matrixVariantIndices.map((v) => variantLabel(v));

    // Pairwise verifier rows (unordered i<j).
    const pairs: Array<{
      i: number;
      j: number;
      labelA: string;
      labelB: string;
      pAB: number;
      pBA: number;
      count: number;
      winsA: number;
      winsB: number;
    }> = [];
    for (let i = 0; i < K; i++) {
      for (let j = i + 1; j < K; j++) {
        const pAB = P[i][j];
        const pBA = P[j][i];
        const count = C[i]?.[j] ?? 0;
        pairs.push({
          i,
          j,
          labelA: labels[i],
          labelB: labels[j],
          pAB,
          pBA,
          count,
          winsA: pAB * count,
          winsB: pBA * count,
        });
      }
    }
    // Most decisive first (largest |p - 0.5|), then by count.
    pairs.sort(
      (a, b) =>
        Math.abs(b.pAB - 0.5) - Math.abs(a.pAB - 0.5) || b.count - a.count,
    );
    return { P, C, K, labels, pairs };
  }, [ranking, variantLabel]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 font-mono text-sm">
            <Trophy className="h-4 w-4 text-primary" />
            Best-of-K ranking details
          </SheetTitle>
          <SheetDescription className="text-xs">
            Pairwise verifier judgments and the preference matrix fitted by the
            Bradley–Terry model.
          </SheetDescription>
        </SheetHeader>

        {!ranking || !details ? (
          <p className="text-xs text-muted-foreground mt-6">No ranking data.</p>
        ) : (
          <div className="mt-4 space-y-6">
            {/* Summary */}
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="rounded border border-border/40 bg-card/40 p-2">
                <div className="text-muted-foreground text-[9px] uppercase">Top-1</div>
                <div className="text-primary text-sm">
                  {(ranking.topConfidence * 100).toFixed(1)}%
                </div>
              </div>
              <div className="rounded border border-border/40 bg-card/40 p-2">
                <div className="text-muted-foreground text-[9px] uppercase">Margin</div>
                <div className="text-foreground text-sm">
                  {(ranking.topMargin * 100).toFixed(1)}pp
                  {ranking.topMargin < 0.05 && (
                    <span className="ml-1 text-amber-500 text-[10px]">close</span>
                  )}
                </div>
              </div>
              <div className="rounded border border-border/40 bg-card/40 p-2">
                <div className="text-muted-foreground text-[9px] uppercase flex items-center gap-1">
                  <Sigma className="h-2.5 w-2.5" /> Entropy
                </div>
                <div className="text-foreground text-sm">
                  {ranking.entropyAvg.toFixed(3)} bits
                </div>
              </div>
              <div className="rounded border border-border/40 bg-card/40 p-2">
                <div className="text-muted-foreground text-[9px] uppercase">Judgments</div>
                <div className="text-foreground text-sm">{ranking.totalJudgments}</div>
              </div>
            </div>

            {/* Ranked list */}
            <div>
              <h4 className="text-[10px] font-mono uppercase text-muted-foreground mb-2">
                Ranked variants
              </h4>
              <div className="space-y-1">
                {ranking.ranking.map((r, i) => (
                  <div
                    key={r.index}
                    className="flex items-center gap-2 rounded border border-border/40 bg-card/30 px-2 py-1.5"
                  >
                    <span
                      className={cn(
                        "text-[10px] font-mono font-bold w-5 shrink-0",
                        i === 0 ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      #{i + 1}
                    </span>
                    <span className="text-[11px] font-mono flex-1 truncate">
                      {variantLabel(r.index)}
                    </span>
                    <span
                      className="text-[10px] font-mono text-muted-foreground w-14 text-right shrink-0"
                      title="Bradley–Terry log-strength"
                    >
                      s={r.strength.toFixed(2)}
                    </span>
                    <span
                      className="text-[10px] font-mono text-foreground w-12 text-right shrink-0"
                      title="P(best of K)"
                    >
                      {(r.probBest * 100).toFixed(1)}%
                    </span>
                    <span
                      className="text-[10px] font-mono text-muted-foreground w-10 text-right shrink-0"
                      title="Average pairwise win prob"
                    >
                      w̄={(r.avgWinProb * 100).toFixed(0)}%
                    </span>
                    <Badge
                      variant="outline"
                      className="text-[9px] font-mono px-1.5"
                      title="Judgments contributing to this variant"
                    >
                      n={r.judgmentCount}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>

            {/* Preference matrix */}
            <div>
              <h4 className="text-[10px] font-mono uppercase text-muted-foreground mb-2 flex items-center gap-1">
                <Scale className="h-3 w-3" /> Preference matrix P(row&nbsp;&gt;&nbsp;col)
              </h4>
              <div className="overflow-x-auto">
                <table className="text-[10px] font-mono border-collapse">
                  <thead>
                    <tr>
                      <th className="p-1 text-muted-foreground"></th>
                      {details.labels.map((l, j) => (
                        <th
                          key={j}
                          className="p-1 text-muted-foreground text-center min-w-[52px]"
                          title={l}
                        >
                          v{j}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {details.P.map((row, i) => (
                      <tr key={i}>
                        <th
                          className="p-1 text-right text-muted-foreground pr-2 whitespace-nowrap"
                          title={details.labels[i]}
                        >
                          v{i} · {details.labels[i]}
                        </th>
                        {row.map((p, j) => (
                          <td
                            key={j}
                            className={cn(
                              "px-1.5 py-1 text-center border border-border/30",
                              i === j ? "bg-muted/20 text-muted-foreground/40" : prefColor(p),
                            )}
                            title={
                              i === j
                                ? "self"
                                : `Pr(${details.labels[i]} > ${details.labels[j]}) = ${p.toFixed(3)} · n=${details.C[i]?.[j] ?? 0}`
                            }
                          >
                            {i === j ? "—" : (p * 100).toFixed(0)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[9px] text-muted-foreground mt-1">
                Cells show Pr(row beats col) × 100. Green = row preferred, red = col preferred.
                Values are Laplace-smoothed over pairwise verifier judgments.
              </p>
            </div>

            {/* Pairwise verifier results */}
            <div>
              <h4 className="text-[10px] font-mono uppercase text-muted-foreground mb-2">
                Pairwise verifier results ({details.pairs.length} pair{details.pairs.length === 1 ? "" : "s"})
              </h4>
              <div className="space-y-1.5">
                {details.pairs.map((pair) => {
                  const winnerA = pair.pAB > pair.pBA;
                  const tie = Math.abs(pair.pAB - 0.5) < 0.05;
                  return (
                    <div
                      key={`${pair.i}-${pair.j}`}
                      className="rounded border border-border/40 bg-card/30 p-2 text-[10px] font-mono space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={cn(
                              "truncate",
                              !tie && winnerA ? "text-emerald-400" : "text-foreground",
                            )}
                          >
                            v{pair.i} {pair.labelA}
                          </span>
                          <span className="text-muted-foreground">vs</span>
                          <span
                            className={cn(
                              "truncate",
                              !tie && !winnerA ? "text-emerald-400" : "text-foreground",
                            )}
                          >
                            v{pair.j} {pair.labelB}
                          </span>
                        </div>
                        <Badge variant="outline" className="text-[9px] shrink-0">
                          n={pair.count}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-emerald-400">
                          {(pair.pAB * 100).toFixed(0)}%
                        </span>
                        <div className="flex-1 h-2 rounded-full bg-red-500/30 overflow-hidden">
                          <div
                            className="h-full bg-emerald-500/70"
                            style={{ width: `${Math.max(2, pair.pAB * 100)}%` }}
                          />
                        </div>
                        <span className="w-16 shrink-0 text-right text-red-400">
                          {(pair.pBA * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="text-[9px] text-muted-foreground">
                        wins: {pair.winsA.toFixed(1)} – {pair.winsB.toFixed(1)}
                        {tie && <span className="ml-2 text-amber-500">too close</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
