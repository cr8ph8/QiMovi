import { lazy, Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useScreenplayKernel } from "@/hooks/useScreenplayKernel";
import { useProject, ensureProjectId, type ProjectLegacySource } from "@/hooks/useProject";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { WorkspaceShell, useWorkspaceMode, type WorkspaceMode } from "@/components/workspace/WorkspaceShell";
import UnavailableMode from "@/components/workspace/modes/UnavailableMode";
import TemplatesPanel from "@/components/workspace/modes/TemplatesPanel";
import InsightsPanel from "@/components/workspace/modes/InsightsPanel";
import WritePanel from "@/components/workspace/modes/WritePanel";
import DraftsPanel from "@/components/workspace/modes/DraftsPanel";
import SubmitPanel from "@/components/workspace/modes/SubmitPanel";
import BrainDumpPanel from "@/components/workspace/modes/BrainDumpPanel";
import ContinuityPanel from "@/components/workspace/modes/ContinuityPanel";
import ContextBundlePanel from "@/components/workspace/modes/ContextBundlePanel";
import StoryPlanPanel from "@/components/workspace/modes/StoryPlanPanel";
import PitchPanel from "@/components/workspace/modes/PitchPanel";
import CollaboratePanel from "@/components/workspace/modes/CollaboratePanel";
import KnowledgeWorkspacePanel from "@/components/workspace/modes/KnowledgeWorkspacePanel";
import PipelinePanel from "@/components/workspace/modes/PipelinePanel";
import ForkEntryToDraft from "@/components/workspace/ForkEntryToDraft";
import { Skeleton } from "@/components/ui/skeleton";

// Legacy lazy pages still used when `workspace_shell_v2` is off so behavior
// matches the previous wrap-based shell byte-for-byte until the flag flips.
const LegacyEntryDetail = lazy(() => import("./EntryDetail"));
const LegacyScreenplayWriter = lazy(() => import("./ScreenplayWriter"));
const LegacyMyDrafts = lazy(() => import("./MyDrafts"));
const LegacySubmissionPortal = lazy(() => import("./SubmissionPortal"));
const LegacyBrainDump = lazy(() => import("./BrainDump"));

