import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, FileCheck, AlertTriangle, Activity, TrendingUp, TrendingDown, PackageCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { checkExportReadiness, normalizeArtifactType } from "@/lib/evidence-schema";

interface ArtifactSummary {
  entry_id: string;
  entry_title: string;
  continuity_score: number | null;
  continuity_label: string | null;
  ai_influence: number | null;
  drift_score: number | null;
  voice_score: number | null;
  confidentiality: string | null;
  status: string | null;
  last_generated: string | null;
  artifact_count: number;
  export_ready: boolean;
  has_integrity: boolean;
}

type FilterTab = "all" | "low_continuity" | "high_drift" | "high_ai" | "stale_failed";

// Threshold definitions for each metric
type ThresholdLevel = "safe" | "warn" | "critical";

interface ThresholdConfig {
  label: string;
  // Returns threshold level given a 0-1 value
  getLevel: (v: number) => ThresholdLevel;
  // Whether higher is better (true) or worse (false)
  higherIsBetter: boolean;
}

const METRIC_THRESHOLDS: Record<string, ThresholdConfig> = {
  continuity: {
    label: "Continuity",
    getLevel: (v) => v >= 0.7 ? "safe" : v >= 0.4 ? "warn" : "critical",
    higherIsBetter: true,
  },
  drift: {
    label: "Drift",
    getLevel: (v) => v < 0.3 ? "safe" : v < 0.6 ? "warn" : "critical",
    higherIsBetter: false,
  },
  voice: {
    label: "Voice",
    getLevel: (v) => v >= 0.7 ? "safe" : v >= 0.4 ? "warn" : "critical",
    higherIsBetter: true,
  },
  ai_influence: {
    label: "AI Influence",
    getLevel: (v) => v < 0.3 ? "safe" : v < 0.7 ? "warn" : "critical",
    higherIsBetter: false,
  },
};

const LEVEL_COLORS: Record<ThresholdLevel, { text: string; bg: string; border: string; dot: string }> = {
  safe: { text: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/30", dot: "bg-emerald-400" },
  warn: { text: "text-amber-400", bg: "bg-amber-500/15", border: "border-amber-500/30", dot: "bg-amber-400" },
  critical: { text: "text-red-400", bg: "bg-red-500/15", border: "border-red-500/30", dot: "bg-red-400" },
};

function MetricBar({ value, config }: { value: number; config: ThresholdConfig }) {
  const level = config.getLevel(value);
  const colors = LEVEL_COLORS[level];
  const pct = Math.min(value * 100, 100);
  return (
    <div className="flex items-center gap-1.5 min-w-[100px]">
      <div className={`relative h-2 w-14 rounded-full ${colors.bg} overflow-hidden`}>
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${colors.dot} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
        {/* Threshold markers */}
        {config.higherIsBetter ? (
          <>
            <div className="absolute inset-y-0 left-[40%] w-px bg-amber-400/40" />
            <div className="absolute inset-y-0 left-[70%] w-px bg-emerald-400/40" />
          </>
        ) : (
          <>
            <div className="absolute inset-y-0 left-[30%] w-px bg-amber-400/40" />
            <div className="absolute inset-y-0 left-[60%] w-px bg-red-400/40" />
          </>
        )}
      </div>
      <span className={`text-xs font-mono font-bold ${colors.text}`}>
        {(value * 100).toFixed(0)}%
      </span>
      {level === "critical" && <AlertTriangle className="h-3 w-3 text-red-400" />}
    </div>
  );
}

// Distribution histogram for the health summary
function DistributionBar({ buckets, total }: { buckets: { safe: number; warn: number; critical: number }; total: number }) {
  if (total === 0) return <span className="text-[10px] text-muted-foreground">No data</span>;
  const safePct = (buckets.safe / total) * 100;
  const warnPct = (buckets.warn / total) * 100;
  const critPct = (buckets.critical / total) * 100;
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex h-3 w-full rounded-full overflow-hidden bg-muted/20">
        {safePct > 0 && <div className="bg-emerald-500/70 transition-all duration-500" style={{ width: `${safePct}%` }} />}
        {warnPct > 0 && <div className="bg-amber-500/70 transition-all duration-500" style={{ width: `${warnPct}%` }} />}
        {critPct > 0 && <div className="bg-red-500/70 transition-all duration-500" style={{ width: `${critPct}%` }} />}
      </div>
      <div className="flex items-center gap-1.5 shrink-0 text-[9px] font-mono">
        <span className="text-emerald-400">{buckets.safe}</span>
        <span className="text-muted-foreground">/</span>
        <span className="text-amber-400">{buckets.warn}</span>
        <span className="text-muted-foreground">/</span>
        <span className="text-red-400">{buckets.critical}</span>
      </div>
    </div>
  );
}

