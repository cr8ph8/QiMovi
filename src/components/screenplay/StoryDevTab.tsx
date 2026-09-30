import { useMemo, useState, useCallback } from "react";
import { FountainParseResult } from "@/lib/fountain-parser";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Users, GitBranch, ListChecks, Lightbulb, Check } from "lucide-react";

interface StoryDevTabProps {
  parsed: FountainParseResult;
  filmstackCharBible?: string;
}

const BEAT_LABELS = ["Setup", "Catalyst", "Debate", "Break Into 2", "Midpoint", "Bad Guys Close In", "All Is Lost", "Dark Night", "Break Into 3", "Climax", "Resolution"] as const;
type BeatLabel = typeof BEAT_LABELS[number];

function getBeatHeuristic(sceneIndex: number, totalScenes: number): BeatLabel {
  const pct = totalScenes <= 1 ? 0 : sceneIndex / (totalScenes - 1);
  if (pct <= 0.08) return "Setup";
  if (pct <= 0.12) return "Catalyst";
  if (pct <= 0.2) return "Debate";
  if (pct <= 0.25) return "Break Into 2";
  if (pct <= 0.5) return "Midpoint";
  if (pct <= 0.62) return "Bad Guys Close In";
  if (pct <= 0.72) return "All Is Lost";
  if (pct <= 0.78) return "Dark Night";
  if (pct <= 0.82) return "Break Into 3";
  if (pct <= 0.95) return "Climax";
  return "Resolution";
}

function getBeatColor(beat: BeatLabel): string {
  switch (beat) {
    case "Setup": return "bg-blue-500/15 text-blue-400";
    case "Catalyst": return "bg-amber-500/15 text-amber-400";
    case "Midpoint": return "bg-primary/15 text-primary";
    case "Climax": return "bg-destructive/15 text-destructive";
    case "Resolution": return "bg-emerald-500/15 text-emerald-400";
    default: return "bg-muted text-muted-foreground";
  }
}

