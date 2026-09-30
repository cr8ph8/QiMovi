import { useMemo, useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FountainParseResult } from "@/lib/fountain-parser";
import { Info, Activity } from "lucide-react";

interface NarrativeEnergyPanelProps {
  parsed: FountainParseResult;
}

interface EnergyComponents {
  dialogueTension: number;
  scenePacing: number;
  characterDensity: number;
  toneShift: number;
  overall: number;
}

function barColor(v: number) {
  if (v < 0.35) return "from-blue-500 to-blue-500/60";
  if (v < 0.60) return "from-primary to-amber-500/80";
  return "from-amber-500 to-destructive";
}

function computeSceneEnergy(
  sceneIdx: number,
  scenes: FountainParseResult["scenes"],
  elements: FountainParseResult["elements"]
): EnergyComponents {
  const scene = scenes[sceneIdx];
  const nextElIdx = sceneIdx < scenes.length - 1 ? scenes[sceneIdx + 1].elementIndex : elements.length;
  const sceneElements = elements.slice(scene.elementIndex, nextElIdx);

  const dialogueEls = sceneElements.filter(e => e.type === "dialogue");
  const actionEls = sceneElements.filter(e => e.type === "action");
  const charEls = sceneElements.filter(e => e.type === "character");

  const totalText = sceneElements.map(e => e.text).join(" ");
  const exclamations = (totalText.match(/!/g) || []).length;
  const questions = (totalText.match(/\?/g) || []).length;
  const caps = (totalText.match(/\b[A-Z]{3,}\b/g) || []).length;

  const dialogueTension = Math.min(1, (exclamations + caps * 0.5) / Math.max(dialogueEls.length, 1) * 0.3);
  const scenePacing = Math.min(1, sceneElements.length / 30);
  const characterDensity = Math.min(1, charEls.length / 6);
  const toneShift = Math.min(1, (questions + exclamations) / Math.max(totalText.split(" ").length, 1) * 10);
  const overall = (dialogueTension + scenePacing + characterDensity + toneShift) / 4;

  return { dialogueTension, scenePacing, characterDensity, toneShift, overall };
}

export default function NarrativeEnergyPanel({ parsed }: NarrativeEnergyPanelProps) {
  const { scenes, elements } = parsed;
  const [selectedScene, setSelectedScene] = useState(0);
  const [showTip, setShowTip] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showTip) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setShowTip(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showTip]);

  const allEnergies = useMemo(() =>
    scenes.map((_, idx) => computeSceneEnergy(idx, scenes, elements)),
  [scenes, elements]);

  const currentEnergy = allEnergies[selectedScene];
  const avgOverall = allEnergies.length > 0 ? allEnergies.reduce((s, e) => s + e.overall, 0) / allEnergies.length : 0;

  if (scenes.length === 0) {
    return (
      <div className="p-8 text-center">
        <Activity className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No scenes to analyze.</p>
      </div>
    );
  }

  const components: { key: keyof Omit<EnergyComponents, "overall">; label: string }[] = [
    { key: "dialogueTension", label: "Dialogue Tension" },
    { key: "scenePacing", label: "Scene Pacing" },
    { key: "characterDensity", label: "Character Density" },
    { key: "toneShift", label: "Tone Shift" },
  ];

  return (
    <div className="p-4 space-y-5 mt-0">
      <div className="flex items-center gap-2 mb-2">
        <Activity className="h-4 w-4 text-primary" />
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Narrative Energy</span>
        <div className="ml-auto relative" ref={ref}>
          <button onClick={() => setShowTip(!showTip)} className="p-0.5 text-muted-foreground hover:text-primary transition-colors">
            <Info className="w-3.5 h-3.5" />
          </button>
          <AnimatePresence>
            {showTip && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
                className="absolute z-50 bottom-full mb-2 right-0 w-56 rounded-lg border border-border bg-card shadow-xl p-3 text-xs text-muted-foreground leading-relaxed">
                Higher energy indicates greater narrative tension — dialogue intensity, pacing, and character interaction.
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Energy heatmap bar */}
      <div>
        <div className="text-[10px] text-muted-foreground mb-1.5">Scene Energy Map</div>
        <div className="flex gap-px">
          {allEnergies.map((e, i) => (
            <button key={i} onClick={() => setSelectedScene(i)}
              className={`h-6 flex-1 min-w-[4px] max-w-[16px] rounded-sm transition-all ${
                selectedScene === i ? "ring-1 ring-primary" : ""
              }`}
              style={{
                backgroundColor: e.overall > 0.6 ? "hsl(var(--destructive))" : e.overall > 0.35 ? "hsl(var(--primary))" : "hsl(var(--muted))",
                opacity: 0.3 + e.overall * 0.7,
              }}
              title={`Scene ${i + 1}: ${Math.round(e.overall * 100)}% energy`} />
          ))}
        </div>
        <div className="flex justify-between text-[8px] text-muted-foreground mt-0.5">
          <span>S1</span>
          <span>S{scenes.length}</span>
        </div>
      </div>

      {/* Selected scene detail */}
      <div className="border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold">Scene {selectedScene + 1} Energy</h3>
          <span className={`text-sm font-bold font-mono ${currentEnergy.overall > 0.6 ? "text-destructive" : currentEnergy.overall > 0.4 ? "text-amber-500" : "text-emerald-500"}`}>
            {Math.round(currentEnergy.overall * 100)}%
          </span>
        </div>
        <div className="space-y-2.5">
          {components.map(c => (
            <div key={c.key}>
              <div className="flex items-center justify-between text-[10px] mb-0.5">
                <span className="text-muted-foreground">{c.label}</span>
                <span className="font-mono">{Math.round(currentEnergy[c.key] * 100)}%</span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${currentEnergy[c.key] * 100}%` }}
                  transition={{ duration: 0.5 }}
                  className={`h-full rounded-full bg-gradient-to-r ${barColor(currentEnergy[c.key])}`} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="border border-border rounded-lg p-3 text-center">
          <div className="text-[10px] text-muted-foreground mb-0.5">Average Energy</div>
          <div className="text-lg font-bold font-mono">{Math.round(avgOverall * 100)}%</div>
        </div>
        <div className="border border-border rounded-lg p-3 text-center">
          <div className="text-[10px] text-muted-foreground mb-0.5">Peak Scene</div>
          <div className="text-lg font-bold font-mono">
            S{allEnergies.indexOf(allEnergies.reduce((max, e) => e.overall > max.overall ? e : max, allEnergies[0])) + 1}
          </div>
        </div>
        <div className="border border-border rounded-lg p-3 text-center">
          <div className="text-[10px] text-muted-foreground mb-0.5">Low Scenes</div>
          <div className="text-lg font-bold font-mono">
            {allEnergies.filter(e => e.overall < 0.2).length}
          </div>
        </div>
      </div>
    </div>
  );
}
