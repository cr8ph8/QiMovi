import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getAvgTokenPrice, TOKEN_COSTS, MODEL_COSTS, DEFAULT_SURCHARGES, MODEL_TIER_LABELS } from "@/lib/wallet";
import type { UsageRow } from "./types";

/* Map edge function names to their token action keys for revenue estimation */
const FN_TO_ACTION: Record<string, string> = {
  "generate-script": "ai_script_generate",
  "ai-judge": "ai_score",
  "ai-compare": "script_compare_2",
  "rewrite-selection": "ai_rewrite",
  "suggest-rewrites": "ai_suggest_rewrites",
  "auto-audit": "auto_audit",
  "model-health-check": "model_health_check",
  "legal-summary": "legal_summary",
  "seed-filmstack": "filmstack_seed",
  "generate-artifact": "evidence_artifact",
  "voice-drift": "deep_voice",
};

function marginColor(m: number) {
  if (m >= 20) return "text-emerald-400";
  if (m >= 0) return "text-yellow-400";
  return "text-destructive";
}

interface ModelBreakdownProps {
  loading: boolean;
  allUsage: UsageRow[];
  totalCostCents: number;
}

export function ModelBreakdown({ loading, allUsage, totalCostCents }: ModelBreakdownProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/80 p-5">
        <h4 className="font-body text-sm font-semibold mb-4">Usage by Model (All Functions)</h4>
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
      </div>
    );
  }

  const avgTokenPrice = getAvgTokenPrice(); // dollars per token

  const modelStats: Record<string, { calls: number; cost: number; revenueCents: number; tier: string }> = {};
  for (const r of allUsage) {
    if (!modelStats[r.model_id]) {
      const tier = MODEL_COSTS[r.model_id]?.tier || "standard";
      modelStats[r.model_id] = { calls: 0, cost: 0, revenueCents: 0, tier };
    }
    modelStats[r.model_id].calls++;
    modelStats[r.model_id].cost += r.estimated_cost_cents || 0;

    // Estimate revenue: look up token cost for the feature, apply surcharge, multiply by avg token price
    const actionKey = FN_TO_ACTION[r.source] || r.source;
    const tokenCost = (TOKEN_COSTS as Record<string, number>)[actionKey] || 0;
    const tier = modelStats[r.model_id].tier;
    const surcharge = DEFAULT_SURCHARGES[tier] || DEFAULT_SURCHARGES.standard;
    const surchargedTokens = tokenCost * surcharge.multiplier + surcharge.flat;
    modelStats[r.model_id].revenueCents += surchargedTokens * avgTokenPrice * 100;
  }
  const entries = Object.entries(modelStats).sort((a, b) => b[1].cost - a[1].cost);

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 p-5">
      <h4 className="font-body text-sm font-semibold mb-4">Usage by Model (All Functions)</h4>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No usage data yet.</p>
      ) : (
        <div className="space-y-3">
          {entries.map(([model, data]) => {
            const pct = totalCostCents > 0 ? (data.cost / totalCostCents) * 100 : 0;
            const margin = data.revenueCents > 0
              ? ((data.revenueCents - data.cost) / data.revenueCents) * 100
              : 0;
            const tierLabel = MODEL_TIER_LABELS[data.tier] || data.tier;
            return (
              <div key={model}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] font-mono">{model}</Badge>
                    <Badge variant="secondary" className="text-[9px]">{tierLabel}</Badge>
                    <span className="text-[10px] text-muted-foreground">{data.calls} calls</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-primary">${(data.cost / 100).toFixed(3)}</span>
                    <span className="text-[10px] text-muted-foreground">rev ${(data.revenueCents / 100).toFixed(3)}</span>
                    <span className={`font-mono text-xs font-bold ${marginColor(margin)}`}>
                      {margin.toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-gold-gradient rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground font-mono mt-3">
        Margin = (Surcharge-Adjusted Revenue − API Cost) / Revenue. Premium = 3×+5, Super Premium = 5×+10. Avg token price ${avgTokenPrice.toFixed(4)}/token.
      </p>
    </div>
  );
}
