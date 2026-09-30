import { useEffect, useRef } from "react";
import { X, StickyNote, Trash2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Highlight } from "@/hooks/useHighlights";
import { FountainElement, FountainElementType } from "@/lib/fountain-parser";
import { cn } from "@/lib/utils";

const ELEMENT_TYPE_LABELS: Record<FountainElementType, string> = {
  scene_heading: "Scene Heading",
  character: "Character",
  parenthetical: "Parenthetical",
  dialogue: "Dialogue",
  action: "Action",
  transition: "Transition",
  page_break: "Page Break",
  title_page: "Title Page",
  empty: "Empty",
};

const COLOR_MAP: Record<string, string> = {
  yellow: "bg-yellow-400/30 border-yellow-500/50",
  green: "bg-emerald-400/30 border-emerald-500/50",
  blue: "bg-blue-400/30 border-blue-500/50",
  pink: "bg-pink-400/30 border-pink-500/50",
};

const COLOR_DOT: Record<string, string> = {
  yellow: "bg-yellow-400",
  green: "bg-emerald-400",
  blue: "bg-blue-400",
  pink: "bg-pink-400",
};

interface NotesPanelProps {
  open: boolean;
  onClose: () => void;
  highlights: Highlight[];
  elements: FountainElement[];
  onDelete?: (id: string) => Promise<boolean>;
  onScrollToElement?: (elementIndex: number) => void;
  newHighlightId?: string | null;
}

export default function NotesPanel({
  open, onClose, highlights, elements, onDelete, onScrollToElement, newHighlightId,
}: NotesPanelProps) {
  const newRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newly added note
  useEffect(() => {
    if (newHighlightId && newRef.current) {
      setTimeout(() => newRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 200);
    }
  }, [newHighlightId]);

  if (!open) return null;

  return (
    <div
      className="h-full w-[300px] shrink-0 bg-card border-l border-border shadow-2xl flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 shrink-0">
        <div className="flex items-center gap-2">
          <StickyNote className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold font-mono">Notes & Highlights</h3>
          <Badge variant="secondary" className="text-[9px] font-mono h-5 px-1.5">
            {highlights.length}
          </Badge>
        </div>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Notes list */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {highlights.length === 0 && (
            <div className="text-center py-10">
              <StickyNote className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground font-mono">No notes yet</p>
              <p className="text-[10px] text-muted-foreground/60 font-mono mt-1">
                Highlight text in the screenplay to add a note
              </p>
            </div>
          )}

          {highlights.map((h) => {
            const elType = h.element_index >= 0 && h.element_index < elements.length
              ? elements[h.element_index].type : null;
            const isNew = h.id === newHighlightId;
            const colorClasses = COLOR_MAP[h.color] || COLOR_MAP.yellow;
            const dotClass = COLOR_DOT[h.color] || COLOR_DOT.yellow;

            return (
              <div
                key={h.id}
                ref={isNew ? newRef : undefined}
                className={cn(
                  "rounded-lg border p-3 space-y-1.5 transition-all cursor-pointer hover:ring-1 hover:ring-primary/30",
                  colorClasses,
                  isNew && "ring-2 ring-primary/40 animate-pulse"
                )}
                onClick={() => onScrollToElement?.(h.element_index)}
              >
                {/* Element type + timestamp */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("h-2 w-2 rounded-full shrink-0", dotClass)} />
                    {elType && (
                      <Badge variant="outline" className="text-[8px] font-mono h-4 px-1 bg-background/50">
                        {ELEMENT_TYPE_LABELS[elType]}
                      </Badge>
                    )}
                  </div>
                  <span className="text-[9px] font-mono text-muted-foreground">
                    {new Date(h.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </div>

                {/* Selected text */}
                <p className="text-[11px] font-mono text-foreground/80 italic line-clamp-2">
                  "{h.selected_text}"
                </p>

                {/* Note content */}
                {h.note && (
                  <p className="text-xs text-foreground leading-relaxed">
                    {h.note}
                  </p>
                )}

                {/* Actions */}
                <div className="flex items-center gap-1 pt-1">
                  {onScrollToElement && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 text-[9px] font-mono gap-1 px-1.5"
                      onClick={() => onScrollToElement(h.element_index)}
                    >
                      <MapPin className="h-2.5 w-2.5" /> Jump
                    </Button>
                  )}
                  {onDelete && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 text-[9px] font-mono gap-1 px-1.5 text-destructive hover:text-destructive"
                      onClick={() => onDelete(h.id)}
                    >
                      <Trash2 className="h-2.5 w-2.5" /> Remove
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
