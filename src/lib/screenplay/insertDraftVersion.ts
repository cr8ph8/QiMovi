import { supabase } from "@/integrations/supabase/client";

export type TriggerAction =
  | "manual_edit"
  | "ai_rewrite"
  | "ai_suggest_apply"
  | "ai_compare_apply"
  | "promote_brief"
  | "import"
  | "restore"
  | "system";

const AI_TRIGGERS: ReadonlySet<TriggerAction> = new Set([
  "ai_rewrite",
  "ai_suggest_apply",
  "ai_compare_apply",
]);

export interface InsertDraftVersionInput {
  draftId: string;
  userId: string;
  fountainText: string;
  title?: string | null;
  pageCount?: number;
  triggerAction: TriggerAction;
  triggerFunction?: string | null;
  correlationId?: string | null;
  triggerMetadata?: Record<string, unknown>;
  /** When omitted, resolved from the most recent version for the draft. */
  parentVersionId?: string | null;
}

/**
 * Central insert helper for `screenplay_draft_versions`.
 *
 * Every AI-typed trigger gets a `correlation_id` — either the one the caller
 * received from an edge function, or a freshly-minted UUID — so the row is
 * always joinable to `ai_usage_log` / `governance_events`. `parent_version_id`
 * is auto-filled from the current head snapshot when the caller doesn't
 * pass one, which is what enables per-hunk blame walking downstream.
 */
export async function insertDraftVersion(input: InsertDraftVersionInput) {
  let parentVersionId = input.parentVersionId ?? null;
  if (parentVersionId === null) {
    const { data: head } = await supabase
      .from("screenplay_draft_versions")
      .select("id")
      .eq("draft_id", input.draftId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    parentVersionId = head?.id ?? null;
  }

  const correlationId =
    input.correlationId ??
    (AI_TRIGGERS.has(input.triggerAction) && typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : null);

  return supabase
    .from("screenplay_draft_versions")
    .insert({
      draft_id: input.draftId,
      user_id: input.userId,
      fountain_text: input.fountainText,
      title: input.title ?? null,
      page_count: input.pageCount ?? 0,
      source: input.triggerAction, // keep legacy column populated
      parent_version_id: parentVersionId,
      trigger_action: input.triggerAction,
      trigger_function: input.triggerFunction ?? null,
      correlation_id: correlationId,
      trigger_metadata: (input.triggerMetadata ?? {}) as never,
    })
    .select("id, correlation_id")
    .single();
}
