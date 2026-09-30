/**
 * Client-side helper that mirrors legacy writes into the unified
 * projects / project_artifacts surface when `project_lifecycle_v2` is on.
 *
 * All calls are fire-and-forget — failures are logged but never throw
 * so legacy writers stay unaffected.
 */

import { supabase } from "@/integrations/supabase/client";
import { fetchFeatureFlag } from "@/hooks/useFeatureFlag";
import { ensureProjectId, type ProjectLegacySource, type ProjectArtifactType } from "@/hooks/useProject";

interface MirrorInput {
  source: ProjectLegacySource;
  sourceId: string;
  artifactType: ProjectArtifactType;
  storagePath?: string | null;
  payload?: unknown;
}

const FLAG = "project_lifecycle_v2";

export async function mirrorArtifact(input: MirrorInput): Promise<string | null> {
  try {
    const flag = await fetchFeatureFlag(FLAG);
    const on = flag === "on" || flag === "true" || flag === "1";
    if (!on) return null;
    const projectId = await ensureProjectId(input.source, input.sourceId);
    if (!projectId) return null;
    const { data, error } = await supabase.rpc("project_attach_artifact" as any, {
      p_project_id: projectId,
      p_artifact_type: input.artifactType,
      p_legacy_table: input.source,
      p_legacy_id: input.sourceId,
      p_storage_path: input.storagePath ?? null,
      p_payload: (input.payload ?? null) as any,
    });
    if (error) {
      console.warn("[projectMirror] attach failed", error.message);
      return null;
    }
    return (data as string) ?? null;
  } catch (e) {
    console.warn("[projectMirror] unexpected", e);
    return null;
  }
}
