import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  variant?: "default" | "compact" | "certificate";
  className?: string;
}

/**
 * Mandatory disclaimer rendered on every Qi Authorship Shield surface.
 * Three canonical lines — do not edit copy without product approval.
 */
export function ShieldDisclaimer({ variant = "default", className }: Props) {
  if (variant === "compact") {
    return (
      <p className={cn("text-[11px] font-mono uppercase tracking-wider text-muted-foreground", className)}>
        Prototype / platform scoring only — not legal advice.
      </p>
    );
  }

  if (variant === "certificate") {
    return (
      <div className={cn("border-t border-shield/30 pt-4 mt-4 text-[11px] text-muted-foreground leading-relaxed", className)}>
        <p className="font-mono uppercase tracking-widest text-shield mb-2">Disclaimer</p>
        <p>
          This certificate is not legal advice and does not determine copyright ownership
          or infringement. CanIScreenwrite evaluates authorship integrity, originality,
          provenance risk, and creative similarity. Scores are assistive indicators for
          writers, producers, publishers, competitions, and rights holders.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-shield/30 bg-shield/5 p-4 flex gap-3",
        className,
      )}
    >
      <ShieldAlert className="h-5 w-5 text-shield shrink-0 mt-0.5" />
      <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
        <p>
          <strong className="text-foreground">Prototype / platform scoring only — not legal advice.</strong>
        </p>
        <p>
          CanIScreenwrite evaluates authorship integrity, originality, provenance risk,
          and creative similarity. It does not make final copyright determinations.
        </p>
        <p>
          Scores are assistive indicators for writers, producers, publishers, competitions,
          and rights holders.
        </p>
      </div>
    </div>
  );
}
