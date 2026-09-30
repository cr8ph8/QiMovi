import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DiffRow, NormalizedDim } from "@/lib/rubric-diff";

function DimCell({
  dim,
  tone,
  highlightLabel,
  highlightWeight,
}: {
  dim?: NormalizedDim;
  tone: "neutral" | "added" | "removed";
  highlightLabel?: boolean;
  highlightWeight?: boolean;
}) {
  if (!dim) {
    return <span className="text-[11px] font-mono text-muted-foreground/40 italic">—</span>;
  }
  const toneClass =
    tone === "added"
      ? "text-emerald-300"
      : tone === "removed"
      ? "text-destructive line-through"
      : "text-muted-foreground";
  return (
    <div className={cn("flex flex-col gap-0.5", toneClass)}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-mono opacity-70">{dim.key}</span>
        {dim.weight != null && (
          <span
            className={cn(
              "text-[10px] font-mono rounded px-1 py-px",
              highlightWeight
                ? "bg-amber-500/20 text-amber-300"
                : "bg-muted/40 text-muted-foreground",
            )}
          >
            w:{dim.weight}
          </span>
        )}
      </div>
      <span
        className={cn(
          "text-xs",
          highlightLabel && "bg-amber-500/15 text-amber-200 rounded px-1 -mx-1",
        )}
      >
        {dim.label}
      </span>
    </div>
  );
}

interface RubricDiffTableProps {
  rows: DiffRow[];
  prevHeader: string;
  nextHeader: string;
  emptyMessage?: string;
}

export default function RubricDiffTable({
  rows,
  prevHeader,
  nextHeader,
  emptyMessage,
}: RubricDiffTableProps) {
  if (rows.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic px-2 py-4 text-center">
        {emptyMessage ?? "No dimensions to compare."}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/30 overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_1fr] bg-muted/40 px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        <div>{prevHeader}</div>
        <div className="px-2">→</div>
        <div>{nextHeader}</div>
      </div>
      <div className="divide-y divide-border/20">
        {rows.map((r) => {
          const bg =
            r.status === "added"
              ? "bg-emerald-500/5"
              : r.status === "removed"
              ? "bg-destructive/5"
              : r.status === "changed"
              ? "bg-amber-500/5"
              : "";
          return (
            <div
              key={r.key}
              className={cn("grid grid-cols-[1fr_auto_1fr] px-3 py-2 items-center gap-2", bg)}
            >
              <DimCell
                dim={r.prev}
                tone={r.status === "removed" ? "removed" : "neutral"}
                highlightLabel={r.status === "changed" && r.labelChanged}
                highlightWeight={r.status === "changed" && r.weightChanged}
              />
              <div className="flex flex-col items-center gap-1">
                <ArrowRight
                  className={cn(
                    "h-3 w-3",
                    r.status === "added"
                      ? "text-emerald-400"
                      : r.status === "removed"
                      ? "text-destructive"
                      : r.status === "changed"
                      ? "text-amber-400"
                      : "text-muted-foreground/40",
                  )}
                />
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[9px] font-mono px-1 py-0",
                    r.status === "added" && "border-emerald-500/40 text-emerald-300",
                    r.status === "removed" && "border-destructive/40 text-destructive",
                    r.status === "changed" && "border-amber-500/40 text-amber-300",
                    r.status === "equal" && "border-border text-muted-foreground/60",
                  )}
                >
                  {r.status}
                </Badge>
              </div>
              <DimCell
                dim={r.next}
                tone={r.status === "added" ? "added" : "neutral"}
                highlightLabel={r.status === "changed" && r.labelChanged}
                highlightWeight={r.status === "changed" && r.weightChanged}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
