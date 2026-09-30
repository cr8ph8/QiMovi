/**
 * FranchiseTimeline — Vertical drag-to-reorder list for franchise installments.
 * Represents narrative chronological order. Drag rows to reorder, persists sort_order.
 */
import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TimelineEntry {
  ue_id: string;
  entry_id: string;
  title: string;
  genre: string | null;
  status: string;
  pageCount: number | null;
  logline: string | null;
  sortOrder: number;
}

interface Props {
  entries: TimelineEntry[];
  onReorder?: (reordered: TimelineEntry[]) => void;
}

const GENRE_COLORS: Record<string, string> = {
  "Sci-Fi": "hsl(var(--primary))",
  Horror: "hsl(350 60% 50%)",
  Comedy: "hsl(50 80% 50%)",
  Drama: "hsl(200 60% 50%)",
  Action: "hsl(30 80% 55%)",
  Thriller: "hsl(280 50% 55%)",
  Romance: "hsl(340 60% 60%)",
  Fantasy: "hsl(160 60% 50%)",
};

const getGenreColor = (genre: string | null) =>
  genre ? GENRE_COLORS[genre] || "hsl(var(--muted-foreground))" : "hsl(var(--muted-foreground))";

const ROW_HEIGHT = 64;

export default function FranchiseTimeline({ entries, onReorder }: Props) {
  const navigate = useNavigate();
  const [items, setItems] = useState(entries);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const startY = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Sync prop changes
  const prevEntries = useRef(entries);
  if (entries !== prevEntries.current) {
    prevEntries.current = entries;
    setItems(entries);
  }

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, idx: number) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      startY.current = e.clientY;
      setDragIdx(idx);
      setOverIdx(idx);
      setDragOffsetY(0);
      dragging.current = true;
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current || dragIdx === null) return;
      const dy = e.clientY - startY.current;
      setDragOffsetY(dy);

      // Determine which index the dragged item is hovering over
      const newOver = Math.min(
        items.length - 1,
        Math.max(0, Math.round(dragIdx + dy / ROW_HEIGHT))
      );
      setOverIdx(newOver);
    },
    [dragIdx, items.length]
  );

  const handlePointerUp = useCallback(async () => {
    if (!dragging.current || dragIdx === null || overIdx === null) return;
    dragging.current = false;

    if (dragIdx !== overIdx) {
      const reordered = [...items];
      const [moved] = reordered.splice(dragIdx, 1);
      reordered.splice(overIdx, 0, moved);

      // Assign new sortOrder values
      const updated = reordered.map((item, i) => ({ ...item, sortOrder: i + 1 }));
      setItems(updated);
      onReorder?.(updated);

      // Persist to DB
      await Promise.all(
        updated.map((item) =>
          supabase
            .from("universe_entries")
            .update({ sort_order: item.sortOrder })
            .eq("id", item.ue_id)
        )
      );
    }

    setDragIdx(null);
    setOverIdx(null);
    setDragOffsetY(0);
  }, [dragIdx, overIdx, items, onReorder]);

  if (items.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-6">
        No installments to display.
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="space-y-0 select-none"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {items.map((entry, idx) => {
        const isDragged = dragIdx === idx;
        const color = getGenreColor(entry.genre);

        // Calculate visual offset during drag
        let translateY = 0;
        if (dragIdx !== null && overIdx !== null && !isDragged) {
          if (dragIdx < overIdx && idx > dragIdx && idx <= overIdx) {
            translateY = -ROW_HEIGHT;
          } else if (dragIdx > overIdx && idx < dragIdx && idx >= overIdx) {
            translateY = ROW_HEIGHT;
          }
        }

        return (
          <div
            key={entry.ue_id}
            className={cn(
              "relative flex items-center gap-3 px-3 py-2 rounded-lg border transition-all duration-150",
              isDragged
                ? "z-50 shadow-lg border-primary/40 bg-card scale-[1.02]"
                : "border-transparent hover:border-border/40 hover:bg-muted/30"
            )}
            style={{
              height: ROW_HEIGHT,
              transform: isDragged
                ? `translateY(${dragOffsetY}px)`
                : `translateY(${translateY}px)`,
              transition: isDragged ? "none" : "transform 150ms ease",
            }}
          >
            {/* Drag handle */}
            <div
              className="shrink-0 cursor-grab active:cursor-grabbing touch-none text-muted-foreground/40 hover:text-muted-foreground"
              onPointerDown={(e) => handlePointerDown(e, idx)}
            >
              <GripVertical className="h-4 w-4" />
            </div>

            {/* Position number */}
            <span className="shrink-0 w-5 text-center text-[11px] font-mono font-semibold text-muted-foreground">
              {idx + 1}
            </span>

            {/* Genre color accent */}
            <div
              className="shrink-0 w-1 h-8 rounded-full"
              style={{ backgroundColor: color }}
            />

            {/* Title + logline */}
            <div
              className="flex-1 min-w-0 cursor-pointer"
              onClick={() => navigate(`/entry/${entry.entry_id}`)}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground truncate">
                  {entry.title}
                </span>
              </div>
              {entry.logline && (
                <p className="text-[11px] text-muted-foreground truncate mt-0.5 font-mono">
                  {entry.logline}
                </p>
              )}
            </div>

            {/* Metadata */}
            <div className="shrink-0 flex items-center gap-2">
              {entry.genre && (
                <span className="text-[10px] font-mono text-muted-foreground hidden sm:inline">
                  {entry.genre}
                </span>
              )}
              {entry.pageCount && (
                <span className="text-[10px] font-mono text-muted-foreground">
                  {entry.pageCount}p
                </span>
              )}
              <Badge variant="secondary" className="text-[9px] font-mono capitalize">
                {entry.status}
              </Badge>
            </div>
          </div>
        );
      })}

      <p className="text-[10px] font-mono text-muted-foreground/50 pt-2 text-center">
        Drag to reorder narrative chronology
      </p>
    </div>
  );
}
