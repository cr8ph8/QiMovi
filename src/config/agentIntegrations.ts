export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  annotations?: { readOnlyHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
}

interface AgentIntegrationConfiguration {
  endpoint: string | null;
  server: { name: string | null; title: string; version: string | null };
  tools: McpTool[];
}

/** Public source defaults. A deployment must supply its own verified connection. */
export const agentIntegrationConfiguration: AgentIntegrationConfiguration = {
  endpoint: null,
  server: { name: null, title: 'MCP connection', version: null },
  tools: [],
};
