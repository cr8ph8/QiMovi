// EditAuditPanel — one row per attempted edit, sourced from governance_events
// (event_type='okf_admit'). Each row carries the exact Φ/Ψ verdict, per-rule
// results, the before/after concept payload, and a click-through into the
// full GateDecisionModal.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, ShieldCheck, ShieldX, AlertTriangle, ChevronRight, Check, X, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import GateDecisionModal, { type GateEvent } from "./GateDecisionModal";

interface Props { projectId: string | null }

type Row = {
  id: string;
  event_type: string;
  event_status: string;
  metadata_json: any;
  created_at: string;
};

const verdictOf = (r: Row): "commit" | "reject" | "escalate" => {
  const m = r.metadata_json ?? {};
  if (m.verdict) return m.verdict;
  if (r.event_status === "commit") return "commit";
  if (r.event_status === "escalate") return "escalate";
  return "reject";
};

const stageOf = (r: Row): string => {
  const m = r.metadata_json ?? {};
  if (m.stage) return m.stage;
  if (r.event_status?.startsWith("reject_")) return r.event_status.replace("reject_", "");
  return r.event_status ?? "";
};

const summaryPayload = (c: any): string => {
  if (!c) return "«none»";
  const parts = [
    `type: ${c.type ?? "—"}`,
    `title: ${c.title ?? "—"}`,
    `status: ${c.status ?? "draft"}`,
    `risk: ${c.risk ?? "low"}`,
    `tags: ${Array.isArray(c.tags) && c.tags.length ? c.tags.join(", ") : "—"}`,
    `source: ${c.source ?? "—"}`,
    `body: ${(c.body ?? "").length} chars`,
  ];
  return parts.join("\n");
};

