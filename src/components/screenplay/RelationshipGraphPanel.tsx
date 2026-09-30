import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { FountainParseResult } from "@/lib/fountain-parser";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { Network, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface RelationshipGraphPanelProps {
  parsed: FountainParseResult;
}

interface CharacterNode {
  name: string;
  dialogueCount: number;
  sceneCount: number;
}

interface RelationshipEdge {
  source: string;
  target: string;
  coOccurrences: number;
  sceneHistory: { scene: number; sourceDial: number; targetDial: number }[];
}

const NODE_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--destructive))",
  "hsl(152,60%,42%)",
  "hsl(38,92%,55%)",
  "hsl(280,55%,55%)",
  "hsl(185,65%,42%)",
];

export default function RelationshipGraphPanel({ parsed }: RelationshipGraphPanelProps) {
  const { scenes, elements } = parsed;
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);

  // Extract characters and their scene presence
  const { characters, edges } = useMemo(() => {
    const charMap = new Map<string, { scenes: Set<number>; dialogueCount: number; sceneDialogue: Map<number, number> }>();

    scenes.forEach((scene, sceneIdx) => {
      const nextElIdx = sceneIdx < scenes.length - 1 ? scenes[sceneIdx + 1].elementIndex : elements.length;
      const sceneElements = elements.slice(scene.elementIndex, nextElIdx);
      let currentChar = "";
      sceneElements.forEach((el) => {
        if (el.type === "character") {
          currentChar = el.text.replace(/\s*\(.*\)$/, "").trim();
          if (!charMap.has(currentChar)) charMap.set(currentChar, { scenes: new Set(), dialogueCount: 0, sceneDialogue: new Map() });
          charMap.get(currentChar)!.scenes.add(sceneIdx);
        }
        if (el.type === "dialogue" && currentChar) {
          const data = charMap.get(currentChar);
          if (data) {
            data.dialogueCount++;
            data.sceneDialogue.set(sceneIdx, (data.sceneDialogue.get(sceneIdx) || 0) + 1);
          }
        }
      });
    });

    // Top 8 characters by dialogue
    const sorted = Array.from(charMap.entries())
      .sort((a, b) => b[1].dialogueCount - a[1].dialogueCount)
      .slice(0, 8);

    const chars: CharacterNode[] = sorted.map(([name, data]) => ({
      name,
      dialogueCount: data.dialogueCount,
      sceneCount: data.scenes.size,
    }));

    const charNames = chars.map(c => c.name);
    const edgeList: RelationshipEdge[] = [];

    for (let i = 0; i < charNames.length; i++) {
      for (let j = i + 1; j < charNames.length; j++) {
        const aScenes = charMap.get(charNames[i])!.scenes;
        const bScenes = charMap.get(charNames[j])!.scenes;
        const shared = Array.from(aScenes).filter(s => bScenes.has(s));
        if (shared.length > 0) {
          edgeList.push({
            source: charNames[i],
            target: charNames[j],
            coOccurrences: shared.length,
            sceneHistory: shared.map(s => ({
              scene: s + 1,
              sourceDial: charMap.get(charNames[i])!.sceneDialogue.get(s) || 0,
              targetDial: charMap.get(charNames[j])!.sceneDialogue.get(s) || 0,
            })),
          });
        }
      }
    }

    edgeList.sort((a, b) => b.coOccurrences - a.coOccurrences);
    return { characters: chars, edges: edgeList };
  }, [scenes, elements]);

  const maxCoOccurrence = Math.max(1, ...edges.map(e => e.coOccurrences));
  const selectedRel = selectedEdge ? edges.find(e => `${e.source}->${e.target}` === selectedEdge) : null;

  // Positions for network
  const positions = useMemo(() => {
    const n = characters.length;
    return characters.map((_, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      return { x: 50 + 35 * Math.cos(angle), y: 50 + 35 * Math.sin(angle) };
    });
  }, [characters]);

  const charPosMap = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    characters.forEach((c, i) => map.set(c.name, positions[i]));
    return map;
  }, [characters, positions]);

  if (characters.length < 2) {
    return (
      <div className="p-8 text-center">
        <Network className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Not enough characters detected for a relationship graph.</p>
      </div>
    );
  }

  const historyData = selectedRel?.sceneHistory.map(h => ({
    scene: `S${h.scene}`,
    [selectedRel.source]: h.sourceDial,
    [selectedRel.target]: h.targetDial,
  })) ?? [];

  return (
    <div className="p-4 space-y-6 mt-0">
      <div className="flex items-center gap-2 mb-3">
        <Network className="h-4 w-4 text-primary" />
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Relationship Network</span>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Network Map */}
        <div className="lg:col-span-2 border border-border rounded-lg p-4">
          <div className="relative h-[350px]">
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
              {/* Edges */}
              {edges.map(e => {
                const from = charPosMap.get(e.source);
                const to = charPosMap.get(e.target);
                if (!from || !to) return null;
                const key = `${e.source}->${e.target}`;
                const isSelected = selectedEdge === key;
                const opacity = isSelected ? 0.9 : 0.15 + (e.coOccurrences / maxCoOccurrence) * 0.35;
                return (
                  <line key={key} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                    stroke={isSelected ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"}
                    strokeWidth={isSelected ? 0.6 : 0.3}
                    opacity={opacity}
                    className="cursor-pointer"
                    onClick={() => setSelectedEdge(key)} />
                );
              })}
              {/* Nodes */}
              {characters.map((c, i) => (
                <g key={c.name} transform={`translate(${positions[i].x},${positions[i].y})`}>
                  <circle r={2 + (c.dialogueCount / Math.max(1, characters[0].dialogueCount)) * 3}
                    fill={NODE_COLORS[i % NODE_COLORS.length]} opacity={0.8} />
                  <text y={-5} textAnchor="middle" fontSize="2.5" fill="hsl(var(--foreground))" fontWeight="600">
                    {c.name.length > 10 ? c.name.slice(0, 10) + "…" : c.name}
                  </text>
                </g>
              ))}
            </svg>
          </div>

          {/* Edge selector pills */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            {edges.slice(0, 12).map(e => {
              const key = `${e.source}->${e.target}`;
              return (
                <button key={key} onClick={() => setSelectedEdge(selectedEdge === key ? null : key)}
                  className={cn(
                    "text-[10px] font-mono px-2 py-0.5 rounded-full border transition-colors",
                    selectedEdge === key
                      ? "bg-primary/10 text-primary border-primary/20"
                      : "bg-secondary text-muted-foreground border-border hover:text-foreground"
                  )}>
                  {e.source.split(" ").pop()} <ArrowRight className="w-2.5 h-2.5 inline mx-0.5" /> {e.target.split(" ").pop()}
                  <span className="ml-1 opacity-60">{e.coOccurrences}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          {selectedRel ? (
            <>
              <div className="border border-border rounded-lg p-4">
                <div className="text-sm font-semibold mb-3">
                  {selectedRel.source.split(" ").pop()} ↔ {selectedRel.target.split(" ").pop()}
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Co-occurrences</span>
                    <span className="font-mono">{selectedRel.coOccurrences} scenes</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Interaction Density</span>
                    <span className="font-mono">{Math.round((selectedRel.coOccurrences / scenes.length) * 100)}%</span>
                  </div>
                </div>
              </div>

              {historyData.length > 1 && (
                <div className="border border-border rounded-lg p-4">
                  <h3 className="text-xs font-semibold mb-3">Dialogue per Scene</h3>
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={historyData}>
                        <XAxis dataKey="scene" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                        <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} />
                        <Line type="monotone" dataKey={selectedRel.source} stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                        <Line type="monotone" dataKey={selectedRel.target} stroke="hsl(var(--destructive))" strokeWidth={2} dot={{ r: 3 }} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="border border-border rounded-lg p-4 text-center text-sm text-muted-foreground">
              Select a relationship edge to inspect dialogue dynamics
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
