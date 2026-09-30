// Renders the governed provenance behind a screenplay submission on the
// Review step: source OKF concept version lineage plus the retrieved assets
// (from linked retrieval traces) that fed the concept before draft generation.
//
// Data sources (read-only):
//   - project_artifacts     → concept artifact (id, version, payload_json, tags)
//   - governance_events     → event_type = 'okf_retrieval_link' filtered by
//                             metadata_json.artifact_id = <concept_id>

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Layers, FileText, Search, Loader2, GitBranch } from "lucide-react";

export type SubmissionProvenanceLineage = {
  draft_artifact_id?: string | null;
  draft_version?: number | null;
  draft_model?: string | null;
  pages_target?: string | null;
  source_concept_artifact_id?: string | null;
  source_concept_title?: string | null;
  source_concept_version?: number | null;
  source_concept_type?: string | null;
  source_concept_tags?: string[] | null;
  handoff_origin?: string | null;
} | null;

type ConceptRow = {
  id: string;
  version: number;
  payload_json: any;
  created_at: string;
};

type RetrievalHit = { artifact_id: string; title: string; type: string; score: number };
type RetrievalRow = {
  id: string;
  created_at: string;
  metadata_json: {
    query?: string;
    tag_filter?: string;
    top_k?: number;
    hit_count?: number;
    hits?: RetrievalHit[];
  };
};

interface Props {
  lineage: SubmissionProvenanceLineage;
}

