import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, CheckCircle, Clock, FileCheck,
  Loader2, PackageCheck, RefreshCw, Shield, Sparkles, XCircle,
} from "lucide-react";

interface PipelineEntry {
  id: string;
  title: string;
  status: string;
  created_at: string;
  competition_id: string | null;
  author: string | null;
}

interface ArtifactSummary {
  entry_id: string;
  total: number;
  ready: number;
  failed: number;
  stale: number;
}

interface CompSummary {
  id: string;
  name: string;
  status: string;
  entryCount: number;
  scoredCount: number;
  errorCount: number;
  judgingCount: number;
  submittedCount: number;
}

const STATUS_ICON: Record<string, { icon: any; color: string }> = {
  submitted: { icon: Clock, color: "text-muted-foreground" },
  judging: { icon: Loader2, color: "text-primary" },
  scored: { icon: CheckCircle, color: "text-emerald-400" },
  error: { icon: XCircle, color: "text-destructive" },
  disqualified: { icon: XCircle, color: "text-destructive" },
};

export default function SeasonZeroOpsPanel() {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<PipelineEntry[]>([]);
  const [artifactMap, setArtifactMap] = useState<Record<string, ArtifactSummary>>({});
  const [competitions, setCompetitions] = useState<CompSummary[]>([]);
  const [retrying, setRetrying] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [entriesRes, artifactsRes, compsRes] = await Promise.all([
      supabase
        .from("entries")
        .select("id, title, status, created_at, competition_id, author")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("artifacts")
        .select("entry_id, status")
        .limit(2000),
      supabase
        .from("competitions")
        .select("id, name, status")
        .order("created_at", { ascending: false }),
    ]);

    const allEntries = (entriesRes.data || []) as PipelineEntry[];
    setEntries(allEntries);

    // Build artifact summaries per entry
    const aMap: Record<string, ArtifactSummary> = {};
    for (const a of (artifactsRes.data || []) as { entry_id: string; status: string }[]) {
      if (!aMap[a.entry_id]) aMap[a.entry_id] = { entry_id: a.entry_id, total: 0, ready: 0, failed: 0, stale: 0 };
      aMap[a.entry_id].total++;
      if (a.status === "ready" || a.status === "exported") aMap[a.entry_id].ready++;
      if (a.status === "failed") aMap[a.entry_id].failed++;
      if (a.status === "stale") aMap[a.entry_id].stale++;
    }
    setArtifactMap(aMap);

    // Build competition summaries
    const compSummaries: CompSummary[] = (compsRes.data || []).map((c: any) => {
      const compEntries = allEntries.filter((e) => e.competition_id === c.id);
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        entryCount: compEntries.length,
        scoredCount: compEntries.filter((e) => e.status === "scored").length,
        errorCount: compEntries.filter((e) => e.status === "error").length,
        judgingCount: compEntries.filter((e) => e.status === "judging").length,
        submittedCount: compEntries.filter((e) => e.status === "submitted").length,
      };
    });
    setCompetitions(compSummaries);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleRetry(entryId: string) {
    setRetrying(entryId);
    try {
      await supabase.from("entries").update({ status: "submitted" as any }).eq("id", entryId);
      const { error } = await supabase.functions.invoke("ai-judge", { body: { entry_id: entryId } });
      if (error) throw error;
      toast.success("Entry re-judged successfully");
      await load();
    } catch (err: any) {
      toast.error("Retry failed: " + (err.message || "Unknown error"));
    }
    setRetrying(null);
  }

  // Derived stats
  const errorEntries = entries.filter((e) => e.status === "error");
  const stuckJudging = entries.filter((e) => {
    if (e.status !== "judging") return false;
    const age = Date.now() - new Date(e.created_at).getTime();
    return age > 10 * 60 * 1000; // stuck > 10 min
  });
  const missingArtifacts = entries
    .filter((e) => e.status === "scored")
    .filter((e) => !artifactMap[e.id] || artifactMap[e.id].total === 0);
  const failedArtifacts = entries
    .filter((e) => artifactMap[e.id]?.failed > 0);
  const totalScored = entries.filter((e) => e.status === "scored").length;
  const totalExportReady = entries
    .filter((e) => e.status === "scored")
    .filter((e) => artifactMap[e.id]?.ready >= 3).length;

  if (loading) {
    return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div>;
  }

  return (
    <div className="space-y-5">
      {/* Health Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard icon={Activity} label="Pipeline" value={`${entries.length} entries`} sub={`${totalScored} scored`} ok />
        <SummaryCard
          icon={AlertTriangle}
          label="Errors"
          value={String(errorEntries.length + stuckJudging.length)}
          sub={errorEntries.length > 0 ? `${errorEntries.length} failed` : "All clear"}
          ok={errorEntries.length === 0 && stuckJudging.length === 0}
        />
        <SummaryCard
          icon={PackageCheck}
          label="Export Ready"
          value={`${totalExportReady}/${totalScored}`}
          sub={missingArtifacts.length > 0 ? `${missingArtifacts.length} missing` : "Complete"}
          ok={missingArtifacts.length === 0}
        />
        <SummaryCard
          icon={Shield}
          label="Competitions"
          value={String(competitions.length)}
          sub={competitions.filter((c) => c.status === "open").length + " open"}
          ok
        />
      </div>

      {/* Competition Readiness */}
      {competitions.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-card/80 p-4 space-y-3">
          <h4 className="text-xs font-mono font-bold text-muted-foreground uppercase tracking-wider">Competition Readiness</h4>
          <div className="space-y-2">
            {competitions.map((c) => {
              const pct = c.entryCount > 0 ? Math.round((c.scoredCount / c.entryCount) * 100) : 0;
              return (
                <div key={c.id} className="flex items-center gap-3 text-sm">
                  <Badge variant="outline" className={`text-[9px] font-mono shrink-0 ${
                    c.status === "open" ? "bg-emerald-500/10 text-emerald-500" :
                    c.status === "draft" ? "bg-muted text-muted-foreground" :
                    "bg-primary/10 text-primary"
                  }`}>{c.status}</Badge>
                  <span className="font-body truncate flex-1">{c.name}</span>
                  <div className="flex items-center gap-2 shrink-0 text-[10px] font-mono text-muted-foreground">
                    <span>{c.entryCount} entries</span>
                    <span>·</span>
                    <span className={c.scoredCount === c.entryCount && c.entryCount > 0 ? "text-emerald-400" : ""}>
                      {c.scoredCount} scored ({pct}%)
                    </span>
                    {c.errorCount > 0 && (
                      <Badge variant="outline" className="text-[8px] font-mono text-destructive border-destructive/30">
                        {c.errorCount} errors
                      </Badge>
                    )}
                    {c.judgingCount > 0 && (
                      <Badge variant="outline" className="text-[8px] font-mono text-primary border-primary/30">
                        {c.judgingCount} judging
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Error & Stuck Entries */}
      {(errorEntries.length > 0 || stuckJudging.length > 0) && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <h4 className="text-xs font-mono font-bold text-destructive uppercase tracking-wider">
              Requires Attention ({errorEntries.length + stuckJudging.length})
            </h4>
          </div>
          <ScrollArea className="max-h-[200px]">
            <div className="space-y-2">
              {[...errorEntries, ...stuckJudging].map((e) => (
                <div key={e.id} className="flex items-center gap-2 text-sm">
                  <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                  <span className="truncate flex-1 font-body">{e.title}</span>
                  <Badge variant="outline" className="text-[8px] font-mono text-destructive border-destructive/30">
                    {e.status === "error" ? "Failed" : "Stuck"}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-[10px] h-6 px-2 font-mono border-destructive/30 text-destructive hover:bg-destructive/10"
                    disabled={retrying === e.id}
                    onClick={() => handleRetry(e.id)}
                  >
                    {retrying === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Retry
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Artifact Readiness */}
      {(missingArtifacts.length > 0 || failedArtifacts.length > 0) && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <FileCheck className="h-4 w-4 text-amber-500" />
            <h4 className="text-xs font-mono font-bold text-amber-500 uppercase tracking-wider">
              Artifact Issues ({missingArtifacts.length + failedArtifacts.length})
            </h4>
          </div>
          <ScrollArea className="max-h-[200px]">
            <div className="space-y-2">
              {missingArtifacts.map((e) => (
                <div key={e.id} className="flex items-center gap-2 text-sm">
                  <PackageCheck className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <span className="truncate flex-1 font-body">{e.title}</span>
                  <Badge variant="outline" className="text-[8px] font-mono text-amber-500 border-amber-500/30">
                    No artifacts
                  </Badge>
                </div>
              ))}
              {failedArtifacts.map((e) => (
                <div key={e.id} className="flex items-center gap-2 text-sm">
                  <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                  <span className="truncate flex-1 font-body">{e.title}</span>
                  <Badge variant="outline" className="text-[8px] font-mono text-destructive border-destructive/30">
                    {artifactMap[e.id]?.failed} failed
                  </Badge>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* All clear banner */}
      {errorEntries.length === 0 && stuckJudging.length === 0 && missingArtifacts.length === 0 && failedArtifacts.length === 0 && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 text-emerald-400 text-xs font-mono">
          <CheckCircle className="h-4 w-4" />
          All systems operational — no errors, stuck entries, or missing artifacts detected.
        </div>
      )}
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, sub, ok }: { icon: any; label: string; value: string; sub: string; ok: boolean }) {
  return (
    <div className={`rounded-lg border p-3 space-y-1 ${ok ? "border-border/30 bg-card/60" : "border-destructive/30 bg-destructive/5"}`}>
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${ok ? "text-primary" : "text-destructive"}`} />
        <span className="text-[10px] font-mono text-muted-foreground uppercase">{label}</span>
      </div>
      <p className="font-display text-lg font-bold">{value}</p>
      <p className="text-[10px] font-mono text-muted-foreground">{sub}</p>
    </div>
  );
}
