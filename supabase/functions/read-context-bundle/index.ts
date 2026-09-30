// read-context-bundle — read-only companion to `build-context-bundle`.
//
// Returns the latest persisted context bundle for a project/entry plus a
// lightweight provenance snapshot. Does NOT invoke the build spine, spend
// tokens, mirror into project_artifacts, or write governance events.
// Wrapped by readOnlyHandler → writes throw at the DB proxy.
//
// GET / POST / QUERY body: { project_id?: string; entry_id?: string; limit?: number }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hasAdminRole } from "../_shared/auth.ts";
import { readOnlyHandler } from "../_shared/queryContract.ts";

serve(
  readOnlyHandler(
    async ({ body, principalId }) => {
      const b = (body ?? {}) as { project_id?: string; entry_id?: string; limit?: number };
      if (!b.project_id && !b.entry_id) throw new Error("project_id or entry_id required");
      if (!principalId) throw new Error("Unauthorized");

      const url = Deno.env.get("SUPABASE_URL")!;
      const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const admin = createClient(url, service);

      // Resolve and cross-check the unified project for any entry anchor.
      let projectId = b.project_id ?? null;
      const entryId = b.entry_id ?? null;
      let isAdmin: boolean | null = null;
      const callerIsAdmin = async () => {
        if (isAdmin === null) isAdmin = await hasAdminRole(admin, principalId);
        return isAdmin;
      };

      if (entryId) {
        const { data: entry } = await admin
          .from("entries")
          .select("id, user_id")
          .eq("id", entryId)
          .maybeSingle();
        if (!entry) throw new Error("Entry not found");
        if (entry.user_id !== principalId && !(await callerIsAdmin())) {
          throw new Error("Forbidden");
        }

        const { data: leg } = await admin
          .from("project_legacy_map")
          .select("project_id")
          .eq("source_table", "entries")
          .eq("source_id", entryId)
          .maybeSingle();
        const mappedProjectId = (leg as { project_id?: string } | null)?.project_id ?? null;
        if (!mappedProjectId) throw new Error("No unified project for this entry");
        if (projectId && projectId !== mappedProjectId) {
          throw new Error("Entry does not belong to the requested project");
        }
        projectId = projectId ?? mappedProjectId;
      }
      if (!projectId) throw new Error("No unified project for this entry");

      // Ownership / admin check — bundles can carry sensitive context.
      const { data: proj } = await admin
        .from("projects")
        .select("id, owner_id")
        .eq("id", projectId)
        .maybeSingle();
      if (!proj) throw new Error("Project not found");
      if (proj.owner_id !== principalId) {
        if (!(await callerIsAdmin())) throw new Error("Forbidden");
      }

      const requestedLimit = Number(b.limit ?? 5);
      const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(20, Math.trunc(requestedLimit)))
        : 5;

      let bundlesQuery = admin
        .from("context_bundles")
        .select("id, entry_id, story_plan_hash, provenance_hash, continuity_node_id, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (entryId) bundlesQuery = bundlesQuery.eq("entry_id", entryId);

      const { data: bundles } = await bundlesQuery;

      const { data: artifacts } = await admin
        .from("project_artifacts")
        .select("id, artifact_type, payload_json, created_at, is_current")
        .eq("project_id", projectId)
        .eq("artifact_type", "context_bundle")
        .order("created_at", { ascending: false })
        .limit(limit);

      return {
        project_id: projectId,
        entry_id: entryId,
        bundles: bundles ?? [],
        artifact_mirrors: artifacts ?? [],
      };
    },
    {
      name: "read-context-bundle",
      context: (body) => {
        const b = (body ?? {}) as { entry_id?: string; project_id?: string };
        if (b.entry_id) return { kind: "entry", id: b.entry_id };
        if (b.project_id) return { kind: "project", id: b.project_id };
        return null;
      },
    },
  ),
);
