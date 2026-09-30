// Donor primitive — re-skinned to Cinema Aurea tokens.
// Tiny status badge used across hardened surfaces.
import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "gold";

const TONE: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  warning: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  danger:  "bg-destructive/10 text-destructive border-destructive/30",
  info:    "bg-sky-500/10 text-sky-400 border-sky-500/30",
  gold:    "bg-primary/10 text-primary border-primary/30",
};

export interface StatusPillProps {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}

export function StatusPill({ tone = "neutral", className, children }: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        TONE[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export default StatusPill;
