/**
 * ScreenplayReaderView — immersive paginated reader for public screenplay display.
 * Uses paginateElements() + PageNavigation for page-by-page reading.
 * Supports keyboard navigation (arrow keys), reading progress, and estimated read time.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { FountainElement } from "@/lib/fountain-parser";
import { PaginatedResult } from "@/lib/fountain-paginator";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Clock, BookOpen } from "lucide-react";
import PageNavigation from "./PageNavigation";
import { cn } from "@/lib/utils";

interface ScreenplayReaderViewProps {
  paginated: PaginatedResult;
  title?: string;
  pageCount?: number | null;
}

function ReaderElement({ el }: { el: FountainElement }) {
  const base = "mb-2";
  const style = { fontFamily: "'Courier Prime', 'Courier New', monospace" };

  switch (el.type) {
    case "scene_heading":
      return <p className={`${base} font-bold uppercase tracking-wide text-primary mt-6`} style={style}>{el.text}</p>;
    case "action":
      return <p className={`${base} text-foreground leading-relaxed`} style={style}>{el.text}</p>;
    case "character":
      return <p className={`${base} text-center uppercase font-semibold mt-4 text-foreground`} style={style}>{el.text}</p>;
    case "dialogue":
      return <p className={`${base} mx-auto max-w-[65%] text-foreground`} style={style}>{el.text}</p>;
    case "parenthetical":
      return <p className={`${base} mx-auto max-w-[50%] italic text-muted-foreground`} style={style}>{el.text}</p>;
    case "transition":
      return <p className={`${base} text-right uppercase text-muted-foreground`} style={style}>{el.text}</p>;
    case "page_break":
      return <hr className="border-border/30 my-4" />;
    case "empty":
      return <div className="h-3" />;
    default:
      return <p className={`${base} text-muted-foreground`} style={style}>{el.text}</p>;
  }
}

export default function ScreenplayReaderView({ paginated, title, pageCount }: ScreenplayReaderViewProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const totalPages = paginated.pages.length;

  // Estimated read time: ~1 min per page of screenplay
  const readTimeMin = pageCount || totalPages;

  const progressPct = totalPages > 0 ? Math.round(((currentPage + 1) / totalPages) * 100) : 0;

  // Keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      setCurrentPage(p => Math.min(p + 1, totalPages - 1));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      setCurrentPage(p => Math.max(p - 1, 0));
    }
  }, [totalPages]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const currentElements = paginated.pages[currentPage] || [];

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 overflow-hidden flex flex-col">
      {/* Reader header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/30 bg-muted/20">
        <div className="flex items-center gap-3">
          <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Reader</span>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-[9px] font-mono gap-1">
            <Clock className="h-2.5 w-2.5" />
            ~{readTimeMin} min read
          </Badge>
          <span className="text-[10px] font-mono text-muted-foreground">{progressPct}% read</span>
        </div>
      </div>

      {/* Reading progress */}
      <Progress value={progressPct} className="h-0.5 rounded-none" />

      {/* Title page */}
      {currentPage === 0 && paginated.titlePage && (
        <div className="text-center py-12 px-8 border-b border-border/20" style={{ fontFamily: "'Courier Prime', 'Courier New', monospace" }}>
          <p className="text-lg font-bold uppercase tracking-wider text-foreground">
            {paginated.titlePage.title || title}
          </p>
          {paginated.titlePage.credit && (
            <p className="mt-4 text-sm text-muted-foreground">{paginated.titlePage.credit}</p>
          )}
          {paginated.titlePage.author && (
            <p className="mt-1 text-sm text-foreground">{paginated.titlePage.author}</p>
          )}
          {paginated.titlePage.contact && (
            <p className="mt-4 text-xs text-muted-foreground">{paginated.titlePage.contact}</p>
          )}
        </div>
      )}

      {/* Page content */}
      <div className="flex-1 overflow-y-auto px-8 md:px-16 py-8 min-h-[50vh] max-h-[70vh]" style={{ fontFamily: "'Courier Prime', 'Courier New', monospace", fontSize: "14px", lineHeight: "1.5" }}>
        <div className="max-w-[650px] mx-auto">
          {currentElements.map((el, i) => (
            <ReaderElement key={`${currentPage}-${i}`} el={el} />
          ))}
        </div>
      </div>

      {/* Page navigation */}
      <PageNavigation
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />
    </div>
  );
}