function ModeFallback() {
  return (
    <div className="p-8 space-y-4">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/**
 * Unified writer workspace at `/entry/:id`.
 *
 * Two flag-driven render paths:
 *   1. `workspace_shell_v2` OFF (default) — preserves the original wrap of
 *      legacy pages so nothing changes for existing users.
 *   2. `workspace_shell_v2` ON — renders dedicated mode panels under
 *      `components/workspace/modes/`, optionally hydrating a unified
 *      `projects` row via `useProject` when `project_lifecycle_v2` is on.
 */
export default function EntryWorkspace() {
  const { id } = useParams<{ id: string }>();
  const { kernel, loading, notFound } = useScreenplayKernel(id);
  const { isOn: shellV2 } = useFeatureFlag("workspace_shell_v2");
  const { isOn: projectV2 } = useFeatureFlag("project_lifecycle_v2");

  // When both flags are on, resolve the kernel id into a unified project id.
  const [projectId, setProjectId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setProjectId(null);
    if (!shellV2 || !projectV2 || !kernel) return;
    const source: ProjectLegacySource = kernel.kind === "draft" ? "screenplay_drafts" : "entries";
    void ensureProjectId(source, kernel.id).then((pid) => {
      if (!cancelled) setProjectId(pid);
    });
    return () => {
      cancelled = true;
    };
  }, [shellV2, projectV2, kernel?.id, kernel?.kind]);

  const { project, currentArtifact } = useProject(projectId);

  const isDraft = kernel?.kind === "draft";
  const disabledModes: WorkspaceMode[] = isDraft ? ["insights"] : [];
  const defaultMode: WorkspaceMode = isDraft ? "write" : "insights";
  const [mode, setMode] = useWorkspaceMode(defaultMode);

  useEffect(() => {
    if (kernel && disabledModes.includes(mode)) setMode(defaultMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernel?.kind]);

  // Keep Write mode's `?draft=` search param in sync with the kernel id when
  // the kernel is a draft, so the embedded editor opens the right document.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (mode !== "write" || !isDraft || !kernel) return;
    if (searchParams.get("draft") === kernel.id) return;
    const next = new URLSearchParams(searchParams);
    next.set("draft", kernel.id);
    setSearchParams(next, { replace: true });
  }, [mode, isDraft, kernel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <ModeFallback />;
  if (notFound || !kernel) {
    return (
      <UnavailableMode
        title="Screenplay not found"
        reason="We couldn't find a submission or draft with this id. It may have been deleted or you may not have access."
      />
    );
  }

  // -------- shell v2: native mode panels --------
  if (shellV2) {
    return (
      <WorkspaceShell kernel={kernel} mode={mode} onModeChange={setMode} disabledModes={disabledModes}>
        <Suspense fallback={<ModeFallback />}>
          {mode === "insights" && (
            kernel.kind === "entry" ? (
              <InsightsPanel kernel={kernel} project={project} currentArtifact={currentArtifact} />
            ) : (
              <UnavailableMode
                title="Insights unlock after submission"
                reason="Finish your draft and submit it to a competition or to your portfolio to see the full Insights surface — scoring, reports, evidence, and the relationship graph."
              />
            )
          )}
          {mode === "write" && (
            kernel.kind === "draft" ? (
              <WritePanel draftId={kernel.id} />
            ) : (
              <ForkEntryToDraft entry={{ id: kernel.id, title: kernel.title, raw: kernel.raw }} targetMode="write" />
            )
          )}
          {mode === "drafts" && <DraftsPanel />}
          {mode === "templates" && <TemplatesPanel draftId={isDraft ? kernel.id : undefined} />}
          {mode === "braindump" && <BrainDumpPanel />}
          {mode === "continuity" && (
            kernel.kind === "entry" ? (
              <ContinuityPanel entryId={kernel.id} />
            ) : (
              <UnavailableMode
                title="Continuity gate runs on submitted entries"
                reason="Fork or submit your draft to attach it to an entry. The narrative gate anchors on entries because that's where governance, provenance, and ledger records live."
              />
            )
          )}
          {mode === "bundle" && (
            kernel.kind === "entry" ? (
              <ContextBundlePanel entryId={kernel.id} />
            ) : (
              <UnavailableMode
                title="Context Bundle runs on submitted entries"
                reason="The bundle assembles provenance, story plan, and the latest continuity verdict — all anchored on an entry. Submit or fork your draft first."
              />
            )
          )}
          {mode === "plan" && (
            kernel.kind === "entry" ? (
              <StoryPlanPanel entryId={kernel.id} />
            ) : (
              <UnavailableMode
                title="Story Plan anchors on submitted entries"
                reason="The plan artifact is versioned against the unified project record. Submit your draft to mint an entry, then generate the plan."
              />
            )
          )}
          {mode === "pitch" && (
            kernel.kind === "entry" ? (
              <PitchPanel entryId={kernel.id} />
            ) : (
              <UnavailableMode
                title="Pitch packets anchor on submitted entries"
                reason="The pitch builder pulls from your entry's canonical logline, characters, and parsed scenes. Submit your draft to mint an entry, then build the packet."
              />
            )
          )}
          {mode === "collaborate" && (
            kernel.kind === "entry" ? (
              <CollaboratePanel entryId={kernel.id} />
            ) : (
              <UnavailableMode
                title="Collaboration is scoped to entries"
                reason="Collaborator roles, share links, and structured reviews live on the entry record. Submit your draft to invite collaborators."
              />
            )
          )}
          {mode === "knowledge" && <KnowledgeWorkspacePanel />}
          {mode === "pipeline" && <PipelinePanel entryOrDraftId={kernel.id} kind={kernel.kind as "draft" | "entry"} />}
          {mode === "submit" && (
            kernel.kind === "draft" ? (
              <SubmitPanel sourceEntryId={(kernel.raw as any).source_entry_id ?? null} />
            ) : (
              <ForkEntryToDraft entry={{ id: kernel.id, title: kernel.title, raw: kernel.raw }} targetMode="submit" />
            )
          )}
        </Suspense>
      </WorkspaceShell>
    );
  }

  // -------- legacy wrap behavior (flag off) --------
  return (
    <WorkspaceShell kernel={kernel} mode={mode} onModeChange={setMode} disabledModes={disabledModes}>
      <Suspense fallback={<ModeFallback />}>
        {mode === "insights" && (
          kernel.kind === "entry" ? (
            <LegacyEntryDetail />
          ) : (
            <UnavailableMode
              title="Insights unlock after submission"
              reason="Finish your draft and submit it to a competition or to your portfolio to see the full Insights surface — scoring, reports, evidence, and the relationship graph."
            />
          )
        )}
        {mode === "write" && (
          kernel.kind === "draft" ? (
            <LegacyScreenplayWriter />
          ) : (
            <ForkEntryToDraft entry={{ id: kernel.id, title: kernel.title, raw: kernel.raw }} targetMode="write" />
          )
        )}
        {mode === "drafts" && <LegacyMyDrafts />}
        {mode === "templates" && <TemplatesPanel draftId={isDraft ? kernel.id : undefined} />}
        {mode === "braindump" && <LegacyBrainDump />}
        {mode === "continuity" && (
          kernel.kind === "entry" ? (
            <ContinuityPanel entryId={kernel.id} />
          ) : (
            <UnavailableMode
              title="Continuity gate runs on submitted entries"
              reason="Fork or submit your draft to attach it to an entry. The narrative gate anchors on entries because that's where governance, provenance, and ledger records live."
            />
          )
        )}
        {mode === "bundle" && (
          kernel.kind === "entry" ? (
            <ContextBundlePanel entryId={kernel.id} />
          ) : (
            <UnavailableMode
              title="Context Bundle runs on submitted entries"
              reason="The bundle assembles provenance, story plan, and the latest continuity verdict — all anchored on an entry."
            />
          )
        )}
        {mode === "plan" && (
          kernel.kind === "entry" ? (
            <StoryPlanPanel entryId={kernel.id} />
          ) : (
            <UnavailableMode
              title="Story Plan anchors on submitted entries"
              reason="The plan artifact is versioned against the unified project record. Submit your draft to mint an entry, then generate the plan."
            />
          )
        )}
        {mode === "pitch" && (
          kernel.kind === "entry" ? (
            <PitchPanel entryId={kernel.id} />
          ) : (
            <UnavailableMode
              title="Pitch packets anchor on submitted entries"
              reason="The pitch builder pulls from your entry's canonical logline, characters, and parsed scenes. Submit your draft to mint an entry, then build the packet."
            />
          )
        )}
        {mode === "collaborate" && (
          kernel.kind === "entry" ? (
            <CollaboratePanel entryId={kernel.id} />
          ) : (
            <UnavailableMode
              title="Collaboration is scoped to entries"
              reason="Collaborator roles, share links, and structured reviews live on the entry record. Submit your draft to invite collaborators."
            />
          )
        )}
        {mode === "knowledge" && <KnowledgeWorkspacePanel />}
        {mode === "pipeline" && <PipelinePanel entryOrDraftId={kernel.id} kind={kernel.kind as "draft" | "entry"} />}
        {mode === "submit" && (
          kernel.kind === "draft" ? (
            <LegacySubmissionPortal sourceEntryId={(kernel.raw as any).source_entry_id ?? null} />
          ) : (
            <ForkEntryToDraft entry={{ id: kernel.id, title: kernel.title, raw: kernel.raw }} targetMode="submit" />
          )
        )}
      </Suspense>
    </WorkspaceShell>
  );
}
