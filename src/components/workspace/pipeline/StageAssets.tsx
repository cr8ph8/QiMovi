import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { ConceptCard, type ConceptStatus } from "./ConceptCard";
import { FileText, Upload, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useAdmitConcept } from "@/hooks/useAdmitConcept";

interface Props {
  projectId: string | null;
  entryOrDraftId: string;
  kind: "draft" | "entry";
}

/**
 * Stage A — Assets.
 * Surfaces the user's Brain Dump files as proposed OKF concepts. Each file
 * that has been parsed can be "admitted" as a governed concept on the
 * project. Nothing here bypasses the existing brain-dump pipeline.
 */
export default function StageAssets({ projectId, entryOrDraftId, kind }: Props) {
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { admit } = useAdmitConcept({ successVerb: "Admitted" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("brain_dump_files")
        .select("id, filename, structured, structured_status, created_at")
        .order("created_at", { ascending: false })
        .limit(24);
      if (!cancelled) {
        setFiles(data ?? []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function admitFile(file: any) {
    if (!projectId) {
      toast.error("Project not linked yet — open Insights once to hydrate the project record.");
      return;
    }
    const s = file.structured ?? {};
    setBusyId(file.id);
    await admit({
      project_id: projectId,
      concept: {
        type: (s.doc_type as string) || "Note",
        title: file.filename,
        status: "draft" as ConceptStatus,
        tags: Array.isArray(s.themes) ? s.themes.slice(0, 6) : [],
        source: `brain_dump_file:${file.id}`,
        body: (s.synopsis as string) || (s.logline as string) || "",
      },
    });
    setBusyId(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-xl">Stage A · Raw Assets</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Everything you upload lives here as untrusted material. Nothing becomes durable knowledge until it's admitted through the gate.
          </p>
        </div>
        <Link
          to="/brain-dump"
          className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded border border-border hover:border-primary/40 hover:text-primary transition-colors"
        >
          <Upload className="h-3.5 w-3.5" />
          Open Brain Dump
        </Link>
      </div>

      {loading && (
        <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
      )}

      {!loading && files.length === 0 && (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
          No assets yet. Upload notes, PDFs, transcripts, or references in Brain Dump.
        </CardContent></Card>
      )}

      {!loading && files.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {files.map((f) => {
            const parsed = f.structured_status === "done";
            return (
              <ConceptCard
                key={f.id}
                type={(f.structured?.doc_type as string) || "asset"}
                title={f.filename}
                status="draft"
                tags={Array.isArray(f.structured?.themes) ? f.structured.themes.slice(0, 4) : []}
                body={parsed ? (f.structured?.synopsis || f.structured?.logline || "Parsed. Ready to admit.") : "Not yet parsed."}
                onAdmit={parsed ? () => admitFile(f) : undefined}
                busy={busyId === f.id}
              />
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-end text-xs text-muted-foreground">
        <span>Next: admitted concepts feed Stage B</span>
        <ArrowRight className="h-3.5 w-3.5 ml-1" />
      </div>
    </div>
  );
}
