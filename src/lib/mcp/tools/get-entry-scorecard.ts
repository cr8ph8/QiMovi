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
  name: "get_entry_scorecard",
  title: "Get entry scorecard",
  description:
    "Fetch a screenplay entry the signed-in user can read, including its latest scores (narrative, character, dialogue, structure, total, feedback).",
  inputSchema: {
    entry_id: z.string().uuid().describe("The entry id to fetch."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ entry_id }, ctx) => {
    const denied = await requireEntrant(ctx, { tool: "get_entry_scorecard" });
    if (denied) return denied;
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("entries")
      .select(
        "id, title, genre, logline, status, length_category, page_count, author, created_at, scores(total_score, narrative, character_score, dialogue, structure, theme, emotion, feedback, created_at, superseded_at)",
      )
      .eq("id", entry_id)
      .maybeSingle();
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    if (!data) {
      return { content: [{ type: "text", text: "Entry not found or not accessible." }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { entry: data },
    };
  },
});
