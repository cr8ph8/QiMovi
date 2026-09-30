import { CheckCircle2, FileText, Sparkles, Shield, BadgeCheck, NotebookPen } from "lucide-react";

export interface LineageStep {
  label: string;
  timestamp?: string | null;
  detail?: string;
  status: "complete" | "pending";
  icon?: "upload" | "metadata" | "ai" | "analysis" | "notes" | "certificate";
}

const ICONS = {
  upload: FileText,
  metadata: NotebookPen,
  ai: Sparkles,
  analysis: Shield,
  notes: NotebookPen,
  certificate: BadgeCheck,
} as const;

export function DraftLineageTimeline({ steps }: { steps: LineageStep[] }) {
  return (
    <ol className="relative border-l border-border ml-3 space-y-6">
      {steps.map((step, idx) => {
        const Icon = ICONS[step.icon ?? "analysis"] ?? CheckCircle2;
        const isDone = step.status === "complete";
        return (
          <li key={idx} className="ml-6">
            <span
              className={`absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full border ${
                isDone
                  ? "bg-gold/20 border-gold text-gold"
                  : "bg-muted border-border text-muted-foreground"
              }`}
            >
              <Icon className="w-3 h-3" />
            </span>
            <h4 className="font-display text-sm font-semibold">{step.label}</h4>
            {step.timestamp && (
              <time className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                {new Date(step.timestamp).toLocaleString()}
              </time>
            )}
            {step.detail && (
              <p className="text-xs text-muted-foreground mt-1">{step.detail}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
