import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, AlertTriangle, Clock, DollarSign, Activity, Bell, TrendingUp, Save, Flag, GitBranch, Layers, BarChart3 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";

interface AiUsageRow {
  id: string;
  function_name: string;
  model_id: string;
  status: string;
  duration_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  estimated_cost_cents: number | null;
  correlation_id: string | null;
  error_message: string | null;
  created_at: string;
  user_id: string | null;
  entry_id: string | null;
  sensitivity: string | null;
  routing_reason: string | null;
}

const DEFAULT_THRESHOLD = 10;

async function notifyAdminsOfBreach(count: number, threshold: number) {
  // Check for existing unread notification in last 24h to dedup
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await supabase
    .from("user_notifications")
    .select("id")
    .eq("type", "warning")
    .eq("read", false)
    .gte("created_at", oneDayAgo)
    .limit(1);

  // Check metadata manually since we can't filter jsonb easily
  if (existing && existing.length > 0) {
    // Check if any have the right title pattern
    const { data: dupeCheck } = await supabase
      .from("user_notifications")
      .select("id")
      .eq("type", "warning")
      .eq("read", false)
      .eq("title", "Governance Alert: Sensitivity Threshold Breached")
      .gte("created_at", oneDayAgo)
      .limit(1);
    if (dupeCheck && dupeCheck.length > 0) return; // Already notified recently
  }

  // Get all admin user IDs
  const { data: admins } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin");

  if (!admins || admins.length === 0) return;

  const notifications = admins.map((admin) => ({
    user_id: admin.user_id,
    title: "Governance Alert: Sensitivity Threshold Breached",
    message: `${count} sensitivity upgrades detected in the last 7 days, exceeding the configured threshold of ${threshold}. Review routing patterns for potential misconfiguration.`,
    type: "warning",
    metadata: { alert_type: "sensitivity_threshold_breach", count, threshold },
  }));

  await supabase.from("user_notifications").insert(notifications);
}

const ROUTING_COLORS: Record<string, string> = {
  sensitivity_upgrade: "hsl(var(--destructive))",
  cost_optimization: "hsl(var(--primary))",
  model_retired: "hsl(var(--accent-foreground))",
  policy_blocked: "hsl(0 84% 60%)",
  default: "hsl(var(--muted-foreground))",
};

