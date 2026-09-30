import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  LineChart, Line,
} from "recharts";
import { RefreshCw, Shield, Award, AlertTriangle, TrendingUp, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface DrillEntry {
  submission_id: string;
  entry_id: string | null;
  project_title: string;
  writer_name: string | null;
  user_id: string;
  competition_id: string | null;
  competition_name: string | null;
  created_at: string;
  ai_used: boolean | null;
  human_revision_level: number | null;
  risk_band: string | null;
  authorship_integrity_score: number | null;
  originality_score: number | null;
  provenance_score: number | null;
  market_substitution_risk: number | null;
  has_certificate: boolean;
  certificate_number: string | null;
}

interface RiskRow { risk_band: string; count: number }
interface TrendRow {
  bucket: string; runs: number;
  avg_integrity: number | null;
  avg_originality: number | null;
  avg_provenance: number | null;
  avg_substitution_risk: number | null;
}
interface CertRow {
  competition_id: string | null;
  competition_name: string | null;
  scored_count: number;
  certificate_count: number;
  issuance_rate: number;
  last_issued_at: string | null;
}
interface ModeTrendRow {
  bucket: string;
  mode: "human_only" | "hybrid" | "ai_only";
  runs: number;
  avg_integrity: number | null;
  avg_originality: number | null;
  avg_provenance: number | null;
  avg_substitution_risk: number | null;
}

const MODE_META: Record<string, { label: string; color: string }> = {
  human_only: { label: "Human only", color: "hsl(152 60% 50%)" },
  hybrid:     { label: "Hybrid",     color: "hsl(40 90% 55%)" },
  ai_only:    { label: "AI only",    color: "hsl(0 80% 60%)" },
};

const METRIC_OPTIONS = [
  { value: "avg_integrity",          label: "Integrity" },
  { value: "avg_originality",        label: "Originality" },
  { value: "avg_provenance",         label: "Provenance" },
  { value: "avg_substitution_risk",  label: "Substitution Risk" },
] as const;
type MetricKey = typeof METRIC_OPTIONS[number]["value"];

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last year" },
];

const RISK_COLORS: Record<string, string> = {
  low: "hsl(152 60% 50%)",
  moderate: "hsl(40 90% 55%)",
  high: "hsl(20 85% 55%)",
  critical: "hsl(0 80% 55%)",
  unknown: "hsl(220 10% 50%)",
};

const RISK_ORDER = ["low", "moderate", "high", "critical", "unknown"];

