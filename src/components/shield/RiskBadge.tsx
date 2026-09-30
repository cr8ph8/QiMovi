import { cn } from "@/lib/utils";
import type { RiskBand } from "@/lib/shield/scoring";

const STYLES: Record<RiskBand, string> = {
  low: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  moderate: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  high: "bg-shield/15 text-shield border-shield/40",
  critical: "bg-shield-deep/30 text-shield-glow border-shield-glow/50",
};

const LABELS: Record<RiskBand, string> = {
  low: "Low Risk",
  moderate: "Moderate Risk",
  high: "High Risk",
  critical: "Critical Risk",
};

export function RiskBadge({ band, className }: { band: RiskBand; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-mono uppercase tracking-wider",
        STYLES[band],
        className,
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {LABELS[band]}
    </span>
  );
}
