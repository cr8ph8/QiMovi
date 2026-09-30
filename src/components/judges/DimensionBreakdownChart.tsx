import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { cn } from "@/lib/utils";

interface Dim {
  key: string;
  label: string;
  weight?: number;
}

interface Props {
  dimensions: Dim[];
  scores: Record<string, number>;
  total?: number | null;
  className?: string;
  /** Dimension keys flagged as AI-influenced (per writer's disclosure). */
  aiInfluencedKeys?: Set<string>;
}

/** Generate a short narrative summary of the dimension scores. */
function buildNarrative(
  rows: Array<{ label: string; key: string; contribution: number; raw: number; share: number }>,
  total: number,
) {
  if (rows.length === 0) return "";
  const sorted = [...rows].sort((a, b) => b.contribution - a.contribution);
  const highest = sorted[0];
  const lowest = sorted[sorted.length - 1];
  const avgRaw = rows.reduce((s, r) => s + r.raw, 0) / rows.length;
  const spread = highest.raw - lowest.raw;

  let narrative = `The screenplay scores ${total.toFixed(1)} out of 10 overall. `;

  if (sorted.length === 1) {
    narrative += `Its single evaluated dimension, ${highest.label}, contributes ${highest.contribution.toFixed(2)} points.`;
    return narrative;
  }

  narrative += `The strongest contributor is **${highest.label}** (+${highest.contribution.toFixed(2)}), `;
  if (spread > 3) {
    narrative += `while **${lowest.label}** lags notably at ${lowest.raw.toFixed(1)}. `;
  } else if (spread > 1.5) {
    narrative += `with **${lowest.label}** the softest spot at ${lowest.raw.toFixed(1)}. `;
  } else {
    narrative += `and the dimensions are fairly balanced (spread of ${spread.toFixed(1)}). `;
  }

  if (avgRaw >= 8) {
    narrative += "The script shows consistent strength across the board.";
  } else if (avgRaw >= 6) {
    narrative += "Solid fundamentals with room to grow in targeted areas.";
  } else {
    narrative += "Several dimensions suggest significant revision potential.";
  }

  return narrative;
}

const PALETTE = [
  "#E5B80B", // gold primary
  "#F59E0B", // amber
  "#10B981", // emerald
  "#3B82F6", // blue
  "#8B5CF6", // violet
  "#EC4899", // pink
  "#06B6D4", // cyan
  "#F97316", // orange
  "#84CC16", // lime
  "#EF4444", // red
  "#6366F1", // indigo
  "#14B8A6", // teal
];

