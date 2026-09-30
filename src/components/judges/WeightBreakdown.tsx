import { Badge } from "@/components/ui/badge";
import { Bot } from "lucide-react";

interface Dim {
  key: string;
  label: string;
  weight?: number;
}

interface Props {
  dimensions: Dim[];
  scores: Record<string, number>;
  /** Optional override (e.g. server-stored total). When omitted, computed from contributions. */
  total?: number | null;
  title?: string;
  /** Dimension keys flagged as AI-influenced (per writer's disclosure). */
  aiInfluencedKeys?: Set<string>;
}

/**
 * Live weighted-contribution breakdown.
 * Each row shows: dimension · ×weight · share% · score → +contribution (to weighted /10 total).
 * Bar layers: light track = weight share, gold fill = actual contribution.
 */
export function WeightBreakdown({ dimensions, scores, total, title = "Weighted Breakdown", aiInfluencedKeys }: Props) {
  const totalWeight = dimensions.reduce((a, d) => a + (d.weight ?? 1), 0);
  const rows = dimensions.map((d) => {
    const w = d.weight ?? 1;
    const share = totalWeight > 0 ? w / totalWeight : 0;
    const v = scores[d.key];
    const hasV = typeof v === "number";
    const contribution = hasV ? v * share : 0;
    return { ...d, w, share, v: hasV ? v : null, contribution };
  });
  const computedTotal = rows.reduce((a, r) => a + r.contribution, 0);
  const displayTotal = total ?? computedTotal;

  return (
    <div className="border border-border/40 rounded-md p-3 bg-background/40 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {title}
        </div>
        <div className="text-xs font-mono">
          <span className="text-muted-foreground">Total </span>
          <span className="text-gradient-gold font-display text-base">
            {displayTotal != null ? Number(displayTotal).toFixed(2) : "—"}
          </span>
          <span className="text-muted-foreground"> / 10</span>
        </div>
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.key} className="text-[11px]">
            <div className="flex items-center justify-between mb-0.5">
              <span className="flex items-center gap-1.5">
                <span className="text-foreground/90">{r.label}</span>
                <span className="font-mono text-[9px] text-muted-foreground">
                  ×{r.w} · {(r.share * 100).toFixed(0)}%
                </span>
                {aiInfluencedKeys?.has(r.key) && (
                  <Badge
                    variant="outline"
                    className="h-4 px-1 gap-0.5 text-[8px] font-mono uppercase border-primary/40 text-primary/90"
                    title="Writer disclosed AI assistance touching this dimension"
                  >
                    <Bot className="h-2.5 w-2.5" />
                    AI
                  </Badge>
                )}
              </span>
              <span className="font-mono text-muted-foreground">
                {r.v != null ? (
                  <>
                    {r.v.toFixed(1)}{" "}
                    <span className="text-primary/90">→ +{r.contribution.toFixed(2)}</span>
                  </>
                ) : (
                  "—"
                )}
              </span>
            </div>
            <div className="relative h-1.5 rounded bg-muted/30 overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-muted/60"
                style={{ width: `${r.share * 100}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 bg-primary/70"
                style={{ width: `${Math.min(100, (r.contribution / 10) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
