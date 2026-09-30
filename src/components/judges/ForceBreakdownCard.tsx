// ForceBreakdownCard — shows weighted contribution per dimension
// to the panel's median total. Helps judges see which dimensions are
// pulling the score up or down.
import { useMemo } from "react";
import { Scale } from "lucide-react";

interface PanelRow {
  submitted: boolean;
  dimension_scores: Record<string, number>;
}

interface Dimension {
  key: string;
  label: string;
  weight?: number;
}

interface Props {
  rows: PanelRow[];
  dimensions: Dimension[];
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function ForceBreakdownCard({ rows, dimensions }: Props) {
  const submitted = rows.filter((r) => r.submitted);

  const breakdown = useMemo(() => {
    const totalWeight = dimensions.reduce((s, d) => s + (d.weight ?? 1), 0) || 1;
    const items = dimensions.map((d) => {
      const vals = submitted
        .map((r) => r.dimension_scores?.[d.key])
        .filter((n): n is number => typeof n === "number" && !Number.isNaN(n));
      const med = median(vals);
      const w = (d.weight ?? 1) / totalWeight;
      const contrib = med != null ? med * w : 0;
      return { ...d, median: med, normWeight: w, contrib };
    });
    const total = items.reduce((s, i) => s + i.contrib, 0);
    return { items, total };
  }, [dimensions, submitted]);

  if (submitted.length === 0) return null;

  const maxContrib = Math.max(...breakdown.items.map((i) => i.contrib), 1);

  return (
    <div className="rounded-md border border-border/40 bg-card/50 p-3 mb-3">
      <div className="flex items-baseline justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
          <Scale className="h-3.5 w-3.5" />
          Force Breakdown
        </div>
        <div className="text-right">
          <span className="text-lg font-bold tabular-nums">
            {breakdown.total.toFixed(1)}
          </span>
          <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            weighted median
          </span>
        </div>
      </div>
      <div className="space-y-1.5">
        {breakdown.items.map((d) => (
          <div key={d.key} className="flex items-center gap-2 text-xs">
            <div className="w-28 truncate text-muted-foreground">{d.label}</div>
            <div className="flex-1 h-2 rounded-full bg-background/60 overflow-hidden">
              <div
                className="h-full bg-primary/70"
                style={{ width: `${(d.contrib / maxContrib) * 100}%` }}
              />
            </div>
            <div className="w-20 text-right tabular-nums text-[11px]">
              {d.median != null ? `${d.median.toFixed(1)} × ${(d.normWeight * 100).toFixed(0)}%` : "—"}
            </div>
            <div className="w-10 text-right tabular-nums font-semibold">
              {d.contrib.toFixed(1)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
