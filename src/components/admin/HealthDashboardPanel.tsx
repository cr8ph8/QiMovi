import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SUBSYSTEMS, SUBSYSTEM_FUNCTION_MAP } from "@/lib/subsystems";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, RefreshCw, TrendingDown, TrendingUp, Shield } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from "recharts";

interface DayBucket {
  date: string;
  dateLabel: string;
  errors: number;
  total: number;
  rate: number;
}

interface SubsystemStats {
  id: string;
  title: string;
  totalCalls: number;
  errors: number;
  errorRate: number;
  status: "healthy" | "degraded" | "error";
  worstDay: string | null;
  trend: DayBucket[];
}

type TimeRange = 7 | 14 | 30;

export default function HealthDashboardPanel() {
  const [range, setRange] = useState<TimeRange>(30);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<SubsystemStats[]>([]);
  const [overallTrend, setOverallTrend] = useState<DayBucket[]>([]);

  async function fetchData(days: TimeRange) {
    setLoading(true);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data: logs } = await supabase
      .from("ai_usage_log")
      .select("function_name, status, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(2000);

    const allLogs = logs || [];

    // Build day buckets for each subsystem
    const subsystemStats: SubsystemStats[] = [];
    const overallBuckets: Record<string, { errors: number; total: number }> = {};

    // Initialize overall buckets
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      overallBuckets[d.toISOString().slice(0, 10)] = { errors: 0, total: 0 };
    }

    for (const subsystem of SUBSYSTEMS) {
      const fnNames = SUBSYSTEM_FUNCTION_MAP[subsystem.id] || [];
      if (fnNames.length === 0) continue;

      const buckets: Record<string, { errors: number; total: number }> = {};
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
        buckets[d.toISOString().slice(0, 10)] = { errors: 0, total: 0 };
      }

      const subsystemLogs = allLogs.filter(l => fnNames.includes(l.function_name));
      subsystemLogs.forEach(row => {
        const day = row.created_at.slice(0, 10);
        if (buckets[day]) {
          buckets[day].total++;
          if (row.status === "error") buckets[day].errors++;
        }
        if (overallBuckets[day]) {
          overallBuckets[day].total++;
          if (row.status === "error") overallBuckets[day].errors++;
        }
      });

      const totalCalls = subsystemLogs.length;
      const errors = subsystemLogs.filter(l => l.status === "error").length;
      const errorRate = totalCalls > 0 ? Math.round((errors / totalCalls) * 1000) / 10 : 0;

      let worstDay: string | null = null;
      let worstRate = 0;
      const trend = Object.entries(buckets).map(([date, b]) => {
        const rate = b.total > 0 ? Math.round((b.errors / b.total) * 1000) / 10 : 0;
        if (rate > worstRate && b.total > 0) {
          worstRate = rate;
          worstDay = date;
        }
        return {
          date,
          dateLabel: new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
          errors: b.errors,
          total: b.total,
          rate,
        };
      });

      let status: "healthy" | "degraded" | "error" = "healthy";
      if (errorRate > 30 || errors >= 10) status = "error";
      else if (errors >= 3 || errorRate > 10) status = "degraded";

      subsystemStats.push({
        id: subsystem.id,
        title: subsystem.title,
        totalCalls,
        errors,
        errorRate,
        status,
        worstDay,
        trend,
      });
    }

    setStats(subsystemStats);
    setOverallTrend(
      Object.entries(overallBuckets).map(([date, b]) => ({
        date,
        dateLabel: new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        errors: b.errors,
        total: b.total,
        rate: b.total > 0 ? Math.round((b.errors / b.total) * 1000) / 10 : 0,
      }))
    );
    setLoading(false);
  }

  useEffect(() => { fetchData(range); }, [range]);

  const overallReliability = useMemo(() => {
    const totalCalls = stats.reduce((s, st) => s + st.totalCalls, 0);
    const totalErrors = stats.reduce((s, st) => s + st.errors, 0);
    if (totalCalls === 0) return 100;
    return Math.round(((totalCalls - totalErrors) / totalCalls) * 1000) / 10;
  }, [stats]);

  const totalCalls = stats.reduce((s, st) => s + st.totalCalls, 0);
  const totalErrors = stats.reduce((s, st) => s + st.errors, 0);

  const statusColor = (s: string) =>
    s === "error" ? "text-destructive" : s === "degraded" ? "text-amber-500" : "text-emerald-500";
  const statusBg = (s: string) =>
    s === "error" ? "bg-destructive/10 border-destructive/30" : s === "degraded" ? "bg-amber-500/10 border-amber-500/30" : "bg-emerald-500/10 border-emerald-500/30";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" /> Health Dashboard
          </h3>
          <p className="text-xs text-muted-foreground">Long-term reliability metrics across all subsystems.</p>
        </div>
        <div className="flex items-center gap-2">
          {([7, 14, 30] as TimeRange[]).map((d) => (
            <Button
              key={d}
              variant={range === d ? "default" : "outline"}
              size="sm"
              className="text-xs font-mono h-7 px-2.5"
              onClick={() => setRange(d)}
            >
              {d}d
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={() => fetchData(range)} disabled={loading} className="text-xs gap-1.5 h-7">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Reliability",
            value: loading ? "…" : `${overallReliability}%`,
            icon: Shield,
            color: overallReliability >= 99 ? "text-emerald-500" : overallReliability >= 95 ? "text-amber-500" : "text-destructive",
          },
          {
            label: "Total Calls",
            value: loading ? "…" : totalCalls.toLocaleString(),
            icon: Activity,
            color: "text-primary",
          },
          {
            label: "Errors",
            value: loading ? "…" : totalErrors.toLocaleString(),
            icon: TrendingDown,
            color: totalErrors > 0 ? "text-destructive" : "text-emerald-500",
          },
          {
            label: "Subsystems",
            value: loading ? "…" : `${stats.filter(s => s.status === "healthy").length}/${stats.length}`,
            icon: TrendingUp,
            color: "text-primary",
          },
        ].map((card) => (
          <div key={card.label} className="flex items-center gap-2.5 px-4 py-3 rounded-lg border border-border/30 bg-card/60">
            <card.icon className={`h-4 w-4 shrink-0 ${card.color}`} />
            <span className="text-xs font-mono text-muted-foreground">{card.label}</span>
            <span className={`ml-auto font-display text-sm font-bold ${card.color}`}>{card.value}</span>
          </div>
        ))}
      </div>

      {/* Overall Trend Chart */}
      <div className="rounded-xl border border-border/50 bg-card/80 p-5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Overall Error Rate — {range}-Day Trend
        </p>
        {loading ? (
          <Skeleton className="h-[200px] w-full" />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={overallTrend}>
              <defs>
                <linearGradient id="errorGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} />
              <XAxis
                dataKey="dateLabel"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                interval={Math.max(Math.floor(overallTrend.length / 8), 0)}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                width={35}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "11px",
                }}
                labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
              />
              <Area type="monotone" dataKey="total" stroke="hsl(var(--primary))" fill="url(#totalGrad)" strokeWidth={1.5} name="Total Calls" />
              <Area type="monotone" dataKey="errors" stroke="hsl(var(--destructive))" fill="url(#errorGrad)" strokeWidth={2} name="Errors" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Subsystem Reliability Table */}
      <div className="rounded-xl border border-border/50 bg-card/80 p-5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Per-Subsystem Reliability
        </p>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : stats.length === 0 ? (
          <p className="text-sm text-muted-foreground">No subsystem data available.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 pr-4 font-mono text-xs text-muted-foreground">Subsystem</th>
                  <th className="text-right py-2 px-3 font-mono text-xs text-muted-foreground">Calls</th>
                  <th className="text-right py-2 px-3 font-mono text-xs text-muted-foreground">Errors</th>
                  <th className="text-right py-2 px-3 font-mono text-xs text-muted-foreground">Error Rate</th>
                  <th className="text-center py-2 px-3 font-mono text-xs text-muted-foreground">Status</th>
                  <th className="text-right py-2 pl-3 font-mono text-xs text-muted-foreground">Worst Day</th>
                </tr>
              </thead>
              <tbody>
                {stats.sort((a, b) => b.errorRate - a.errorRate).map((s) => (
                  <tr key={s.id} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                    <td className="py-2.5 pr-4 font-body text-foreground text-sm">{s.title}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-xs">{s.totalCalls.toLocaleString()}</td>
                    <td className={`py-2.5 px-3 text-right font-mono text-xs ${s.errors > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {s.errors}
                    </td>
                    <td className={`py-2.5 px-3 text-right font-mono text-xs ${statusColor(s.status)}`}>
                      {s.errorRate}%
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <Badge variant="outline" className={`text-[10px] font-mono ${statusBg(s.status)} ${statusColor(s.status)}`}>
                        {s.status === "healthy" ? "✓ Healthy" : s.status === "degraded" ? "⚠ Degraded" : "✗ Error"}
                      </Badge>
                    </td>
                    <td className="py-2.5 pl-3 text-right font-mono text-xs text-muted-foreground">
                      {s.worstDay ? new Date(s.worstDay).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Per-subsystem trend charts */}
      {!loading && stats.filter(s => s.totalCalls > 0).length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {stats.filter(s => s.totalCalls > 0).map((s) => (
            <div key={s.id} className="rounded-xl border border-border/50 bg-card/80 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold">{s.title}</p>
                <Badge variant="outline" className={`text-[9px] font-mono ${statusBg(s.status)} ${statusColor(s.status)}`}>
                  {s.errorRate}% error rate
                </Badge>
              </div>
              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={s.trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} />
                  <XAxis
                    dataKey="dateLabel"
                    tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    interval={Math.max(Math.floor(s.trend.length / 5), 0)}
                  />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={25} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "10px",
                    }}
                  />
                  <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={1} dot={false} name="Total" />
                  <Line type="monotone" dataKey="errors" stroke="hsl(var(--destructive))" strokeWidth={2} dot={{ r: 2 }} name="Errors" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
