/**
 * AdaptationPathwayPanel — surfaces neutral format-tendency signals
 * derived from canonical structural analysis. Descriptive only.
 */
import { useMemo } from "react";
import { FountainParseResult } from "@/lib/fountain-parser";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Clapperboard, MessageSquare, Users, MapPin, Zap, Clock, Info, Route,
} from "lucide-react";

/* ── types ── */
interface TendencySignal {
  label: string;
  strength: number; // 0-100
  hint: string;
  icon: React.ElementType;
}

interface ClusterIndicator {
  label: string;
  description: string;
  present: boolean;
}

interface AdaptationPathwayPanelProps {
  parsed: FountainParseResult;
}

/* ── helpers ── */
function strengthLabel(v: number): string {
  if (v >= 70) return "Strong";
  if (v >= 40) return "Moderate";
  return "Weak";
}

function strengthColor(v: number): string {
  if (v >= 70) return "text-primary";
  if (v >= 40) return "text-muted-foreground";
  return "text-muted-foreground/50";
}

function barFill(v: number): string {
  if (v >= 70) return "bg-primary";
  if (v >= 40) return "bg-primary/50";
  return "bg-muted-foreground/30";
}

/* ── computation ── */
function computeTendencies(parsed: FountainParseResult): TendencySignal[] {
  const { stats, scenes, elements } = parsed;
  const signals: TendencySignal[] = [];

  const totalContent = stats.dialogueBlockCount + stats.actionLineCount;
  const dialogueRatio = totalContent > 0 ? stats.dialogueBlockCount / totalContent : 0;
  const pageCount = stats.pageCount;
  const sceneCount = stats.sceneCount;
  const charCount = stats.uniqueCharacters.length;
  const sceneDensity = pageCount > 0 ? sceneCount / pageCount : 0;

  // Scene lengths
  const sceneLengths = scenes.map((s, i) => {
    const next = i < scenes.length - 1 ? scenes[i + 1].elementIndex : elements.length;
    return next - s.elementIndex;
  });
  const avgSceneLen = sceneLengths.length > 0
    ? sceneLengths.reduce((a, b) => a + b, 0) / sceneLengths.length : 0;

  // Unique locations
  const locations = new Set(
    scenes.map((s) => s.heading.replace(/^(INT\.|EXT\.|INT\/EXT\.|I\/E\.|EST\.)\s*/i, "").replace(/\s*-\s*.*$/, "").trim().toUpperCase())
  );

  // 1. Dialogue-heavy narrative
  signals.push({
    label: "Dialogue-Driven Narrative",
    strength: Math.min(100, Math.round(dialogueRatio * 140)),
    hint: "Proportion of dialogue relative to total content elements. Higher values indicate dialogue-centric storytelling.",
    icon: MessageSquare,
  });

  // 2. Ensemble structure
  const ensembleScore = (() => {
    const counts = Object.values(stats.characterDialogueCounts);
    if (counts.length < 3) return 10;
    const total = counts.reduce((a, b) => a + b, 0);
    const topShare = counts.length > 0 ? Math.max(...counts) / total : 1;
    // Lower top-share = more ensemble-like
    return Math.min(100, Math.round((1 - topShare) * 130));
  })();
  signals.push({
    label: "Ensemble Structure",
    strength: ensembleScore,
    hint: "Distribution of dialogue across characters. Higher values suggest an ensemble cast rather than a single protagonist focus.",
    icon: Users,
  });

  // 3. Limited location signals
  const locationDensity = sceneCount > 0 ? locations.size / sceneCount : 1;
  const limitedLocationScore = Math.min(100, Math.round((1 - Math.min(locationDensity, 1)) * 100 + 20));
  signals.push({
    label: "Limited Location Density",
    strength: Math.max(0, limitedLocationScore),
    hint: `${locations.size} unique locations across ${sceneCount} scenes. Higher values indicate fewer distinct locations relative to scene count.`,
    icon: MapPin,
  });

  // 4. High scene turnover
  const turnoverScore = Math.min(100, Math.round(Math.min(sceneDensity, 1.5) / 1.5 * 100));
  signals.push({
    label: "Scene Turnover Rate",
    strength: turnoverScore,
    hint: "Scenes per page ratio. Higher values indicate rapid scene changes typical of fast-paced or episodic structures.",
    icon: Zap,
  });

  // 5. Long-form pacing
  const longFormScore = (() => {
    // Favors longer avg scene length and higher page count
    const lenSignal = Math.min(1, avgSceneLen / 25); // 25+ elements = extended
    const pageSignal = Math.min(1, pageCount / 90); // 90+ pages = feature territory
    return Math.min(100, Math.round(((lenSignal + pageSignal) / 2) * 100));
  })();
  signals.push({
    label: "Long-Form Pacing",
    strength: longFormScore,
    hint: "Combination of average scene length and total page count. Higher values suggest feature-length or extended narrative pacing.",
    icon: Clock,
  });

  // 6. Character-centric structure
  const charCentricScore = (() => {
    const counts = Object.values(stats.characterDialogueCounts);
    if (counts.length === 0) return 0;
    const total = counts.reduce((a, b) => a + b, 0);
    const topShare = Math.max(...counts) / total;
    // Higher top-share = more character-centric
    return Math.min(100, Math.round(topShare * 120));
  })();
  signals.push({
    label: "Character-Centric Focus",
    strength: charCentricScore,
    hint: "Concentration of dialogue on a single character. Higher values indicate a protagonist-driven narrative.",
    icon: Clapperboard,
  });

  return signals;
}