function RoutingDecisionChart({ rows }: { rows: AiUsageRow[] }) {
  const chartData = useMemo(() => {
    // Group by day and routing_reason
    const dayMap = new Map<string, Record<string, number>>();
    const allReasons = new Set<string>();

    for (const row of rows) {
      const day = row.created_at.slice(0, 10);
      const reason = row.routing_reason || "none";
      allReasons.add(reason);
      if (!dayMap.has(day)) dayMap.set(day, {});
      const bucket = dayMap.get(day)!;
      bucket[reason] = (bucket[reason] || 0) + 1;
    }

    const sorted = [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return {
      data: sorted.map(([day, counts]) => ({ day: day.slice(5), ...counts })),
      reasons: [...allReasons].sort(),
    };
  }, [rows]);

  if (chartData.data.length === 0) return null;

  return (
    <Card className="border-border/30 bg-card/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-mono flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          Routing Decision Distribution
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData.data} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="day" tick={{ fontSize: 10, fontFamily: "monospace" }} stroke="hsl(var(--muted-foreground))" />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fontFamily: "monospace" }} stroke="hsl(var(--muted-foreground))" width={30} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11, fontFamily: "monospace" }}
                labelStyle={{ color: "hsl(var(--foreground))" }}
              />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
              {chartData.reasons.map((reason) => (
                <Bar
                  key={reason}
                  dataKey={reason}
                  stackId="routing"
                  fill={ROUTING_COLORS[reason] || `hsl(${(reason.length * 47) % 360} 60% 55%)`}
                  name={reason.replace(/_/g, " ")}
                  radius={[2, 2, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export default function GovernanceAuditPanel() {
  const [rows, setRows] = useState<AiUsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [functionFilter, setFunctionFilter] = useState("all");
  const [routingFilter, setRoutingFilter] = useState("all");
  const [correlationSearch, setCorrelationSearch] = useState("");
  const [errorOnly, setErrorOnly] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [alertData, setAlertData] = useState<{ count: number; dismissed: boolean }>({ count: 0, dismissed: false });
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [thresholdInput, setThresholdInput] = useState(String(DEFAULT_THRESHOLD));
  const [savingThreshold, setSavingThreshold] = useState(false);
  const notifiedRef = useRef(false);
  const [activeTab, setActiveTab] = useState("events");
  const [flaggedEntries, setFlaggedEntries] = useState<any[]>([]);
  const [govEvents, setGovEvents] = useState<any[]>([]);
  const [provenanceStats, setProvenanceStats] = useState<{ withProvenance: number; total: number }>({ withProvenance: 0, total: 0 });
  const { toast } = useToast();

  const fetchAlert = useCallback(async () => {
    // Fetch threshold from site_settings
    const { data: settingRow } = await supabase
      .from("site_settings" as any)
      .select("text_value")
      .eq("key", "sensitivity_alert_threshold")
      .single();
    const configuredThreshold = parseInt((settingRow as any)?.text_value, 10) || DEFAULT_THRESHOLD;
    setThreshold(configuredThreshold);
    setThresholdInput(String(configuredThreshold));

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("ai_usage_log")
      .select("*", { count: "exact", head: true })
      .eq("routing_reason", "sensitivity_upgrade")
      .gte("created_at", sevenDaysAgo);
    const c = count ?? 0;
    setAlertData((prev) => ({ ...prev, count: c }));
    if (c > configuredThreshold) {
      toast({
        title: "Governance Alert",
        description: `${c} sensitivity upgrades in the last 7 days (threshold: ${configuredThreshold})`,
        variant: "destructive",
      });
      // Send persistent admin notifications (once per session)
      if (!notifiedRef.current) {
        notifiedRef.current = true;
        notifyAdminsOfBreach(c, configuredThreshold);
      }
    }
  }, [toast]);

  const saveThreshold = async () => {
    const val = parseInt(thresholdInput, 10);
    if (isNaN(val) || val < 1) {
      toast({ title: "Invalid threshold", description: "Must be a positive number.", variant: "destructive" });
      return;
    }
    setSavingThreshold(true);
    await supabase
      .from("site_settings" as any)
      .update({ text_value: String(val) } as any)
      .eq("key", "sensitivity_alert_threshold");
    setThreshold(val);
    setSavingThreshold(false);
    toast({ title: "Threshold updated", description: `Sensitivity alert threshold set to ${val}.` });
  };

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("ai_usage_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    setRows((data as AiUsageRow[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRows();
    fetchAlert();
    fetchFlagged();
    fetchGovEvents();
    fetchProvenanceStats();
  }, [fetchRows, fetchAlert]);

  const fetchFlagged = async () => {
    const { data } = await supabase
      .from("influence_scores")
      .select("entry_id, semantic_drift_score, voice_stability_score, ai_influence_score, created_at")
      .or("semantic_drift_score.gt.0.7,voice_stability_score.lt.0.3,ai_influence_score.gt.0.8")
      .order("created_at", { ascending: false })
      .limit(50);
    setFlaggedEntries(data || []);
  };

  const fetchGovEvents = async () => {
    const { data } = await supabase
      .from("governance_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    setGovEvents(data || []);
  };

  const fetchProvenanceStats = async () => {
    const [{ count: totalCount }, { data: withProv }] = await Promise.all([
      supabase.from("entries").select("*", { count: "exact", head: true }),
      supabase.from("provenance_nodes").select("entry_id").limit(1000),
    ]);
    const uniqueEntries = new Set((withProv || []).map((r: any) => r.entry_id));
    setProvenanceStats({ withProvenance: uniqueEntries.size, total: totalCount || 0 });
  };

  // Realtime subscription for new entries
  useEffect(() => {
    const channel = supabase
      .channel("governance-audit-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ai_usage_log" },
        (payload) => {
          const newRow = payload.new as AiUsageRow;
          setRows((prev) => [newRow, ...prev].slice(0, 200));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const uniqueFunctions = useMemo(
    () => [...new Set(rows.map((r) => r.function_name))].sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (functionFilter !== "all" && r.function_name !== functionFilter) return false;
      if (routingFilter !== "all") {
        if (routingFilter === "none" && r.routing_reason) return false;
        if (routingFilter !== "none" && r.routing_reason !== routingFilter) return false;
      }
      if (correlationSearch && !(r.correlation_id || "").startsWith(correlationSearch)) return false;
      if (errorOnly && !r.error_message) return false;
      return true;
    });
  }, [rows, statusFilter, functionFilter, routingFilter, correlationSearch, errorOnly]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const errors = filtered.filter((r) => r.status === "error").length;
    const durations = filtered.filter((r) => r.duration_ms != null).map((r) => r.duration_ms!);
    const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    const totalCost = filtered.reduce((sum, r) => sum + (Number(r.estimated_cost_cents) || 0), 0);
    return {
      total,
      errorRate: total > 0 ? ((errors / total) * 100).toFixed(1) : "0.0",
      avgDuration,
      totalCost: (totalCost / 100).toFixed(2),
    };
  }, [filtered]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Governance Alert Banner */}
      {alertData.count > threshold && !alertData.dismissed && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-destructive/40 bg-destructive/10 animate-in fade-in">
          <Bell className="h-4 w-4 text-destructive shrink-0" />
          <div className="flex-1">
            <span className="text-sm font-semibold text-destructive">Governance Alert</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              <TrendingUp className="h-3 w-3 inline mr-1" />
              {alertData.count} sensitivity upgrades in the last 7 days — exceeds threshold of {threshold}.
              Review routing patterns for potential misconfiguration.
            </p>
            <div className="flex items-center gap-2 mt-2">
              <label className="text-xs font-mono text-muted-foreground">Threshold:</label>
              <Input
                type="number"
                min={1}
                className="w-20 h-7 text-xs font-mono"
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
              />
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={saveThreshold} disabled={savingThreshold}>
                <Save className="h-3 w-3" />
                {savingThreshold ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
          <button
            onClick={() => setAlertData((prev) => ({ ...prev, dismissed: true }))}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: Activity, label: "Total Calls", value: String(stats.total) },
          { icon: AlertTriangle, label: "Error Rate", value: `${stats.errorRate}%` },
          { icon: Clock, label: "Avg Duration", value: `${stats.avgDuration}ms` },
          { icon: DollarSign, label: "Total Cost", value: `$${stats.totalCost}` },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-2.5 px-4 py-3 rounded-lg border border-border/30 bg-card/60">
            <s.icon className="h-4 w-4 text-primary shrink-0" />
            <span className="text-xs font-mono text-muted-foreground">{s.label}</span>
            <span className="ml-auto font-display text-sm font-bold">{s.value}</span>
          </div>
        ))}
      </div>

      {/* Routing Decision Summary Chart */}
      <RoutingDecisionChart rows={rows} />

      {/* Tabbed governance sections */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-4 h-9">
          <TabsTrigger value="events" className="text-xs gap-1"><Shield className="h-3 w-3" /> Events</TabsTrigger>
          <TabsTrigger value="correlation" className="text-xs gap-1"><Layers className="h-3 w-3" /> Correlation</TabsTrigger>
          <TabsTrigger value="flags" className="text-xs gap-1"><Flag className="h-3 w-3" /> Flags ({flaggedEntries.length})</TabsTrigger>
          <TabsTrigger value="provenance" className="text-xs gap-1"><GitBranch className="h-3 w-3" /> Provenance</TabsTrigger>
        </TabsList>

        <TabsContent value="events" className="space-y-4 mt-3">{renderEventsTab()}</TabsContent>
        <TabsContent value="correlation" className="mt-3">{renderCorrelationTab()}</TabsContent>
        <TabsContent value="flags" className="mt-3">{renderFlagsTab()}</TabsContent>
        <TabsContent value="provenance" className="mt-3">{renderProvenanceTab()}</TabsContent>
      </Tabs>
    </div>
  );

  function renderCorrelationTab() {
    // Group filtered rows by correlation_id
    const groups = new Map<string, AiUsageRow[]>();
    const ungrouped: AiUsageRow[] = [];
    for (const row of filtered) {
      if (row.correlation_id) {
        const list = groups.get(row.correlation_id) || [];
        list.push(row);
        groups.set(row.correlation_id, list);
      } else {
        ungrouped.push(row);
      }
    }
    // Sort groups by earliest created_at descending
    const sortedGroups = [...groups.entries()].sort(
      (a, b) => new Date(b[1][0].created_at).getTime() - new Date(a[1][0].created_at).getTime()
    );

    if (sortedGroups.length === 0) {
      return <p className="text-sm text-muted-foreground py-8 text-center">No correlated function calls found in current results.</p>;
    }

    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {sortedGroups.length} correlation group{sortedGroups.length !== 1 ? "s" : ""} · {ungrouped.length} ungrouped call{ungrouped.length !== 1 ? "s" : ""}
        </p>
        {sortedGroups.map(([corrId, items]) => {
          const hasError = items.some((r) => r.status === "error");
          const totalCost = items.reduce((sum, r) => sum + (Number(r.estimated_cost_cents) || 0), 0);
          const totalTokens = items.reduce((sum, r) => sum + (r.prompt_tokens || 0) + (r.completion_tokens || 0), 0);
          return (
            <Collapsible key={corrId}>
              <CollapsibleTrigger className="w-full">
                <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-colors hover:bg-accent/50 ${hasError ? "border-destructive/30 bg-destructive/5" : "border-border/30 bg-card/60"}`}>
                  <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs font-mono text-muted-foreground">{corrId.slice(0, 12)}…</span>
                  <Badge variant="outline" className="text-[10px] font-mono">{items.length} call{items.length !== 1 ? "s" : ""}</Badge>
                  {hasError && <Badge variant="destructive" className="text-[10px]">has errors</Badge>}
                  <span className="ml-auto text-xs font-mono text-muted-foreground">{totalTokens} tok · ${(totalCost / 100).toFixed(3)}</span>
                  <span className="text-xs font-mono text-muted-foreground">{new Date(items[0].created_at).toLocaleString()}</span>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="ml-4 border-l-2 border-border/30 pl-3 py-1 space-y-1">
                  {items.map((row) => (
                    <div key={row.id} className="flex items-center gap-2 px-3 py-2 rounded text-xs font-mono bg-muted/30">
                      <Badge
                        variant={row.status === "error" ? "destructive" : "default"}
                        className="text-[9px] px-1.5 py-0 shrink-0"
                      >
                        {row.status}
                      </Badge>
                      <span className="truncate max-w-[140px]">{row.function_name}</span>
                      <span className="text-muted-foreground truncate max-w-[120px]">{row.model_id}</span>
                      <span className="text-muted-foreground">{row.duration_ms != null ? `${row.duration_ms}ms` : "—"}</span>
                      {row.routing_reason && (
                        <Badge variant="outline" className="text-[9px] font-mono">{row.routing_reason.replace(/_/g, " ")}</Badge>
                      )}
                      {row.error_message && (
                        <span className="text-destructive truncate max-w-[200px]" title={row.error_message}>{row.error_message}</span>
                      )}
                      <span className="ml-auto text-muted-foreground whitespace-nowrap">
                        {new Date(row.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    );
  }

  function renderFlagsTab() {
    if (flaggedEntries.length === 0) {
      return <p className="text-sm text-muted-foreground py-8 text-center">No flagged entries. All influence scores are within normal ranges.</p>;
    }
    return (
      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-mono text-xs">Entry ID</TableHead>
                  <TableHead className="font-mono text-xs text-right">Semantic Drift</TableHead>
                  <TableHead className="font-mono text-xs text-right">Voice Stability</TableHead>
                  <TableHead className="font-mono text-xs text-right">AI Influence</TableHead>
                  <TableHead className="font-mono text-xs">Flags</TableHead>
                  <TableHead className="font-mono text-xs">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flaggedEntries.map((row: any) => {
                  const drift = Number(row.semantic_drift_score) || 0;
                  const voice = Number(row.voice_stability_score) || 0;
                  const influence = Number(row.ai_influence_score) || 0;
                  return (
                    <TableRow key={row.entry_id + row.created_at}>
                      <TableCell className="text-xs font-mono">{String(row.entry_id).slice(0, 8)}…</TableCell>
                      <TableCell className={`text-xs font-mono text-right ${drift > 0.7 ? "text-destructive font-bold" : ""}`}>
                        {(drift * 100).toFixed(1)}%
                      </TableCell>
                      <TableCell className={`text-xs font-mono text-right ${voice < 0.3 ? "text-destructive font-bold" : ""}`}>
                        {(voice * 100).toFixed(1)}%
                      </TableCell>
                      <TableCell className={`text-xs font-mono text-right ${influence > 0.8 ? "text-destructive font-bold" : ""}`}>
                        {(influence * 100).toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="flex gap-1">
                          {drift > 0.7 && <Badge variant="destructive" className="text-[9px] px-1">high drift</Badge>}
                          {voice < 0.3 && <Badge variant="destructive" className="text-[9px] px-1">low voice</Badge>}
                          {influence > 0.8 && <Badge variant="destructive" className="text-[9px] px-1">high AI</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {new Date(row.created_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    );
  }

  function renderProvenanceTab() {
    const pct = provenanceStats.total > 0 ? Math.round((provenanceStats.withProvenance / provenanceStats.total) * 100) : 0;
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-mono">Provenance Coverage</span>
              <span className="text-sm font-mono font-bold">{pct}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div className={`h-full rounded-full ${pct >= 80 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-destructive"}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {provenanceStats.withProvenance} of {provenanceStats.total} entries have provenance chains.
            </p>
          </CardContent>
        </Card>

        {govEvents.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono">Recent Governance Events</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[300px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="font-mono text-xs">Time</TableHead>
                      <TableHead className="font-mono text-xs">Event</TableHead>
                      <TableHead className="font-mono text-xs">Model</TableHead>
                      <TableHead className="font-mono text-xs">Status</TableHead>
                      <TableHead className="font-mono text-xs">Privacy</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {govEvents.slice(0, 50).map((evt: any) => (
                      <TableRow key={evt.id}>
                        <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                          {new Date(evt.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[9px] font-mono">
                            {evt.event_type.replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground truncate max-w-[120px]">
                          {evt.model_name ? evt.model_name.split("/").pop() : "—"}
                        </TableCell>
                        <TableCell className="text-xs font-mono">{evt.event_status}</TableCell>
                        <TableCell className="text-xs">
                          {evt.privacy_mode && evt.privacy_mode !== "standard" ? (
                            <Badge variant="outline" className="text-[9px] font-mono bg-violet-500/10 text-violet-400 border-violet-500/30">
                              {evt.privacy_mode}
                            </Badge>
                          ) : <span className="text-muted-foreground font-mono">—</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  function renderEventsTab() {
    return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Shield className="h-4 w-4" /> Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs font-mono text-muted-foreground">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-mono text-muted-foreground">Function</label>
              <Select value={functionFilter} onValueChange={setFunctionFilter}>
                <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Functions</SelectItem>
                  {uniqueFunctions.map((fn) => (
                    <SelectItem key={fn} value={fn}>{fn}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-mono text-muted-foreground">Routing</label>
              <Select value={routingFilter} onValueChange={setRoutingFilter}>
                <SelectTrigger className="w-[170px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Routing</SelectItem>
                  <SelectItem value="none">Default (no override)</SelectItem>
                  <SelectItem value="sensitivity_upgrade">Sensitivity Upgrade</SelectItem>
                  <SelectItem value="cost_downgrade">Cost Downgrade</SelectItem>
                  <SelectItem value="admin_override">Admin Override</SelectItem>
                  <SelectItem value="competition_config">Competition Config</SelectItem>
                  <SelectItem value="policy_blocked">Policy Blocked</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-mono text-muted-foreground">Correlation ID</label>
              <Input
                className="w-[260px] h-8 text-xs font-mono"
                placeholder="Search by correlation ID…"
                value={correlationSearch}
                onChange={(e) => setCorrelationSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 pb-0.5">
              <Switch checked={errorOnly} onCheckedChange={setErrorOnly} />
              <label className="text-xs font-mono text-muted-foreground">Errors only</label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-mono text-xs">Timestamp</TableHead>
                  <TableHead className="font-mono text-xs">Function</TableHead>
                  <TableHead className="font-mono text-xs">Model</TableHead>
                  <TableHead className="font-mono text-xs">Status</TableHead>
                  <TableHead className="font-mono text-xs text-right">Duration</TableHead>
                  <TableHead className="font-mono text-xs text-right">Tokens</TableHead>
                  <TableHead className="font-mono text-xs text-right">Cost</TableHead>
                  <TableHead className="font-mono text-xs">Sensitivity</TableHead>
                  <TableHead className="font-mono text-xs text-right">Pages</TableHead>
                  <TableHead className="font-mono text-xs">Routing</TableHead>
                  <TableHead className="font-mono text-xs">Correlation ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-8">
                      No matching audit log entries.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((row) => (
                    <>
                      <TableRow
                        key={row.id}
                        className={`cursor-pointer ${row.error_message ? "hover:bg-destructive/5" : ""}`}
                        onClick={() => setExpandedRow(expandedRow === row.id ? null : row.id)}
                      >
                        <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                          {new Date(row.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-xs font-mono">{row.function_name}</TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground max-w-[140px] truncate">
                          {row.model_id}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={row.status === "error" ? "destructive" : "default"}
                            className="text-[10px] px-1.5 py-0"
                          >
                            {row.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-mono text-right">
                          {row.duration_ms != null ? `${row.duration_ms}ms` : "—"}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-right">
                          {(row.prompt_tokens || 0) + (row.completion_tokens || 0)}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-right">
                          {row.estimated_cost_cents != null
                            ? `$${(Number(row.estimated_cost_cents) / 100).toFixed(3)}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.sensitivity && row.sensitivity !== "standard" ? (
                            <Badge variant="outline" className="text-[10px] font-mono bg-violet-500/10 text-violet-400 border-violet-500/30">
                              {row.sensitivity}
                            </Badge>
                          ) : <span className="text-muted-foreground font-mono">standard</span>}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-right">
                          {(row as any).page_count ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.routing_reason ? (
                            <Badge variant="outline" className={`text-[10px] font-mono ${
                              row.routing_reason === "sensitivity_upgrade" ? "bg-violet-500/10 text-violet-400 border-violet-500/30" :
                              row.routing_reason === "cost_downgrade" ? "bg-amber-500/10 text-amber-400 border-amber-500/30" :
                              row.routing_reason === "admin_override" ? "bg-blue-500/10 text-blue-400 border-blue-500/30" :
                              row.routing_reason === "competition_config" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
                              row.routing_reason === "policy_blocked" ? "bg-red-500/10 text-red-400 border-red-500/30" :
                              "bg-muted text-muted-foreground"
                            }`}>
                              {row.routing_reason.replace(/_/g, " ")}
                            </Badge>
                          ) : <span className="text-muted-foreground font-mono">—</span>}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground max-w-[120px] truncate">
                          {row.correlation_id ? row.correlation_id.slice(0, 8) + "…" : "—"}
                        </TableCell>
                      </TableRow>
                      {expandedRow === row.id && row.error_message && (
                        <TableRow key={`${row.id}-error`}>
                          <TableCell colSpan={11} className="bg-destructive/5 border-l-2 border-destructive">
                            <div className="text-xs font-mono space-y-1">
                              <p className="font-semibold text-destructive">Error Message:</p>
                              <p className="text-muted-foreground whitespace-pre-wrap">{row.error_message}</p>
                              {row.correlation_id && (
                                <p className="text-muted-foreground">
                                  <span className="text-foreground">Full Correlation ID:</span> {row.correlation_id}
                                </p>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        Showing {filtered.length} of {rows.length} entries (max 200 loaded)
      </p>
    </div>
    );
  }
}
