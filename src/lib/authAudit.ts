import { supabase } from "@/integrations/supabase/client";

export type AuthDecision = "granted" | "denied" | "attempt" | "error";

/**
 * Fire-and-forget audit log for an auth/authorization decision.
 * Writes go through the `log_auth_decision` SECURITY DEFINER RPC; only
 * admins can read the resulting `auth_audit_log` rows.
 */
export async function logAuthDecision(
  eventType: string,
  decision: AuthDecision,
  opts: {
    resource?: string;
    reason?: string;
    draftId?: string;
    versionId?: string;
    before?: string;
    after?: string;
    details?: Record<string, unknown>;
  } = {},
): Promise<void> {
  try {
    await supabase.rpc("log_auth_decision", {
      p_event_type: eventType,
      p_decision: decision,
      p_resource: opts.resource ?? null,
      p_reason: opts.reason ?? null,
      p_details: {
        ...(opts.details ?? {}),
        ...(opts.draftId ? { draft_id: opts.draftId } : {}),
        ...(opts.versionId ? { version_id: opts.versionId } : {}),
        ...(opts.before ? { before: opts.before } : {}),
        ...(opts.after ? { after: opts.after } : {}),
        path: typeof window !== "undefined" ? window.location.pathname : null,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      } as any,
    });
  } catch {
    // Never let audit logging break the user flow.
  }
}
