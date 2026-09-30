import { useMemo, useState } from "react";
import { parseFountain } from "@/lib/fountain-parser";
import { resolveCharacterName } from "@/lib/character-aliases";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend, CartesianGrid } from "recharts";
import { TrendingUp } from "lucide-react";

interface InstallmentScript {
  title: string;
  script_text: string;
}

interface CrossEntryArcTrajectoryPanelProps {
  installments: InstallmentScript[];
  aliasMap?: Map<string, string>;
}

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--destructive))",
  "hsl(152,60%,42%)",
  "hsl(38,92%,55%)",
  "hsl(280,55%,55%)",
];

interface CharArcCross {
  name: string;
  /** Each point = one installment, value = total dialogue lines in that installment */
  installmentDialogue: number[];
  total: number;
}

export default function CrossEntryArcTrajectoryPanel({ installments, aliasMap }: CrossEntryArcTrajectoryPanelProps) {
  const characterArcs = useMemo(() => {
    const charMap = new Map<string, number[]>();

    installments.forEach((inst, idx) => {
      let parsed;
      try { parsed = parseFountain(inst.script_text); } catch { return; }
      const { scenes, elements } = parsed;

      const localCounts = new Map<string, number>();
      let currentChar = "";

      scenes.forEach((scene, sceneIdx) => {
        const nextElIdx = sceneIdx < scenes.length - 1 ? scenes[sceneIdx + 1].elementIndex : elements.length;
        elements.slice(scene.elementIndex, nextElIdx).forEach(el => {
          if (el.type === "character") {
            const rawName = el.text.replace(/\s*\(.*\)$/, "").trim().toUpperCase();
            currentChar = aliasMap ? resolveCharacterName(rawName, aliasMap) : rawName;
            if (!localCounts.has(currentChar)) localCounts.set(currentChar, 0);
          }
          if (el.type === "dialogue" && currentChar) {
            localCounts.set(currentChar, (localCounts.get(currentChar) || 0) + 1);
          }
        });
      });

      localCounts.forEach((count, name) => {
        if (!charMap.has(name)) {
          charMap.set(name, new Array(installments.length).fill(0));
        }
        charMap.get(name)![idx] = count;
      });
    });

    return Array.from(charMap.entries())
      .map(([name, installmentDialogue]): CharArcCross => ({
        name,
        installmentDialogue,
        total: installmentDialogue.reduce((s, v) => s + v, 0),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [installments]);

  const [selectedChars, setSelectedChars] = useState<string[]>(
    characterArcs.slice(0, 3).map(c => c.name)
  );

  const toggle = (name: string) => {
    setSelectedChars(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };

  const chartData = useMemo(() => {
    return installments.map((inst, idx) => {
      const row: Record<string, string | number> = { installment: inst.title.length > 18 ? inst.title.slice(0, 16) + "…" : inst.title };
      characterArcs.forEach(c => {
        if (selectedChars.includes(c.name)) {
          row[c.name] = c.installmentDialogue[idx];
        }
      });
      return row;
    });
  }, [installments, characterArcs, selectedChars]);

  if (characterArcs.length === 0) {
    return (
      <div className="p-8 text-center">
        <TrendingUp className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Not enough dialogue data across installments.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" />
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Cross-Entry Arc Trajectory</span>
      </div>
      <p className="text-[10px] text-muted-foreground font-mono">
        Dialogue presence per character across franchise installments. Track how character importance shifts between entries.
      </p>

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

      {/* Chart */}
      {selectedChars.length > 0 && (
        <div className="border border-border rounded-lg p-4">
          <h3 className="text-xs font-semibold mb-3">Dialogue Volume Across Installments</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="installment" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} />
                {selectedChars.map((name) => {
                  const charIdx = characterArcs.findIndex(c => c.name === name);
                  return (
                    <Area key={name} type="monotone" dataKey={name} name={name}
                      stroke={COLORS[charIdx % COLORS.length]} fill={COLORS[charIdx % COLORS.length]}
                      fillOpacity={0.1} strokeWidth={2} dot={{ r: 3 }} />
                  );
                })}
                <Legend wrapperStyle={{ fontSize: 10 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Summary cards */}
      {selectedChars.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {characterArcs.filter(c => selectedChars.includes(c.name)).map(c => {
            const present = c.installmentDialogue.filter(d => d > 0).length;
            const peak = Math.max(...c.installmentDialogue);
            const peakIdx = c.installmentDialogue.indexOf(peak);
            return (
              <div key={c.name} className="border border-border rounded-lg p-3">
                <h4 className="text-xs font-semibold mb-2">{c.name}</h4>
                <div className="space-y-1 text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Appearances</span>
                    <span className="font-mono">{present}/{installments.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Peak</span>
                    <span className="font-mono">{peak} lines ({installments[peakIdx]?.title.slice(0, 14)})</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Lines</span>
                    <span className="font-mono">{c.total}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
