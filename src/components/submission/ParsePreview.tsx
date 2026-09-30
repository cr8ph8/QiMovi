import { useMemo } from "react";
import { parseFountain, type FountainParseResult, type FountainElement } from "@/lib/fountain-parser";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Users, Film, Hash, Check } from "lucide-react";
import { motion } from "framer-motion";

interface ParsePreviewProps {
  fountainText: string;
  pageCount?: number;
}

function ScreenplayRenderer({ elements }: { elements: FountainElement[] }) {
  // Render first ~150 elements (roughly 2-3 pages)
  const visible = elements.slice(0, 150);

  return (
    <div className="space-y-0.5 font-mono text-[11px] leading-relaxed">
      {visible.map((el, i) => {
        switch (el.type) {
          case "scene_heading":
            return (
              <p key={i} className="text-foreground font-bold uppercase tracking-wide pt-3 pb-1 border-b border-border/20 mb-1">
                {el.text}
              </p>
            );
          case "character":
            return (
              <p key={i} className="text-center text-foreground/90 font-semibold uppercase pt-2 pl-[25%] pr-[25%]">
                {el.text}
              </p>
            );
          case "parenthetical":
            return (
              <p key={i} className="text-center text-muted-foreground italic pl-[20%] pr-[20%]">
                {el.text}
              </p>
            );
          case "dialogue":
            return (
              <p key={i} className="text-foreground/80 pl-[15%] pr-[15%]">
                {el.text}
              </p>
            );
          case "transition":
            return (
              <p key={i} className="text-right text-muted-foreground uppercase font-semibold pt-2 pb-1">
                {el.text}
              </p>
            );
          case "action":
            return (
              <p key={i} className="text-foreground/70 py-0.5">
                {el.text}
              </p>
            );
          case "page_break":
            return <hr key={i} className="border-border/30 my-3" />;
          case "empty":
            return <div key={i} className="h-2" />;
          default:
            return null;
        }
      })}
      {elements.length > 150 && (
        <p className="text-primary/60 text-center pt-4 text-[10px]">
          ... {elements.length - 150} more elements
        </p>
      )}
    </div>
  );
}

export default function ParsePreview({ fountainText, pageCount }: ParsePreviewProps) {
  const parsed: FountainParseResult = useMemo(
    () => parseFountain(fountainText),
    [fountainText],
  );

  const { stats, scenes, elements } = parsed;

  return (
    <div className="space-y-4">
      {/* Trust signal banner */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3"
      >
        <div className="shrink-0 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
          <Check className="h-4 w-4 text-primary" />
        </div>
        <p className="text-sm text-foreground">
          <span className="font-semibold">Script parsed successfully.</span>{" "}
          <span className="text-muted-foreground">
            We detected {stats.sceneCount} scene{stats.sceneCount !== 1 ? "s" : ""}, {stats.uniqueCharacters.length} character{stats.uniqueCharacters.length !== 1 ? "s" : ""}, and {pageCount ?? stats.pageCount} page{(pageCount ?? stats.pageCount) !== 1 ? "s" : ""}.
          </span>
        </p>
      </motion.div>

      {/* Stats bar */}
      <div className="flex flex-wrap gap-3">
        {[
          { icon: <FileText className="h-3.5 w-3.5" />, label: "Pages", value: pageCount ?? stats.pageCount },
          { icon: <Film className="h-3.5 w-3.5" />, label: "Scenes", value: stats.sceneCount },
          { icon: <Users className="h-3.5 w-3.5" />, label: "Characters", value: stats.uniqueCharacters.length },
          { icon: <Hash className="h-3.5 w-3.5" />, label: "Words", value: stats.wordCount.toLocaleString() },
        ].map((s) => (
          <div
            key={s.label}
            className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-muted/50 px-3 py-1.5"
          >
            <span className="text-primary">{s.icon}</span>
            <span className="text-xs font-mono text-muted-foreground">{s.label}</span>
            <span className="text-sm font-semibold">{s.value}</span>
          </div>
        ))}
      </div>

      {/* Split panel */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left: screenplay-native rendering */}
        <div className="rounded-xl border border-border/40 bg-card/60 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border/30 bg-muted/30">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Screenplay Preview
            </h4>
          </div>
          <ScrollArea className="h-[320px]">
            <div className="p-4">
              {elements.length > 0 ? (
                <ScreenplayRenderer elements={elements} />
              ) : (
                <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap leading-relaxed">
                  {fountainText.slice(0, 6000)}
                  {fountainText.length > 6000 && (
                    <span className="text-primary/60">
                      {"\n\n"}... ({(fountainText.length - 6000).toLocaleString()} more characters)
                    </span>
                  )}
                </pre>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Right: parsed breakdown */}
        <div className="rounded-xl border border-border/40 bg-card/60 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border/30 bg-muted/30">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Parsed Breakdown
            </h4>
          </div>
          <ScrollArea className="h-[320px]">
            <div className="p-4 space-y-5">
              {/* Characters */}
              {stats.uniqueCharacters.length > 0 && (
                <div>
                  <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Users className="h-3 w-3" /> Characters
                  </h5>
                  <div className="flex flex-wrap gap-1.5">
                    {stats.uniqueCharacters.slice(0, 20).map((name) => (
                      <Badge
                        key={name}
                        variant="outline"
                        className="text-[10px] font-mono border-border/50"
                      >
                        {name}
                        <span className="ml-1 text-primary/70">
                          {stats.characterDialogueCounts[name]}
                        </span>
                      </Badge>
                    ))}
                    {stats.uniqueCharacters.length > 20 && (
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        +{stats.uniqueCharacters.length - 20} more
                      </Badge>
                    )}
                  </div>
                </div>
              )}

              {/* Scenes */}
              {scenes.length > 0 && (
                <div>
                  <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Film className="h-3 w-3" /> Scenes
                  </h5>
                  <div className="space-y-1.5">
                    {scenes.slice(0, 15).map((scene) => (
                      <div
                        key={scene.index}
                        className="flex items-baseline gap-2 text-xs"
                      >
                        <span className="shrink-0 w-6 text-right font-mono text-primary/70">
                          {scene.index}
                        </span>
                        <span className="font-mono text-foreground/80 truncate">
                          {scene.heading}
                        </span>
                      </div>
                    ))}
                    {scenes.length > 15 && (
                      <p className="text-[10px] text-muted-foreground font-mono pl-8">
                        ... +{scenes.length - 15} more scenes
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Structure */}
              <div>
                <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Structure
                </h5>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-muted/50 border border-border/20 p-2">
                    <span className="text-muted-foreground">Dialogue blocks</span>
                    <p className="font-semibold">{stats.dialogueBlockCount}</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 border border-border/20 p-2">
                    <span className="text-muted-foreground">Action lines</span>
                    <p className="font-semibold">{stats.actionLineCount}</p>
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
