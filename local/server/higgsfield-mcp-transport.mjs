import { randomUUID } from 'node:crypto';

// A private Node transport, never a general HTTP proxy or a browser-facing tool API.
// https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
// No automatic request retry, stream resubmission, authentication or tool approval.
export const HIGGSFIELD_MCP_ENDPOINT = 'https://mcp.higgsfield.ai/mcp';
export const HIGGSFIELD_MCP_PROTOCOLS = Object.freeze(['2025-11-25', '2025-06-18', '2025-03-26']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.length <= max && value.isWellFormed() && !value.includes('\0');
const fail = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });
const need = (condition, code) => { if (!condition) throw fail(code); };
const toolName = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value);
function validJson(value) {
  let count = 0;
  function visit(item, depth) {
    need(++count <= 100000 && depth <= 48, 'HIGGSFIELD_MCP_JSON_LIMIT');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number') { need(Number.isFinite(item), 'HIGGSFIELD_MCP_JSON_INVALID'); return; }
    if (typeof item === 'string') { need(text(item, 4 * 1024 * 1024), 'HIGGSFIELD_MCP_JSON_INVALID'); return; }
    if (Array.isArray(item)) { item.forEach(child => visit(child, depth + 1)); return; }
    need(object(item) && [Object.prototype, null].includes(Object.getPrototypeOf(item)), 'HIGGSFIELD_MCP_JSON_INVALID');
    for (const [key, child] of Object.entries(item)) {
      need(!['__proto__', 'prototype', 'constructor'].includes(key), 'HIGGSFIELD_MCP_JSON_INVALID');
      visit(child, depth + 1);
    }
  }
  visit(value, 0); return value;
}
function parseJson(source) {
  try { return validJson(JSON.parse(source)); } catch (error) {
    if (error?.code?.startsWith('HIGGSFIELD_MCP_')) throw error;
    throw fail('HIGGSFIELD_MCP_JSON_INVALID');
  }
}
async function abortable(value, signal) {
  if (signal.aborted) throw fail('HIGGSFIELD_MCP_ABORTED');
  let listener;
  const stop = new Promise((_, reject) => { listener = () => reject(fail('HIGGSFIELD_MCP_ABORTED')); signal.addEventListener('abort', listener, { once: true }); });
  try { return await Promise.race([Promise.resolve(value), stop]); }
  finally { signal.removeEventListener('abort', listener); }
}

