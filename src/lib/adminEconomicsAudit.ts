import { supabase } from "@/integrations/supabase/client";
import { logAuditEvent } from "@/lib/audit";

/**
 * Admin Economics audit trail.
 *
 * Writes a structured row to `public.audit_log` every time an operator/admin
 * saves a change to a pricing, fee, margin, or overhead surface inside the
 * Admin Economics console. Each entry captures a timestamp (via
 * `audit_log.created_at`), the acting user, the area/entity that changed,
 * and the full before/after snapshots plus a shallow field-level diff.
 *
 * All action strings are namespaced under `admin_economics.*` so the audit
 * viewer can filter cleanly and future scanners can identify these rows.
 */

export type EconomicsAuditArea =
  | "competition_economics"
  | "prize_pool"
  | "feature_configs"
  | "operational_overhead"
  | "profit_margins";

interface LogArgs {
  area: EconomicsAuditArea;
  entity_id?: string | null;
  before: unknown;
  after: unknown;
  /** Free-form label like "Vertical", "gemini-flash", "Season 3". */
  label?: string | null;
}

/** Deep-equality good enough for JSON-shaped config objects. */
function eq(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  } catch {
    return false;
  }
}

/** Compute a shallow field-level diff between two objects. */
export function diffFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Record<string, { before: unknown; after: unknown }> {
  const out: Record<string, { before: unknown; after: unknown }> = {};
  const keys = new Set<string>([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  for (const k of keys) {
    const b = (before ?? {})[k];
    const a = (after ?? {})[k];
    if (!eq(a, b)) out[k] = { before: b, after: a };
  }
  return out;
}

/**
 * Insert an audit row. Fails silently (console.warn only) so a broken audit
 * write never blocks the operator's save. Requires the caller to be an
 * authenticated admin (RLS enforces this).
 */
export async function logEconomicsChange({
  area,
  entity_id = null,
  before,
  after,
  label = null,
}: LogArgs): Promise<void> {
  // No-op when nothing actually changed — keeps the log signal:noise high.
  if (eq(before, after)) return;

  try {
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes?.user?.id ?? null;

    const diff =
      before && after && typeof before === "object" && typeof after === "object"
        ? diffFields(before as Record<string, unknown>, after as Record<string, unknown>)
        : { root: { before, after } };

    await logAuditEvent({
      userId,

      action: `admin_economics.${area}.update`,
      details: {
        area,
        entity_id,
        label,
        before,
        after,
        diff,
      },
    });
  } catch (err) {
    // Never block the save on an audit failure.
    // eslint-disable-next-line no-console
    console.warn("[adminEconomicsAudit] failed to log change", err);
  }
}
