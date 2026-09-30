import { detectResolveInstallation } from './resolve-runtime.mjs';
import { createResolveStdioTransport } from './resolve-stdio.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, status = 409) => Object.assign(new Error(code), { code, status });
const need = (value, code, status) => { if (!value) throw failure(code, status); };
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);
const explanations = {
  RESOLVE_NOT_INSTALLED: 'DaVinci Resolve was not found in a configured local Applications folder.',
  RESOLVE_RUNTIME_UNAVAILABLE: 'The installed vendor scripting SDK or an isolated Python 3 runtime is unavailable.',
  RESOLVE_SCRIPTING_UNAVAILABLE: 'Resolve did not grant a local scripting connection. Open Resolve fully and check whether this edition supports external scripting. The installed vendor guide documents the Local external scripting preference under Resolve Studio. QiMovi has not changed that preference.',
  RESOLVE_SDK_LOAD_FAILED: 'The installed Resolve scripting library could not be loaded by Python. The bridge is available, but Resolve access is not verified.',
};

/** Put every HTTP hook behind the existing local owner session and origin checks. */
export function createResolveMcpBridge({ detect = detectResolveInstallation, transportFactory = createResolveStdioTransport, appPath, pythonPath, now = Date.now } = {}) {
  let state = 'NOT_CHECKED', checkedAt = null, reason = null, reasonCode = null, installed = null, transport = null, tools = [], mcpReady = false, resolveAvailable = false, closed = false, busy = false;
  const runtimeConfig = { ...(appPath ? { appPaths: [appPath] } : {}), ...(pythonPath ? { pythonPaths: [pythonPath] } : {}) };
  const snapshot = () => ({ schema: 'qimovi-resolve-status/v1', state, transport: 'BUNDLED_STDIO', installed, mcpReady, resolveAvailable, checkedAt, reason, reasonCode, tools, readOnly: true });
  async function installation() { installed = await detect(runtimeConfig); return installed; }
  function disconnect() { transport?.close(); transport = null; mcpReady = false; resolveAvailable = false; tools = []; }
  function unavailable(code) { reasonCode = code; reason = explanations[code] ?? 'The local read-only Resolve connection was not confirmed. Refresh the connection after Resolve is ready.'; }
  async function exclusive(operation) {
    need(!closed, 'RESOLVE_MCP_CLOSED'); need(!busy, 'RESOLVE_MCP_BUSY'); busy = true;
    try { return await operation(); } finally { busy = false; }
  }
  return {
    status() { return exclusive(async () => {
      await installation();
      need(!closed, 'RESOLVE_MCP_CLOSED');
      if (!installed.found) { disconnect(); state = 'NOT_INSTALLED'; unavailable('RESOLVE_NOT_INSTALLED'); }
      else if (!installed.sdkAvailable || !installed.pythonAvailable) { disconnect(); state = 'RUNTIME_UNAVAILABLE'; unavailable('RESOLVE_RUNTIME_UNAVAILABLE'); }
      else if (state === 'NOT_INSTALLED' || state === 'RUNTIME_UNAVAILABLE') { state = 'NOT_CHECKED'; reason = null; reasonCode = null; }
      return snapshot();
    }); },
    discover() { return exclusive(async () => {
      disconnect(); checkedAt = new Date(now()).toISOString(); reason = null; reasonCode = null;
      await installation();
      need(!closed, 'RESOLVE_MCP_CLOSED');
      if (!installed.found) { state = 'NOT_INSTALLED'; unavailable('RESOLVE_NOT_INSTALLED'); return snapshot(); }
      if (!installed.sdkAvailable || !installed.pythonAvailable) { state = 'RUNTIME_UNAVAILABLE'; unavailable('RESOLVE_RUNTIME_UNAVAILABLE'); return snapshot(); }
      try {
        transport = transportFactory({ appPath: installed.appPath, pythonPath: installed.pythonPath });
        await transport.initialize();
        const catalogue = await transport.listTools();
        tools = catalogue.tools.map(tool => ({ name: tool.name, title: tool.title, readOnly: true })); mcpReady = true;
        const probe = await transport.callTool('qimovi_resolve_probe', {});
        need(!closed, 'RESOLVE_MCP_CLOSED');
        need(object(probe) && typeof probe.available === 'boolean' && (probe.reason === null || typeof probe.reason === 'string'), 'RESOLVE_PROBE_INVALID', 502);
        resolveAvailable = probe.available; state = probe.available ? 'CONNECTED' : 'BLOCKED';
        if (!probe.available) unavailable(probe.reason); else { reason = null; reasonCode = null; }
      } catch (error) { disconnect(); if (closed) throw failure('RESOLVE_MCP_CLOSED'); state = 'ERROR'; unavailable(error.code?.startsWith('RESOLVE_') ? error.code : 'RESOLVE_CONNECTION_FAILED'); }
      return snapshot();
    }); },
    inspect(input) { return exclusive(async () => {
      need(object(input), 'RESOLVE_INSPECTION_INPUT', 422);
      const project = input.scope === 'project' && Object.keys(input).length === 1;
      const timeline = input.scope === 'timeline' && Object.keys(input).sort().join(',') === 'expectedProjectId,expectedTimelineId,scope' && id(input.expectedProjectId) && id(input.expectedTimelineId);
      need(project || timeline, 'RESOLVE_INSPECTION_INPUT', 422);
      need(state === 'CONNECTED' && mcpReady && resolveAvailable && transport, 'RESOLVE_NOT_CONNECTED');
      try {
        const result = await transport.callTool(project ? 'qimovi_resolve_current_project' : 'qimovi_resolve_current_timeline', project ? {} : { expectedProjectId: input.expectedProjectId, expectedTimelineId: input.expectedTimelineId });
        need(!closed, 'RESOLVE_MCP_CLOSED');
        need(object(result) && id(result.project?.id) && typeof result.project?.name === 'string', 'RESOLVE_INSPECTION_INVALID', 502);
        if (timeline) need(result.project.id === input.expectedProjectId && result.timeline?.id === input.expectedTimelineId, 'RESOLVE_INSPECTION_MISMATCH', 502);
        checkedAt = new Date(now()).toISOString();
        return { schema: 'qimovi-resolve-inspection/v1', scope: input.scope, observedAt: checkedAt, readOnly: true, result };
      } catch (error) {
        if (!['RESOLVE_PROJECT_CHANGED', 'RESOLVE_TIMELINE_CHANGED', 'RESOLVE_NO_CURRENT_PROJECT', 'RESOLVE_NO_CURRENT_TIMELINE'].includes(error.code)) { disconnect(); state = 'ERROR'; unavailable(error.code?.startsWith('RESOLVE_') ? error.code : 'RESOLVE_READ_FAILED'); }
        throw error;
      }
    }); },
    close() { closed = true; disconnect(); },
  };
}
