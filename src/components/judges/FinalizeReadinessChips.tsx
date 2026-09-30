import { CheckCircle2, ShieldAlert, Crown, Users, Gauge, MessageSquareWarning } from "lucide-react";
import type { EntryReadiness } from "@/hooks/useEntryReadiness";

interface Props {
  readiness: EntryReadiness | null;
  minJudges?: number;
  maxVariance?: number;
  compact?: boolean;
}

interface Chip {
  key: string;
  label: string;
  icon: typeof CheckCircle2;
  ok: boolean;
  detail?: string;
}

export function FinalizeReadinessChips({ readiness, minJudges = 3, maxVariance = 4, compact }: Props) {
  const chips: Chip[] = [
    {
      key: "quorum",
      label: "Quorum",
      icon: Users,
      ok: !!readiness?.quorum_met,
      detail: `${readiness?.judge_sample_count ?? 0}/${minJudges}`,
    },
    {
      key: "variance",
      label: "Stability",
      icon: Gauge,
      ok: !!readiness?.variance_ok,
      detail:
        readiness?.current_variance != null
          ? `σ² ${readiness.current_variance.toFixed(2)} / ${maxVariance}`
          : undefined,
    },
    {
      key: "panel",
      label: "Threads",
      icon: MessageSquareWarning,
      ok: !!readiness?.panel_resolved,
    },
    {
      key: "coi",
      label: "COI clear",
      icon: ShieldAlert,
      ok: !!readiness?.coi_clear,
    },
    {
      key: "lead",
      label: "Lead reviewed",
      icon: Crown,
      ok: !!readiness?.lead_reviewed_at,
    },
  ];

  return (
    <div className={`flex flex-wrap gap-1.5 ${compact ? "" : "items-center"}`}>
      {chips.map((c) => {
        const Icon = c.ok ? CheckCircle2 : c.icon;
        const cls = c.ok
          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
          : "bg-amber-500/10 border-amber-500/40 text-amber-200";
        return (
          <span
            key={c.key}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border ${cls}`}
            title={c.detail || c.label}
          >
            <Icon className="h-3 w-3" />
            {c.label}
            {c.detail && <span className="opacity-70">· {c.detail}</span>}
          </span>
        );
      })}
    </div>
  );
}
