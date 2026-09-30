import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DollarSign, Cpu, FileText, TrendingUp, AlertTriangle, Bell, Save, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface UsageRow {
  id: string;
  model_id: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  estimated_cost_cents: number | null;
  created_at: string;
  source: string;
}

interface BudgetConfig {
  daily_limit_cents: number;
  monthly_limit_cents: number;
  alert_threshold_pct: number; // 0-100, triggers warning at this % of limit
}

const DEFAULT_BUDGET: BudgetConfig = {
  daily_limit_cents: 5000,   // $50
  monthly_limit_cents: 50000, // $500
  alert_threshold_pct: 80,
};

function BudgetAlertBanner({ label, spent, limit, thresholdPct }: { label: string; spent: number; limit: number; thresholdPct: number }) {
  if (limit <= 0) return null;
  const pct = Math.min((spent / limit) * 100, 100);
  const isWarning = pct >= thresholdPct;
  const isExceeded = pct >= 100;

  return (
    <div
      className={cn(
        "rounded-xl border p-4 space-y-2",
        isExceeded
          ? "border-destructive/50 bg-destructive/5"
          : isWarning
          ? "border-yellow-500/50 bg-yellow-500/5"
          : "border-border/50 bg-card/80"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isExceeded ? (
            <ShieldAlert className="h-4 w-4 text-destructive" />
          ) : isWarning ? (
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
          ) : (
            <Bell className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("font-mono text-sm font-bold", isExceeded ? "text-destructive" : isWarning ? "text-yellow-500" : "text-foreground")}>
            ${(spent / 100).toFixed(2)}
          </span>
          <span className="text-xs text-muted-foreground">/ ${(limit / 100).toFixed(2)}</span>
          {isExceeded && <Badge variant="destructive" className="text-[9px] font-mono">EXCEEDED</Badge>}
          {isWarning && !isExceeded && <Badge className="text-[9px] font-mono bg-yellow-500/20 text-yellow-500 border-yellow-500/30">WARNING</Badge>}
        </div>
      </div>
      <Progress value={pct} className={cn("h-2", isExceeded ? "[&>div]:bg-destructive" : isWarning ? "[&>div]:bg-yellow-500" : "")} />
      <p className="text-[10px] text-muted-foreground">
        {isExceeded
          ? `Budget exceeded by $${((spent - limit) / 100).toFixed(2)}. Review AI spending immediately.`
          : isWarning
          ? `${pct.toFixed(0)}% of budget consumed. Alert threshold is ${thresholdPct}%.`
          : `${pct.toFixed(0)}% of budget consumed.`}
      </p>
    </div>
  );
}

export default function CostMonitorPanel() {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [budget, setBudget] = useState<BudgetConfig>(DEFAULT_BUDGET);
  const [editBudget, setEditBudget] = useState<BudgetConfig>(DEFAULT_BUDGET);
  const [showSettings, setShowSettings] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadBudget = useCallback(async () => {
    const { data } = await supabase
      .from("site_settings")
      .select("key, text_value")
      .in("key", ["ai_budget_daily_limit_cents", "ai_budget_monthly_limit_cents", "ai_budget_alert_threshold_pct"]);

    const map: Record<string, string> = {};
    for (const row of (data as any[]) || []) {
      map[row.key] = row.text_value;
    }

    const loaded: BudgetConfig = {
      daily_limit_cents: parseInt(map.ai_budget_daily_limit_cents) || DEFAULT_BUDGET.daily_limit_cents,
      monthly_limit_cents: parseInt(map.ai_budget_monthly_limit_cents) || DEFAULT_BUDGET.monthly_limit_cents,
      alert_threshold_pct: parseInt(map.ai_budget_alert_threshold_pct) || DEFAULT_BUDGET.alert_threshold_pct,
    };
    setBudget(loaded);
    setEditBudget(loaded);
  }, []);

  useEffect(() => {
    async function load() {
      const [judgeRes, aiRes] = await Promise.all([
        supabase.from("judge_usage_log").select("id, model_id, prompt_tokens, completion_tokens, estimated_cost_cents, created_at").order("created_at", { ascending: false }).limit(500),
        supabase.from("ai_usage_log").select("id, model_id, prompt_tokens, completion_tokens, estimated_cost_cents, created_at, function_name").order("created_at", { ascending: false }).limit(500),
      ]);

      const judgeRows: UsageRow[] = ((judgeRes.data as any[]) || []).map((r) => ({ ...r, source: "ai-judge" }));
      const aiRows: UsageRow[] = ((aiRes.data as any[]) || []).map((r) => ({ ...r, source: r.function_name || "unknown" }));

      const combined = [...judgeRows, ...aiRows].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setRows(combined);
      setLoading(false);
    }
    load();
    loadBudget();
  }, [loadBudget]);

  // Compute period costs
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const dailyCost = rows.filter((r) => new Date(r.created_at) >= todayStart).reduce((s, r) => s + (r.estimated_cost_cents || 0), 0);
  const monthlyCost = rows.filter((r) => new Date(r.created_at) >= monthStart).reduce((s, r) => s + (r.estimated_cost_cents || 0), 0);

  const totalCostCents = rows.reduce((s, r) => s + (r.estimated_cost_cents || 0), 0);
  const totalPromptTokens = rows.reduce((s, r) => s + (r.prompt_tokens || 0), 0);
  const totalCompletionTokens = rows.reduce((s, r) => s + (r.completion_tokens || 0), 0);
  const totalCalls = rows.length;

  // Group by model
  const modelCosts: Record<string, { calls: number; cost: number }> = {};
  for (const r of rows) {
    if (!modelCosts[r.model_id]) modelCosts[r.model_id] = { calls: 0, cost: 0 };
    modelCosts[r.model_id].calls++;
    modelCosts[r.model_id].cost += r.estimated_cost_cents || 0;
  }

  // Group by source function
  const fnCosts: Record<string, { calls: number; cost: number }> = {};
  for (const r of rows) {
    if (!fnCosts[r.source]) fnCosts[r.source] = { calls: 0, cost: 0 };
    fnCosts[r.source].calls++;
    fnCosts[r.source].cost += r.estimated_cost_cents || 0;
  }

  // Last 7 days trend
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentRows = rows.filter((r) => new Date(r.created_at) >= sevenDaysAgo);
  const recentCost = recentRows.reduce((s, r) => s + (r.estimated_cost_cents || 0), 0);

  async function saveBudget() {
    setSaving(true);
    const entries = [
      { key: "ai_budget_daily_limit_cents", text_value: String(editBudget.daily_limit_cents), value: false },
      { key: "ai_budget_monthly_limit_cents", text_value: String(editBudget.monthly_limit_cents), value: false },
      { key: "ai_budget_alert_threshold_pct", text_value: String(editBudget.alert_threshold_pct), value: false },
    ];
    for (const entry of entries) {
      await (supabase.from("site_settings") as any).upsert(
        { ...entry, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
    }
    setBudget(editBudget);
    setShowSettings(false);
    setSaving(false);
    toast.success("Budget limits updated");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-semibold mb-1 flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" /> Cost Monitor
          </h3>
          <p className="text-xs text-muted-foreground">AI generation and parsing costs across all functions.</p>
        </div>
        <Button
          size="sm"
          variant={showSettings ? "secondary" : "outline"}
          className="text-xs gap-1"
          onClick={() => setShowSettings(!showSettings)}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Budget Limits
        </Button>
      </div>

      {/* Budget settings */}
      {showSettings && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-4">
          <h4 className="font-body text-sm font-semibold flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-primary" /> Spending Limits
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Daily Limit ($)</label>
              <Input
                type="number"
                step="1"
                min="0"
                value={(editBudget.daily_limit_cents / 100).toFixed(0)}
                onChange={(e) => setEditBudget((p) => ({ ...p, daily_limit_cents: Math.max(0, parseInt(e.target.value) || 0) * 100 }))}
                className="font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Monthly Limit ($)</label>
              <Input
                type="number"
                step="1"
                min="0"
                value={(editBudget.monthly_limit_cents / 100).toFixed(0)}
                onChange={(e) => setEditBudget((p) => ({ ...p, monthly_limit_cents: Math.max(0, parseInt(e.target.value) || 0) * 100 }))}
                className="font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Alert at (%)</label>
              <Input
                type="number"
                step="5"
                min="10"
                max="100"
                value={editBudget.alert_threshold_pct}
                onChange={(e) => setEditBudget((p) => ({ ...p, alert_threshold_pct: Math.min(100, Math.max(10, parseInt(e.target.value) || 80)) }))}
                className="font-mono"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={saveBudget} disabled={saving} className="text-xs gap-1">
              <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save Limits"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditBudget(budget); setShowSettings(false); }} className="text-xs">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Budget alerts */}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <BudgetAlertBanner label="Today's Budget" spent={dailyCost} limit={budget.daily_limit_cents} thresholdPct={budget.alert_threshold_pct} />
          <BudgetAlertBanner label="Monthly Budget" spent={monthlyCost} limit={budget.monthly_limit_cents} thresholdPct={budget.alert_threshold_pct} />
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Cost", value: loading ? "…" : `$${(totalCostCents / 100).toFixed(2)}`, icon: DollarSign },
          { label: "API Calls", value: loading ? "…" : String(totalCalls), icon: Cpu },
          { label: "Tokens Used", value: loading ? "…" : `${((totalPromptTokens + totalCompletionTokens) / 1000).toFixed(1)}k`, icon: FileText },
          { label: "7-Day Cost", value: loading ? "…" : `$${(recentCost / 100).toFixed(2)}`, icon: TrendingUp },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-border/50 bg-card/80 p-4">
            <div className="flex items-center gap-2 mb-2">
              <card.icon className="h-4 w-4 text-primary" />
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{card.label}</span>
            </div>
            {loading ? <Skeleton className="h-7 w-16" /> : (
              <p className="font-display text-xl font-bold">{card.value}</p>
            )}
          </div>
        ))}
      </div>

      {/* Cost by function */}
      <div className="rounded-xl border border-border/50 bg-card/80 p-5">
        <h4 className="font-body text-sm font-semibold mb-4">Cost by Function</h4>
        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
        ) : Object.keys(fnCosts).length === 0 ? (
          <p className="text-sm text-muted-foreground">No usage data yet.</p>
        ) : (
          <div className="space-y-3">
            {Object.entries(fnCosts)
              .sort((a, b) => b[1].cost - a[1].cost)
              .map(([fn, data]) => (
                <div key={fn} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <code className="text-[10px] font-mono bg-muted/30 px-1.5 py-0.5 rounded">{fn}</code>
                    <span className="text-xs text-muted-foreground">{data.calls} calls</span>
                  </div>
                  <span className="font-mono text-sm text-primary">${(data.cost / 100).toFixed(3)}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Cost by model */}
      <div className="rounded-xl border border-border/50 bg-card/80 p-5">
        <h4 className="font-body text-sm font-semibold mb-4">Cost by Model</h4>
        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
        ) : Object.keys(modelCosts).length === 0 ? (
          <p className="text-sm text-muted-foreground">No usage data yet.</p>
        ) : (
          <div className="space-y-3">
            {Object.entries(modelCosts)
              .sort((a, b) => b[1].cost - a[1].cost)
              .map(([model, data]) => (
                <div key={model} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] font-mono">{model}</Badge>
                    <span className="text-xs text-muted-foreground">{data.calls} calls</span>
                  </div>
                  <span className="font-mono text-sm text-primary">${(data.cost / 100).toFixed(3)}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Recent log */}
      <div className="rounded-xl border border-border/50 bg-card/80 p-5">
        <h4 className="font-body text-sm font-semibold mb-4">Recent API Calls</h4>
        {loading ? (
          <div className="space-y-2">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No API calls recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 pr-3 font-mono text-[10px] text-muted-foreground uppercase">Time</th>
                  <th className="text-left py-2 pr-3 font-mono text-[10px] text-muted-foreground uppercase">Function</th>
                  <th className="text-left py-2 pr-3 font-mono text-[10px] text-muted-foreground uppercase">Model</th>
                  <th className="text-right py-2 pr-3 font-mono text-[10px] text-muted-foreground uppercase">Prompt</th>
                  <th className="text-right py-2 pr-3 font-mono text-[10px] text-muted-foreground uppercase">Completion</th>
                  <th className="text-right py-2 font-mono text-[10px] text-muted-foreground uppercase">Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 20).map((r) => (
                  <tr key={r.id} className="border-b border-border/20">
                    <td className="py-2 pr-3 text-xs text-muted-foreground font-mono">
                      {new Date(r.created_at).toLocaleDateString()} {new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="py-2 pr-3">
                      <code className="text-[10px] font-mono bg-muted/30 px-1 py-0.5 rounded">{r.source}</code>
                    </td>
                    <td className="py-2 pr-3 text-xs font-mono">{r.model_id}</td>
                    <td className="py-2 pr-3 text-xs font-mono text-right text-muted-foreground">{r.prompt_tokens?.toLocaleString() || "—"}</td>
                    <td className="py-2 pr-3 text-xs font-mono text-right text-muted-foreground">{r.completion_tokens?.toLocaleString() || "—"}</td>
                    <td className="py-2 text-xs font-mono text-right text-primary">
                      {r.estimated_cost_cents != null ? `$${(r.estimated_cost_cents / 100).toFixed(3)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
