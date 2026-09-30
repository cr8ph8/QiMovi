// Shared helpers for kernel-wired edge functions:
//   - spendTokens()      → charge the wallet via the canonical spend-tokens fn
//   - writeAudit()       → append a row to public.audit_log
//   - classifySensitivity() → derive a sensitivity tag from entry / submission flags
//
// Used by suggest-character-diamond, verify-character-identity, embed-character,
// rollback-character-diamond, and organize-brain-dump.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type SensitivityLevel = "standard" | "elevated" | "protected";

interface SpendArgs {
  authHeader: string;
  action: string;          // feature_configs.id
  entry_id?: string | null;
  label?: string;
  amount?: number;         // overrides DB default when provided
  model?: string;
}

/**
 * Server-side call to the spend-tokens edge function.
 * Returns { ok, status, error } — caller decides whether to short-circuit on 402/403.
 */
export async function spendTokens(args: SpendArgs): Promise<{ ok: boolean; status: number; error?: string }> {
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) return { ok: false, status: 500, error: "missing SUPABASE_URL" };
  try {
    const res = await fetch(`${url}/functions/v1/spend-tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: args.authHeader,
      },
      body: JSON.stringify({
        action: args.action,
        entry_id: args.entry_id ?? undefined,
        amount: args.amount,
        label: args.label ?? args.action,
        model: args.model,
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: txt.slice(0, 240) };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : "spend failed" };
  }
}

// Re-export the canonical audit writer so existing callers keep working.
// New code should import logGovernanceAction from ./audit.ts directly.
export { writeAudit } from "./audit.ts";
export type { WriteAuditArgs as AuditArgs } from "./audit.ts";

/**
 * Best-effort sensitivity classifier — looks at the entry + the latest authorship
 * submission for protected_voice_concern. Falls back to "standard".
 */
export async function classifySensitivity(entry_id: string | null | undefined): Promise<SensitivityLevel> {
  if (!entry_id) return "standard";
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return "standard";
    const admin = createClient(url, serviceKey);
    const { data } = await admin
      .from("authorship_submissions")
      .select("protected_voice_concern, rights_status")
      .eq("entry_id", entry_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.protected_voice_concern) return "protected";
    if (data?.rights_status && data.rights_status !== "original") return "elevated";
    return "standard";
  } catch {
    return "standard";
  }
}

/** Compose a stable correlation id for joining ai_usage_log ↔ kernel_runs */
export function newCorrelationId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
