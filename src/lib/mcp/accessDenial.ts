import type { ToolContext } from "@lovable.dev/mcp-js";

/**
 * MCP-side access denial logger. Mirrors `src/lib/logAccessDenial.ts` but runs
 * inside the Deno edge function, so it POSTs to the `log-access-denial`
 * function directly with the caller's bearer token (never a service key).
 *
 * Fire-and-forget: audit logging must never break a tool call, so all errors
 * are swallowed. In test/CI (VITEST is set) we skip the network entirely to
 * avoid dangling requests.
 */
export type McpDenialEvent =
  | "mcp_entrant_gate"
  | "mcp_admin_gate"
  | "mcp_judge_gate";

export interface McpDenialOpts {
  tool: string;
  reason: string;
  details?: Record<string, unknown>;
}

export async function logMcpAccessDenial(
  ctx: ToolContext,
  event: McpDenialEvent,
  opts: McpDenialOpts,
): Promise<void> {
  if (process.env.VITEST) return;
  const url = process.env.SUPABASE_URL;
  if (!url) return;
  const token = ctx.isAuthenticated?.() ? ctx.getToken?.() : undefined;
  const anon =
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  try {
    // Do not await the fetch — fire-and-forget so the tool response is not
    // blocked on the audit round-trip.
    void fetch(`${url}/functions/v1/log-access-denial`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: anon,
        authorization: `Bearer ${token ?? anon}`,
      },
      body: JSON.stringify({
        event_type: event,
        resource: opts.tool,
        reason: opts.reason,
        details: {
          ...(opts.details ?? {}),
          surface: "mcp",
          tool: opts.tool,
          user_id: ctx.isAuthenticated?.() ? ctx.getUserId?.() : null,
          client_id: ctx.getClientId?.() ?? null,
        },
      }),
    }).catch(() => {});
  } catch {
    // ignore
  }
}