export default function ShieldAnalyticsPanel() {
  const [days, setDays] = useState("30");
  const [competitionId, setCompetitionId] = useState<string>("all");
  const [competitions, setCompetitions] = useState<Array<{ id: string; name: string }>>([]);
  const [risk, setRisk] = useState<RiskRow[]>([]);
  const [trends, setTrends] = useState<TrendRow[]>([]);
  const [certs, setCerts] = useState<CertRow[]>([]);
  const [modeTrends, setModeTrends] = useState<ModeTrendRow[]>([]);
  const [modeMetric, setModeMetric] = useState<MetricKey>("avg_substitution_risk");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Drill-down state
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillMode, setDrillMode] = useState<"human_only" | "hybrid" | "ai_only" | null>(null);
  const [drillEntries, setDrillEntries] = useState<DrillEntry[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  async function openDrill(mode: "human_only" | "hybrid" | "ai_only") {
    setDrillMode(mode);
    setDrillOpen(true);
    setDrillLoading(true);
    setDrillEntries([]);
    const cid = competitionId === "all" ? null : competitionId;
    const { data, error } = await (supabase as any).rpc("admin_shield_entries_by_mode", {
      _competition_id: cid,
      _days: parseInt(days, 10),
      _mode: mode,
    });
    if (error) toast.error(`Drill-down: ${error.message}`);
    setDrillEntries((data || []) as DrillEntry[]);
    setDrillLoading(false);
  }

  async function loadCompetitions() {
    const { data } = await supabase
      .from("competitions")
      .select("id, name")
      .order("name");
    setCompetitions(data || []);
  }

  async function load() {
    setRefreshing(true);
    const cid = competitionId === "all" ? null : competitionId;
    const d = parseInt(days, 10);
    const [riskRes, trendsRes, certsRes, modeRes] = await Promise.all([
      (supabase as any).rpc("admin_shield_risk_distribution", { _competition_id: cid, _days: d }),
      (supabase as any).rpc("admin_shield_score_trends", { _competition_id: cid, _days: d }),
      (supabase as any).rpc("admin_shield_certificates_by_competition", { _days: d }),
      (supabase as any).rpc("admin_shield_score_trends_by_mode", { _competition_id: cid, _days: d }),
    ]);
    if (riskRes.error) toast.error(`Risk: ${riskRes.error.message}`);
    if (trendsRes.error) toast.error(`Trends: ${trendsRes.error.message}`);
    if (certsRes.error) toast.error(`Certs: ${certsRes.error.message}`);
    if (modeRes.error) toast.error(`Mode trends: ${modeRes.error.message}`);
    setRisk((riskRes.data || []) as RiskRow[]);
    setTrends((trendsRes.data || []) as TrendRow[]);
    setCerts((certsRes.data || []) as CertRow[]);
    setModeTrends((modeRes.data || []) as ModeTrendRow[]);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { loadCompetitions(); }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [days, competitionId]);

  // KPIs
  const kpis = useMemo(() => {
    const totalScored = risk.reduce((s, r) => s + Number(r.count || 0), 0);
    const highCrit = risk
      .filter((r) => r.risk_band === "high" || r.risk_band === "critical")
      .reduce((s, r) => s + Number(r.count || 0), 0);
    const totalCerts = certs.reduce((s, c) => s + Number(c.certificate_count || 0), 0);
    const issuance = totalScored > 0 ? (totalCerts / totalScored) * 100 : 0;
    const highShare = totalScored > 0 ? (highCrit / totalScored) * 100 : 0;
    return { totalScored, totalCerts, issuance, highShare };
  }, [risk, certs]);

  const riskChartData = useMemo(() => {
    const map = new Map(risk.map((r) => [r.risk_band, Number(r.count || 0)]));
    return RISK_ORDER
      .filter((b) => map.has(b))
      .map((band) => ({ band, count: map.get(band) || 0, fill: RISK_COLORS[band] }));
  }, [risk]);

  const trendChartData = useMemo(() => trends.map((t) => ({
    bucket: t.bucket,
    Integrity: t.avg_integrity != null ? Number(t.avg_integrity) : null,
    Originality: t.avg_originality != null ? Number(t.avg_originality) : null,
    Provenance: t.avg_provenance != null ? Number(t.avg_provenance) : null,
    "Substitution Risk": t.avg_substitution_risk != null ? Number(t.avg_substitution_risk) : null,
    Runs: Number(t.runs || 0),
  })), [trends]);

  // Pivot mode trends into one row per bucket with one series per mode for selected metric
  const modeChartData = useMemo(() => {
    const buckets = new Map<string, any>();
    for (const row of modeTrends) {
      if (!buckets.has(row.bucket)) buckets.set(row.bucket, { bucket: row.bucket });
      const v = (row as any)[modeMetric];
      buckets.get(row.bucket)[MODE_META[row.mode]?.label || row.mode] = v != null ? Number(v) : null;
    }
    return Array.from(buckets.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));
  }, [modeTrends, modeMetric]);

  const modeTotals = useMemo(() => {
    const t: Record<string, { runs: number; sum: number; n: number }> = {
      human_only: { runs: 0, sum: 0, n: 0 },
      hybrid:     { runs: 0, sum: 0, n: 0 },
      ai_only:    { runs: 0, sum: 0, n: 0 },
    };
    for (const r of modeTrends) {
      if (!t[r.mode]) continue;
      t[r.mode].runs += Number(r.runs || 0);
      const v = (r as any)[modeMetric];
      if (v != null) { t[r.mode].sum += Number(v) * Number(r.runs || 0); t[r.mode].n += Number(r.runs || 0); }
    }
    return t;
  }, [modeTrends, modeMetric]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full max-w-md" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={competitionId} onValueChange={setCompetitionId}>
          <SelectTrigger className="w-[260px]">
            <SelectValue placeholder="All competitions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All competitions</SelectItem>
            {competitions.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={load} disabled={refreshing}>
          <RefreshCw className={`h-3 w-3 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Shield} label="Scored entries" value={kpis.totalScored.toLocaleString()} />
        <Kpi icon={Award} label="Certificates issued" value={kpis.totalCerts.toLocaleString()} />
        <Kpi icon={TrendingUp} label="Issuance rate" value={`${kpis.issuance.toFixed(1)}%`} />
        <Kpi icon={AlertTriangle} label="High / critical risk"
          value={`${kpis.highShare.toFixed(1)}%`}
          accent={kpis.highShare > 25 ? "amber" : undefined} />
      </div>

      {/* Risk distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase tracking-wider">Risk distribution</CardTitle>
        </CardHeader>
        <CardContent>
          {riskChartData.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No scored entries in this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={riskChartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="band" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip cursor={{ fill: "hsl(var(--muted) / 0.3)" }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            {riskChartData.map((d) => (
              <Badge key={d.band} variant="outline" className="font-mono text-[10px] capitalize">
                <span className="w-2 h-2 rounded-full mr-1.5" style={{ background: d.fill }} />
                {d.band}: {d.count}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Score trends */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase tracking-wider">Score trends</CardTitle>
        </CardHeader>
        <CardContent>
          {trendChartData.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No trend data in this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trendChartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="Integrity" stroke="hsl(152 60% 50%)" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="Originality" stroke="hsl(200 80% 60%)" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="Provenance" stroke="hsl(260 70% 65%)" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="Substitution Risk" stroke="hsl(0 80% 60%)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Score trends by authorship mode */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-sm font-mono uppercase tracking-wider">Trends by authorship mode</CardTitle>
          <Select value={modeMetric} onValueChange={(v) => setModeMetric(v as MetricKey)}>
            <SelectTrigger className="w-[200px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METRIC_OPTIONS.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {modeChartData.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No mode-segmented data in this range.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={modeChartData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend
                    wrapperStyle={{ fontSize: 11, cursor: "pointer" }}
                    onClick={(e: any) => {
                      const entry = Object.entries(MODE_META).find(([, v]) => v.label === e?.dataKey || v.label === e?.value);
                      if (entry) openDrill(entry[0] as any);
                    }}
                  />
                  {(["human_only", "hybrid", "ai_only"] as const).map((m) => (
                    <Line
                      key={m}
                      type="monotone"
                      dataKey={MODE_META[m].label}
                      stroke={MODE_META[m].color}
                      strokeWidth={2}
                      dot={{ r: 3, cursor: "pointer" }}
                      activeDot={{ r: 5, cursor: "pointer", onClick: () => openDrill(m) }}
                      connectNulls
                      style={{ cursor: "pointer" }}
                      onClick={() => openDrill(m)}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-3 gap-2 mt-3">
                {(["human_only", "hybrid", "ai_only"] as const).map((m) => {
                  const t = modeTotals[m];
                  const avg = t.n > 0 ? t.sum / t.n : null;
                  return (
                    <button
                      key={m}
                      onClick={() => openDrill(m)}
                      className="text-left rounded-md border border-border/40 bg-background/30 p-2 hover:bg-background/60 hover:border-primary/40 transition-colors"
                      title={`Open ${MODE_META[m].label} drill-down`}
                    >
                      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                        <span className="w-2 h-2 rounded-full" style={{ background: MODE_META[m].color }} />
                        {MODE_META[m].label}
                        <ExternalLink className="h-2.5 w-2.5 ml-auto opacity-60" />
                      </div>
                      <div className="font-display text-lg font-bold mt-0.5">
                        {avg != null ? avg.toFixed(1) : "—"}
                        <span className="text-[10px] font-mono text-muted-foreground ml-1.5">
                          · {t.runs} run{t.runs === 1 ? "" : "s"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] font-mono text-muted-foreground mt-2">
                Click a line, dot, legend, or summary card to drill into entries for that mode.
                Mode derived from submission flags: <span className="text-foreground">human_only</span> = ai_used=false,
                {" "}<span className="text-foreground">hybrid</span> = ai_used + human_revision_level ≥ 2,
                {" "}<span className="text-foreground">ai_only</span> = ai_used with little/no human revision.
              </p>
            </>
          )}
        </CardContent>
      </Card>


      {/* Certificates by competition */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase tracking-wider">Certificates by competition</CardTitle>
        </CardHeader>
        <CardContent>
          {certs.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No activity in this range.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Competition</TableHead>
                  <TableHead className="text-right">Scored</TableHead>
                  <TableHead className="text-right">Certified</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Last issued</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {certs.map((c, i) => (
                  <TableRow key={(c.competition_id || "none") + i}>
                    <TableCell className="font-mono text-xs">
                      {c.competition_name || <span className="text-muted-foreground italic">Portfolio / standalone</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono">{c.scored_count}</TableCell>
                    <TableCell className="text-right font-mono">{c.certificate_count}</TableCell>
                    <TableCell className="text-right font-mono">{Number(c.issuance_rate || 0).toFixed(1)}%</TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {c.last_issued_at ? new Date(c.last_issued_at).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Mode drill-down dialog */}
      <Dialog open={drillOpen} onOpenChange={setDrillOpen}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: drillMode ? MODE_META[drillMode].color : "transparent" }}
              />
              {drillMode ? MODE_META[drillMode].label : "Mode"} entries
              <Badge variant="outline" className="font-mono text-[10px] ml-2">
                {competitionId === "all"
                  ? "All competitions"
                  : competitions.find((c) => c.id === competitionId)?.name || "Competition"}
              </Badge>
              <Badge variant="outline" className="font-mono text-[10px]">
                Last {days} days
              </Badge>
            </DialogTitle>
            <DialogDescription>
              Underlying Shield submissions for this authorship mode, most recent first (max 500).
            </DialogDescription>
          </DialogHeader>

          {drillLoading ? (
            <div className="space-y-2 py-4">
              {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : drillEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground italic py-6 text-center">
              No entries match this mode in the current filters.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Competition</TableHead>
                  <TableHead className="text-right">Risk</TableHead>
                  <TableHead className="text-right">Integrity</TableHead>
                  <TableHead className="text-right">Originality</TableHead>
                  <TableHead className="text-right">Provenance</TableHead>
                  <TableHead className="text-right">Sub. Risk</TableHead>
                  <TableHead className="text-right">Cert</TableHead>
                  <TableHead className="text-right">When</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drillEntries.map((e) => (
                  <TableRow key={e.submission_id}>
                    <TableCell className="font-mono text-xs max-w-[220px]">
                      <div className="truncate" title={e.project_title}>{e.project_title}</div>
                      {e.writer_name && (
                        <div className="text-[10px] text-muted-foreground truncate">{e.writer_name}</div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {e.competition_name || <span className="text-muted-foreground italic">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {e.risk_band ? (
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px] capitalize"
                          style={{
                            borderColor: RISK_COLORS[e.risk_band] || RISK_COLORS.unknown,
                            color: RISK_COLORS[e.risk_band] || RISK_COLORS.unknown,
                          }}
                        >
                          {e.risk_band}
                        </Badge>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {e.authorship_integrity_score != null ? Number(e.authorship_integrity_score).toFixed(1) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {e.originality_score != null ? Number(e.originality_score).toFixed(1) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {e.provenance_score != null ? Number(e.provenance_score).toFixed(1) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {e.market_substitution_risk != null ? Number(e.market_substitution_risk).toFixed(1) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[10px]">
                      {e.has_certificate ? (
                        <span className="text-emerald-500" title={e.certificate_number || ""}>✓</span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[10px] text-muted-foreground">
                      {new Date(e.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {e.entry_id ? (
                        <Button asChild variant="ghost" size="sm" className="h-7 px-2">
                          <Link to={`/entry/${e.entry_id}`} onClick={() => setDrillOpen(false)}>
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </Button>
                      ) : (
                        <Button asChild variant="ghost" size="sm" className="h-7 px-2">
                          <Link to="/authorship-shield" onClick={() => setDrillOpen(false)}>
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, accent }: {
  icon: any; label: string; value: string; accent?: "amber";
}) {
  return (
    <div className="rounded-md border border-border/40 bg-background/30 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className={`font-display text-2xl font-bold mt-1 ${accent === "amber" ? "text-amber-400" : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}