export function DimensionBreakdownChart({ dimensions, scores, total, className, aiInfluencedKeys }: Props) {
  const rows = useMemo(() => {
    const totalWeight = dimensions.reduce((a, d) => a + (d.weight ?? 1), 0);
    return dimensions
      .map((d) => {
        const w = d.weight ?? 1;
        const share = totalWeight > 0 ? w / totalWeight : 0;
        const raw = scores[d.key];
        const contribution = typeof raw === "number" ? raw * share : 0;
        return {
          key: d.key,
          label: d.label,
          raw: typeof raw === "number" ? raw : 0,
          contribution,
          share,
        };
      })
      .filter((r) => r.raw > 0)
      .sort((a, b) => b.contribution - a.contribution);
  }, [dimensions, scores]);

  const computedTotal = rows.reduce((a, r) => a + r.contribution, 0);
  const displayTotal = total ?? computedTotal;

  const narrative = useMemo(() => buildNarrative(rows, displayTotal), [rows, displayTotal]);

  const stackedData = useMemo(() => {
    if (rows.length === 0) return [];
    const entry: Record<string, number | string> = { name: "Total" };
    rows.forEach((r) => {
      entry[r.label] = Number(r.contribution.toFixed(2));
    });
    return [entry];
  }, [rows]);

  const barColors = useMemo(() => {
    return rows.map((_, i) => PALETTE[i % PALETTE.length]);
  }, [rows]);

  if (rows.length === 0) return null;

  return (
    <div className={cn("space-y-3", className)}>
      {/* Stacked contribution bar (single horizontal bar decomposed by dimension) */}
      <div className="border border-border/40 rounded-md p-3 bg-background/40">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
          Contribution Stack
        </div>
        <div className="h-10">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={stackedData}
              layout="vertical"
              barSize={28}
              margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
            >
              <XAxis type="number" hide domain={[0, Math.max(10, displayTotal * 1.1)]} />
              <YAxis type="category" dataKey="name" hide />
              <Tooltip
                cursor={{ fill: "transparent" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="rounded-md border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
                      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                        Weighted Contributions
                      </div>
                      <div className="space-y-1">
                        {payload.map((p, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <div
                              className="h-2 w-2 rounded-[2px]"
                              style={{ backgroundColor: p.color }}
                            />
                            <span className="text-muted-foreground">{p.name}</span>
                            <span className="ml-auto font-mono">{Number(p.value).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-1.5 border-t border-border/30 pt-1 flex justify-between font-mono text-[10px]">
                        <span className="text-muted-foreground">Total</span>
                        <span className="text-gradient-gold">{displayTotal.toFixed(2)}</span>
                      </div>
                    </div>
                  );
                }}
              />
              {rows.map((r, idx) => (
                <Bar
                  key={r.key}
                  dataKey={r.label}
                  stackId="total"
                  fill={barColors[idx]}
                  radius={idx === rows.length - 1 ? [0, 4, 4, 0] : [0, 0, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Inline legend */}
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {rows.map((r, idx) => (
            <div key={r.key} className="flex items-center gap-1.5 text-[10px]">
              <div
                className="h-2 w-2 rounded-[2px]"
                style={{ backgroundColor: barColors[idx] }}
              />
              <span className="text-muted-foreground">{r.label}</span>
              {aiInfluencedKeys?.has(r.key) && (
                <span
                  className="inline-flex items-center gap-0.5 px-1 rounded-sm border border-primary/40 text-primary/90 font-mono uppercase text-[8px] leading-3"
                  title="Writer disclosed AI assistance touching this dimension"
                >
                  AI
                </span>
              )}
              <span className="font-mono text-foreground/80">
                {r.contribution.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Per-dimension raw vs contribution bars */}
      <div className="border border-border/40 rounded-md p-3 bg-background/40">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
          Dimension Detail
        </div>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              layout="vertical"
              barSize={14}
              margin={{ top: 0, right: 16, left: 4, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.3)" horizontal={false} />
              <XAxis type="number" domain={[0, 10]} hide />
              <YAxis
                type="category"
                dataKey="label"
                width={100}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted) / 0.15)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0]?.payload;
                  if (!p) return null;
                  return (
                    <div className="rounded-md border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
                      <div className="font-medium mb-1">{p.label}</div>
                      <div className="space-y-0.5 text-[11px]">
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Raw score</span>
                          <span className="font-mono">{p.raw.toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Weight share</span>
                          <span className="font-mono">{(p.share * 100).toFixed(0)}%</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Contribution</span>
                          <span className="font-mono text-primary">{p.contribution.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="raw" radius={[0, 4, 4, 0]}>
                {rows.map((_, idx) => (
                  <Cell key={`cell-${idx}`} fill={barColors[idx]} fillOpacity={0.35} />
                ))}
              </Bar>
              <Bar dataKey="contribution" radius={[0, 4, 4, 0]}>
                {rows.map((_, idx) => (
                  <Cell key={`cell-${idx}`} fill={barColors[idx]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-1.5 flex items-center justify-center gap-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-4 rounded bg-primary/30" />
            Raw Score
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-4 rounded bg-primary" />
            Weighted Contribution
          </span>
        </div>
      </div>

      {/* Narrative summary */}
      {narrative && (
        <div className="rounded-md border border-border/30 bg-background/60 p-3 text-xs leading-relaxed text-foreground/90">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block mb-1">
            Summary
          </span>
          {narrative.split("**").map((part, i) =>
            i % 2 === 1 ? (
              <span key={i} className="font-semibold text-primary">
                {part}
              </span>
            ) : (
              <span key={i}>{part}</span>
            ),
          )}
        </div>
      )}
    </div>
  );
}
