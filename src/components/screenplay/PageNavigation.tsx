import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface PageNavigationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export default function PageNavigation({ currentPage, totalPages, onPageChange }: PageNavigationProps) {
  if (totalPages <= 1) return null;

  const pct = Math.round(((currentPage + 1) / totalPages) * 100);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border/30 bg-card/50 shrink-0">
      <Button
        variant="ghost"
        size="sm"
        className="h-6 text-[10px] font-mono gap-1 shrink-0"
        disabled={currentPage === 0}
        onClick={() => onPageChange(currentPage - 1)}
      >
        <ChevronLeft className="h-3 w-3" /> Prev
      </Button>

      <div className="flex-1 min-w-0 flex flex-col items-center gap-0.5">
        <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
          Page {currentPage + 1} of {totalPages}
        </span>
        <span className="hidden sm:block text-[8px] text-muted-foreground/50 font-mono">← → to navigate</span>
        <Progress value={pct} className="h-1 w-full max-w-[200px]" />
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="h-6 text-[10px] font-mono gap-1 shrink-0"
        disabled={currentPage === totalPages - 1}
        onClick={() => onPageChange(currentPage + 1)}
      >
        Next <ChevronRight className="h-3 w-3" />
      </Button>
    </div>
  );
}
