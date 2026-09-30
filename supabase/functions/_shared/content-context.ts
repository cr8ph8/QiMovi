// _shared/content-context.ts
// Canonical ContentContext builder. Every model-calling edge function must
// route through buildContentContext() so the payload sent to any AI provider
// is versioned, hash-chained, and replayable.
//
// Persisted into public.context_bundles (payload_json + payload_hash + the
// exact payload_canonical_text bytes + prev_hash + output_request + mode).

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hasAdminRole } from "./auth.ts";

export type ContentContextMode =
  | "divergent"
  | "convergent"
  | "diagnostic"
  | "production";

export interface OutputRequest {
  mode: ContentContextMode;
  task: string;
  scope?: "scene" | "beat" | "script" | "project";
  constraints?: Record<string, unknown>;
  model_hint?: string;
}

export interface ContentContext {
  project_id: string;
  entry_id: string | null;
  sensitivity: string;
  parent_hash: string | null;
  content_hash: string;
  author_intent: {
    title: string | null;
    logline: string | null;
    themes: string[];
    tone: string | null;
    goals: string[];
  };
  narrative_tradition: { id: string | null; label: string | null };
  target_format: { category: string | null; page_bounds: { min: number | null; max: number | null } };
  story_plan: unknown | null;
  script_text: { fountain: string | null; page_count: number | null };
  characters: unknown[];
  world_rules: unknown[];
  locked_elements: unknown[];
  prior_artifacts: Array<{ artifact_type: string; version: number; id: string }>;
  revision_history: Array<{ ts: string; actor: string | null; from_state: string | null; to_state: string | null; reason: string | null }>;
  provenance: { ai_influence_score: number | null; gate_verdict: string | null; sources: unknown[] };
  output_request: OutputRequest;
}

