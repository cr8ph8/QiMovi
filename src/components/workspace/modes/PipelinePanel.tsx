import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import StageAssets from "../pipeline/StageAssets";
import StageScreenplay from "../pipeline/StageScreenplay";
import StagePreproduction from "../pipeline/StagePreproduction";
import GateTimelinePanel from "../pipeline/GateTimelinePanel";
import AssetsToScreenplayFlow from "../pipeline/AssetsToScreenplayFlow";
import RetrievalTracePanel from "../pipeline/RetrievalTracePanel";
import OkfVersionHistoryPanel from "../pipeline/OkfVersionHistoryPanel";
import BeatProvenancePanel from "../pipeline/BeatProvenancePanel";
import ConceptAuditTimelinePanel from "../pipeline/ConceptAuditTimelinePanel";
import EditAuditPanel from "../pipeline/EditAuditPanel";
import { GateStatusChip } from "../pipeline/GateStatusChip";

interface Props {
  entryOrDraftId: string;
  kind: "draft" | "entry";
}

/**
 * Pipeline mode — unified Assets → Screenplay → Preproduction view.
 * OKF-organized, gate-admitted. Every stage transition goes through the
 * existing governance spine; this panel only surfaces the flow.
 */
export default function PipelinePanel({ entryOrDraftId, kind }: Props) {
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sourceTable = kind === "entry" ? "entries" : "screenplay_drafts";
      const { data } = await (supabase as any)
        .from("project_legacy_map")
        .select("project_id")
        .eq("source_table", sourceTable)
        .eq("source_id", entryOrDraftId)
        .maybeSingle();
      if (!cancelled) setProjectId((data as any)?.project_id ?? null);
    })();
    return () => { cancelled = true; };
  }, [entryOrDraftId, kind]);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-10">
      <header className="space-y-2">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="font-display text-2xl">Pipeline</h2>
          <GateStatusChip projectId={projectId} />
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Raw assets flow through a governed admission gate into your screenplay, then into preproduction packets.
          Every transition is ledgered. Nothing becomes durable state until it's admitted.
        </p>
      </header>
      <section><GateTimelinePanel projectId={projectId} /></section>
      <section><RetrievalTracePanel projectId={projectId} /></section>
      <section><OkfVersionHistoryPanel projectId={projectId} /></section>
      <section><ConceptAuditTimelinePanel projectId={projectId} /></section>
      <section><EditAuditPanel projectId={projectId} /></section>
      <section><AssetsToScreenplayFlow projectId={projectId} kind={kind} /></section>
      <section><BeatProvenancePanel projectId={projectId} /></section>
      <section className="border-t border-border/40 pt-8"><StageAssets projectId={projectId} entryOrDraftId={entryOrDraftId} kind={kind} /></section>
      <section className="border-t border-border/40 pt-8"><StageScreenplay projectId={projectId} entryOrDraftId={entryOrDraftId} kind={kind} /></section>
      <section className="border-t border-border/40 pt-8"><StagePreproduction projectId={projectId} entryOrDraftId={entryOrDraftId} kind={kind} /></section>
    </div>
  );
}
