import { CheckCircle, Circle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const STEPS = [
  { key: "submitted", label: "Submitted" },
  { key: "under_review", label: "Scoring" },
  { key: "scored", label: "Scored" },
  { key: "shortlisted", label: "Shortlisted" },
  { key: "accepted", label: "Finalist" },
];

const STATUS_ORDER: Record<string, number> = {
  submitted: 0,
  judging: 1,
  under_review: 1,
  scored: 2,
  shortlisted: 3,
  accepted: 4,
  disqualified: -1,
};

interface SubmissionProgressBarProps {
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function SubmissionProgressBar({ status, createdAt, updatedAt }: SubmissionProgressBarProps) {
  const currentStep = STATUS_ORDER[status] ?? 0;
  const isDisqualified = status === "disqualified";

  if (isDisqualified) {
    return (
      <div className="flex items-center gap-2 text-xs font-mono text-destructive">
        <Circle className="h-3 w-3 fill-destructive" />
        Disqualified
        {updatedAt && (
          <span className="text-muted-foreground ml-1">· {formatTimestamp(updatedAt)}</span>
        )}
      </div>
    );
  }

  function getStepTooltip(stepIndex: number): string | null {
    if (stepIndex === 0 && createdAt) {
      return `Submitted ${formatTimestamp(createdAt)}`;
    }
    if (stepIndex === currentStep && updatedAt) {
      return `Entered stage ${formatTimestamp(updatedAt)}`;
    }
    if (stepIndex < currentStep) {
      return "Completed";
    }
    return "Pending";
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center gap-1 overflow-x-auto">
        {STEPS.map((step, i) => {
          const completed = i <= currentStep;
          const isCurrent = i === currentStep;
          const tooltip = getStepTooltip(i);
          return (
            <div key={step.key} className="flex items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono whitespace-nowrap transition-colors cursor-default ${
                    isCurrent
                      ? "bg-primary/10 text-primary font-semibold"
                      : completed
                        ? "text-primary/60"
                        : "text-muted-foreground/40"
                  }`}>
                    {completed ? (
                      <CheckCircle className={`h-3 w-3 ${isCurrent ? "text-primary" : "text-primary/50"}`} />
                    ) : (
                      <Circle className="h-3 w-3" />
                    )}
                    <span className="hidden sm:inline">{step.label}</span>
                  </div>
                </TooltipTrigger>
                {tooltip && (
                  <TooltipContent side="bottom" className="text-xs font-mono">
                    {tooltip}
                  </TooltipContent>
                )}
              </Tooltip>
              {i < STEPS.length - 1 && (
                <div className={`w-4 h-px mx-0.5 ${completed && i < currentStep ? "bg-primary/40" : "bg-border"}`} />
              )}
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
