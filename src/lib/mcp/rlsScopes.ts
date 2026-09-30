/**
 * Single source of truth: MCP tool name → RLS scope.
 *
 * Every MCP tool exposed by this app MUST have an entry here. UI badges,
 * the tool preview card, docs, and tests all read from this map so a newly
 * added tool automatically gets the correct scope badge without touching
 * component code.
 *
 * To add a new tool:
 *   1. Add it to `src/lib/mcp/tools/`.
 *   2. Add its scope entry to `TOOL_RLS_SCOPES` below.
 *   3. Register it in `src/lib/mcp/index.ts`.
 *
 * If a tool is rendered without an entry here, `getRlsScope` falls back to
 * `UNKNOWN_SCOPE` ("Admin only") — a safe deny-by-default badge that
 * surfaces the omission during code review instead of silently mislabeling
 * the tool as public or entrant-scoped.
 */

import type { requireAdmin, requireEntrant, requireJudge } from "./roles";

/** Server-side gate function signature used by tool handlers. */
export type GateName = "requireEntrant" | "requireJudge" | "requireAdmin" | "none";

export interface RlsScope {
  /** Short badge label shown in the UI. */
  label: string;
  /** shadcn Badge variant used to render the label. */
  variant: "default" | "secondary" | "outline" | "destructive";
  /**
   * Which server-side gate the tool handler applies. Documented here so the
   * badge and the actual runtime enforcement can be audited together.
   * "none" = public/anonymous tool (no gate).
   */
  gate: GateName;
  /** One-sentence explanation for tooltips and docs. */
  description: string;
}

/** Fallback used when a tool is rendered without an entry. Safe deny-by-default. */
export const UNKNOWN_SCOPE: RlsScope = {
  label: "Admin only",
  variant: "default",
  gate: "requireAdmin",
  description:
    "No RLS scope registered for this tool — defaulting to admin-only. Add an entry to TOOL_RLS_SCOPES.",
};

const ENTRANT_SCOPE: RlsScope = {
  label: "Entrant only",
  variant: "secondary",
  gate: "requireEntrant",
  description:
    "Requires an authenticated entrant (user_roles row). RLS scopes queries to auth.uid().",
};

const PUBLIC_SCOPE: RlsScope = {
  label: "Public",
  variant: "outline",
  gate: "none",
  description: "No authentication required. Reads publicly-visible data only.",
};

const JUDGE_SCOPE: RlsScope = {
  label: "Judge only",
  variant: "secondary",
  gate: "requireJudge",
  description: "Requires the 'judge' or 'admin' app_role.",
};

const ADMIN_SCOPE: RlsScope = {
  label: "Admin only",
  variant: "default",
  gate: "requireAdmin",
  description: "Requires the 'admin' app_role.",
};

/**
 * Canonical map: MCP tool name (as registered in `defineMcp`) → RLS scope.
 * Keep in sync with the tools listed in `src/lib/mcp/index.ts`.
 */
export const TOOL_RLS_SCOPES: Record<string, RlsScope> = {
  list_my_entries: ENTRANT_SCOPE,
  get_entry_scorecard: ENTRANT_SCOPE,
  list_competitions: PUBLIC_SCOPE,
};

/** Re-usable scope presets (for tests and for adding new tools). */
export const SCOPE_PRESETS = {
  entrant: ENTRANT_SCOPE,
  public: PUBLIC_SCOPE,
  judge: JUDGE_SCOPE,
  admin: ADMIN_SCOPE,
} as const;

/** Look up the RLS scope for a tool name. Falls back to `UNKNOWN_SCOPE`. */
export function getRlsScope(toolName: string): RlsScope {
  return TOOL_RLS_SCOPES[toolName] ?? UNKNOWN_SCOPE;
}

/** Compile-time reference so unused type-only imports don't get pruned. */
export type __GateRefs = typeof requireEntrant | typeof requireJudge | typeof requireAdmin;
