/**
 * CharacterBeliefTimeline — renders character_belief_events for a single
 * diamond as a prior → evidence → posterior chain.
 *
 * Schema (public.character_belief_events):
 *   id, diamond_id, entry_id, draft_id, turn_label, kind,
 *   detected_by, evidence (jsonb), correlation_id, created_at
 *
 * `kind` examples: 'update_required', 'identity_threat', 'sycophancy_risk',
 * 'evidence_consistent', 'state_delta_too_large', 'rollback'.
 */
import { useMemo } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles, ShieldAlert, Activity, CheckCircle2 } from "lucide-react";

export interface BeliefEvent {
  id: string;
  kind: string | null;
  turn_label: string | null;
  detected_by: string | null;
  evidence: unknown;
  created_at: string;
}

const KIND_META: Record<string, { tone: string; icon: typeof Sparkles; label: string }> = {
  update_required:        { tone: "text-amber-400",   icon: Sparkles,      label: "Update required" },
  noise_only:             { tone: "text-emerald-400", icon: CheckCircle2,  label: "Noise only" },
  agreement_with_user_not_gold: { tone: "text-red-400", icon: ShieldAlert, label: "Sycophantic agreement" },
  sycophancy_risk:        { tone: "text-red-400",     icon: ShieldAlert,   label: "Sycophancy risk" },
  state_delta_too_large:  { tone: "text-red-400",     icon: ShieldAlert,   label: "State delta too large" },
  identity_threat_spike:  { tone: "text-amber-400",   icon: ShieldAlert,   label: "Identity threat" },
  identity_threat:        { tone: "text-amber-400",   icon: ShieldAlert,   label: "Identity threat" },
  evidence_consistent:    { tone: "text-emerald-400", icon: CheckCircle2,  label: "Evidence consistent" },
  rollback:               { tone: "text-red-400",     icon: ShieldAlert,   label: "Rollback" },
  default:                { tone: "text-muted-foreground", icon: Activity, label: "Event" },
};

function metaFor(kind: string | null) {
  if (!kind) return KIND_META.default;
  return KIND_META[kind] ?? { ...KIND_META.default, label: kind.replace(/_/g, " ") };
}

function textOf(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const v = (value as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

export default function CharacterBeliefTimeline({
  events,
  characterName,
}: {
  events: BeliefEvent[];
  characterName: string;
}) {
  const ordered = useMemo(
    () => [...events].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [events],
  );

  if (ordered.length === 0) {
    return (
      <p className="text-[9px] font-mono text-muted-foreground italic text-center py-2">
        No belief events recorded for {characterName}.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {ordered.map((e, i) => {
        const meta = metaFor(e.kind);
        const Icon = meta.icon;
        const prior = textOf(e.evidence, "prior") ?? textOf(e.evidence, "rationale");
        const evidence = textOf(e.evidence, "evidence") ?? textOf(e.evidence, "detail");
        const posterior = textOf(e.evidence, "posterior") ?? textOf(e.evidence, "decision");

        return (
          <motion.div
            key={e.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i, 8) * 0.04 }}
            className="rounded border border-border/40 bg-card/40 px-2.5 py-2 space-y-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Icon className={`h-3 w-3 ${meta.tone}`} />
                <span className={`text-[9px] font-mono uppercase tracking-wider ${meta.tone}`}>
                  {meta.label}
                </span>
              </div>
              <span className="text-[8px] font-mono text-muted-foreground">
                {e.turn_label ?? new Date(e.created_at).toLocaleDateString()}
              </span>
            </div>

            {(prior || evidence || posterior) && (
              <div className="space-y-1 pl-1">
                {prior && (
                  <p className="text-[9px] font-mono text-muted-foreground italic">
                    <span className="text-primary/80">prior:</span> {prior}
                  </p>
                )}
                {evidence && (
                  <p className="text-[9px] font-mono text-muted-foreground flex items-start gap-1">
                    <ArrowRight className="h-2.5 w-2.5 text-primary mt-0.5 shrink-0" />
                    <span>{evidence}</span>
                  </p>
                )}
                {posterior && (
                  <p className="text-[9px] font-mono text-emerald-400/90 italic flex items-start gap-1">
                    <ArrowRight className="h-2.5 w-2.5 mt-0.5 shrink-0" />
                    <span>{posterior}</span>
                  </p>
                )}
              </div>
            )}

            {e.detected_by && (
              <p className="text-[8px] font-mono text-muted-foreground/70 text-right">
                detected by {e.detected_by}
              </p>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
