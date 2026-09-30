import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CODEBASE_REGISTRY, DATA_TABLE_MAP, LOVABLE_MODELS } from "@/lib/blueprint-registry";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Server } from "lucide-react";
import { ChevronDown, AlertTriangle, CheckCircle2, RefreshCw, Bell, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { SUBSYSTEMS, SUBSYSTEM_FUNCTION_MAP, type SubsystemNode } from "@/lib/subsystems";

interface NodeCounts {
  [tableOrId: string]: number | null;
}

interface RecentActivity {
  id: string;
  action: string;
  created_at: string;
}

interface HealthStatus {
  status: "healthy" | "degraded" | "error" | "unknown";
  errorCount: number;
  totalCalls: number;
  recentErrors: Array<{ function_name: string; error_message: string | null; created_at: string }>;
}

interface TrendPoint {
  date: string;
  errors: number;
  total: number;
  rate: number;
}

export default function SystemArchitecturePanel() {
  const [counts, setCounts] = useState<NodeCounts>({});
  const [loading, setLoading] = useState(true);
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const [nodeActivity, setNodeActivity] = useState<RecentActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [healthMap, setHealthMap] = useState<Record<string, HealthStatus>>({});
  const [healthLoading, setHealthLoading] = useState(true);
  const [trendData, setTrendData] = useState<Record<string, TrendPoint[]>>({});
  const [trendLoading, setTrendLoading] = useState(false);
  const notifiedSubsystems = useRef<Set<string>>(new Set());
  const [diagramTab, setDiagramTab] = useState<"schema" | "blueprint">("schema");
  const { user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    async function fetchCounts() {
      setLoading(true);
      const allTables = SUBSYSTEMS.flatMap(s => s.tables);
      const uniqueTables = [...new Set(allTables)];
      const results = await Promise.all(
        uniqueTables.map(async (table) => {
          try {
            const { count } = await supabase.from(table as any).select("id", { count: "exact", head: true });
            return { table, count: count ?? 0 };
          } catch {
            return { table, count: null };
          }
        })
      );
      const map: NodeCounts = {};
      results.forEach(r => { map[r.table] = r.count; });
      SUBSYSTEMS.forEach(s => {
        const total = s.tables.reduce((sum, t) => sum + (map[t] ?? 0), 0);
        map[s.id] = total;
      });
      setCounts(map);
      setLoading(false);
    }
    fetchCounts();
  }, []);

  // Notify admins when subsystems enter error state via edge function
  const notifyAdminsOfErrors = useCallback(async (newHealthMap: Record<string, HealthStatus>) => {
    if (!user) return;
    const errorSubsystems = Object.entries(newHealthMap)
      .filter(([id, h]) => h.status === "error" && !notifiedSubsystems.current.has(id))
      .map(([id]) => id);

    if (errorSubsystems.length === 0) return;

    const results = await Promise.allSettled(
      errorSubsystems.map(async (subsystemId) => {
        const node = SUBSYSTEMS.find(s => s.id === subsystemId);
        const health = newHealthMap[subsystemId];
        if (!node) return;
        notifiedSubsystems.current.add(subsystemId);
        await supabase.functions.invoke("notify-subsystem-alert", {
          body: {
            subsystemId,
            title: node.title,
            errorCount: health.errorCount,
            totalCalls: health.totalCalls,
          },
        });
      })
    );

    const succeeded = results.filter(r => r.status === "fulfilled").length;
    if (succeeded > 0) {
      toast({
        title: "Admin Alert Sent",
        description: `Notified admins about ${succeeded} subsystem(s) in error state.`,
        variant: "destructive",
      });
    }
  }, [user, toast]);

  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [{ data: errorLogs }, { data: allLogs }] = await Promise.all([
      supabase
        .from("ai_usage_log")
        .select("function_name, error_message, created_at, status")
        .eq("status", "error")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("ai_usage_log")
        .select("function_name, status")
        .gte("created_at", since)
        .limit(1000),
    ]);

    const newHealthMap: Record<string, HealthStatus> = {};
    for (const subsystem of SUBSYSTEMS) {
      const fnNames = SUBSYSTEM_FUNCTION_MAP[subsystem.id] || [];
      if (fnNames.length === 0) {
        newHealthMap[subsystem.id] = { status: "healthy", errorCount: 0, totalCalls: 0, recentErrors: [] };
        continue;
      }
      const subsystemErrors = (errorLogs || []).filter(l => fnNames.includes(l.function_name));
      const subsystemTotal = (allLogs || []).filter(l => fnNames.includes(l.function_name)).length;
      const errorCount = subsystemErrors.length;
      let status: HealthStatus["status"] = "healthy";
      if (errorCount > 0 && subsystemTotal > 0) {
        const errorRate = errorCount / subsystemTotal;
        if (errorRate > 0.3 || errorCount >= 10) status = "error";
        else if (errorCount >= 3 || errorRate > 0.1) status = "degraded";
      } else if (errorCount > 0) {
        status = "degraded";
      }
      newHealthMap[subsystem.id] = {
        status, errorCount, totalCalls: subsystemTotal,
        recentErrors: subsystemErrors.slice(0, 5).map(e => ({
          function_name: e.function_name, error_message: e.error_message, created_at: e.created_at,
        })),
      };
    }
    setHealthMap(newHealthMap);
    setHealthLoading(false);

    // Fire admin notifications for error-state subsystems
    await notifyAdminsOfErrors(newHealthMap);
  }, [notifyAdminsOfErrors]);

  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  // Fetch 7-day trend data for a subsystem
  const fetchTrend = useCallback(async (subsystemId: string) => {
    if (trendData[subsystemId]) return; // already loaded
    const fnNames = SUBSYSTEM_FUNCTION_MAP[subsystemId];
    if (!fnNames || fnNames.length === 0) return;

    setTrendLoading(true);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("ai_usage_log")
      .select("function_name, status, created_at")
      .in("function_name", fnNames)
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: true })
      .limit(1000);

    // Bucket into daily points
    const buckets: Record<string, { errors: number; total: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      buckets[key] = { errors: 0, total: 0 };
    }
    (data || []).forEach(row => {
      const day = row.created_at.slice(0, 10);
      if (buckets[day]) {
        buckets[day].total++;
        if (row.status === "error") buckets[day].errors++;
      }
    });

    const points: TrendPoint[] = Object.entries(buckets).map(([date, b]) => ({
      date: new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      errors: b.errors,
      total: b.total,
      rate: b.total > 0 ? Math.round((b.errors / b.total) * 100) : 0,
    }));

    setTrendData(prev => ({ ...prev, [subsystemId]: points }));
    setTrendLoading(false);
  }, [trendData]);

  const healthSummary = useMemo(() => {
    const entries = Object.values(healthMap);
    return {
      errorCount: entries.filter(h => h.status === "error").length,
      degradedCount: entries.filter(h => h.status === "degraded").length,
      healthyCount: entries.filter(h => h.status === "healthy").length,
      totalErrors: entries.reduce((s, h) => s + h.errorCount, 0),
    };
  }, [healthMap]);

  async function loadNodeActivity(node: SubsystemNode) {
    setActivityLoading(true);
    if (node.auditActions.length > 0) {
      const { data } = await supabase
        .from("audit_log")
        .select("id, action, created_at")
        .in("action", node.auditActions)
        .order("created_at", { ascending: false })
        .limit(10);
      setNodeActivity((data as RecentActivity[]) || []);
    } else {
      setNodeActivity([]);
    }
    setActivityLoading(false);
  }

  function handleToggle(node: SubsystemNode) {
    if (expandedNode === node.id) {
      setExpandedNode(null);
    } else {
      setExpandedNode(node.id);
      loadNodeActivity(node);
      fetchTrend(node.id);
    }
  }

  const getNodeStatus = (node: SubsystemNode): "green" | "amber" | "red" | "gray" => {
    const health = healthMap[node.id];
    if (health) {
      if (health.status === "error") return "red";
      if (health.status === "degraded") return "amber";
      if (health.status === "healthy") return "green";
    }
    const total = counts[node.id];
    if (total === null || total === undefined) return "gray";
    if (total === 0 && node.tables.length > 2) return "amber";
    return "green";
  };

  const statusDotColor: Record<string, string> = {
    green: "bg-emerald-500",
    amber: "bg-amber-500 animate-pulse",
    red: "bg-destructive animate-pulse",
    gray: "bg-muted-foreground/30",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-semibold mb-1 flex items-center gap-2">
            <Server className="h-5 w-5 text-primary" /> System Architecture
          </h3>
          <p className="text-xs text-muted-foreground">Interactive blueprint with live health monitoring (24h window).</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchHealth} disabled={healthLoading} className="text-xs gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${healthLoading ? "animate-spin" : ""}`} /> Refresh Health
        </Button>
      </div>

      {/* Health Summary Banner */}
      {!healthLoading && (
        <div className={`rounded-lg border p-3 flex items-center gap-4 text-xs ${
          healthSummary.errorCount > 0
            ? "border-destructive/40 bg-destructive/5"
            : healthSummary.degradedCount > 0
            ? "border-amber-500/40 bg-amber-500/5"
            : "border-emerald-500/40 bg-emerald-500/5"
        }`}>
          {healthSummary.errorCount > 0 ? (
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
          )}
          <div className="flex-1 flex flex-wrap gap-4 font-mono">
            <span className="text-emerald-500">{healthSummary.healthyCount} healthy</span>
            {healthSummary.degradedCount > 0 && (
              <span className="text-amber-500">{healthSummary.degradedCount} degraded</span>
            )}
            {healthSummary.errorCount > 0 && (
              <span className="text-destructive">{healthSummary.errorCount} with errors</span>
            )}
            {healthSummary.totalErrors > 0 && (
              <span className="text-muted-foreground ml-auto">{healthSummary.totalErrors} errors in last 24h</span>
            )}
          </div>
          {healthSummary.errorCount > 0 && (
            <div className="flex items-center gap-1.5 text-destructive">
              <Bell className="h-3.5 w-3.5" />
              <span className="text-[10px] font-mono">Admins notified</span>
            </div>
          )}
        </div>
      )}

      {/* Blueprint Grid */}
      <div className="grid grid-cols-3 gap-3">
        {SUBSYSTEMS.map(node => {
          const Icon = node.icon;
          const status = getNodeStatus(node);
          const isExpanded = expandedNode === node.id;
          const totalRows = counts[node.id] ?? 0;
          const health = healthMap[node.id];

          return (
            <button
              key={node.id}
              onClick={() => handleToggle(node)}
              className={`group relative rounded-xl border p-4 text-left transition-all hover:border-primary/40 hover:bg-muted/30 ${
                isExpanded ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20" : "border-border/50 bg-card/80"
              } ${status === "red" ? "border-destructive/40" : status === "amber" ? "border-amber-500/40" : ""}`}
            >
              <div className={`absolute top-3 right-3 h-2.5 w-2.5 rounded-full ${statusDotColor[status]}`} />

              <div className="flex items-center gap-2 mb-2">
                {loading ? (
                  <Skeleton className="h-5 w-5 rounded" />
                ) : (
                  <Icon className={`h-5 w-5 ${status === "red" ? "text-destructive" : status === "amber" ? "text-amber-500" : "text-primary"}`} />
                )}
                <span className="text-sm font-semibold text-foreground">{node.title}</span>
              </div>

              <div className="flex items-center justify-between">
                {loading ? (
                  <Skeleton className="h-4 w-20" />
                ) : (
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {totalRows.toLocaleString()} rows · {node.tables.length} tables
                  </span>
                )}
                <div className="flex items-center gap-1.5">
                  {health && health.totalCalls > 0 && (() => {
                    const uptime = Math.round(((health.totalCalls - health.errorCount) / health.totalCalls) * 100);
                    return (
                      <Badge variant="outline" className={`text-[9px] font-mono px-1.5 py-0 h-4 ${
                        uptime >= 99 ? "text-emerald-500 border-emerald-500/30" :
                        uptime >= 90 ? "text-amber-500 border-amber-500/30" :
                        "text-destructive border-destructive/30"
                      }`}>
                        {uptime}% up
                      </Badge>
                    );
                  })()}
                  <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                </div>
              </div>

              {health && health.errorCount > 0 && (
                <div className="mt-2 flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3 text-destructive" />
                  <span className="text-[10px] font-mono text-destructive">
                    {health.errorCount} error{health.errorCount !== 1 ? "s" : ""} / {health.totalCalls} calls
                  </span>
                </div>
              )}

              {node.edgeFunctions.length > 0 && (!health || health.errorCount === 0) && (
                <div className="mt-1.5">
                  <span className="text-[10px] font-mono text-primary/60">
                    {node.edgeFunctions.length} edge fn{node.edgeFunctions.length > 1 ? "s" : ""}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex justify-center gap-1">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-0.5 w-8 bg-border/40 rounded-full" />
        ))}
      </div>

      {/* Expanded Detail Window */}
      {expandedNode && (() => {
        const node = SUBSYSTEMS.find(n => n.id === expandedNode)!;
        const health = healthMap[node.id];
        const trend = trendData[node.id];
        return (
          <div className="rounded-xl border border-primary/30 bg-card/90 overflow-hidden animate-in slide-in-from-top-2 duration-200">
            <div className="px-5 py-3 border-b border-border/30 bg-primary/5">
              <div className="flex items-center gap-2">
                <node.icon className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">{node.title}</span>
                {health && (
                  <Badge variant="outline" className={`text-[10px] font-mono ${
                    health.status === "error" ? "text-destructive border-destructive/30" :
                    health.status === "degraded" ? "text-amber-500 border-amber-500/30" :
                    "text-emerald-500 border-emerald-500/30"
                  }`}>
                    {health.status === "healthy" ? "✓ Healthy" : health.status === "degraded" ? "⚠ Degraded" : "✗ Errors"}
                  </Badge>
                )}
                {node.godModeTab && (
                  <Badge variant="outline" className="text-[10px] font-mono ml-auto text-muted-foreground">
                    God Mode → {node.godModeTab}
                  </Badge>
                )}
              </div>
            </div>

            <div className="p-5 space-y-4">
              {health && health.recentErrors.length > 0 && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 space-y-2">
                  <p className="text-[10px] font-semibold text-destructive uppercase tracking-wider flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3" /> Recent Errors ({health.errorCount} in 24h)
                  </p>
                  <div className="space-y-1.5">
                    {health.recentErrors.map((err, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <Badge variant="outline" className="text-[9px] font-mono shrink-0 text-destructive border-destructive/30">
                          {err.function_name}
                        </Badge>
                        <span className="text-muted-foreground line-clamp-1 flex-1">{err.error_message || "Unknown error"}</span>
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                          {new Date(err.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 7-Day Health Trend Chart */}
              {(SUBSYSTEM_FUNCTION_MAP[node.id]?.length ?? 0) > 0 && (
                <div className="rounded-lg border border-border/30 bg-muted/10 p-4">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    7-Day Error Trend
                  </p>
                  {trendLoading && !trend ? (
                    <Skeleton className="h-[140px] w-full" />
                  ) : trend && trend.length > 0 ? (
                    <ResponsiveContainer width="100%" height={140}>
                      <LineChart data={trend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                          tickLine={false}
                          axisLine={false}
                          width={30}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                            fontSize: "11px",
                          }}
                          labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                          formatter={(value: number, name: string) => [
                            value,
                            name === "errors" ? "Errors" : name === "total" ? "Total Calls" : "Error Rate %"
                          ]}
                        />
                        <Line
                          type="monotone"
                          dataKey="total"
                          stroke="hsl(var(--primary))"
                          strokeWidth={1.5}
                          dot={{ r: 2, fill: "hsl(var(--primary))" }}
                          name="total"
                        />
                        <Line
                          type="monotone"
                          dataKey="errors"
                          stroke="hsl(var(--destructive))"
                          strokeWidth={2}
                          dot={{ r: 3, fill: "hsl(var(--destructive))" }}
                          name="errors"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-[11px] text-muted-foreground/50 italic text-center py-6">No calls recorded in last 7 days</p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-3 gap-5">
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tables</p>
                  <div className="space-y-1">
                    {node.tables.map(t => (
                      <div key={t} className="flex items-center justify-between text-xs">
                        <span className="font-mono text-muted-foreground truncate">{t}</span>
                        <span className="font-mono font-semibold text-foreground">
                          {counts[t] !== null && counts[t] !== undefined ? counts[t]?.toLocaleString() : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Edge Functions</p>
                  {node.edgeFunctions.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground/50 italic">None</p>
                  ) : (
                    <div className="space-y-1">
                      {node.edgeFunctions.map(fn => {
                        const hasErrors = health?.recentErrors.some(e => e.function_name === fn);
                        return (
                          <div key={fn} className="flex items-center gap-1.5 text-xs">
                            <div className={`h-1.5 w-1.5 rounded-full ${hasErrors ? "bg-destructive animate-pulse" : "bg-emerald-500"}`} />
                            <span className={`font-mono ${hasErrors ? "text-destructive" : "text-muted-foreground"}`}>{fn}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Recent Activity</p>
                  {activityLoading ? (
                    <div className="space-y-1">
                      {[1, 2, 3].map(i => <Skeleton key={i} className="h-4 w-full" />)}
                    </div>
                  ) : nodeActivity.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground/50 italic">No tracked activity</p>
                  ) : (
                    <ScrollArea className="h-[120px]">
                      <div className="space-y-1">
                        {nodeActivity.map(a => (
                          <div key={a.id} className="flex items-center justify-between text-[11px]">
                            <Badge variant="outline" className="text-[9px] font-mono">{a.action}</Badge>
                            <span className="font-mono text-muted-foreground text-[10px]">
                              {new Date(a.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Diagram Tabs: Schema ER | App Blueprint */}
      <div className="flex items-center gap-1 border-b border-border/30 mb-4">
        <button
          onClick={() => setDiagramTab("schema")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            diagramTab === "schema"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          🔧 Schema ER
        </button>
        <button
          onClick={() => setDiagramTab("blueprint")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            diagramTab === "blueprint"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          🗺️ App Blueprint
        </button>
      </div>

      {diagramTab === "schema" ? (
        <CanonicalERDiagram />
      ) : (
        <div className="rounded-lg border border-border/50 bg-card/60 p-6 space-y-4">
          <h3 className="text-sm font-bold font-display">App Blueprint Registry</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="rounded-md bg-muted/50 p-3 text-center">
              <div className="text-lg font-bold text-primary">{CODEBASE_REGISTRY.filter(e => e.category === "page").length}</div>
              <div className="text-muted-foreground">Pages</div>
            </div>
            <div className="rounded-md bg-muted/50 p-3 text-center">
              <div className="text-lg font-bold text-primary">{CODEBASE_REGISTRY.filter(e => e.category === "component").length}</div>
              <div className="text-muted-foreground">Components</div>
            </div>
            <div className="rounded-md bg-muted/50 p-3 text-center">
              <div className="text-lg font-bold text-primary">{CODEBASE_REGISTRY.filter(e => e.category === "function").length}</div>
              <div className="text-muted-foreground">Edge Functions</div>
            </div>
            <div className="rounded-md bg-muted/50 p-3 text-center">
              <div className="text-lg font-bold text-primary">{Object.keys(DATA_TABLE_MAP).length}</div>
              <div className="text-muted-foreground">Tables</div>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground font-mono">{LOVABLE_MODELS.length} supported AI models · Registry data in src/lib/blueprint-registry.ts</p>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground text-center font-mono">
        {SUBSYSTEMS.length} subsystems · {SUBSYSTEMS.reduce((s, n) => s + n.tables.length, 0)} tables · {SUBSYSTEMS.reduce((s, n) => s + n.edgeFunctions.length, 0)} edge functions
      </p>
    </div>
  );
}

/* ── Canonical Schema ER Diagram ── */

interface ERTable {
  id: string;
  label: string;
  canonical: string;
  canonicalDesc: string;
  columns: string[];
  x: number;
  y: number;
  color: string;
  friendlyName: string;
  friendlyEmoji: string;
  friendlyDesc: string;
}

interface EREdge {
  from: string;
  to: string;
  label: string;
  friendlyLabel: string;
  type: "ownership" | "reference" | "linked";
}

const ER_TABLES: ERTable[] = [
  { id: "entries", label: "entries", canonical: "Hub", canonicalDesc: "Central hub table. All creative data links back here via entry_id.", columns: ["id", "user_id", "title", "status", "method_type", "competition_id"], x: 40, y: 180, color: "hsl(var(--primary))", friendlyName: "Projects", friendlyEmoji: "📝", friendlyDesc: "Your submitted screenplays and competition entries" },
  { id: "screenplay_versions", label: "screenplay_versions", canonical: "Creative Lineage", canonicalDesc: "Primary ledger of authorship evolution. No other table replicates version history.", columns: ["id", "entry_id", "parent_version_id", "actor_type", "source_type", "text_hash"], x: 280, y: 20, color: "hsl(210 80% 55%)", friendlyName: "Script Versions", friendlyEmoji: "✏️", friendlyDesc: "Draft history tracking every change to your writing" },
  { id: "governance_events", label: "governance_events", canonical: "Governance Truth", canonicalDesc: "AI routing decisions, judge calls, safety filters, policy checks. NOT admin actions.", columns: ["id", "entry_id", "execution_id", "event_type", "model_name", "event_status"], x: 280, y: 170, color: "hsl(270 60% 55%)", friendlyName: "AI Decisions", friendlyEmoji: "⚖️", friendlyDesc: "Records of when AI made routing or safety decisions" },
  { id: "ai_usage_log", label: "ai_usage_log", canonical: "Model Telemetry", canonicalDesc: "Model, tokens, latency, cost, provider routing. NO interpretive decisions.", columns: ["id", "entry_id", "execution_id", "function_name", "model_id", "status"], x: 280, y: 320, color: "hsl(200 70% 50%)", friendlyName: "AI Activity", friendlyEmoji: "🤖", friendlyDesc: "How often AI models are used, what they cost, and how fast they respond" },
  { id: "artifacts", label: "artifacts", canonical: "Artifact Truth", canonicalDesc: "Computed interpretations of the creative process. References versions, never stores raw text.", columns: ["id", "entry_id", "artifact_type", "status", "artifact_hash"], x: 560, y: 80, color: "hsl(150 60% 40%)", friendlyName: "Analysis Results", friendlyEmoji: "🔬", friendlyDesc: "Generated reports and insights about your screenplay" },
  { id: "artifact_metrics", label: "artifact_metrics", canonical: "Artifact Metrics", canonicalDesc: "Per-artifact aggregated metric values with confidence scores.", columns: ["id", "artifact_id", "metric_name", "metric_value", "confidence"], x: 800, y: 80, color: "hsl(150 50% 50%)", friendlyName: "Quality Scores", friendlyEmoji: "📊", friendlyDesc: "Numerical scores and confidence ratings for each analysis" },
  { id: "influence_scores", label: "influence_scores", canonical: "Version Scores", canonicalDesc: "Per-version raw influence scores. Complements artifact_metrics (per-artifact aggregates).", columns: ["id", "entry_id", "version_id", "scoring_method", "ai_influence_score"], x: 560, y: 230, color: "hsl(40 80% 50%)", friendlyName: "Originality Scores", friendlyEmoji: "🎯", friendlyDesc: "How original each version is and how much AI influenced it" },
  { id: "provenance_nodes", label: "provenance_nodes", canonical: "Provenance Graph", canonicalDesc: "Knowledge lineage nodes. Documents, prompts, rewrites, citations.", columns: ["id", "entry_id", "node_type", "label", "related_version_id"], x: 560, y: 370, color: "hsl(330 60% 50%)", friendlyName: "Source Map", friendlyEmoji: "🗺️", friendlyDesc: "Where ideas came from — prompts, rewrites, and citations" },
  { id: "provenance_edges", label: "provenance_edges", canonical: "Provenance Edges", canonicalDesc: "Derivation relationships between provenance nodes. Graph structure, not a log.", columns: ["id", "entry_id", "from_node_id", "to_node_id", "edge_type"], x: 800, y: 370, color: "hsl(330 50% 60%)", friendlyName: "Source Links", friendlyEmoji: "🔗", friendlyDesc: "Connections showing how one source led to another" },
  { id: "audit_log", label: "audit_log", canonical: "System Audit", canonicalDesc: "Permission changes, feature toggles, billing, admin actions. NO creative lineage.", columns: ["id", "user_id", "action", "details"], x: 800, y: 230, color: "hsl(0 0% 55%)", friendlyName: "Admin Log", friendlyEmoji: "📋", friendlyDesc: "Record of system changes like permissions and settings" },
  { id: "wallet_transactions", label: "wallet_transactions", canonical: "Token Ledger", canonicalDesc: "Every token credit/debit with source label. Immutable append-only ledger.", columns: ["id", "user_id", "amount", "label", "source"], x: 40, y: 380, color: "hsl(160 60% 45%)", friendlyName: "Token Activity", friendlyEmoji: "💰", friendlyDesc: "Log of tokens earned and spent" },
  { id: "token_wallets", label: "token_wallets", canonical: "Wallet Balance", canonicalDesc: "Current token balance per user. Updated atomically via add_tokens/spend_tokens functions.", columns: ["id", "user_id", "balance"], x: 280, y: 460, color: "hsl(160 50% 55%)", friendlyName: "Wallet Balance", friendlyEmoji: "👛", friendlyDesc: "How many tokens each user currently has" },
  { id: "purchases", label: "purchases", canonical: "Purchase Records", canonicalDesc: "Token bundle purchases with Stripe session tracking and fulfillment status.", columns: ["id", "user_id", "bundle_name", "token_amount", "price_cents", "status"], x: 560, y: 460, color: "hsl(120 50% 45%)", friendlyName: "Purchases", friendlyEmoji: "🛒", friendlyDesc: "Token bundles bought with real money" },
  { id: "feature_usage_log", label: "feature_usage_log", canonical: "Usage Ledger", canonicalDesc: "Per-action token spend log with feature attribution. Links to entries and parent logs.", columns: ["id", "user_id", "action", "tokens_spent", "entry_id"], x: 40, y: 550, color: "hsl(280 55% 55%)", friendlyName: "Feature Usage", friendlyEmoji: "⚡", friendlyDesc: "Which features people use and how many tokens they cost" },
  { id: "feature_subscriptions", label: "feature_subscriptions", canonical: "Feature Subs", canonicalDesc: "Per-feature subscription records with billing cycle, auto-renew, and refund tracking.", columns: ["id", "user_id", "feature_id", "cycle", "cycle_end"], x: 280, y: 610, color: "hsl(280 45% 60%)", friendlyName: "Feature Plans", friendlyEmoji: "📦", friendlyDesc: "Subscriptions to individual premium features" },
  { id: "subscriptions", label: "subscriptions", canonical: "Plan Subs", canonicalDesc: "User plan subscriptions (free/pro/festival/studio) with Stripe integration and token allowances.", columns: ["id", "user_id", "plan", "status", "stripe_subscription_id"], x: 560, y: 610, color: "hsl(300 50% 50%)", friendlyName: "Plans", friendlyEmoji: "📋", friendlyDesc: "Your subscription plan (Free, Pro, Studio)" },
  // ── New tables for system flow paths ──
  { id: "competitions", label: "competitions", canonical: "Competition Registry", canonicalDesc: "Contest definitions with prompts, sensitivity rules, and festival linkage.", columns: ["id", "name", "prompt", "status", "sensitivity", "festival_id"], x: 40, y: 20, color: "hsl(30 80% 50%)", friendlyName: "Competitions", friendlyEmoji: "🏆", friendlyDesc: "Contests your screenplays are entered into" },
  { id: "competition_judge_config", label: "competition_judge_config", canonical: "Judge Config", canonicalDesc: "AI model, scoring weights, and lockdown state for each competition's judge.", columns: ["id", "competition_id", "model_id", "scoring_weights", "locked"], x: 40, y: 700, color: "hsl(30 60% 55%)", friendlyName: "Judge Settings", friendlyEmoji: "⚙️", friendlyDesc: "Rules the AI follows when scoring a competition" },
  { id: "scores", label: "scores", canonical: "Final Scores", canonicalDesc: "AI-generated dimensional scores (dialogue, emotion, structure, etc.) per entry.", columns: ["id", "entry_id", "total_score", "dialogue", "emotion", "structure", "originality"], x: 800, y: 470, color: "hsl(350 65% 55%)", friendlyName: "Scores", friendlyEmoji: "📈", friendlyDesc: "AI-generated scores for each screenplay dimension" },
  { id: "evaluation_runs", label: "evaluation_runs", canonical: "Eval Passes", canonicalDesc: "Individual AI judging passes with model, temperature, and quotient scores.", columns: ["id", "entry_id", "model_used", "temperature", "quotient_scores_json"], x: 800, y: 620, color: "hsl(20 70% 50%)", friendlyName: "Eval Passes", friendlyEmoji: "🔄", friendlyDesc: "Individual AI judging passes at different temperatures" },
  { id: "voice_drift_analysis", label: "voice_drift_analysis", canonical: "Voice Drift", canonicalDesc: "Measures how much a writer's voice changed across screenplay versions.", columns: ["id", "entry_id", "drift_score", "flagged", "details"], x: 280, y: 780, color: "hsl(180 60% 45%)", friendlyName: "Voice Drift", friendlyEmoji: "🎙️", friendlyDesc: "How much your writing voice changed across drafts" },
];

const DOMAIN_GROUPS: { label: string; emoji: string; color: string; tableIds: string[] }[] = [
  { label: "Creative", emoji: "🎬", color: "hsl(210 70% 55%)", tableIds: ["entries", "screenplay_versions", "artifacts", "artifact_metrics", "influence_scores", "provenance_nodes", "provenance_edges", "competitions", "scores"] },
  { label: "Governance & AI", emoji: "⚖️", color: "hsl(270 60% 55%)", tableIds: ["governance_events", "ai_usage_log", "audit_log", "competition_judge_config", "evaluation_runs", "voice_drift_analysis"] },
  { label: "Economy", emoji: "💰", color: "hsl(160 60% 45%)", tableIds: ["wallet_transactions", "token_wallets", "purchases", "feature_usage_log", "feature_subscriptions", "subscriptions"] },
];

const ER_EDGES: EREdge[] = [
  { from: "entries", to: "screenplay_versions", label: "entry_id", friendlyLabel: "has versions", type: "ownership" },
  { from: "entries", to: "governance_events", label: "entry_id", friendlyLabel: "triggers decisions", type: "ownership" },
  { from: "entries", to: "ai_usage_log", label: "entry_id", friendlyLabel: "uses AI", type: "ownership" },
  { from: "entries", to: "artifacts", label: "entry_id", friendlyLabel: "produces", type: "ownership" },
  { from: "entries", to: "influence_scores", label: "entry_id", friendlyLabel: "scored for", type: "ownership" },
  { from: "entries", to: "provenance_nodes", label: "entry_id", friendlyLabel: "traced from", type: "ownership" },
  { from: "artifacts", to: "artifact_metrics", label: "artifact_id", friendlyLabel: "measured by", type: "reference" },
  { from: "screenplay_versions", to: "influence_scores", label: "version_id", friendlyLabel: "rated in", type: "reference" },
  { from: "provenance_nodes", to: "provenance_edges", label: "from/to_node_id", friendlyLabel: "connects to", type: "reference" },
  { from: "governance_events", to: "ai_usage_log", label: "execution_id", friendlyLabel: "logged as", type: "linked" },
  { from: "wallet_transactions", to: "token_wallets", label: "user_id", friendlyLabel: "updates balance", type: "linked" },
  { from: "token_wallets", to: "purchases", label: "user_id", friendlyLabel: "funded by", type: "linked" },
  { from: "feature_usage_log", to: "feature_subscriptions", label: "user_id", friendlyLabel: "billed to", type: "linked" },
  { from: "feature_subscriptions", to: "subscriptions", label: "user_id", friendlyLabel: "part of plan", type: "linked" },
  // ── New edges for system flows ──
  { from: "competitions", to: "entries", label: "competition_id", friendlyLabel: "hosts", type: "ownership" },
  { from: "competitions", to: "competition_judge_config", label: "competition_id", friendlyLabel: "configured by", type: "reference" },
  { from: "entries", to: "scores", label: "entry_id", friendlyLabel: "scored as", type: "ownership" },
  { from: "entries", to: "evaluation_runs", label: "entry_id", friendlyLabel: "evaluated in", type: "ownership" },
  { from: "entries", to: "voice_drift_analysis", label: "entry_id", friendlyLabel: "analyzed for drift", type: "ownership" },
  { from: "screenplay_versions", to: "voice_drift_analysis", label: "entry_id", friendlyLabel: "compared in", type: "reference" },
  { from: "voice_drift_analysis", to: "influence_scores", label: "entry_id", friendlyLabel: "updates", type: "linked" },
  { from: "evaluation_runs", to: "scores", label: "entry_id", friendlyLabel: "produces", type: "reference" },
  { from: "screenplay_versions", to: "feature_usage_log", label: "entry_id", friendlyLabel: "rewrite logged in", type: "linked" },
];

const NODE_W = 200;
const SIMPLE_NODE_W = 220;
const NODE_H_BASE = 60;
const SIMPLE_NODE_H = 90;
const COL_H = 16;

function getNodeCenter(t: ERTable, positions: Record<string, { x: number; y: number }>, simple = false): { cx: number; cy: number; h: number } {
  const pos = positions[t.id] ?? { x: t.x, y: t.y };
  const w = simple ? SIMPLE_NODE_W : NODE_W;
  const h = simple ? SIMPLE_NODE_H : NODE_H_BASE + t.columns.length * COL_H;
  return { cx: pos.x + w / 2, cy: pos.y + h / 2, h };
}

function edgeColor(type: EREdge["type"]) {
  if (type === "ownership") return "hsl(210 70% 55%)";
  if (type === "linked") return "hsl(40 80% 55%)";
  return "hsl(var(--muted-foreground) / 0.4)";
}

// Data flow animation paths with step-by-step descriptions
const FLOW_PATHS: Record<string, { label: string; path: string[]; color: string; description: string; steps: string[] }> = {
  creative: {
    label: "Creative Flow",
    path: ["entries", "screenplay_versions", "artifacts", "artifact_metrics"],
    color: "hsl(var(--primary))",
    description: "Traces a screenplay from submission through version tracking to computed analysis and quality metrics.",
    steps: [
      "Writer submits a screenplay entry with title, genre, and method type",
      "Each edit creates a new version with actor attribution and text hash",
      "The system generates analysis artifacts (structure maps, beat sheets, etc.)",
      "Artifact metrics score each analysis with confidence ratings",
    ],
  },
  governance: {
    label: "Governance Flow",
    path: ["entries", "governance_events", "ai_usage_log"],
    color: "hsl(40 80% 55%)",
    description: "Shows how AI decisions are recorded and linked to model telemetry for auditability.",
    steps: [
      "An entry triggers an AI operation (judging, rewrite, analysis)",
      "Governance logs the routing decision, model choice, and safety checks",
      "Usage telemetry records tokens consumed, latency, cost, and any errors",
    ],
  },
  economy: {
    label: "Token Economy",
    path: ["entries", "wallet_transactions", "token_wallets", "purchases"],
    color: "hsl(160 60% 45%)",
    description: "Follows the token lifecycle from earning/spending through balance updates to real-money purchases.",
    steps: [
      "An action on an entry triggers a token credit or debit",
      "A transaction record is appended to the immutable ledger",
      "The user's wallet balance is atomically updated",
      "Users can buy token bundles via Stripe to top up their wallet",
    ],
  },
  subscription: {
    label: "Subscription Lifecycle",
    path: ["entries", "feature_usage_log", "feature_subscriptions", "subscriptions"],
    color: "hsl(280 55% 55%)",
    description: "Tracks how feature usage is billed against per-feature subscriptions and overall plan tiers.",
    steps: [
      "A user performs a token-costing action on an entry",
      "The usage log records the action, tokens spent, and feature attribution",
      "Per-feature subscriptions handle billing cycles and auto-renewal",
      "The user's plan tier (Free, Pro, Studio) governs token allowances",
    ],
  },
  competition: {
    label: "Competition Workflow",
    path: ["competitions", "competition_judge_config", "entries", "evaluation_runs", "scores", "script_quotients", "influence_scores", "profiles"],
    color: "hsl(30 80% 50%)",
    description: "Full competition lifecycle: submission portal intake → AI multi-pass judging → dimensional scoring → score propagation to writer profile and screenplay dashboard.",
    steps: [
      "An admin creates a competition with a prompt, sensitivity, and festival linkage",
      "Judge config locks the AI model, scoring weights, and temperature before submissions open",
      "Writers submit screenplay entries through the submission portal with genre, method type, and page count",
      "The AI runs multi-pass evaluation at varying temperatures, logging each run",
      "Final dimensional scores (dialogue, emotion, structure, originality, etc.) are produced",
      "Script quotients aggregate per-dimension confidence and variance ratings",
      "Influence scores measure AI impact, voice stability, and originality distance",
      "Results propagate to the writer's profile for their dashboard and screenplay portfolio",
    ],
  },
  rewrite: {
    label: "AI Rewrite",
    path: ["entries", "screenplay_versions", "feature_usage_log", "governance_events", "influence_scores"],
    color: "hsl(330 60% 55%)",
    description: "How an AI rewrite suggestion flows from selection to version creation, governance audit, and originality recalculation.",
    steps: [
      "User selects text in their screenplay entry for rewrite",
      "A new version is created with the AI-suggested changes and actor attribution",
      "The rewrite is logged as feature usage with token cost",
      "Governance records the AI routing decision and model used",
      "Influence scores are recalculated to measure originality and AI impact",
    ],
  },
  voiceDrift: {
    label: "Voice Drift",
    path: ["entries", "screenplay_versions", "voice_drift_analysis", "influence_scores"],
    color: "hsl(180 60% 45%)",
    description: "Analyzes how a writer's voice evolves across screenplay drafts and updates originality metrics.",
    steps: [
      "A screenplay entry serves as the anchor for all versions",
      "Multiple versions are compared to detect stylistic changes",
      "Voice drift analysis measures how much the writing voice shifted",
      "Influence scores update with voice stability and originality distance",
    ],
  },
  writerJourney: {
    label: "Writer Journey",
    path: ["profiles", "entries", "scores", "user_badges", "user_genre_stats"],
    color: "hsl(260 55% 55%)",
    description: "Traces the full writer progression: from profile creation through screenplay submissions, scoring outcomes, badge achievements, and genre specialization tracking.",
    steps: [
      "A writer creates their profile with display name and pen name",
      "They submit screenplay entries with genre, method type, and draft tracking",
      "Each entry receives dimensional scores from AI judging (dialogue, emotion, structure, etc.)",
      "Achievements unlock badges based on submission milestones and scoring thresholds",
      "Genre statistics aggregate the writer's output and track specialization over time",
    ],
  },
};

function CanonicalERDiagram() {
  const [open, setOpen] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [rowCounts, setRowCounts] = useState<Record<string, number | null>>({});
  const [animating, setAnimating] = useState(false);
  const [activeFlowIdx, setActiveFlowIdx] = useState(-1);
  const [selectedFlow, setSelectedFlow] = useState("creative");
  const [isolateFlow, setIsolateFlow] = useState(false);
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [simpletonMode, setSimpletonMode] = useState(() => {
    try { return localStorage.getItem("er-diagram-simple-mode") === "true"; } catch { return false; }
  });

  // Zoom & pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Draggable node positions — persisted to localStorage
  const LS_KEY = "er-diagram-positions";
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const init: Record<string, { x: number; y: number }> = {};
        ER_TABLES.forEach(t => { init[t.id] = parsed[t.id] ?? { x: t.x, y: t.y }; });
        return init;
      }
    } catch { /* ignore */ }
    const init: Record<string, { x: number; y: number }> = {};
    ER_TABLES.forEach(t => { init[t.id] = { x: t.x, y: t.y }; });
    return init;
  });
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Fetch row counts when opened
  useEffect(() => {
    if (!open || Object.keys(rowCounts).length > 0) return;
    async function fetch() {
      const results = await Promise.all(
        ER_TABLES.map(async (t) => {
          try {
            const { count } = await supabase.from(t.id as any).select("id", { count: "exact", head: true });
            return { id: t.id, count: count ?? 0 };
          } catch {
            return { id: t.id, count: null };
          }
        })
      );
      const map: Record<string, number | null> = {};
      results.forEach(r => { map[r.id] = r.count; });
      setRowCounts(map);
    }
    fetch();
  }, [open, rowCounts]);

  const activeFlowPath = FLOW_PATHS[selectedFlow].path;
  const activeFlowColor = FLOW_PATHS[selectedFlow].color;
  const flowPathSet = useMemo(() => new Set(activeFlowPath), [activeFlowPath]);

  // Build set of consecutive edge pairs in the flow path for highlighting
  const flowEdgePairs = useMemo(() => {
    const pairs = new Set<string>();
    for (let i = 0; i < activeFlowPath.length - 1; i++) {
      pairs.add(`${activeFlowPath[i]}|${activeFlowPath[i + 1]}`);
      pairs.add(`${activeFlowPath[i + 1]}|${activeFlowPath[i]}`);
    }
    return pairs;
  }, [activeFlowPath]);

  // Auto-pan/zoom to fit flow nodes when isolation is toggled on
  const fitFlowInView = useCallback(() => {
    const flowTables = ER_TABLES.filter(t => flowPathSet.has(t.id));
    if (flowTables.length === 0) return;
    const nw = simpletonMode ? SIMPLE_NODE_W : NODE_W;
    const positions = flowTables.map(t => nodePositions[t.id] ?? { x: t.x, y: t.y });
    const heights = flowTables.map(t => simpletonMode ? SIMPLE_NODE_H : NODE_H_BASE + t.columns.length * COL_H);
    const minX = Math.min(...positions.map(p => p.x));
    const minY = Math.min(...positions.map(p => p.y));
    const maxX = Math.max(...positions.map((p) => p.x + nw));
    const maxY = Math.max(...positions.map((p, i) => p.y + heights[i]));
    const bw = maxX - minX;
    const bh = maxY - minY;
    const pad = 60;
    const cw = containerRef.current?.clientWidth || svgW;
    const ch = 500; // container height
    const scaleX = cw / (bw + pad * 2);
    const scaleY = ch / (bh + pad * 2);
    const newZoom = Math.min(Math.max(Math.min(scaleX, scaleY) * (svgW / cw), 0.3), 2.5);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const newPanX = -(centerX - svgW / (2 * newZoom)) * (cw / svgW) * newZoom;
    const newPanY = -(centerY - svgH / (2 * newZoom)) * (ch / svgH) * newZoom;
    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  }, [flowPathSet, nodePositions, simpletonMode]);

  // Data flow animation
  const startAnimation = useCallback(() => {
    if (animRef.current) clearInterval(animRef.current);
    const flowPath = FLOW_PATHS[selectedFlow].path;
    setAnimating(true);
    setActiveFlowIdx(0);
    let idx = 0;
    animRef.current = setInterval(() => {
      idx++;
      if (idx >= flowPath.length) {
        if (animRef.current) clearInterval(animRef.current);
        animRef.current = null;
        setAnimating(false);
        setActiveFlowIdx(-1);
        return;
      }
      setActiveFlowIdx(idx);
    }, 800);
  }, [selectedFlow]);

  useEffect(() => {
    return () => { if (animRef.current) clearInterval(animRef.current); };
  }, []);

  // Keyboard shortcuts for zoom (+ / - / 0)
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input/select
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "=" || e.key === "+") { e.preventDefault(); setZoom(z => Math.min(z * 1.25, 3)); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); setZoom(z => Math.max(z / 1.25, 0.3)); }
      else if (e.key === "0") { e.preventDefault(); setZoom(1); setPan({ x: 0, y: 0 }); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const svgW = 1060;
  const svgH = 920;

  // Zoom helpers
  const zoomIn = useCallback(() => setZoom(z => Math.min(z * 1.25, 3)), []);
  const zoomOut = useCallback(() => setZoom(z => Math.max(z / 1.25, 0.3)), []);
  const zoomReset = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Zoom
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(z => Math.max(0.3, Math.min(3, z * delta)));
    } else {
      // Pan
      setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    }
  }, []);

  // Convert client coords → SVG content coords (undoing zoom/pan transform)
  const getSvgPoint = useCallback((e: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const rawX = (e.clientX - rect.left) * (svgW / rect.width);
    const rawY = (e.clientY - rect.top) * (svgH / rect.height);
    const panSvgX = pan.x * (svgW / rect.width);
    const panSvgY = pan.y * (svgH / rect.height);
    return { x: (rawX - panSvgX) / zoom, y: (rawY - panSvgY) / zoom };
  }, [zoom, pan]);

  const onCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (dragRef.current) return;
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      e.preventDefault();
      isPanning.current = true;
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    }
  }, [pan]);

  const onDragStart = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const pt = getSvgPoint(e);
    const pos = nodePositions[id];
    dragRef.current = { id, startX: pt.x, startY: pt.y, origX: pos.x, origY: pos.y };
  }, [getSvgPoint, nodePositions]);

  const onDragMove = useCallback((e: React.MouseEvent) => {
    if (isPanning.current) {
      setPan({
        x: panStart.current.panX + (e.clientX - panStart.current.x),
        y: panStart.current.panY + (e.clientY - panStart.current.y),
      });
      return;
    }
    if (!dragRef.current) return;
    const pt = getSvgPoint(e);
    const { id, startX, startY, origX, origY } = dragRef.current;
    const GRID = 20;
    const rawX = origX + (pt.x - startX);
    const rawY = origY + (pt.y - startY);
    setNodePositions(prev => ({
      ...prev,
      [id]: { x: Math.round(rawX / GRID) * GRID, y: Math.round(rawY / GRID) * GRID },
    }));
  }, [getSvgPoint]);

  const onDragEnd = useCallback(() => {
    isPanning.current = false;
    if (dragRef.current) {
      try { localStorage.setItem(LS_KEY, JSON.stringify(nodePositions)); } catch { /* ignore */ }
    }
    dragRef.current = null;
  }, [nodePositions]);

  const handleNodeHover = (tableId: string, svgX: number, svgY: number) => {
    if (dragRef.current) return;
    setHoveredNode(tableId);
    setTooltipPos({ x: svgX * zoom + pan.x, y: svgY * zoom + pan.y });
  };

  const resetPositions = useCallback(() => {
    const init: Record<string, { x: number; y: number }> = {};
    ER_TABLES.forEach(t => { init[t.id] = { x: t.x, y: t.y }; });
    setNodePositions(init);
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  }, []);

  const hoveredTable = hoveredNode ? ER_TABLES.find(t => t.id === hoveredNode) : null;

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Canonical Schema ER Diagram</span>
          <Badge variant="outline" className="text-[10px] font-mono">{ER_TABLES.length} tables</Badge>
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-border/30 p-4">
          {/* Legend + Controls */}
          <div className="flex items-center justify-between mb-3">
            {simpletonMode ? (
              <div className="flex items-center gap-4 text-[11px]">
                {DOMAIN_GROUPS.map(g => (
                  <span key={g.label} className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded" style={{ background: g.color, opacity: 0.25 }} />
                    <span className="font-medium" style={{ color: g.color }}>{g.emoji} {g.label}</span>
                  </span>
                ))}
                <span className="text-muted-foreground ml-1">· Drag to rearrange</span>
              </div>
            ) : (
              <div className="flex items-center gap-5 text-[10px] font-mono text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-5 h-0.5 rounded" style={{ background: edgeColor("ownership") }} /> ownership
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-5 h-0.5 rounded" style={{ background: edgeColor("reference") }} /> reference
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-5 h-0.5 rounded border-t border-dashed" style={{ borderColor: edgeColor("linked") }} /> linked
                </span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button
                variant={simpletonMode ? "default" : "outline"}
                size="sm"
                className="text-[10px] gap-1 h-7"
                onClick={() => {
                  const next = !simpletonMode;
                  setSimpletonMode(next);
                  try { localStorage.setItem("er-diagram-simple-mode", String(next)); } catch { /* ignore */ }
                }}
              >
                {simpletonMode ? "👀 Simple View" : "🔧 Expert View"}
              </Button>
              <select
                value={selectedFlow}
                onChange={e => { setSelectedFlow(e.target.value); if (animating && animRef.current) { clearInterval(animRef.current); animRef.current = null; setAnimating(false); setActiveFlowIdx(-1); } }}
                disabled={animating}
                className="h-7 rounded-md border border-input bg-background px-2 text-[10px] font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {Object.entries(FLOW_PATHS).map(([key, fp]) => (
                  <option key={key} value={key}>{fp.label}</option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                className="text-[10px] gap-1.5 h-7"
                onClick={startAnimation}
                disabled={animating}
              >
                <RefreshCw className={`h-3 w-3 ${animating ? "animate-spin" : ""}`} />
                {animating ? "Flowing..." : "Animate"}
              </Button>
              <Button
                variant={isolateFlow ? "default" : "outline"}
                size="sm"
                className="text-[10px] gap-1.5 h-7"
                onClick={() => {
                  const next = !isolateFlow;
                  setIsolateFlow(next);
                  if (next) fitFlowInView();
                }}
              >
                👁 {isolateFlow ? "Isolated" : "Isolate"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-[10px] gap-1 h-7 text-muted-foreground"
                onClick={resetPositions}
              >
                Reset Layout
              </Button>
            </div>
          </div>

          <div className="relative" ref={containerRef}>
            <div className="overflow-hidden rounded-lg border border-border/20" style={{ height: 500 }}>
              <svg
                ref={svgRef}
                viewBox={`0 0 ${svgW} ${svgH}`}
                width="100%"
                height="100%"
                className="block"
                onMouseMove={onDragMove}
                onMouseUp={onDragEnd}
                onMouseLeave={onDragEnd}
                onMouseDown={onCanvasMouseDown}
                onWheel={handleWheel}
                style={{ cursor: isPanning.current ? "grabbing" : undefined }}
              >
                {/* Arrow marker defs for isolated flow edges */}
                <defs>
                  <marker
                    id="flow-arrow"
                    viewBox="0 0 10 8"
                    refX={9}
                    refY={4}
                    markerWidth={8}
                    markerHeight={6}
                    orient="auto-start-reverse"
                  >
                    <path d="M0,0 L10,4 L0,8 Z" fill={activeFlowColor} fillOpacity={0.85} />
                  </marker>
                </defs>
                <g transform={`translate(${pan.x * svgW / (containerRef.current?.clientWidth || svgW)}, ${pan.y * svgH / (containerRef.current?.clientHeight || svgH)}) scale(${zoom})`}>
                {/* Domain group backgrounds (simpleton mode) */}
                {simpletonMode && DOMAIN_GROUPS.map(group => {
                  const tables = ER_TABLES.filter(t => group.tableIds.includes(t.id));
                  if (tables.length === 0) return null;
                  const positions = tables.map(t => nodePositions[t.id] ?? { x: t.x, y: t.y });
                  const pad = 16;
                  const nw = SIMPLE_NODE_W;
                  const nh = SIMPLE_NODE_H;
                  const minX = Math.min(...positions.map(p => p.x)) - pad;
                  const minY = Math.min(...positions.map(p => p.y)) - pad - 18;
                  const maxX = Math.max(...positions.map(p => p.x)) + nw + pad;
                  const maxY = Math.max(...positions.map(p => p.y)) + nh + pad;
                  const groupHasFlowNode = isolateFlow && tables.some(t => flowPathSet.has(t.id));
                  const groupOpacity = isolateFlow && !groupHasFlowNode ? 0.05 : 1;
                  return (
                    <g key={group.label} opacity={groupOpacity} style={{ transition: "opacity 0.3s" }}>
                      <rect
                        x={minX} y={minY} width={maxX - minX} height={maxY - minY}
                        rx={16} ry={16}
                        fill={group.color}
                        fillOpacity={0.06}
                        stroke={group.color}
                        strokeOpacity={0.15}
                        strokeWidth={1.5}
                        strokeDasharray="8 4"
                      />
                      <text
                        x={minX + 10} y={minY + 14}
                        fill={group.color}
                        fontSize={11}
                        fontWeight={600}
                        fontFamily="sans-serif"
                        fillOpacity={0.7}
                      >
                        {group.emoji} {group.label}
                      </text>
                    </g>
                  );
                })}

                {/* Animated flow pulses */}
                {animating && activeFlowIdx > 0 && (() => {
                  const prevId = activeFlowPath[activeFlowIdx - 1];
                  const currId = activeFlowPath[activeFlowIdx];
                  const fromT = ER_TABLES.find(t => t.id === prevId)!;
                  const toT = ER_TABLES.find(t => t.id === currId)!;
                  if (!fromT || !toT) return null;
                  const f = getNodeCenter(fromT, nodePositions, simpletonMode);
                  const c = getNodeCenter(toT, nodePositions, simpletonMode);
                  return (
                    <g>
                      <line
                        x1={f.cx} y1={f.cy} x2={c.cx} y2={c.cy}
                        stroke={activeFlowColor}
                        strokeWidth={4}
                        strokeOpacity={0.6}
                      >
                        <animate attributeName="stroke-opacity" values="0.8;0.2;0.8" dur="0.8s" repeatCount="indefinite" />
                      </line>
                      <circle r={6} fill={activeFlowColor}>
                        <animateMotion dur="0.8s" repeatCount="indefinite" path={`M${f.cx},${f.cy} L${c.cx},${c.cy}`} />
                        <animate attributeName="opacity" values="1;0.3;1" dur="0.8s" repeatCount="indefinite" />
                      </circle>
                    </g>
                  );
                })()}

                {/* Edges */}
                {ER_EDGES.map((edge, i) => {
                  const fromT = ER_TABLES.find(t => t.id === edge.from)!;
                  const toT = ER_TABLES.find(t => t.id === edge.to)!;
                  const f = getNodeCenter(fromT, nodePositions, simpletonMode);
                  const t = getNodeCenter(toT, nodePositions, simpletonMode);
                  const isDashed = edge.type === "linked";
                  const isFlowEdge = isolateFlow && flowEdgePairs.has(`${edge.from}|${edge.to}`);
                  const bothInFlow = isolateFlow && flowPathSet.has(edge.from) && flowPathSet.has(edge.to);
                  const edgeOpacity = isolateFlow ? (bothInFlow ? 1 : 0.08) : 0.7;
                  return (
                    <g key={i} opacity={edgeOpacity} style={{ transition: "opacity 0.3s" }}>
                      <line
                        x1={f.cx} y1={f.cy} x2={t.cx} y2={t.cy}
                        stroke={isFlowEdge ? activeFlowColor : (simpletonMode ? "hsl(var(--muted-foreground) / 0.35)" : edgeColor(edge.type))}
                        strokeWidth={isFlowEdge ? 3 : (simpletonMode ? 2 : edge.type === "ownership" ? 2 : 1.5)}
                        strokeDasharray={isFlowEdge ? "8 4" : (!simpletonMode && isDashed ? "6 3" : undefined)}
                        strokeOpacity={isFlowEdge ? 0.9 : 0.7}
                        markerEnd={isFlowEdge ? "url(#flow-arrow)" : undefined}
                      >
                        {isFlowEdge && (
                          <animate attributeName="stroke-dashoffset" values="24;0" dur="1s" repeatCount="indefinite" />
                        )}
                      </line>
                      <text
                        x={(f.cx + t.cx) / 2}
                        y={(f.cy + t.cy) / 2 - 5}
                        fill={isFlowEdge ? activeFlowColor : "hsl(var(--muted-foreground))"}
                        fontSize={simpletonMode ? 10 : 9}
                        fontFamily={simpletonMode ? "sans-serif" : "monospace"}
                        textAnchor="middle"
                        fontWeight={isFlowEdge ? 700 : (simpletonMode ? 500 : 400)}
                      >
                        {simpletonMode ? edge.friendlyLabel : edge.label}
                      </text>
                    </g>
                  );
                })}

                {/* Table nodes */}
                {ER_TABLES.map(table => {
                  const pos = nodePositions[table.id] ?? { x: table.x, y: table.y };
                  const nodeW = simpletonMode ? SIMPLE_NODE_W : NODE_W;
                  const h = simpletonMode ? SIMPLE_NODE_H : NODE_H_BASE + table.columns.length * COL_H;
                  const isFlowActive = animating && activeFlowPath[activeFlowIdx] === table.id;
                  const isHovered = hoveredNode === table.id;
                  const isDragging = dragRef.current?.id === table.id;
                  const rc = rowCounts[table.id];
                  const isInFlow = flowPathSet.has(table.id);
                  const nodeOpacity = isolateFlow && !isInFlow ? 0.12 : 1;
                  return (
                    <g
                      key={table.id}
                      onMouseDown={e => onDragStart(table.id, e)}
                      onMouseEnter={() => handleNodeHover(table.id, pos.x + nodeW + 12, pos.y)}
                      onMouseLeave={() => setHoveredNode(null)}
                      style={{ cursor: isDragging ? "grabbing" : "grab", opacity: nodeOpacity, transition: "opacity 0.3s" }}
                    >
                      {/* Glow ring on flow active or isolated flow member */}
                      {(isFlowActive || (isolateFlow && isInFlow && !isFlowActive)) && (
                        <rect
                          x={pos.x - 4} y={pos.y - 4} width={nodeW + 8} height={h + 8}
                          rx={simpletonMode ? 16 : 10} ry={simpletonMode ? 16 : 10}
                          fill="none"
                          stroke={isFlowActive ? "hsl(var(--primary))" : activeFlowColor}
                          strokeWidth={isFlowActive ? 2.5 : 2}
                          strokeOpacity={isFlowActive ? 0.7 : 0.5}
                        >
                          {isFlowActive && (
                            <animate attributeName="stroke-opacity" values="0.9;0.3;0.9" dur="0.8s" repeatCount="indefinite" />
                          )}
                        </rect>
                      )}
                      {/* Hover highlight */}
                      {isHovered && !isFlowActive && (
                        <rect
                          x={pos.x - 3} y={pos.y - 3} width={nodeW + 6} height={h + 6}
                          rx={simpletonMode ? 16 : 10} ry={simpletonMode ? 16 : 10}
                          fill="none"
                          stroke={table.color}
                          strokeWidth={2}
                          strokeOpacity={0.5}
                        />
                      )}
                      <rect
                        x={pos.x} y={pos.y} width={nodeW} height={h}
                        rx={simpletonMode ? 14 : 8} ry={simpletonMode ? 14 : 8}
                        fill="hsl(var(--card))"
                        stroke={table.color}
                        strokeWidth={isHovered ? 2 : 1.5}
                      />

                      {simpletonMode ? (
                        /* ── Simpleton node ── */
                        <>
                          {/* Colored header strip */}
                          <rect
                            x={pos.x} y={pos.y} width={nodeW} height={32}
                            rx={14} ry={14}
                            fill={table.color}
                            fillOpacity={isHovered ? 0.3 : 0.18}
                          />
                          <rect
                            x={pos.x} y={pos.y + 22} width={nodeW} height={10}
                            fill={table.color}
                            fillOpacity={isHovered ? 0.3 : 0.18}
                          />
                          {/* Emoji + friendly name */}
                          <text
                            x={pos.x + 12} y={pos.y + 22}
                            fill={table.color}
                            fontSize={13}
                            fontWeight={700}
                            fontFamily="sans-serif"
                          >
                            {table.friendlyEmoji} {table.friendlyName}
                          </text>
                          {/* Description (two-line wrap via foreignObject) */}
                          <foreignObject x={pos.x + 10} y={pos.y + 34} width={nodeW - 20} height={36}>
                            <div style={{ fontSize: 10, lineHeight: "13px", color: "hsl(var(--muted-foreground))", fontFamily: "sans-serif", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
                              {table.friendlyDesc}
                            </div>
                          </foreignObject>
                          {/* Record count */}
                          <text
                            x={pos.x + 12} y={pos.y + h - 8}
                            fill="hsl(var(--muted-foreground))"
                            fontSize={9}
                            fontFamily="sans-serif"
                          >
                            {rc !== null && rc !== undefined ? `${rc.toLocaleString()} records` : "loading..."}
                          </text>
                        </>
                      ) : (
                        /* ── Expert node ── */
                        <>
                          {/* Header bar */}
                          <rect
                            x={pos.x} y={pos.y} width={nodeW} height={28}
                            rx={8} ry={8}
                            fill={table.color}
                            fillOpacity={isHovered ? 0.25 : 0.15}
                          />
                          <rect
                            x={pos.x} y={pos.y + 20} width={nodeW} height={8}
                            fill={table.color}
                            fillOpacity={isHovered ? 0.25 : 0.15}
                          />
                          <text
                            x={pos.x + 10} y={pos.y + 18}
                            fill={table.color}
                            fontSize={11}
                            fontWeight={700}
                            fontFamily="monospace"
                          >
                            {table.label}
                          </text>
                          {/* Row count badge */}
                          <text
                            x={pos.x + nodeW - 8} y={pos.y + 17}
                            fill="hsl(var(--muted-foreground))"
                            fontSize={9}
                            fontFamily="monospace"
                            textAnchor="end"
                            fontWeight={600}
                          >
                            {rc !== null && rc !== undefined ? `${rc.toLocaleString()} rows` : "..."}
                          </text>
                          {/* Divider */}
                          <line
                            x1={pos.x} y1={pos.y + 28} x2={pos.x + nodeW} y2={pos.y + 28}
                            stroke={table.color} strokeOpacity={0.3} strokeWidth={1}
                          />
                          {/* Columns */}
                          {table.columns.map((col, ci) => (
                            <text
                              key={ci}
                              x={pos.x + 12}
                              y={pos.y + 44 + ci * COL_H}
                              fill="hsl(var(--muted-foreground))"
                              fontSize={10}
                              fontFamily="monospace"
                            >
                              {ci === 0 ? "PK " : "   "}{col}
                            </text>
                          ))}
                        </>
                      )}
                    </g>
                  );
                })}
                </g>
              </svg>
            </div>

            {/* Zoom controls + keyboard legend */}
            <div className="absolute top-2 right-2 flex flex-col gap-1 z-40">
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={zoomIn} title="Zoom in (+)">
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={zoomOut} title="Zoom out (-)">
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={zoomReset} title="Fit to view (0)">
                <Maximize className="h-3.5 w-3.5" />
              </Button>
              <span className="text-[9px] font-mono text-muted-foreground text-center mt-0.5">
                {Math.round(zoom * 100)}%
              </span>
              {/* Keyboard shortcut legend */}
              <div className="mt-1.5 rounded-md border border-border/40 bg-card/95 px-2 py-1.5 space-y-0.5 shadow-sm">
                <p className="text-[8px] font-semibold text-foreground/70 uppercase tracking-wider mb-1">Shortcuts</p>
                {[
                  ["+", "Zoom in"],
                  ["−", "Zoom out"],
                  ["0", "Fit view"],
                  ["Shift+drag", "Pan"],
                  ["Ctrl+scroll", "Zoom"],
                  ["Scroll", "Pan"],
                  ["Click mini-map", "Jump"],
                ].map(([key, desc]) => (
                  <div key={key} className="flex items-center gap-1.5">
                    <kbd className="inline-block min-w-[14px] text-center rounded border border-border/50 bg-muted/50 px-1 py-0 text-[7px] font-mono text-foreground/60 leading-[14px]">{key}</kbd>
                    <span className="text-[8px] text-muted-foreground">{desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Mini-map (clickable) */}
            <div
              className="absolute bottom-2 right-2 z-40 rounded-md border border-border/50 bg-card/90 overflow-hidden shadow-sm cursor-crosshair"
              style={{ width: 140, height: 140 * (svgH / svgW) }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const clickX = (e.clientX - rect.left) / rect.width; // 0-1
                const clickY = (e.clientY - rect.top) / rect.height; // 0-1
                const cw = containerRef.current?.clientWidth || svgW;
                const ch = containerRef.current?.clientHeight || svgH;
                // Center the viewport on the clicked SVG coordinate
                const targetSvgX = clickX * svgW;
                const targetSvgY = clickY * svgH;
                const newPanX = -(targetSvgX - svgW / (2 * zoom)) * (cw / svgW) * zoom;
                const newPanY = -(targetSvgY - svgH / (2 * zoom)) * (ch / svgH) * zoom;
                setPan({ x: newPanX, y: newPanY });
              }}
            >
              <svg viewBox={`0 0 ${svgW} ${svgH}`} width="100%" height="100%" style={{ pointerEvents: "none" }}>
                {/* All nodes as tiny rects */}
                {ER_TABLES.map(table => {
                  const pos = nodePositions[table.id] ?? { x: table.x, y: table.y };
                  const nodeW = simpletonMode ? SIMPLE_NODE_W : NODE_W;
                  const h = simpletonMode ? SIMPLE_NODE_H : NODE_H_BASE + table.columns.length * COL_H;
                  return (
                    <rect
                      key={table.id}
                      x={pos.x} y={pos.y} width={nodeW} height={h}
                      rx={3} ry={3}
                      fill={table.color}
                      fillOpacity={0.4}
                      stroke={table.color}
                      strokeWidth={1}
                      strokeOpacity={0.6}
                    />
                  );
                })}
                {/* Viewport indicator */}
                <rect
                  x={-pan.x * (svgW / (containerRef.current?.clientWidth || svgW)) / zoom}
                  y={-pan.y * (svgH / (containerRef.current?.clientHeight || svgH)) / zoom}
                  width={svgW / zoom}
                  height={svgH / zoom}
                  rx={4} ry={4}
                  fill="hsl(var(--primary) / 0.08)"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  strokeOpacity={0.6}
                />
              </svg>
            </div>

            {/* HTML Tooltip overlay */}
            {hoveredTable && (
              <div
                className="absolute z-50 pointer-events-none animate-fade-in"
                style={{
                  left: Math.min(tooltipPos.x, svgW - 260),
                  top: tooltipPos.y,
                  maxWidth: 250,
                }}
              >
                <div className="rounded-lg border border-border bg-popover p-3 shadow-lg space-y-1.5">
                  {simpletonMode ? (
                    <>
                      <p className="text-sm font-semibold" style={{ color: hoveredTable.color }}>
                        {hoveredTable.friendlyEmoji} {hoveredTable.friendlyName}
                      </p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{hoveredTable.friendlyDesc}</p>
                      {rowCounts[hoveredTable.id] !== null && rowCounts[hoveredTable.id] !== undefined && (
                        <p className="text-[10px] text-foreground">
                          {rowCounts[hoveredTable.id]?.toLocaleString()} records stored
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: hoveredTable.color }} />
                        <span className="text-xs font-mono font-semibold" style={{ color: hoveredTable.color }}>
                          {hoveredTable.label}
                        </span>
                      </div>
                      <Badge variant="outline" className="text-[9px] font-mono">{hoveredTable.canonical}</Badge>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">{hoveredTable.canonicalDesc}</p>
                      {rowCounts[hoveredTable.id] !== null && rowCounts[hoveredTable.id] !== undefined && (
                        <p className="text-[10px] font-mono text-foreground">
                          {rowCounts[hoveredTable.id]?.toLocaleString()} rows · {hoveredTable.columns.length} columns
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Flow Description Panel */}
          {(() => {
            const flow = FLOW_PATHS[selectedFlow];
            return (
              <div className="rounded-lg border border-border/30 bg-muted/10 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: flow.color }} />
                  <span className="text-sm font-semibold text-foreground">{flow.label}</span>
                  <span className="text-[10px] text-muted-foreground ml-1">— {flow.path.length} stages</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{flow.description}</p>
                <div className="space-y-0">
                  {flow.steps.map((step, i) => {
                    const tableId = flow.path[i];
                    const table = ER_TABLES.find(t => t.id === tableId);
                    const isActive = animating && activeFlowIdx === i;
                    const isPast = animating && activeFlowIdx > i;
                    return (
                      <div key={i} className="flex items-start gap-3">
                        {/* Vertical connector line + numbered dot */}
                        <div className="flex flex-col items-center">
                          <div
                            className={`flex items-center justify-center h-6 w-6 rounded-full text-[10px] font-bold shrink-0 transition-all duration-300 ${
                              isActive
                                ? "ring-2 ring-offset-1 ring-offset-background"
                                : ""
                            }`}
                            style={{
                              background: isActive || isPast ? flow.color : "hsl(var(--muted))",
                              color: isActive || isPast ? "white" : "hsl(var(--muted-foreground))",
                              boxShadow: isActive ? `0 0 0 2px hsl(var(--background)), 0 0 0 4px ${flow.color}` : undefined,
                            }}
                          >
                            {i + 1}
                          </div>
                          {i < flow.steps.length - 1 && (
                            <div
                              className="w-0.5 h-6 transition-colors duration-300"
                              style={{ background: isPast ? flow.color : "hsl(var(--border))" }}
                            />
                          )}
                        </div>
                        {/* Step content */}
                        <div className="pt-0.5 pb-3">
                          {table && (
                            <span className="text-[10px] font-mono font-semibold" style={{ color: table.color }}>
                              {simpletonMode ? `${table.friendlyEmoji} ${table.friendlyName}` : table.label}
                            </span>
                          )}
                          <p className={`text-[11px] leading-relaxed transition-colors duration-300 ${
                            isActive ? "text-foreground font-medium" : "text-muted-foreground"
                          }`}>
                            {step}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
