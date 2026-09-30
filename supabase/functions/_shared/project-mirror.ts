// Edge-function helper that mirrors legacy writes into unified
// projects / project_artifacts when `project_lifecycle_v2` is on.
// Fire-and-forget: failures are logged, never thrown.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Source = "entries" | "screenplay_drafts" | "project_briefs" | "qframe_projects";
type ArtifactType =
  | "fountain" | "pdf" | "brief" | "qframe_bundle"
  | "coverage" | "scorecard" | "rewrite_diff"
  | "story_plan" | "context_bundle" | "preproduction_pack" | "okf_concept";

const KIND_BY_SOURCE: Record<Source, "screenplay" | "brief" | "qframe" | "portfolio"> = {
  entries: "screenplay",
  screenplay_drafts: "screenplay",
  project_briefs: "brief",
  qframe_projects: "qframe",
};

const FLAG = "project_lifecycle_v2";

async function isFlagOn(svc: ReturnType<typeof createClient>, userId: string | null): Promise<boolean> {
  const { data: global } = await svc.from("site_settings").select("text_value").eq("key", FLAG).maybeSingle();
  const g = (global as any)?.text_value;
  if (g === "on" || g === "true" || g === "1") return true;
  if (!userId) return false;
  const { data: grant } = await svc
    .from("user_feature_grants")
    .select("id, expires_at")
    .eq("user_id", userId)
    .eq("feature_id", FLAG)
    .maybeSingle();
  if (!grant) return false;
  const exp = (grant as any).expires_at;
  if (exp && new Date(exp).getTime() < Date.now()) return false;
  return true;
}

async function ensureProjectId(
  svc: ReturnType<typeof createClient>,
  source: Source,
  sourceId: string,
  ownerId: string,
  title: string,
): Promise<string | null> {
  const { data: existing } = await svc
    .from("project_legacy_map")
    .select("project_id")
    .eq("source_table", source)
    .eq("source_id", sourceId)
    .maybeSingle();
  if ((existing as any)?.project_id) return (existing as any).project_id as string;

  const { data: project, error: projErr } = await svc
    .from("projects")
    .insert({ owner_id: ownerId, title, kind: KIND_BY_SOURCE[source], lifecycle_state: "draft" })
    .select("id")
    .single();
  if (projErr || !project) {
    console.warn("[project-mirror] project insert failed", projErr?.message);
    return null;
  }

  const { error: mapErr } = await svc
    .from("project_legacy_map")
    .insert({ project_id: (project as any).id, source_table: source, source_id: sourceId });
  if (mapErr) {
    const { data: race } = await svc
      .from("project_legacy_map")
      .select("project_id")
      .eq("source_table", source)
      .eq("source_id", sourceId)
      .maybeSingle();
    if ((race as any)?.project_id) {
      await svc.from("projects").delete().eq("id", (project as any).id);
      return (race as any).project_id as string;
    }
    console.warn("[project-mirror] map insert failed", mapErr.message);
    return null;
  }
  return (project as any).id as string;
}

export interface MirrorEdgeInput {
  source: Source;
  sourceId: string;
  ownerId: string;
  title: string;
  artifactType: ArtifactType;
  payload?: unknown;
  storagePath?: string | null;
  userIdForFlag?: string | null;
}

export async function mirrorArtifactEdge(input: MirrorEdgeInput): Promise<string | null> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);
    const flagOn = await isFlagOn(svc, input.userIdForFlag ?? input.ownerId);
    if (!flagOn) return null;
    const projectId = await ensureProjectId(svc, input.source, input.sourceId, input.ownerId, input.title);
    if (!projectId) return null;
    const { data, error } = await svc.rpc("project_attach_artifact", {
      p_project_id: projectId,
      p_artifact_type: input.artifactType,
      p_legacy_table: input.source,
      p_legacy_id: input.sourceId,
      p_storage_path: input.storagePath ?? null,
      p_payload: (input.payload ?? null) as any,
    });
    if (error) {
      console.warn("[project-mirror] attach failed", error.message);
      return null;
    }
    return (data as string) ?? null;
  } catch (e) {
    console.warn("[project-mirror] unexpected", e);
    return null;
  }
}
