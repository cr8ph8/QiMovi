/**
 * IntelligenceMapPanel — Dual-panel visualization wrapper
 * Standard (SVG) / Enhanced (3D) toggle with two-column layout.
 * Adapted from Hampton Lab's DualPanelViz pattern.
 */
import { useState, lazy, Suspense } from "react";
import type { FountainParseResult } from "@/lib/fountain-parser";
import CharacterInfluenceNetwork from "./CharacterInfluenceNetwork";
import NarrativeEmbeddingSpace from "./NarrativeEmbeddingSpace";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Eye, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const EnhancedCharacterNetwork = lazy(() => import("./EnhancedCharacterNetwork"));
const EnhancedNarrativeSpace = lazy(() => import("./EnhancedNarrativeSpace"));

interface Props {
  parsed: FountainParseResult;
}

type ViewMode = "standard" | "enhanced";

function LoadingFallback() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      <Skeleton className="h-[300px] w-full rounded-lg" />
      <span className="text-[10px] font-mono text-muted-foreground">Loading 3D renderer…</span>
    </div>
  );
}

export default function IntelligenceMapPanel({ parsed }: Props) {
  const [mode, setMode] = useState<ViewMode>("standard");

  return (
    <div className="p-4 space-y-4">
      {/* Header + Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground font-mono">Screenplay Intelligence Map</h3>
          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
            Character influence network & narrative embedding space
          </p>
        </div>
        <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as ViewMode)} size="sm">
          <ToggleGroupItem value="standard" className="text-[10px] font-mono gap-1 px-2.5">
            <Eye className="h-3 w-3" /> Standard
          </ToggleGroupItem>
          <ToggleGroupItem value="enhanced" className="text-[10px] font-mono gap-1 px-2.5">
            <Zap className="h-3 w-3" /> Enhanced 3D
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Dual panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Panel 1: Character Influence Network */}
        <div className="rounded-xl border border-border/40 bg-muted/10 overflow-hidden">
          <div className="px-3 py-2 border-b border-border/20">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Character Influence Network</span>
          </div>
          <div className="p-2">
            {mode === "standard" ? (
              <CharacterInfluenceNetwork parsed={parsed} />
            ) : (
              <Suspense fallback={<LoadingFallback />}>
                <EnhancedCharacterNetwork parsed={parsed} />
              </Suspense>
            )}
          </div>
        </div>

        {/* Panel 2: Narrative Embedding Space */}
        <div className="rounded-xl border border-border/40 bg-muted/10 overflow-hidden">
          <div className="px-3 py-2 border-b border-border/20">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Narrative Embedding Space</span>
          </div>
          <div className="p-2">
            {mode === "standard" ? (
              <NarrativeEmbeddingSpace parsed={parsed} />
            ) : (
              <Suspense fallback={<LoadingFallback />}>
                <EnhancedNarrativeSpace parsed={parsed} />
              </Suspense>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