export function SubmissionProvenanceSummary({ lineage }: Props) {
  const [loading, setLoading] = useState(false);
  const [concept, setConcept] = useState<ConceptRow | null>(null);
  const [conceptVersions, setConceptVersions] = useState<
    { version: number; created_at: string }[]
  >([]);
  const [traces, setTraces] = useState<RetrievalRow[]>([]);

  const conceptId = lineage?.source_concept_artifact_id ?? null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!conceptId) return;
      setLoading(true);
      try {
        // Concept artifact (current row)
        const { data: cRow } = await (supabase as any)
          .from("project_artifacts")
          .select("id, version, payload_json, created_at, project_id, artifact_type")
          .eq("id", conceptId)
          .maybeSingle();
        if (cancelled) return;
        setConcept(cRow as ConceptRow);

        // All versions of the same concept slug (same project + artifact_type + slug)
        // Fall back to just this row if we can't determine the slug.
        const slug = (cRow as any)?.payload_json?.concept?.slug
          ?? (cRow as any)?.payload_json?.slug
          ?? null;
        if (cRow && slug) {
          const { data: vRows } = await (supabase as any)
            .from("project_artifacts")
            .select("version, created_at, payload_json")
            .eq("project_id", (cRow as any).project_id)
            .eq("artifact_type", (cRow as any).artifact_type)
            .order("version", { ascending: true });
          const filtered = ((vRows as any[]) ?? [])
            .filter((r) =>
              (r?.payload_json?.concept?.slug ?? r?.payload_json?.slug) === slug,
            )
            .map((r) => ({ version: r.version as number, created_at: r.created_at as string }));
          if (!cancelled) setConceptVersions(filtered);
        } else if (cRow) {
          setConceptVersions([{ version: (cRow as any).version, created_at: (cRow as any).created_at }]);
        }

        // Retrieval trace links attached to this concept artifact
        const { data: tRows } = await (supabase as any)
          .from("governance_events")
          .select("id, created_at, metadata_json")
          .eq("event_type", "okf_retrieval_link")
          .contains("metadata_json", { artifact_id: conceptId })
          .order("created_at", { ascending: false })
          .limit(10);
        if (!cancelled) setTraces((tRows as RetrievalRow[]) ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conceptId]);

  // Dedup asset hits across all linked traces, keep best score.
  const assets = useMemo(() => {
    const map = new Map<string, RetrievalHit>();
    for (const t of traces) {
      for (const h of t.metadata_json?.hits ?? []) {
        if (!h?.artifact_id) continue;
        const prev = map.get(h.artifact_id);
        if (!prev || (h.score ?? 0) > (prev.score ?? 0)) map.set(h.artifact_id, h);
      }
    }
    return Array.from(map.values()).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }, [traces]);

  if (!lineage) {
    return (
      <div className="rounded-xl border border-border/40 bg-card/60 p-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 mb-1">
          <Layers className="h-3.5 w-3.5" />
          <span className="font-semibold uppercase tracking-wider">Provenance</span>
        </div>
        No governed lineage — this submission did not originate from a Pipeline handoff.
      </div>
    );
  }

  const tags = lineage.source_concept_tags ?? [];
  const activeVersion = lineage.source_concept_version ?? concept?.version ?? null;

  return (
    <div className="rounded-xl border border-border/40 bg-card/80 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-primary" />
        <h4 className="font-display text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Provenance Summary
        </h4>
        {lineage.handoff_origin && (
          <Badge variant="outline" className="text-[10px] font-mono">
            {lineage.handoff_origin}
          </Badge>
        )}
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />}
      </div>

      {/* Draft artifact */}
      <div className="rounded-lg border border-border/30 bg-muted/20 p-3 space-y-1">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <FileText className="h-3.5 w-3.5 text-primary" />
          <span>Draft artifact</span>
          {lineage.draft_version != null && (
            <Badge variant="outline" className="text-[10px] font-mono">v{lineage.draft_version}</Badge>
          )}
        </div>
        <div className="grid gap-1 text-xs sm:grid-cols-2">
          {lineage.draft_artifact_id && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">ID</span>
              <span className="font-mono truncate">{lineage.draft_artifact_id.slice(0, 12)}…</span>
            </div>
          )}
          {lineage.draft_model && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Model</span>
              <span className="font-mono truncate">{lineage.draft_model}</span>
            </div>
          )}
          {lineage.pages_target && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Pages target</span>
              <span className="font-mono">{lineage.pages_target}</span>
            </div>
          )}
        </div>
      </div>

      {/* Source concept version lineage */}
      <div className="rounded-lg border border-border/30 bg-muted/20 p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <GitBranch className="h-3.5 w-3.5 text-primary" />
          <span>Source OKF concept</span>
          {activeVersion != null && (
            <Badge variant="outline" className="text-[10px] font-mono">v{activeVersion}</Badge>
          )}
        </div>
        {lineage.source_concept_title && (
          <div className="text-sm font-medium">{lineage.source_concept_title}</div>
        )}
        <div className="flex flex-wrap gap-1 text-[10px] font-mono">
          {lineage.source_concept_type && (
            <Badge variant="secondary" className="text-[10px]">{lineage.source_concept_type}</Badge>
          )}
          {tags.slice(0, 8).map((t) => (
            <Badge key={t} variant="outline" className="text-[10px]">#{t}</Badge>
          ))}
        </div>
        {conceptVersions.length > 0 && (
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">
              Version lineage ({conceptVersions.length} total)
            </div>
            <div className="flex flex-wrap gap-1">
              {conceptVersions.map((v) => {
                const isActive = v.version === activeVersion;
                return (
                  <Badge
                    key={v.version}
                    variant={isActive ? "default" : "outline"}
                    className="text-[10px] font-mono"
                    title={new Date(v.created_at).toLocaleString()}
                  >
                    v{v.version}{isActive ? " · used" : ""}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Assets that fed the concept (from linked retrieval traces) */}
      <div className="rounded-lg border border-border/30 bg-muted/20 p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Search className="h-3.5 w-3.5 text-primary" />
          <span>Assets behind this screenplay</span>
          <Badge variant="outline" className="text-[10px] font-mono">{assets.length}</Badge>
        </div>
        {assets.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {loading ? "Loading retrieval receipts…" : "No linked retrieval trace found for this concept."}
          </p>
        ) : (
          <ul className="space-y-1">
            {assets.slice(0, 10).map((a) => (
              <li
                key={a.artifact_id}
                className="flex items-center justify-between gap-2 text-xs border-b border-border/20 pb-1 last:border-0 last:pb-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="outline" className="text-[10px] font-mono shrink-0">{a.type}</Badge>
                  <span className="truncate">{a.title || a.artifact_id.slice(0, 8)}</span>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                  {typeof a.score === "number" ? a.score.toFixed(3) : "—"}
                </span>
              </li>
            ))}
            {assets.length > 10 && (
              <li className="text-[11px] text-muted-foreground italic">
                +{assets.length - 10} more asset{assets.length - 10 === 1 ? "" : "s"}
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

export default SubmissionProvenanceSummary;
