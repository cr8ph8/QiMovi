import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  index: number;
  title: string;
  formula: string;
  explanation: string;
  className?: string;
}

export function FormulaCard({ index, title, formula, explanation, className }: Props) {
  return (
    <Card
      className={cn(
        "relative overflow-hidden border-shield/20 bg-surface-elevated/60 backdrop-blur",
        className,
      )}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-shield-gradient opacity-60" />
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-shield">
            Formula {index}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Q2E
          </span>
        </div>
        <h3 className="font-display text-xl font-semibold">{title}</h3>
        <pre className="rounded-md border border-shield/30 bg-background/60 px-4 py-3 font-mono text-sm text-shield-glow overflow-x-auto">
          {formula}
        </pre>
        <p className="text-sm text-muted-foreground leading-relaxed">{explanation}</p>
      </CardContent>
    </Card>
  );
}
