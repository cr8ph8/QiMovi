import type { AuthoringInputRef, WorkspaceRecord } from './types';

export interface NodePort { id: string; label: string; dataType: string; required?: boolean; multiple?: boolean }
export interface NodeDefinition { type: string; label: string; description: string; inputs: NodePort[]; outputs: NodePort[]; bindingKinds: string[]; connectorIds: string[]; openTool: string | null }
export interface WorkflowNode { id: string; type: string; label: string; position: { x: number; y: number }; bindingRefs: AuthoringInputRef[]; connectorId: string | null; selectedNodeId: string | null }
export interface NodeEndpoint { nodeId: string; portId: string }
export interface WorkflowEdge { id: string; from: NodeEndpoint; to: NodeEndpoint }
export interface WorkflowGraph { nodes: WorkflowNode[]; edges: WorkflowEdge[] }
export interface NodeWorkflowData { schemaVersion: 1; sourceHash: string; sceneId: string; title: string; status: 'DRAFT'; graph: WorkflowGraph }
export type NodeWorkflowRecord = WorkspaceRecord & { kind: 'node-workflow'; data: NodeWorkflowData };
export interface NodeBinding { id: string; sha256: string; kind: string; label: string; sceneId: string | null; status: 'CURRENT' | 'STALE'; summary: string }
export interface NodeRecordRequest {
  nonce: string; projectId: string; sourceHash: string; sceneId: string;
  recordRef: { id: string; sha256: string; kind: string }; intent: 'OPEN_RECORD' | 'IMPORT_RETURN';
}
export interface ConnectorDescriptor {
  id: string; label: string; description: string; status: 'UNCONFIGURED' | 'NOT_CHECKED' | 'AVAILABLE' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'PREPARE_ONLY'; checkedAt: string | null;
  origin: string | null; configuration: 'DEFAULT_LOCAL_ADDRESS' | 'HOST_CONFIGURED' | 'LOCAL_PREPARATION_ONLY' | 'LOCAL_MCP_REHEARSAL' | 'UNCONFIGURED'; executionAuthorized: false; capabilities: { id: string; label: string; method: string; path: string; effect: 'READ_ONLY' | 'PREPARE_ONLY' }[]; reason: string;
}
export interface NodeWorkflowCatalog { schemaVersion: 'filmstack-node-workflow/v1'; sourceHash: string; sceneId: string; library: NodeDefinition[]; connectors: ConnectorDescriptor[]; graph: WorkflowGraph; record: NodeWorkflowRecord | null; bindings: NodeBinding[] }
export type NodeReadiness = 'READY_TO_REVIEW' | 'NEEDS_INPUT' | 'WAITING_ON_UPSTREAM' | 'CONNECTOR_UNAVAILABLE' | 'PREPARATION_ONLY';
export interface NodeNextAction { nodeId: string; tool: string | null; label: string; reason: string }
export interface NodeWorkStep {
  nodeId: string; label: string; operation: string; status: string; request: unknown;
  dependsOn: string[]; blockedBy: string[]; inputRefs: AuthoringInputRef[];
  evidence: 'RETAINED_INPUTS' | 'PLANNED_ONLY'; readiness: NodeReadiness; nextAction: NodeNextAction;
}
export interface NodeValidation {
  schemaVersion: string; valid: boolean; scope: 'PLANNING_ONLY'; sourceHash: string; sceneId: string;
  issues: { code: string; message: string; nodeId?: string; edgeId?: string }[];
  plan: NodeWorkStep[]; graphHash: string; executionAuthorized: false;
  summary: { totalSteps: number; readyForReview: number; needsInput: number; waitingOnUpstream: number; preparationOnly: number; connectorUnavailable: number };
  nextAction: NodeNextAction | null;
}
export const nodeReadinessLabel: Record<NodeReadiness, string> = {
  READY_TO_REVIEW: 'Inputs retained · review next', NEEDS_INPUT: 'Needs input',
  WAITING_ON_UPSTREAM: 'Waiting for earlier work', CONNECTOR_UNAVAILABLE: 'Connection needed', PREPARATION_ONLY: 'Preparation available',
};
export interface NodeViewport { x: number; y: number; zoom: number }
export const NODE_WIDTH = 232;
export function nodeHeight(definition?: NodeDefinition) { return 75 + Math.max(definition?.inputs.length ?? 0, definition?.outputs.length ?? 0, 1) * 27; }
export function socketPoint(node: WorkflowNode, definition: NodeDefinition | undefined, direction: 'input' | 'output', portId: string) {
  const index = (direction === 'input' ? definition?.inputs : definition?.outputs)?.findIndex(port => port.id === portId) ?? 0;
  return { x: node.position.x + (direction === 'output' ? NODE_WIDTH : 0), y: node.position.y + 69 + Math.max(0, index) * 27 };
}
function edgeControlPoints(from: { x: number; y: number }, to: { x: number; y: number }) {
  const bend = Math.max(65, Math.abs(to.x - from.x) * .45);
  return [from, { x: from.x + bend, y: from.y }, { x: to.x - bend, y: to.y }, to];
}
export function edgePath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const [start, control1, control2, end] = edgeControlPoints(from, to);
  return `M ${start.x} ${start.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`;
}
export function edgeBounds(from: { x: number; y: number }, to: { x: number; y: number }) {
  const points = edgeControlPoints(from, to);
  function extent(axis: 'x' | 'y') {
    const [p0, p1, p2, p3] = points.map(point => point[axis]);
    const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
    const discriminant = b * b - 4 * a * c;
    const roots = Math.abs(a) < 1e-9 ? Math.abs(b) < 1e-9 ? [] : [-c / b] : discriminant < 0 ? [] : [(-b + Math.sqrt(discriminant)) / (2 * a), (-b - Math.sqrt(discriminant)) / (2 * a)];
    const values = [p0, p3, ...roots.filter(t => t > 0 && t < 1).map(t => (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3)];
    return [Math.min(...values), Math.max(...values)];
  }
  const [left, right] = extent('x'), [top, bottom] = extent('y');
  return { left, top, right, bottom };
}
export function canvasPoint(point: { x: number; y: number }, viewport: NodeViewport) { return { x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom }; }
export function nodePosition(position: { x: number; y: number }) { return { x: Math.max(-20000, Math.min(20000, Math.round(position.x))), y: Math.max(-20000, Math.min(20000, Math.round(position.y))) }; }
export function fitGraph(graph: WorkflowGraph, library: NodeDefinition[], width: number, height: number): NodeViewport {
  if (!graph.nodes.length || width < 1 || height < 1) return { x: 40, y: 40, zoom: 1 };
  const edgeExtents = graph.edges.flatMap(edge => {
    const source = graph.nodes.find(node => node.id === edge.from.nodeId), target = graph.nodes.find(node => node.id === edge.to.nodeId);
    if (!source || !target) return [];
    return [edgeBounds(socketPoint(source, library.find(item => item.type === source.type), 'output', edge.from.portId), socketPoint(target, library.find(item => item.type === target.type), 'input', edge.to.portId))];
  });
  const left = Math.min(...graph.nodes.map(node => node.position.x - 8), ...edgeExtents.map(edge => edge.left - 9)), top = Math.min(...graph.nodes.map(node => node.position.y), ...edgeExtents.map(edge => edge.top - 9));
  const right = Math.max(...graph.nodes.map(node => node.position.x + NODE_WIDTH + 8), ...edgeExtents.map(edge => edge.right + 9)), bottom = Math.max(...graph.nodes.map(node => node.position.y + nodeHeight(library.find(item => item.type === node.type))), ...edgeExtents.map(edge => edge.bottom + 9));
  const zoom = Math.max(.3, Math.min(1.2, (width - 70) / (right - left), (height - 70) / (bottom - top)));
  return { x: (width - (right - left) * zoom) / 2 - left * zoom, y: (height - (bottom - top) * zoom) / 2 - top * zoom, zoom };
}
export function connectionReason(graph: WorkflowGraph, library: NodeDefinition[], from: NodeEndpoint, to: NodeEndpoint): string | null {
  const source = graph.nodes.find(node => node.id === from.nodeId), target = graph.nodes.find(node => node.id === to.nodeId);
  if (!source || !target) return 'Choose an output and an input from nodes in this scene.';
  if (source.id === target.id) return 'Connect two different nodes.';
  const output = library.find(item => item.type === source.type)?.outputs.find(port => port.id === from.portId);
  const input = library.find(item => item.type === target.type)?.inputs.find(port => port.id === to.portId);
  if (!output || !input) return 'This connection needs a named output and input.';
  if (output.dataType !== input.dataType) return `${output.label} carries ${output.dataType}; ${input.label} needs ${input.dataType}.`;
  if (graph.edges.some(edge => edge.from.nodeId === from.nodeId && edge.from.portId === from.portId && edge.to.nodeId === to.nodeId && edge.to.portId === to.portId)) return 'These sockets are already connected.';
  if (!input.multiple && graph.edges.some(edge => edge.to.nodeId === to.nodeId && edge.to.portId === to.portId)) return `${input.label} accepts one connection. Remove its existing link first.`;
  const visited = new Set<string>(), pending = [target.id];
  while (pending.length) { const id = pending.pop()!; if (id === source.id) return 'This connection would create a loop. Keep the workflow moving forward.'; if (visited.has(id)) continue; visited.add(id); pending.push(...graph.edges.filter(edge => edge.from.nodeId === id).map(edge => edge.to.nodeId)); }
  return null;
}
export function removeGraphNode(graph: WorkflowGraph, id: string): WorkflowGraph { return { nodes: graph.nodes.filter(node => node.id !== id).map(node => node.selectedNodeId === id ? { ...node, selectedNodeId: null } : node), edges: graph.edges.filter(edge => edge.from.nodeId !== id && edge.to.nodeId !== id) }; }
export function connectorStatus(descriptor?: ConnectorDescriptor) {
  return !descriptor ? 'No connector selected' : ({ UNCONFIGURED: 'Not configured', NOT_CHECKED: 'Not checked', AVAILABLE: 'Read-only service available', UNAVAILABLE: 'Unavailable', UNSUPPORTED: 'No executable bridge', PREPARE_ONLY: 'Local preparation available' })[descriptor.status];
}
