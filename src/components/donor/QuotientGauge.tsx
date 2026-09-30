// Donor primitive — circular gauge for 0-100 quotient-style scores.
import { cn } from "@/lib/utils";

export interface QuotientGaugeProps {
  value: number;        // 0..100
  label?: string;
  size?: number;        // px
  className?: string;
  showValue?: boolean;
}

export function QuotientGauge({ value, label, size = 96, className, showValue = true }: QuotientGaugeProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - clamped / 100);
  const tone =
    clamped >= 80 ? "hsl(var(--primary))" :
    clamped >= 60 ? "hsl(45 80% 55%)" :
    clamped >= 40 ? "hsl(35 80% 55%)" :
                    "hsl(var(--destructive))";

  return (
    <div className={cn("inline-flex flex-col items-center", className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="hsl(var(--border))" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          fill="none"
          style={{ transition: "stroke-dashoffset 600ms ease" }}
        />
      </svg>
      {showValue && (
        <div className="-mt-[60%] flex flex-col items-center pointer-events-none">
          <span className="text-xl font-semibold tabular-nums" style={{ color: tone }}>{Math.round(clamped)}</span>
          {label && <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{label}</span>}
        </div>
      )}
    </div>
  );
}

export default QuotientGauge;
