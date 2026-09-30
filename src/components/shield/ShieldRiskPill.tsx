import { Shield } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { RiskBand } from "@/lib/shield/scoring";

const STYLES: Record<RiskBand, string> = {
  low: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  moderate: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  high: "bg-shield/15 text-shield border-shield/40",
  critical: "bg-shield-deep/30 text-shield-glow border-shield-glow/50",
};

const LABELS: Record<RiskBand, string> = {
  low: "Shield · Low",
  moderate: "Shield · Moderate",
  high: "Shield · High",
  critical: "Shield · Critical",
};

interface Props {
  band: RiskBand;
  submissionId?: string;
  integrity?: number;
  className?: string;
}

export function ShieldRiskPill({ band, submissionId, integrity, className }: Props) {
  const content = (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-mono uppercase tracking-wider",
        STYLES[band],
        className,
      )}
      title={typeof integrity === "number" ? `Authorship integrity: ${Math.round(integrity)}/100` : undefined}
    >
      <Shield className="h-3 w-3" />
      {LABELS[band]}
    </span>
  );
  if (submissionId) {
    return (
      <Link to={`/shield/report/${submissionId}`} onClick={(e) => e.stopPropagation()}>
        {content}
      </Link>
    );
  }
  return content;
}
