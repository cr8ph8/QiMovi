import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, TrendingUp, TrendingDown, Minus, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ScoreData {
  originality: number;
  structure: number;
  character_depth: number;
  dialogue: number;
  theme: number;
  emotion: number;
  format_adherence: number;
  total_score: number;
  [key: string]: any;
}

interface DraftData {
  id: string;
  draft_number: number;
  created_at: string;
  scores: ScoreData | null;
}

const DRAFT_CATEGORIES: { key: keyof ScoreData; label: string; max: number }[] = [
  { key: "originality", label: "Originality", max: 20 },
  { key: "structure", label: "Structure", max: 20 },
  { key: "character_depth", label: "Character", max: 15 },
  { key: "dialogue", label: "Dialogue", max: 15 },
  { key: "theme", label: "Theme", max: 10 },
  { key: "emotion", label: "Emotion", max: 10 },
  { key: "format_adherence", label: "Format", max: 10 },
];

interface DraftHistoryRowProps {
  draft: DraftData;
  prev: DraftData | null;
  delta: number | null;
  hasCategoryDeltas: boolean;
  isCurrent: boolean;
  isBest?: boolean;
}

export default function DraftHistoryRow({ draft, prev, delta, hasCategoryDeltas, isCurrent, isBest }: DraftHistoryRowProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`rounded-lg transition-colors ${isCurrent ? "bg-primary/10 border border-primary/20" : "hover:bg-muted/50"}`}>
      <div className="flex items-center justify-between p-2.5">
        <div className="flex items-center gap-2">
          {hasCategoryDeltas && (
            <button onClick={(e) => { e.preventDefault(); setExpanded((v) => !v); }} className="p-0.5 rounded hover:bg-muted/50">
              <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
          )}
          <Link to={`/entry/${draft.id}`} className="flex items-center gap-2">
            <Badge variant="outline" className="text-[9px] font-mono shrink-0">v{draft.draft_number}</Badge>
            <span className="text-xs text-muted-foreground font-mono">{new Date(draft.created_at).toLocaleDateString()}</span>
          </Link>
        </div>
        <Link to={`/entry/${draft.id}`} className="flex items-center gap-2">
          {delta !== null && (
            <span className={`flex items-center gap-0.5 text-xs font-mono font-semibold ${delta > 0 ? "text-emerald-500" : delta < 0 ? "text-destructive" : "text-muted-foreground"}`}>
              {delta > 0 ? <TrendingUp className="h-3 w-3" /> : delta < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
              {delta > 0 ? `+${delta}` : delta === 0 ? "—" : delta}
            </span>
          )}
          {isBest && (
            <span className="flex items-center gap-0.5 text-amber-500">
              <Trophy className="h-3 w-3" />
              <span className="text-[9px] font-semibold uppercase">Best</span>
            </span>
          )}
          <span className={`font-mono text-sm font-bold ${draft.scores ? "text-primary" : "text-muted-foreground"}`}>
            {draft.scores ? draft.scores.total_score : "—"}
          </span>
        </Link>
      </div>
      {expanded && hasCategoryDeltas && draft.scores && prev?.scores && (
        <div className="px-3 pb-2 grid grid-cols-2 gap-x-3 gap-y-1 ml-6">
          {DRAFT_CATEGORIES.map((cat) => {
            const curr = Number(draft.scores![cat.key]) || 0;
            const prevVal = Number(prev.scores![cat.key]) || 0;
            const d = curr - prevVal;
            return (
              <div key={cat.key} className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">{cat.label}</span>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-mono">{curr}/{cat.max}</span>
                  {d !== 0 && <span className={`text-[10px] font-mono font-semibold ${d > 0 ? "text-emerald-500" : "text-destructive"}`}>{d > 0 ? `+${d}` : d}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { DRAFT_CATEGORIES };
export type { DraftData, ScoreData };
