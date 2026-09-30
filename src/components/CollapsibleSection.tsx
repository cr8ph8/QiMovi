import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";

interface CollapsibleSectionProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: string;
  badgeVariant?: "pill" | "plain";
  defaultOpen?: boolean;
  delay?: number;
  children: React.ReactNode;
}

export default function CollapsibleSection({
  icon, title, subtitle, badge, badgeColor, badgeVariant, defaultOpen = false, children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border border-border/50 bg-card/80 mb-3">
      <CollapsibleTrigger className="flex items-center gap-2 w-full p-3 hover:bg-muted/30 transition-colors rounded-xl">
        <div className="p-1 rounded-lg bg-primary/10 shrink-0">{icon}</div>
        <div className="flex-1 min-w-0 text-left">
          <h3 className="font-display text-xs font-semibold leading-tight">{title}</h3>
          {subtitle && <p className="text-[10px] text-muted-foreground truncate">{subtitle}</p>}
        </div>
        {badge && badgeVariant === "pill" ? (
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold shrink-0 ${badgeColor || "bg-primary/15 text-primary"}`}>{badge}</span>
        ) : badge ? (
          <span className={`font-mono text-xs font-bold shrink-0 ${badgeColor || "text-primary"}`}>{badge}</span>
        ) : null}
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}