export default function StoryDevTab({ parsed, filmstackCharBible }: StoryDevTabProps) {
  const { scenes, elements, stats } = parsed;
  const [beatOverrides, setBeatOverrides] = useState<Record<number, BeatLabel>>({});

  // Character per-scene mapping
  const characterSceneMap = useMemo(() => {
    const map = new Map<string, { scenes: number[]; dialogueCounts: Map<number, number> }>();
    scenes.forEach((scene, sceneIdx) => {
      const nextElIdx = sceneIdx < scenes.length - 1 ? scenes[sceneIdx + 1].elementIndex : elements.length;
      const sceneElements = elements.slice(scene.elementIndex, nextElIdx);
      let currentChar = "";
      sceneElements.forEach((el) => {
        if (el.type === "character") {
          currentChar = el.text.replace(/\s*\(.*\)$/, "").trim();
          if (!map.has(currentChar)) map.set(currentChar, { scenes: [], dialogueCounts: new Map() });
          const data = map.get(currentChar)!;
          if (!data.scenes.includes(sceneIdx)) data.scenes.push(sceneIdx);
        }
        if (el.type === "dialogue" && currentChar) {
          const data = map.get(currentChar);
          if (data) {
            data.dialogueCounts.set(sceneIdx, (data.dialogueCounts.get(sceneIdx) || 0) + 1);
          }
        }
      });
    });
    return map;
  }, [scenes, elements]);

  // Conflict web: co-occurrence matrix
  const conflictWeb = useMemo(() => {
    const coOccurrences = new Map<string, number>();
    const charList = Array.from(characterSceneMap.keys()).slice(0, 12); // top 12
    scenes.forEach((scene, sceneIdx) => {
      const charsInScene = charList.filter((c) => characterSceneMap.get(c)?.scenes.includes(sceneIdx));
      for (let i = 0; i < charsInScene.length; i++) {
        for (let j = i + 1; j < charsInScene.length; j++) {
          const key = [charsInScene[i], charsInScene[j]].sort().join("|||");
          coOccurrences.set(key, (coOccurrences.get(key) || 0) + 1);
        }
      }
    });
    return { charList, coOccurrences };
  }, [characterSceneMap, scenes]);

  // Story beat assignments
  const beatAssignments = useMemo(() =>
    scenes.map((_, idx) => beatOverrides[idx] || getBeatHeuristic(idx, scenes.length)),
  [scenes, beatOverrides]);

  const handleBeatCycle = useCallback((sceneIdx: number) => {
    const currentBeat = beatAssignments[sceneIdx];
    const currentIdx = BEAT_LABELS.indexOf(currentBeat);
    const nextBeat = BEAT_LABELS[(currentIdx + 1) % BEAT_LABELS.length];
    setBeatOverrides((prev) => ({ ...prev, [sceneIdx]: nextBeat }));
  }, [beatAssignments]);

  // Theme tracker
  const themes = useMemo(() => {
    if (!filmstackCharBible) return [];
    const themeKeywords = ["love", "power", "betrayal", "identity", "revenge", "family", "freedom", "justice", "redemption", "sacrifice", "ambition", "loss", "survival", "truth", "corruption"];
    const bibleLower = filmstackCharBible.toLowerCase();
    return themeKeywords.filter((t) => bibleLower.includes(t));
  }, [filmstackCharBible]);

  const themeSceneHits = useMemo(() => {
    if (themes.length === 0) return new Map<string, number[]>();
    const map = new Map<string, number[]>();
    themes.forEach((theme) => map.set(theme, []));
    scenes.forEach((scene, sceneIdx) => {
      const nextElIdx = sceneIdx < scenes.length - 1 ? scenes[sceneIdx + 1].elementIndex : elements.length;
      const sceneText = elements.slice(scene.elementIndex, nextElIdx).map((e) => e.text).join(" ").toLowerCase();
      themes.forEach((theme) => {
        if (sceneText.includes(theme)) {
          map.get(theme)?.push(sceneIdx);
        }
      });
    });
    return map;
  }, [themes, scenes, elements]);

  if (scenes.length === 0) {
    return (
      <div className="p-8 text-center">
        <GitBranch className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No scenes parsed yet. Upload and parse a screenplay to use Story Dev tools.</p>
      </div>
    );
  }

  const topChars = Array.from(characterSceneMap.entries())
    .sort((a, b) => b[1].scenes.length - a[1].scenes.length)
    .slice(0, 10);

  const maxCoOccurrence = Math.max(1, ...Array.from(conflictWeb.coOccurrences.values()));

  return (
    <div className="p-4 space-y-6 mt-0">
      {/* Character Arc Mapper */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Users className="h-4 w-4 text-primary" />
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Character Arc Mapper</span>
        </div>
        <div className="space-y-1.5 overflow-x-auto">
          {topChars.map(([name, data]) => {
            const maxDialogue = Math.max(1, ...Array.from(data.dialogueCounts.values()));
            return (
              <div key={name} className="flex items-center gap-2">
                <span className="text-[10px] font-mono w-24 truncate shrink-0 text-foreground">{name}</span>
                <div className="flex gap-px flex-1">
                  {scenes.map((_, sceneIdx) => {
                    const inScene = data.scenes.includes(sceneIdx);
                    const dialogueCount = data.dialogueCounts.get(sceneIdx) || 0;
                    const intensity = inScene ? Math.max(0.2, dialogueCount / maxDialogue) : 0;
                    return (
                      <div
                        key={sceneIdx}
                        className={cn(
                          "h-4 rounded-sm flex-1 min-w-[4px] max-w-[16px] transition-colors",
                          inScene ? "bg-primary" : "bg-muted/30",
                        )}
                        style={inScene ? { opacity: intensity } : {}}
                        title={inScene ? `Scene ${sceneIdx + 1}: ${dialogueCount} lines` : `Scene ${sceneIdx + 1}: absent`}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="flex items-center gap-2 mt-1">
            <span className="w-24" />
            <div className="flex gap-px flex-1">
              {scenes.map((_, i) => (
                <span key={i} className="text-[7px] font-mono text-muted-foreground flex-1 min-w-[4px] max-w-[16px] text-center">
                  {(i + 1) % 5 === 0 ? i + 1 : ""}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Conflict Web */}
      {conflictWeb.charList.length >= 2 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <GitBranch className="h-4 w-4 text-primary" />
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Conflict Web</span>
          </div>
          <div className="space-y-1">
            {Array.from(conflictWeb.coOccurrences.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 15)
              .map(([key, count]) => {
                const [charA, charB] = key.split("|||");
                const width = (count / maxCoOccurrence) * 100;
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-[10px] font-mono w-20 truncate shrink-0 text-right text-foreground">{charA}</span>
                    <div className="flex-1 h-2 bg-muted/30 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary/60 rounded-full transition-all"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-mono w-20 truncate shrink-0 text-foreground">{charB}</span>
                    <Badge variant="outline" className="text-[8px] font-mono shrink-0">{count}</Badge>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Story Beat Checklist */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <ListChecks className="h-4 w-4 text-primary" />
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Story Beat Map</span>
          <span className="text-[9px] font-mono text-muted-foreground ml-auto">Click to cycle beats</span>
        </div>
        <div className="space-y-1">
          {scenes.map((scene, idx) => {
            const beat = beatAssignments[idx];
            const isOverridden = idx in beatOverrides;
            return (
              <div key={idx} className="flex items-center gap-2 rounded-md hover:bg-muted/20 px-2 py-1 transition-colors">
                <span className="text-[9px] font-mono text-muted-foreground w-6 shrink-0">S{idx + 1}</span>
                <button
                  onClick={() => handleBeatCycle(idx)}
                  className={cn(
                    "text-[9px] font-mono px-2 py-0.5 rounded-full shrink-0 transition-colors",
                    getBeatColor(beat),
                    isOverridden && "ring-1 ring-primary/30",
                  )}
                >
                  {beat}
                </button>
                <span className="text-[10px] font-mono text-muted-foreground truncate flex-1">
                  {scene.heading.length > 50 ? scene.heading.slice(0, 50) + "…" : scene.heading}
                </span>
                {isOverridden && (
                  <Check className="h-2.5 w-2.5 text-primary shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Theme Tracker */}
      {themes.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="h-4 w-4 text-primary" />
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Theme Tracker</span>
            <Badge variant="outline" className="text-[9px] font-mono ml-auto">from Character Bible</Badge>
          </div>
          <div className="space-y-2">
            {themes.map((theme) => {
              const hitScenes = themeSceneHits.get(theme) || [];
              const coverage = scenes.length > 0 ? Math.round((hitScenes.length / scenes.length) * 100) : 0;
              return (
                <div key={theme}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium capitalize">{theme}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{hitScenes.length}/{scenes.length} scenes · {coverage}%</span>
                  </div>
                  <div className="flex gap-px">
                    {scenes.map((_, sceneIdx) => (
                      <div
                        key={sceneIdx}
                        className={cn(
                          "h-2 rounded-sm flex-1 min-w-[3px] max-w-[12px]",
                          hitScenes.includes(sceneIdx) ? "bg-primary" : "bg-muted/30",
                        )}
                        title={`Scene ${sceneIdx + 1}: ${hitScenes.includes(sceneIdx) ? "present" : "absent"}`}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
