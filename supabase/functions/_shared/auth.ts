// Shared auth helpers for edge functions.
// Edge functions are deployed with verify_jwt = false by default, so we must
// validate the JWT in code and reject anonymous (anon-key-only) callers.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface AuthResult {
  userId: string;
  admin: SupabaseClient;
  token: string;
}

export interface ProjectEntryAccess {
  projectId: string;
  entryId: string | null;
  project: { id: string; owner_id: string | null };
  entry: { id: string; user_id: string | null } | null;
}

/** Return whether a user carries the application-level admin role. */
export async function hasAdminRole(
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  return !error && data === true;
}

/**
 * Require a real (non-anon) JWT. Returns 401 Response on failure.
 * The returned `admin` client uses the service role and bypasses RLS — use it
 * for trusted server-side reads/writes only.
 */
export async function requireUser(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<AuthResult | Response> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token || token === ANON_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return { userId: data.user.id, admin, token };
}

/**
 * Require an authenticated admin user. Returns 401/403 on failure.
 */
export async function requireAdmin(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<AuthResult | Response> {
  const auth = await requireUser(req, corsHeaders);
  if (auth instanceof Response) return auth;

  const isAdmin = await hasAdminRole(auth.admin, auth.userId);
  if (!isAdmin) {
    return new Response(JSON.stringify({ error: "Admin access required" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return auth;
}
/**
 * Allow requests authenticated as an admin user OR carrying the service-role
 * bearer token (e.g. pg_cron / database webhooks). Returns 401/403 on failure.
 *
 * NOTE: The service-role key must never be exposed to the browser. Only use
 * this for endpoints that are exclusively called by trusted backend cron
 * jobs or admins from the dashboard.
 */
export async function requireAdminOrService(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<AuthResult | Response> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (token && token === SERVICE_KEY) {
    return {
      userId: "00000000-0000-0000-0000-000000000000",
      admin: createClient(SUPABASE_URL, SERVICE_KEY),
      token,
    };
  }

  return await requireAdmin(req, corsHeaders);
}


/**
 * Verify the authenticated user owns the entry. Returns 403/404 on failure.
 */
export async function requireEntryOwner(
  admin: SupabaseClient,
  userId: string,
  entryId: string,
  corsHeaders: Record<string, string>,
): Promise<{ entry: any } | Response> {
  const { data: entry, error } = await admin
    .from("entries")
    .select("id, user_id")
    .eq("id", entryId)
    .maybeSingle();
  if (error || !entry) {
    return new Response(JSON.stringify({ error: "Entry not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (entry.user_id !== userId) {
    // Allow admins
    const isAdmin = await hasAdminRole(admin, userId);
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return { entry };
}

/** Verify the authenticated user owns a unified project (admins may access any). */
export async function requireProjectOwner(
  admin: SupabaseClient,
  userId: string,
  projectId: string,
  corsHeaders: Record<string, string>,
): Promise<{ project: { id: string; owner_id: string | null } } | Response> {
  const { data: project, error } = await admin
    .from("projects")
    .select("id, owner_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !project) {
    return new Response(JSON.stringify({ error: "Project not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (project.owner_id !== userId && !(await hasAdminRole(admin, userId))) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return { project };
}

/**
 * Resolve and authorize a project/entry pair before a service-role client reads,
 * writes, charges, or calls an external model. When both IDs are supplied they
 * must refer to the same project.
 */
export async function requireProjectEntryAccess(
  admin: SupabaseClient,
  userId: string,
  input: { projectId?: string | null; entryId?: string | null },
  corsHeaders: Record<string, string>,
): Promise<ProjectEntryAccess | Response> {
  const requestedProjectId = input.projectId ?? null;
  const entryId = input.entryId ?? null;

  if (!requestedProjectId && !entryId) {
    return new Response(JSON.stringify({ error: "Project or entry is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Check an explicitly supplied project before resolving any other resource.
  let projectAccess: { project: { id: string; owner_id: string | null } } | null = null;
  if (requestedProjectId) {
    const checked = await requireProjectOwner(admin, userId, requestedProjectId, corsHeaders);
    if (checked instanceof Response) return checked;
    projectAccess = checked;
  }

  let entry: { id: string; user_id: string | null } | null = null;
  let mappedProjectId: string | null = null;
  if (entryId) {
    const checked = await requireEntryOwner(admin, userId, entryId, corsHeaders);
    if (checked instanceof Response) return checked;
    entry = checked.entry as { id: string; user_id: string | null };

    const { data: mapping, error: mappingError } = await admin
      .from("project_legacy_map")
      .select("project_id")
      .eq("source_table", "entries")
      .eq("source_id", entryId)
      .maybeSingle();
    if (mappingError || !mapping?.project_id) {
      return new Response(JSON.stringify({ error: "No unified project for this entry" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    mappedProjectId = mapping.project_id;

    if (requestedProjectId && requestedProjectId !== mappedProjectId) {
      return new Response(JSON.stringify({ error: "Entry does not belong to the requested project" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const projectId = requestedProjectId ?? mappedProjectId;
  if (!projectId) {
    return new Response(JSON.stringify({ error: "Project not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!projectAccess) {
    const checked = await requireProjectOwner(admin, userId, projectId, corsHeaders);
    if (checked instanceof Response) return checked;
    projectAccess = checked;
  }

  return {
    projectId,
    entryId,
    project: projectAccess.project,
    entry,
  };
}
