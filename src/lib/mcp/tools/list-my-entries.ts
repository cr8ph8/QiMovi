import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { requireEntrant } from "../roles";

function supabaseForUser(ctx: ToolContext) {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export default defineTool({
  name: "list_my_entries",
  title: "List my screenplay entries",
  description:
    "List the signed-in user's screenplay entries (submissions) with title, status, genre, and creation date.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).default(25).describe("Max entries to return."),
    status: z.string().optional().describe("Optional status filter (e.g. 'submitted', 'draft')."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, status }, ctx) => {
    const denied = await requireEntrant(ctx, { tool: "list_my_entries" });
    if (denied) return denied;
    let query = supabaseForUser(ctx)
      .from("entries")
      .select("id, title, genre, logline, status, length_category, page_count, created_at")
      .eq("user_id", ctx.getUserId())
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { entries: data ?? [] },
    };
  },
});
