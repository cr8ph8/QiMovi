// Canonical read helper for screenplay fountain content.
//
// Phase B of the storage cleanup: `project_artifacts` is the source of truth.
// Legacy `entries.fountain_text` and `screenplay_drafts.fountain_text` columns
// are still present and kept in sync by DB mirror triggers, but every new
// reader should route through this helper so Phase C (physical column drop)
// is a one-file change.
import { supabase } from "@/integrations/supabase/client";

export type ScreenplayLegacySource = "screenplay_drafts" | "entries";

export interface ScreenplayArtifactRead {
  projectId: string | null;
  artifactId: string | null;
  fountainText: string;
  version: number | null;
  title: string | null;
  ownerId: string | null;
  updatedAt: string | null;
  legacySource: ScreenplayLegacySource;
  legacyId: string;
}

/**
 * Read the current fountain artifact for a legacy id. Falls back to the
 * legacy column read if no artifact exists yet (e.g. very old rows created
 * before the mirror trigger landed). Never throws — returns an empty payload
 * with a null artifactId on miss.
 */
export async function readFountain(
  source: ScreenplayLegacySource,
  legacyId: string
): Promise<ScreenplayArtifactRead> {
  const empty: ScreenplayArtifactRead = {
    projectId: null,
    artifactId: null,
    fountainText: "",
    version: null,
    title: null,
    ownerId: null,
    updatedAt: null,
    legacySource: source,
    legacyId,
  };
  if (!legacyId) return empty;

  const { data: mapRow } = await (supabase as any)
    .from("project_legacy_map")
    .select("project_id")
    .eq("source_table", source)
    .eq("source_id", legacyId)
    .maybeSingle();
  const projectId: string | null = (mapRow as any)?.project_id ?? null;

  if (!projectId) return await legacyFallback(source, legacyId, empty);

  const [{ data: proj }, { data: artifact }] = await Promise.all([
    (supabase as any)
      .from("projects")
      .select("id, owner_id, title, current_artifact_id, updated_at")
      .eq("id", projectId)
      .maybeSingle(),
    (supabase as any)
      .from("project_artifacts")
      .select("id, version, payload_json, updated_at, is_current")
      .eq("project_id", projectId)
      .eq("artifact_type", "fountain")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const payload = ((artifact as any)?.payload_json ?? {}) as Record<string, unknown>;
  const fountain = String((payload.fountain_text as string) ?? "");

  if (!artifact || !fountain) return await legacyFallback(source, legacyId, {
    ...empty,
    projectId,
    ownerId: ((proj as any)?.owner_id as string) ?? null,
    title: ((proj as any)?.title as string) ?? null,
  });

  return {
    projectId,
    artifactId: (artifact as any).id as string,
    fountainText: fountain,
    version: ((artifact as any).version as number) ?? null,
    title: ((proj as any)?.title as string) ?? null,
    ownerId: ((proj as any)?.owner_id as string) ?? null,
    updatedAt: ((artifact as any).updated_at as string) ?? null,
    legacySource: source,
    legacyId,
  };
}

async function legacyFallback(
  source: ScreenplayLegacySource,
  legacyId: string,
  base: ScreenplayArtifactRead
): Promise<ScreenplayArtifactRead> {
  const table = source === "entries" ? "entries" : "screenplay_drafts";
  const ownerCol = source === "entries" ? "user_id" : "user_id";
  const { data } = await (supabase as any)
    .from(table)
    .select(`id, title, ${ownerCol}, fountain_text, updated_at`)
    .eq("id", legacyId)
    .maybeSingle();
  if (!data) return base;
  return {
    ...base,
    fountainText: String((data as any).fountain_text ?? ""),
    title: ((data as any).title as string) ?? base.title,
    ownerId: ((data as any)[ownerCol] as string) ?? base.ownerId,
    updatedAt: ((data as any).updated_at as string) ?? base.updatedAt,
  };
}
