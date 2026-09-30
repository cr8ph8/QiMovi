// Donor primitive — compact horizontal score bar with confidence band.
import { cn } from "@/lib/utils";

export interface QiSecScoreBarProps {
  label: string;
  value: number;         // 0..100
  confidence?: number;   // 0..1
  className?: string;
}

export function QiSecScoreBar({ label, value, confidence, className }: QiSecScoreBarProps) {
  const v = Math.max(0, Math.min(100, value));
  const conf = confidence == null ? null : Math.max(0, Math.min(1, confidence));
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums font-medium">
          {v.toFixed(0)}
          {conf != null && <span className="text-muted-foreground ml-1">· {Math.round(conf * 100)}%</span>}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary/70 to-primary"
          style={{ width: `${v}%` }}
        />
        {conf != null && (
          <div
            className="absolute inset-y-0 bg-foreground/20 rounded-full"
            style={{ left: `${Math.max(0, v - (1 - conf) * 25)}%`, width: `${(1 - conf) * 50}%` }}
            aria-label="confidence band"
          />
        )}
      </div>
    </div>
  );
}

export default QiSecScoreBar;
