import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ShieldCheck, ShieldAlert, ShieldX, Sparkles, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { PAID_AI_SECURITY_HOLD, PAID_AI_SECURITY_MESSAGE } from "@/lib/securityMaintenance";
import {
  evaluateInvariants,
  type ContinuityEvent,
  type GateVerdict,
  type Violation,
} from "@/lib/narrative-invariants";

interface Props {
  entryId: string;
}

interface GovernanceEvent {
  id: string;
  created_at: string;
  event_status: string;
  metadata_json: any;
  row_hash: string | null;
  prev_hash: string | null;
}

/**
 * ContinuityPanel — shared surface for the deterministic narrative gate.
 * Reads from character_belief_events directly to render an immediate
 * client-side verdict, plus the hash-chained ledger from governance_events.
 * Uses the existing extract-continuity and narrative-gate edge functions —
 * no parallel storage.
 */
export default function ContinuityPanel({ entryId }: Props) {
  const { user } = useAuth();
  const [verdict, setVerdict] = useState<GateVerdict | null>(null);
  const [loadingVerdict, setLoadingVerdict] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<ContinuityEvent[]>([]);
  const [ledger, setLedger] = useState<GovernanceEvent[]>([]);

  async function loadEvents() {
    setLoadingVerdict(true);
    const { data } = await supabase
      .from("character_belief_events")
      .select("id, turn_label, event_kind, source, evidence, scene_ref")
      .eq("entry_id", entryId);
    const list: ContinuityEvent[] = (data ?? [])
      .filter((r: any) => r.event_kind)
      .map((r: any) => {
        const ev = (r.evidence ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          scene_ref: (r.scene_ref ?? ev.scene_ref ?? r.turn_label ?? "unscoped") as string,
          scene_order: Number(ev.scene_order ?? 0),
          event_kind: r.event_kind,
          actors: Array.isArray(ev.actors) ? (ev.actors as string[]) : [],
          object: (ev.object as string | undefined) ?? null,
          source: r.source ?? undefined,
        };
      });
    setEvents(list);
    setVerdict(await evaluateInvariants(list));
    setLoadingVerdict(false);
  }

  async function loadLedger() {
    const { data } = await supabase
      .from("governance_events")
      .select("id, created_at, event_status, metadata_json, row_hash, prev_hash")
      .eq("entry_id", entryId)
      .eq("event_type", "narrative_gate")
      .order("created_at", { ascending: false })
      .limit(20);
    setLedger((data ?? []) as GovernanceEvent[]);
  }

  useEffect(() => { loadEvents(); loadLedger(); }, [entryId]);

  async function runExtract() {
    if (PAID_AI_SECURITY_HOLD) { toast.error(PAID_AI_SECURITY_MESSAGE); return; }
    if (!user) { toast.error("Login required"); return; }
    setExtracting(true);
    try {
      const { data, error } = await supabase.functions.invoke("extract-continuity", {
        body: { entry_id: entryId },
      });
      if (error) throw error;
      toast.success(`Extracted ${data?.extracted_count ?? 0} continuity events`);
      await loadEvents();
    } catch (e: any) {
      toast.error(e?.message ?? "Extraction failed");
    } finally {
      setExtracting(false);
    }
  }

  async function runGate() {
    if (PAID_AI_SECURITY_HOLD) { toast.error(PAID_AI_SECURITY_MESSAGE); return; }
    if (!user) { toast.error("Login required"); return; }
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("narrative-gate", {
        body: { entry_id: entryId },
      });
      if (error) throw error;
      toast.success(`Gate verdict: ${data?.verdict}`);
      await Promise.all([loadEvents(), loadLedger()]);
    } catch (e: any) {
      toast.error(e?.message ?? "Gate run failed");
    } finally {
      setRunning(false);
    }
  }

  const authoredCount = events.filter((e) => e.source === "authored").length;
  const extractedCount = events.filter((e) => e.source === "extracted").length;

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                Narrative Gate
                <Badge variant="outline" className="text-[10px] font-mono">v1</Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Deterministic continuity check. State-based, not aesthetic. Coverage = invariant set.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={runExtract} disabled={PAID_AI_SECURITY_HOLD || extracting}>
                {extracting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                Extract events
              </Button>
              <Button size="sm" onClick={runGate} disabled={PAID_AI_SECURITY_HOLD || running || loadingVerdict}>
                {running ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                Run gate
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{events.length} events</span>
            <span>· authored {authoredCount}</span>
            <span>· extracted {extractedCount}</span>
            {verdict && <span>· {verdict.scene_count} scenes</span>}
            {verdict && <span className="font-mono">· root {verdict.state_root.slice(0, 10)}…</span>}
          </div>

          <VerdictBanner verdict={verdict} loading={loadingVerdict} />

          {verdict && verdict.violations.length > 0 && (
            <ul className="space-y-1.5">
              {verdict.violations.map((v, i) => (
                <ViolationRow key={i} v={v} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Hash-chained ledger</CardTitle>
          <p className="text-xs text-muted-foreground">governance_events · event_type=narrative_gate</p>
        </CardHeader>
        <CardContent>
          {ledger.length === 0 ? (
            <p className="text-xs text-muted-foreground">No gate runs recorded yet.</p>
          ) : (
            <ul className="space-y-1 text-xs font-mono">
              {ledger.map((row) => (
                <li key={row.id} className="flex items-center gap-3 py-1 border-b border-border/40 last:border-0">
                  <span className="opacity-60 w-32 truncate">{new Date(row.created_at).toLocaleString()}</span>
                  <Badge
                    variant="outline"
                    className={
                      row.event_status === "reject"
                        ? "border-destructive/40 text-destructive"
                        : row.event_status === "warn"
                          ? "border-amber-500/40 text-amber-500"
                          : "border-emerald-500/40 text-emerald-500"
                    }
                  >
                    {row.event_status}
                  </Badge>
                  <span className="opacity-60 truncate">
                    {row.metadata_json?.violation_count ?? 0} violations
                  </span>
                  <span className="ml-auto opacity-50 truncate">
                    {row.row_hash ? row.row_hash.slice(0, 12) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function VerdictBanner({ verdict, loading }: { verdict: GateVerdict | null; loading: boolean }) {
  if (loading || !verdict) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Evaluating…
      </div>
    );
  }
  const Icon = verdict.verdict === "PASS" ? ShieldCheck : verdict.verdict === "WARN" ? ShieldAlert : ShieldX;
  const tone =
    verdict.verdict === "PASS"
      ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-500"
      : verdict.verdict === "WARN"
        ? "border-amber-500/40 bg-amber-500/5 text-amber-500"
        : "border-destructive/40 bg-destructive/5 text-destructive";
  return (
    <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${tone}`}>
      <Icon className="h-4 w-4" />
      <span className="font-semibold tracking-wide">{verdict.verdict}</span>
      <span className="opacity-70">· {verdict.violations.length} violations</span>
    </div>
  );
}

function ViolationRow({ v }: { v: Violation }) {
  return (
    <li className="rounded-md border border-border/60 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="font-mono text-[10px]">{v.invariant}</Badge>
        <span className="opacity-70">{v.scene_ref}</span>
        {v.actor && <span className="opacity-70">· {v.actor}</span>}
        <Badge
          variant="outline"
          className={`ml-auto text-[10px] ${
            v.severity === "reject" ? "border-destructive/40 text-destructive" : "border-amber-500/40 text-amber-500"
          }`}
        >
          {v.severity}
        </Badge>
      </div>
      <p className="mt-1 text-muted-foreground">{v.message}</p>
    </li>
  );
}
