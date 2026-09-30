import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { ConceptCard, type ConceptStatus } from "./ConceptCard";
import { ConceptEditor, type ConceptDraft } from "./ConceptEditor";
import DraftProvenancePanel from "./DraftProvenancePanel";
import { PenLine, GitBranch, ArrowRight, Loader2, Plus, BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { buildStoryRoomPreviewHref } from "@/lib/storyRoomWorkspaceContext";

interface Props {
  projectId: string | null;
  entryOrDraftId: string;
  kind: "draft" | "entry";
}

/**
 * Stage B — Screenplay.
 * Shows the admitted OKF concepts that anchor the screenplay draft plus a
 * one-click jump into the Write / Plan / Continuity modes. This stage is
 * observational — the actual editing still happens in the dedicated modes.
 */
export default function StageScreenplay({ projectId, entryOrDraftId, kind }: Props) {
  const [concepts, setConcepts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<{ artifactId?: string; draft: ConceptDraft } | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from("project_artifacts" as any)
      .select("id, payload_json, version, is_current, created_at")
      .eq("project_id", projectId)
      .eq("artifact_type", "okf_concept")
      .eq("is_current", true)
      .order("created_at", { ascending: false })
      .limit(30);
    setConcepts((data as any[]) ?? []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { let c = false; (async () => { if (!c) await load(); })(); return () => { c = true; }; }, [load]);

  function openEdit(artifact: any) {
    const c = artifact.payload_json?.concept ?? {};
    setEditing({
      artifactId: artifact.id,
      draft: {
        type: c.type ?? "Concept",
        title: c.title ?? "Untitled",
        status: (c.status as ConceptStatus) ?? "draft",
        risk: c.risk ?? "low",
        tags: Array.isArray(c.tags) ? c.tags : [],
        source: c.source ?? "",
        body: c.body ?? "",
      },
    });
    setEditorOpen(true);
  }

  function openNew() {
    setEditing({
      draft: { type: "Concept", title: "", status: "draft", risk: "low", tags: [], source: "", body: "" },
    });
    setEditorOpen(true);
  }
  async function generateDraft(artifact: any) {
    if (!projectId) { toast.error("Project not linked yet"); return; }
    setGeneratingId(artifact.id);
    try {
      const { data, error } = await supabase.functions.invoke("generate-draft-from-concept", {
        body: {
          project_id: projectId,
          concept_artifact_id: artifact.id,
          entry_id: kind === "entry" ? entryOrDraftId : null,
          draft_id: kind === "draft" ? entryOrDraftId : null,
          pages_target: "short",
        },
      });
      if (error) throw error;
      const title = artifact.payload_json?.concept?.title ?? "concept";
      toast.success(`Draft v${(data as any)?.version ?? "?"} generated from "${title}". Open Write to review.`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to generate draft");
    } finally {
      setGeneratingId(null);
    }
  }


  const jumpBase = kind === "draft" ? "#write" : "#plan";
  const localStoryRoomHref = buildStoryRoomPreviewHref(
    projectId
      ? { projectId, subjectId: entryOrDraftId, kind }
      : null,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div>
          <h3 className="font-display text-xl">Stage B · Screenplay</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Admitted concepts anchor the draft. Continuity, story plan, and the context bundle all read from this ledger.
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
          {projectId && (
            <button
              type="button"
              onClick={openNew}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded border border-primary/40 text-primary hover:bg-primary/10 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              New concept
            </button>
          )}
          <Link to={localStoryRoomHref} className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded border border-border hover:border-primary/40 hover:text-primary transition-colors">
            <BookOpen className="h-3.5 w-3.5" />
            Story Room
          </Link>
          <Link to={jumpBase} className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded border border-border hover:border-primary/40 hover:text-primary transition-colors">
            <PenLine className="h-3.5 w-3.5" />
            Write
          </Link>
          {kind === "entry" && (
            <Link to="#continuity" className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded border border-border hover:border-primary/40 hover:text-primary transition-colors">
              <GitBranch className="h-3.5 w-3.5" />
              Continuity
            </Link>
          )}
        </div>
      </div>

      {!projectId && (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Project record not linked yet. Open the Insights tab once to hydrate it.
        </CardContent></Card>
      )}

      {loading && projectId && (
        <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
      )}

      {!loading && projectId && concepts.length === 0 && (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          No admitted concepts yet. Return to Stage A and admit an asset, or click <span className="text-primary">New concept</span> above.
        </CardContent></Card>
      )}

      {!loading && concepts.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {concepts.map((a) => {
            const c = a.payload_json?.concept ?? {};
            return (
              <ConceptCard
                key={a.id}
                type={c.type ?? "concept"}
                title={`${c.title ?? "Untitled"} · v${a.version}`}
                status={(c.status as ConceptStatus) ?? "draft"}
                tags={Array.isArray(c.tags) ? c.tags : []}
                body={c.body || ""}
                onEdit={() => openEdit(a)}
                onGenerateDraft={() => generateDraft(a)}
                generatingDraft={generatingId === a.id}
              />
            );
          })}
        </div>
      )}

      <DraftProvenancePanel projectId={projectId} />

      <div className="flex items-center justify-end text-xs text-muted-foreground">
        <span>Next: verified concepts + draft → preproduction bundle</span>
        <ArrowRight className="h-3.5 w-3.5 ml-1" />
      </div>

      {editing && projectId && (
        <ConceptEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          projectId={projectId}
          initial={editing.draft}
          artifactId={editing.artifactId}
          onCommitted={load}
        />
      )}
    </div>
  );
}
