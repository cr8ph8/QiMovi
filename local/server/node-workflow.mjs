import { comfyModelFiles } from './model-catalog.mjs';
import http from 'node:http';
import { canonical, check, sha256, PilotError } from './storage.mjs';
import { NODE_LIBRARY, NODE_CONNECTOR_IDS, isNodeChoice, nodeOutputBindingRefs, validateNodeGraph, validateNodeWorkflow } from '../contracts/node-workflow.mjs';
import { contextSceneCharacters } from '../contracts/context-bundle.mjs';
import { validateDreaminaDependencies } from './dreamina.mjs';

const ref = binding => ({ id: binding.id, sha256: binding.sha256 });
const recordKinds = new Set(NODE_LIBRARY.flatMap(node => node.bindingKinds).filter(kind => !['frozen-source', 'seed-cell', 'seed-character'].includes(kind)));
function sceneProject(store, sceneId) {
  const project = store.project(); check(project?.scenes.some(scene => scene.id === sceneId), 'NODE_SCENE_NOT_FOUND', 404); return project;
}
function sourceBindings(store, sceneId) {
  const project = sceneProject(store, sceneId), scene = project.scenes.find(scene => scene.id === sceneId);
  return [
    { id: `frozen-source:${project.sourceHash}`, sha256: project.sourceHash, kind: 'frozen-source', label: project.title || 'Frozen screenplay', sceneId, status: 'CURRENT', summary: `${scene.heading}: exact frozen screenplay bytes` },
    ...contextSceneCharacters(project, sceneId).map(character => ({ id: `seed-character:${character.id}`, sha256: sha256(canonical(character)), kind: 'seed-character', label: character.name, sceneId, status: 'CURRENT', summary: 'Source character; casting and film-use approval remain separate' })),
    ...(project.cells ?? []).filter(cell => cell.sceneId === sceneId).map(cell => ({ id: `seed-cell:${cell.id}`, sha256: sha256(canonical(cell)), kind: 'seed-cell', label: `${cell.id} · ${cell.role}`, sceneId, status: 'CURRENT', summary: cell.description || 'Frozen storyboard candidate' })),
  ];
}
function matchesScene(record, sceneId, project) {
  if (record.data.sourceHash !== project.sourceHash || (record.data.sceneId && record.data.sceneId !== sceneId)) return false;
  return record.kind !== 'casting-draft' || contextSceneCharacters(project, sceneId).some(character => character.id === record.data.characterId);
}
function verifyRecord(store, record, { historical = false } = {}) {
  check(sha256(canonical(record.data)) === record.sha256, 'NODE_BINDING_HASH_MISMATCH', 409);
  store.validateSavedRecord(record);
  if (!historical && record.kind === 'generation-brief') validateDreaminaDependencies(record.data, store.resolvedProject(), store.rawList(), store);
}
export function nodeWorkflowBindings(store, sceneId) {
  const project = sceneProject(store, sceneId), seeded = sourceBindings(store, sceneId);
  const records = store.rawList().filter(record => recordKinds.has(record.kind) && matchesScene(record, sceneId, project));
  for (const record of records) {
    let status = 'CURRENT', summary = 'Exact retained workspace record';
    try { verifyRecord(store, record); } catch (error) { status = 'STALE'; summary = error.code || 'Record dependencies need review'; }
    seeded.push({ id: record.id, sha256: record.sha256, kind: record.kind,
      label: String(record.data.title || record.data.originalFilename || record.data.performer || record.data.cellId || record.id).slice(0, 240), sceneId, status, summary });
  }
  return seeded;
}
export function validateNodeWorkflowReferences(store, kind, data, { requireCurrent = true } = {}) {
  if (kind !== 'node-workflow') return;
  validateNodeWorkflow(data, store.project());
  const project = store.project(), seeded = sourceBindings(store, data.sceneId);
  for (const node of data.graph.nodes) {
    const allowed = NODE_LIBRARY.find(definition => definition.type === node.type).bindingKinds;
    for (const binding of node.bindingRefs) {
      const source = seeded.find(value => value.id === binding.id);
      if (source) {
        check(source.sha256 === binding.sha256 && allowed.includes(source.kind), 'NODE_SOURCE_BINDING_MISMATCH', 409);
        if (source.kind === 'frozen-source') store.blobInfo(project.sourceHash);
        continue;
      }
      const history = store.history(binding.id), saved = history.find(record => record.sha256 === binding.sha256);
      check(saved && allowed.includes(saved.kind) && matchesScene(saved, data.sceneId, project), 'NODE_BINDING_MISSING_OR_WRONG_TYPE', 409);
      verifyRecord(store, saved, { historical: !requireCurrent });
      check(!requireCurrent || history.at(-1).sha256 === saved.sha256, 'NODE_BINDING_STALE', 409);
    }
  }
}
export function defaultNodeGraph(store, sceneId, bindings = nodeWorkflowBindings(store, sceneId)) {
  const nodes = NODE_LIBRARY.filter(definition => !['casting-choice', 'reference-choice', 'prompt-choice'].includes(definition.type)).map((definition, index) => ({ id: definition.type, type: definition.type, label: definition.label,
    position: { x: (index % 5) * 280, y: Math.floor(index / 5) * 240 },
    bindingRefs: bindings.filter(binding => definition.bindingKinds.includes(binding.kind) && binding.status === 'CURRENT').slice(0, 8).map(ref),
    connectorId: definition.type === 'cameras' ? 'blender' : definition.type === 'generation-provider' ? 'dreamina' : null, selectedNodeId: null }));
  const wires = [
    ['source', 'context', 'casting', 'context'], ['source', 'context', 'references', 'context'], ['casting', 'cast', 'references', 'cast'],
    ['source', 'context', 'storyboard', 'context'], ['references', 'images', 'storyboard', 'images'], ['storyboard', 'boards', 'cameras', 'boards'],
    ['source', 'context', 'generation-brief', 'context'], ['casting', 'cast', 'generation-brief', 'cast'], ['references', 'images', 'generation-brief', 'images'],
    ['storyboard', 'boards', 'generation-brief', 'boards'], ['cameras', 'cameras', 'generation-brief', 'cameras'],
    ['generation-brief', 'brief', 'generation-provider', 'brief'], ['generation-provider', 'proposedTakes', 'takes', 'proposed'],
    ['takes', 'takes', 'choice-group', 'candidates'], ['choice-group', 'selected', 'edit-delivery', 'takes'],
  ];
  return { nodes, edges: wires.map(([fromNode, fromPort, toNode, toPort], index) => ({ id: `edge-${index + 1}`, from: { nodeId: fromNode, portId: fromPort }, to: { nodeId: toNode, portId: toPort } })) };
}
const capability = (id, label, method, path, effect = 'READ_ONLY') => ({ id, label, method, path, effect });
const baseConnector = (id, label, description, capabilities) => ({ id, label, description, capabilities, status: 'UNCONFIGURED', checkedAt: null, origin: null, configuration: 'UNCONFIGURED', reason: '', executionAuthorized: false });
function comfyOrigin(value) {
  try { const url = new URL(value); return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port && Number(url.port) >= 1 && Number(url.port) <= 65535 && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.origin : null; } catch { return null; }
}
function localJSON(origin, pathname, { timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const request = http.get(origin + pathname, { headers: { Accept: 'application/json' }, agent: false }, response => {
      if (response.statusCode !== 200 || !response.headers['content-type']?.toLowerCase().includes('application/json')) { response.destroy(); reject(new PilotError('CONNECTOR_RESPONSE_REJECTED', 409)); return; }
      let size = 0; const chunks = [];
      response.on('data', chunk => { size += chunk.length; if (size > maxBytes) response.destroy(new PilotError('CONNECTOR_RESPONSE_TOO_LARGE', 409)); else chunks.push(chunk); });
      response.once('error', reject);
      response.once('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new PilotError('CONNECTOR_RESPONSE_INVALID', 409)); } });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new PilotError('CONNECTOR_TIMED_OUT', 409)));
    const deadline = setTimeout(() => request.destroy(new PilotError('CONNECTOR_TIMED_OUT', 409)), timeoutMs);
    request.once('close', () => clearTimeout(deadline));
    request.once('error', reject);
  });
}
export function createNodeConnectorService({ comfyuiOrigin = process.env.FILMSTACK_COMFYUI_ORIGIN || 'http://127.0.0.1:8188', timeoutMs = 1500, maxBytes = 2 * 1024 * 1024 } = {}) {
  const origin = comfyOrigin(comfyuiOrigin), rows = new Map();
  const comfy = baseConnector('comfyui', 'ComfyUI', 'A local ComfyUI server can expose its system, node catalogue and queue through read-only checks.', [capability('system-stats', 'Read runtime information', 'GET', '/system_stats'), capability('node-catalogue', 'Read actual ComfyUI node schemas', 'GET', '/object_info'), capability('queue-status', 'Read queue status', 'GET', '/queue')]);
  Object.assign(comfy, { status: origin ? 'NOT_CHECKED' : 'UNCONFIGURED', origin, configuration: origin ? (process.env.FILMSTACK_COMFYUI_ORIGIN || comfyuiOrigin !== 'http://127.0.0.1:8188' ? 'HOST_CONFIGURED' : 'DEFAULT_LOCAL_ADDRESS') : 'UNCONFIGURED', reason: origin ? 'Live local check has not run in this service session.' : 'The host ComfyUI address must be an explicit HTTP 127.0.0.1 port.' }); rows.set(comfy.id, comfy);
  const houdini = baseConnector('houdini', 'Houdini', 'Prepare a standards-based MCP discovery handshake. No Houdini bridge or callable tool is configured in this local application.', []); houdini.reason = 'No host MCP transport or tool catalogue is configured. Installed software would not establish a connection.'; rows.set(houdini.id, houdini);
  const higgsfield = baseConnector('higgsfield', 'Higgsfield', 'Browse retained image, video, voice, set and promotion tools. Prepare model-specific requests from saved clip inputs. Codex connector credentials are not inherited by this application.', [capability('tools', 'Browse retained tools and model requirements', 'GET', '/api/higgsfield/tools'), capability('compose', 'Prepare a model-specific call plan', 'POST', '/api/higgsfield/compose', 'PREPARE_ONLY'), capability('context', 'Read retained account observation', 'GET', '/api/higgsfield/context'), capability('preview', 'Inspect the retained Seedance preflight', 'POST', '/api/higgsfield/preview', 'PREPARE_ONLY')]);
  const blender = baseConnector('blender', 'Blender', 'Prepare and run source-bound local Blender rehearsals through QiMovi MCP. The dedicated camera workspace owns execution; connecting graph nodes does not start a job.', [capability('camera-exchange', 'Prepare camera exchange', 'GET', '/api/dcc/exchange', 'PREPARE_ONLY'), capability('blender-mcp', 'Discover local rehearsal tools', 'POST', '/api/blender/mcp'), capability('returned-previews', 'Read retained preview frames', 'GET', '/api/dcc/stage-returns')]);
  const unity = baseConnector('unity', 'Unity', 'Prepare the existing source-bound camera exchange. No Unity editor connection or accepted round trip is claimed.', [capability('camera-exchange', 'Prepare camera exchange', 'GET', '/api/dcc/exchange', 'PREPARE_ONLY')]);
  const dreamina = baseConnector('dreamina', 'Dreamina', 'Prepare and export an exact saved clip package for manual handoff. Export does not submit a generation.', [capability('context', 'Read clip preparation context', 'GET', '/api/dreamina/context'), capability('export', 'Export saved draft package', 'GET', '/api/dreamina/export', 'PREPARE_ONLY')]);
  for (const connector of [higgsfield, blender, unity, dreamina]) { Object.assign(connector, { status: 'PREPARE_ONLY', configuration: 'LOCAL_PREPARATION_ONLY', reason: 'Local preparation routes are implemented; live external execution is not connected.' }); rows.set(connector.id, connector); }
  Object.assign(blender, { status: 'NOT_CHECKED', configuration: 'LOCAL_MCP_REHEARSAL', reason: 'QiMovi MCP rehearsal tools are installed. Open 3D & cameras to check this scene and run a bounded local rehearsal. Interactive editor and phone capture remain separate.' });
  let inFlight;
  return {
    list() { return [...rows.values()].map(row => structuredClone(row)); },
    async check(connectorId) {
      check(NODE_CONNECTOR_IDS.includes(connectorId), 'NODE_CONNECTOR_UNKNOWN');
      if (connectorId !== 'comfyui' || !origin) { const row = rows.get(connectorId); row.checkedAt = new Date().toISOString(); return structuredClone(row); }
      if (inFlight) return structuredClone(await inFlight);
      inFlight = (async () => {
        const observation = { ...comfy, checkedAt: new Date().toISOString() };
        try {
          const [system, catalogue, queue] = await Promise.all(['/system_stats', '/object_info', '/queue'].map(route => localJSON(origin, route, { timeoutMs, maxBytes })));
          check(system && typeof system.system === 'object' && Array.isArray(system.devices) && catalogue && typeof catalogue === 'object' && !Array.isArray(catalogue) && Array.isArray(queue?.queue_running) && Array.isArray(queue?.queue_pending), 'CONNECTOR_SCHEMA_MISMATCH', 409);
          Object.assign(observation, { status: 'AVAILABLE', reason: 'All three bounded read-only ComfyUI endpoints responded with the expected structures.', observation: { version: typeof system.system.comfyui_version === 'string' ? system.system.comfyui_version.slice(0, 100) : null, deviceCount: system.devices.length, nodeClassCount: Object.keys(catalogue).length, running: queue.queue_running.length, pending: queue.queue_pending.length, scope: 'READ_ONLY_RUNTIME_DISCOVERY', models: comfyModelFiles(catalogue) } });
        } catch (error) { Object.assign(observation, { status: 'UNAVAILABLE', reason: error.code === 'ECONNREFUSED' ? 'No ComfyUI service answered at the configured local address.' : error.code || 'CONNECTOR_CHECK_FAILED', observation: null }); }
        rows.set('comfyui', observation); return observation;
      })();
      try { return structuredClone(await inFlight); } finally { inFlight = null; }
    },
  };
}
function selectedBriefs(node, graph) {
  const refs = nodeOutputBindingRefs(graph, node.id).filter(binding => binding.id.startsWith('generation-brief:'));
  return [...new Map(refs.map(binding => [canonical(binding), binding])).values()];
}
function preparedRequest(node, graph, sourceHash, sceneId) {
  const briefRefs = selectedBriefs(node, graph);
  // Direct selections and the named incoming clip port must resolve to the
  // same exact record. Array order can never decide which clip is exported.
  if (node.type === 'generation-provider' && briefRefs.length > 1) return null;
  if (node.connectorId === 'comfyui') return { transport: 'COMFYUI_LOCAL_HTTP', checks: [{ method: 'GET', path: '/system_stats' }, { method: 'GET', path: '/object_info' }, { method: 'GET', path: '/queue' }], submission: { method: 'POST', path: '/prompt', body: null, requiredBodyFields: ['prompt'], status: 'NOT_PREPARED_NO_EXECUTABLE_COMFY_GRAPH', reason: 'This application graph is not ComfyUI API prompt JSON. Export and validate a concrete ComfyUI workflow against its actual node catalogue before an independently authorized run.' } };
  if (node.connectorId === 'houdini') return { transport: 'MCP_UNCONFIGURED', initialize: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'CanIScreenwrite', version: '0.1' } } }, initialized: { jsonrpc: '2.0', method: 'notifications/initialized' }, listTools: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, toolCall: null, status: 'DISCOVERY_MANIFEST_ONLY' };
  if (node.connectorId === 'blender') return { method: 'GET', path: `/api/dcc/exchange?sceneId=${encodeURIComponent(sceneId)}&sourceHash=${sourceHash}`, scope: 'PLANNING_EXPORT_WITH_SEPARATE_REHEARSAL', rehearsal: { transport: 'QIMOVI_LOCAL_MCP', method: 'POST', path: '/api/blender/mcp', tools: ['qimovi_blender_status','qimovi_blender_prepare_rehearsal','qimovi_blender_start_rehearsal','qimovi_blender_stop_rehearsal'], automaticExecution: false } };
  if (node.connectorId === 'unity') return { method: 'GET', path: `/api/dcc/exchange?sceneId=${encodeURIComponent(sceneId)}&sourceHash=${sourceHash}`, scope: 'PLANNING_EXPORT_ONLY' };
  if (node.connectorId === 'dreamina') return briefRefs.length === 1 ? { method: 'GET', path: `/api/dreamina/export?id=${encodeURIComponent(briefRefs[0].id)}&sha256=${briefRefs[0].sha256}`, scope: 'DRAFT_PACKAGE_ONLY' } : null;
  if (node.connectorId === 'higgsfield') return { method: 'GET', path: '/api/higgsfield/context', scope: 'RETAINED_OBSERVATION_NOT_LIVE_PROVIDER_CONNECTION' };
  return null;
}
const uniqueRefs = refs => [...new Map(refs.map(binding => [`${binding.id}:${binding.sha256}`, ref(binding)])).values()];
function incomingDependencies(graph, node) {
  const incoming = graph.edges.filter(edge => edge.to.nodeId === node.id);
  // A comparison forwards only its selected branch. Other branches remain in
  // the graph and retain their own issues, but cannot poison that preference.
  return isNodeChoice(node.type) && node.selectedNodeId !== null
    ? incoming.filter(edge => edge.from.nodeId === node.selectedNodeId) : incoming;
}
function workPlanAction(node, definition, readiness, ownIssues, blockedBy, graph) {
  let tool = definition.openTool, label, reason;
  if (readiness === 'NEEDS_INPUT') {
    reason = ownIssues[0]?.message || 'Select current saved inputs for this step.';
    if (ownIssues.some(issue => issue.code === 'NODE_CHOICE_PENDING')) { tool = null; label = 'Choose a branch'; }
    else if (ownIssues.some(issue => issue.code === 'NODE_INPUT_MISSING')) { tool = null; label = 'Connect required inputs'; }
    else if (ownIssues.some(issue => issue.code === 'NODE_CONNECTOR_REQUIRED')) { tool = null; label = 'Choose a connector'; }
    else if (ownIssues.some(issue => issue.code !== 'NODE_RETAINED_INPUT_MISSING' && issue.code !== 'NODE_BRIEF_SELECTION_REQUIRED')) { tool = null; label = 'Review saved inputs'; }
    else label = `Prepare ${node.label}`;
  } else if (readiness === 'WAITING_ON_UPSTREAM') {
    tool = null; label = 'Review dependencies';
    reason = `Resolve ${blockedBy.map(id => graph.nodes.find(item => item.id === id)?.label || id).join(', ')} before handing off this step.`;
  } else if (readiness === 'CONNECTOR_UNAVAILABLE') {
    tool = null; label = 'Review connection'; reason = ['comfyui', 'houdini'].includes(node.connectorId) ? 'Check or configure this connector first. Its graph integration is discovery-only; it does not provide an executable creative workflow.' : 'This connector is not available. Choose a supported connection or qualify it before using its handoff.';
  } else if (readiness === 'PREPARATION_ONLY') {
    label = tool === 'dcc' ? 'Open 3D & cameras' : tool === 'generation' ? 'Open generation' : `Prepare ${node.label}`;
    reason = node.connectorId ? 'Continue in the existing tool to prepare and review an explicitly requested operation. This graph does not run it.' : 'This step describes planned work. Retain its inputs or results in the linked tool before treating them as evidence.';
    if (['comfyui', 'houdini'].includes(node.connectorId)) { tool = null; label = 'Inspect connector requirements'; reason = 'This connection supports discovery only. A compatible executable workflow, supported tool contract and separate operation approval are still required; no creative job can run from this graph.'; }
  } else {
    label = `Review ${node.label}`; reason = 'Current saved inputs are available for review. Their presence does not approve the creative result or finish production.';
  }
  return { nodeId: node.id, tool, label, reason };
}
function summarizeWorkPlan(plan) {
  const count = readiness => plan.filter(step => step.readiness === readiness).length;
  return { totalSteps: plan.length, readyForReview: count('READY_TO_REVIEW'), needsInput: count('NEEDS_INPUT'), waitingOnUpstream: count('WAITING_ON_UPSTREAM'), preparationOnly: count('PREPARATION_ONLY'), connectorUnavailable: count('CONNECTOR_UNAVAILABLE') };
}
export function validateNodeWorkflowPlan(store, input, connectors) {
  check(input && Object.keys(input).sort().join(',') === 'graph,sceneId,sourceHash', 'NODE_VALIDATION_REQUEST_INVALID');
  const project = sceneProject(store, input.sceneId); check(input.sourceHash === project.sourceHash, 'NODE_WORKFLOW_SOURCE_MISMATCH', 409);
  const issues = [], verifiedBindings = new Map(); let order = [], graphHash = null;
  try { graphHash = sha256(canonical(input.graph)); order = validateNodeGraph(input.graph).order; }
  catch (error) { return { schemaVersion: 'filmstack-node-validation/v1', valid: false, scope: 'PLANNING_ONLY', issues: [{ code: error.code || 'NODE_GRAPH_INVALID', message: error.message }], plan: [], graphHash, sourceHash: input.sourceHash, sceneId: input.sceneId, summary: summarizeWorkPlan([]), nextAction: null, executionAuthorized: false }; }
  if (!input.graph.nodes.length) issues.push({ code: 'NODE_GRAPH_EMPTY', message: 'Add a source and the steps needed for this scene before reviewing a work plan.' });
  for (const node of input.graph.nodes) {
    const definition = NODE_LIBRARY.find(item => item.type === node.type);
    for (const port of definition.inputs.filter(port => port.required)) if (!input.graph.edges.some(edge => edge.to.nodeId === node.id && edge.to.portId === port.id)) issues.push({ code: 'NODE_INPUT_MISSING', message: `Connect ${port.label} for ${node.label}.`, nodeId: node.id });
    const currentBindings = []; let bindingIssue = false;
    for (const binding of node.bindingRefs) {
      try {
        validateNodeWorkflowReferences(store, 'node-workflow', { schemaVersion: 1, sourceHash: input.sourceHash, sceneId: input.sceneId, title: 'Validation', status: 'DRAFT', graph: { nodes: [{ ...node, selectedNodeId: null, bindingRefs: [binding] }], edges: [] } });
        currentBindings.push(binding);
      } catch (error) {
        if (!bindingIssue) issues.push({ code: error.code || 'NODE_BINDING_INVALID', message: `Retained inputs for ${node.label} need attention.`, nodeId: node.id });
        bindingIssue = true;
      }
    }
    verifiedBindings.set(node.id, currentBindings);
    if (['source', 'casting', 'references', 'storyboard', 'generation-brief', 'takes', 'edit-delivery'].includes(node.type) && node.bindingRefs.length === 0) issues.push({ code: 'NODE_RETAINED_INPUT_MISSING', message: `${node.label} has no retained record selected; connections alone do not create its data.`, nodeId: node.id });
    if (definition.connectorIds.length && node.connectorId === null) issues.push({ code: 'NODE_CONNECTOR_REQUIRED', message: `Choose the software handoff for ${node.label}.`, nodeId: node.id });
    if (['generation-brief', 'generation-provider'].includes(node.type)) {
      const briefs = selectedBriefs(node, input.graph);
      if (briefs.length > 1) issues.push({ code: 'NODE_BRIEF_SELECTION_AMBIGUOUS', message: `Select one exact saved brief for ${node.label}; its direct and connected selections must agree.`, nodeId: node.id });
      if (node.connectorId === 'dreamina' && briefs.length === 0) issues.push({ code: 'NODE_BRIEF_SELECTION_REQUIRED', message: 'Select one exact saved brief before preparing a Dreamina export.', nodeId: node.id });
    }
    if (isNodeChoice(node.type) && node.selectedNodeId === null) issues.push({ code: 'NODE_CHOICE_PENDING', message: 'Choose a planned candidate branch before using this comparison output.', nodeId: node.id });
  }
  const plan = [], steps = new Map(), verifiedOutputs = new Map();
  for (const nodeId of order) {
    const node = input.graph.nodes.find(value => value.id === nodeId), connector = connectors.find(item => item.id === node.connectorId), definition = NODE_LIBRARY.find(item => item.type === node.type);
    const ownIssues = issues.filter(issue => issue.nodeId === nodeId), incoming = incomingDependencies(input.graph, node);
    const dependsOn = [...new Set(incoming.map(edge => edge.from.nodeId))];
    const blockedBy = [...new Set(dependsOn.flatMap(id => {
      const step = steps.get(id);
      return ['NEEDS_INPUT', 'CONNECTOR_UNAVAILABLE'].includes(step.readiness) ? [id, ...step.blockedBy] : step.readiness === 'WAITING_ON_UPSTREAM' ? step.blockedBy : [];
    }))];
    const inputRefs = uniqueRefs([...verifiedBindings.get(nodeId), ...incoming.flatMap(edge => verifiedOutputs.get(edge.from.nodeId))]);
    const unavailable = node.connectorId !== null && (!connector || ['UNCONFIGURED', 'UNAVAILABLE', 'UNSUPPORTED'].includes(connector.status) || ['comfyui', 'houdini'].includes(node.connectorId) && connector.status === 'NOT_CHECKED');
    const outputRefs = ownIssues.length || blockedBy.length || node.type === 'generation-provider' ? [] : isNodeChoice(node.type) ? verifiedOutputs.get(node.selectedNodeId) ?? [] : verifiedBindings.get(nodeId);
    verifiedOutputs.set(nodeId, outputRefs);
    const retainedOutput = outputRefs.length > 0;
    const readiness = ownIssues.length ? 'NEEDS_INPUT' : blockedBy.length ? 'WAITING_ON_UPSTREAM' : unavailable ? 'CONNECTOR_UNAVAILABLE' : node.connectorId !== null || !retainedOutput ? 'PREPARATION_ONLY' : 'READY_TO_REVIEW';
    const step = { nodeId, label: node.label, operation: node.connectorId ? 'PREPARE_CONNECTOR_REQUEST' : isNodeChoice(node.type) ? 'COMPARE_PLANNED_BRANCHES' : 'READ_RETAINED_CONTEXT', status: ownIssues.length ? 'NEEDS_INPUT' : blockedBy.length ? 'WAITING_ON_UPSTREAM' : unavailable ? 'CONNECTOR_UNAVAILABLE' : 'PREPARED', request: preparedRequest(node, input.graph, input.sourceHash, input.sceneId), dependsOn, blockedBy, inputRefs,
      evidence: retainedOutput && !ownIssues.length && !blockedBy.length ? 'RETAINED_INPUTS' : 'PLANNED_ONLY', readiness, nextAction: workPlanAction(node, definition, readiness, ownIssues, blockedBy, input.graph) };
    plan.push(step); steps.set(nodeId, step);
  }
  const nextStep = plan.find(step => step.readiness === 'NEEDS_INPUT' && !step.blockedBy.length)
    || plan.find(step => step.readiness === 'CONNECTOR_UNAVAILABLE')
    || plan.find(step => step.readiness === 'PREPARATION_ONLY')
    || plan.find(step => step.readiness === 'READY_TO_REVIEW');
  return { schemaVersion: 'filmstack-node-validation/v1', valid: issues.length === 0, scope: 'PLANNING_ONLY', issues, plan, graphHash, sourceHash: input.sourceHash, sceneId: input.sceneId, summary: summarizeWorkPlan(plan), nextAction: nextStep?.nextAction ?? null, executionAuthorized: false };
}
export function getNodeWorkflow(store, sceneId, connectors) {
  const project = sceneProject(store, sceneId), bindings = nodeWorkflowBindings(store, sceneId);
  const record = store.rawList('node-workflow').find(record => record.id === `node-workflow:${sceneId}`) ?? null;
  if (record) { check(sha256(canonical(record.data)) === record.sha256, 'NODE_WORKFLOW_HASH_MISMATCH', 409); validateNodeWorkflow(record.data, project); }
  return { schemaVersion: 'filmstack-node-workflow/v1', sourceHash: project.sourceHash, sceneId, library: NODE_LIBRARY, connectors, graph: record?.data.graph ?? defaultNodeGraph(store, sceneId, bindings), record, bindings };
}
