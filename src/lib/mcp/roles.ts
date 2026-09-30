import { createClient } from "@supabase/supabase-js";
import type { ToolContext } from "@lovable.dev/mcp-js";
import { logMcpAccessDenial } from "./accessDenial";

/**
 * Role gating for MCP tools.
 *
 * Roles live in `public.user_roles` and are checked via the `has_role`
 * security-definer RPC. Never trust a role claim from tool input.
 *
 * Current mapping:
 *   entrant  → any authenticated writer (owns entries + scores via RLS)
 *   judge    → future judge-scoped tools (queue, panel comments)
 *   admin    → future admin-scoped tools (moderation, economics, audit)
 */
export type AppRole = "admin" | "moderator" | "judge" | "tester" | "user";

export interface GateFailure {
  isError: true;
  content: [{ type: "text"; text: string }];
}

function serviceClient(ctx: ToolContext) {
  // Forward the caller's verified access token so `has_role` runs under RLS
  // as that user. We never accept `user_id` from tool input.
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

/** Return true when the caller holds the given app_role. */
export async function hasRole(ctx: ToolContext, role: AppRole): Promise<boolean> {
  if (!ctx.isAuthenticated()) return false;
  const sb = serviceClient(ctx);
  const { data, error } = await sb.rpc("has_role", {
    _user_id: ctx.getUserId(),
    _role: role,
  });
  if (error) return false;
  return !!data;
}

function deny(text: string): GateFailure {
  return { isError: true, content: [{ type: "text", text }] };
}

export interface GateOpts {
  /** Tool name used as the audit resource label (e.g. "list_my_entries"). */
  tool?: string;
}

/**
 * Entrant gate — writer tools (own entries, scorecards, submissions).
 *
 * Requires authentication. Admin/judge/moderator callers pass through so
 * privileged operators can still preview writer surfaces, but downstream
 * queries remain scoped to `ctx.getUserId()` (RLS still applies).
 */
export async function requireEntrant(
  ctx: ToolContext,
  opts: GateOpts = {},
): Promise<GateFailure | null> {
  if (!ctx.isAuthenticated()) {
    void logMcpAccessDenial(ctx, "mcp_entrant_gate", {
      tool: opts.tool ?? "mcp_tool",
      reason: "not authenticated",
    });
    return deny("Not authenticated. Sign in from your assistant to use writer tools.");
  }
  return null;
}

/**
 * Admin gate — for future admin-scoped tools (moderation queue, economics,
 * audit log surfaces). Returns a GateFailure to short-circuit the handler.
 */
export async function requireAdmin(
  ctx: ToolContext,
  opts: GateOpts = {},
): Promise<GateFailure | null> {
  if (!ctx.isAuthenticated()) {
    void logMcpAccessDenial(ctx, "mcp_admin_gate", {
      tool: opts.tool ?? "mcp_tool",
      reason: "not authenticated",
    });
    return deny("Not authenticated.");
  }
  const isAdmin = await hasRole(ctx, "admin");
  if (!isAdmin) {
    void logMcpAccessDenial(ctx, "mcp_admin_gate", {
      tool: opts.tool ?? "mcp_tool",
      reason: "not an admin",
    });
    return deny("This tool is restricted to platform administrators.");
  }
  return null;
}

/** Judge gate — for future judge-scoped tools (queue, panel comments). */
export async function requireJudge(
  ctx: ToolContext,
  opts: GateOpts = {},
): Promise<GateFailure | null> {
  if (!ctx.isAuthenticated()) {
    void logMcpAccessDenial(ctx, "mcp_judge_gate", {
      tool: opts.tool ?? "mcp_tool",
      reason: "not authenticated",
    });
    return deny("Not authenticated.");
  }
  const [isJudge, isAdmin] = await Promise.all([hasRole(ctx, "judge"), hasRole(ctx, "admin")]);
  if (!isJudge && !isAdmin) {
    void logMcpAccessDenial(ctx, "mcp_judge_gate", {
      tool: opts.tool ?? "mcp_tool",
      reason: "not a judge",
    });
    return deny("This tool is restricted to judges.");
  }
  return null;
}