function computeClusters(parsed: FountainParseResult): ClusterIndicator[] {
  const { stats, scenes, elements } = parsed;
  const totalContent = stats.dialogueBlockCount + stats.actionLineCount;
  const dialogueRatio = totalContent > 0 ? stats.dialogueBlockCount / totalContent : 0;
  const sceneCount = stats.sceneCount;
  const pageCount = stats.pageCount;
  const sceneDensity = pageCount > 0 ? sceneCount / pageCount : 0;

  const sceneLengths = scenes.map((s, i) => {
    const next = i < scenes.length - 1 ? scenes[i + 1].elementIndex : elements.length;
    return next - s.elementIndex;
  });
  const avgSceneLen = sceneLengths.length > 0
    ? sceneLengths.reduce((a, b) => a + b, 0) / sceneLengths.length : 0;

  const indicators: ClusterIndicator[] = [];

  indicators.push({
    label: "Dense Dialogue Pattern",
    description: "Over 55% of content elements are dialogue blocks, suggesting conversation-driven narrative.",
    present: dialogueRatio > 0.55,
  });

  indicators.push({
    label: "Compact Structural Pacing",
    description: "High scene density with short average scene lengths, indicating rapid narrative movement.",
    present: sceneDensity > 0.8 && avgSceneLen < 15,
  });

  indicators.push({
    label: "Extended Scene Pattern",
    description: "Average scene length exceeds 20 elements, suggesting sustained dramatic sequences.",
    present: avgSceneLen > 20,
  });

  indicators.push({
    label: "Feature-Length Structure",
    description: "Page count and scene volume consistent with feature-length screenplay conventions.",
    present: pageCount >= 80 && sceneCount >= 30,
  });

  indicators.push({
    label: "Short-Form Density",
    description: "Compact page count with concentrated narrative content, typical of short-form screenplays.",
    present: pageCount < 40 && sceneCount >= 5,
  });

  indicators.push({
    label: "Episodic Segmentation",
    description: "Scene structure shows segmented, self-contained sequences suggesting episodic formatting.",
    present: (() => {
      if (sceneLengths.length < 4) return false;
      const variance = sceneLengths.reduce((s, l) => s + (l - avgSceneLen) ** 2, 0) / sceneLengths.length;
      const cv = avgSceneLen > 0 ? Math.sqrt(variance) / avgSceneLen : 0;
      return cv < 0.35 && sceneCount >= 8;
    })(),
  });

  return indicators;
}

/* ── component ── */
export default function AdaptationPathwayPanel({ parsed }: AdaptationPathwayPanelProps) {
  const tendencies = useMemo(() => computeTendencies(parsed), [parsed]);
  const clusters = useMemo(() => computeClusters(parsed), [parsed]);
  const activeClusters = clusters.filter((c) => c.present);

  if (parsed.scenes.length === 0) {
    return (
      <div className="p-6 text-center">
        <Route className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">Parse a screenplay to view adaptation pathway signals.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Format tendency signals */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Route className="h-4 w-4 text-primary" />
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Format Tendency Signals</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[240px] text-xs">
              Descriptive indicators of structural characteristics. These do not imply quality or market suitability.
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="space-y-2.5">
          {tendencies.map((t) => (
            <div key={t.label} className="flex items-center gap-3">
              <t.icon className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-mono text-foreground">{t.label}</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[220px] text-xs">{t.hint}</TooltipContent>
                    </Tooltip>
                  </div>
                  <span className={cn("text-[10px] font-mono font-bold", strengthColor(t.strength))}>
                    {strengthLabel(t.strength)}
                  </span>
                </div>
                <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", barFill(t.strength))}
                    style={{ width: `${Math.min(t.strength, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Structural clustering indicators */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Clapperboard className="h-4 w-4 text-primary" />
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Structural Pattern Indicators</span>
        </div>
        {activeClusters.length === 0 ? (
          <p className="text-xs text-muted-foreground font-mono px-1">
            No strong structural patterns detected at current project state.
          </p>
        ) : (
          <div className="space-y-2">
            {activeClusters.map((c) => (
              <div key={c.label} className="rounded-lg border border-border/40 bg-card/60 px-3 py-2">
                <div className="flex items-center gap-2 mb-0.5">
                  <Badge variant="outline" className="text-[9px] font-mono px-1.5 py-0 border-primary/30 text-primary">
                    Detected
                  </Badge>
                  <span className="text-xs font-mono font-semibold text-foreground">{c.label}</span>
                </div>
                <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">{c.description}</p>
              </div>
            ))}
          </div>
        )}

        {/* Inactive clusters shown dimmed for context */}
        {clusters.filter((c) => !c.present).length > 0 && (
          <div className="mt-2 space-y-1">
            {clusters.filter((c) => !c.present).map((c) => (
              <div key={c.label} className="flex items-center gap-2 px-1 opacity-40">
                <span className="text-[10px] font-mono text-muted-foreground">—</span>
                <span className="text-[10px] font-mono text-muted-foreground">{c.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
