import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, ThumbsUp, ThumbsDown, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  PAID_AI_SECURITY_HOLD,
  PAID_AI_SECURITY_MESSAGE,
} from "@/lib/securityMaintenance";

interface EntryRow {
  id: string;
  title: string;
  created_at: string;
  script_len: number;
}

interface ReportRow {
  entry_id: string;
  title: string | null;
  verdict: string | null;
  violation_count: number | null;
  gate_run_at: string | null;
  truth_has_violation: boolean | null;
  classification: string | null;
}

/**
 * Narrative Gate Shadow Panel
 *
 * Shadow mode = narrative_gate_blocking is OFF (current site_settings state).
 * This panel lets an admin run extract-continuity + narrative-gate over recent
 * submissions, then label each verdict against ground truth so we can compute
 * false-positive / false-negative rates honestly.
 */
export default function NarrativeGateShadowPanel() {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [report, setReport] = useState<ReportRow[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  useEffect(() => {
    (async () => {
      if (!user) { setLoading(false); return; }
      const { data: roles } = await supabase
        .from("user_roles").select("role").eq("user_id", user.id);
      setIsAdmin((roles ?? []).some((r: any) => r.role === "admin"));
      setLoading(false);
    })();
  }, [user]);

  async function loadData() {
    const [{ data: ents }, { data: rpt }] = await Promise.all([
      supabase
        .from("entries")
        .select("id, title, created_at, script_text")
        .not("script_text", "is", null)
        .order("created_at", { ascending: false })
        .limit(25),
      supabase
        .from("narrative_gate_shadow_report")
        .select("entry_id, title, verdict, violation_count, gate_run_at, truth_has_violation, classification")
        .order("gate_run_at", { ascending: false })
        .limit(100),
    ]);
    setEntries(((ents ?? []) as any[]).map((e) => ({
      id: e.id, title: e.title, created_at: e.created_at,
      script_len: (e.script_text ?? "").length,
    })).filter((e) => e.script_len > 500));
    setReport((rpt ?? []) as ReportRow[]);
  }

  useEffect(() => { if (isAdmin) loadData(); }, [isAdmin]);

  async function runGate(entryId: string) {
    if (PAID_AI_SECURITY_HOLD) {
      toast.info(PAID_AI_SECURITY_MESSAGE);
      return;
    }
    setRunning(entryId);
    try {
      const ext = await supabase.functions.invoke("extract-continuity", { body: { entry_id: entryId } });
      if (ext.error) throw ext.error;
      const gate = await supabase.functions.invoke("narrative-gate", { body: { entry_id: entryId } });
      if (gate.error) throw gate.error;
      toast.success(`Shadow gate: ${gate.data?.verdict ?? "done"}`);
      await loadData();
    } catch (e: any) {
      toast.error(e?.message ?? "Gate run failed");
    } finally {
      setRunning(null);
    }
  }

  async function runBulk() {
    if (PAID_AI_SECURITY_HOLD) {
      toast.info(PAID_AI_SECURITY_MESSAGE);
      return;
    }
    setBulkRunning(true);
    const targets = entries
      .filter((e) => !report.some((r) => r.entry_id === e.id))
      .slice(0, 10);
    for (const t of targets) {
      // eslint-disable-next-line no-await-in-loop
      await runGate(t.id);
    }
    setBulkRunning(false);
    toast.success(`Bulk shadow run complete (${targets.length} entries)`);
  }

  async function label(entryId: string, truth: boolean, row: ReportRow) {
    if (!user) return;
    const { error } = await supabase
      .from("narrative_gate_shadow_labels")
      .upsert({
        entry_id: entryId,
        governance_event_id: null,
        verdict: row.verdict ?? "unknown",
        violation_count: row.violation_count ?? 0,
        truth_has_violation: truth,
        labeled_by: user.id,
      }, { onConflict: "entry_id,labeled_by" });
    if (error) { toast.error(error.message); return; }
    await loadData();
  }

  const metrics = useMemo(() => {
    const total = report.length;
    const labeled = report.filter((r) => r.truth_has_violation !== null);
    const tp = labeled.filter((r) => r.classification === "true_positive").length;
    const fp = labeled.filter((r) => r.classification === "false_positive").length;
    const tn = labeled.filter((r) => r.classification === "true_negative").length;
    const fn = labeled.filter((r) => r.classification === "false_negative").length;
    const flagged = report.filter((r) => r.verdict === "warn" || r.verdict === "reject").length;
    const fpRate = (fp + tn) > 0 ? fp / (fp + tn) : null;
    const fnRate = (tp + fn) > 0 ? fn / (tp + fn) : null;
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : null;
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : null;
    return { total, flagged, labeled: labeled.length, tp, fp, tn, fn, fpRate, fnRate, precision, recall };
  }, [report]);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!isAdmin) return <div className="p-6 text-sm text-muted-foreground">Admin only.</div>;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                Narrative Gate · Shadow Mode
                <Badge variant="outline" className="text-[10px] font-mono">v1 · non-blocking</Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Runs the deterministic gate on recent submissions. Verdicts are recorded but never block.
                Label each run as a true continuity issue or not to compute FP/FN.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={loadData}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
              </Button>
              <Button size="sm" onClick={runBulk} disabled={bulkRunning || PAID_AI_SECURITY_HOLD}>
                {bulkRunning ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
                Run shadow on next 10
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <Metric label="Shadow runs" value={metrics.total} />
            <Metric label="Flagged (warn/reject)" value={`${metrics.flagged} (${pct(metrics.flagged, metrics.total)})`} />
            <Metric label="Labeled" value={`${metrics.labeled} / ${metrics.total}`} />
            <Metric label="TP / FP / TN / FN" value={`${metrics.tp} / ${metrics.fp} / ${metrics.tn} / ${metrics.fn}`} />
            <Metric label="False-positive rate" value={metrics.fpRate === null ? "—" : `${(metrics.fpRate * 100).toFixed(1)}%`} hint="FP / (FP + TN)" />
            <Metric label="False-negative rate" value={metrics.fnRate === null ? "—" : `${(metrics.fnRate * 100).toFixed(1)}%`} hint="FN / (TP + FN)" />
            <Metric label="Precision" value={metrics.precision === null ? "—" : `${(metrics.precision * 100).toFixed(1)}%`} />
            <Metric label="Recall" value={metrics.recall === null ? "—" : `${(metrics.recall * 100).toFixed(1)}%`} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Recent submissions</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {entries.map((e) => {
              const r = report.find((x) => x.entry_id === e.id);
              return (
                <div key={e.id} className="flex items-center gap-3 py-2 border-b border-border/40 last:border-0 text-xs">
                  <span className="flex-1 truncate">{e.title || "Untitled"}</span>
                  <span className="opacity-60 w-24 truncate">{new Date(e.created_at).toLocaleDateString()}</span>
                  {r ? (
                    <>
                      <Badge variant="outline" className={verdictTone(r.verdict)}>{r.verdict}</Badge>
                      <span className="opacity-60 w-16">{r.violation_count ?? 0} viol.</span>
                      <Button size="sm" variant={r.truth_has_violation === true ? "default" : "outline"}
                        onClick={() => label(e.id, true, r)}>
                        <ThumbsUp className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant={r.truth_has_violation === false ? "default" : "outline"}
                        onClick={() => label(e.id, false, r)}>
                        <ThumbsDown className="h-3 w-3" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => runGate(e.id)}
                      disabled={running === e.id || PAID_AI_SECURITY_HOLD}
                    >
                      {running === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Run shadow"}
                    </Button>
                  )}
                </div>
              );
            })}
            {entries.length === 0 && <p className="text-xs text-muted-foreground">No recent submissions with script text.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-md border border-border/50 p-2.5">
      <div className="opacity-60 text-[10px] uppercase tracking-wide">{label}</div>
      <div className="font-mono text-sm mt-1">{value}</div>
      {hint && <div className="opacity-50 text-[10px] mt-0.5">{hint}</div>}
    </div>
  );
}

function pct(n: number, d: number) { return d === 0 ? "0%" : `${((n / d) * 100).toFixed(0)}%`; }
function verdictTone(v: string | null) {
  if (v === "reject") return "border-destructive/40 text-destructive";
  if (v === "warn") return "border-amber-500/40 text-amber-500";
  if (v === "pass") return "border-emerald-500/40 text-emerald-500";
  return "";
}
