/**
 * CharacterInfluenceNetwork — SVG standard view
 * Shows character co-occurrence network with protagonist as focal node.
 * Adapted from Hampton Lab's CitationNetworkView pattern.
 */
import { useMemo } from "react";
import type { FountainParseResult } from "@/lib/fountain-parser";
import { analyzeCharacters, type CharacterProfile } from "@/lib/character";

interface Props {
  parsed: FountainParseResult;
}

interface NodeData {
  id: string;
  x: number;
  y: number;
  radius: number;
  role: "focal" | "antecedent" | "descendant";
  dialogueShare: number;
}

interface EdgeData {
  source: string;
  target: string;
  weight: number;
}

function buildCoOccurrenceEdges(parsed: FountainParseResult, profiles: CharacterProfile[]): EdgeData[] {
  const { elements } = parsed;
  const edges: EdgeData[] = [];
  const pairMap = new Map<string, number>();

  let sceneChars: string[] = [];
  for (const el of elements) {
    if (el.type === "scene_heading") {
      // Process previous scene
      for (let i = 0; i < sceneChars.length; i++) {
        for (let j = i + 1; j < sceneChars.length; j++) {
          const key = [sceneChars[i], sceneChars[j]].sort().join("||");
          pairMap.set(key, (pairMap.get(key) || 0) + 1);
        }
      }
      sceneChars = [];
    } else if (el.type === "character") {
      const name = el.text.replace(/\s*\(.*\)$/, "").trim();
      if (!sceneChars.includes(name)) sceneChars.push(name);
    }
  }
  // Process last scene
  for (let i = 0; i < sceneChars.length; i++) {
    for (let j = i + 1; j < sceneChars.length; j++) {
      const key = [sceneChars[i], sceneChars[j]].sort().join("||");
      pairMap.set(key, (pairMap.get(key) || 0) + 1);
    }
  }

  const profileNames = new Set(profiles.map(p => p.name));
  pairMap.forEach((weight, key) => {
    const [s, t] = key.split("||");
    if (profileNames.has(s) && profileNames.has(t)) {
      edges.push({ source: s, target: t, weight });
    }
  });

  return edges.sort((a, b) => b.weight - a.weight).slice(0, 30);
}

function layoutNodes(profiles: CharacterProfile[], width: number, height: number): NodeData[] {
  if (profiles.length === 0) return [];
  const cx = width / 2;
  const cy = height / 2;
  const maxRadius = Math.min(width, height) * 0.35;

  return profiles.slice(0, 12).map((p, i) => {
    const isFocal = i === 0;
    const angle = (i - 1) * ((2 * Math.PI) / Math.max(profiles.length - 1, 1)) - Math.PI / 2;
    const dist = isFocal ? 0 : maxRadius * (0.6 + 0.4 * (1 - p.dialogueShareRatio / 100));
    const nodeRadius = isFocal ? 24 : Math.max(8, 6 + p.dialogueShareRatio * 0.4);

    return {
      id: p.name,
      x: isFocal ? cx : cx + Math.cos(angle) * dist,
      y: isFocal ? cy : cy + Math.sin(angle) * dist,
      radius: nodeRadius,
      role: isFocal ? "focal" as const : i <= profiles.length / 2 ? "antecedent" as const : "descendant" as const,
      dialogueShare: p.dialogueShareRatio,
    };
  });
}

export default function CharacterInfluenceNetwork({ parsed }: Props) {
  const profiles = useMemo(() => analyzeCharacters(parsed), [parsed]);
  const width = 480;
  const height = 360;
  const nodes = useMemo(() => layoutNodes(profiles, width, height), [profiles]);
  const edges = useMemo(() => buildCoOccurrenceEdges(parsed, profiles), [parsed, profiles]);
  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  if (profiles.length < 2) {
    return <div className="text-xs text-muted-foreground text-center py-8 font-mono">Not enough characters for network view.</div>;
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" style={{ maxHeight: 360 }}>
      <defs>
        <radialGradient id="cin-focal-grad">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.9" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.4" />
        </radialGradient>
        <radialGradient id="cin-ant-grad">
          <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity="0.8" />
          <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0.3" />
        </radialGradient>
        <radialGradient id="cin-desc-grad">
          <stop offset="0%" stopColor="hsl(var(--muted-foreground))" stopOpacity="0.7" />
          <stop offset="100%" stopColor="hsl(var(--muted-foreground))" stopOpacity="0.2" />
        </radialGradient>
      </defs>

      {/* Edges */}
      {edges.map((e, i) => {
        const s = nodeMap.get(e.source);
        const t = nodeMap.get(e.target);
        if (!s || !t) return null;
        const opacity = Math.min(0.8, 0.15 + e.weight * 0.1);
        return (
          <line
            key={i}
            x1={s.x} y1={s.y} x2={t.x} y2={t.y}
            stroke="hsl(var(--primary))"
            strokeOpacity={opacity}
            strokeWidth={Math.min(3, 0.5 + e.weight * 0.4)}
          />
        );
      })}

      {/* Nodes */}
      {nodes.map((n) => (
        <g key={n.id}>
          <circle
            cx={n.x} cy={n.y} r={n.radius}
            fill={n.role === "focal" ? "url(#cin-focal-grad)" : n.role === "antecedent" ? "url(#cin-ant-grad)" : "url(#cin-desc-grad)"}
            stroke={n.role === "focal" ? "hsl(var(--primary))" : "hsl(var(--border))"}
            strokeWidth={n.role === "focal" ? 2 : 1}
          />
          <text
            x={n.x} y={n.y + n.radius + 12}
            textAnchor="middle"
            className="fill-foreground"
            style={{ fontSize: n.role === "focal" ? 10 : 8, fontFamily: "monospace" }}
          >
            {n.id.length > 12 ? n.id.slice(0, 11) + "…" : n.id}
          </text>
          {n.role === "focal" && (
            <text
              x={n.x} y={n.y + 3}
              textAnchor="middle"
              className="fill-primary-foreground"
              style={{ fontSize: 7, fontFamily: "monospace", fontWeight: 600 }}
            >
              {n.dialogueShare}%
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
