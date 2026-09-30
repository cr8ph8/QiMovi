import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, ShieldCheck, ShieldX, AlertTriangle, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import GateDecisionModal from "./GateDecisionModal";

interface Props {
  projectId: string | null;
}

interface GateEvent {
  id: string;
  event_type: string;
  event_status: string;
  metadata_json: any;
  created_at: string;
}

/**
 * GateTimelinePanel
 * Live feed of OKF admission-gate decisions for the current project.
 * Explains each Φ (frontmatter) and Ψ (contradiction/status) verdict and
 * whether the proposed concept was committed, rejected, or escalated.
 */
export default function GateTimelinePanel({ projectId }: Props) {
  const [events, setEvents] = useState<GateEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [modalEvent, setModalEvent] = useState<GateEvent | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("list-gate-decisions", {
        body: { project_id: projectId, limit: 50 },
      });
      if (error) throw error;
      setEvents((data as any)?.events ?? []);
    } catch (e) {
      console.error("[GateTimeline] load failed", e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // Realtime subscription — new governance_events rows push into the feed
  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`gate-events-${projectId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "governance_events", filter: `event_type=eq.okf_admit` },
        (payload: any) => {
          const row = payload.new as GateEvent;
          if (row?.metadata_json?.project_id === projectId) {
            setEvents((prev) => [row, ...prev].slice(0, 100));
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [projectId]);

  if (!projectId) {
    return (
      <div className="rounded-lg border border-border/40 bg-card/30 p-4 text-sm text-muted-foreground">
        Gate timeline appears once this workspace is linked to a project.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/40 bg-card/40">
      <header className="flex items-center justify-between border-b border-border/40 p-4">
        <div>
          <h3 className="font-display text-lg">Gate Decision Timeline</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Every OKF concept flows through Φ (frontmatter validity) then Ψ (contradiction / status). Decisions: <span className="text-emerald-400">commit</span>, <span className="text-red-400">reject</span>, or <span className="text-amber-400">escalate</span>.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </header>

      <ScrollArea className="max-h-[420px]">
        <ol className="p-2">
          {events.length === 0 && !loading && (
            <li className="p-6 text-center text-sm text-muted-foreground">
              No gate decisions yet. Admit a concept to see it appear here.
            </li>
          )}
          {events.map((ev) => (
            <TimelineRow
              key={ev.id}
              ev={ev}
              expanded={expanded === ev.id}
              onToggle={() => setExpanded(expanded === ev.id ? null : ev.id)}
              onOpen={() => setModalEvent(ev)}
            />
          ))}
        </ol>
      </ScrollArea>
      <GateDecisionModal event={modalEvent} open={!!modalEvent} onOpenChange={(v) => !v && setModalEvent(null)} />
    </div>
  );
}

function TimelineRow({ ev, expanded, onToggle, onOpen }: { ev: GateEvent; expanded: boolean; onToggle: () => void; onOpen: () => void }) {
  const meta = ev.metadata_json ?? {};
  const verdict: "commit" | "reject" | "escalate" =
    meta.verdict ?? (ev.event_status === "commit" ? "commit" : ev.event_status === "escalate" ? "escalate" : "reject");
  const stage: string = meta.stage ?? (ev.event_status.startsWith("reject_") ? ev.event_status.replace("reject_", "") : ev.event_status);

  const iconClass = verdict === "commit"
    ? "text-emerald-400"
    : verdict === "escalate"
      ? "text-amber-400"
      : "text-red-400";

  const Icon = verdict === "commit" ? ShieldCheck : verdict === "escalate" ? AlertTriangle : ShieldX;

  return (
    <li className="border-b border-border/20 last:border-none">
      <div className="w-full flex items-start gap-3 p-3 hover:bg-muted/30 transition-colors">
        <button onClick={onOpen} className="mt-0.5 flex-1 flex items-start gap-3 text-left" aria-label="Open decision details">
          <div className={`mt-0.5 ${iconClass}`}><Icon className="h-4 w-4" /></div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium truncate">
                {meta.concept_type ?? "concept"} · {meta.concept_title ?? "(untitled)"}
              </span>
              <VerdictBadge verdict={verdict} />
              <StageBadge stage={stage} />
              {meta.version ? <Badge variant="outline" className="text-[10px]">v{meta.version}</Badge> : null}
              {meta.risk && meta.risk !== "low" ? (
                <Badge variant="outline" className={`text-[10px] ${meta.risk === "critical" ? "border-red-500/50 text-red-400" : "border-amber-500/50 text-amber-400"}`}>
                  risk: {meta.risk}
                </Badge>
              ) : null}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              {formatDistanceToNow(new Date(ev.created_at), { addSuffix: true })} · {explain(stage, verdict, meta)} · <span className="underline">view full drilldown</span>
            </div>
          </div>
        </button>
        <button onClick={onToggle} className="p-1 text-muted-foreground hover:text-foreground" aria-label="Toggle inline detail">
          <ChevronRight className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-3 pl-10">
          <DetailBlock verdict={verdict} stage={stage} meta={meta} />
        </div>
      )}
    </li>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const cls =
    verdict === "commit" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" :
    verdict === "escalate" ? "bg-amber-500/15 text-amber-300 border-amber-500/30" :
    "bg-red-500/15 text-red-300 border-red-500/30";
  return <Badge variant="outline" className={`text-[10px] ${cls}`}>{verdict}</Badge>;
}

function StageBadge({ stage }: { stage: string }) {
  const label = stage === "phi" ? "Φ frontmatter" : stage === "psi" ? "Ψ contradiction" : stage === "escalate" ? "escalate" : "commit";
  return <Badge variant="secondary" className="text-[10px]">{label}</Badge>;
}

function explain(stage: string, verdict: string, meta: any): string {
  if (verdict === "commit") return `Admitted as ${meta.status ?? "draft"} — no conflicts against verified siblings.`;
  if (stage === "phi") return `Rejected at frontmatter check: ${(meta.reasons ?? []).slice(0, 2).join("; ") || "invalid metadata"}.`;
  if (stage === "psi") {
    const first = (meta.conflicts ?? [])[0]?.reason;
    return `Rejected at contradiction check${first ? `: ${first}` : ""}.`;
  }
  if (verdict === "escalate") return meta.reason ?? "Held for human review.";
  return "Decision recorded.";
}

function DetailBlock({ verdict, stage, meta }: { verdict: string; stage: string; meta: any }) {
  return (
    <div className="rounded border border-border/40 bg-background/40 p-3 space-y-2 text-xs">
      <Row label="project_id" value={meta.project_id} mono />
      {meta.artifact_id && <Row label="artifact_id" value={meta.artifact_id} mono />}
      {meta.status && <Row label="status" value={meta.status} />}
      {meta.risk && <Row label="risk" value={meta.risk} />}
      {stage === "phi" && (
        <div>
          <div className="text-muted-foreground uppercase text-[10px] tracking-wider mb-1">Φ failures</div>
          <ul className="list-disc pl-4 space-y-0.5">
            {(meta.reasons ?? []).map((r: string, i: number) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}
      {stage === "psi" && (
        <div>
          <div className="text-muted-foreground uppercase text-[10px] tracking-wider mb-1">Ψ conflicts</div>
          <ul className="list-disc pl-4 space-y-0.5">
            {(meta.conflicts ?? []).map((c: any, i: number) => (
              <li key={i}><span className="font-mono text-[10px]">{c.id?.slice(0, 8)}…</span> — {c.reason}</li>
            ))}
          </ul>
        </div>
      )}
      {verdict === "escalate" && meta.reason && (
        <div>
          <div className="text-muted-foreground uppercase text-[10px] tracking-wider mb-1">Escalation reason</div>
          <div>{meta.reason}</div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-24 shrink-0">{label}</span>
      <span className={mono ? "font-mono break-all" : ""}>{String(value)}</span>
    </div>
  );
}
