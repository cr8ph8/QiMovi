import { createClient } from "@supabase/supabase-js";
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "list_competitions",
  title: "List active competitions",
  description:
    "List active screenplay competitions on the platform with title, length category, deadline, and prize summary.",
  inputSchema: {
    limit: z.number().int().min(1).max(50).default(20).describe("Max competitions to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ limit }) => {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await supabase
      .from("competitions")
      .select("id, title, length_category, status, submission_deadline, prize_pool, created_at")
      .eq("status", "active")
      .order("submission_deadline", { ascending: true })
      .limit(limit);
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { competitions: data ?? [] },
    };
  },
});
