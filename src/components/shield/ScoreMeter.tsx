import { cn } from "@/lib/utils";

interface Props {
  value: number; // 0..100
  label: string;
  sublabel?: string;
  size?: number;
  variant?: "gold" | "shield" | "neutral";
  className?: string;
}

export function ScoreMeter({
  value,
  label,
  sublabel,
  size = 140,
  variant = "gold",
  className,
}: Props) {
  const v = Math.max(0, Math.min(100, value));
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (v / 100) * circumference;

  const stroke =
    variant === "shield"
      ? "hsl(var(--shield-crimson-glow))"
      : variant === "neutral"
        ? "hsl(var(--muted-foreground))"
        : "hsl(var(--gold))";

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="hsl(var(--border))"
            strokeWidth={6}
            fill="none"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={stroke}
            strokeWidth={6}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 800ms ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-3xl font-bold tabular-nums">{Math.round(v)}</span>
          {sublabel && (
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              {sublabel}
            </span>
          )}
        </div>
      </div>
      <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground text-center max-w-[140px]">
        {label}
      </span>
    </div>
  );
}
