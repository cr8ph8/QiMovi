import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, Calendar, TrendingUp, Users, Zap } from "lucide-react";
import { TOKEN_ACTION_LABELS } from "@/lib/wallet";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface UsageRow {
  action: string;
  tokens_spent: number;
  created_at: string;
  user_id: string;
}

const ACTION_CATEGORIES: Record<string, string> = {
  ai_score: "AI Tools",
  ai_review: "AI Tools",
  beat_board: "AI Tools",
  writing_stats: "Analysis",
  send_review: "AI Tools",
  script_compare_2: "Analysis",
  script_compare_3: "Analysis",
  scene_analysis: "Analysis",
  deep_voice: "Analysis",
  dialogue_generation: "AI Tools",
  zeitgeist: "Analysis",
  deep_analysis: "Analysis",
  ai_rewrite: "AI Tools",
  resubmit: "Entry Costs",
  logline_generate: "AI Tools",
  entry_vertical: "Entry Costs",
  entry_micro: "Entry Costs",
  entry_short: "Entry Costs",
  entry_pilot_30: "Entry Costs",
  entry_pilot_60: "Entry Costs",
  entry_feature: "Entry Costs",
};

function getLabel(action: string) {
  return (TOKEN_ACTION_LABELS as Record<string, string>)[action] || action;
}

function isWithinDays(dateStr: string, days: number) {
  const d = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return d >= cutoff;
}

export default function UsageAnalyticsPanel() {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("feature_usage_log")
        .select("action, tokens_spent, created_at, user_id")
        .order("created_at", { ascending: false })
        .limit(1000);
      setRows((data as UsageRow[]) || []);
      setLoading(false);
    }
    load();
  }, []);

  const today = rows.filter((r) => isWithinDays(r.created_at, 1));
  const thisWeek = rows.filter((r) => isWithinDays(r.created_at, 7));
  const thisMonth = rows.filter((r) => isWithinDays(r.created_at, 30));

  // Per-action breakdown
  const actionMap: Record<string, { daily: number; weekly: number; monthly: number; total: number; tokens: number }> = {};
  for (const r of rows) {
    if (!actionMap[r.action]) actionMap[r.action] = { daily: 0, weekly: 0, monthly: 0, total: 0, tokens: 0 };
    actionMap[r.action].total++;
    actionMap[r.action].tokens += r.tokens_spent;
    if (isWithinDays(r.created_at, 1)) actionMap[r.action].daily++;
    if (isWithinDays(r.created_at, 7)) actionMap[r.action].weekly++;
    if (isWithinDays(r.created_at, 30)) actionMap[r.action].monthly++;
  }

  // Daily trend (last 14 days)
  const dailyTrend: Record<string, number> = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dailyTrend[d.toISOString().slice(0, 10)] = 0;
  }
  for (const r of rows) {
    const day = r.created_at.slice(0, 10);
    if (day in dailyTrend) dailyTrend[day]++;
  }
  const chartData = Object.entries(dailyTrend).map(([date, count]) => ({
    date: date.slice(5), // MM-DD
    actions: count,
  }));

  // Top users
  const userCounts: Record<string, number> = {};
  for (const r of rows) {
    userCounts[r.user_id] = (userCounts[r.user_id] || 0) + 1;
  }
  const topUsers = Object.entries(userCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Group actions by category
  const categories = ["AI Tools", "Entry Costs", "Analysis", "Other"];
  const groupedActions = Object.entries(actionMap).sort((a, b) => b[1].total - a[1].total);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-display text-lg font-semibold mb-1 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" /> Usage Analytics
        </h3>
        <p className="text-xs text-muted-foreground">Feature and action usage across all users — daily, weekly, monthly breakdowns.</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Today", value: today.length, icon: Zap },
          { label: "This Week", value: thisWeek.length, icon: Calendar },
          { label: "This Month", value: thisMonth.length, icon: TrendingUp },
          { label: "All Time", value: rows.length, icon: BarChart3 },
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

      {/* 14-day trend chart */}
      <div className="rounded-xl border border-border/50 bg-card/80 p-5">
        <h4 className="font-body text-sm font-semibold mb-4">Daily Usage (14 days)</h4>
        {loading ? <Skeleton className="h-48 w-full" /> : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              />
              <Bar dataKey="actions" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Per-action breakdown table */}
      <div className="rounded-xl border border-border/50 bg-card/80 p-5">
        <h4 className="font-body text-sm font-semibold mb-4">Per-Action Breakdown</h4>
        {loading ? (
          <div className="space-y-2">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : groupedActions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No usage data yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 pr-3 font-mono text-[10px] text-muted-foreground uppercase">Action</th>
                  <th className="text-left py-2 pr-3 font-mono text-[10px] text-muted-foreground uppercase">Category</th>
                  <th className="text-right py-2 pr-3 font-mono text-[10px] text-muted-foreground uppercase">Today</th>
                  <th className="text-right py-2 pr-3 font-mono text-[10px] text-muted-foreground uppercase">Week</th>
                  <th className="text-right py-2 pr-3 font-mono text-[10px] text-muted-foreground uppercase">Month</th>
                  <th className="text-right py-2 pr-3 font-mono text-[10px] text-muted-foreground uppercase">All Time</th>
                  <th className="text-right py-2 font-mono text-[10px] text-muted-foreground uppercase">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {groupedActions.map(([action, data]) => (
                  <tr key={action} className="border-b border-border/20">
                    <td className="py-2 pr-3 text-xs font-body">{getLabel(action)}</td>
                    <td className="py-2 pr-3">
                      <span className="text-[10px] font-mono bg-muted/30 px-1.5 py-0.5 rounded">
                        {ACTION_CATEGORIES[action] || "Other"}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-xs font-mono text-right">{data.daily}</td>
                    <td className="py-2 pr-3 text-xs font-mono text-right">{data.weekly}</td>
                    <td className="py-2 pr-3 text-xs font-mono text-right">{data.monthly}</td>
                    <td className="py-2 pr-3 text-xs font-mono text-right text-primary">{data.total}</td>
                    <td className="py-2 text-xs font-mono text-right text-muted-foreground">{data.tokens}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Top users */}
      <div className="rounded-xl border border-border/50 bg-card/80 p-5">
        <h4 className="font-body text-sm font-semibold mb-4 flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" /> Top Users by Usage
        </h4>
        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
        ) : topUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No usage data yet.</p>
        ) : (
          <div className="space-y-3">
            {topUsers.map(([userId, count], i) => (
              <div key={userId} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-primary w-4">{i + 1}.</span>
                  <code className="text-[10px] font-mono bg-muted/30 px-1.5 py-0.5 rounded">{userId.slice(0, 8)}…</code>
                </div>
                <span className="font-mono text-sm text-primary">{count} actions</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
