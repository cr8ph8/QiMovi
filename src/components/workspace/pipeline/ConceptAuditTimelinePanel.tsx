import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, ShieldCheck, ShieldX, AlertTriangle, Link2, Search, ChevronRight, GitCommit } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface Props { projectId: string | null }

type Artifact = {
  id: string;
  version: number;
  is_current: boolean;
  updated_at: string;
  created_at: string;
  payload_json: any;
};

type Attempt = {
  id: string;
  artifact_id: string | null;
  attempt_no: number;
  verdict: string;
  stage: string;
  artifact_version: number | null;
  reasons: any;
  concept: any;
  created_at: string;
};

type Event = {
  id: string;
  event_type: string;
  event_status: string;
  metadata_json: any;
  created_at: string;
};

const slotKey = (t: string, title: string) =>
  `${(t ?? "").trim().toLowerCase()}::${(title ?? "").trim().toLowerCase()}`;

const conceptOf = (a: Artifact) => a.payload_json?.concept ?? {};

type TimelineItem = {
  kind: "commit" | "reject" | "escalate" | "retrieval_link" | "attempt" | "other";
  at: string;
  title: string;
  detail: string;
  eventId?: string;
  attemptId?: string;
  version?: number | null;
  badges?: { label: string; tone?: "default" | "ok" | "warn" | "bad" | "muted" }[];
  raw: any;
};

