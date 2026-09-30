/**
 * NarrativeEmbeddingSpace — SVG standard view
 * Clusters scenes by act position, showing centroid vectors and tonal drift.
 * Adapted from Hampton Lab's EmbeddingSpaceView pattern.
 */
import { useMemo } from "react";
import type { FountainParseResult } from "@/lib/fountain-parser";

interface Props {
  parsed: FountainParseResult;
}

interface ScenePoint {
  index: number;
  x: number;
  y: number;
  act: 1 | 2 | 3;
  dialogueDensity: number;
  actionDensity: number;
  characterCount: number;
  heading: string;
}

const ACT_COLORS: Record<number, string> = {
  1: "hsl(var(--primary))",
  2: "hsl(var(--accent))",
  3: "hsl(var(--destructive))",
};

const ACT_LABELS: Record<number, string> = { 1: "Act 1", 2: "Act 2", 3: "Act 3" };

function classifyAct(index: number, total: number): 1 | 2 | 3 {
  const ratio = index / Math.max(total - 1, 1);
  if (ratio < 0.25) return 1;
  if (ratio < 0.75) return 2;
  return 3;
}

function computeSceneMetrics(parsed: FountainParseResult): ScenePoint[] {
  const { scenes, elements } = parsed;
  if (scenes.length === 0) return [];

  return scenes.map((scene, idx) => {
    const nextElIdx = idx < scenes.length - 1 ? scenes[idx + 1].elementIndex : elements.length;
    const sceneEls = elements.slice(scene.elementIndex, nextElIdx);
    const total = sceneEls.length || 1;
    const dialogueCount = sceneEls.filter(e => e.type === "dialogue").length;
    const actionCount = sceneEls.filter(e => e.type === "action").length;
    const charSet = new Set(sceneEls.filter(e => e.type === "character").map(e => e.text.replace(/\s*\(.*\)$/, "").trim()));

    // Project onto 2D: x = dialogue density, y = action density (with jitter for separation)
    const dialogueDensity = dialogueCount / total;
    const actionDensity = actionCount / total;

    return {
      index: idx,
      x: dialogueDensity,
      y: actionDensity,
      act: classifyAct(idx, scenes.length),
      dialogueDensity: Math.round(dialogueDensity * 100),
      actionDensity: Math.round(actionDensity * 100),
      characterCount: charSet.size,
      heading: scene.heading,
    };
  });
}

function computeCentroid(points: ScenePoint[]): { x: number; y: number } | null {
  if (points.length === 0) return null;
  return {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length,
  };
}

