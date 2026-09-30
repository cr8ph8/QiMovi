/**
 * SceneHeatmap — data-driven per-scene scoring heatmap derived from
 * Fountain-parsed structural metrics. Pro-tier feature.
 */
import { useMemo } from "react";
import type { FountainParseResult, FountainElement } from "@/lib/fountain-parser";
import { cn } from "@/lib/utils";

interface SceneMetrics {
  heading: string;
  index: number;
  structure: number;
  character: number;
  dialogue: number;
  theme: number;
  creativity: number;
  audience: number;
  market: number;
}

const DIMS = ["structure", "character", "dialogue", "theme", "creativity", "audience", "market"] as const;

const DIM_LABELS: Record<string, string> = {
  structure: "Stru",
  character: "Char",
  dialogue: "Dial",
  theme: "Them",
  creativity: "Crea",
  audience: "Audi",
  market: "Mark",
};

function heatColor(v: number) {
  if (v >= 85) return "bg-emerald-500/70 text-white";
  if (v >= 70) return "bg-yellow-500/60 text-white";
  if (v >= 55) return "bg-amber-600/60 text-white";
  return "bg-destructive/50 text-white";
}

function clamp(v: number, min = 0, max = 100) {
  return Math.round(Math.max(min, Math.min(max, v)));
}

/**
 * Compute heuristic per-scene dimension scores from structural analysis.
 * These are compositional signals — not AI evaluation scores.
 */
function computeSceneMetrics(parsed: FountainParseResult): SceneMetrics[] {
  const { elements, scenes } = parsed;
  if (scenes.length === 0) return [];

  // Global stats for normalization
  const totalElements = elements.filter(e => e.type !== "empty" && e.type !== "page_break").length;
  const globalDialogueCount = elements.filter(e => e.type === "dialogue").length;
  const globalActionCount = elements.filter(e => e.type === "action").length;
  const avgSceneSize = totalElements / Math.max(scenes.length, 1);

  return scenes.map((scene, idx) => {
    const nextElIdx = idx < scenes.length - 1 ? scenes[idx + 1].elementIndex : elements.length;
    const sceneEls = elements.slice(scene.elementIndex, nextElIdx);

    const dialogueEls = sceneEls.filter(e => e.type === "dialogue");
    const actionEls = sceneEls.filter(e => e.type === "action");
    const charEls = sceneEls.filter(e => e.type === "character");
    const parentheticals = sceneEls.filter(e => e.type === "parenthetical");
    const contentEls = sceneEls.filter(e => e.type !== "empty" && e.type !== "page_break");

    const uniqueChars = new Set(charEls.map(e => e.text.replace(/\s*\(.*\)$/, "").trim()));
    const dialogueCount = dialogueEls.length;
    const actionCount = actionEls.length;
    const totalLines = contentEls.length;

    // Structure: scene size balance + has proper heading + action/dialogue mix
    const sizeRatio = totalLines / Math.max(avgSceneSize, 1);
    const sizeScore = sizeRatio > 0.3 && sizeRatio < 3 ? 80 + (1 - Math.abs(1 - sizeRatio)) * 20 : 60;
    const mixBalance = totalLines > 0 ? 1 - Math.abs((dialogueCount - actionCount) / totalLines) : 0.5;
    const structure = clamp(sizeScore * 0.6 + mixBalance * 100 * 0.4);

    // Character: unique character count + dialogue distribution
    const charDiversity = Math.min(uniqueChars.size / 4, 1);
    const hasMultipleVoices = uniqueChars.size >= 2 ? 1 : 0.5;
    const character = clamp(charDiversity * 60 + hasMultipleVoices * 40);

    // Dialogue: ratio + parenthetical usage (indicates direction)
    const dialogueRatio = totalLines > 0 ? dialogueCount / totalLines : 0;
    const parentheticalBonus = parentheticals.length > 0 ? 10 : 0;
    const dialogue = clamp(dialogueRatio * 120 + parentheticalBonus + 30);

    // Theme: longer scenes with varied content suggest thematic depth
    const contentLength = contentEls.reduce((s, e) => s + e.text.length, 0);
    const avgWordCount = totalLines > 0 ? contentLength / totalLines : 0;
    const theme = clamp(Math.min(avgWordCount / 60, 1) * 50 + Math.min(totalLines / 15, 1) * 50);

    // Creativity: unique word density in action lines
    const actionWords = new Set(actionEls.flatMap(e => e.text.toLowerCase().split(/\s+/)));
    const actionDensity = actionEls.length > 0 ? actionWords.size / Math.max(actionEls.length, 1) : 0;
    const creativity = clamp(Math.min(actionDensity / 8, 1) * 60 + charDiversity * 40);

    // Audience: character presence + dialogue engagement
    const engagementScore = dialogueCount > 0 && uniqueChars.size >= 2 ? 75 : dialogueCount > 0 ? 60 : 40;
    const audience = clamp(engagementScore + Math.min(totalLines / 20, 1) * 25);

    // Market: scene efficiency (content density per line)
    const efficiency = totalLines > 0 ? contentLength / (totalLines * 80) : 0;
    const market = clamp(Math.min(efficiency, 1) * 50 + (uniqueChars.size >= 1 ? 30 : 10) + (dialogueCount > 0 ? 20 : 0));

    // Truncate heading for display
    const heading = scene.heading.length > 25
      ? scene.heading.slice(0, 22) + "…"
      : scene.heading;

    return { heading, index: scene.index, structure, character, dialogue, theme, creativity, audience, market };
  });
}

export default function SceneHeatmap({ parsed }: { parsed: FountainParseResult }) {
  const metrics = useMemo(() => computeSceneMetrics(parsed), [parsed]);

  if (metrics.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">No scenes detected for heatmap analysis.</p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Scene-Level Heatmap</span>
        <span className="text-[9px] text-muted-foreground">— structural scoring across dimensions</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border/30">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-border/30 bg-muted/20">
              <th className="text-left py-2 px-2.5 text-muted-foreground font-medium min-w-[120px]">Scene</th>
              {DIMS.map((d) => (
                <th key={d} className="py-2 px-1.5 text-muted-foreground font-medium text-center min-w-[44px]">
                  {DIM_LABELS[d]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((scene) => (
              <tr key={scene.index} className="border-b border-border/10 hover:bg-muted/10 transition-colors">
                <td className="py-1.5 px-2.5 text-foreground text-[10px] truncate max-w-[180px]" title={scene.heading}>
                  <span className="text-muted-foreground mr-1">{scene.index}.</span>
                  {scene.heading.replace(/^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s*/i, "").trim()}
                </td>
                {DIMS.map((d) => {
                  const v = scene[d];
                  return (
                    <td key={d} className="py-1.5 px-1.5 text-center">
                      <div className={cn("w-9 h-6 rounded flex items-center justify-center text-[10px] font-bold mx-auto", heatColor(v))}>
                        {v}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 justify-end">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-emerald-500/70" />
          <span className="text-[9px] font-mono text-muted-foreground">≥85</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-yellow-500/60" />
          <span className="text-[9px] font-mono text-muted-foreground">70–84</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-amber-600/60" />
          <span className="text-[9px] font-mono text-muted-foreground">55–69</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-destructive/50" />
          <span className="text-[9px] font-mono text-muted-foreground">&lt;55</span>
        </div>
      </div>
    </div>
  );
}
