import { Info } from "lucide-react";

export function WhatThisMeansBox({
  title = "What this means",
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-surface-overlay/60 p-4">
      <div className="flex items-center gap-2 mb-1.5">
        <Info className="h-3.5 w-3.5 text-gold" />
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-gold">
          {title}
        </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}
