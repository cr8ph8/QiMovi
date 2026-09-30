/**
 * FranchiseCharacterNetwork — Interactive SVG character co-occurrence network.
 * Features: hover tooltips, sentiment coloring, installment ring indicators,
 * clickable detail panel, edge thickness legend.
 */
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { CharacterSentiment } from "@/lib/character";

export interface NetworkCharacter {
  name: string;
  installmentCount: number;
  totalLines: number;
  sentiment?: CharacterSentiment;
  distinctiveness?: number;
  installmentIndices?: number[];
  linesPerInstallment?: Record<number, number>;
}

export interface NetworkEdge {
  source: string;
  target: string;
  sharedInstallments: number;
}

interface Props {
  characters: NetworkCharacter[];
  edges: NetworkEdge[];
  installmentLabels?: string[];
}

const W = 560;
const H = 480;
const CX = W / 2;
const CY = H / 2 + 10;

const INSTALLMENT_COLORS = [
  "hsl(var(--primary))", "hsl(30 80% 55%)", "hsl(160 60% 50%)", "hsl(350 60% 55%)",
  "hsl(280 50% 55%)", "hsl(200 70% 50%)", "hsl(90 50% 45%)", "hsl(50 80% 50%)",
  "hsl(320 50% 50%)", "hsl(var(--accent))",
];

function sentimentFill(s?: CharacterSentiment): string {
  if (!s) return "hsl(var(--muted-foreground) / 0.5)";
  switch (s.label) {
    case "positive": return "hsl(160 60% 45%)";
    case "negative": return "hsl(0 60% 50%)";
    case "mixed": return "hsl(40 80% 50%)";
    default: return "hsl(var(--muted-foreground) / 0.5)";
  }
}

