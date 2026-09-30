// Donor primitive — atomic metric card with optional delta + footer.
import { cn } from "@/lib/utils";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";

export interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  delta?: number;        // +/- change for trend arrow
  unit?: string;
  footer?: React.ReactNode;
  tone?: "default" | "primary" | "muted";
  className?: string;
}

export function MetricCard({ label, value, delta, unit, footer, tone = "default", className }: MetricCardProps) {
  const Trend = delta == null ? null : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const trendColor = delta == null ? "" : delta > 0 ? "text-emerald-400" : delta < 0 ? "text-destructive" : "text-muted-foreground";
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4",
        tone === "primary" && "border-primary/30 bg-primary/5",
        tone === "muted" && "border-dashed",
        tone === "default" && "border-border",
        className
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
        {Trend && (
          <span className={cn("inline-flex items-center text-xs", trendColor)}>
            <Trend className="h-3 w-3 mr-0.5" />
            {Math.abs(delta!).toFixed(1)}
          </span>
        )}
      </div>
      {footer && <div className="mt-2 text-[11px] text-muted-foreground">{footer}</div>}
    </div>
  );
}

export default MetricCard;
