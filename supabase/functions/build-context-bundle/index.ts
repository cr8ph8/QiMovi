// build-context-bundle — thin wrapper around the canonical
// `buildContentContext` spine. Charges tokens, enriches the persisted
// bundle with entry-scoped extras (entry_id, hashes, continuity node),
// mirrors into project_artifacts, and emits a governance audit row.

import { logGovernanceAction } from "../_shared/audit.ts";
import {
  hasAdminRole,
  requireProjectEntryAccess,
  requireUser,
} from "../_shared/auth.ts";
import { buildContentContext } from "../_shared/content-context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Body {
  entry_id?: string;
  project_id?: string;
  /** Optional output_request override. Defaults to a diagnostic bundle. */
  output_request?: {
    mode?: "divergent" | "convergent" | "diagnostic" | "production";
    task?: string;
    scope?: "scene" | "beat" | "script" | "project";
    constraints?: Record<string, unknown>;
    model_hint?: string;
  };
  dry_run?: boolean;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalStringify(value: unknown): string {
  const sort = (v: any): any => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.keys(v).sort().reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sort(v[k]);
        return acc;
      }, {});
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anonKey) {
    return new Response(JSON.stringify({ error: "missing supabase env" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const auth = await requireUser(req, corsHeaders);
  if (auth instanceof Response) return auth;
  const authHeader = `Bearer ${auth.token}`;

  let body: Body;
  try { body = await req.json(); } catch { body = {}; }
  if (!body.entry_id && !body.project_id) {
    return new Response(JSON.stringify({ error: "entry_id or project_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
    return new Response(JSON.stringify({ error: "dry_run must be a boolean" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = auth.admin;
  if (body.dry_run && !(await hasAdminRole(admin, auth.userId))) {
    return new Response(JSON.stringify({ error: "Admin access required for dry_run" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Resolve IDs, verify ownership, and reject mismatched entry/project pairs
  // before any token charge or service-role content read.
  const access = await requireProjectEntryAccess(
    admin,
    auth.userId,
    { projectId: body.project_id, entryId: body.entry_id },
    corsHeaders,
  );
  if (access instanceof Response) return access;
  const { projectId, entryId } = access;

  // Charge tokens (skip on dry_run).
  if (!body.dry_run) {
    const spend = await fetch(`${url}/functions/v1/spend-tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({
        action: "context_bundle_build",
        label: "Context Bundle: build",
        entry_id: entryId ?? undefined,
      }),
    });
    if (!spend.ok) {
      return new Response(await spend.text(), {
        status: spend.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // ── Delegate to the canonical spine ──
  const outputRequest = {
    mode: (body.output_request?.mode ?? "diagnostic") as
      "divergent" | "convergent" | "diagnostic" | "production",
    task: body.output_request?.task ?? "context_bundle.build",
    scope: body.output_request?.scope,
    constraints: body.output_request?.constraints,
    model_hint: body.output_request?.model_hint,
  };

  let built;
  try {
    built = await buildContentContext(admin, projectId, outputRequest, auth.userId);
  } catch (e: any) {
    return new Response(JSON.stringify({ error: `context build failed: ${e?.message ?? e}` }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Extras: continuity node id + provenance snapshot hashes (entry-scoped) ──
  let continuityNodeId: string | null = null;
  let provenanceCount = 0;
  let provenanceHash: string | null = null;
  let storyPlanHash: string | null = null;

  if (built.context.story_plan) {
    storyPlanHash = await sha256Hex(canonicalStringify(built.context.story_plan));
  }
  if (entryId) {
    const { data: gov } = await admin
      .from("governance_events")
      .select("metadata_json")
      .eq("entry_id", entryId)
      .eq("event_type", "narrative_gate")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    continuityNodeId = ((gov as any)?.metadata_json?.provenance_node_id as string) ?? null;

    const { data: nodes } = await admin
      .from("provenance_nodes")
      .select("id, node_type, label, metadata_json, created_at")
      .eq("entry_id", entryId)
      .order("created_at", { ascending: false })
      .limit(50);
    provenanceCount = (nodes ?? []).length;
    provenanceHash = await sha256Hex(canonicalStringify(nodes ?? []));
  }

  if (body.dry_run) {
    return new Response(JSON.stringify({
      preview: built.context,
      integrity: { payload_hash: built.context_hash },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Backfill entry-scoped extras on the bundle row written by the spine.
  const { error: extrasError } = await admin.from("context_bundles")
    .update({
      entry_id: entryId,
      story_plan_hash: storyPlanHash,
      provenance_hash: provenanceHash,
      continuity_node_id: continuityNodeId,
    })
    .eq("id", built.bundle_id);
  if (extrasError) {
    return new Response(JSON.stringify({ error: "context bundle metadata update failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Mirror into project_artifacts so the bundle is visible in unified lineage.
  await admin.from("project_artifacts").insert({
    project_id: projectId,
    artifact_type: "context_bundle",
    payload_json: {
      bundle_id: built.bundle_id,
      payload_hash: built.context_hash,
      output_request: outputRequest,
    },
    is_current: true,
    created_by: auth.userId,
  });

  await logGovernanceAction({
    userId: auth.userId,
    action: "context_bundle.build",
    target: { project_id: projectId, entry_id: entryId, bundle_id: built.bundle_id },
    details: {
      payload_hash: built.context_hash,
      story_plan_present: Boolean(built.context.story_plan),
      provenance_nodes: provenanceCount,
      mode: outputRequest.mode,
      task: outputRequest.task,
    },
  });

  return new Response(JSON.stringify({
    bundle_id: built.bundle_id,
    payload_hash: built.context_hash,
    context: built.context,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
