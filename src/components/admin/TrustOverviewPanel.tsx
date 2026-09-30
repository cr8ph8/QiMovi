/**
 * TrustOverviewPanel — God Mode mirror of user-facing trust data.
 * Shows artifact readiness, stability, provenance completeness across all entries.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, CheckCircle2, AlertTriangle, Activity, GitBranch } from "lucide-react";

interface EntryTrustRow {
  id: string;
  title: string;
  status: string;
  artifactCount: number;
  readyCount: number;
  failedCount: number;
  staleCount: number;
  hasIntegrity: boolean;
  versionCount: number;
  govEventCount: number;
}

export default function TrustOverviewPanel() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<EntryTrustRow[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [entriesRes, artifactsRes, versionsRes, govRes] = await Promise.all([
        supabase.from("entries").select("id, title, status").order("created_at", { ascending: false }).limit(100),
        supabase.from("artifacts").select("entry_id, status, text_hash, version_graph_hash, governance_log_hash"),
        supabase.from("screenplay_versions").select("entry_id"),
        supabase.from("governance_events").select("entry_id"),
      ]);

      const entries = entriesRes.data || [];
      const artifacts = artifactsRes.data || [];
      const versions = versionsRes.data || [];
      const govEvents = govRes.data || [];

      const artifactsByEntry = new Map<string, typeof artifacts>();
      artifacts.forEach(a => {
        const list = artifactsByEntry.get(a.entry_id) || [];
        list.push(a);
        artifactsByEntry.set(a.entry_id, list);
      });

      const versionCounts = new Map<string, number>();
      versions.forEach(v => versionCounts.set(v.entry_id, (versionCounts.get(v.entry_id) || 0) + 1));

      const govCounts = new Map<string, number>();
      govEvents.forEach(g => { if (g.entry_id) govCounts.set(g.entry_id, (govCounts.get(g.entry_id) || 0) + 1); });

      setRows(entries.map(e => {
        const arts = artifactsByEntry.get(e.id) || [];
        return {
          id: e.id,
          title: e.title,
          status: e.status,
          artifactCount: arts.length,
          readyCount: arts.filter(a => a.status === "ready" || a.status === "exported").length,
          failedCount: arts.filter(a => a.status === "failed").length,
          staleCount: arts.filter(a => a.status === "stale").length,
          hasIntegrity: arts.some(a => a.text_hash || a.version_graph_hash || a.governance_log_hash),
          versionCount: versionCounts.get(e.id) || 0,
          govEventCount: govCounts.get(e.id) || 0,
        };
      }));
      setLoading(false);
    }
    load();
  }, []);

  const totalEntries = rows.length;
  const withArtifacts = rows.filter(r => r.artifactCount > 0).length;
  const withIntegrity = rows.filter(r => r.hasIntegrity).length;
  const withFailures = rows.filter(r => r.failedCount > 0).length;

  if (loading) {
    return <div className="space-y-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-32 w-full" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard icon={Shield} label="Entries" value={totalEntries} />
        <SummaryCard icon={CheckCircle2} label="With Artifacts" value={withArtifacts} color="text-emerald-500" />
        <SummaryCard icon={Activity} label="With Integrity" value={withIntegrity} color="text-primary" />
        <SummaryCard icon={AlertTriangle} label="With Failures" value={withFailures} color={withFailures > 0 ? "text-destructive" : "text-muted-foreground"} />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border/50">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/30 border-b border-border/50">
              <th className="text-left py-2 px-3 font-mono text-muted-foreground">Title</th>
              <th className="text-left py-2 px-3 font-mono text-muted-foreground">Status</th>
              <th className="text-center py-2 px-3 font-mono text-muted-foreground">Artifacts</th>
              <th className="text-center py-2 px-3 font-mono text-muted-foreground">Ready</th>
              <th className="text-center py-2 px-3 font-mono text-muted-foreground">Failed</th>
              <th className="text-center py-2 px-3 font-mono text-muted-foreground">Integrity</th>
              <th className="text-center py-2 px-3 font-mono text-muted-foreground">Versions</th>
              <th className="text-center py-2 px-3 font-mono text-muted-foreground">Gov Events</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 50).map(r => (
              <tr key={r.id} className="border-b border-border/20 hover:bg-muted/10">
                <td className="py-2 px-3 max-w-[200px] truncate">{r.title}</td>
                <td className="py-2 px-3">
                  <Badge variant="outline" className="text-[9px] font-mono capitalize">{r.status}</Badge>
                </td>
                <td className="py-2 px-3 text-center font-mono">{r.artifactCount}</td>
                <td className="py-2 px-3 text-center font-mono text-emerald-500">{r.readyCount}</td>
                <td className={`py-2 px-3 text-center font-mono ${r.failedCount > 0 ? "text-destructive" : "text-muted-foreground"}`}>{r.failedCount}</td>
                <td className="py-2 px-3 text-center">
                  {r.hasIntegrity ? <span className="text-emerald-500">✓</span> : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="py-2 px-3 text-center font-mono">{r.versionCount}</td>
                <td className="py-2 px-3 text-center font-mono">{r.govEventCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color?: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/80 p-3 text-center">
      <Icon className={`h-4 w-4 mx-auto mb-1 ${color || "text-muted-foreground"}`} />
      <p className="text-lg font-display font-bold">{value}</p>
      <p className="text-[10px] text-muted-foreground font-mono">{label}</p>
    </div>
  );
}
