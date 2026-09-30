/**
 * CharacterMemoryGraph — shows which scenes each character appears in as a timeline strip.
 * Horizontal lane per character with dots for scene presence.
 */
import { useMemo, useState } from "react";
import { FountainParseResult } from "@/lib/fountain-parser";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Milestone } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  parsed: FountainParseResult;
}

interface CharacterPresence {
  name: string;
  scenes: Set<number>;
  totalLines: number;
}

export default function CharacterMemoryGraph({ parsed }: Props) {
  const [open, setOpen] = useState(false);

  const { characters, sceneCount } = useMemo(() => {
    const { elements } = parsed;
    const charScenes = new Map<string, { scenes: Set<number>; lines: number }>();
    let sceneIdx = -1;
    let currentChar = "";

    for (const el of elements) {
      if (el.type === "scene_heading") {
        sceneIdx++;
        currentChar = "";
      } else if (el.type === "character") {
        currentChar = el.text.replace(/\s*\(.*\)$/, "").trim();
        if (!charScenes.has(currentChar)) {
          charScenes.set(currentChar, { scenes: new Set(), lines: 0 });
        }
        if (sceneIdx >= 0) charScenes.get(currentChar)!.scenes.add(sceneIdx);
      } else if (el.type === "dialogue" && currentChar) {
        const entry = charScenes.get(currentChar);
        if (entry) entry.lines++;
      } else if (el.type !== "parenthetical") {
        currentChar = "";
      }
    }

    const chars: CharacterPresence[] = Array.from(charScenes.entries())
      .map(([name, data]) => ({ name, scenes: data.scenes, totalLines: data.lines }))
      .filter(c => c.totalLines >= 3)
      .sort((a, b) => b.totalLines - a.totalLines)
      .slice(0, 10);

    return { characters: chars, sceneCount: sceneIdx + 1 };
  }, [parsed]);

  if (characters.length < 2 || sceneCount < 2) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-2 rounded-lg hover:bg-muted/30 transition-colors">
        <Milestone className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex-1 text-left">
          Character Presence Timeline
        </span>
        <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        <p className="text-[10px] text-muted-foreground mb-3">
          Each row is a character · Each column is a scene · Filled dots show presence · Gaps highlight character absences.
        </p>
        <div className="overflow-x-auto">
          <div className="min-w-[300px]">
            {/* Scene numbers header */}
            <div className="flex items-center mb-1">
              <div className="w-20 shrink-0" />
              <div className="flex-1 flex">
                {Array.from({ length: sceneCount }, (_, i) => (
                  <div
                    key={i}
                    className="flex-1 text-center text-[7px] font-mono text-muted-foreground/50"
                    style={{ minWidth: 8 }}
                  >
                    {(i + 1) % 5 === 0 ? i + 1 : ""}
                  </div>
                ))}
              </div>
            </div>

            {/* Character lanes */}
            {characters.map(char => {
              // Detect gaps (3+ consecutive absent scenes)
              const gaps: number[] = [];
              let gapStart = -1;
              for (let s = 0; s < sceneCount; s++) {
                if (!char.scenes.has(s)) {
                  if (gapStart < 0) gapStart = s;
                } else {
                  if (gapStart >= 0 && s - gapStart >= 3) {
                    for (let g = gapStart; g < s; g++) gaps.push(g);
                  }
                  gapStart = -1;
                }
              }
              if (gapStart >= 0 && sceneCount - gapStart >= 3) {
                for (let g = gapStart; g < sceneCount; g++) gaps.push(g);
              }

              return (
                <div key={char.name} className="flex items-center mb-0.5">
                  <div className="w-20 shrink-0 text-[9px] font-mono text-muted-foreground truncate pr-2 text-right" title={char.name}>
                    {char.name}
                  </div>
                  <div className="flex-1 flex items-center">
                    {Array.from({ length: sceneCount }, (_, s) => {
                      const present = char.scenes.has(s);
                      const isGap = gaps.includes(s);
                      return (
                        <div
                          key={s}
                          className="flex-1 flex items-center justify-center"
                          style={{ minWidth: 8, height: 14 }}
                          title={`Scene ${s + 1}: ${present ? "Present" : isGap ? "Extended absence" : "Absent"}`}
                        >
                          <div
                            className={cn(
                              "rounded-full",
                              present
                                ? "w-2 h-2 bg-primary"
                                : isGap
                                  ? "w-1.5 h-1.5 bg-destructive/40"
                                  : "w-1 h-1 bg-muted-foreground/15"
                            )}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
