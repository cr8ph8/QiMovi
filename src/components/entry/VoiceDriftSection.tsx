import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import CollapsibleSection from "@/components/CollapsibleSection";
import { getScoreColor, getBarColor } from "@/lib/score-utils";

interface VoiceDriftData {
  drift_score: number;
  flagged: boolean;
  details: Record<string, any>;
}

interface VoiceDriftSectionProps {
  voiceDrift: VoiceDriftData | null;
}

export default function VoiceDriftSection({ voiceDrift }: VoiceDriftSectionProps) {
  if (!voiceDrift) {
    return (
      <CollapsibleSection icon={<AlertTriangle className="h-5 w-5 text-amber-400" />} title="Voice Drift Analysis" defaultOpen={false} delay={0}>
        <p className="text-sm text-muted-foreground text-center py-4">No voice drift data yet.</p>
      </CollapsibleSection>
    );
  }

  const driftScore = Number(voiceDrift.drift_score ?? 0);
  const preservationPct = Math.round(100 - driftScore);
  const details = voiceDrift.details || {};
  const flaggedSections = (details.flagged_sections as Array<{ section: string; reason: string; severity: string }>) || [];
  const toneShifts = (details.tone_shifts as Array<{ from: string; to: string; location: string }>) || [];
  const summary = (details.summary as string) || null;

  return (
    <CollapsibleSection
      icon={<AlertTriangle className="h-5 w-5 text-amber-400" />}
      title="Voice Drift Analysis"
      badge={`${preservationPct}% preserved`}
      badgeColor={driftScore > 30 ? "bg-destructive/15 text-destructive" : "bg-emerald-500/15 text-emerald-400"}
      badgeVariant="pill"
      defaultOpen delay={0}
    >
      <div className="space-y-4">
        <div>
          <div className="flex justify-between items-baseline mb-1">
            <span className="text-sm font-medium">Voice Preservation</span>
            <span className={`text-lg font-mono font-bold ${getScoreColor(preservationPct)}`}>{preservationPct}%</span>
          </div>
          <div className="h-2.5 bg-muted rounded-full overflow-hidden">
            <motion.div initial={{ width: 0 }} animate={{ width: `${preservationPct}%` }} transition={{ duration: 1 }} className={`h-full rounded-full ${getBarColor(preservationPct)}`} />
          </div>
        </div>

        {summary && <div className="rounded-lg bg-muted/30 p-3"><p className="text-sm text-muted-foreground leading-relaxed">{summary}</p></div>}

        {flaggedSections.length > 0 && (
          <div>
            <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">Flagged Sections</h4>
            <div className="space-y-1.5">
              {flaggedSections.map((sec, i) => (
                <div key={i} className="rounded-lg bg-muted/20 px-3 py-2 flex items-start gap-2">
                  <Badge variant="outline" className={`text-[9px] font-mono shrink-0 ${sec.severity === "high" ? "border-destructive/30 text-destructive" : "border-amber-500/30 text-amber-400"}`}>
                    {sec.severity}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{sec.section}</p>
                    <p className="text-[10px] text-muted-foreground">{sec.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {toneShifts.length > 0 && (
          <div>
            <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">Tone Shifts</h4>
            <div className="space-y-1">
              {toneShifts.map((shift, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-muted-foreground">{shift.location}</span>
                  <span className="text-amber-400">{shift.from}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="text-primary">{shift.to}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
