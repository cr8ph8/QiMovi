const protocol = '2025-06-18';
const names = ['qimovi_blender_status', 'qimovi_blender_prepare_rehearsal', 'qimovi_blender_start_rehearsal', 'qimovi_blender_stop_rehearsal'];
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** Same-origin owner session only. A failed mutation is never automatically replayed. */
export function createBlenderMcpClient() {
  let session: string | null = null, ready: Promise<void> | undefined, sequence = 0;
  async function rpc(method: string, params: unknown, signal?: AbortSignal, notification = false) {
    const id = ++sequence;
    const response = await fetch('/api/blender/mcp', {
      method: 'POST', credentials: 'same-origin', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        ...(session ? { 'Mcp-Session-Id': session, 'Mcp-Protocol-Version': protocol } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }),
    });
    if ([401,404].includes(response.status)) { session = null; ready = undefined; }
    if (!response.ok) throw Object.assign(new Error(response.status === 401 ? 'Reconnect your local workspace, then refresh Blender status.' : 'Blender connection was not confirmed. Refresh status before retrying the same rehearsal.'), { confirmedRejection: [400,401,403,404,406,409,413,422,429].includes(response.status) });
    if (notification) { if (response.status !== 202) throw new Error('Blender initialization was not confirmed.'); return null; }
    const text = await response.text();
    if (new TextEncoder().encode(text).length > 2*1024*1024) throw new Error('Blender response exceeds the local preview limit.');
    const value: unknown = JSON.parse(text);
    if (!object(value) || value.jsonrpc !== '2.0' || value.id !== id || !object(value.result) || value.error) throw new Error('Blender returned an invalid connection receipt.');
    if (method === 'initialize') {
      const next = response.headers.get('Mcp-Session-Id');
      if (value.result.protocolVersion !== protocol || !next || !/^[a-f0-9-]{36}$/.test(next)) throw new Error('Blender protocol or session could not be verified.');
      session = next;
    }
    return value.result;
  }
  function connect() {
    return ready ??= (async () => {
      try {
        await rpc('initialize', { protocolVersion: protocol, capabilities: {}, clientInfo: { name: 'QiMovi desktop', version: '1.0' } });
        await rpc('notifications/initialized', {}, undefined, true);
        const catalogue = await rpc('tools/list', {});
        if (!Array.isArray(catalogue?.tools) || names.some(name => !(catalogue.tools as unknown[]).some(tool => object(tool) && tool.name === name))) throw new Error('The required Blender rehearsal tools are unavailable.');
      } catch (error) { session = null; ready = undefined; throw error; }
    })();
  }
  return {
    async call(name: string, args: unknown, signal?: AbortSignal): Promise<unknown> {
      if (!names.includes(name)) throw new Error('Unsupported local Blender operation.');
      await connect();
      const result = await rpc('tools/call', { name, arguments: args }, signal);
      if (result?.isError === true) {
        const code = object(result.structuredContent) && typeof result.structuredContent.error === 'string' ? result.structuredContent.error : '';
        throw Object.assign(new Error(code.includes('STORAGE') ? 'Local rehearsal receipt storage failed. Status is unavailable and new rehearsals are blocked. Partial files are preserved.' : code.includes('BASIS') || code.includes('CHANGED') ? 'The saved camera plan changed. Refresh it before starting a rehearsal.' : code.includes('PREPARATION') ? 'The camera preparation expired. Retry the same request to prepare it again.' : 'Blender could not confirm this operation. Refresh the rehearsal status before retrying.'), { confirmedRejection: code !== 'BLENDER_MCP_OPERATION_FAILED' && !code.includes('STORAGE') && !code.includes('RECEIPT') });
      }
      if (result?.isError !== false || !object(result.structuredContent)) throw new Error('Blender returned an invalid rehearsal response.');
      return result.structuredContent;
    },
  };
}
export const blenderMcpClient = createBlenderMcpClient();