export interface BuiltContext {
  context: ContentContext;
  bundle_id: string;
  context_hash: string;
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

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildContentContext(
  admin: SupabaseClient,
  projectId: string,
  outputRequest: OutputRequest,
  principalId: string,
): Promise<BuiltContext> {
  // Authorize before reading any project content. The supplied client commonly
  // carries the service role, so RLS cannot provide this boundary for us.
  const { data: projectAccess, error: accessErr } = await admin
    .from("projects")
    .select("id, owner_id")
    .eq("id", projectId)
    .maybeSingle();
  if (accessErr || !projectAccess) {
    throw new Error(`project ${projectId} not found`);
  }
  if (
    projectAccess.owner_id !== principalId &&
    !(await hasAdminRole(admin, principalId))
  ) {
    throw new Error("Forbidden");
  }

  // ── Project core ──
  const { data: project, error: projErr } = await admin
    .from("projects")
    .select("id, title, kind, lifecycle_state, tradition_id, mode_preference, locked_elements")
    .eq("id", projectId)
    .maybeSingle();
  if (projErr || !project) {
    throw new Error(`project ${projectId} not found: ${projErr?.message ?? "missing"}`);
  }
  const p = project as any;

  // ── Latest story_plan artifact ──
  const { data: planArt } = await admin
    .from("project_artifacts")
    .select("id, version, payload_json")
    .eq("project_id", projectId)
    .eq("artifact_type", "story_plan")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  // ── Latest fountain artifact ──
  const { data: foundationArt } = await admin
    .from("project_artifacts")
    .select("id, version, payload_json")
    .eq("project_id", projectId)
    .eq("artifact_type", "fountain")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const fountainPayload = (foundationArt as any)?.payload_json ?? {};

  // ── Prior artifacts index (last 25) ──
  const { data: priors } = await admin
    .from("project_artifacts")
    .select("id, artifact_type, version")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(25);

  // ── Revision history (last 25 lifecycle events) ──
  const { data: events } = await admin
    .from("project_lifecycle_events")
    .select("created_at, actor_id, from_state, to_state, reason")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(25);

  // ── Latest governance gate verdict ──
  // governance_events keys on entry_id; resolve via project_legacy_map.
  let gateVerdict: string | null = null;
  const { data: legacy, error: legacyErr } = await admin
    .from("project_legacy_map")
    .select("source_id")
    .eq("project_id", projectId)
    .eq("source_table", "entries")
    .maybeSingle();
  if (legacyErr) {
    throw new Error(`entry mapping could not be verified: ${legacyErr.message}`);
  }
  const entryId = (legacy as any)?.source_id ?? null;
  let sensitivity = "standard";
  if (entryId) {
    const { data: mappedEntry, error: entryErr } = await admin
      .from("entries")
      .select("sensitivity")
      .eq("id", entryId)
      .maybeSingle();
    if (entryErr || !mappedEntry) {
      throw new Error(
        `mapped entry ${entryId} could not be verified: ${entryErr?.message ?? "missing"}`,
      );
    }
    sensitivity = (mappedEntry as any).sensitivity ?? "standard";

    const { data: gate } = await admin
      .from("governance_events")
      .select("event_status")
      .eq("entry_id", entryId)
      .eq("event_type", "narrative_gate")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    gateVerdict = (gate as any)?.event_status ?? null;
  }

  // ── Parent hash from previous bundle for chaining ──
  const { data: prevBundle } = await admin
    .from("context_bundles")
    .select("payload_hash")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const parentHash = (prevBundle as any)?.payload_hash ?? null;

  // ── Assemble payload (excluding final content_hash) ──
  const base: Omit<ContentContext, "content_hash"> = {
    project_id: projectId,
    entry_id: entryId,
    sensitivity,
    parent_hash: parentHash,
    author_intent: {
      title: p.title ?? null,
      logline: fountainPayload.logline ?? null,
      themes: Array.isArray(fountainPayload.themes) ? fountainPayload.themes : [],
      tone: fountainPayload.tone ?? null,
      goals: [],
    },
    narrative_tradition: { id: p.tradition_id ?? null, label: null },
    target_format: {
      category: fountainPayload.category ?? null,
      page_bounds: { min: null, max: null },
    },
    story_plan: (planArt as any)?.payload_json ?? null,
    script_text: {
      fountain: fountainPayload.fountain_text ?? fountainPayload.fountain ?? null,
      page_count: fountainPayload.page_count ?? null,
    },
    characters: Array.isArray(fountainPayload.characters) ? fountainPayload.characters : [],
    world_rules: [],
    locked_elements: Array.isArray(p.locked_elements) ? p.locked_elements : [],
    prior_artifacts: (priors ?? []).map((a: any) => ({
      artifact_type: a.artifact_type, version: a.version, id: a.id,
    })),
    revision_history: (events ?? []).map((e: any) => ({
      ts: e.created_at,
      actor: e.actor_id ?? null,
      from_state: e.from_state ?? null,
      to_state: e.to_state ?? null,
      reason: e.reason ?? null,
    })),
    provenance: {
      ai_influence_score: null,
      gate_verdict: gateVerdict,
      sources: [],
    },
    output_request: outputRequest,
  };

  const hashableJson = canonicalStringify(base);
  const contentHash = await sha256Hex(hashableJson);
  const context: ContentContext = { ...base, content_hash: contentHash };

  // ── Persist ──
  const { data: inserted, error: insErr } = await admin
    .from("context_bundles")
    .insert({
      project_id: projectId,
      entry_id: entryId,
      built_by: principalId,
      payload_json: context,
      payload_hash: contentHash,
      payload_canonical_text: hashableJson,
      prev_hash: parentHash,
      continuity_verdict: gateVerdict,
      output_request: outputRequest,
      mode: outputRequest.mode,
    })
    .select("id")
    .single();

  if (insErr || !inserted) {
    throw new Error(`failed to persist context bundle: ${insErr?.message}`);
  }

  return {
    context,
    bundle_id: (inserted as any).id,
    context_hash: contentHash,
  };
}

/**
 * Resolve a context_ref back to its payload — ai-router uses this to enforce
 * that callers reference an existing, hash-verified bundle.
 */
export async function loadContextBundle(
  admin: SupabaseClient,
  bundleId: string,
  expectedHash?: string,
): Promise<ContentContext> {
  const { data, error } = await admin
    .from("context_bundles")
    .select("payload_json, payload_hash")
    .eq("id", bundleId)
    .maybeSingle();
  if (error || !data) throw new Error(`context bundle ${bundleId} not found`);
  if (expectedHash && (data as any).payload_hash !== expectedHash) {
    throw new Error("context bundle hash mismatch — payload changed since reference was issued");
  }
  return (data as any).payload_json as ContentContext;
}
