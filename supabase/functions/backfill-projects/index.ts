// backfill-projects: admin-only, idempotent backfill of legacy rows into the
// unified projects + project_artifacts layer. Safe to re-run.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

type Source = "entries" | "screenplay_drafts" | "project_briefs" | "qframe_projects";

const PLAN: Array<{
  source: Source;
  kind: "screenplay" | "brief" | "qframe";
  artifact_type: "fountain" | "brief" | "qframe_bundle";
}> = [
  { source: "entries",           kind: "screenplay", artifact_type: "fountain" },
  { source: "screenplay_drafts", kind: "screenplay", artifact_type: "fountain" },
  { source: "project_briefs",    kind: "brief",      artifact_type: "brief" },
  { source: "qframe_projects",   kind: "qframe",     artifact_type: "qframe_bundle" },
];

const PAGE = 200;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

    const svc = createClient(supabaseUrl, serviceKey);
    const { data: isAdmin } = await svc.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (!isAdmin) return json({ error: "forbidden" }, 403);

    const dryRun = !!(await req.json().catch(() => ({})))?.dry_run;
    const report: Record<string, { scanned: number; projects_created: number; artifacts_created: number }> = {};

    for (const step of PLAN) {
      const stepReport = { scanned: 0, projects_created: 0, artifacts_created: 0 };
      let from = 0;

      while (true) {
        const { data: rows, error } = await svc
          .from(step.source)
          .select("id, user_id, title")
          .range(from, from + PAGE - 1);
        if (error) {
          return json({ error: "fetch_failed", source: step.source, details: error.message }, 500);
        }
        if (!rows || rows.length === 0) break;

        for (const row of rows as Array<{ id: string; user_id: string | null; title: string | null }>) {
          stepReport.scanned++;
          if (!row.user_id) continue;

          // Already mapped?
          const { data: existingMap } = await svc
            .from("project_legacy_map")
            .select("project_id")
            .eq("source_table", step.source)
            .eq("source_id", row.id)
            .maybeSingle();

          let projectId = existingMap?.project_id as string | undefined;

          if (!projectId) {
            if (dryRun) {
              stepReport.projects_created++;
              continue;
            }
            const { data: proj, error: projErr } = await svc
              .from("projects")
              .insert({
                owner_id: row.user_id,
                title: row.title ?? "Untitled",
                kind: step.kind,
                lifecycle_state: "draft",
              })
              .select("id")
              .single();
            if (projErr || !proj) continue;
            projectId = proj.id;
            stepReport.projects_created++;

            await svc.from("project_legacy_map").insert({
              project_id: projectId,
              source_table: step.source,
              source_id: row.id,
            });
          }

          // Already has an artifact pointing back to legacy row?
          const { data: existingArtifact } = await svc
            .from("project_artifacts")
            .select("id")
            .eq("legacy_table", step.source)
            .eq("legacy_id", row.id)
            .maybeSingle();

          if (!existingArtifact && !dryRun) {
            await svc.from("project_artifacts").insert({
              project_id: projectId,
              artifact_type: step.artifact_type,
              legacy_table: step.source,
              legacy_id: row.id,
              version: 1,
              is_current: true,
              created_by: row.user_id,
            });
            stepReport.artifacts_created++;

            await svc
              .from("projects")
              .update({ current_artifact_id: null })
              .eq("id", projectId);
          }
        }

        from += PAGE;
        if (rows.length < PAGE) break;
      }

      report[step.source] = stepReport;
    }

    return json({ ok: true, dry_run: dryRun, report });
  } catch (e) {
    return json({ error: "unexpected", message: String(e?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
