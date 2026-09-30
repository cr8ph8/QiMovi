import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

export const RESOLVE_MCP_PROTOCOL = '2025-06-18';
export const RESOLVE_READ_TOOLS = Object.freeze(['qimovi_resolve_probe', 'qimovi_resolve_current_project', 'qimovi_resolve_current_timeline']);
export const RESOLVE_BRIDGE_SCRIPT = fileURLToPath(new URL('../integrations/resolve/readonly_mcp.py', import.meta.url));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, status = 502) => Object.assign(new Error(code), { code, status });
const need = (value, code, status) => { if (!value) throw failure(code, status); };
const stringId = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);
function toolArguments(name, args) {
  need(RESOLVE_READ_TOOLS.includes(name) && object(args), 'RESOLVE_TOOL_NOT_ALLOWED', 422);
  if (name === 'qimovi_resolve_current_timeline') need(Object.keys(args).sort().join(',') === 'expectedProjectId,expectedTimelineId' && stringId(args.expectedProjectId) && stringId(args.expectedTimelineId), 'RESOLVE_ARGUMENTS_INVALID', 422);
  else need(Object.keys(args).length === 0, 'RESOLVE_ARGUMENTS_INVALID', 422);
}

/** Private pipes to a bundled allowlisted server. No URL, shell, generic tool or code execution endpoint. */
export function createResolveStdioTransport({ pythonPath, appPath, spawnImpl = spawn, timeoutMs = 10000, maxResponseBytes = 2 * 1024 * 1024 } = {}) {
  need([pythonPath, appPath].every(value => typeof value === 'string' && path.isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value)), 'RESOLVE_CONFIGURATION_INVALID', 422);
  need(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 60000 && Number.isSafeInteger(maxResponseBytes) && maxResponseBytes >= 1024 && maxResponseBytes <= 4 * 1024 * 1024, 'RESOLVE_CONFIGURATION_INVALID', 422);
  let child, sequence = 0, buffer = Buffer.alloc(0), stderrBytes = 0, closed = false, initialized = false;
  const pending = new Map();
  const abort = code => {
    closed = true; initialized = false;
    for (const operation of pending.values()) { clearTimeout(operation.timer); operation.reject(failure(code)); }
    pending.clear();
    if (child && child.exitCode === null) { child.kill('SIGTERM'); const kill = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 200); kill.unref(); }
  };
  function start() {
    need(!closed, 'RESOLVE_MCP_CLOSED', 409);
    if (child) return;
    try {
      child = spawnImpl(pythonPath, ['-I', '-S', '-u', RESOLVE_BRIDGE_SCRIPT, '--app-root', appPath], {
        shell: false, windowsHide: true, cwd: path.dirname(RESOLVE_BRIDGE_SCRIPT), stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: '/usr/bin:/bin', HOME: homedir(), TMPDIR: tmpdir(), LANG: 'en_US.UTF-8', PYTHONDONTWRITEBYTECODE: '1' },
      });
      child.on('error', () => abort('RESOLVE_MCP_START_FAILED'));
      child.on('exit', () => { if (!closed) abort('RESOLVE_MCP_EXITED'); });
      child.stdin.on('error', () => abort('RESOLVE_MCP_CLOSED'));
      child.stderr.on('data', data => { stderrBytes += data.length; if (stderrBytes > 128 * 1024) abort('RESOLVE_MCP_DIAGNOSTIC_LIMIT'); });
      child.stdout.on('data', data => {
        if (closed) return;
        buffer = Buffer.concat([buffer, Buffer.from(data)]);
        if (buffer.length > maxResponseBytes) return abort('RESOLVE_MCP_RESPONSE_LIMIT');
        let split;
        while ((split = buffer.indexOf(10)) >= 0) {
          const line = buffer.subarray(0, split); buffer = buffer.subarray(split + 1);
          try {
            const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
            need(object(envelope) && envelope.jsonrpc === '2.0' && !Object.hasOwn(envelope, 'method') && Number.isSafeInteger(envelope.id) && pending.has(envelope.id) && Object.hasOwn(envelope, 'result') !== Object.hasOwn(envelope, 'error'), 'RESOLVE_MCP_PROTOCOL_INVALID');
            const operation = pending.get(envelope.id); pending.delete(envelope.id); clearTimeout(operation.timer);
            if (Object.hasOwn(envelope, 'error')) operation.reject(failure('RESOLVE_MCP_REQUEST_REJECTED'));
            else operation.resolve(envelope.result);
          } catch { return abort('RESOLVE_MCP_PROTOCOL_INVALID'); }
        }
      });
    } catch { abort('RESOLVE_MCP_START_FAILED'); throw failure('RESOLVE_MCP_START_FAILED'); }
  }
  function request(method, params) {
    start(); need(pending.size < 4, 'RESOLVE_MCP_BUSY', 409);
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => abort('RESOLVE_MCP_TIMEOUT'), timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, error => { if (error) abort('RESOLVE_MCP_CLOSED'); });
    });
  }
  return {
    async initialize() {
      need(!initialized, 'RESOLVE_MCP_ALREADY_INITIALIZED', 409);
      const result = await request('initialize', { protocolVersion: RESOLVE_MCP_PROTOCOL, capabilities: {}, clientInfo: { name: 'QiMovi', version: '1.0.0' } });
      need(object(result) && result.protocolVersion === RESOLVE_MCP_PROTOCOL && result.serverInfo?.name === 'qimovi-resolve-readonly' && object(result.capabilities?.tools), 'RESOLVE_MCP_PROTOCOL_INVALID');
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
      initialized = true; return result;
    },
    async listTools() {
      need(initialized && !closed, 'RESOLVE_MCP_NOT_INITIALIZED', 409);
      const result = await request('tools/list', {});
      need(object(result) && Array.isArray(result.tools) && result.tools.length === RESOLVE_READ_TOOLS.length && !result.nextCursor, 'RESOLVE_MCP_TOOL_CATALOG_INVALID');
      need(new Set(result.tools.map(tool => tool.name)).size === RESOLVE_READ_TOOLS.length && result.tools.every(tool => RESOLVE_READ_TOOLS.includes(tool.name) && object(tool.inputSchema) && tool.inputSchema.type === 'object' && tool.inputSchema.additionalProperties === false && tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint === false && typeof tool.title === 'string' && tool.title.length <= 120), 'RESOLVE_MCP_TOOL_CATALOG_INVALID');
      return result;
    },
    async callTool(name, args = {}) {
      toolArguments(name, args);
      need(initialized && !closed, 'RESOLVE_MCP_NOT_INITIALIZED', 409);
      const result = await request('tools/call', { name, arguments: args });
      need(object(result) && typeof result.isError === 'boolean' && object(result.structuredContent), 'RESOLVE_MCP_TOOL_RESPONSE_INVALID');
      if (result.isError) { const code = result.structuredContent.error; throw failure(typeof code === 'string' && /^RESOLVE_[A-Z_]{1,100}$/.test(code) ? code : 'RESOLVE_READ_FAILED', 409); }
      return result.structuredContent;
    },
    close() { abort('RESOLVE_MCP_CLOSED'); },
  };
}
