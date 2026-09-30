/**
 * FranchiseEmbeddingSpace — SVG 2D character embedding with axis toggles,
 * cluster hulls, hover cards, drift lines, quadrant labels.
 */
import { useMemo, useState, lazy, Suspense } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Eye, Zap, GitBranch } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { CharacterSentiment } from "@/lib/character";

const Enhanced3DSpace = lazy(() => import("./FranchiseEmbedding3D"));

export interface EmbeddingChar {
  name: string;
  installmentIdx: number;
  installmentTitle: string;
  avgLineLength: number;
  lexicalUniqueness: number;
  lineCount: number;
  sentiment?: CharacterSentiment;
  distinctiveness?: number;
}

interface Props {
  characters: EmbeddingChar[];
  installmentLabels: string[];
}

const W = 580;
const H = 440;
const PAD = 55;

const INSTALLMENT_COLORS = [
  "hsl(var(--primary))", "hsl(var(--accent))", "hsl(160 60% 50%)", "hsl(30 80% 55%)",
  "hsl(280 50% 55%)", "hsl(200 70% 50%)", "hsl(350 60% 55%)", "hsl(90 50% 45%)",
  "hsl(50 80% 50%)", "hsl(320 50% 50%)",
];

type AxisMetric = "avgLineLength" | "lexicalUniqueness" | "distinctiveness" | "sentimentPositive";

const AXIS_LABELS: Record<AxisMetric, string> = {
  avgLineLength: "Avg Line Length",
  lexicalUniqueness: "Lexical Uniqueness",
  distinctiveness: "Distinctiveness",
  sentimentPositive: "Positive Sentiment",
};

function getMetricValue(c: EmbeddingChar, metric: AxisMetric): number {
  switch (metric) {
    case "avgLineLength": return c.avgLineLength;
    case "lexicalUniqueness": return c.lexicalUniqueness;
    case "distinctiveness": return c.distinctiveness ?? 0;
    case "sentimentPositive": return c.sentiment?.positive ?? 50;
  }
}

function quadrantLabel(xMetric: AxisMetric, yMetric: AxisMetric, quadrant: "tl" | "tr" | "bl" | "br"): string {
  const xHigh = quadrant === "tr" || quadrant === "br";
  const yHigh = quadrant === "tl" || quadrant === "tr";
  const xLabel = xHigh ? "High" : "Low";
  const yLabel = yHigh ? "High" : "Low";
  const xShort = AXIS_LABELS[xMetric].split(" ").pop() || "";
  const yShort = AXIS_LABELS[yMetric].split(" ").pop() || "";
  return `${yLabel} ${yShort} · ${xLabel} ${xShort}`;
}