function HealthSummaryWidget({ data }: { data: ArtifactSummary[] }) {
  const stats = useMemo(() => {
    const metricKeys = ["continuity", "drift", "voice", "ai_influence"] as const;
    const result: Record<string, { safe: number; warn: number; critical: number; total: number; values: number[]; avg: number }> = {};

    metricKeys.forEach((key) => {
      const config = METRIC_THRESHOLDS[key];
      const buckets = { safe: 0, warn: 0, critical: 0 };
      const values: number[] = [];

      data.forEach((row) => {
        let val: number | null = null;
        if (key === "continuity") val = row.continuity_score;
        else if (key === "drift") val = row.drift_score;
        else if (key === "voice") val = row.voice_score;
        else if (key === "ai_influence") val = row.ai_influence;

        if (val != null && !isNaN(val)) {
          values.push(val);
          const level = config.getLevel(val);
          buckets[level]++;
        }
      });

      const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      result[key] = { ...buckets, total: values.length, values, avg };
    });

    // Overall health score: percentage of all metrics that are "safe"
    const totalMetrics = Object.values(result).reduce((s, r) => s + r.total, 0);
    const totalSafe = Object.values(result).reduce((s, r) => s + r.safe, 0);
    const totalCritical = Object.values(result).reduce((s, r) => s + r.critical, 0);
    const overallHealth = totalMetrics > 0 ? totalSafe / totalMetrics : 1;

    return { metrics: result, totalMetrics, totalSafe, totalCritical, overallHealth };
  }, [data]);

  const healthLevel: ThresholdLevel = stats.overallHealth >= 0.7 ? "safe" : stats.overallHealth >= 0.4 ? "warn" : "critical";
  const healthColors = LEVEL_COLORS[healthLevel];

  return (
    <div className="rounded-xl border border-border/40 bg-card/80 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold">System Health Summary</h4>
          <Badge variant="outline" className="text-[9px] font-mono">{data.length} entries</Badge>
        </div>
      </div>

      {/* Overall health score */}
      <div className="flex items-center gap-4">
        <div className={`flex items-center justify-center h-16 w-16 rounded-2xl border-2 ${healthColors.border} ${healthColors.bg}`}>
          <span className={`text-xl font-bold font-mono ${healthColors.text}`}>
            {Math.round(stats.overallHealth * 100)}%
          </span>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">
            Overall Metric Health
            {healthLevel === "safe" && <TrendingUp className="inline h-3.5 w-3.5 ml-1.5 text-emerald-400" />}
            {healthLevel === "critical" && <TrendingDown className="inline h-3.5 w-3.5 ml-1.5 text-red-400" />}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {stats.totalSafe} safe · {stats.totalMetrics - stats.totalSafe - stats.totalCritical} warning · {stats.totalCritical} critical across {stats.totalMetrics} measurements
          </p>
        </div>
      </div>

      {/* Per-metric distributions */}
      <div className="grid grid-cols-2 gap-3">
        {Object.entries(METRIC_THRESHOLDS).map(([key, config]) => {
          const s = stats.metrics[key];
          return (
            <div key={key} className="rounded-lg border border-border/20 bg-muted/5 p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-foreground">{config.label}</span>
                <span className="text-[9px] font-mono text-muted-foreground">
                  avg {(s.avg * 100).toFixed(0)}%
                </span>
              </div>
              <DistributionBar buckets={s} total={s.total} />
              <div className="flex items-center gap-3 text-[8px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Safe</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Warn</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-red-400" /> Critical</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ArtifactMonitoringPanel() {
  const [data, setData] = useState<ArtifactSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>("all");

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data: artifacts } = await supabase
        .from("artifacts")
        .select("entry_id, artifact_type, artifact_data, created_at, status")
        .order("created_at", { ascending: false });

      const { data: entries } = await supabase
        .from("entries")
        .select("id, title");

      const entryMap = new Map((entries || []).map((e: any) => [e.id, e.title]));

      const byEntry = new Map<string, { artifacts: any[]; latest: string; worstStatus: string }>();
      (artifacts || []).forEach((a: any) => {
        const existing = byEntry.get(a.entry_id);
        if (!existing) {
          byEntry.set(a.entry_id, { artifacts: [a], latest: a.created_at, worstStatus: a.status || "ready" });
        } else {
          existing.artifacts.push(a);
          if (a.created_at > existing.latest) existing.latest = a.created_at;
          if (a.status === "failed") existing.worstStatus = "failed";
          else if (a.status === "stale" && existing.worstStatus !== "failed") existing.worstStatus = "stale";
        }
      });

      const summaries: ArtifactSummary[] = Array.from(byEntry.entries()).map(([entryId, { artifacts: arts, latest, worstStatus }]) => {
        const continuity = arts.find((a: any) => a.artifact_type === "authorship_continuity" && a.status === "ready")
          || arts.find((a: any) => a.artifact_type === "authorship_continuity");
        const influence = arts.find((a: any) => a.artifact_type === "ai_influence_map" && a.status === "ready")
          || arts.find((a: any) => a.artifact_type === "ai_influence_map");
        const confidentiality = arts.find((a: any) => a.artifact_type === "confidentiality_boundary" && a.status === "ready")
          || arts.find((a: any) => a.artifact_type === "confidentiality_boundary");
        const originality = arts.find((a: any) => a.artifact_type === "originality_distance" && a.status === "ready")
          || arts.find((a: any) => a.artifact_type === "originality_distance");

        const readiness = checkExportReadiness(
          arts.map((a: any) => ({
            status: a.status || "ready",
            artifact_hash: a.artifact_hash || "",
            artifact_type: a.artifact_type,
          }))
        );
        const hasIntegrity = arts.some((a: any) => a.version_graph_hash || a.governance_log_hash);

        return {
          entry_id: entryId,
          entry_title: entryMap.get(entryId) || "Unknown",
          continuity_score: continuity ? Number(continuity.artifact_data?.continuity_score) : null,
          continuity_label: continuity?.artifact_data?.continuity_label || null,
          ai_influence: influence ? Number(influence.artifact_data?.overall_ai_influence) : null,
          drift_score: continuity ? Number(continuity.artifact_data?.baseline_drift_score || continuity.artifact_data?.drift_score) : null,
          voice_score: originality ? Number(originality.artifact_data?.voice_stability_score) : null,
          confidentiality: confidentiality ? String(confidentiality.artifact_data?.confidentiality_mode) : null,
          status: worstStatus,
          last_generated: latest,
          artifact_count: arts.length,
          export_ready: readiness.ready,
          has_integrity: hasIntegrity,
        };
      });

      setData(summaries);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = data.filter((row) => {
    switch (filter) {
      case "low_continuity": return row.continuity_score != null && row.continuity_score < 0.4;
      case "high_drift": return row.drift_score != null && row.drift_score > 0.6;
      case "high_ai": return row.ai_influence != null && row.ai_influence > 0.7;
      case "stale_failed": return row.status === "stale" || row.status === "failed";
      default: return true;
    }
  });

  const getRowRisk = (row: ArtifactSummary): string | null => {
    if (row.status === "failed") return "bg-red-500/5";
    if (row.continuity_score != null && METRIC_THRESHOLDS.continuity.getLevel(row.continuity_score) === "critical") return "bg-red-500/5";
    if (row.ai_influence != null && METRIC_THRESHOLDS.ai_influence.getLevel(row.ai_influence) === "critical") return "bg-red-500/5";
    if (row.drift_score != null && METRIC_THRESHOLDS.drift.getLevel(row.drift_score) === "critical") return "bg-red-500/5";
    return null;
  };

  const statusBadgeClass: Record<string, string> = {
    ready: "border-emerald-500/30 text-emerald-400",
    stale: "border-amber-500/30 text-amber-400",
    failed: "border-red-500/30 text-red-400",
    generating: "border-blue-500/30 text-blue-400",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-primary" />
        <h3 className="font-display text-lg font-bold">Artifact Monitoring</h3>
        <Badge variant="outline" className="text-[9px] font-mono ml-2">{filtered.length} entries</Badge>
      </div>

      {/* Health Summary Widget */}
      {!loading && data.length > 0 && <HealthSummaryWidget data={data} />}

      {/* Threshold legend */}
      <div className="flex items-center gap-4 text-[9px] font-mono text-muted-foreground px-1">
        <span className="font-semibold text-foreground/60">Thresholds:</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Safe</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> Warning</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-400" /> Critical</span>
        <span className="text-muted-foreground/50 ml-1">· Bars show value + threshold markers</span>
      </div>

      {/* Filter tabs */}
      <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterTab)}>
        <TabsList className="h-7 bg-muted/20 p-0.5">
          <TabsTrigger value="all" className="text-[9px] font-mono px-2 py-0.5 h-6">All</TabsTrigger>
          <TabsTrigger value="low_continuity" className="text-[9px] font-mono px-2 py-0.5 h-6">Low Continuity</TabsTrigger>
          <TabsTrigger value="high_drift" className="text-[9px] font-mono px-2 py-0.5 h-6">High Drift</TabsTrigger>
          <TabsTrigger value="high_ai" className="text-[9px] font-mono px-2 py-0.5 h-6">High AI</TabsTrigger>
          <TabsTrigger value="stale_failed" className="text-[9px] font-mono px-2 py-0.5 h-6">Stale/Failed</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground rounded-lg border border-border/30 bg-card/60">
          <FileCheck className="h-4 w-4" />
          <span>{filter === "all" ? "No artifacts generated yet." : "No entries match this filter."}</span>
        </div>
      ) : (
        <div className="rounded-lg border border-border/30 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] font-mono">Project</TableHead>
                <TableHead className="text-[10px] font-mono">Continuity</TableHead>
                <TableHead className="text-[10px] font-mono">Drift</TableHead>
                <TableHead className="text-[10px] font-mono">Voice</TableHead>
                <TableHead className="text-[10px] font-mono">AI Influence</TableHead>
                <TableHead className="text-[10px] font-mono">Confidentiality</TableHead>
                <TableHead className="text-[10px] font-mono">Status</TableHead>
                <TableHead className="text-[10px] font-mono">Export</TableHead>
                <TableHead className="text-[10px] font-mono">Last Generated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.entry_id} className={getRowRisk(row) || ""}>
                  <TableCell>
                    <Link to={`/entry/${row.entry_id}`} className="text-xs text-primary hover:underline truncate max-w-[200px] block">
                      {row.entry_title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {row.continuity_score != null ? (
                      <MetricBar value={row.continuity_score} config={METRIC_THRESHOLDS.continuity} />
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {row.drift_score != null ? (
                      <MetricBar value={row.drift_score} config={METRIC_THRESHOLDS.drift} />
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {row.voice_score != null ? (
                      <MetricBar value={row.voice_score} config={METRIC_THRESHOLDS.voice} />
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {row.ai_influence != null ? (
                      <MetricBar value={row.ai_influence} config={METRIC_THRESHOLDS.ai_influence} />
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {row.confidentiality ? (
                      <Badge variant="outline" className={`text-[8px] font-mono ${row.confidentiality !== "standard" ? "border-rose-500/30 text-rose-400" : ""}`}>
                        {row.confidentiality}
                      </Badge>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {row.status ? (
                      <Badge variant="outline" className={`text-[8px] font-mono ${statusBadgeClass[row.status] || ""}`}>
                        {row.status}
                      </Badge>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {row.export_ready ? (
                        <PackageCheck className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                      )}
                      {row.has_integrity && (
                        <Badge variant="outline" className="text-[7px] font-mono px-1 py-0 h-3.5 border-primary/30 text-primary">
                          ✓ hash
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {row.last_generated ? new Date(row.last_generated).toLocaleDateString() : "—"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
