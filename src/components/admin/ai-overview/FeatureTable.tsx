import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { TOKEN_COSTS, TOKEN_ACTION_METADATA, type FeatureCategory, type FeatureStatus } from "@/lib/wallet";
import { Sparkline } from "./Sparkline";
import type { FnStat } from "./types";
import {
  Brain, Sparkles, FileText, Clapperboard, Activity,
  CheckCircle2, XCircle, AlertCircle, Ghost, Plug2, ShieldAlert,
  Coins, RefreshCw, Zap, MessageSquare, BarChart3, Eye, Mic
} from "lucide-react";

const ICON_MAP: Record<string, React.ElementType> = {
  ai_script_generate: Sparkles,
  ai_score: Brain,
  logline_generate: Sparkles,
  title_suggest: MessageSquare,
  script_compare_2: BarChart3,
  script_compare_3: BarChart3,
  ai_rewrite: RefreshCw,
  ai_suggest_rewrites: Zap,
  deep_analysis: Activity,
  ai_review: Eye,
  send_review: MessageSquare,
  auto_audit: ShieldAlert,
  model_health_check: Activity,
  legal_summary: FileText,
  filmstack_seed: Clapperboard,
  evidence_artifact: FileText,
  deep_voice: Mic,
  seed_governance: Ghost,
  seed_demo_profiles: Ghost,
  beat_board: Plug2,
  writing_stats: Plug2,
  scene_analysis: Plug2,
  dialogue_generation: Plug2,
  zeitgeist: Plug2,
  entry_vertical: Coins,
  entry_micro: Coins,
  entry_short: Coins,
  entry_pilot_30: Coins,
  entry_pilot_60: Coins,
  entry_feature: Coins,
  resubmit: Coins,
  competition_waiver: Coins,
  ip_risk_assessment: ShieldAlert,
};

