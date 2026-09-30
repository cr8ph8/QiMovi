import { useProject } from "@/hooks/useProject";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  projectId: string;
}

// Phase 3: unified read surface for screenplay / brief / qframe public views.
// Behind the project_lifecycle_v2 flag in consuming routes. Renders a minimal
// shell + delegates artifact rendering to type-specific viewers (added later).
export function PublicProjectView({ projectId }: Props) {
  const { project, currentArtifact, loading, error } = useProject(projectId);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (error || !project) {
    return (
      <Card className="p-6">
        <p className="text-muted-foreground">Project unavailable.</p>
      </Card>
    );
  }

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{project.kind}</Badge>
          <Badge>{project.lifecycle_state}</Badge>
        </div>
        <h1 className="font-display text-3xl">{project.title}</h1>
      </header>

      <Card className="p-6">
        {currentArtifact ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Current artifact: <code>{currentArtifact.artifact_type}</code> · v{currentArtifact.version}
            </p>
            {currentArtifact.legacy_table && currentArtifact.legacy_id && (
              <p className="text-xs text-muted-foreground">
                Source: {currentArtifact.legacy_table}/{currentArtifact.legacy_id}
              </p>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground">No current artifact attached.</p>
        )}
      </Card>
    </article>
  );
}

export default PublicProjectView;
