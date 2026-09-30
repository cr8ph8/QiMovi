/**
 * ScorecardProvenanceTooltip
 *
 * Wraps a top-ranked total (Leaderboard, Seasons, FutureReaders, etc.) with a
 * shadcn tooltip that confirms the displayed number comes from the canonical
 * `v_entry_scorecard` view — the single source of truth every scoring surface
 * reads through. Keeps the visual layout unchanged; adds only the hover/focus
 * disclosure plus an accessible label so screen readers announce the source.
 */
import { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  children: ReactNode;
  /** Optional short suffix appended to the tooltip body (e.g., "Finalized"). */
  detail?: string;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

export function ScorecardProvenanceTooltip({
  children,
  detail,
  side = "top",
  className,
}: Props) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger
          asChild
          aria-label="Score source: canonical v_entry_scorecard view"
        >
          <span
            className={
              "cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2 " +
              (className ?? "")
            }
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-xs text-xs">
          <p className="font-semibold mb-1">Canonical score</p>
          <p>
            Read from <code className="font-mono">v_entry_scorecard</code>, the
            single source of truth. Same number as the TrustReport, judges
            console, and batch summary.
          </p>
          {detail && (
            <p className="mt-1 text-muted-foreground">{detail}</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
