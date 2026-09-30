import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ProjectKind = "screenplay" | "brief" | "qframe" | "portfolio";
export type ProjectLifecycleState = "draft" | "in_review" | "submitted" | "scored" | "archived";
export type ProjectArtifactType =
  | "fountain"
  | "pdf"
  | "brief"
  | "qframe_bundle"
  | "coverage"
  | "scorecard"
  | "rewrite_diff"
  | "story_plan"
  | "context_bundle"
  | "preproduction_pack"
  | "okf_concept";
export type ProjectLegacySource =
  | "entries" | "screenplay_drafts" | "project_briefs" | "qframe_projects";

export interface ProjectRow {
  id: string;
  owner_id: string;
  title: string;
  kind: ProjectKind;
  lifecycle_state: ProjectLifecycleState;
  current_artifact_id: string | null;
  competition_id: string | null;
  universe_id: string | null;
  visibility: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectArtifactRow {
  id: string;
  project_id: string;
  artifact_type: ProjectArtifactType;
  legacy_table: ProjectLegacySource | null;
  legacy_id: string | null;
  version: number;
  is_current: boolean;
  storage_path: string | null;
  payload_json: unknown;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface UseProjectResult {
  project: ProjectRow | null;
  artifacts: ProjectArtifactRow[];
  currentArtifact: ProjectArtifactRow | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  attachArtifact: (input: {
    artifactType: ProjectArtifactType;
    legacyTable?: ProjectLegacySource | null;
    legacyId?: string | null;
    storagePath?: string | null;
    payload?: unknown;
  }) => Promise<string | null>;
  transition: (
    toState: ProjectLifecycleState,
    opts?: { reason?: string; evidenceHash?: string }
  ) => Promise<ProjectLifecycleState | null>;
}

export function useProject(projectId: string | null | undefined): UseProjectResult {
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [artifacts, setArtifacts] = useState<ProjectArtifactRow[]>([]);
  const [loading, setLoading] = useState<boolean>(!!projectId);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setProject(null);
      setArtifacts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const [{ data: p, error: pe }, { data: a, error: ae }] = await Promise.all([
      supabase.from("projects" as any).select("*").eq("id", projectId).maybeSingle(),
      supabase
        .from("project_artifacts" as any)
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
    ]);
    if (pe) setError(pe.message);
    if (ae) setError((prev) => prev ?? ae.message);
    setProject((p as any) ?? null);
    setArtifacts(((a as any) ?? []) as ProjectArtifactRow[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const attachArtifact = useCallback<UseProjectResult["attachArtifact"]>(
    async ({ artifactType, legacyTable = null, legacyId = null, storagePath = null, payload = null }) => {
      if (!projectId) return null;
      const { data, error: rpcErr } = await supabase.rpc("project_attach_artifact" as any, {
        p_project_id: projectId,
        p_artifact_type: artifactType,
        p_legacy_table: legacyTable,
        p_legacy_id: legacyId,
        p_storage_path: storagePath,
        p_payload: payload as any,
      });
      if (rpcErr) {
        setError(rpcErr.message);
        return null;
      }
      await refresh();
      return (data as string) ?? null;
    },
    [projectId, refresh]
  );

  const transition = useCallback<UseProjectResult["transition"]>(
    async (toState, opts) => {
      if (!projectId) return null;
      const { data, error: rpcErr } = await supabase.rpc("project_transition" as any, {
        p_project_id: projectId,
        p_to_state: toState,
        p_reason: opts?.reason ?? null,
        p_evidence_hash: opts?.evidenceHash ?? null,
      });
      if (rpcErr) {
        setError(rpcErr.message);
        return null;
      }
      await refresh();
      return (data as ProjectLifecycleState) ?? null;
    },
    [projectId, refresh]
  );

  const currentArtifact =
    artifacts.find((a) => a.id === project?.current_artifact_id) ??
    artifacts.find((a) => a.is_current) ??
    null;

  return { project, artifacts, currentArtifact, loading, error, refresh, attachArtifact, transition };
}

// Resolve a legacy id (entries/screenplay_drafts/project_briefs/qframe_projects)
// into a unified projects.id via the ensure-project edge function.
export async function ensureProjectId(
  source: ProjectLegacySource,
  sourceId: string
): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke("ensure-project", {
    body: { source, source_id: sourceId },
  });
  if (error) return null;
  return (data as any)?.project_id ?? null;
}
