import { randomUUID } from 'node:crypto';
import { buildCameraExchange } from '../integrations/three-d/exchange.mjs';
import { buildDccStageKit } from '../integrations/three-d/stage-kit.mjs';
import { PREVIZ_LAYOUTS } from '../integrations/three-d/previz-brief.mjs';
import { canonical, sha256 } from './storage.mjs';
import { describeBlenderOperation, qualifyBlenderOperation } from '../integrations/three-d/blender-operation.mjs';

export const BLENDER_MCP_PROTOCOL = '2025-06-18';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const protocolOffer = value => typeof value === 'string' && value.length > 0 && value.length <= 100 && !/[\s\u0000-\u001f\u007f]/u.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const fail = (code, status = 422) => Object.assign(new Error(code), { code, status });
const need = (condition, code, status) => { if (!condition) throw fail(code, status); };
const shape = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const identity = { type: 'string', minLength: 1, maxLength: 160, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const job = { type: 'string', format: 'uuid' };
const optionsSchema = shape({ sceneId: identity, expectedSourceHash: hash, expectedBasisHash: hash, shotId: identity,
  target: { const: 'BLENDER' }, lensMm: { type: 'integer', minimum: 10, maximum: 200 }, durationSeconds: { type: 'integer', minimum: 1, maximum: 180 },
  motion: { enum: ['STATIC', 'DOLLY_IN', 'DOLLY_OUT'] }, travelMm: { type: 'integer', minimum: 0, maximum: 5000 }, blockingNotes: { type: 'string', maxLength: 4000 },
});
optionsSchema.properties.previz = shape({ layout: { enum: PREVIZ_LAYOUTS }, depthLayers: { type: 'boolean' }, subjectCount: { type: 'integer', minimum: 1, maximum: 6 }, lookNotes: { type: 'string', maxLength: 4000 } });
const scope = { expectedProjectId: identity, expectedSourceHash: hash, sceneId: identity };
export const BLENDER_MCP_TOOLS = [
  { name: 'qimovi_blender_status', title: 'Read local Blender rehearsal status', description: 'Read this project/scene basis, executable availability and latest 50 jobs. Does not rehash the current Blender binary or attach to an interactive editor.', inputSchema: shape(scope), readOnly: true },
  { name: 'qimovi_blender_prepare_rehearsal', title: 'Prepare source-bound Blender rehearsal', description: 'Validate existing stage options and return an exact kit digest, planned camera and optional greybox brief. Creates no file or job. Prepare before explicitly starting.', inputSchema: shape({ expectedProjectId: identity, options: optionsSchema }), readOnly: true },
  { name: 'qimovi_blender_start_rehearsal', title: 'Start prepared local Blender rehearsal', description: 'Start the exact prepared kit through the existing owned local runner. Writes a new job and pending return, renders opening, midpoint and ending stills and independently reopens the new scene. No active editor edits, cloud calls, rights approval or final-media acceptance.', inputSchema: shape({ expectedProjectId: identity, jobId: job, options: optionsSchema, expectedKitSha256: hash }), readOnly: false },
  { name: 'qimovi_blender_stop_rehearsal', title: 'Stop owned Blender rehearsal', description: 'Stop only the selected job owned by this workspace runner. Retains receipts and partial outputs. Cannot target arbitrary processes or another editor.', inputSchema: shape({ ...scope, jobId: job }), readOnly: false },
].map(({ readOnly, ...tool }) => ({ ...tool, annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: false } }));

export const BLENDER_MOTION_MCP_TOOLS = [
  { name: 'qimovi_blender_motion_status', title: 'Read local motion render status', description: 'Read owned continuous-render jobs and measured take references for this scene.', inputSchema: shape(scope), readOnly: true },
  { name: 'qimovi_blender_render_motion', title: 'Render retained Blender scene to a measured take', description: 'Render a current source-bound retained Blender scene as silent internal previs. The owned job reports frame progress, retains exact scene/render lineage and independently measures the video. No automatic creative review, take selection, provider call or final-film approval.', inputSchema: shape({ ...scope, jobId: job, shotId: identity, returnReceiptSha256: hash }), readOnly: false },
  { name: 'qimovi_blender_stop_motion', title: 'Stop owned motion render', description: 'Stop only this workspace motion job and its measurement. Preserve partial files and receipts; do not target interactive editors.', inputSchema: shape({ ...scope, jobId: job }), readOnly: false },
].map(({ readOnly, ...tool }) => ({ ...tool, annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: false } }));

/** MCP JSON response transport sharing the existing workspace's sole rehearsal service.
 * The HTTP adapter MUST authenticate the owner and enforce exact host/origin before
 * calling handle. ownerSessionKey must be a server-derived hash, never body input. */
