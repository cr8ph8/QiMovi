import { useEffect, useRef, useState } from "react";
import { ListTree, MapPin, Loader2, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { parseFountain } from "@/lib/fountain-parser";

interface SceneSummary {
  index: number;
  heading: string;
  charOffset: number;
  characters: string[];
  wordCount: number;
  fingerprint: string;
}

type ChangeKind = "new" | "changed" | "unchanged";

interface SceneNavigatorProps {
  fountainText: string;
  parsed: ReturnType<typeof parseFountain>;
  onJump: (charOffset: number) => void;
  activeOffset?: number;
  /** Bumping this value resets the diff baseline (e.g., after Save/Submit). */
  baselineKey?: string | number | null;
}

const SCENE_HEADING_RE = /^(INT\.|EXT\.|EST\.|INT\/EXT\.|I\/E\.)[\s.]*.+/i;

function buildSummaries(
  fountainText: string,
  parsed: ReturnType<typeof parseFountain>,
): SceneSummary[] {
  // Find character offsets of every scene-heading line in the source text
  const offsets: number[] = [];
  let cursor = 0;
  const lines = fountainText.split("\n");
  for (const line of lines) {
    if (SCENE_HEADING_RE.test(line.trim())) {
      offsets.push(cursor);
    }
    cursor += line.length + 1; // +1 for \n
  }

  return parsed.scenes.map((scene, i) => {
    const startIdx = scene.elementIndex;
    const endIdx =
      parsed.scenes[i + 1]?.elementIndex ?? parsed.elements.length;
    const slice = parsed.elements.slice(startIdx, endIdx);

    const charsSet = new Set<string>();
    let words = 0;
    for (const el of slice) {
      if (el.type === "character") {
        // Strip parenthetical extensions like "ALEX (O.S.)"
        const name = el.text.replace(/\(.*\)/, "").trim();
        if (name) charsSet.add(name);
      }
      if (el.type !== "scene_heading" && el.type !== "empty") {
        words += el.text.split(/\s+/).filter(Boolean).length;
      }
    }

    const characters = Array.from(charsSet);
    return {
      index: scene.index,
      heading: scene.heading,
      charOffset: offsets[i] ?? 0,
      characters,
      wordCount: words,
      fingerprint: `${scene.heading}|${words}|${characters.join(",")}`,
    };
  });
}

export function SceneNavigator({
  fountainText,
  parsed,
  onJump,
  activeOffset,
  baselineKey,
}: SceneNavigatorProps) {
  const [summaries, setSummaries] = useState<SceneSummary[]>(() =>
    buildSummaries(fountainText, parsed),
  );
  const [recomputing, setRecomputing] = useState(false);

  // Baseline = scene fingerprints captured at the last "stable" point
  // (initial load + whenever baselineKey changes, e.g., after Save/Submit).
  const baselineRef = useRef<Map<string, string>>(
    new Map(summaries.map((s) => [s.heading, s.fingerprint])),
  );
  const [baselineVersion, setBaselineVersion] = useState(0);

  // Reset baseline whenever the parent signals a snapshot (Save/Submit/draft load).
  useEffect(() => {
    const fresh = buildSummaries(fountainText, parsed);
    baselineRef.current = new Map(fresh.map((s) => [s.heading, s.fingerprint]));
    setSummaries(fresh);
    setBaselineVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baselineKey]);

  // Debounced live recompute so long scripts don't block typing
  useEffect(() => {
    setRecomputing(true);
    const t = setTimeout(() => {
      setSummaries(buildSummaries(fountainText, parsed));
      setRecomputing(false);
    }, 150);
    return () => clearTimeout(t);
  }, [fountainText, parsed]);

  const classify = (s: SceneSummary): ChangeKind => {
    const prev = baselineRef.current.get(s.heading);
    if (prev === undefined) return "new";
    if (prev !== s.fingerprint) return "changed";
    return "unchanged";
  };

  const changedCount = summaries.reduce(
    (n, s) => (classify(s) !== "unchanged" ? n + 1 : n),
    0,
  );

  return (
    <Card>
      <CardHeader className="py-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-display flex items-center gap-2">
          <ListTree className="h-4 w-4" /> Scene Navigator
        </CardTitle>
        <div className="flex items-center gap-1.5">
          {recomputing && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
          {changedCount > 0 && (
            <Badge
              variant="outline"
              className="text-[9px] font-mono border-amber-400/50 text-amber-300 bg-amber-400/5"
              title="Scenes changed since last save"
            >
              {changedCount} edited
            </Badge>
          )}
          <Badge variant="secondary" className="text-[9px] font-mono">
            {summaries.length} {summaries.length === 1 ? "scene" : "scenes"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {summaries.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No scenes yet. Start a scene heading with INT. or EXT.
          </p>
        ) : (
          <ScrollArea className="h-[320px] pr-2" data-baseline-version={baselineVersion}>
            <ul className="space-y-1.5">
              {summaries.map((s) => {
                const isActive =
                  activeOffset !== undefined &&
                  activeOffset >= s.charOffset &&
                  (summaries.find((n) => n.index === s.index + 1)?.charOffset ??
                    Number.MAX_SAFE_INTEGER) > activeOffset;
                const change = classify(s);
                const changeBorder =
                  change === "new"
                    ? "border-l-emerald-400"
                    : change === "changed"
                      ? "border-l-amber-400"
                      : "border-l-transparent";
                return (
                  <li key={s.index}>
                    <button
                      onClick={() => onJump(s.charOffset)}
                      className={`w-full text-left rounded-md border border-l-4 ${changeBorder} px-2 py-1.5 transition-colors group ${
                        isActive
                          ? "border-primary/60 bg-primary/10"
                          : "border-border/40 hover:border-primary/40 hover:bg-primary/5"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] font-mono text-primary mt-0.5 shrink-0">
                          {String(s.index).padStart(2, "0")}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground/90 truncate flex-1">
                              {s.heading}
                            </div>
                            {change === "new" && (
                              <Badge
                                variant="outline"
                                className="text-[8px] font-mono px-1 py-0 h-3.5 border-emerald-400/50 text-emerald-300 bg-emerald-400/5"
                              >
                                <Sparkles className="h-2 w-2 mr-0.5" /> NEW
                              </Badge>
                            )}
                            {change === "changed" && (
                              <Badge
                                variant="outline"
                                className="text-[8px] font-mono px-1 py-0 h-3.5 border-amber-400/50 text-amber-300 bg-amber-400/5"
                              >
                                EDITED
                              </Badge>
                            )}
                          </div>
                          {s.characters.length > 0 && (
                            <div className="text-[10px] text-amber-300/80 truncate mt-0.5">
                              {s.characters.slice(0, 5).join(" · ")}
                              {s.characters.length > 5 &&
                                ` +${s.characters.length - 5}`}
                            </div>
                          )}
                          <div className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground mt-0.5">
                            <span>{s.wordCount} words</span>
                            <span>·</span>
                            <span>
                              {s.characters.length}{" "}
                              {s.characters.length === 1 ? "char" : "chars"}
                            </span>
                          </div>
                        </div>
                        <MapPin className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