export default function NarrativeEmbeddingSpace({ parsed }: Props) {
  const width = 480;
  const height = 360;
  const pad = 40;
  const plotW = width - pad * 2;
  const plotH = height - pad * 2;

  const points = useMemo(() => computeSceneMetrics(parsed), [parsed]);

  const { scaledPoints, centroids, trajectoryPath } = useMemo(() => {
    if (points.length === 0) return { scaledPoints: [], centroids: [], trajectoryPath: "" };

    const maxX = Math.max(0.01, ...points.map(p => p.x));
    const maxY = Math.max(0.01, ...points.map(p => p.y));

    const scaled = points.map(p => ({
      ...p,
      sx: pad + (p.x / maxX) * plotW * 0.85 + Math.random() * plotW * 0.1,
      sy: height - pad - (p.y / maxY) * plotH * 0.85 - Math.random() * plotH * 0.1,
    }));

    const actGroups = [1, 2, 3].map(act => scaled.filter(p => p.act === act));
    const cents = actGroups.map((group, i) => {
      const raw = computeCentroid(group.map(g => ({ x: g.sx, y: g.sy })) as any);
      return raw ? { act: i + 1, ...raw } : null;
    }).filter(Boolean) as { act: number; x: number; y: number }[];

    const path = cents.length >= 2
      ? "M " + cents.map(c => `${c.x},${c.y}`).join(" L ")
      : "";

    return { scaledPoints: scaled, centroids: cents, trajectoryPath: path };
  }, [points, plotW, plotH]);

  // Compute HUD metrics
  const pacingVariance = useMemo(() => {
    const actionRatios = points.map(p => p.actionDensity);
    const mean = actionRatios.reduce((s, v) => s + v, 0) / actionRatios.length;
    const variance = actionRatios.reduce((s, v) => s + (v - mean) ** 2, 0) / actionRatios.length;
    return Math.round(Math.sqrt(variance));
  }, [points]);

  const tonalDrift = useMemo(() => {
    if (centroids.length < 2) return 0;
    const first = centroids[0];
    const last = centroids[centroids.length - 1];
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    return Math.round(Math.sqrt(dx * dx + dy * dy));
  }, [centroids]);

  const avgDialogueDensity = useMemo(() => {
    return Math.round(points.reduce((s, p) => s + p.dialogueDensity, 0) / points.length);
  }, [points]);

  if (points.length < 3) {
    return <div className="text-xs text-muted-foreground text-center py-8 font-mono">Not enough scenes for embedding space.</div>;
  }

  return (
    <div className="relative">
      {/* HUD Overlay */}
      <div className="absolute top-2 right-2 z-10 rounded-lg border border-border/30 bg-background/80 backdrop-blur-sm px-3 py-2 space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Pacing σ</span>
          <span className="text-[10px] font-mono font-semibold text-foreground">{pacingVariance}%</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Tonal Drift</span>
          <span className="text-[10px] font-mono font-semibold text-foreground">{tonalDrift}px</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Dlg Density</span>
          <span className="text-[10px] font-mono font-semibold text-foreground">{avgDialogueDensity}%</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" style={{ maxHeight: 360 }}>
        {/* Axes */}
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="hsl(var(--border))" strokeWidth={1} />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="hsl(var(--border))" strokeWidth={1} />
        <text x={width / 2} y={height - 8} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 9, fontFamily: "monospace" }}>
          Dialogue Density →
        </text>
        <text x={12} y={height / 2} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 9, fontFamily: "monospace" }} transform={`rotate(-90, 12, ${height / 2})`}>
          Action Density →
        </text>

        {/* Trajectory arrow */}
        {trajectoryPath && (
          <path d={trajectoryPath} fill="none" stroke="hsl(var(--foreground))" strokeWidth={1.5} strokeDasharray="6 4" opacity={0.5} markerEnd="url(#arrowhead)" />
        )}
        <defs>
          <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
            <polygon points="0 0, 6 2, 0 4" fill="hsl(var(--foreground))" opacity="0.5" />
          </marker>
        </defs>

        {/* Scene points */}
        {scaledPoints.map((p) => (
          <g key={p.index}>
            <circle
              cx={p.sx} cy={p.sy} r={4 + p.characterCount}
              fill={ACT_COLORS[p.act]}
              fillOpacity={0.35}
              stroke={ACT_COLORS[p.act]}
              strokeWidth={1}
            >
              <title>S{p.index + 1}: {p.heading} — Dlg: {p.dialogueDensity}% Act: {p.actionDensity}%</title>
            </circle>
            <text x={p.sx} y={p.sy + 3} textAnchor="middle" className="fill-foreground" style={{ fontSize: 7, fontFamily: "monospace" }}>
              {p.index + 1}
            </text>
          </g>
        ))}

        {/* Centroids */}
        {centroids.map((c) => (
          <g key={c.act}>
            <circle cx={c.x} cy={c.y} r={8} fill={ACT_COLORS[c.act]} fillOpacity={0.15} stroke={ACT_COLORS[c.act]} strokeWidth={2} strokeDasharray="3 2" />
            <text x={c.x} y={c.y - 12} textAnchor="middle" style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 600 }} fill={ACT_COLORS[c.act]}>
              {ACT_LABELS[c.act]}
            </text>
          </g>
        ))}

        {/* Legend */}
        {[1, 2, 3].map((act, i) => (
          <g key={act} transform={`translate(${width - 80}, ${pad + i * 16})`}>
            <circle cx={0} cy={0} r={4} fill={ACT_COLORS[act]} fillOpacity={0.6} />
            <text x={8} y={3} style={{ fontSize: 8, fontFamily: "monospace" }} className="fill-muted-foreground">{ACT_LABELS[act]}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
