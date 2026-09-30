/**
 * Canonical client-side audit_log writer.
 *
 * Mirror of `supabase/functions/_shared/audit.ts` for browser code. Every
 * governance-relevant admin/user action logged from the client MUST go through
 * `logAuditEvent` so audit_log rows share a consistent shape:
 *   { user_id, action, details }.
 *
 * Failures are swallowed — auditing must never break the caller. The current
 * authenticated user id is filled in automatically when `userId` is omitted.
 */
import { supabase } from "@/integrations/supabase/client";

export interface AuditEventArgs {
  /** Explicit user id. When undefined we call auth.getUser(). Pass null for system-owned events. */
  userId?: string | null;
  action: string;
  target?: Record<string, unknown>;
  details?: Record<string, unknown>;
}

export async function logAuditEvent(args: AuditEventArgs): Promise<void> {
  try {
    let uid: string | null;
    if (args.userId === undefined) {
      const { data } = await supabase.auth.getUser();
      uid = data?.user?.id ?? null;
    } else {
      uid = args.userId;
    }
    await supabase.from("audit_log").insert({
      user_id: uid,
      action: args.action,
      details: { ...(args.target ?? {}), ...(args.details ?? {}) } as any,
    } as any);
  } catch (e) {
    // Never surface audit failures to the caller.
    // eslint-disable-next-line no-console
    console.warn("[audit] logAuditEvent failed (non-fatal):", e);
  }
}

/** Batch variant for panels that emit multiple rows in one flush. */
export async function logAuditEvents(events: AuditEventArgs[]): Promise<void> {
  if (!events.length) return;
  try {
    const { data } = await supabase.auth.getUser();
    const defaultUid = data?.user?.id ?? null;
    const rows = events.map((e) => ({
      user_id: e.userId === undefined ? defaultUid : e.userId,
      action: e.action,
      details: { ...(e.target ?? {}), ...(e.details ?? {}) } as any,
    }));
    await supabase.from("audit_log").insert(rows as any);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[audit] logAuditEvents failed (non-fatal):", e);
  }
}