export default function ConceptAuditTimelinePanel({ projectId }: Props) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [slot, setSlot] = useState<string>("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rawFor, setRawFor] = useState<string | null>(null);

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [aRes, atRes, evRes] = await Promise.all([
        (supabase as any)
          .from("project_artifacts")
          .select("id, version, is_current, updated_at, created_at, payload_json")
          .eq("project_id", projectId)
          .eq("artifact_type", "okf_concept")
          .order("version", { ascending: false }),
        (supabase as any)
          .from("pipeline_concept_attempts")
          .select("id, artifact_id, attempt_no, verdict, stage, artifact_version, reasons, concept, created_at")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(500),
        (supabase as any)
          .from("governance_events")
          .select("id, event_type, event_status, metadata_json, created_at")
          .in("event_type", ["okf_admit", "okf_retrieval_link", "okf_retrieval_trace"])
          .order("created_at", { ascending: false })
          .limit(500),
      ]);
      if (aRes.error) throw aRes.error;
      setArtifacts((aRes.data ?? []) as Artifact[]);
      setAttempts((atRes.data ?? []) as Attempt[]);
      const evs = ((evRes.data ?? []) as Event[]).filter(
        (e) => (e.metadata_json?.project_id ?? null) === projectId,
      );
      setEvents(evs);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load audit timeline");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Group artifacts by concept slot
  const slots = useMemo(() => {
    const map = new Map<string, { label: string; artifacts: Artifact[] }>();
    for (const a of artifacts) {
      const c = conceptOf(a);
      const k = slotKey(c.type ?? "Unknown", c.title ?? "(untitled)");
      const entry = map.get(k) ?? {
        label: `${c.type ?? "Unknown"} · ${c.title ?? "(untitled)"}`,
        artifacts: [],
      };
      entry.artifacts.push(a);
      map.set(k, entry);
    }
    for (const [, v] of map) v.artifacts.sort((a, b) => b.version - a.version);
    return Array.from(map.entries()).sort((a, b) => a[1].label.localeCompare(b[1].label));
  }, [artifacts]);

  useEffect(() => {
    if (!slot && slots.length) setSlot(slots[0][0]);
  }, [slots, slot]);

  const active = slots.find(([k]) => k === slot)?.[1];

  // Build per-version buckets for active slot.
  const versionBuckets = useMemo(() => {
    if (!active) return [] as { artifact: Artifact | null; version: number | null; items: TimelineItem[] }[];
    const artifactIds = new Set(active.artifacts.map((a) => a.id));
    const activeSlotK = slot;

    // classify attempts & events into buckets keyed by artifact_id (or "orphan" for pre-commit rejects)
    const bucketMap = new Map<string, TimelineItem[]>();
    const push = (key: string, item: TimelineItem) => {
      const arr = bucketMap.get(key) ?? [];
      arr.push(item);
      bucketMap.set(key, arr);
    };

    // seed with existing artifacts
    for (const a of active.artifacts) {
      const c = conceptOf(a);
      push(a.id, {
        kind: "commit",
        at: a.created_at,
        title: `v${a.version} committed`,
        detail: `${c.status ?? "draft"}${c.risk && c.risk !== "low" ? ` · risk ${c.risk}` : ""}`,
        version: a.version,
        badges: [
          { label: `v${a.version}`, tone: "default" },
          ...(a.is_current ? [{ label: "current", tone: "ok" as const }] : []),
        ],
        raw: a,
      });
    }

    // attempts — match by artifact_id when present, otherwise by concept slot
    for (const at of attempts) {
      const c = at.concept ?? {};
      const belongs =
        (at.artifact_id && artifactIds.has(at.artifact_id)) ||
        slotKey(c.type ?? "", c.title ?? "") === activeSlotK;
      if (!belongs) continue;
      const key = at.artifact_id && artifactIds.has(at.artifact_id) ? at.artifact_id : "orphan";
      const reasons = Array.isArray(at.reasons)
        ? at.reasons.join("; ")
        : at.reasons?.reason ?? (typeof at.reasons === "string" ? at.reasons : "");
      const stageLabel =
        at.stage === "phi" ? "Φ frontmatter" :
        at.stage === "psi" ? "Ψ contradiction" :
        at.stage === "commit" ? "commit" : at.stage;
      push(key, {
        kind: at.verdict === "commit" ? "attempt" : (at.verdict as any),
        at: at.created_at,
        title: `attempt #${at.attempt_no} · ${stageLabel} · ${at.verdict}`,
        detail: reasons || "recorded",
        attemptId: at.id,
        version: at.artifact_version,
        badges: [
          { label: `attempt #${at.attempt_no}`, tone: "muted" },
          { label: at.verdict, tone: at.verdict === "commit" ? "ok" : at.verdict === "escalate" ? "warn" : "bad" },
        ],
        raw: at,
      });
    }

    // governance events
    for (const ev of events) {
      const meta = ev.metadata_json ?? {};
      const key =
        meta.artifact_id && artifactIds.has(meta.artifact_id)
          ? meta.artifact_id
          : slotKey(meta.concept_type ?? "", meta.concept_title ?? "") === activeSlotK
            ? "orphan"
            : null;
      if (!key) continue;

      if (ev.event_type === "okf_admit") {
        const verdict = meta.verdict ?? ev.event_status;
        const stage = meta.stage ?? ev.event_status;
        const stageLabel =
          stage === "phi" ? "Φ frontmatter" :
          stage === "psi" ? "Ψ contradiction" :
          stage === "commit" ? "commit" : stage;
        const detail =
          verdict === "commit"
            ? `Admitted as ${meta.status ?? "draft"}`
            : stage === "phi"
              ? `Φ failures: ${(meta.reasons ?? []).slice(0, 2).join("; ") || "invalid metadata"}`
              : stage === "psi"
                ? `Ψ conflict: ${(meta.conflicts ?? [])[0]?.reason ?? "contradiction"}`
                : verdict === "escalate"
                  ? (meta.reason ?? "held for review")
                  : "decision recorded";
        push(key, {
          kind: verdict === "commit" ? "commit" : verdict === "escalate" ? "escalate" : "reject",
          at: ev.created_at,
          title: `gate · ${stageLabel} · ${verdict}`,
          detail,
          eventId: ev.id,
          version: meta.version ?? null,
          badges: [
            { label: stageLabel, tone: "muted" },
            { label: verdict, tone: verdict === "commit" ? "ok" : verdict === "escalate" ? "warn" : "bad" },
          ],
          raw: ev,
        });
      } else if (ev.event_type === "okf_retrieval_link") {
        push(key, {
          kind: "retrieval_link",
          at: ev.created_at,
          title: `retrieval receipt linked`,
          detail: `trace ${String(meta.retrieval_trace_event_id ?? "").slice(0, 8)} · ${meta.hit_count ?? (meta.hits?.length ?? "?")} hit(s)`,
          eventId: ev.id,
          badges: [{ label: "retrieval link", tone: "muted" }],
          raw: ev,
        });
      } else if (ev.event_type === "okf_retrieval_trace") {
        push(key, {
          kind: "other",
          at: ev.created_at,
          title: `retrieval trace recorded`,
          detail: meta.query ? `query: ${String(meta.query).slice(0, 80)}` : "trace",
          eventId: ev.id,
          badges: [{ label: "trace", tone: "muted" }],
          raw: ev,
        });
      }
    }

    // build ordered buckets: each artifact + optional orphan bucket
    const buckets: { artifact: Artifact | null; version: number | null; items: TimelineItem[] }[] = [];
    for (const a of active.artifacts) {
      const items = (bucketMap.get(a.id) ?? []).sort((x, y) => +new Date(y.at) - +new Date(x.at));
      buckets.push({ artifact: a, version: a.version, items });
    }
    const orphans = (bucketMap.get("orphan") ?? []).sort((x, y) => +new Date(y.at) - +new Date(x.at));
    if (orphans.length) buckets.push({ artifact: null, version: null, items: orphans });
    return buckets;
  }, [active, attempts, events, slot]);

  if (!projectId) {
    return (
      <Card>
        <CardHeader><CardTitle className="font-display text-lg">Concept Audit Timeline</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">Project not linked yet.</p></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="font-display text-lg">Concept Audit Timeline</CardTitle>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Per-concept ledger: each committed version is grouped with every governance event and
            retrieval / admission receipt that produced it — attempts, Φ/Ψ verdicts, retrieval links.
            Rejected-before-commit attempts land in the <span className="font-medium">Pre-commit attempts</span> bucket.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && slots.length === 0 ? (
          <p className="text-xs text-muted-foreground">loading audit…</p>
        ) : slots.length === 0 ? (
          <p className="text-xs text-muted-foreground">No OKF concepts yet.</p>
        ) : (
          <>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Concept</label>
              <Select value={slot} onValueChange={(v) => { setSlot(v); setExpanded(null); setRawFor(null); }}>
                <SelectTrigger><SelectValue placeholder="Pick a concept" /></SelectTrigger>
                <SelectContent>
                  {slots.map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v.label}{" "}
                      <span className="text-muted-foreground">
                        · {v.artifacts.length} version{v.artifacts.length === 1 ? "" : "s"}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <ScrollArea className="max-h-[520px] pr-2">
              <ol className="space-y-4">
                {versionBuckets.map((b, i) => {
                  const label = b.artifact
                    ? `v${b.version}${b.artifact.is_current ? " · current" : ""}`
                    : "Pre-commit attempts";
                  return (
                    <li key={b.artifact?.id ?? `orphan-${i}`} className="border border-border/40 rounded">
                      <header className="px-3 py-2 border-b border-border/40 bg-muted/20 flex items-center gap-2 flex-wrap">
                        <GitCommit className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium">{label}</span>
                        {b.artifact && (
                          <span className="text-[10px] text-muted-foreground">
                            {formatDistanceToNow(new Date(b.artifact.created_at), { addSuffix: true })}
                          </span>
                        )}
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {b.items.length} event{b.items.length === 1 ? "" : "s"}
                        </span>
                      </header>
                      {b.items.length === 0 ? (
                        <div className="px-3 py-2 text-[11px] text-muted-foreground">
                          No governance receipts recorded for this version.
                        </div>
                      ) : (
                        <ul className="divide-y divide-border/30">
                          {b.items.map((it, idx) => {
                            const id = `${b.artifact?.id ?? "orphan"}-${idx}`;
                            const Icon =
                              it.kind === "commit" ? ShieldCheck :
                              it.kind === "reject" ? ShieldX :
                              it.kind === "escalate" ? AlertTriangle :
                              it.kind === "retrieval_link" ? Link2 :
                              it.kind === "attempt" ? GitCommit :
                              Search;
                            const iconClass =
                              it.kind === "commit" ? "text-emerald-400" :
                              it.kind === "reject" ? "text-red-400" :
                              it.kind === "escalate" ? "text-amber-400" :
                              "text-muted-foreground";
                            const isOpen = rawFor === id;
                            return (
                              <li key={id} className="text-xs">
                                <div className="flex items-start gap-2 px-3 py-2">
                                  <Icon className={`h-3.5 w-3.5 mt-0.5 ${iconClass}`} />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="font-medium truncate">{it.title}</span>
                                      {(it.badges ?? []).map((b, i) => (
                                        <Badge
                                          key={i}
                                          variant="outline"
                                          className={`text-[9px] ${
                                            b.tone === "ok" ? "border-emerald-500/40 text-emerald-400" :
                                            b.tone === "bad" ? "border-red-500/40 text-red-400" :
                                            b.tone === "warn" ? "border-amber-500/40 text-amber-400" :
                                            b.tone === "muted" ? "text-muted-foreground" : ""
                                          }`}
                                        >
                                          {b.label}
                                        </Badge>
                                      ))}
                                    </div>
                                    <div className="text-[11px] text-muted-foreground mt-0.5">
                                      {formatDistanceToNow(new Date(it.at), { addSuffix: true })} · {it.detail}
                                    </div>
                                    {(it.eventId || it.attemptId) && (
                                      <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                                        {it.eventId && <span>event {it.eventId.slice(0, 8)}</span>}
                                        {it.attemptId && <span>attempt {it.attemptId.slice(0, 8)}</span>}
                                      </div>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => setRawFor(isOpen ? null : id)}
                                    className="p-1 text-muted-foreground hover:text-foreground"
                                    aria-label="Toggle raw"
                                  >
                                    <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                                  </button>
                                </div>
                                {isOpen && (
                                  <pre className="mx-3 mb-2 rounded border border-border/40 bg-background/60 p-2 text-[10px] overflow-x-auto max-h-64">
{JSON.stringify(it.raw, null, 2)}
                                  </pre>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ol>
            </ScrollArea>
          </>
        )}
      </CardContent>
    </Card>
  );
}
