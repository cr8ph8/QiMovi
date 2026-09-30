import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hasAdminRole } from "./auth.ts";

type QFrameProject = {
  id: string;
  owner_id: string;
};

/**
 * Authorize a Q-Frame project before a service-role client reads or writes it.
 * Return a uniform 404 for missing and cross-tenant IDs so callers cannot use
 * this endpoint to enumerate projects.
 */
export async function requireQFrameProjectOwner(
  admin: SupabaseClient,
  userId: string,
  projectId: string,
  corsHeaders: Record<string, string>,
): Promise<{ project: QFrameProject } | Response> {
  const { data: project, error } = await admin
    .from("qframe_projects")
    .select("id, owner_id")
    .eq("id", projectId)
    .maybeSingle();

  if (
    error ||
    !project ||
    (project.owner_id !== userId && !(await hasAdminRole(admin, userId)))
  ) {
    return new Response(JSON.stringify({ error: "Project not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return { project: project as QFrameProject };
}
