import { lazy, Suspense } from "react";
import { FileCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EvidenceCard } from "@/components/evidence/EvidenceCard";
import { UnifiedScorecard } from "@/components/scoring/UnifiedScorecard";
import type { ScreenplayKernel } from "@/hooks/useScreenplayKernel";
import type { ProjectRow, ProjectArtifactRow } from "@/hooks/useProject";

const EntryDetail = lazy(() => import("@/pages/EntryDetail"));

interface Props {
  kernel: ScreenplayKernel;
  project?: ProjectRow | null;
  currentArtifact?: ProjectArtifactRow | null;
}

/**
 * Insights mode panel. Today it delegates to the legacy EntryDetail page so
 * scoring, evidence, and reports keep rendering against `entries`. When
 * `project_lifecycle_v2` is on we additionally surface the unified project
 * payload as a shared EvidenceCard so consumers can verify the rewire
 * visually and the receipt banner matches Submit / Shield / Rollback.
 */
export default function InsightsPanel({ kernel, project, currentArtifact }: Props) {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      {kernel.kind === "entry" && (
        <div className="px-4 pt-3 pb-1">
          <UnifiedScorecard entryId={kernel.id} />
        </div>
      )}
      {project && currentArtifact && (
        <div className="px-4 pt-3 pb-1">
          <EvidenceCard
            title="Insights evidence"
            icon={FileCheck}
            tone="muted"
            subtitle={`Project · ${project.lifecycle_state}`}
            facts={[
              { label: "Artifact", value: `v${currentArtifact.version}`, mono: true },
              { label: "Type", value: currentArtifact.artifact_type, mono: true },
              { label: "Project ID", value: project.id, hash: true },
              { label: "Updated", value: new Date(currentArtifact.updated_at).toLocaleString(), mono: true },
            ]}
            details={{
              triggerLabel: "Evidence trail",
              drawerTitle: "Insights evidence trail",
              drawerDescription:
                "Lifecycle events, artifact versions, and disclosure status for this project.",
              disclosure: {
                label: `Lifecycle · ${project.lifecycle_state}`,
                tone: project.lifecycle_state === "submitted" ? "success" : "default",
                note: "State transitions are mirrored from `project_lifecycle_events`.",
              },
              receipts: [
                {
                  id: `artifact-${currentArtifact.id}`,
                  timestamp: currentArtifact.updated_at,
                  title: `Artifact v${currentArtifact.version} · ${currentArtifact.artifact_type}`,
                  badges: currentArtifact.is_current
                    ? [{ label: "current", tone: "success" as const }]
                    : [],
                  correlationId: currentArtifact.id,
                  actor: currentArtifact.created_by ?? undefined,
                },
                {
                  id: `project-${project.id}`,
                  timestamp: project.updated_at,
                  title: `Project state · ${project.lifecycle_state}`,
                  badges: [{ label: "lifecycle_v2", tone: "primary" as const }],
                  correlationId: project.id,
                },
              ],
              links: [
                {
                  label: "unified-project-lifecycle spec",
                  url: "/.lovable/memory/features/unified-project-lifecycle.md",
                  kind: "spec",
                },
              ],
            }}
          />
        </div>
      )}
      <EntryDetail />
    </Suspense>
  );
}