const CATEGORY_LABELS: Record<FeatureCategory, { label: string; color: string }> = {
  main: { label: "Main", color: "bg-primary/10 text-primary border-primary/20" },
  sub: { label: "Sub", color: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
  admin: { label: "Admin", color: "bg-purple-500/10 text-purple-500 border-purple-500/20" },
  entry_cost: { label: "Entry", color: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  dead: { label: "Dead Code", color: "bg-destructive/10 text-destructive border-destructive/20" },
  unwired: { label: "Unwired", color: "bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20" },
};

const STATUS_ICON: Record<FeatureStatus, React.ReactNode> = {
  active: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  dead_code: <XCircle className="h-4 w-4 text-destructive" />,
  unwired: <AlertCircle className="h-4 w-4 text-muted-foreground" />,
  gate_only: <Eye className="h-4 w-4 text-amber-500" />,
};

interface FeatureTableProps {
  category: FeatureCategory;
  title: string;
  loading: boolean;
  fnStats: Record<string, FnStat>;
  sparklineData: Record<string, { day: string; calls: number }[]>;
  last7: string[];
  flags: Record<string, any>;
  toggleFlag: (id: string) => void;
}

export function FeatureTable({ category, title, loading, fnStats, sparklineData, last7, flags, toggleFlag }: FeatureTableProps) {
  const [editingCosts, setEditingCosts] = useState<Record<string, number>>({});

  const features = Object.entries(TOKEN_ACTION_METADATA).filter(([, m]) => m.category === category);
  if (features.length === 0) return null;

  const handleCostChange = (actionId: string, value: number) => {
    setEditingCosts((prev) => ({ ...prev, [actionId]: value }));
  };

  const saveCost = async (actionId: string) => {
    const newCost = editingCosts[actionId];
    if (newCost === undefined) return;

    const { error } = await supabase
      .from("feature_configs")
      .upsert({ id: actionId, token_cost: newCost, updated_at: new Date().toISOString() }, { onConflict: "id" });

    if (error) {
      toast.error(`Failed to update cost: ${error.message}`);
    } else {
      toast.success(`${TOKEN_ACTION_METADATA[actionId]?.label} cost → ${newCost} ⊘`);
    }
  };

  const isDead = category === "dead" || category === "unwired";

  return (
    <div className={`rounded-xl border overflow-hidden ${isDead ? "border-destructive/30" : "border-border/50"}`}>
      <div className={`px-4 py-2 ${isDead ? "bg-destructive/5" : "bg-muted/20"}`}>
        <h4 className="font-body text-sm font-semibold">{title}</h4>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/50 bg-muted/10">
            <th className="text-left py-2 px-4 font-mono text-[10px] text-muted-foreground uppercase">Feature</th>
            <th className="text-left py-2 px-4 font-mono text-[10px] text-muted-foreground uppercase">Status</th>
            <th className="text-left py-2 px-4 font-mono text-[10px] text-muted-foreground uppercase">Edge Fn</th>
            <th className="text-center py-2 px-4 font-mono text-[10px] text-muted-foreground uppercase">Cost ⊘</th>
            <th className="text-left py-2 px-4 font-mono text-[10px] text-muted-foreground uppercase">Toggle</th>
            <th className="text-left py-2 px-4 font-mono text-[10px] text-muted-foreground uppercase">7-Day</th>
            <th className="text-right py-2 px-4 font-mono text-[10px] text-muted-foreground uppercase">Calls</th>
            <th className="text-right py-2 px-4 font-mono text-[10px] text-muted-foreground uppercase">Cost $</th>
          </tr>
        </thead>
        <tbody>
          {features.map(([actionId, meta]) => {
            const Icon = ICON_MAP[actionId] || Activity;
            const defaultCost = (TOKEN_COSTS as Record<string, number>)[actionId] ?? 0;
            const currentCost = editingCosts[actionId] ?? defaultCost;
            const edgeFn = meta.edgeFunction;
            const stats = edgeFn ? fnStats[edgeFn] || { calls: 0, cost: 0, tokens: 0, lastUsed: "" } : { calls: 0, cost: 0, tokens: 0, lastUsed: "" };
            const sparkData = edgeFn ? sparklineData[edgeFn] || last7.map((d) => ({ day: d, calls: 0 })) : last7.map((d) => ({ day: d, calls: 0 }));
            const config = flags[actionId];

            return (
              <tr
                key={actionId}
                className={`border-b border-border/20 hover:bg-muted/10 ${
                  isDead ? "opacity-60" : ""
                }`}
              >
                <td className="py-2 px-4">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-primary/70 shrink-0" />
                    <div>
                      <p className={`font-body font-medium text-sm ${meta.status === "dead_code" ? "line-through" : ""}`}>
                        {meta.label}
                      </p>
                      <p className="text-[10px] text-muted-foreground max-w-[200px] truncate">{meta.description}</p>
                    </div>
                  </div>
                </td>
                <td className="py-2 px-4">
                  <div className="flex items-center gap-1.5">
                    {STATUS_ICON[meta.status]}
                    <Badge variant="outline" className={`text-[9px] font-mono ${CATEGORY_LABELS[meta.category].color}`}>
                      {CATEGORY_LABELS[meta.category].label}
                    </Badge>
                  </div>
                </td>
                <td className="py-2 px-4">
                  {edgeFn ? (
                    <code className="text-[10px] font-mono text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded">
                      {edgeFn}
                    </code>
                  ) : (
                    <span className="text-[10px] text-muted-foreground italic">none</span>
                  )}
                </td>
                <td className="py-2 px-4">
                  <div className="flex justify-center">
                    <Input
                      type="number"
                      min={0}
                      value={currentCost}
                      onChange={(e) => handleCostChange(actionId, Number(e.target.value))}
                      onBlur={() => saveCost(actionId)}
                      className="w-16 h-7 text-center text-xs font-mono"
                    />
                  </div>
                </td>
                <td className="py-2 px-4">
                  {config ? (
                    <Switch
                      checked={config.enabled}
                      onCheckedChange={() => toggleFlag(actionId)}
                      className="scale-75"
                    />
                  ) : (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  )}
                </td>
                <td className="py-2 px-4">
                  {loading ? <Skeleton className="h-6 w-24" /> : <Sparkline data={sparkData} />}
                </td>
                <td className="py-2 px-4 text-right font-mono text-xs text-muted-foreground">
                  {loading ? "…" : stats.calls || "—"}
                </td>
                <td className="py-2 px-4 text-right font-mono text-xs text-primary">
                  {loading ? "…" : stats.cost > 0 ? `$${(stats.cost / 100).toFixed(3)}` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
