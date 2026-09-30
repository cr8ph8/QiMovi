/**
 * StabilityOverviewPanel — God Mode admin surface for system-wide stability metrics.
 * Computes aggregate scoring drift and evaluation consistency across all entries.
 */
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  computeScoringDrift,
  overallStabilityScore,
  type StabilityResult,
  type GradingReportInput,
} from "@/lib/stability";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";

interface EntryStabilityRow {
  entry_id: string;
  entry_title: string;
  report_count: number;
  drift: StabilityResult;
}

const statusColor = (label: StabilityResult["metric_label"]) => {
  if (label === "stable") return "text-emerald-500";
  if (label === "moderate drift") return "text-amber-500";
  return "text-destructive";
};

const statusBg = (label: StabilityResult["metric_label"]) => {
  if (label === "stable") return "bg-emerald-500/10 border-emerald-500/30";
  if (label === "moderate drift") return "bg-amber-500/10 border-amber-500/30";
  return "bg-destructive/10 border-destructive/30";
};

export default function StabilityOverviewPanel() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<EntryStabilityRow[]>([]);

  async function fetchData() {
    setLoading(true);

    // Get all grading reports with entry title
    // eslint-disable-next-line no-restricted-syntax -- stability variance across per-run reports, not display total
    const { data: reports } = await supabase
      .from("grading_reports")
      .select("entry_id, total_score, model_id, created_at")


      .order("created_at", { ascending: true })
      .limit(2000);

    const { data: entries } = await supabase
      .from("entries")
      .select("id, title")
      .limit(1000);

    const titleMap = new Map((entries || []).map((e) => [e.id, e.title]));

    // Group reports by entry
    const byEntry = new Map<string, GradingReportInput[]>();
    (reports || []).forEach((r) => {
      const arr = byEntry.get(r.entry_id) || [];
      arr.push(r as GradingReportInput);
      byEntry.set(r.entry_id, arr);
    });

    const result: EntryStabilityRow[] = [];
    byEntry.forEach((reps, entryId) => {
      if (reps.length < 2) return;
      result.push({
        entry_id: entryId,
        entry_title: titleMap.get(entryId) || "Untitled",
        report_count: reps.length,
        drift: computeScoringDrift(reps),
      });
    });

    // Sort by worst drift first
    result.sort((a, b) => a.drift.metric_value - b.drift.metric_value);
    setRows(result);
    setLoading(false);
  }

  useEffect(() => {
    fetchData();
  }, []);

  const summary = useMemo(() => {
    if (rows.length === 0) return { stable: 0, moderate: 0, unstable: 0, total: 0 };
    return {
      stable: rows.filter((r) => r.drift.metric_label === "stable").length,
      moderate: rows.filter((r) => r.drift.metric_label === "moderate drift").length,
      unstable: rows.filter((r) => r.drift.metric_label === "unstable" || r.drift.metric_label === "high variance").length,
      total: rows.length,
    };
  }, [rows]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h3 className="font-display text-sm font-bold">Evaluation Stability Overview</h3>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="text-xs gap-1.5 h-7">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Multi-Run Entries", value: loading ? "…" : String(summary.total), icon: ShieldCheck, color: "text-primary" },
          { label: "Stable", value: loading ? "…" : String(summary.stable), icon: TrendingUp, color: "text-emerald-500" },
          { label: "Moderate Drift", value: loading ? "…" : String(summary.moderate), icon: Minus, color: "text-amber-500" },
          { label: "Unstable", value: loading ? "…" : String(summary.unstable), icon: AlertTriangle, color: "text-destructive" },
        ].map((c) => (
          <div key={c.label} className="flex items-center gap-2.5 px-4 py-3 rounded-lg border border-border/30 bg-card/60">
            <c.icon className={`h-4 w-4 shrink-0 ${c.color}`} />
            <span className="text-xs font-mono text-muted-foreground">{c.label}</span>
            <span className={`ml-auto font-display text-sm font-bold ${c.color}`}>{c.value}</span>
          </div>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border/50 bg-card/80 p-6 text-center">
          <ShieldCheck className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            No entries with multiple grading runs yet. Stability analysis requires at least two evaluation runs per entry.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border/50 bg-card/80 p-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 pr-4 font-mono text-xs text-muted-foreground">Entry</th>
                <th className="text-right py-2 px-3 font-mono text-xs text-muted-foreground">Runs</th>
                <th className="text-right py-2 px-3 font-mono text-xs text-muted-foreground">Drift Score</th>
                <th className="text-center py-2 pl-3 font-mono text-xs text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.entry_id} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                  <td className="py-2.5 pr-4 text-sm font-body text-foreground truncate max-w-[200px]">{r.entry_title}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs">{r.report_count}</td>
                  <td className={`py-2.5 px-3 text-right font-mono text-xs ${statusColor(r.drift.metric_label)}`}>
                    {r.drift.metric_value}%
                  </td>
                  <td className="py-2.5 pl-3 text-center">
                    <Badge variant="outline" className={`text-[10px] font-mono ${statusBg(r.drift.metric_label)} ${statusColor(r.drift.metric_label)}`}>
                      {r.drift.metric_label}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
