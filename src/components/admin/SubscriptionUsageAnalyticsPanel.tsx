import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, DollarSign, Users, BarChart3, Repeat } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend,
  LineChart, Line,
} from "recharts";

interface FeatureSub {
  id: string;
  user_id: string;
  feature_id: string;
  cycle: string;
  tokens_paid: number;
  cycle_start: string;
  cycle_end: string;
  auto_renew: boolean;
  cancelled_at: string | null;
  refund_amount: number | null;
  created_at: string;
}

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2, 220 70% 50%))",
  "hsl(var(--chart-3, 150 60% 45%))",
  "hsl(var(--chart-4, 280 65% 55%))",
  "hsl(var(--chart-5, 30 80% 55%))",
  "hsl(var(--accent))",
];

export default function SubscriptionUsageAnalyticsPanel() {
  const [subs, setSubs] = useState<FeatureSub[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("feature_subscriptions")
      .select("id, user_id, feature_id, cycle, tokens_paid, cycle_start, cycle_end, auto_renew, cancelled_at, refund_amount, created_at")
      .order("created_at", { ascending: false })
      .limit(1000)
      .then(({ data }) => {
        setSubs((data as FeatureSub[]) || []);
        setLoading(false);
      });
  }, []);

  const now = new Date();

  const active = useMemo(() => subs.filter(s => !s.cancelled_at && new Date(s.cycle_end) > now), [subs]);
  const cancelled = useMemo(() => subs.filter(s => !!s.cancelled_at), [subs]);
  const expired = useMemo(() => subs.filter(s => !s.cancelled_at && new Date(s.cycle_end) <= now), [subs]);
  const churned = cancelled.length + expired.length;
  const churnRate = subs.length > 0 ? Math.round((churned / subs.length) * 100) : 0;

  // Popularity: active subs per feature
  const popularityMap = useMemo(() => {
    const m: Record<string, { active: number; total: number; revenue: number; refunds: number; churned: number }> = {};
    for (const s of subs) {
      if (!m[s.feature_id]) m[s.feature_id] = { active: 0, total: 0, revenue: 0, refunds: 0, churned: 0 };
      m[s.feature_id].total++;
      m[s.feature_id].revenue += s.tokens_paid;
      m[s.feature_id].refunds += s.refund_amount || 0;
      if (!s.cancelled_at && new Date(s.cycle_end) > now) {
        m[s.feature_id].active++;
      } else {
        m[s.feature_id].churned++;
      }
    }
    return m;
  }, [subs]);

  const popularityData = useMemo(
    () =>
      Object.entries(popularityMap)
        .sort((a, b) => b[1].active - a[1].active)
        .map(([feature, d]) => ({ feature, ...d })),
    [popularityMap]
  );

  // Pie chart: active subs distribution
  const pieData = useMemo(
    () => popularityData.filter(d => d.active > 0).map(d => ({ name: d.feature, value: d.active })),
    [popularityData]
  );

  // Revenue per feature bar chart
  const revenueData = useMemo(
    () =>
      popularityData
        .sort((a, b) => b.revenue - a.revenue)
        .map(d => ({
          feature: d.feature.length > 18 ? d.feature.slice(0, 16) + "…" : d.feature,
          revenue: d.revenue,
          refunds: d.refunds,
          net: d.revenue - d.refunds,
        })),
    [popularityData]
  );

  // Churn per feature
  const churnData = useMemo(
    () =>
      popularityData
        .filter(d => d.total > 0)
        .map(d => ({
          feature: d.feature.length > 18 ? d.feature.slice(0, 16) + "…" : d.feature,
          rate: Math.round((d.churned / d.total) * 100),
          churned: d.churned,
          total: d.total,
        }))
        .sort((a, b) => b.rate - a.rate),
    [popularityData]
  );

  // New subscriptions over time (last 30 days)
  const trendData = useMemo(() => {
    const days: Record<string, { newSubs: number; cancellations: number }> = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days[d.toISOString().slice(0, 10)] = { newSubs: 0, cancellations: 0 };
    }
    for (const s of subs) {
      const day = s.created_at.slice(0, 10);
      if (day in days) days[day].newSubs++;
      if (s.cancelled_at) {
        const cDay = s.cancelled_at.slice(0, 10);
        if (cDay in days) days[cDay].cancellations++;
      }
    }
    return Object.entries(days).map(([date, d]) => ({ date: date.slice(5), ...d }));
  }, [subs]);

  const totalRevenue = subs.reduce((s, r) => s + r.tokens_paid, 0);
  const totalRefunds = subs.reduce((s, r) => s + (r.refund_amount || 0), 0);

  const tooltipStyle = {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    fontSize: "12px",
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-display text-lg font-semibold mb-1 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" /> Subscription Usage Analytics
        </h3>
        <p className="text-xs text-muted-foreground">
          Feature popularity, churn rates, and revenue breakdown across all per-feature subscriptions.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Active Subs", value: active.length, icon: Users, color: "text-primary" },
          { label: "Gross Revenue", value: `${totalRevenue} ⊘`, icon: DollarSign, color: "text-primary" },
          { label: "Net Revenue", value: `${totalRevenue - totalRefunds} ⊘`, icon: TrendingUp, color: "text-primary" },
          { label: "Total Refunds", value: `${totalRefunds} ⊘`, icon: TrendingDown, color: "text-destructive" },
          { label: "Churn Rate", value: `${churnRate}%`, icon: Repeat, color: churnRate > 30 ? "text-destructive" : "text-primary" },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-border/50 bg-card/80 p-4">
            <div className="flex items-center gap-2 mb-2">
              <card.icon className={`h-4 w-4 ${card.color}`} />
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{card.label}</span>
            </div>
            {loading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <p className="font-display text-xl font-bold">{card.value}</p>
            )}
          </div>
        ))}
      </div>

      {/* Row: Popularity pie + Trend line */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Popularity Pie */}
        <div className="rounded-xl border border-border/50 bg-card/80 p-5">
          <h4 className="font-body text-sm font-semibold mb-4">Most Popular Features</h4>
          {loading ? (
            <Skeleton className="h-52 w-full" />
          ) : pieData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No active subscriptions</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`} labelLine={false} fontSize={10}>
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 30-day trend */}
        <div className="rounded-xl border border-border/50 bg-card/80 p-5">
          <h4 className="font-body text-sm font-semibold mb-4">Subscriptions vs Cancellations (30 days)</h4>
          {loading ? (
            <Skeleton className="h-52 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="newSubs" name="New Subs" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="cancellations" name="Cancellations" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Revenue per Feature */}
      <div className="rounded-xl border border-border/50 bg-card/80 p-5">
        <h4 className="font-body text-sm font-semibold mb-4">Revenue per Feature (⊘)</h4>
        {loading ? (
          <Skeleton className="h-52 w-full" />
        ) : revenueData.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No subscription data yet</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(200, revenueData.length * 36)}>
            <BarChart data={revenueData} layout="vertical" margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis dataKey="feature" type="category" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={120} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="net" name="Net Revenue" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              <Bar dataKey="refunds" name="Refunds" fill="hsl(var(--destructive))" radius={[0, 4, 4, 0]} />
              <Legend wrapperStyle={{ fontSize: "11px" }} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Churn per Feature Table */}
      <div className="rounded-xl border border-border/50 bg-card/80 p-5">
        <h4 className="font-body text-sm font-semibold mb-4">Churn Rate per Feature</h4>
        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : churnData.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No data yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 pr-3 font-mono text-[10px] text-muted-foreground uppercase">Feature</th>
                  <th className="text-right py-2 pr-3 font-mono text-[10px] text-muted-foreground uppercase">Total</th>
                  <th className="text-right py-2 pr-3 font-mono text-[10px] text-muted-foreground uppercase">Churned</th>
                  <th className="text-right py-2 font-mono text-[10px] text-muted-foreground uppercase">Churn %</th>
                </tr>
              </thead>
              <tbody>
                {churnData.map((row) => (
                  <tr key={row.feature} className="border-b border-border/20">
                    <td className="py-2 pr-3 text-xs font-body">{row.feature}</td>
                    <td className="py-2 pr-3 text-xs font-mono text-right">{row.total}</td>
                    <td className="py-2 pr-3 text-xs font-mono text-right">{row.churned}</td>
                    <td className="py-2 text-xs font-mono text-right">
                      <span className={row.rate > 50 ? "text-destructive" : row.rate > 25 ? "text-amber-500" : "text-primary"}>
                        {row.rate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Per-feature detail table */}
      <div className="rounded-xl border border-border/50 bg-card/80 p-5">
        <h4 className="font-body text-sm font-semibold mb-4">Feature Performance Summary</h4>
        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : popularityData.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No subscription data</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 pr-3 font-mono text-[10px] text-muted-foreground uppercase">Feature</th>
                  <th className="text-right py-2 pr-3 font-mono text-[10px] text-muted-foreground uppercase">Active</th>
                  <th className="text-right py-2 pr-3 font-mono text-[10px] text-muted-foreground uppercase">Total</th>
                  <th className="text-right py-2 pr-3 font-mono text-[10px] text-muted-foreground uppercase">Revenue ⊘</th>
                  <th className="text-right py-2 pr-3 font-mono text-[10px] text-muted-foreground uppercase">Refunds ⊘</th>
                  <th className="text-right py-2 font-mono text-[10px] text-muted-foreground uppercase">Net ⊘</th>
                </tr>
              </thead>
              <tbody>
                {popularityData.map((row) => (
                  <tr key={row.feature} className="border-b border-border/20">
                    <td className="py-2 pr-3 text-xs font-body">{row.feature}</td>
                    <td className="py-2 pr-3 text-xs font-mono text-right text-primary">{row.active}</td>
                    <td className="py-2 pr-3 text-xs font-mono text-right">{row.total}</td>
                    <td className="py-2 pr-3 text-xs font-mono text-right">{row.revenue}</td>
                    <td className="py-2 pr-3 text-xs font-mono text-right text-destructive">{row.refunds}</td>
                    <td className="py-2 text-xs font-mono text-right font-bold">{row.revenue - row.refunds}</td>
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
