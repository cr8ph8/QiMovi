// ensure-project: idempotently resolve a legacy id (entries/screenplay_drafts/
// project_briefs/qframe_projects) into a unified projects row. Returns the
// project_id and whether it was newly created. Safe to call from anywhere.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hasAdminRole, requireProjectOwner } from "../_shared/auth.ts";

type Source = "entries" | "screenplay_drafts" | "project_briefs" | "qframe_projects";
type Kind = "screenplay" | "brief" | "qframe" | "portfolio";

const KIND_BY_SOURCE: Record<Source, Kind> = {
  entries: "screenplay",
  screenplay_drafts: "screenplay",
  project_briefs: "brief",
  qframe_projects: "qframe",
};

// Each legacy table exposes title + owner under different column names.
const OWNER_COL: Record<Source, string> = {
  entries: "user_id",
  screenplay_drafts: "user_id",
  project_briefs: "user_id",
  qframe_projects: "owner_id",
};

const TITLE_COL: Record<Source, string> = {
  entries: "title",
  screenplay_drafts: "title",
  project_briefs: "title",
  qframe_projects: "title",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const source = body?.source as Source | undefined;
    const sourceId = body?.source_id as string | undefined;

    if (!source || !sourceId || !(source in KIND_BY_SOURCE)) {
      return json({ error: "invalid_body", message: "expected { source, source_id }" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Auth as caller, then escalate via service role.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
    const callerId = userData.user.id;

    // 1) Already mapped? Query as the caller so project/map RLS establishes
    // ownership before any service-role read occurs.
    const { data: existing } = await userClient
      .from("project_legacy_map")
      .select("project_id")
      .eq("source_table", source)
      .eq("source_id", sourceId)
      .maybeSingle();

    if (existing?.project_id) {
      return json({ project_id: existing.project_id, created: false });
    }

    // 2) Pull the legacy row as the caller. Owner policies prevent the
    // service role from becoming a resource-existence oracle.
    const ownerCol = OWNER_COL[source];
    const titleCol = TITLE_COL[source];
    const { data: legacy, error: legacyErr } = await userClient
      .from(source)
      .select(`id, ${ownerCol}, ${titleCol}`)
      .eq("id", sourceId)
      .maybeSingle();

    if (legacyErr || !legacy) {
      return json({ error: "legacy_not_found", details: legacyErr?.message }, 404);
    }

    const ownerId = (legacy as any)[ownerCol] as string | null | undefined;
    const title = (legacy as any)[titleCol] ?? "Untitled";

    // Never let a caller claim an ownerless legacy row. Only an admin may map
    // it, and the resulting project remains ownerless until deliberately
    // assigned through an administrative workflow.
    if (!ownerId || ownerId !== callerId) {
      const svcForRoleCheck = createClient(supabaseUrl, serviceKey);
      if (!(await hasAdminRole(svcForRoleCheck, callerId))) {
        return json({ error: "forbidden" }, 403);
      }
    }

    // Authorization is now established; service role is used only for the
    // multi-table mapping mutation.
    const svc = createClient(supabaseUrl, serviceKey);

    // 3) Create project + map atomically (best-effort: insert then map).
    const { data: project, error: projErr } = await svc
      .from("projects")
      .insert({
        owner_id: ownerId ?? null,
        title,
        kind: KIND_BY_SOURCE[source],
        lifecycle_state: "draft",
      })
      .select("id")
      .single();

    if (projErr || !project) {
      return json({ error: "project_insert_failed", details: projErr?.message }, 500);
    }

    const { error: mapErr } = await svc
      .from("project_legacy_map")
      .insert({
        project_id: project.id,
        source_table: source,
        source_id: sourceId,
      });

    if (mapErr) {
      // Race: another caller mapped first — fetch and return that one.
      const { data: race } = await svc
        .from("project_legacy_map")
        .select("project_id")
        .eq("source_table", source)
        .eq("source_id", sourceId)
        .maybeSingle();
      if (race?.project_id) {
        // Rollback the duplicate project we just created.
        await svc.from("projects").delete().eq("id", project.id);
        const access = await requireProjectOwner(
          svc,
          callerId,
          race.project_id,
          corsHeaders,
        );
        if (access instanceof Response) return access;
        return json({ project_id: race.project_id, created: false });
      }
      return json({ error: "map_insert_failed", details: mapErr.message }, 500);
    }

    return json({ project_id: project.id, created: true });
  } catch (e: unknown) {
    return json({
      error: "unexpected",
      message: e instanceof Error ? e.message : String(e),
    }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
