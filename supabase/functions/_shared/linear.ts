// Shared Linear gateway client for CISS.
// All calls go through the Lovable connector gateway, never directly to api.linear.app.
// Requires LOVABLE_API_KEY and LINEAR_API_KEY env vars (set when the Linear
// connector is linked to the project).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/linear/graphql";

export interface LinearGraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; path?: unknown }>;
}

export function hasLinearCredentials(): boolean {
  return !!Deno.env.get("LOVABLE_API_KEY") && !!Deno.env.get("LINEAR_API_KEY");
}

export async function linearGraphQL<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const linearKey = Deno.env.get("LINEAR_API_KEY");
  if (!lovableKey) throw new Error("LOVABLE_API_KEY is not configured");
  if (!linearKey) throw new Error("LINEAR_API_KEY is not configured; link the Linear connector");

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": linearKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Linear gateway ${res.status}: ${text.slice(0, 500)}`);

  let body: LinearGraphQLResponse<T>;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Linear gateway returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (body.errors?.length) {
    throw new Error(`Linear GraphQL error: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  if (!body.data) throw new Error("Linear gateway returned no data");
  return body.data;
}

// ---------- Settings lookup (team / label IDs cached in site_settings) ----------

let settingsCache: Record<string, string> | null = null;

export async function loadLinearSettings(): Promise<Record<string, string>> {
  if (settingsCache) return settingsCache;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return (settingsCache = {});
  const admin = createClient(url, key);
  const { data } = await admin
    .from("site_settings")
    .select("key, text_value")
    .like("key", "linear.%");
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.text_value) map[row.key as string] = row.text_value as string;
  }
  settingsCache = map;
  return map;
}

export type LinearTeamSlot = "review_ops" | "ai_systems" | "support" | "product";

export async function resolveTeamId(slot: LinearTeamSlot): Promise<string | null> {
  const s = await loadLinearSettings();
  return s[`linear.team.${slot}`] ?? null;
}

export async function resolveLabelIds(slugs: string[]): Promise<string[]> {
  const s = await loadLinearSettings();
  const ids: string[] = [];
  for (const slug of slugs) {
    const id = s[`linear.label.${slug}`];
    if (id) ids.push(id);
  }
  return ids;
}

// ---------- Mutations ----------

export interface CreateIssueInput {
  teamId: string;
  title: string;
  description?: string;
  labelIds?: string[];
  priority?: number; // 0 none, 1 urgent, 2 high, 3 medium, 4 low
  assigneeId?: string;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  url: string;
  state?: { name: string };
  team?: { key: string };
}

export async function createLinearIssue(input: CreateIssueInput): Promise<LinearIssue> {
  const query = `
    mutation IssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          identifier
          url
          state { name }
          team { key }
        }
      }
    }
  `;
  const data = await linearGraphQL<{ issueCreate: { success: boolean; issue: LinearIssue } }>(
    query,
    { input },
  );
  if (!data.issueCreate.success) throw new Error("Linear issueCreate returned success=false");
  return data.issueCreate.issue;
}

export async function updateLinearIssue(
  issueId: string,
  input: { stateId?: string; assigneeId?: string; priority?: number },
): Promise<void> {
  const query = `
    mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success }
    }
  `;
  await linearGraphQL(query, { id: issueId, input });
}

export async function commentOnIssue(issueId: string, body: string): Promise<void> {
  const query = `
    mutation CommentCreate($input: CommentCreateInput!) {
      commentCreate(input: $input) { success }
    }
  `;
  await linearGraphQL(query, { input: { issueId, body } });
}

// ---------- Mirror table upsert ----------

export interface UpsertMirrorArgs {
  source: "submission" | "ai_failure" | "support" | "manual" | "governance";
  sourceTable: string | null;
  sourceRecordId: string | null;
  issue: LinearIssue;
  labels?: string[];
  correlationId?: string | null;
  payload?: Record<string, unknown>;
}

export async function mirrorIssue(args: UpsertMirrorArgs): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  const admin = createClient(url, key);
  await admin.rpc("upsert_linear_ticket", {
    _source: args.source,
    _source_table: args.sourceTable,
    _source_record_id: args.sourceRecordId,
    _linear_id: args.issue.id,
    _identifier: args.issue.identifier,
    _team_key: args.issue.team?.key ?? null,
    _title: args.payload?.title ?? args.issue.identifier,
    _state: args.issue.state?.name ?? null,
    _priority: null,
    _url: args.issue.url,
    _labels: args.labels ?? [],
    _assignee: null,
    _correlation_id: args.correlationId ?? null,
    _payload: args.payload ?? {},
  });
}

// ---------- Internal trigger helper ----------
// Other edge functions call this to fire-and-forget create a ticket without
// duplicating auth/dedupe logic. Safe to call when Linear is unconfigured —
// it logs and returns instead of throwing.

export interface TriggerArgs {
  source: "submission" | "ai_failure" | "support" | "manual" | "governance";
  sourceTable?: string | null;
  sourceRecordId?: string | null;
  teamSlot: LinearTeamSlot;
  title: string;
  description?: string;
  labelSlugs?: string[];
  priority?: number;
  correlationId?: string | null;
}

export async function triggerLinearTicket(args: TriggerArgs): Promise<void> {
  try {
    if (!hasLinearCredentials()) {
      console.warn("[linear] skip trigger — connector not linked");
      return;
    }
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;

    const teamId = await resolveTeamId(args.teamSlot);
    if (!teamId) {
      console.warn(`[linear] skip trigger — team ${args.teamSlot} not configured`);
      return;
    }
    const labelIds = await resolveLabelIds(args.labelSlugs ?? []);

    const issue = await createLinearIssue({
      teamId,
      title: args.title,
      description: args.description,
      labelIds: labelIds.length ? labelIds : undefined,
      priority: args.priority,
    });

    await mirrorIssue({
      source: args.source,
      sourceTable: args.sourceTable ?? null,
      sourceRecordId: args.sourceRecordId ?? null,
      issue,
      labels: args.labelSlugs ?? [],
      correlationId: args.correlationId ?? null,
      payload: { title: args.title, team_slot: args.teamSlot },
    });
  } catch (e) {
    console.error("[linear] triggerLinearTicket failed (non-fatal):", e);
  }
}
