import { Badge } from "@/components/ui/badge";

export interface TimelinePhase {
  id: string;
  label: string;
  startWeek: number;
  endWeek: number;
  completionPercent: number;
  documents: string[];
}

const DEFAULT_PHASES: TimelinePhase[] = [
  { id: "dev", label: "Development", startWeek: 0, endWeek: 12, completionPercent: 0, documents: ["screenplay", "pitch-deck", "treatment"] },
  { id: "preprod", label: "Pre-Production", startWeek: 10, endWeek: 20, completionPercent: 0, documents: ["budget", "schedule", "casting-brief"] },
  { id: "prod", label: "Production", startWeek: 18, endWeek: 30, completionPercent: 0, documents: ["daily-reports", "script-revisions"] },
  { id: "post", label: "Post-Production", startWeek: 28, endWeek: 40, completionPercent: 0, documents: ["rough-cut", "vfx-plan", "sound-design"] },
  { id: "dist", label: "Distribution", startWeek: 36, endWeek: 52, completionPercent: 0, documents: ["marketing-plan", "press-kit", "festival-strategy"] },
];

interface Props {
  phases?: TimelinePhase[];
}

export function TimelineView({ phases = DEFAULT_PHASES }: Props) {
  const totalWeeks = Math.max(...phases.map(p => p.endWeek));

  return (
    <div className="space-y-3 overflow-x-auto">
      {phases.map(phase => {
        const leftPct = (phase.startWeek / totalWeeks) * 100;
        const widthPct = ((phase.endWeek - phase.startWeek) / totalWeeks) * 100;

        return (
          <div key={phase.id} className="flex items-center gap-4 min-w-[500px]">
            <span className="text-xs text-muted-foreground w-28 shrink-0 text-right">{phase.label}</span>
            <div className="flex-1 relative h-10">
              <div className="absolute inset-0 bg-secondary/30 rounded" />
              <div
                className="absolute top-0 bottom-0 rounded bg-primary/20 border border-primary/30 flex items-center px-3"
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              >
                <div
                  className="absolute left-0 top-0 bottom-0 rounded bg-primary/40"
                  style={{ width: `${phase.completionPercent}%` }}
                />
                <span className="relative text-xs font-medium z-10">{phase.completionPercent}%</span>
              </div>
            </div>
            <div className="w-20 shrink-0">
              <span className="text-xs text-muted-foreground">{phase.documents.length} docs</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
