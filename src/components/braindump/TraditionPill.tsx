import { Badge } from "@/components/ui/badge";
import { TRADITION_SHORT_LABELS, type NarrativeTradition } from "@/lib/narrativeTradition";

const COLORS: Record<NarrativeTradition, string> = {
  causal_western: "border-amber-500/40 text-amber-300 bg-amber-500/10",
  relational_eastern: "border-sky-500/40 text-sky-300 bg-sky-500/10",
  hybrid: "border-primary/40 text-primary bg-primary/10",
};

export function TraditionPill({
  tradition,
  confidence,
}: {
  tradition: NarrativeTradition;
  confidence?: number | null;
}) {
  return (
    <Badge variant="outline" className={COLORS[tradition]}>
      {TRADITION_SHORT_LABELS[tradition]}
      {typeof confidence === "number" && (
        <span className="ml-1.5 opacity-70">
          {(confidence * 100).toFixed(0)}%
        </span>
      )}
    </Badge>
  );
}
