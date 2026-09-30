import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { computeWaterfall, computeThresholds, formatUSD } from "@/lib/parity/waterfall";
import { SCENARIO_PRESETS } from "@/lib/parity/defaults";
import type { ParityDeal, ParityParticipant } from "@/lib/parity/types";

interface Props {
  deal: ParityDeal;
  participants: ParityParticipant[];
}

export default function ParityScenarioModeler({ deal, participants }: Props) {
  const [custom, setCustom] = useState<number>(6_200_000);
  const thresholds = useMemo(() => computeThresholds(deal), [deal]);
  const totalUnits = participants.reduce((s, p) => s + p.unit_weight, 0);

  const scenarios = useMemo(
    () => [
      ...SCENARIO_PRESETS.map((s) => ({ label: s.label, gross: s.grossReceipts, w: computeWaterfall(deal, s.grossReceipts) })),
      { label: "Custom", gross: custom, w: computeWaterfall(deal, custom) },
    ],
    [deal, custom],
  );

  return (
    <div className="space-y-6">
      {/* Thresholds */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ThresholdCard label="Investor principal recouped" value={thresholds.principalRecouped} tone="muted" />
        <ThresholdCard label={`Full hurdle (${deal.hurdle_multiple}x) hit`} value={thresholds.fullHurdleHit} tone="muted" />
        <ThresholdCard label="Contributor pool opens" value={thresholds.contributorPoolOpens} tone="primary" />
      </div>

      {/* Custom input */}
      <div className="flex items-end gap-3">
        <div className="flex-1 space-y-1">
          <Label className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">Custom gross receipts (USD)</Label>
          <Input type="number" value={custom} onChange={(e) => setCustom(parseFloat(e.target.value) || 0)} className="bg-background/40" />
        </div>
      </div>

      {/* Scenario columns */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {scenarios.map((s) => {
          const perUnit = totalUnits > 0 ? s.w.contributorPool / totalUnits : 0;
          return (
            <div key={s.label} className="rounded-lg border border-border/50 bg-card/60 p-4 space-y-3">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">{s.label}</div>
                <div className="font-display text-lg font-semibold">{formatUSD(s.gross)}</div>
              </div>
              <div className="space-y-1.5 text-xs">
                {s.w.lines.map((ln, i) => (
                  <div key={i} className={`flex justify-between gap-2 ${ln.isTotal ? "font-semibold border-t border-border/40 pt-1.5 mt-1.5" : ln.isPool ? "text-primary" : ln.isDeduction ? "text-muted-foreground" : ""}`}>
                    <span className="truncate">{ln.label}</span>
                    <span className="font-mono shrink-0">{ln.amount < 0 ? "(" + formatUSD(-ln.amount) + ")" : formatUSD(ln.amount)}</span>
                  </div>
                ))}
              </div>
              {totalUnits > 0 && (
                <div className="rounded-md bg-background/40 p-2 text-[11px] font-mono">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Per unit</span>
                    <span>{formatUSD(perUnit)}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Badge variant="outline" className="text-[10px] font-mono">
        DRAFT modeling only · figures are illustrative · not financial or legal advice
      </Badge>
    </div>
  );
}

function ThresholdCard({ label, value, tone }: { label: string; value: number; tone: "muted" | "primary" }) {
  return (
    <div className={`rounded-lg border p-3 ${tone === "primary" ? "border-primary/40 bg-primary/5" : "border-border/40 bg-card/60"}`}>
      <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-display text-xl font-semibold ${tone === "primary" ? "text-primary" : ""}`}>{formatUSD(value)}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">in gross receipts</div>
    </div>
  );
}