export default function FranchiseCharacterNetwork({ characters, edges, installmentLabels = [] }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<"sentiment" | "installment">("sentiment");

  const { nodes, links, maxLines } = useMemo(() => {
    if (characters.length === 0) return { nodes: [] as any[], links: [] as any[], maxLines: 1 };

    const sorted = [...characters].sort(
      (a, b) => b.installmentCount - a.installmentCount || b.totalLines - a.totalLines
    );
    const focal = sorted[0];
    const others = sorted.slice(1, 20);
    const ml = Math.max(...sorted.map((c) => c.totalLines), 1);

    const totalDialogue = sorted.reduce((s, c) => s + c.totalLines, 0);
    const focalNode = {
      ...focal,
      id: focal.name,
      x: CX,
      y: CY,
      radius: 12 + (focal.totalLines / totalDialogue) * 40,
      role: "focal" as const,
    };

    const angleStep = (2 * Math.PI) / Math.max(others.length, 1);
    const ringRadius = 155;

    const otherNodes = others.map((c, i) => {
      const angle = -Math.PI / 2 + i * angleStep;
      const r = 6 + (c.totalLines / totalDialogue) * 35;
      return {
        ...c,
        id: c.name,
        x: CX + Math.cos(angle) * ringRadius,
        y: CY + Math.sin(angle) * ringRadius,
        radius: Math.max(r, 5),
        role: c.installmentCount >= 3 ? ("recurring" as const) : ("single" as const),
      };
    });

    const allNodes = [focalNode, ...otherNodes];
    const nodeMap = new Map(allNodes.map((n) => [n.id, n]));

    const links = edges
      .filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map((e) => ({
        ...e,
        x1: nodeMap.get(e.source)!.x,
        y1: nodeMap.get(e.source)!.y,
        x2: nodeMap.get(e.target)!.x,
        y2: nodeMap.get(e.target)!.y,
      }));

    return { nodes: allNodes, links, maxLines: ml };
  }, [characters, edges]);

  const selectedChar = useMemo(
    () => (selected ? characters.find((c) => c.name === selected) : null),
    [selected, characters]
  );

  if (characters.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-xs text-muted-foreground font-mono">
        No character data available
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Color mode toggle */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-muted-foreground">Color by:</span>
        {(["sentiment", "installment"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setColorMode(mode)}
            className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
              colorMode === mode
                ? "bg-primary/10 border-primary/30 text-primary"
                : "border-border/30 text-muted-foreground hover:text-foreground"
            }`}
          >
            {mode === "sentiment" ? "Sentiment" : "Installment"}
          </button>
        ))}
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ minHeight: 320 }}>
          {/* Edges */}
          {links.map((link, i) => (
            <line
              key={i}
              x1={link.x1} y1={link.y1} x2={link.x2} y2={link.y2}
              stroke={link.sharedInstallments >= 3 ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"}
              strokeWidth={Math.min(link.sharedInstallments, 5) * 0.8}
              strokeOpacity={
                hovered
                  ? link.source === hovered || link.target === hovered ? 0.7 : 0.08
                  : link.sharedInstallments >= 3 ? 0.5 : 0.15
              }
              strokeDasharray={link.sharedInstallments < 2 ? "4 3" : undefined}
              className="transition-opacity duration-200"
            />
          ))}

          {/* Nodes */}
          {nodes.map((node) => {
            const isActive = hovered === node.id || selected === node.id;
            const dimmed = hovered && hovered !== node.id;
            const fill = colorMode === "sentiment"
              ? sentimentFill(node.sentiment)
              : node.installmentIndices?.length
                ? INSTALLMENT_COLORS[(node.installmentIndices[0]) % INSTALLMENT_COLORS.length]
                : "hsl(var(--muted-foreground) / 0.3)";

            return (
              <g
                key={node.id}
                className="cursor-pointer transition-opacity duration-200"
                opacity={dimmed ? 0.3 : 1}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => setSelected(selected === node.id ? null : node.id)}
              >
                {/* Glow */}
                {(node.role === "focal" || isActive) && (
                  <circle cx={node.x} cy={node.y} r={node.radius + 8}
                    fill={isActive ? "hsl(var(--primary))" : fill} opacity={0.15} />
                )}

                {/* Main circle */}
                <circle
                  cx={node.x} cy={node.y} r={node.radius}
                  fill={fill}
                  stroke={isActive ? "hsl(var(--primary))" : "hsl(var(--border))"}
                  strokeWidth={isActive ? 2.5 : 1}
                  opacity={0.85}
                />

                {/* Installment ring indicators */}
                {node.installmentIndices?.slice(0, 6).map((idx, dotI) => {
                  const dotAngle = (-Math.PI / 2) + (dotI / Math.max(node.installmentIndices!.length, 1)) * Math.PI * 2;
                  const dotR = node.radius + 5;
                  return (
                    <circle
                      key={dotI}
                      cx={node.x + Math.cos(dotAngle) * dotR}
                      cy={node.y + Math.sin(dotAngle) * dotR}
                      r={2}
                      fill={INSTALLMENT_COLORS[idx % INSTALLMENT_COLORS.length]}
                    />
                  );
                })}

                {/* Label */}
                <text
                  x={node.x} y={node.y + node.radius + 14}
                  textAnchor="middle"
                  className={`text-[9px] font-mono ${
                    node.role === "focal" || isActive ? "fill-primary font-semibold" : "fill-muted-foreground"
                  }`}
                >
                  {node.id.length > 16 ? node.id.slice(0, 16) + "…" : node.id}
                </text>
              </g>
            );
          })}

          {/* Hover tooltip */}
          {hovered && (() => {
            const node = nodes.find((n) => n.id === hovered);
            if (!node) return null;
            const tx = Math.min(Math.max(node.x, 100), W - 100);
            const ty = node.y - node.radius - 50;
            return (
              <foreignObject x={tx - 80} y={Math.max(ty, 5)} width={160} height={60} className="pointer-events-none">
                <div className="bg-popover/95 backdrop-blur border border-border rounded-lg px-2.5 py-1.5 shadow-lg">
                  <p className="text-[10px] font-mono font-semibold text-foreground truncate">{node.id}</p>
                  <div className="flex gap-2 text-[9px] font-mono text-muted-foreground mt-0.5">
                    <span>{node.installmentCount} inst.</span>
                    <span>{node.totalLines} lines</span>
                    {node.sentiment && <span className="capitalize">{node.sentiment.label}</span>}
                  </div>
                  {node.distinctiveness != null && (
                    <div className="text-[8px] font-mono text-muted-foreground/70 mt-0.5">
                      Distinctiveness: {node.distinctiveness}%
                    </div>
                  )}
                </div>
              </foreignObject>
            );
          })()}

          {/* Edge legend */}
          <g transform={`translate(16, ${H - 50})`}>
            <text className="fill-muted-foreground text-[8px] font-mono" y={0}>Edge Weight</text>
            <line x1={0} y1={8} x2={20} y2={8} stroke="hsl(var(--muted-foreground))" strokeWidth={0.8} strokeDasharray="4 3" opacity={0.5} />
            <text x={24} y={11} className="fill-muted-foreground text-[7px] font-mono">1 shared</text>
            <line x1={0} y1={18} x2={20} y2={18} stroke="hsl(var(--primary))" strokeWidth={2.4} opacity={0.6} />
            <text x={24} y={21} className="fill-muted-foreground text-[7px] font-mono">3+ shared</text>
          </g>

          {/* Sentiment legend */}
          {colorMode === "sentiment" && (
            <g transform={`translate(${W - 120}, ${H - 50})`}>
              {([["positive", "hsl(160 60% 45%)"], ["negative", "hsl(0 60% 50%)"], ["mixed", "hsl(40 80% 50%)"], ["neutral", "hsl(var(--muted-foreground) / 0.5)"]] as const).map(([label, color], i) => (
                <g key={label} transform={`translate(${(i % 2) * 55}, ${Math.floor(i / 2) * 12})`}>
                  <circle cx={4} cy={0} r={3} fill={color} />
                  <text x={10} y={3} className="fill-muted-foreground text-[7px] font-mono capitalize">{label}</text>
                </g>
              ))}
            </g>
          )}
        </svg>

        {/* Selected character detail panel */}
        {selectedChar && (
          <div className="absolute bottom-2 right-2 w-56 bg-popover/95 backdrop-blur border border-border rounded-xl p-3 shadow-xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-display font-semibold text-foreground truncate">{selectedChar.name}</span>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
            </div>
            <div className="space-y-1.5 text-[10px] font-mono text-muted-foreground">
              <div className="flex justify-between">
                <span>Installments</span><span className="text-foreground">{selectedChar.installmentCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Total Lines</span><span className="text-foreground">{selectedChar.totalLines}</span>
              </div>
              {selectedChar.sentiment && (
                <div className="flex justify-between">
                  <span>Sentiment</span>
                  <Badge variant="outline" className="text-[9px] font-mono capitalize h-4 px-1.5">{selectedChar.sentiment.label}</Badge>
                </div>
              )}
              {selectedChar.distinctiveness != null && (
                <div className="flex justify-between">
                  <span>Distinctiveness</span><span className="text-foreground">{selectedChar.distinctiveness}%</span>
                </div>
              )}
              {/* Per-installment lines */}
              {selectedChar.linesPerInstallment && Object.keys(selectedChar.linesPerInstallment).length > 0 && (
                <div className="pt-1.5 border-t border-border/30 space-y-1 mt-1">
                  <span className="text-[9px] text-muted-foreground/70 uppercase">Lines per Installment</span>
                  {Object.entries(selectedChar.linesPerInstallment).map(([idx, lines]) => (
                    <div key={idx} className="flex justify-between">
                      <span className="truncate max-w-[120px]">
                        {installmentLabels[Number(idx)] || `#${Number(idx) + 1}`}
                      </span>
                      <span className="text-foreground">{lines}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
