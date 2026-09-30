import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Loader2, RefreshCw, FileText, Search, ScrollText, ChevronDown, ChevronRight, Layers,
} from "lucide-react";

interface Props {
  projectId: string | null;
}

type FountainRow = {
  id: string;
  version: number;
  created_at: string;
  meta: any;
};

type ConceptRow = {
  id: string;
  version: number;
  payload_json: any;
};

type RetrievalRow = {
  id: string;
  created_at: string;
  metadata_json: any;
};

type LedgerRow = {
  id: string;
  created_at: string;
  action: string;
  details: any;
};

/**
 * DraftProvenancePanel — for the current Fountain draft, shows:
 *  1. Source OKF concept (from artifact._meta.source_concept_artifact_id)
 *  2. Retrieval trace(s) linked to that concept (governance_events okf_retrieval_link)
 *  3. Generation ledger entry from audit_log (action = draft.generate_from_concept)
 */
export default function DraftProvenancePanel({ projectId }: Props) {
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<FountainRow | null>(null);
  const [concept, setConcept] = useState<ConceptRow | null>(null);
  const [traces, setTraces] = useState<RetrievalRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow | null>(null);
  const [conceptOpen, setConceptOpen] = useState(true);
  const [traceOpen, setTraceOpen] = useState(true);
  const [ledgerOpen, setLedgerOpen] = useState(true);

  const load = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data: fountainRow } = await supabase
        .from("project_artifacts" as any)
        .select("id, version, created_at, payload_json")
        .eq("project_id", projectId)
        .eq("artifact_type", "fountain")
        .eq("is_current", true)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!fountainRow) {
        setDraft(null); setConcept(null); setTraces([]); setLedger(null);
        setLoading(false);
        return;
      }

      const meta = (fountainRow as any).payload_json?._meta ?? {};
      const d: FountainRow = {
        id: (fountainRow as any).id,
        version: (fountainRow as any).version,
        created_at: (fountainRow as any).created_at,
        meta,
      };
      setDraft(d);

      // 1. Source OKF concept
      const conceptId = meta?.source_concept_artifact_id;
      if (conceptId) {
        const { data: cRow } = await supabase
          .from("project_artifacts" as any)
          .select("id, version, payload_json")
          .eq("id", conceptId)
          .maybeSingle();
        setConcept(cRow as any);

        // 2. Retrieval traces linked to that concept
        const { data: tRows } = await supabase
          .from("governance_events" as any)
          .select("id, created_at, metadata_json")
          .eq("event_type", "okf_retrieval_link")
          .contains("metadata_json", { artifact_id: conceptId })
          .order("created_at", { ascending: false })
          .limit(5);
        setTraces((tRows as any[]) ?? []);
      } else {
        setConcept(null);
        setTraces([]);
      }

      // 3. Ledger entry for this draft artifact
      const { data: lRows } = await supabase
        .from("audit_log" as any)
        .select("id, created_at, action, details")
        .eq("action", "draft.generate_from_concept")
        .contains("details", { artifact_id: d.id })
        .order("created_at", { ascending: false })
        .limit(1);
      setLedger(((lRows as any[]) ?? [])[0] ?? null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const conceptPayload = useMemo(() => concept?.payload_json?.concept ?? null, [concept]);

  if (!projectId) return null;

  return (
    <div className="rounded border border-border/40 bg-card/40 overflow-hidden">
      <div className="p-3 border-b border-border/40 flex items-center gap-2">
        <Layers className="h-4 w-4 text-primary" />
        <div className="text-sm font-medium">Draft provenance</div>
        {draft && (
          <Badge variant="outline" className="text-[10px]">draft v{draft.version}</Badge>
        )}
        <div className="ml-auto">
          <Button size="sm" variant="ghost" onClick={load} title="Refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {loading && (
          <div className="py-6 text-center">
            <Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" />
          </div>
        )}

        {!loading && !draft && (
          <Card><CardContent className="p-4 text-xs text-muted-foreground text-center">
            No current Fountain draft yet. Generate one from a concept to trace its provenance.
          </CardContent></Card>
        )}

        {!loading && draft && (
          <>
            {/* 1. Source concept */}
            <Collapsible open={conceptOpen} onOpenChange={setConceptOpen}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-muted/40">
                  {conceptOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  <FileText className="h-3.5 w-3.5 text-primary" />
                  <span className="font-medium">Source OKF concept</span>
                  {conceptPayload && (
                    <Badge variant="secondary" className="text-[10px] ml-auto">
                      v{concept?.version} · {conceptPayload.type ?? "concept"}
                    </Badge>
                  )}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="px-2 pt-2 space-y-2">
                {!conceptPayload && (
                  <div className="text-[11px] text-muted-foreground">
                    Concept not found. The draft may reference an artifact that was removed.
                  </div>
                )}
                {conceptPayload && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-medium">{conceptPayload.title ?? "Untitled"}</div>
                    <div className="flex flex-wrap gap-1">
                      {conceptPayload.status && (
                        <Badge variant="outline" className="text-[10px]">status: {conceptPayload.status}</Badge>
                      )}
                      {conceptPayload.risk && (
                        <Badge variant="outline" className="text-[10px]">risk: {conceptPayload.risk}</Badge>
                      )}
                      {Array.isArray(conceptPayload.tags) && conceptPayload.tags.slice(0, 8).map((t: string) => (
                        <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                      ))}
                    </div>
                    {conceptPayload.source && (
                      <div className="text-[11px] text-muted-foreground">source: {conceptPayload.source}</div>
                    )}
                    {conceptPayload.body && (
                      <pre className="text-[11px] leading-relaxed whitespace-pre-wrap p-2 rounded border border-border/40 bg-background/40 max-h-[140px] overflow-auto">
{String(conceptPayload.body).slice(0, 1200)}{String(conceptPayload.body).length > 1200 ? "…" : ""}
                      </pre>
                    )}
                    <div className="text-[10px] text-muted-foreground">
                      concept id: <span className="font-mono">{concept?.id}</span>
                    </div>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>

            {/* 2. Retrieval trace */}
            <Collapsible open={traceOpen} onOpenChange={setTraceOpen}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-muted/40">
                  {traceOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  <Search className="h-3.5 w-3.5 text-primary" />
                  <span className="font-medium">Retrieval trace</span>
                  <Badge variant="secondary" className="text-[10px] ml-auto">
                    {traces.length} receipt{traces.length === 1 ? "" : "s"}
                  </Badge>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="px-2 pt-2 space-y-2">
                {traces.length === 0 && (
                  <div className="text-[11px] text-muted-foreground">
                    No retrieval trace linked to this concept. Retrieval was either not used
                    or was performed before the trace-link feature.
                  </div>
                )}
                {traces.map((t) => {
                  const m = t.metadata_json ?? {};
                  const hits = Array.isArray(m.hits) ? m.hits : [];
                  return (
                    <div key={t.id} className="rounded border border-border/40 bg-background/40 p-2 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px]">top-k {m.top_k ?? "?"}</Badge>
                        <Badge variant="outline" className="text-[10px]">{m.hit_count ?? hits.length} hits</Badge>
                        {m.tag_filter && (
                          <Badge variant="secondary" className="text-[10px]">tag: {m.tag_filter}</Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {new Date(t.created_at).toLocaleString()}
                        </span>
                      </div>
                      {m.query && (
                        <div className="text-[11px] italic text-muted-foreground">
                          query: “{m.query}”
                        </div>
                      )}
                      {hits.length > 0 && (
                        <ul className="text-[11px] space-y-0.5">
                          {hits.slice(0, 6).map((h: any, i: number) => (
                            <li key={i} className="flex items-center gap-2">
                              <span className="text-muted-foreground">·</span>
                              <span className="font-medium truncate">{h.title ?? h.artifact_id}</span>
                              <Badge variant="outline" className="text-[9px]">{h.type ?? "artifact"}</Badge>
                              {typeof h.score === "number" && (
                                <span className="ml-auto tabular-nums text-muted-foreground">
                                  {h.score.toFixed(3)}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </CollapsibleContent>
            </Collapsible>

            {/* 3. Generation ledger entry */}
            <Collapsible open={ledgerOpen} onOpenChange={setLedgerOpen}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-muted/40">
                  {ledgerOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  <ScrollText className="h-3.5 w-3.5 text-primary" />
                  <span className="font-medium">Generation ledger entry</span>
                  {ledger && (
                    <Badge variant="secondary" className="text-[10px] ml-auto">
                      {new Date(ledger.created_at).toLocaleString()}
                    </Badge>
                  )}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="px-2 pt-2 space-y-2">
                {!ledger && (
                  <div className="text-[11px] text-muted-foreground">
                    No ledger row found for this draft artifact.
                  </div>
                )}
                {ledger && (
                  <div className="rounded border border-border/40 bg-background/40 p-2 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px]">{ledger.action}</Badge>
                      {ledger.details?.version && (
                        <Badge variant="outline" className="text-[10px]">v{ledger.details.version}</Badge>
                      )}
                      {ledger.details?.pages_target && (
                        <Badge variant="secondary" className="text-[10px]">{ledger.details.pages_target}</Badge>
                      )}
                      {ledger.details?.model && (
                        <Badge variant="outline" className="text-[10px] font-mono">{ledger.details.model}</Badge>
                      )}
                    </div>
                    {ledger.details?.concept_title && (
                      <div className="text-[11px] text-muted-foreground">
                        from concept “{ledger.details.concept_title}”
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground space-y-0.5">
                      <div>ledger id: <span className="font-mono">{ledger.id}</span></div>
                      {ledger.details?.source_concept_artifact_id && (
                        <div>source concept: <span className="font-mono">{ledger.details.source_concept_artifact_id}</span></div>
                      )}
                      {ledger.details?.entry_id && (
                        <div>entry: <span className="font-mono">{ledger.details.entry_id}</span></div>
                      )}
                    </div>
                    <pre className="text-[10px] leading-relaxed whitespace-pre-wrap p-2 rounded border border-border/40 bg-background/40 max-h-[160px] overflow-auto">
{JSON.stringify(ledger.details, null, 2)}
                    </pre>
                  </div>
                )}
                {/* Draft-side metadata (from artifact _meta) for cross-check */}
                {draft?.meta && (
                  <div className="rounded border border-dashed border-border/40 p-2 space-y-1">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Artifact _meta</div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] font-mono">
                      {draft.meta.model && <div>model: {draft.meta.model}</div>}
                      {draft.meta.pages_target && <div>pages: {draft.meta.pages_target}</div>}
                      {typeof draft.meta.prompt_tokens === "number" && <div>prompt_tok: {draft.meta.prompt_tokens}</div>}
                      {typeof draft.meta.completion_tokens === "number" && <div>completion_tok: {draft.meta.completion_tokens}</div>}
                      {typeof draft.meta.estimated_cost_cents === "number" && <div>~cost: {(draft.meta.estimated_cost_cents / 100).toFixed(3)}¢</div>}
                      {draft.meta.variant_label && <div>variant: {draft.meta.variant_label}</div>}
                    </div>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
      </div>
    </div>
  );
}
