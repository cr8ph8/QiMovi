import { useMemo } from "react";
import { FountainParseResult, FountainElement } from "@/lib/fountain-parser";
import CollapsibleSection from "@/components/CollapsibleSection";
import { TrendingUp } from "lucide-react";

/* ── Compute per-scene-chunk voice metrics for top characters ── */

interface TrajectoryPoint {
  sceneChunk: number;
  questionRate: number;
  exclamationRate: number;
  avgLineLen: number;
}

interface CharacterTrajectory {
  name: string;
  points: TrajectoryPoint[];
  color: string;
}

const TRAJECTORY_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent-foreground))",
  "hsl(260 60% 60%)",
  "hsl(30 80% 55%)",
  "hsl(160 60% 45%)",
];

function computeTrajectories(parsed: FountainParseResult, chunkSize: number = 3): CharacterTrajectory[] {
  const { elements, scenes, stats } = parsed;
  // Get top 5 characters by dialogue count
  const topChars = stats.uniqueCharacters
    .map((name) => ({ name, count: stats.characterDialogueCounts[name] || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((c) => c.name);

  if (topChars.length === 0 || scenes.length === 0) return [];

  // Group scenes into chunks
  const numChunks = Math.ceil(scenes.length / chunkSize);
  
  return topChars.map((charName, ci) => {
    const points: TrajectoryPoint[] = [];

    for (let chunk = 0; chunk < numChunks; chunk++) {
      const startScene = chunk * chunkSize;
      const endScene = Math.min(startScene + chunkSize, scenes.length);
      
      // Collect dialogue lines in this chunk for this character
      const lines: string[] = [];
      let currentChar = "";

      for (let si = startScene; si < endScene; si++) {
        const elStart = scenes[si].elementIndex;
        const elEnd = si < scenes.length - 1 ? scenes[si + 1].elementIndex : elements.length;

        for (let ei = elStart; ei < elEnd; ei++) {
          const el = elements[ei];
          if (el.type === "character") {
            currentChar = el.text.replace(/\s*\(.*\)$/, "").trim();
          } else if (el.type === "dialogue" && currentChar === charName) {
            lines.push(el.text);
          } else if (el.type !== "parenthetical") {
            currentChar = "";
          }
        }
      }

      if (lines.length === 0) {
        points.push({ sceneChunk: chunk, questionRate: 0, exclamationRate: 0, avgLineLen: 0 });
      } else {
        const total = lines.length;
        points.push({
          sceneChunk: chunk,
          questionRate: Math.round((lines.filter((l) => l.includes("?")).length / total) * 100),
          exclamationRate: Math.round((lines.filter((l) => l.includes("!")).length / total) * 100),
          avgLineLen: Math.round(lines.reduce((s, l) => s + l.length, 0) / total),
        });
      }
    }

    return { name: charName, points, color: TRAJECTORY_COLORS[ci % TRAJECTORY_COLORS.length] };
  });
}

/* ── SVG Trajectory Viz ── */

function TrajectoryChart({ trajectories }: { trajectories: CharacterTrajectory[] }) {
  if (trajectories.length === 0 || trajectories[0].points.length === 0) {
    return <p className="text-[10px] font-mono text-muted-foreground text-center py-4">Not enough data</p>;
  }

  const width = 400, height = 200, pad = 30;
  const maxChunks = trajectories[0].points.length;
  // Y axis: use avgLineLen normalized
  const allVals = trajectories.flatMap((t) => t.points.map((p) => p.avgLineLen));
  const maxVal = Math.max(1, ...allVals);

  const xScale = (i: number) => pad + (i / Math.max(1, maxChunks - 1)) * (width - pad * 2);
  const yScale = (v: number) => height - pad - (v / maxVal) * (height - pad * 2);

  return (
    <div className="space-y-2">
      <p className="text-[9px] font-mono text-muted-foreground">Y-axis: avg line length · X-axis: scene chunks</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={pad} x2={width - pad} y1={yScale(maxVal * f)} y2={yScale(maxVal * f)} className="stroke-border/20" strokeWidth={0.5} />
        ))}
        {/* X labels */}
        {Array.from({ length: maxChunks }, (_, i) => (
          <text key={i} x={xScale(i)} y={height - 8} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 8, fontFamily: "monospace" }}>
            {i + 1}
          </text>
        ))}

        {/* Trajectories */}
        {trajectories.map((t) => {
          const pathD = t.points.map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(i)} ${yScale(p.avgLineLen)}`).join(" ");
          return (
            <g key={t.name}>
              <path d={pathD} fill="none" stroke={t.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.8} />
              {t.points.map((p, i) => (
                <circle key={i} cx={xScale(i)} cy={yScale(p.avgLineLen)} r={2.5} fill={t.color} />
              ))}
            </g>
          );
        })}
      </svg>
      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {trajectories.map((t) => (
          <div key={t.name} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: t.color }} />
            <span className="text-[9px] font-mono text-muted-foreground">{t.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Main ── */

interface CharacterTrajectoryPanelProps {
  parsed: FountainParseResult;
}

export default function CharacterTrajectoryPanel({ parsed }: CharacterTrajectoryPanelProps) {
  const trajectories = useMemo(() => computeTrajectories(parsed), [parsed]);

  if (trajectories.length === 0) return null;

  return (
    <CollapsibleSection
      icon={<TrendingUp className="h-3.5 w-3.5 text-primary" />}
      title="Voice Trajectory"
      subtitle="How character voice evolves across scenes"
    >
      <TrajectoryChart trajectories={trajectories} />
    </CollapsibleSection>
  );
}
