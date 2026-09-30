/**
 * VoiceDivergenceMatrix — heatmap showing pairwise voice similarity between characters.
 * Uses analyzeCharacters() metrics to compute distance.
 */
import { useMemo, useState } from "react";
import { FountainParseResult } from "@/lib/fountain-parser";
import { analyzeCharacters, CharacterProfile } from "@/lib/character";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Grid3X3 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  parsed: FountainParseResult;
}

/** Compute a 0–1 distance between two character profiles based on voice metrics */
function voiceDistance(a: CharacterProfile, b: CharacterProfile): number {
  const dLex = Math.abs(a.lexicalUniqueness - b.lexicalUniqueness) / 100;
  const dLen = Math.abs(a.avgLineLength - b.avgLineLength) / Math.max(a.avgLineLength, b.avgLineLength, 1);
  const dExcl = Math.abs(a.punctuationStyle.exclamationRate - b.punctuationStyle.exclamationRate) / 100;
  const dQues = Math.abs(a.punctuationStyle.questionRate - b.punctuationStyle.questionRate) / 100;
  const dEllip = Math.abs(a.punctuationStyle.ellipsisRate - b.punctuationStyle.ellipsisRate) / 100;
  return (dLex * 0.3 + dLen * 0.25 + dExcl * 0.15 + dQues * 0.15 + dEllip * 0.15);
}

function distanceColor(d: number): string {
  // High distance = distinct (green), low distance = similar (red/warning)
  if (d >= 0.5) return "bg-emerald-500/60";
  if (d >= 0.35) return "bg-emerald-500/30";
  if (d >= 0.2) return "bg-amber-500/30";
  if (d >= 0.1) return "bg-amber-500/50";
  return "bg-destructive/30";
}

export default function VoiceDivergenceMatrix({ parsed }: Props) {
  const [open, setOpen] = useState(false);

  const profiles = useMemo(() => {
    const all = analyzeCharacters(parsed);
    return all.filter(p => p.dialogueLineCount >= 3).slice(0, 8);
  }, [parsed]);

  const matrix = useMemo(() => {
    return profiles.map((a, i) =>
      profiles.map((b, j) => (i === j ? -1 : voiceDistance(a, b)))
    );
  }, [profiles]);

  if (profiles.length < 2) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-2 rounded-lg hover:bg-muted/30 transition-colors">
        <Grid3X3 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex-1 text-left">
          Voice Divergence Matrix
        </span>
        <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        <p className="text-[10px] text-muted-foreground mb-3">
          Green = distinct voices · Red = similar voices — characters with similar voices may need differentiation.
        </p>
        <div className="overflow-x-auto">
          <table className="border-collapse text-[9px] font-mono">
            <thead>
              <tr>
                <th className="p-1" />
                {profiles.map(p => (
                  <th key={p.name} className="p-1 text-muted-foreground font-normal truncate max-w-[60px] text-center" title={p.name}>
                    {p.name.length > 6 ? p.name.slice(0, 6) + "…" : p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profiles.map((row, i) => (
                <tr key={row.name}>
                  <td className="p-1 text-muted-foreground truncate max-w-[60px] text-right pr-2" title={row.name}>
                    {row.name.length > 6 ? row.name.slice(0, 6) + "…" : row.name}
                  </td>
                  {matrix[i].map((d, j) => (
                    <td key={j} className="p-0.5">
                      {d < 0 ? (
                        <div className="w-7 h-7 rounded bg-muted/30 flex items-center justify-center text-muted-foreground/40">—</div>
                      ) : (
                        <div
                          className={cn("w-7 h-7 rounded flex items-center justify-center text-foreground/80", distanceColor(d))}
                          title={`${row.name} vs ${profiles[j].name}: ${Math.round(d * 100)}% divergence`}
                        >
                          {Math.round(d * 100)}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
