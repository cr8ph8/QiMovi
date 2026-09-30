import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, DollarSign, Cpu, Hash } from "lucide-react";
import { AnalyticsAccessBadge } from "@/components/competition/AnalyticsAccessBadge";

interface UsageRow {
  id: string;
  model_id: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  estimated_cost_cents: number;
  created_at: string;
  entry_id: string;
}

interface ModelBreakdown {
  model: string;
  count: number;
  cost: number;
}

export default function JudgeUsagePanel() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [totalInvocations, setTotalInvocations] = useState(0);
  const [totalCost, setTotalCost] = useState(0);
  const [modelBreakdown, setModelBreakdown] = useState<ModelBreakdown[]>([]);

  useEffect(() => {
    supabase
      .from("judge_usage_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        const all = (data || []) as UsageRow[];
        setRows(all);
        setTotalInvocations(all.length);
        const cost = all.reduce((s, r) => s + Number(r.estimated_cost_cents || 0), 0);
        setTotalCost(cost);

        const map: Record<string, { count: number; cost: number }> = {};
        all.forEach((r) => {
          if (!map[r.model_id]) map[r.model_id] = { count: 0, cost: 0 };
          map[r.model_id].count++;
          map[r.model_id].cost += Number(r.estimated_cost_cents || 0);
        });
        setModelBreakdown(
          Object.entries(map)
            .map(([model, v]) => ({ model, ...v }))
            .sort((a, b) => b.count - a.count)
        );
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-40 w-full" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-display text-lg font-semibold">AI Judge Usage</h3>
        <AnalyticsAccessBadge />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-border/50 bg-card/80">
          <div className="flex items-center gap-2 mb-2">
            <Hash className="h-4 w-4 text-primary" />
            <span className="text-xs font-mono text-muted-foreground uppercase">Total Runs</span>
          </div>
          <p className="font-display text-2xl font-bold">{totalInvocations}</p>
        </div>
        <div className="p-4 rounded-xl border border-border/50 bg-card/80">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="h-4 w-4 text-primary" />
            <span className="text-xs font-mono text-muted-foreground uppercase">Est. Cost</span>
          </div>
          <p className="font-display text-2xl font-bold">${(totalCost / 100).toFixed(4)}</p>
        </div>
        <div className="p-4 rounded-xl border border-border/50 bg-card/80">
          <div className="flex items-center gap-2 mb-2">
            <Cpu className="h-4 w-4 text-primary" />
            <span className="text-xs font-mono text-muted-foreground uppercase">Models Used</span>
          </div>
          <p className="font-display text-2xl font-bold">{modelBreakdown.length}</p>
        </div>
      </div>

      {/* Model breakdown */}
      {modelBreakdown.length > 0 && (
        <div className="p-4 rounded-xl border border-border/50 bg-card/80">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold">Model Breakdown</h4>
          </div>
          <div className="space-y-2">
            {modelBreakdown.map((m) => (
              <div key={m.model} className="flex items-center justify-between text-sm">
                <span className="font-mono text-xs text-muted-foreground">{m.model}</span>
                <div className="flex gap-4">
                  <span className="text-xs">{m.count} runs</span>
                  <span className="text-xs font-mono text-primary">${(m.cost / 100).toFixed(4)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent runs table */}
      {rows.length > 0 && (
        <div className="p-4 rounded-xl border border-border/50 bg-card/80">
          <h4 className="text-sm font-semibold mb-3">Recent Runs</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 pr-3 font-mono text-xs text-muted-foreground">Model</th>
                  <th className="text-left py-2 pr-3 font-mono text-xs text-muted-foreground">Prompt</th>
                  <th className="text-left py-2 pr-3 font-mono text-xs text-muted-foreground">Completion</th>
                  <th className="text-left py-2 pr-3 font-mono text-xs text-muted-foreground">Cost</th>
                  <th className="text-left py-2 font-mono text-xs text-muted-foreground">Time</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 20).map((r) => (
                  <tr key={r.id} className="border-b border-border/20">
                    <td className="py-2 pr-3 font-mono text-xs">{r.model_id.split("/").pop()}</td>
                    <td className="py-2 pr-3 text-xs">{r.prompt_tokens ?? "—"}</td>
                    <td className="py-2 pr-3 text-xs">{r.completion_tokens ?? "—"}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-primary">${(Number(r.estimated_cost_cents) / 100).toFixed(4)}</td>
                    <td className="py-2 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No judge runs recorded yet.</p>
      )}
    </div>
  );
}
