export const NODE_WORKFLOW_LIMITS = Object.freeze({ nodes: 64, edges: 128, bindingsPerNode: 32 });
export const NODE_CONNECTOR_IDS = Object.freeze(['comfyui', 'houdini', 'higgsfield', 'blender', 'unity', 'dreamina']);
const input = (id, label, dataType, required = true, multiple = false) => ({ id, label, dataType, required, multiple });
const output = (id, label, dataType) => ({ id, label, dataType });
export const NODE_CHOICE_TYPES = Object.freeze(['choice-group', 'casting-choice', 'reference-choice', 'prompt-choice']);
export const isNodeChoice = type => NODE_CHOICE_TYPES.includes(type);
const choice = (type, label, dataType) => ({ type, label, description: 'Compare saved branches and mark a planned preference. References, source and owner approvals remain unchanged.', inputs: [input('candidates', 'Candidate branches', dataType, true, true)], outputs: [output('selected', 'Planned choice', dataType)], bindingKinds: [], connectorIds: [], openTool: null });
export const NODE_LIBRARY = Object.freeze([
  { type: 'source', label: 'Source', description: 'Read the frozen scene and selected saved writing context. The graph cannot replace the screenplay.', inputs: [], outputs: [output('context', 'Scene context', 'SOURCE')], bindingKinds: ['frozen-source', 'screenplay-draft', 'production-handoff'], connectorIds: [], openTool: 'writing' },
  { type: 'casting', label: 'Casting', description: 'Prepare character and performer references. A connection grants no film-use permission.', inputs: [input('context', 'Scene context', 'SOURCE')], outputs: [output('cast', 'Cast context', 'CASTING')], bindingKinds: ['seed-character', 'casting-draft'], connectorIds: [], openTool: 'casting' },
  { type: 'references', label: 'References', description: 'Select retained research, context bundles and character images for this scene.', inputs: [input('context', 'Scene context', 'SOURCE'), input('cast', 'Cast context', 'CASTING', false)], outputs: [output('images', 'Reference context', 'REFERENCES')], bindingKinds: ['lore-source', 'context-bundle', 'casting-draft'], connectorIds: [], openTool: 'casting' },
  { type: 'storyboard', label: 'Storyboard', description: 'Connect source-bound storyboard candidates while retaining START, MOMENT and END roles.', inputs: [input('context', 'Scene context', 'SOURCE'), input('images', 'References', 'REFERENCES', false)], outputs: [output('boards', 'Storyboard plan', 'STORYBOARD')], bindingKinds: ['seed-cell', 'storyboard-cell', 'scene-plan'], connectorIds: [], openTool: 'scene' },
  { type: 'cameras', label: 'Cameras / DCC', description: 'Prepare Blender, Unity or Houdini camera planning. Existing observations remain separate from proposed geometry.', inputs: [input('boards', 'Storyboard plan', 'STORYBOARD')], outputs: [output('cameras', 'Camera context', 'CAMERAS')], bindingKinds: ['camera-observation'], connectorIds: ['blender', 'unity', 'houdini'], openTool: 'dcc' },
  { type: 'generation-brief', label: 'Generation brief', description: 'Use an exact saved clip brief and its selected source, references and storyboard context.', inputs: [input('context', 'Scene context', 'SOURCE'), input('cast', 'Cast context', 'CASTING', false), input('images', 'References', 'REFERENCES', false), input('boards', 'Storyboard plan', 'STORYBOARD', false), input('cameras', 'Camera context', 'CAMERAS', false)], outputs: [output('brief', 'Saved clip brief', 'GENERATION_BRIEF')], bindingKinds: ['generation-brief'], connectorIds: [], openTool: 'generation' },
  { type: 'generation-provider', label: 'Generation provider', description: 'Prepare a ComfyUI, Higgsfield or Dreamina handoff. A planned output is not a provider job or a returned take.', inputs: [input('brief', 'Saved clip brief', 'GENERATION_BRIEF')], outputs: [output('proposedTakes', 'Planned return', 'TAKE_CANDIDATE')], bindingKinds: ['generation-brief'], connectorIds: ['comfyui', 'higgsfield', 'dreamina'], openTool: 'generation' },
  { type: 'takes', label: 'Takes', description: 'Read measured imported media and its separate owner review. An incoming planned return does not create footage.', inputs: [input('proposed', 'Planned return', 'TAKE_CANDIDATE', false)], outputs: [output('takes', 'Retained takes', 'MEDIA_TAKE')], bindingKinds: ['measured-media-take'], connectorIds: [], openTool: 'takes' },
  { type: 'choice-group', label: 'Choice group', description: 'Compare take branches and mark a planned branch preference. This does not change an owner take review.', inputs: [input('candidates', 'Candidate branches', 'MEDIA_TAKE', true, true)], outputs: [output('selected', 'Planned choice', 'MEDIA_TAKE')], bindingKinds: [], connectorIds: [], openTool: null },
  { type: 'edit-delivery', label: 'Edit / delivery', description: 'Prepare an editorial handoff from retained takes. Rendered masters, delivery acceptance and publication remain separate.', inputs: [input('takes', 'Retained takes', 'MEDIA_TAKE', true, true)], outputs: [output('delivery', 'Delivery plan', 'EDIT_DELIVERY')], bindingKinds: ['measured-media-take'], connectorIds: [], openTool: 'takes' },
  choice('casting-choice', 'Casting comparison', 'CASTING'),
  choice('reference-choice', 'Reference comparison', 'REFERENCES'),
  choice('prompt-choice', 'Prompt comparison', 'GENERATION_BRIEF'),
]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const need = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code, status: 422 }); };
const shape = (value, fields) => need(object(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(','), 'NODE_GRAPH_FIELDS_INVALID');
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value) && value.isWellFormed();
export function validateNodeWorkflowRef(ref) {
  shape(ref, ['id', 'sha256']); need(identity(ref.id) && digest(ref.sha256), 'NODE_BINDING_REFERENCE_INVALID'); return ref;
}
export function nodePortCompatibility(graph, edge) {
  const from = graph.nodes.find(node => node.id === edge.from?.nodeId), to = graph.nodes.find(node => node.id === edge.to?.nodeId);
  if (!from || !to) return { compatible: false, reason: 'NODE_EDGE_ORPHAN' };
  if (from.id === to.id) return { compatible: false, reason: 'NODE_EDGE_SELF_REFERENCE' };
  const fromPort = NODE_LIBRARY.find(item => item.type === from.type)?.outputs.find(port => port.id === edge.from.portId);
  const toPort = NODE_LIBRARY.find(item => item.type === to.type)?.inputs.find(port => port.id === edge.to.portId);
  if (!fromPort || !toPort) return { compatible: false, reason: 'NODE_PORT_UNKNOWN' };
  return { compatible: fromPort.dataType === toPort.dataType, reason: fromPort.dataType === toPort.dataType ? 'EXACT_PORT_TYPE' : 'NODE_PORT_TYPE_MISMATCH' };
}
export function validateNodeGraph(graph) {
  shape(graph, ['nodes', 'edges']);
  need(Array.isArray(graph.nodes) && graph.nodes.length <= NODE_WORKFLOW_LIMITS.nodes && Array.isArray(graph.edges) && graph.edges.length <= NODE_WORKFLOW_LIMITS.edges, 'NODE_GRAPH_LIMIT_EXCEEDED');
  const nodes = new Map(), edges = new Set(), endpoints = new Set(), inputs = new Set();
  for (const node of graph.nodes) {
    shape(node, ['id', 'type', 'label', 'position', 'bindingRefs', 'connectorId', 'selectedNodeId']);
    need(identity(node.id) && !nodes.has(node.id) && text(node.label, 120), 'NODE_ID_OR_LABEL_INVALID');
    const definition = NODE_LIBRARY.find(item => item.type === node.type); need(definition, 'NODE_TYPE_UNKNOWN');
    shape(node.position, ['x', 'y']); need([node.position.x, node.position.y].every(value => Number.isSafeInteger(value) && Math.abs(value) <= 100000), 'NODE_POSITION_INVALID');
    need(Array.isArray(node.bindingRefs) && node.bindingRefs.length <= NODE_WORKFLOW_LIMITS.bindingsPerNode && new Set(node.bindingRefs.map(ref => ref?.id)).size === node.bindingRefs.length, 'NODE_BINDING_LIMIT_OR_DUPLICATE');
    for (const ref of node.bindingRefs) validateNodeWorkflowRef(ref);
    need(node.connectorId === null || definition.connectorIds.includes(node.connectorId), 'NODE_CONNECTOR_NOT_SUPPORTED');
    need(node.selectedNodeId === null || (isNodeChoice(node.type) && identity(node.selectedNodeId)), 'NODE_CHOICE_INVALID');
    nodes.set(node.id, node);
  }
  for (const edge of graph.edges) {
    shape(edge, ['id', 'from', 'to']); shape(edge.from, ['nodeId', 'portId']); shape(edge.to, ['nodeId', 'portId']);
    need(identity(edge.id) && !edges.has(edge.id) && [edge.from.nodeId, edge.from.portId, edge.to.nodeId, edge.to.portId].every(identity), 'NODE_EDGE_ID_INVALID'); edges.add(edge.id);
    const compatible = nodePortCompatibility(graph, edge); need(compatible.compatible, compatible.reason);
    const endpoint = JSON.stringify([edge.from.nodeId, edge.from.portId, edge.to.nodeId, edge.to.portId]); need(!endpoints.has(endpoint), 'NODE_EDGE_DUPLICATE'); endpoints.add(endpoint);
    const input = JSON.stringify([edge.to.nodeId, edge.to.portId]);
    const port = NODE_LIBRARY.find(item => item.type === nodes.get(edge.to.nodeId).type).inputs.find(item => item.id === edge.to.portId);
    need(port.multiple || !inputs.has(input), 'NODE_INPUT_ALREADY_CONNECTED'); inputs.add(input);
  }
  const pending = new Set(nodes.keys()), order = [];
  while (pending.size) {
    const ready = [...pending].filter(id => !graph.edges.some(edge => edge.to.nodeId === id && pending.has(edge.from.nodeId)));
    need(ready.length > 0, 'NODE_GRAPH_CYCLE');
    for (const id of ready) { pending.delete(id); order.push(id); }
  }
  for (const node of graph.nodes.filter(node => node.selectedNodeId !== null)) need(graph.edges.some(edge => edge.to.nodeId === node.id && edge.from.nodeId === node.selectedNodeId), 'NODE_CHOICE_NOT_CONNECTED');
  return { graph, order };
}
/** Resolve saved identities only; a planned choice never creates or approves a record. */
export function nodeOutputBindingRefs(graph, nodeId, visited = []) {
  const node = graph.nodes.find(item => item.id === nodeId);
  if (!node || visited.includes(nodeId)) return [];
  const seen = [...visited, nodeId];
  if (isNodeChoice(node.type)) {
    return node.selectedNodeId && graph.edges.some(edge => edge.to.nodeId === node.id && edge.from.nodeId === node.selectedNodeId)
      ? nodeOutputBindingRefs(graph, node.selectedNodeId, seen) : [];
  }
  const incoming = ['generation-brief', 'generation-provider'].includes(node.type)
    ? graph.edges.filter(edge => edge.to.nodeId === node.id && edge.to.portId === 'brief').flatMap(edge => nodeOutputBindingRefs(graph, edge.from.nodeId, seen)) : [];
  return [...new Map([...node.bindingRefs, ...incoming].map(ref => [`${ref.id}:${ref.sha256}`, ref])).values()];
}
export function validateNodeWorkflow(data, project) {
  shape(data, ['schemaVersion', 'sourceHash', 'sceneId', 'title', 'status', 'graph']);
  need(data.schemaVersion === 1 && data.status === 'DRAFT' && digest(data.sourceHash) && identity(data.sceneId) && text(data.title, 200), 'NODE_WORKFLOW_METADATA_INVALID');
  if (project) need(data.sourceHash === project.sourceHash && project.scenes.some(scene => scene.id === data.sceneId), 'NODE_WORKFLOW_SOURCE_MISMATCH');
  validateNodeGraph(data.graph); return data;
}