export function createBlenderMcpServer({ store, rehearsals, motion, now = Date.now, sessionTtlMs = 30 * 60_000, prepareTtlMs = 10 * 60_000, maxSessions = 8 } = {}) {
  need(store && rehearsals && typeof rehearsals.start === 'function' && typeof rehearsals.list === 'function' && typeof rehearsals.stop === 'function', 'BLENDER_MCP_CONFIGURATION_INVALID');
  need(Number.isSafeInteger(sessionTtlMs) && sessionTtlMs > 0 && sessionTtlMs <= 60 * 60_000 && Number.isSafeInteger(prepareTtlMs) && prepareTtlMs > 0 && prepareTtlMs <= sessionTtlMs && Number.isSafeInteger(maxSessions) && maxSessions > 0 && maxSessions <= 32, 'BLENDER_MCP_CONFIGURATION_INVALID');
  const sessions = new Map(); let closed = false;
  const tools = [...BLENDER_MCP_TOOLS, ...(motion ? BLENDER_MOTION_MCP_TOOLS : [])];
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const response = (status, body, extra = {}) => ({ status, body, headers: { ...headers, ...extra } });
  const rpcError = (status, id, code, message) => response(status, { jsonrpc: '2.0', id, error: { code, message } });
  function prune() { for (const [key, value] of sessions) if (value.expiresAt <= now()) sessions.delete(key); }
  function project(expected) { need(expected === store.project().id, 'BLENDER_MCP_PROJECT_CHANGED', 409); }
  const snapshot = () => ({ project: store.resolvedProject(), records: store.rawList() });
  function sceneScope(args) {
    project(args.expectedProjectId);
    need(digest(args.expectedSourceHash), 'BLENDER_MCP_ARGUMENTS_INVALID');
    return buildCameraExchange(snapshot(), { sceneId: args.sceneId, expectedSourceHash: args.expectedSourceHash });
  }
  function kitFor(args) {
    project(args.expectedProjectId);
    need(args.options?.target === 'BLENDER', 'BLENDER_MCP_BLENDER_ONLY');
    return buildDccStageKit(snapshot(), args.options);
  }
  function call(session, name, args) {
    need(tools.some(tool => tool.name === name) && object(args), 'BLENDER_MCP_TOOL_NOT_ALLOWED');
    if (name === 'qimovi_blender_motion_status') {
      need(exact(args, Object.keys(scope)), 'BLENDER_MCP_ARGUMENTS_INVALID');
      sceneScope(args); return motion.list(args.sceneId);
    }
    if (name === 'qimovi_blender_render_motion') {
      need(exact(args, [...Object.keys(scope), 'jobId', 'shotId', 'returnReceiptSha256']) && uuid(args.jobId) && digest(args.returnReceiptSha256), 'BLENDER_MCP_ARGUMENTS_INVALID');
      sceneScope(args);
      return motion.start({jobId:args.jobId,projectId:args.expectedProjectId,sourceHash:args.expectedSourceHash,sceneId:args.sceneId,shotId:args.shotId,returnReceiptSha256:args.returnReceiptSha256});
    }
    if (name === 'qimovi_blender_stop_motion') {
      need(exact(args, [...Object.keys(scope), 'jobId']) && uuid(args.jobId), 'BLENDER_MCP_ARGUMENTS_INVALID');
      sceneScope(args);
      need(motion.list(args.sceneId).jobs.some(value => value.jobId === args.jobId), 'BLENDER_MCP_JOB_NOT_FOUND', 404);
      return motion.stop({jobId:args.jobId});
    }
    if (name === 'qimovi_blender_status') {
      need(exact(args, Object.keys(scope)), 'BLENDER_MCP_ARGUMENTS_INVALID');
      const exchange = sceneScope(args), status = rehearsals.list(args.sceneId);
      return { schema: 'qimovi-blender-status/v1', ...status, basisSha256: exchange.basis.sha256,
        jobs: status.jobs.slice(0, 50), jobsTruncated: status.jobs.length > 50,
        transport: 'QIMOVI_LOCAL_MCP', workflow: 'OWNED_BACKGROUND_REHEARSAL', interactiveEditor: false, phoneCapture: 'NOT_CONNECTED', readOnly: true };
    }
    if (name === 'qimovi_blender_prepare_rehearsal') {
      need(exact(args, ['expectedProjectId', 'options']), 'BLENDER_MCP_ARGUMENTS_INVALID');
      const kit = kitFor(args), operation = describeBlenderOperation();
      for (const [key, prepared] of session.prepared) if (prepared.expiresAt <= now()) session.prepared.delete(key);
      if (session.prepared.size >= 32) session.prepared.delete(session.prepared.keys().next().value);
      session.prepared.set(kit.sha256, { expiresAt: now() + prepareTtlMs, implementationSha256: operation.implementation.sha256 });
      const qualification = rehearsals.qualify ? rehearsals.qualify(kit, args.options, operation)
        : qualifyBlenderOperation({ kit, options: args.options, operation, jobs: [], runtime: null, verifyRetained() { throw new Error('Unavailable'); } });
      const file = name => kit.files.find(file => file.path === name)?.content;
      return { schema: 'qimovi-blender-preparation/v1', projectId: kit.projectId, sourceHash: kit.sourceHash, sceneId: kit.sceneId, shotId: kit.shotId,
        kitSha256: kit.sha256, basisSha256: kit.basisSha256, planSha256: kit.planSha256,
        plan: JSON.parse(file('stage-plan.json')), planContent: file('stage-plan.json'), previzBrief: file('previz-brief.json') ? JSON.parse(file('previz-brief.json')) : null,
        prompts: file('previz-prompts.md') ?? null, expiresAt: new Date(now() + prepareTtlMs).toISOString(),
        operation, qualification, approvalGranted: false, finalMedia: false,
        willCreate: ['OWNED_JOB_RECEIPTS', 'EDITABLE_BLEND', 'OPENING_MIDPOINT_ENDING_PNGS', 'INDEPENDENT_REOPEN_EVIDENCE'] };
    }
    if (name === 'qimovi_blender_start_rehearsal') {
      need(exact(args, ['expectedProjectId', 'jobId', 'options', 'expectedKitSha256']) && uuid(args.jobId) && digest(args.expectedKitSha256), 'BLENDER_MCP_ARGUMENTS_INVALID');
      project(args.expectedProjectId);
      need(object(args.options) && args.options.target === 'BLENDER', 'BLENDER_MCP_BLENDER_ONLY');
      const existing = rehearsals.list(args.options.sceneId).jobs.find(job => job.jobId === args.jobId);
      if (existing) {
        need(existing.projectId === args.expectedProjectId && existing.sourceHash === store.project().sourceHash
          && existing.sourceHash === args.options.expectedSourceHash && existing.sceneId === args.options.sceneId && existing.shotId === args.options.shotId
          && existing.kitSha256 === args.expectedKitSha256 && existing.requestSha256 === sha256(canonical({ jobId: args.jobId, options: args.options })), 'BLENDER_MCP_REPLAY_MISMATCH', 409);
        // Recovery of an accepted request never rebuilds a changed scene or starts
        // another process. A fresh session may recover the same exact receipt.
        return existing;
      }
      need((session.prepared.get(args.expectedKitSha256)?.expiresAt ?? 0) > now(), 'BLENDER_MCP_PREPARATION_REQUIRED', 409);
      need(session.prepared.get(args.expectedKitSha256).implementationSha256 === describeBlenderOperation().implementation.sha256, 'BLENDER_MCP_IMPLEMENTATION_CHANGED_PREPARE_AGAIN', 409);
      const kit = kitFor(args);
      need(kit.sha256 === args.expectedKitSha256, 'BLENDER_MCP_PREPARATION_CHANGED', 409);
      return rehearsals.start({ jobId: args.jobId, options: args.options });
    }
    need(exact(args, [...Object.keys(scope), 'jobId']) && uuid(args.jobId), 'BLENDER_MCP_ARGUMENTS_INVALID');
    sceneScope(args);
    need(rehearsals.list(args.sceneId).jobs.some(job => job.jobId === args.jobId), 'BLENDER_MCP_JOB_NOT_FOUND', 404);
    return rehearsals.stop({ jobId: args.jobId });
  }
  return {
    handle(message, { ownerSessionKey, sessionId, protocolVersion, method = 'POST', accept = '' } = {}) {
      if (closed) return rpcError(503, null, -32000, 'BLENDER_MCP_CLOSED');
      if (!digest(ownerSessionKey)) return rpcError(401, null, -32000, 'BLENDER_MCP_OWNER_REQUIRED');
      prune();
      if (method === 'GET') return response(405, null, { Allow: 'POST, DELETE' });
      if (!['POST', 'DELETE'].includes(method)) return response(405, null, { Allow: 'POST, DELETE' });
      if (method === 'POST' && !['application/json', 'text/event-stream'].every(type => accept.split(',').some(item => item.trim().split(';')[0] === type))) return rpcError(406, null, -32600, 'BLENDER_MCP_ACCEPT_REQUIRED');
      if (method === 'DELETE') {
        const session = sessions.get(sessionId);
        if (!session || session.owner !== ownerSessionKey) return rpcError(404, null, -32000, 'BLENDER_MCP_SESSION_UNKNOWN');
        if (protocolVersion !== BLENDER_MCP_PROTOCOL) return rpcError(400, null, -32600, 'BLENDER_MCP_PROTOCOL_UNSUPPORTED');
        sessions.delete(sessionId); return response(204, null);
      }
      const hasId = object(message) && Object.hasOwn(message, 'id');
      const validId = hasId && ((Number.isSafeInteger(message.id) && message.id >= 0) || (typeof message.id === 'string' && message.id.length > 0 && message.id.length <= 100));
      const id = validId ? message.id : null;
      if (!object(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || !Object.keys(message).every(key => ['jsonrpc', 'id', 'method', 'params'].includes(key)) || (hasId && !validId) || !object(message.params ?? {})) return rpcError(400, id, -32600, 'BLENDER_MCP_REQUEST_INVALID');
      const params = message.params ?? {};
      if (message.method === 'initialize') {
        if (!hasId || sessionId || !exact(params, ['protocolVersion', 'capabilities', 'clientInfo']) || !protocolOffer(params.protocolVersion) || !object(params.capabilities) || !object(params.clientInfo) || !['name', 'version'].every(key => typeof params.clientInfo[key] === 'string' && params.clientInfo[key].length > 0 && params.clientInfo[key].length <= 100)) return rpcError(400, id, -32602, 'BLENDER_MCP_INITIALIZE_INVALID');
        // MCP lifecycle negotiation: reply with the version this server supports
        // even when the client offers another version. Subsequent requests must
        // still use that negotiated version; no other protocol is implemented.
        if (sessions.size >= maxSessions) return rpcError(429, id, -32000, 'BLENDER_MCP_SESSION_LIMIT');
        const key = randomUUID(); sessions.set(key, { owner: ownerSessionKey, expiresAt: now() + sessionTtlMs, ready: false, prepared: new Map() });
        return response(200, { jsonrpc: '2.0', id, result: { protocolVersion: BLENDER_MCP_PROTOCOL, serverInfo: { name: 'qimovi-blender-rehearsal', version: '1.0.0' }, capabilities: { tools: {} }, instructions: 'Local source-bound rehearsal tools. Prepare then explicitly start the exact kit. The existing owned runner creates pending preview artifacts; no active editor, physical camera, provider or final approval is connected.' } }, { 'Mcp-Session-Id': key });
      }
      if (!sessionId) return rpcError(400, id, -32000, 'BLENDER_MCP_SESSION_REQUIRED');
      const session = sessions.get(sessionId);
      if (!session || session.owner !== ownerSessionKey) return rpcError(404, id, -32000, 'BLENDER_MCP_SESSION_UNKNOWN');
      if (protocolVersion !== BLENDER_MCP_PROTOCOL) return rpcError(400, id, -32600, 'BLENDER_MCP_PROTOCOL_UNSUPPORTED');
      session.expiresAt = now() + sessionTtlMs;
      if (message.method === 'notifications/initialized' && !hasId && exact(params, [])) { session.ready = true; return response(202, null); }
      if (!hasId || !session.ready) return rpcError(400, id, -32600, 'BLENDER_MCP_NOT_INITIALIZED');
      if (message.method === 'ping' && exact(params, [])) return response(200, { jsonrpc: '2.0', id, result: {} });
      if (message.method === 'tools/list') {
        if (!exact(params, [])) return rpcError(400, id, -32602, 'BLENDER_MCP_ARGUMENTS_INVALID');
        return response(200, { jsonrpc: '2.0', id, result: { tools: structuredClone(tools) } });
      }
      if (message.method !== 'tools/call') return rpcError(200, id, -32601, 'BLENDER_MCP_METHOD_NOT_ALLOWED');
      if (!exact(params, ['name', 'arguments'])) return rpcError(400, id, -32602, 'BLENDER_MCP_ARGUMENTS_INVALID');
      try {
        const data = call(session, params.name, params.arguments);
        return response(200, { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: false } });
      } catch (error) {
        const code = /^(BLENDER_MCP|DCC)_[A-Z_]{1,100}$/.test(error.code ?? '') ? error.code : 'BLENDER_MCP_OPERATION_FAILED';
        return response(200, { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: code }], structuredContent: { error: code }, isError: true } });
      }
    },
    // HTTP owner login/logout invalidates transport sessions, never owned jobs.
    resetSessions() { sessions.clear(); },
    close() { closed = true; sessions.clear(); },
  };
}
