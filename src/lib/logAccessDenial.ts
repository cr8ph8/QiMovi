import { supabase } from "@/integrations/supabase/client";

export type AccessDenialEvent = "admin_route" | "judge_route" | "ops_badge" | "entrant_route";

/**
 * Fire-and-forget server-side logger for unauthorized access attempts to
 * Admin Control / OPS routes. The edge function captures the requester's IP
 * and User-Agent (which the browser cannot supply itself) and writes a
 * `denied` row to `auth_audit_log` via the service role.
 */
export async function logAccessDenial(
  eventType: AccessDenialEvent,
  opts: { resource?: string; reason?: string; details?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await supabase.functions.invoke("log-access-denial", {
      body: {
        event_type: eventType,
        resource: opts.resource,
        reason: opts.reason,
        details: {
          ...(opts.details ?? {}),
          path: typeof window !== "undefined" ? window.location.pathname : null,
          referrer: typeof document !== "undefined" ? document.referrer || null : null,
        },
      },
    });
  } catch {
    // Never let audit logging break the user flow.
  }
}
