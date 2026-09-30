import { NODE_LIBRARY, validateNodeGraph, validateNodeWorkflow } from '../../local/contracts/node-workflow.mjs';
import { WorkspaceError } from './api';
import { canonicalJson, hashCanonical } from './canonical';
import type { Project, Scene } from './types';
import type { ConnectorDescriptor, NodeNextAction, NodeValidation, NodeWorkflowCatalog, NodeWorkflowData, NodeWorkflowRecord, WorkflowGraph } from './nodeWorkflowModel';

function check(condition: unknown): asserts condition { if (!condition) throw new Error('The local node workflow did not match this scene or saved version. Refresh before continuing.'); }
async function json(path: string, options: RequestInit = {}) { const response = await fetch(path, { ...options, credentials: 'same-origin', redirect: 'error' }); const value = await response.json().catch(() => null); if (!response.ok) throw new WorkspaceError(typeof value?.error === 'string' ? value.error : 'The local workspace did not confirm this node request.', response.status); return value; }
function graphShape(graph: WorkflowGraph) { validateNodeGraph(graph); }
function workPlanShape(value: NodeValidation, project: Project, scene: Scene, graph: WorkflowGraph) {
  check(value.sourceHash === project.sourceHash && value.sceneId === scene.id);
  const nodeIds = new Set(graph.nodes.map(node => node.id));
  const actionShape = (action: NodeNextAction) => check(action && nodeIds.has(action.nodeId) && [null, 'writing', 'casting', 'scene', 'dcc', 'generation', 'takes', 'context', 'lore'].includes(action.tool) && typeof action.label === 'string' && action.label.length > 0 && typeof action.reason === 'string');
  const summaryKeys = { READY_TO_REVIEW: 'readyForReview', NEEDS_INPUT: 'needsInput', WAITING_ON_UPSTREAM: 'waitingOnUpstream', PREPARATION_ONLY: 'preparationOnly', CONNECTOR_UNAVAILABLE: 'connectorUnavailable' } as const;
  const seen = new Set<string>();
  for (const step of value.plan) {
    check(step && nodeIds.has(step.nodeId) && !seen.has(step.nodeId) && typeof step.label === 'string' && typeof step.operation === 'string' && typeof step.status === 'string' && Object.prototype.hasOwnProperty.call(summaryKeys, step.readiness) && ['RETAINED_INPUTS', 'PLANNED_ONLY'].includes(step.evidence));
    check(Array.isArray(step.dependsOn) && Array.isArray(step.blockedBy) && [...step.dependsOn, ...step.blockedBy].every(id => seen.has(id)));
    check(Array.isArray(step.inputRefs) && step.inputRefs.every(ref => ref && typeof ref.id === 'string' && /^[a-f0-9]{64}$/.test(ref.sha256)));
    actionShape(step.nextAction); check(step.nextAction.nodeId === step.nodeId); seen.add(step.nodeId);
  }
  // Invalid graph shape can return only diagnostics. A usable plan accounts for
  // every node exactly once, and its counts/next action must match those steps.
  check(seen.size === nodeIds.size || !value.valid && seen.size === 0 && value.issues.length > 0);
  check(value.summary?.totalSteps === value.plan.length);
  for (const [readiness, key] of Object.entries(summaryKeys)) check(value.summary[key] === value.plan.filter(step => step.readiness === readiness).length);
  if (value.nextAction !== null) {
    actionShape(value.nextAction);
    check(value.plan.some(step => canonicalJson(step.nextAction) === canonicalJson(value.nextAction)));
  }
  check(value.plan.length === 0 ? value.nextAction === null : value.nextAction !== null);
}
function connectorShape(value: ConnectorDescriptor) {
  check(value && ['UNCONFIGURED', 'NOT_CHECKED', 'AVAILABLE', 'UNAVAILABLE', 'UNSUPPORTED', 'PREPARE_ONLY'].includes(value.status) && value.executionAuthorized === false && typeof value.id === 'string' && typeof value.label === 'string' && typeof value.description === 'string' && typeof value.reason === 'string' && (value.checkedAt === null || typeof value.checkedAt === 'string' && Number.isFinite(Date.parse(value.checkedAt))) && Array.isArray(value.capabilities));
  check(value.capabilities.every(item => typeof item.id === 'string' && typeof item.label === 'string' && ['GET', 'POST'].includes(item.method) && typeof item.path === 'string' && item.path.startsWith('/') && !item.path.startsWith('//') && ['READ_ONLY', 'PREPARE_ONLY'].includes(item.effect)));
}
export async function validateNodeRecord(value: NodeWorkflowRecord, project: Project, scene: Scene) { check(value?.kind === 'node-workflow' && value.id === `node-workflow:${scene.id}` && Number.isSafeInteger(value.version) && value.version > 0 && value.data?.schemaVersion === 1 && value.data.sourceHash === project.sourceHash && value.data.sceneId === scene.id && value.data.status === 'DRAFT' && typeof value.data.title === 'string'); validateNodeWorkflow(value.data, project); check(await hashCanonical(value.data) === value.sha256); return value; }
export interface NodeWorkflowApi {
  load(project: Project, scene: Scene, signal?: AbortSignal): Promise<NodeWorkflowCatalog>;
  save(project: Project, scene: Scene, data: NodeWorkflowData, expectedVersion: number | null, requestId: string): Promise<NodeWorkflowRecord>;
  validate(project: Project, scene: Scene, graph: WorkflowGraph): Promise<NodeValidation>;
  checkConnector(id: string): Promise<ConnectorDescriptor>;
}
export const nodeWorkflowApi: NodeWorkflowApi = {
  async load(project, scene, signal) {
    const value = await json(`/api/node-workflow?sceneId=${encodeURIComponent(scene.id)}`, { signal });
    check(value?.schemaVersion === 'filmstack-node-workflow/v1' && value.sourceHash === project.sourceHash && value.sceneId === scene.id && Array.isArray(value.library) && Array.isArray(value.connectors) && Array.isArray(value.bindings)); graphShape(value.graph);
    check(canonicalJson(value.library) === canonicalJson(NODE_LIBRARY));
    value.connectors.forEach(connectorShape);
    check(value.bindings.every(binding => typeof binding.id === 'string' && /^[a-f0-9]{64}$/.test(binding.sha256) && typeof binding.kind === 'string' && typeof binding.label === 'string' && ['CURRENT', 'STALE'].includes(binding.status) && binding.sceneId === scene.id && typeof binding.summary === 'string'));
    check(value.library.every(item => typeof item.type === 'string' && typeof item.label === 'string' && typeof item.description === 'string' && Array.isArray(item.inputs) && Array.isArray(item.outputs) && Array.isArray(item.bindingKinds) && Array.isArray(item.connectorIds) && [...item.inputs, ...item.outputs].every(port => typeof port.id === 'string' && typeof port.label === 'string' && typeof port.dataType === 'string')));
    if (value.record !== null) { await validateNodeRecord(value.record, project, scene); check(canonicalJson(value.record.data.graph) === canonicalJson(value.graph)); }
    return value;
  },
  async save(project, scene, data, expectedVersion, requestId) {
    check(data.sourceHash === project.sourceHash && data.sceneId === scene.id);
    validateNodeWorkflow(data, project);
    const captured = JSON.parse(canonicalJson(data));
    const value = await json(`/api/records/${encodeURIComponent(`node-workflow:${scene.id}`)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: canonicalJson({ kind: 'node-workflow', expectedVersion, requestId, data: captured }) });
    await validateNodeRecord(value, project, scene); check(value.version === (expectedVersion ?? 0) + 1 && canonicalJson(value.data) === canonicalJson(captured)); return value;
  },
  async validate(project, scene, graph) {
    const captured = JSON.parse(canonicalJson(graph)), value = await json('/api/node-workflow/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: canonicalJson({ sourceHash: project.sourceHash, sceneId: scene.id, graph: captured }) });
    check(value?.schemaVersion === 'filmstack-node-validation/v1' && value.scope === 'PLANNING_ONLY' && value.executionAuthorized === false && typeof value.valid === 'boolean' && Array.isArray(value.issues) && Array.isArray(value.plan) && value.graphHash === await hashCanonical(captured));
    workPlanShape(value, project, scene, captured); return value;
  },
  async checkConnector(id) { const value = await json('/api/node-workflow/connectors/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: canonicalJson({ connectorId: id }) }); check(value?.id === id); connectorShape(value); return value; },
};
