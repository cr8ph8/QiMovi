// Single, canonical audit_log writer for every edge function.
//
// All governance-relevant events (token spend/transfer, subscription
// activation, model deprecation, exports, gate crashes, admin actions, etc.)
// must funnel through logGovernanceAction / writeAudit so audit_log rows share
// a consistent shape: { user_id, action, details }.
//
// Failures are swallowed — auditing must never break the user-facing call.
//
// Usage:
//   import { logGovernanceAction } from "../_shared/audit.ts";
//   await logGovernanceAction({
//     userId: user.id,
//     action: "spend_tokens",
//     details: { amount, label },
//   });
//
// `writeAudit` is a snake_case alias kept for existing callers.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface GovernanceAuditArgs {
  userId: string | null;
  action: string;                     // e.g. "shield.compute", "signalcheck.analyze"
  target?: Record<string, unknown>;   // ids and descriptors of the affected resource
  details?: Record<string, unknown>;  // anything else worth recording
}

export async function logGovernanceAction(args: GovernanceAuditArgs): Promise<void> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return;
    const admin = createClient(url, serviceKey);
    await admin.from("audit_log").insert({
      user_id: args.userId,
      action: args.action,
      details: { ...(args.target ?? {}), ...(args.details ?? {}) },
    });
  } catch (e) {
    console.error("[audit] logGovernanceAction failed (non-fatal):", e);
  }
}

// Backwards-compatible alias used by kernel-ops and older call sites.
export interface WriteAuditArgs {
  user_id: string | null;
  action: string;
  details?: Record<string, unknown>;
}

export function writeAudit(args: WriteAuditArgs): Promise<void> {
  return logGovernanceAction({
    userId: args.user_id,
    action: args.action,
    details: args.details,
  });
}