export function createHiggsfieldMcpTransport({ fetchImpl = fetch, getAccessToken, endpoint = HIGGSFIELD_MCP_ENDPOINT, timeoutMs = 20000, maxResponseBytes = 4 * 1024 * 1024, clientInfo = { name: 'CanIScreenwrite', version: '1.0.0' } } = {}) {
  need(endpoint === HIGGSFIELD_MCP_ENDPOINT, 'HIGGSFIELD_MCP_ENDPOINT_INVALID');
  need(typeof fetchImpl === 'function' && typeof getAccessToken === 'function', 'HIGGSFIELD_MCP_CONFIGURATION_INVALID');
  need(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 180000 && Number.isSafeInteger(maxResponseBytes) && maxResponseBytes >= 128 && maxResponseBytes <= 16 * 1024 * 1024, 'HIGGSFIELD_MCP_LIMIT_INVALID');
  need(object(clientInfo) && text(clientInfo.name, 120) && clientInfo.name && text(clientInfo.version, 80) && clientInfo.version, 'HIGGSFIELD_MCP_CLIENT_INVALID');
  const client = { name: clientInfo.name, version: clientInfo.version };
  let closed = false, epoch = 0, session = null, protocol = null, ready = null, initializing = null;
  const pending = new Set();

  async function post(message, notification = false, replyContext = null) {
    need(!closed, 'HIGGSFIELD_MCP_CLOSED');
    need(pending.size < 8, 'HIGGSFIELD_MCP_BUSY');
    const generation = epoch, controller = new AbortController();
    pending.add(controller);
    let sent = false, timedOut = false, reader;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const parentAbort = () => controller.abort();
    replyContext?.signal?.addEventListener('abort', parentAbort, { once: true });
    if (replyContext?.signal?.aborted) controller.abort();
    try {
      const token = await abortable(getAccessToken(), controller.signal);
      need(generation === epoch && !closed, 'HIGGSFIELD_MCP_ABORTED');
      need(typeof token === 'string' && /^[\x21-\x7e]{1,32768}$/.test(token), 'HIGGSFIELD_MCP_SIGN_IN_REQUIRED');
      validJson(message);
      const body = JSON.stringify(message);
      need(Buffer.byteLength(body) <= 1024 * 1024, 'HIGGSFIELD_MCP_REQUEST_LIMIT');
      const currentProtocol = replyContext?.protocol ?? protocol, currentSession = replyContext?.session ?? session;
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', ...(currentProtocol ? { 'MCP-Protocol-Version': currentProtocol } : {}), ...(currentSession ? { 'Mcp-Session-Id': currentSession } : {}) };
      sent = true;
      const response = await abortable(fetchImpl(endpoint, { method: 'POST', headers, body, redirect: 'error', credentials: 'omit', signal: controller.signal }), controller.signal);
      need(generation === epoch && !closed, 'HIGGSFIELD_MCP_ABORTED');
      if (!response.ok) {
        const code = response.status === 401 ? 'HIGGSFIELD_MCP_SIGN_IN_REQUIRED' : response.status === 404 && session ? 'HIGGSFIELD_MCP_SESSION_EXPIRED' : 'HIGGSFIELD_MCP_HTTP_ERROR';
        void response.body?.cancel().catch(() => {});
        throw fail(code, { httpStatus: response.status });
      }
      const responseSession = response.headers.get('mcp-session-id');
      need(responseSession === null || /^[\x21-\x7e]{1,4096}$/.test(responseSession), 'HIGGSFIELD_MCP_SESSION_INVALID');
      if (notification) {
        need(response.status === 202, 'HIGGSFIELD_MCP_NOTIFICATION_NOT_ACCEPTED');
        // A notification has no response body. Do not wait on a spurious stream.
        void response.body?.cancel().catch(() => {});
        return { result: null, session: responseSession };
      }
      const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      need(['application/json', 'text/event-stream'].includes(contentType), 'HIGGSFIELD_MCP_CONTENT_TYPE_INVALID');
      const advertisedSize = response.headers.get('content-length');
      need(advertisedSize === null || /^\d+$/.test(advertisedSize) && Number(advertisedSize) <= maxResponseBytes, 'HIGGSFIELD_MCP_RESPONSE_LIMIT');
      need(response.body?.getReader, 'HIGGSFIELD_MCP_RESPONSE_EMPTY');
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let total = 0, source = '', dataLines = [], matched = null;
      async function envelope(value) {
        need(object(value) && value.jsonrpc === '2.0', 'HIGGSFIELD_MCP_ENVELOPE_INVALID');
        if (Object.hasOwn(value, 'method')) {
          need(text(value.method, 200), 'HIGGSFIELD_MCP_ENVELOPE_INVALID');
          // Ping is a base-protocol exchange. Other incoming requests cannot
          // become app actions: no roots/sampling/elicitation were advertised.
          if (Object.hasOwn(value, 'id')) {
            need(text(value.id, 200) || Number.isSafeInteger(value.id), 'HIGGSFIELD_MCP_ENVELOPE_INVALID');
            await post({ jsonrpc: '2.0', id: value.id, ...(value.method === 'ping' ? { result: {} } : { error: { code: -32601, message: 'Client capability not supported' } }) }, true, { session: responseSession ?? session, protocol: protocol ?? message.params?.protocolVersion, signal: controller.signal });
          }
          return;
        }
        need(value.id === message.id, 'HIGGSFIELD_MCP_RESPONSE_ID_MISMATCH');
        need(Object.hasOwn(value, 'result') !== Object.hasOwn(value, 'error'), 'HIGGSFIELD_MCP_ENVELOPE_INVALID');
        if (Object.hasOwn(value, 'error')) {
          need(object(value.error) && Number.isInteger(value.error.code), 'HIGGSFIELD_MCP_ENVELOPE_INVALID');
          throw fail('HIGGSFIELD_MCP_RPC_ERROR', { rpcCode: value.error.code });
        }
        need(object(value.result), 'HIGGSFIELD_MCP_RESULT_INVALID');
        need(!JSON.stringify(value.result).includes(token), 'HIGGSFIELD_MCP_RESPONSE_SENSITIVE');
        matched = value.result;
      }
      async function line(value) {
        if (value === '') {
          const data = dataLines.join('\n'); dataLines = [];
          if (data.trim()) await envelope(parseJson(data));
        } else if (value.startsWith('data:')) dataLines.push(value.slice(5).replace(/^ /, ''));
      }
      while (true) {
        const chunk = await abortable(reader.read(), controller.signal);
        if (chunk.done) {
          source += decoder.decode();
          if (contentType === 'text/event-stream' && source.endsWith('\r')) { await line(source.slice(0, -1)); source = ''; }
          break;
        }
        total += chunk.value.byteLength;
        need(total <= maxResponseBytes, 'HIGGSFIELD_MCP_RESPONSE_LIMIT');
        source += decoder.decode(chunk.value, { stream: true });
        if (contentType === 'text/event-stream') {
          let newline;
          while ((newline = source.search(/[\r\n]/)) >= 0) {
            if (source[newline] === '\r' && newline === source.length - 1) break;
            const width = source[newline] === '\r' && source[newline + 1] === '\n' ? 2 : 1;
            const value = source.slice(0, newline); source = source.slice(newline + width); await line(value);
            if (matched) break;
          }
          if (matched) break;
        }
      }
      if (contentType === 'application/json') await envelope(parseJson(source));
      // An incomplete SSE event at EOF is not a confirmed result and is not retried.
      need(matched !== null, 'HIGGSFIELD_MCP_RESPONSE_INCOMPLETE');
      need(generation === epoch && !closed, 'HIGGSFIELD_MCP_ABORTED');
      return { result: matched, session: responseSession };
    } catch (error) {
      const code = timedOut ? 'HIGGSFIELD_MCP_TIMEOUT' : controller.signal.aborted || generation !== epoch ? 'HIGGSFIELD_MCP_ABORTED' : error?.code?.startsWith('HIGGSFIELD_MCP_') ? error.code : 'HIGGSFIELD_MCP_UNAVAILABLE';
      // Deliberately discard network/RPC messages, response bodies and token errors.
      throw fail(code, { requestMayHaveBeenSent: sent, ...(Number.isInteger(error?.httpStatus) ? { httpStatus: error.httpStatus } : {}), ...(Number.isInteger(error?.rpcCode) ? { rpcCode: error.rpcCode } : {}) });
    } finally {
      clearTimeout(timer); controller.abort(); pending.delete(controller);
      replyContext?.signal?.removeEventListener('abort', parentAbort);
      if (reader) void reader.cancel().catch(() => {});
    }
  }
  function clearSession() {
    epoch += 1; session = null; protocol = null; ready = null; initializing = null;
    for (const controller of pending) controller.abort();
  }
  function requireReady() { need(!closed, 'HIGGSFIELD_MCP_CLOSED'); need(ready, 'HIGGSFIELD_MCP_NOT_INITIALIZED'); need(object(ready.capabilities.tools), 'HIGGSFIELD_MCP_TOOLS_UNAVAILABLE'); }
  const transport = {
    async initialize() {
      need(!closed, 'HIGGSFIELD_MCP_CLOSED');
      if (ready) return structuredClone(ready);
      if (initializing) return structuredClone(await initializing);
      const generation = epoch;
      const work = (async () => {
        try {
          const response = await post({ jsonrpc: '2.0', id: randomUUID(), method: 'initialize', params: { protocolVersion: HIGGSFIELD_MCP_PROTOCOLS[0], capabilities: {}, clientInfo: client } });
          const result = response.result;
          need(HIGGSFIELD_MCP_PROTOCOLS.includes(result.protocolVersion) && object(result.capabilities) && object(result.serverInfo) && text(result.serverInfo.name, 500) && text(result.serverInfo.version, 100), 'HIGGSFIELD_MCP_INITIALIZE_INVALID');
          need(generation === epoch && !closed, 'HIGGSFIELD_MCP_ABORTED');
          protocol = result.protocolVersion; session = response.session;
          await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, true);
          need(generation === epoch && !closed, 'HIGGSFIELD_MCP_ABORTED');
          ready = { protocolVersion: protocol, capabilities: structuredClone(result.capabilities), serverInfo: { name: result.serverInfo.name, version: result.serverInfo.version } };
          return structuredClone(ready);
        } catch (error) { if (generation === epoch) { session = null; protocol = null; ready = null; } throw error; }
        finally { if (generation === epoch) initializing = null; }
      })();
      initializing = work;
      return work;
    },
    async listTools(input = {}) {
      requireReady();
      need(object(input) && Object.keys(input).every(key => key === 'cursor') && (!Object.hasOwn(input, 'cursor') || text(input.cursor, 8192) && input.cursor), 'HIGGSFIELD_MCP_CURSOR_INVALID');
      const { result } = await post({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/list', params: structuredClone(input) });
      need(Array.isArray(result.tools) && result.tools.length <= 2000 && (!Object.hasOwn(result, 'nextCursor') || text(result.nextCursor, 8192) && result.nextCursor), 'HIGGSFIELD_MCP_TOOL_LIST_INVALID');
      const names = new Set();
      for (const tool of result.tools) {
        need(object(tool) && toolName(tool.name) && !names.has(tool.name) && object(tool.inputSchema) && tool.inputSchema.type === 'object', 'HIGGSFIELD_MCP_TOOL_SCHEMA_INVALID');
        need((!Object.hasOwn(tool, 'description') || text(tool.description, 100000)) && (!Object.hasOwn(tool, 'outputSchema') || object(tool.outputSchema)), 'HIGGSFIELD_MCP_TOOL_SCHEMA_INVALID');
        names.add(tool.name);
      }
      return { tools: result.tools, ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) };
    },
    async callTool(name, args) {
      requireReady();
      need(toolName(name) && object(args), 'HIGGSFIELD_MCP_TOOL_ARGUMENTS_INVALID'); validJson(args);
      const { result } = await post({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: structuredClone(args) } });
      if (!(Array.isArray(result.content) && result.content.length <= 2000 && result.content.every(item => object(item) && text(item.type, 100)) && (!Object.hasOwn(result, 'isError') || typeof result.isError === 'boolean') && (!Object.hasOwn(result, 'structuredContent') || object(result.structuredContent)))) throw fail('HIGGSFIELD_MCP_TOOL_RESULT_INVALID', { requestMayHaveBeenSent: true });
      // Tool content is untrusted provider data, not UI markup, source admission,
      // a payment receipt or evidence that returned files were downloaded/reviewed.
      return result;
    },
    clearSession,
    close() { closed = true; clearSession(); },
  };
  return transport;
}
