import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Loader2, GitBranch, ShieldCheck, ShieldX, FileText, Package, RefreshCw, ChevronRight,
} from "lucide-react";

interface Props {
  projectId: string | null;
}

interface Beat {
  index: number;
  heading: string;
  preview: string;
  conceptArtifactId: string | null;
}

interface ConceptTrace {
  artifactId: string;
  version: number;
  title: string;
  type: string;
  status: string;
  tags: string[];
  sources: Array<{ label: string; ref?: string }>;
  attempts: Array<{ id: string; attempt_no: number; verdict: string; stage: string; artifact_version: number | null; created_at: string; reasons: any }>;
  gateEvents: Array<{ id: string; status: string; created_at: string; metadata: any }>;
}

const SCENE_HEADING = /^(?:INT\.?|EXT\.?|EST\.?|INT\.?\/EXT\.?|I\/E)\b[^\n]*/i;

function parseBeats(fountain: string): Array<Omit<Beat, "conceptArtifactId">> {
  if (!fountain) return [];
  const lines = fountain.split(/\r?\n/);
  const beats: Array<Omit<Beat, "conceptArtifactId">> = [];
  let current: { heading: string; body: string[] } | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const isHeading =
      SCENE_HEADING.test(line) ||
      /^\.[A-Z]/.test(line) || // forced scene heading
      /^#{1,3}\s+/.test(line); // section
    if (isHeading) {
      if (current) beats.push({
        index: beats.length,
        heading: current.heading,
        preview: current.body.filter(Boolean).join(" ").slice(0, 160),
      });
      current = { heading: line.replace(/^#{1,3}\s+/, "").replace(/^\./, ""), body: [] };
    } else if (current && line) {
      if (current.body.join(" ").length < 200) current.body.push(line);
    }
  }
  if (current) beats.push({
    index: beats.length,
    heading: current.heading,
    preview: current.body.filter(Boolean).join(" ").slice(0, 160),
  });
  return beats;
}

function extractSources(concept: any): Array<{ label: string; ref?: string }> {
  const out: Array<{ label: string; ref?: string }> = [];
  const src = concept?.source;
  if (!src) return out;
  if (Array.isArray(src)) {
    for (const s of src) {
      if (typeof s === "string") out.push({ label: s });
      else if (s && typeof s === "object") out.push({ label: s.label || s.name || s.id || "asset", ref: s.id || s.ref });
    }
  } else if (typeof src === "string") {
    out.push({ label: src });
  } else if (typeof src === "object") {
    out.push({ label: src.label || src.name || "asset", ref: src.id });
  }
  return out;
}

export default function BeatProvenancePanel({ projectId }: Props) {
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<{ id: string; version: number; fountain: string; meta: any; createdAt: string } | null>(null);
  const [concepts, setConcepts] = useState<Record<string, ConceptTrace>>({});
  const [expanded, setExpanded] = useState<number | null>(0);

  async function load() {
    if (!projectId) return;
    setLoading(true);
    try {
      const { data: fRow } = await (supabase as any)
        .from("project_artifacts")
        .select("id, version, payload_json, created_at")
        .eq("project_id", projectId)
        .eq("artifact_type", "fountain")
        .eq("is_current", true)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!fRow) { setDraft(null); setConcepts({}); return; }
      const row = fRow as any;
      const meta = row.payload_json?._meta ?? {};
      setDraft({
        id: row.id,
        version: row.version,
        fountain: row.payload_json?.fountain_text ?? "",
        meta,
        createdAt: row.created_at,
      });

      const conceptIds = Array.from(new Set([meta.source_concept_artifact_id].filter(Boolean))) as string[];
      const map: Record<string, ConceptTrace> = {};
      for (const cid of conceptIds) {
        const [{ data: cRow }, { data: attempts }, { data: events }] = await Promise.all([
          (supabase as any).from("project_artifacts")
            .select("id, version, payload_json").eq("id", cid).maybeSingle(),
          (supabase as any).from("pipeline_concept_attempts")
            .select("id, attempt_no, verdict, stage, artifact_version, created_at, reasons")
            .eq("artifact_id", cid).order("attempt_no", { ascending: false }),
          (supabase as any).from("governance_events")
            .select("id, event_status, created_at, metadata_json")
            .eq("event_type", "concept.admit")
            .contains("metadata_json", { artifact_id: cid })
            .order("created_at", { ascending: false })
            .limit(20),
        ]);
        const c = (cRow as any)?.payload_json?.concept ?? {};
        map[cid] = {
          artifactId: cid,
          version: (cRow as any)?.version ?? 0,
          title: c.title ?? "Untitled",
          type: c.type ?? "concept",
          status: c.status ?? "draft",
          tags: Array.isArray(c.tags) ? c.tags : [],
          sources: extractSources(c),
          attempts: (attempts ?? []) as any,
          gateEvents: ((events ?? []) as any[]).map((e) => ({
            id: e.id, status: e.event_status, created_at: e.created_at, metadata: e.metadata_json,
          })),
        };
      }
      setConcepts(map);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [projectId]);

  const beats = useMemo<Beat[]>(() => {
    if (!draft) return [];
    const parsed = parseBeats(draft.fountain);
    const primaryConcept = draft.meta?.source_concept_artifact_id ?? null;
    return parsed.map((b) => ({ ...b, conceptArtifactId: primaryConcept }));
  }, [draft]);

  return (
    <div className="rounded border border-border/40 bg-card/40 overflow-hidden">
      <div className="p-3 border-b border-border/40 flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-primary" />
        <div className="text-sm font-medium">Beat provenance</div>
        <span className="text-[11px] text-muted-foreground">
          Each beat traced to gate-approved concept versions and source assets.
        </span>
        <div className="ml-auto">
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {loading && (
          <div className="py-6 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" /></div>
        )}
        {!loading && !draft && (
          <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
            No screenplay draft to trace yet.
          </CardContent></Card>
        )}
        {!loading && draft && (
          <>
            <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
              <span>Draft <span className="font-mono">v{draft.version}</span></span>
              <span>· {beats.length} beat{beats.length === 1 ? "" : "s"}</span>
              <span>· generated {new Date(draft.createdAt).toLocaleString()}</span>
              {draft.meta?.model && <span>· <span className="font-mono">{draft.meta.model}</span></span>}
            </div>

            {beats.length === 0 && (
              <div className="text-xs text-muted-foreground italic">
                No scene headings detected — provenance is shown at draft level.
              </div>
            )}

            <div className="divide-y divide-border/40 border border-border/40 rounded">
              {beats.map((beat) => {
                const trace = beat.conceptArtifactId ? concepts[beat.conceptArtifactId] : null;
                const isOpen = expanded === beat.index;
                return (
                  <div key={beat.index} className="text-sm">
                    <button
                      onClick={() => setExpanded(isOpen ? null : beat.index)}
                      className="w-full flex items-start gap-2 p-2 text-left hover:bg-background/50"
                    >
                      <ChevronRight className={`h-3.5 w-3.5 mt-0.5 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-mono text-muted-foreground">#{beat.index + 1}</span>
                          <span className="font-mono text-xs truncate">{beat.heading || "(untitled beat)"}</span>
                          {trace ? (
                            <Badge variant="outline" className="text-[10px]">
                              {trace.type} · {trace.title} · v{trace.version}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">no lineage</Badge>
                          )}
                        </div>
                        {beat.preview && (
                          <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{beat.preview}</div>
                        )}
                      </div>
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 pl-8 space-y-3">
                        {!trace && (
                          <div className="text-xs text-muted-foreground">
                            This beat has no attributed source concept. Generate the draft from a committed concept to establish lineage.
                          </div>
                        )}
                        {trace && (
                          <>
                            <div>
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Concept lineage</div>
                              <div className="text-xs flex flex-wrap items-center gap-1.5">
                                <Badge variant="outline" className="text-[10px]">{trace.type}</Badge>
                                <span className="font-medium">{trace.title}</span>
                                <Badge variant="outline" className="text-[10px]">v{trace.version}</Badge>
                                <Badge variant="secondary" className="text-[10px]">{trace.status}</Badge>
                                {trace.tags.slice(0, 4).map((t) => (
                                  <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                                ))}
                              </div>
                            </div>

                            <div>
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Gate verdicts</div>
                              {trace.attempts.length === 0 && trace.gateEvents.length === 0 && (
                                <div className="text-[11px] text-muted-foreground italic">No admission attempts recorded.</div>
                              )}
                              <div className="space-y-1">
                                {trace.attempts.slice(0, 5).map((a) => {
                                  const ok = a.verdict === "commit" || a.verdict === "accept";
                                  return (
                                    <div key={a.id} className="flex items-center gap-2 text-[11px]">
                                      {ok
                                        ? <ShieldCheck className="h-3 w-3 text-emerald-400" />
                                        : <ShieldX className="h-3 w-3 text-rose-400" />}
                                      <span className="font-mono">#{a.attempt_no}</span>
                                      <Badge variant={ok ? "default" : "destructive"} className="text-[10px]">{a.verdict}</Badge>
                                      <span className="text-muted-foreground">{a.stage}</span>
                                      {a.artifact_version != null && <span className="text-muted-foreground">→ v{a.artifact_version}</span>}
                                      <span className="text-muted-foreground ml-auto">{new Date(a.created_at).toLocaleString()}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            <div>
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Source assets</div>
                              {trace.sources.length === 0 ? (
                                <div className="text-[11px] text-muted-foreground italic">No explicit source assets on this concept.</div>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {trace.sources.map((s, i) => (
                                    <Badge key={i} variant="outline" className="text-[10px] gap-1">
                                      <Package className="h-3 w-3" />{s.label}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