export default function EditAuditPanel({ projectId }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [verdictFilter, setVerdictFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [modalEvent, setModalEvent] = useState<GateEvent | null>(null);

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("governance_events")
        .select("id, event_type, event_status, metadata_json, created_at")
        .eq("event_type", "okf_admit")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const scoped = ((data ?? []) as Row[]).filter(
        (e) => (e.metadata_json?.project_id ?? null) === projectId,
      );
      setRows(scoped);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to load edit audit");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [projectId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (verdictFilter !== "all" && verdictOf(r) !== verdictFilter) return false;
      if (!q) return true;
      const m = r.metadata_json ?? {};
      const hay = [
        m.concept_type, m.concept_title,
        m.proposed?.type, m.proposed?.title,
        stageOf(r), verdictOf(r),
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [rows, verdictFilter, query]);

  const counts = useMemo(() => {
    const c = { commit: 0, reject: 0, escalate: 0 };
    for (const r of rows) c[verdictOf(r)]++;
    return c;
  }, [rows]);

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Edit audit</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              One row per attempted edit. Every Φ/Ψ rule result, before/after payload, and a click-through to the governance event.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={load} disabled={!projectId || loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search concept title, type, stage…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 text-xs max-w-xs"
            />
            <Select value={verdictFilter} onValueChange={setVerdictFilter}>
              <SelectTrigger className="h-8 text-xs w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All verdicts</SelectItem>
                <SelectItem value="commit">Commits ({counts.commit})</SelectItem>
                <SelectItem value="reject">Rejects ({counts.reject})</SelectItem>
                <SelectItem value="escalate">Escalations ({counts.escalate})</SelectItem>
              </SelectContent>
            </Select>
            <div className="ml-auto text-[11px] text-muted-foreground">
              {filtered.length} of {rows.length} attempts
            </div>
          </div>

          {!projectId ? (
            <div className="text-xs text-muted-foreground italic">Link a project to see its edit audit.</div>
          ) : rows.length === 0 && !loading ? (
            <div className="text-xs text-muted-foreground italic">No admission attempts recorded yet.</div>
          ) : (
            <ScrollArea className="max-h-[520px] pr-2">
              <div className="border border-border/30 rounded divide-y divide-border/20">
                {filtered.map((r) => (
                  <EditRow
                    key={r.id}
                    row={r}
                    open={expanded === r.id}
                    onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                    onOpenEvent={() => setModalEvent({
                      id: r.id,
                      event_type: r.event_type,
                      event_status: r.event_status,
                      metadata_json: r.metadata_json,
                      created_at: r.created_at,
                    })}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <GateDecisionModal
        event={modalEvent}
        open={!!modalEvent}
        onOpenChange={(v) => !v && setModalEvent(null)}
      />
    </>
  );
}

function EditRow({
  row,
  open,
  onToggle,
  onOpenEvent,
}: {
  row: Row;
  open: boolean;
  onToggle: () => void;
  onOpenEvent: () => void;
}) {
  const m = row.metadata_json ?? {};
  const verdict = verdictOf(row);
  const stage = stageOf(row);
  const proposed = m.proposed ?? {
    type: m.concept_type, title: m.concept_title, status: m.status, risk: m.risk,
  };
  const previous = m.previous?.concept ?? null;
  const phi: Array<{ id: string; label: string; pass: boolean; reason: string }> =
    Array.isArray(m.phi_checks) ? m.phi_checks : [];
  const conflicts: Array<{ id: string; reason: string; sibling_status?: string; sibling_version?: number }> =
    Array.isArray(m.conflicts) ? m.conflicts : [];

  const VIcon = verdict === "commit" ? ShieldCheck : verdict === "escalate" ? AlertTriangle : ShieldX;
  const vTone = verdict === "commit" ? "text-emerald-400" : verdict === "escalate" ? "text-amber-400" : "text-red-400";

  const phiPass = phi.filter((c) => c.pass).length;
  const phiFail = phi.length - phiPass;

  return (
    <Collapsible open={open} onOpenChange={onToggle}>
      <CollapsibleTrigger className="w-full text-left px-3 py-2 hover:bg-muted/30 transition-colors flex items-start gap-2 text-xs">
        <ChevronRight className={`h-3.5 w-3.5 mt-0.5 shrink-0 transition-transform ${open ? "rotate-90" : ""} text-muted-foreground`} />
        <VIcon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${vTone}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">
              {proposed?.type ?? "concept"} · {proposed?.title ?? "(untitled)"}
            </span>
            <Badge variant="outline" className={`text-[10px] ${vTone}`}>{verdict}</Badge>
            {stage && <Badge variant="secondary" className="text-[10px] uppercase">{stage}</Badge>}
            {m.version && <Badge variant="outline" className="text-[10px]">v{m.version}</Badge>}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
            {phi.length > 0 && <> · Φ {phiPass}/{phi.length} passed{phiFail > 0 ? ` · ${phiFail} failed` : ""}</>}
            {conflicts.length > 0 && <> · Ψ {conflicts.length} conflict{conflicts.length === 1 ? "" : "s"}</>}
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 pt-1 bg-background/30 border-t border-border/10 space-y-3">
        {/* Φ rule results */}
        {phi.length > 0 && (
          <div>
            <div className="text-muted-foreground uppercase tracking-wider text-[10px] mb-1">Φ rule results</div>
            <div className="border border-border/30 rounded divide-y divide-border/20">
              {phi.map((c) => (
                <div key={c.id} className="px-2 py-1.5 flex items-start gap-2 text-[11px]">
                  {c.pass
                    ? <Check className="h-3 w-3 mt-0.5 text-emerald-400 shrink-0" />
                    : <X className="h-3 w-3 mt-0.5 text-red-400 shrink-0" />}
                  <span className="flex-1">{c.label}</span>
                  <span className={c.pass ? "text-muted-foreground" : "text-red-300"}>{c.reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Ψ conflicts */}
        {conflicts.length > 0 && (
          <div>
            <div className="text-muted-foreground uppercase tracking-wider text-[10px] mb-1">Ψ conflicts</div>
            <div className="border border-border/30 rounded divide-y divide-border/20">
              {conflicts.map((c, i) => (
                <div key={i} className="px-2 py-1.5 flex items-center gap-2 text-[11px]">
                  <X className="h-3 w-3 text-red-400 shrink-0" />
                  <span className="font-mono opacity-70">{c.id?.slice(0, 8)}…</span>
                  {c.sibling_status && <Badge variant="secondary" className="text-[10px]">{c.sibling_status}</Badge>}
                  {c.sibling_version && <Badge variant="outline" className="text-[10px]">v{c.sibling_version}</Badge>}
                  <span className="text-red-300 ml-auto">{c.reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Before / after payload */}
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[10px] mb-1">Before / after payload</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] text-muted-foreground mb-1">
                Before {m.previous?.version ? <>· v{m.previous.version}</> : "· (no prior version)"}
              </div>
              <pre className="text-[10px] font-mono whitespace-pre-wrap bg-background/40 border border-border/40 rounded p-2 min-h-[80px]">
                {summaryPayload(previous)}
              </pre>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground mb-1">Proposed</div>
              <pre className="text-[10px] font-mono whitespace-pre-wrap bg-background/40 border border-border/40 rounded p-2 min-h-[80px]">
                {summaryPayload(proposed)}
              </pre>
            </div>
          </div>
        </div>

        {/* Escalation reason */}
        {verdict === "escalate" && m.reason && (
          <div className="rounded border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] text-amber-200">
            <span className="uppercase text-[10px] tracking-wider mr-2">Escalation reason:</span>{m.reason}
          </div>
        )}

        {/* Click-through */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] font-mono text-muted-foreground">event {row.id.slice(0, 8)}…</span>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onOpenEvent}>
            <ExternalLink className="h-3 w-3 mr-1" /> Open governance event
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
