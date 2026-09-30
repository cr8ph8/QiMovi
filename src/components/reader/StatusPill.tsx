import { cn } from "@/lib/utils";

interface Props {
  status: string;
  size?: "sm" | "md";
}

const styles: Record<string, string> = {
  Draft: "bg-muted text-muted-foreground border border-border",
  Review: "bg-amber-500/10 text-amber-500 border border-amber-500/30",
  Approved: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30",
  Locked: "bg-primary/15 text-primary border border-primary/40",
  Deprecated: "bg-destructive/15 text-destructive border border-destructive/30",
  Restricted: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
};

export function StatusPill({ status, size = "md" }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-mono font-medium uppercase tracking-wide",
        size === "sm" ? "px-2 py-0.5 text-[9px]" : "px-2.5 py-1 text-[10px]",
        styles[status] || "bg-muted text-muted-foreground"
      )}
    >
      {status}
    </span>
  );
}
