// list-gate-decisions — returns recent OKF admission-gate decisions for a project.
// Reads governance_events rows with event_type='okf_admit' and metadata_json.project_id
// matching the requested project, after verifying the caller owns the project or is admin.
//
// GET / POST / QUERY body: { project_id: string, limit?: number }
//
// Wrapped by readOnlyHandler → emits x-query-hash / x-evidence-hash headers
// and writes a query_evidence_log row per invocation.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { readOnlyHandler } from "../_shared/queryContract.ts";

serve(
  readOnlyHandler(
    async ({ body, principalId }) => {
      const b = (body ?? {}) as { project_id?: string; limit?: number };
      const project_id = b.project_id;
      const limit = Math.min(200, Number(b.limit ?? 50));
      if (!project_id) throw new Error("project_id required");
      if (!principalId) throw new Error("Unauthorized");

      // Read-only admin lookup for ownership check. The QUERY contract read
      // client is intentionally not used here because ownership resolution
      // must bypass RLS.
      const url = Deno.env.get("SUPABASE_URL")!;
      const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const admin = createClient(url, service);

      const { data: proj } = await admin
        .from("projects")
        .select("id, owner_id")
        .eq("id", project_id)
        .maybeSingle();
      if (!proj) throw new Error("Project not found");
      if (proj.owner_id !== principalId) {
        const { data: isAdmin } = await admin.rpc("has_role", {
          _user_id: principalId,
          _role: "admin",
        });
        if (!isAdmin) throw new Error("Forbidden");
      }

      const { data, error } = await admin
        .from("governance_events")
        .select("id, event_type, event_status, metadata_json, created_at")
        .eq("event_type", "okf_admit")
        .contains("metadata_json", { project_id })
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return { events: data ?? [] };
    },
    {
      name: "list-gate-decisions",
      context: (body) => {
        const b = (body ?? {}) as { project_id?: string };
        return b.project_id ? { kind: "project", id: b.project_id } : null;
      },
    },
  ),
);
