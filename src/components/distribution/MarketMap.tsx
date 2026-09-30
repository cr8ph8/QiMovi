import { useMemo } from "react";
import type { Distributor } from "./DistributorExplorer";

interface MarketMapProps {
  distributors: Distributor[];
  projectBudget?: number; // in millions
  projectReleaseModel?: "theatrical" | "hybrid" | "streaming";
  onDistributorClick?: (id: string) => void;
}

const RELEASE_Y: Record<string, number> = { theatrical: 0.15, hybrid: 0.5, streaming: 0.85 };
const CATEGORY_COLORS: Record<string, string> = {
  major: "hsl(var(--primary))",
  mini_major: "hsl(var(--accent-foreground))",
  indie: "hsl(142 71% 45%)",
  streaming: "hsl(262 83% 58%)",
  boutique: "hsl(25 95% 53%)",
  sales_agent: "hsl(199 89% 48%)",
  aggregator: "hsl(340 82% 52%)",
};

function logScale(value: number, min: number, max: number): number {
  const logMin = Math.log10(Math.max(min, 0.01));
  const logMax = Math.log10(max);
  const logVal = Math.log10(Math.max(value, 0.01));
  return (logVal - logMin) / (logMax - logMin);
}

export default function MarketMap({ distributors, projectBudget, projectReleaseModel, onDistributorClick }: MarketMapProps) {
  const PAD = { top: 30, right: 20, bottom: 30, left: 50 };
  const W = 520, H = 260;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const budgetExtent = useMemo(() => {
    const all = distributors.flatMap(d => d.budgetRange);
    return [Math.min(...all), Math.max(...all)] as [number, number];
  }, [distributors]);

  const points = useMemo(() => {
    return distributors.map(d => {
      const midBudget = (d.budgetRange[0] + d.budgetRange[1]) / 2;
      const x = PAD.left + logScale(midBudget, budgetExtent[0], budgetExtent[1]) * innerW;
      const yNorm = RELEASE_Y[d.releaseModel] ?? 0.5;
      // add small jitter based on id hash to prevent overlaps
      const jitter = (d.id.charCodeAt(0) % 7 - 3) * 3;
      const y = PAD.top + yNorm * innerH + jitter;
      return { ...d, cx: x, cy: y, midBudget, color: CATEGORY_COLORS[d.category] || "hsl(var(--muted-foreground))" };
    });
  }, [distributors, budgetExtent, innerW, innerH]);

  const projectPoint = useMemo(() => {
    if (!projectBudget || !projectReleaseModel) return null;
    const x = PAD.left + logScale(projectBudget, budgetExtent[0], budgetExtent[1]) * innerW;
    const yNorm = RELEASE_Y[projectReleaseModel] ?? 0.5;
    const y = PAD.top + yNorm * innerH;
    return { x, y };
  }, [projectBudget, projectReleaseModel, budgetExtent, innerW, innerH]);

  const gridLines = [0.1, 1, 5, 10, 50, 100, 200].filter(v => v >= budgetExtent[0] && v <= budgetExtent[1]);

  return (
    <div className="rounded-lg border border-border/30 bg-card p-4 space-y-3">
      <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Market Position Map</h4>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ maxHeight: 280 }}>
        {/* Y-axis labels */}
        {(["theatrical", "hybrid", "streaming"] as const).map(model => (
          <text key={model} x={PAD.left - 6} y={PAD.top + RELEASE_Y[model] * innerH} textAnchor="end" className="fill-muted-foreground" style={{ fontSize: 9, fontFamily: "monospace" }}>
            {model.charAt(0).toUpperCase() + model.slice(1)}
          </text>
        ))}

        {/* Horizontal grid */}
        {(["theatrical", "hybrid", "streaming"] as const).map(model => (
          <line key={`grid-${model}`} x1={PAD.left} x2={W - PAD.right} y1={PAD.top + RELEASE_Y[model] * innerH} y2={PAD.top + RELEASE_Y[model] * innerH} className="stroke-border/20" strokeDasharray="3 3" />
        ))}

        {/* Vertical budget grid */}
        {gridLines.map(v => {
          const x = PAD.left + logScale(v, budgetExtent[0], budgetExtent[1]) * innerW;
          return (
            <g key={`vgrid-${v}`}>
              <line x1={x} x2={x} y1={PAD.top} y2={H - PAD.bottom} className="stroke-border/15" strokeDasharray="2 4" />
              <text x={x} y={H - PAD.bottom + 14} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 8, fontFamily: "monospace" }}>
                ${v}M
              </text>
            </g>
          );
        })}

        {/* Distributor dots */}
        {points.map(p => (
          <g key={p.id} className="cursor-pointer" onClick={() => onDistributorClick?.(p.id)}>
            <circle cx={p.cx} cy={p.cy} r={6} fill={p.color} opacity={0.8} className="transition-all hover:opacity-100" />
            <circle cx={p.cx} cy={p.cy} r={6} fill="none" stroke={p.color} strokeWidth={1.5} opacity={0.3} className="transition-all hover:opacity-60" />
            <text x={p.cx} y={p.cy - 10} textAnchor="middle" className="fill-foreground" style={{ fontSize: 8, fontFamily: "monospace", fontWeight: 600 }}>
              {p.name.length > 12 ? p.name.slice(0, 10) + "…" : p.name}
            </text>
          </g>
        ))}

        {/* Project indicator */}
        {projectPoint && (
          <g>
            <circle cx={projectPoint.x} cy={projectPoint.y} r={8} fill="none" stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="4 2" />
            <circle cx={projectPoint.x} cy={projectPoint.y} r={3} fill="hsl(var(--primary))" />
            <text x={projectPoint.x} y={projectPoint.y - 13} textAnchor="middle" className="fill-primary" style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 700 }}>
              YOUR PROJECT
            </text>
          </g>
        )}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
          <div key={cat} className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-[9px] font-mono text-muted-foreground capitalize">{cat.replace(/_/g, " ")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
