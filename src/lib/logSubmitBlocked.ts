import { supabase } from "@/integrations/supabase/client";

/**
 * Reason a submit attempt was blocked. Kept small and stable — new reasons
 * are additive and must be reflected in downstream dashboards.
 */
export type SubmitBlockedReason =
  | "submissions_closed"
  | "payments_closed"
  | "signups_closed"
  | "category_deadline_passed"
  | "ineligible_page_count"
  | "insufficient_tokens"
  | "unauthenticated";

export interface SubmitBlockedContext {
  /** URL slug or table id of the competition the user was aiming at, if known. */
  competition_id?: string | null;
  /** Length-category key from `ELIGIBILITY_RULES`, if the user had picked one. */
  length_category?: string | null;
  /** Human-readable competition label (e.g. "Season Zero — Short Film"). */
  competition_label?: string | null;
  /** Any extra key/values a caller wants surfaced in analytics (must be JSON). */
  extra?: Record<string, unknown>;
}

/**
 * Fire-and-forget analytics event for a BLOCKED submit attempt.
 *
 * Routes through the same `log-access-denial` edge function that powers
 * admin/judge route-guard events, so IP + User-Agent capture + audit
 * storage stay consistent across every guarded surface. The
 * `event_type` is the stable string `"submit_blocked"` — dashboards
 * filter on it directly.
 *
 * Callers pass a reason (see `SubmitBlockedReason`) and any competition
 * context they have. Missing context is fine (the row still identifies
 * WHERE the block happened via `window.location.pathname`), but callers
 * SHOULD pass whatever they know so the analytics event is queryable by
 * competition + category.
 *
 * Never throws — audit logging must not break the user flow.
 */
export async function logSubmitBlocked(
  reason: SubmitBlockedReason,
  context: SubmitBlockedContext = {},
): Promise<void> {
  try {
    await supabase.functions.invoke("log-access-denial", {
      body: {
        event_type: "submit_blocked",
        resource: "submission_portal",
        reason,
        details: {
          competition_id: context.competition_id ?? null,
          length_category: context.length_category ?? null,
          competition_label: context.competition_label ?? null,
          path: typeof window !== "undefined" ? window.location.pathname : null,
          referrer: typeof document !== "undefined" ? document.referrer || null : null,
          ...(context.extra ?? {}),
        },
      },
    });
  } catch {
    // Swallow — the user experience must not depend on audit success.
  }
}
