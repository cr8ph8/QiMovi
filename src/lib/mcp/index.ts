import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listMyEntriesTool from "./tools/list-my-entries";
import getEntryScorecardTool from "./tools/get-entry-scorecard";
import listCompetitionsTool from "./tools/list-competitions";

// Direct Supabase host required for OAuth issuer discovery (see app-mcp-server-authoring).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "caniscreenwrite-mcp",
  title: "CanIScreenwrite MCP",
  version: "0.1.0",
  instructions:
    "Tools for CanIScreenwrite — a screenwriting competition and evaluation platform. Use `list_my_entries` and `get_entry_scorecard` to read the signed-in writer's submissions and AI scores, and `list_competitions` to see active competitions.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listMyEntriesTool, getEntryScorecardTool, listCompetitionsTool],
});
