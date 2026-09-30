import { useMemo, useState } from "react";
import { FountainParseResult } from "@/lib/fountain-parser";
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend, CartesianGrid } from "recharts";
import { TrendingUp, AlertTriangle, Flag, Activity, Zap } from "lucide-react";

interface ArcTrajectoryPanelProps {
  parsed: FountainParseResult;
}

interface CharArcData {
  name: string;
  trajectory: { scene: string; presence: number; dialogue: number; cumulative: number }[];
  totalDialogue: number;
}

export default function ArcTrajectoryPanel({ parsed }: ArcTrajectoryPanelProps) {
  const { scenes, elements } = parsed;

  const characterArcs = useMemo(() => {
    const charMap = new Map<string, Map<number, number>>();
    let currentChar = "";
    scenes.forEach((scene, sceneIdx) => {
      const nextElIdx = sceneIdx < scenes.length - 1 ? scenes[sceneIdx + 1].elementIndex : elements.length;
      elements.slice(scene.elementIndex, nextElIdx).forEach(el => {
        if (el.type === "character") {
          currentChar = el.text.replace(/\s*\(.*\)$/, "").trim();
          if (!charMap.has(currentChar)) charMap.set(currentChar, new Map());
          charMap.get(currentChar)!.set(sceneIdx, charMap.get(currentChar)!.get(sceneIdx) || 0);
        }
        if (el.type === "dialogue" && currentChar) {
          const m = charMap.get(currentChar)!;
          m.set(sceneIdx, (m.get(sceneIdx) || 0) + 1);
        }
      });
    });

    // Top 5 characters
    const sorted = Array.from(charMap.entries())
      .map(([name, sceneMap]) => ({ name, sceneMap, total: Array.from(sceneMap.values()).reduce((s, v) => s + v, 0) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    return sorted.map(({ name, sceneMap, total }): CharArcData => {
      let cumulative = 0;
      const trajectory = scenes.map((_, idx) => {
        const d = sceneMap.get(idx) || 0;
        cumulative += d;
        return {
          scene: `S${idx + 1}`,
          presence: sceneMap.has(idx) ? 1 : 0,
          dialogue: d,
          cumulative,
        };
      });
      return { name, trajectory, totalDialogue: total };
    });
  }, [scenes, elements]);

  const [selectedChars, setSelectedChars] = useState<string[]>(
    characterArcs.length > 0 ? [characterArcs[0].name] : []
  );

  const toggle = (name: string) => {
    setSelectedChars(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  };

  const COLORS = ["hsl(var(--primary))", "hsl(var(--destructive))", "hsl(152,60%,42%)", "hsl(38,92%,55%)", "hsl(280,55%,55%)"];

  // Merged data for overlay chart
  const mergedData = useMemo(() => {
    return scenes.map((_, idx) => {
      const row: Record<string, string | number> = { scene: `S${idx + 1}` };
      characterArcs.forEach(c => {
        if (selectedChars.includes(c.name)) {
          row[c.name] = c.trajectory[idx]?.dialogue || 0;
          row[`${c.name}_cum`] = c.trajectory[idx]?.cumulative || 0;
        }
      });
      return row;
    });
  }, [scenes, characterArcs, selectedChars]);

  // Diagnostic stats
  const diagnostics = useMemo(() => {
    return characterArcs.filter(c => selectedChars.includes(c.name)).map(c => {
      const shifts = c.trajectory.map((t, i) =>
        i > 0 ? Math.abs(t.dialogue - c.trajectory[i - 1].dialogue) : 0
      );
      const avgShift = shifts.reduce((s, v) => s + v, 0) / Math.max(shifts.length, 1);
      const maxShift = Math.max(...shifts);
      const maxShiftScene = shifts.indexOf(maxShift);
      const silentScenes = c.trajectory.filter(t => t.dialogue === 0).length;
      return { name: c.name, avgShift: Math.round(avgShift * 10) / 10, maxShift, maxShiftScene, silentScenes, totalScenes: scenes.length };
    });
  }, [characterArcs, selectedChars, scenes]);

  if (characterArcs.length === 0) {
    return (
      <div className="p-8 text-center">
        <TrendingUp className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No character arcs detected.</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5 mt-0">
      <div className="flex items-center gap-2 mb-2">
        <TrendingUp className="h-4 w-4 text-primary" />
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Arc Trajectory</span>
      </div>

      {/* Character selector */}
      <div className="flex flex-wrap gap-1.5">
        {characterArcs.map((c, i) => (
          <button key={c.name} onClick={() => toggle(c.name)}
            className={`inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded-full border transition-colors ${
              selectedChars.includes(c.name)
                ? "bg-primary/10 text-primary border-primary/20"
                : "bg-secondary text-muted-foreground border-border hover:text-foreground"
            }`}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
            {c.name}
          </button>
        ))}
      </div>

      {/* Main chart */}
      {selectedChars.length > 0 && (
        <div className="border border-border rounded-lg p-4">
          <h3 className="text-xs font-semibold mb-3">Dialogue Intensity Over Scenes</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={mergedData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="scene" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} />
                {selectedChars.map((name, i) => {
                  const charIdx = characterArcs.findIndex(c => c.name === name);
                  return (
                    <Area key={name} type="monotone" dataKey={name} name={name}
                      stroke={COLORS[charIdx % COLORS.length]} fill={COLORS[charIdx % COLORS.length]}
                      fillOpacity={0.1} strokeWidth={2} dot={{ r: 2 }} />
                  );
                })}
                <Legend wrapperStyle={{ fontSize: 10 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Cumulative chart */}
      {selectedChars.length > 0 && (
        <div className="border border-border rounded-lg p-4">
          <h3 className="text-xs font-semibold mb-3">Cumulative Dialogue Growth</h3>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={mergedData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="scene" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} />
                {selectedChars.map((name, i) => {
                  const charIdx = characterArcs.findIndex(c => c.name === name);
                  return (
                    <Line key={name} type="monotone" dataKey={`${name}_cum`} name={`${name} (cum.)`}
                      stroke={COLORS[charIdx % COLORS.length]} strokeWidth={2} dot={{ r: 2 }} />
                  );
                })}
                <Legend wrapperStyle={{ fontSize: 10 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Diagnostics */}
      {diagnostics.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {diagnostics.map(d => (
            <div key={d.name} className="border border-border rounded-lg p-3">
              <h4 className="text-xs font-semibold mb-2">{d.name}</h4>
              <div className="space-y-1 text-[10px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Avg Scene Shift</span>
                  <span className="font-mono">{d.avgShift}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Peak Shift</span>
                  <span className="font-mono">{d.maxShift} (S{d.maxShiftScene + 1})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Silent Scenes</span>
                  <span className="font-mono">{d.silentScenes}/{d.totalScenes}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