// Graham scan for convex hull
function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  if (points.length < 3) return points;
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (O: typeof pts[0], A: typeof pts[0], B: typeof pts[0]) =>
    (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);
  const lower: typeof pts = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: typeof pts = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function SVGEmbedding({ characters, installmentLabels }: Props) {
  const [xAxis, setXAxis] = useState<AxisMetric>("avgLineLength");
  const [yAxis, setYAxis] = useState<AxisMetric>("lexicalUniqueness");
  const [showDrift, setShowDrift] = useState(false);
  const [showHulls, setShowHulls] = useState(true);
  const [hovered, setHovered] = useState<number | null>(null);

  const { points, hulls, driftLines, stats } = useMemo(() => {
    if (characters.length === 0) return { points: [], hulls: [], driftLines: [], stats: { meanX: 0, meanY: 0 } };

    const xs = characters.map((c) => getMetricValue(c, xAxis));
    const ys = characters.map((c) => getMetricValue(c, yAxis));
    const minX = Math.min(...xs); const maxX = Math.max(...xs);
    const minY = Math.min(...ys); const maxY = Math.max(...ys);
    const rx = maxX - minX || 1;
    const ry = maxY - minY || 1;

    const pts = characters.map((c, i) => ({
      ...c,
      idx: i,
      cx: PAD + ((getMetricValue(c, xAxis) - minX) / rx) * (W - PAD * 2),
      cy: H - PAD - ((getMetricValue(c, yAxis) - minY) / ry) * (H - PAD * 2),
      r: 4 + Math.min(c.lineCount / 20, 10),
      color: INSTALLMENT_COLORS[c.installmentIdx % INSTALLMENT_COLORS.length],
    }));

    const meanX = pts.reduce((s, p) => s + p.cx, 0) / pts.length;
    const meanY = pts.reduce((s, p) => s + p.cy, 0) / pts.length;

    // Cluster hulls by installment
    const instGroups = new Map<number, typeof pts>();
    for (const p of pts) {
      if (!instGroups.has(p.installmentIdx)) instGroups.set(p.installmentIdx, []);
      instGroups.get(p.installmentIdx)!.push(p);
    }
    const hulls = [...instGroups.entries()]
      .filter(([, group]) => group.length >= 3)
      .map(([idx, group]) => ({
        idx,
        color: INSTALLMENT_COLORS[idx % INSTALLMENT_COLORS.length],
        points: convexHull(group.map((p) => ({ x: p.cx, y: p.cy }))),
      }));

    // Drift lines: connect same character across installments
    const charGroups = new Map<string, typeof pts>();
    for (const p of pts) {
      const key = p.name.toUpperCase();
      if (!charGroups.has(key)) charGroups.set(key, []);
      charGroups.get(key)!.push(p);
    }
    const driftLines = [...charGroups.values()]
      .filter((group) => group.length >= 2)
      .map((group) => group.sort((a, b) => a.installmentIdx - b.installmentIdx));

    return { points: pts, hulls, driftLines, stats: { meanX, meanY } };
  }, [characters, xAxis, yAxis]);

  if (characters.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-xs text-muted-foreground font-mono">
        No voice data to embed
      </div>
    );
  }

  const midX = (PAD + (W - PAD)) / 2;
  const midY = (PAD + (H - PAD)) / 2;

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">X:</span>
          <select
            value={xAxis}
            onChange={(e) => setXAxis(e.target.value as AxisMetric)}
            className="bg-muted/30 border border-border/30 rounded px-1.5 py-0.5 text-[10px] font-mono text-foreground"
          >
            {Object.entries(AXIS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Y:</span>
          <select
            value={yAxis}
            onChange={(e) => setYAxis(e.target.value as AxisMetric)}
            className="bg-muted/30 border border-border/30 rounded px-1.5 py-0.5 text-[10px] font-mono text-foreground"
          >
            {Object.entries(AXIS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <Switch id="hulls" checked={showHulls} onCheckedChange={setShowHulls} className="scale-75" />
          <Label htmlFor="hulls" className="text-[10px] font-mono text-muted-foreground cursor-pointer">Clusters</Label>
        </div>
        <div className="flex items-center gap-1.5">
          <Switch id="drift" checked={showDrift} onCheckedChange={setShowDrift} className="scale-75" />
          <Label htmlFor="drift" className="text-[10px] font-mono text-muted-foreground cursor-pointer flex items-center gap-1">
            <GitBranch className="h-3 w-3" /> Drift
          </Label>
        </div>
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ minHeight: 320 }}>
          {/* Quadrant labels */}
          <text x={PAD + 4} y={PAD + 12} className="fill-muted-foreground/20 text-[8px] font-mono">{quadrantLabel(xAxis, yAxis, "tl")}</text>
          <text x={W - PAD - 4} y={PAD + 12} textAnchor="end" className="fill-muted-foreground/20 text-[8px] font-mono">{quadrantLabel(xAxis, yAxis, "tr")}</text>
          <text x={PAD + 4} y={H - PAD - 4} className="fill-muted-foreground/20 text-[8px] font-mono">{quadrantLabel(xAxis, yAxis, "bl")}</text>
          <text x={W - PAD - 4} y={H - PAD - 4} textAnchor="end" className="fill-muted-foreground/20 text-[8px] font-mono">{quadrantLabel(xAxis, yAxis, "br")}</text>

          {/* Quadrant lines */}
          <line x1={midX} y1={PAD} x2={midX} y2={H - PAD} stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="4 4" opacity={0.3} />
          <line x1={PAD} y1={midY} x2={W - PAD} y2={midY} stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="4 4" opacity={0.3} />

          {/* Cluster hulls */}
          {showHulls && hulls.map((hull) => (
            <polygon
              key={hull.idx}
              points={hull.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill={hull.color}
              fillOpacity={0.06}
              stroke={hull.color}
              strokeWidth={1}
              strokeOpacity={0.25}
              strokeDasharray="4 2"
            />
          ))}

          {/* Drift lines */}
          {showDrift && driftLines.map((group, gi) => (
            <g key={gi}>
              {group.slice(0, -1).map((p, pi) => (
                <line
                  key={pi}
                  x1={p.cx} y1={p.cy} x2={group[pi + 1].cx} y2={group[pi + 1].cy}
                  stroke="hsl(var(--primary))" strokeWidth={1} strokeOpacity={0.3} strokeDasharray="3 2"
                  markerEnd="url(#arrowhead)"
                />
              ))}
            </g>
          ))}
          {showDrift && (
            <defs>
              <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
                <polygon points="0 0, 6 2, 0 4" fill="hsl(var(--primary))" opacity="0.4" />
              </marker>
            </defs>
          )}

          {/* Axis labels */}
          <text x={W / 2} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[9px] font-mono">
            {AXIS_LABELS[xAxis]} →
          </text>
          <text x={12} y={H / 2} textAnchor="middle" transform={`rotate(-90, 12, ${H / 2})`} className="fill-muted-foreground text-[9px] font-mono">
            {AXIS_LABELS[yAxis]} →
          </text>

          {/* Centroid */}
          <circle cx={stats.meanX} cy={stats.meanY} r={14} fill="hsl(var(--primary))" opacity={0.08} />
          <circle cx={stats.meanX} cy={stats.meanY} r={5} fill="hsl(var(--primary))" opacity={0.2} />

          {/* Data points */}
          {points.map((p, i) => (
            <g
              key={i}
              className="cursor-pointer"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              opacity={hovered !== null && hovered !== i ? 0.3 : 1}
            >
              <circle cx={p.cx} cy={p.cy} r={hovered === i ? p.r + 2 : p.r}
                fill={p.color} opacity={0.75}
                stroke={hovered === i ? "hsl(var(--foreground))" : p.color}
                strokeWidth={hovered === i ? 1.5 : 0.5}
                className="transition-all duration-150"
              />
              {(p.lineCount > 30 || hovered === i) && (
                <text x={p.cx} y={p.cy - p.r - 4} textAnchor="middle" className="fill-muted-foreground text-[7px] font-mono">
                  {p.name.length > 12 ? p.name.slice(0, 12) + "…" : p.name}
                </text>
              )}
            </g>
          ))}

          {/* Hover card */}
          {hovered !== null && (() => {
            const p = points[hovered];
            if (!p) return null;
            const tx = Math.min(Math.max(p.cx, 90), W - 90);
            const ty = p.cy - p.r - 80;
            return (
              <foreignObject x={tx - 85} y={Math.max(ty, 5)} width={170} height={72} className="pointer-events-none">
                <div className="bg-popover/95 backdrop-blur border border-border rounded-lg px-2.5 py-1.5 shadow-lg">
                  <p className="text-[10px] font-mono font-semibold text-foreground truncate">{p.name}</p>
                  <p className="text-[8px] font-mono text-muted-foreground truncate">{p.installmentTitle}</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1 text-[8px] font-mono text-muted-foreground">
                    <span>Lines: {p.lineCount}</span>
                    <span>Avg: {p.avgLineLength}</span>
                    <span>Uniq: {p.lexicalUniqueness}%</span>
                    {p.sentiment && <span className="capitalize">Sent: {p.sentiment.label}</span>}
                    {p.distinctiveness != null && <span>Dist: {p.distinctiveness}%</span>}
                  </div>
                </div>
              </foreignObject>
            );
          })()}

          {/* Legend */}
          {installmentLabels.slice(0, 6).map((label, i) => (
            <g key={i} transform={`translate(${W - 140}, ${20 + i * 14})`}>
              <circle cx={0} cy={0} r={4} fill={INSTALLMENT_COLORS[i % INSTALLMENT_COLORS.length]} opacity={0.8} />
              <text x={8} y={3} className="fill-muted-foreground text-[8px] font-mono">
                {label.length > 16 ? label.slice(0, 16) + "…" : label}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

export default function FranchiseEmbeddingSpace(props: Props) {
  const [mode, setMode] = useState<"standard" | "enhanced">("standard");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as any)} size="sm">
          <ToggleGroupItem value="standard" className="text-[10px] font-mono gap-1 px-2.5">
            <Eye className="h-3 w-3" /> 2D Space
          </ToggleGroupItem>
          <ToggleGroupItem value="enhanced" className="text-[10px] font-mono gap-1 px-2.5">
            <Zap className="h-3 w-3" /> 3D Space
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {mode === "standard" ? (
        <SVGEmbedding {...props} />
      ) : (
        <Suspense
          fallback={
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <Skeleton className="h-[300px] w-full rounded-lg" />
              <span className="text-[10px] font-mono text-muted-foreground">Loading 3D renderer…</span>
            </div>
          }
        >
          <Enhanced3DSpace {...props} />
        </Suspense>
      )}
    </div>
  );
}
