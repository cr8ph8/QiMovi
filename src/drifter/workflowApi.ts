import { BIBLE_AUTHORING_INPUT_KINDS, BIBLE_AUTHORING_INPUT_LIMIT } from '../../local/contracts/authoring.mjs';
import { canonicalJson, hashCanonical } from './canonical';
import { validateRecord } from './validation';
import type { AuthoringInputRef, Project, WorkspaceRecord } from './types';

export type WorkflowStatus = 'CURRENT' | 'STALE' | 'ABSENT';
export type WorkflowStage = 'writing' | 'film' | 'cameras' | 'generation';
export interface WorkflowContext {
  schema: 'filmstack-unified-workflow/v1';
  sourceBasis: { projectId: string; sourceHash: string; sceneId: string; sceneHash: string; shotIds: string[] };
  selection: { authoringRef: AuthoringInputRef | null; handoffRef: AuthoringInputRef | null };
  status: 'CURRENT' | 'STALE' | 'ABSENT';
  readiness: 'READY_FOR_PLANNING' | 'HANDOFF_REQUIRED' | 'NEEDS_REVIEW' | 'MISSING_INPUTS';
  authoring: { status: WorkflowStatus; record: WorkspaceRecord | null; head: { id: string; kind: string; version: number; sha256: string; title: string } | null };
  lineage: { status: WorkflowStatus; nodes: { ref: AuthoringInputRef; status: WorkflowStatus; record: WorkspaceRecord | null; head: unknown; reason: string }[]; edges: { from: AuthoringInputRef; to: AuthoringInputRef }[]; reasons: string[] };
  handoff: { status: WorkflowStatus; record: WorkspaceRecord | null; head: unknown };
  linkedHandoffs: { record: WorkspaceRecord; status: WorkflowStatus; authoringStatus: WorkflowStatus; reason: string }[];
  authority: 'PLANNING_CONTEXT_ONLY'; productionAuthorized: false; sourceReplacement: false;
}
export interface FlowContextProps {
  project: Project; sceneId: string; handoff?: WorkspaceRecord; records: WorkspaceRecord[];
  context?: WorkflowContext | null; loading?: boolean; error?: string;
  onNavigate(stage: WorkflowStage): void; onManage(): void;
}
export type WorkflowSelection = { authoringRef?: AuthoringInputRef; handoffRef?: AuthoringInputRef };
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const identity = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const exact = (value: unknown, fields: string[]): value is Record<string, unknown> => object(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(',');
const ref = (value: unknown): value is AuthoringInputRef => exact(value, ['id', 'sha256']) && identity(value.id) && digest(value.sha256);
const invalid = () => new Error('The workflow context does not match this source, scene or selected revision. Refresh saved records.');
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const refKey = (value: AuthoringInputRef) => value.id + ':' + value.sha256;
const statuses = ['CURRENT', 'STALE', 'ABSENT'];
const authoringKinds = ['screenplay-draft', 'story-plan-draft', 'concept-draft', 'writing-note', 'pitch-draft'];
const failureReasons = ['AUTHORING_REVISION_ABSENT', 'AUTHORING_SOURCE_OR_KIND_MISMATCH', 'AUTHORING_LINEAGE_BYTES_LIMIT', 'AUTHORING_INPUT_REF_INVALID', 'AUTHORING_LORE_REFERENCE_INVALID', 'AUTHORING_BIBLE_REFERENCE_INVALID', 'AUTHORING_BIBLE_REFERENCE_LIMIT'];
type WorkflowHead = NonNullable<WorkflowContext['authoring']['head']>;
function validHead(value: unknown): value is WorkflowHead {
  return exact(value, ['id', 'kind', 'version', 'sha256', 'title']) && identity(value.id) && identity(value.kind) && Number.isSafeInteger(value.version) && Number(value.version) > 0 && digest(value.sha256) && typeof value.title === 'string' && value.title.length <= 200;
}
function revisionStatus(record: WorkspaceRecord | null, head: unknown): WorkflowStatus {
  if (head !== null && !validHead(head)) throw invalid();
  if (!record) return 'ABSENT';
  if (!head || !validHead(head) || head.id !== record.id || head.kind !== record.kind || head.version < record.version || (head.version === record.version && head.sha256 !== record.sha256)) throw invalid();
  if (head.sha256 === record.sha256 && head.title !== String((record.data as { title?: string }).title ?? record.id)) throw invalid();
  return head.sha256 === record.sha256 ? 'CURRENT' : 'STALE';
}

export async function verifyWorkflowContext(raw: unknown, project: Project, sceneId: string, selection: WorkflowSelection = {}): Promise<WorkflowContext> {
  const value = raw as WorkflowContext, scene = project.scenes.find(item => item.id === sceneId);
  if (!scene || !exact(value, ['schema', 'sourceBasis', 'selection', 'status', 'readiness', 'authoring', 'lineage', 'handoff', 'linkedHandoffs', 'authority', 'productionAuthorized', 'sourceReplacement']) || value.schema !== 'filmstack-unified-workflow/v1' || !exact(value.sourceBasis, ['projectId', 'sourceHash', 'sceneId', 'sceneHash', 'shotIds']) || value.sourceBasis.projectId !== project.id || value.sourceBasis.sourceHash !== project.sourceHash || value.sourceBasis.sceneId !== sceneId || !digest(value.sourceBasis.sceneHash) || !same(value.sourceBasis.shotIds, scene.shots.map(shot => shot.id)) || !statuses.includes(value.status) || !['READY_FOR_PLANNING', 'HANDOFF_REQUIRED', 'NEEDS_REVIEW', 'MISSING_INPUTS'].includes(value.readiness) || value.authority !== 'PLANNING_CONTEXT_ONLY' || value.productionAuthorized !== false || value.sourceReplacement !== false || !exact(value.selection, ['authoringRef', 'handoffRef']) || !exact(value.authoring, ['status', 'record', 'head']) || !exact(value.handoff, ['status', 'record', 'head']) || !exact(value.lineage, ['status', 'nodes', 'edges', 'reasons']) || !Array.isArray(value.lineage.nodes) || value.lineage.nodes.length > 100 || !Array.isArray(value.lineage.edges) || value.lineage.edges.length > 10000 || !Array.isArray(value.lineage.reasons) || !value.lineage.reasons.every(reason => typeof reason === 'string') || !Array.isArray(value.linkedHandoffs) || value.linkedHandoffs.length > 1) throw invalid();
  if (value.sourceBasis.sceneHash !== await hashCanonical(scene) || ![value.authoring.status, value.handoff.status, value.lineage.status, ...value.lineage.nodes.map(node => node.status), ...value.linkedHandoffs.flatMap(item => [item.status, item.authoringStatus])].every(status => statuses.includes(status)) || !value.lineage.edges.every(edge => exact(edge, ['from', 'to']) && ref(edge.from) && ref(edge.to))) throw invalid();
  if (selection.authoringRef && canonicalJson(value.selection.authoringRef) !== canonicalJson(selection.authoringRef)) throw invalid();
  if (selection.handoffRef && canonicalJson(value.selection.handoffRef) !== canonicalJson(selection.handoffRef)) throw invalid();
  for (const selected of [value.selection.authoringRef, value.selection.handoffRef]) if (selected !== null && !ref(selected)) throw invalid();
  if (value.selection.handoffRef && value.selection.handoffRef.id !== 'production-handoff:' + sceneId) throw invalid();
  const candidateRows = [value.authoring.record, value.handoff.record, ...value.lineage.nodes.map(node => node.record), ...value.linkedHandoffs.map(item => item.record)];
  if (candidateRows.some(row => row !== null && !object(row))) throw invalid();
  const rows = candidateRows.filter((row): row is WorkspaceRecord => row !== null);
  for (const row of rows) {
    await validateRecord(row, project);
    const data = row.data as { sourceHash?: string | null; projectId?: string };
    const retainedBible = BIBLE_AUTHORING_INPUT_KINDS.includes(row.kind) && data.sourceHash === null && data.projectId === project.id && project.creativeOrigin?.id === project.id;
    if (row.replayed === true || data.sourceHash !== project.sourceHash && !retainedBible) throw invalid();
  }
  for (const [record, selected] of [[value.authoring.record, value.selection.authoringRef], [value.handoff.record, value.selection.handoffRef]] as const) if (record && (!selected || selected.id !== record.id || selected.sha256 !== record.sha256)) throw invalid();
  const nodeMap = new Map<string, WorkflowContext['lineage']['nodes'][number]>(), expectedEdges: WorkflowContext['lineage']['edges'] = [];
  let bodyBytes = 0;
  for (const node of value.lineage.nodes) {
    if (!exact(node, ['ref', 'status', 'record', 'head', 'reason']) || !ref(node.ref) || typeof node.reason !== 'string' || nodeMap.has(refKey(node.ref)) || (node.record && (node.record.id !== node.ref.id || node.record.sha256 !== node.ref.sha256 || !authoringKinds.includes(node.record.kind) && !BIBLE_AUTHORING_INPUT_KINDS.includes(node.record.kind))) || node.status !== revisionStatus(node.record, node.head)) throw invalid();
    nodeMap.set(refKey(node.ref), node);
    if (node.record) {
      const data = node.record.data as { inputRefs?: AuthoringInputRef[] };
      bodyBytes += new TextEncoder().encode(JSON.stringify(data)).length;
      if (node.reason !== (node.status === 'STALE' ? 'AUTHORING_HEAD_CHANGED' : '')) throw invalid();
      if (node.record.kind === 'writing-note' && (data.inputRefs ?? []).filter(input => BIBLE_AUTHORING_INPUT_KINDS.some(kind => input.id.startsWith(kind + ':'))).length > BIBLE_AUTHORING_INPUT_LIMIT) throw invalid();
      if (BIBLE_AUTHORING_INPUT_KINDS.includes(node.record.kind) && (data.inputRefs ?? []).length) throw invalid();
      for (const target of data.inputRefs ?? []) expectedEdges.push({ from: node.ref, to: target });
    } else if (!failureReasons.includes(node.reason)) throw invalid();
  }
  if (bodyBytes > 2 * 1024 * 1024 || !same(value.lineage.edges.map(edge => canonicalJson(edge)).sort(), expectedEdges.map(edge => canonicalJson(edge)).sort())) throw invalid();
  for (const node of value.lineage.nodes) {
    if (!node.record || !BIBLE_AUTHORING_INPUT_KINDS.includes(node.record.kind)) continue;
    const parents = value.lineage.edges.filter(edge => refKey(edge.to) === refKey(node.ref));
    if (!parents.length || parents.some(edge => nodeMap.get(refKey(edge.from))?.record?.kind !== 'writing-note')) throw invalid();
  }
  const root = value.lineage.nodes[0] ?? null;
  if (root?.record && !authoringKinds.includes(root.record.kind)) throw invalid();
  if (value.selection.authoringRef ? !root || !same(root.ref, value.selection.authoringRef) || !same(value.authoring, { status: root.status, record: root.record, head: root.head }) : root !== null || value.authoring.record !== null || value.authoring.head !== null || value.authoring.status !== 'ABSENT') throw invalid();
  const reasonSet = new Set(value.lineage.reasons), derivedReasons = new Set(value.lineage.nodes.map(node => node.reason).filter(Boolean));
  if (reasonSet.size !== value.lineage.reasons.length || [...derivedReasons].some(reason => !reasonSet.has(reason)) || [...reasonSet].some(reason => !derivedReasons.has(reason) && !['AUTHORING_LINEAGE_LIMIT', 'AUTHORING_LINEAGE_CYCLE'].includes(reason))) throw invalid();
  const visited = new Set<string>(), active = new Set<string>(); let cycle = false, limited = false;
  function visit(current: AuthoringInputRef, depth: number) {
    const key = refKey(current);
    if (active.has(key)) { cycle = true; return; }
    if (visited.has(key)) return;
    if (visited.size >= 100 || depth > 24) { limited = true; return; }
    const node = nodeMap.get(key);
    if (!node) throw invalid();
    visited.add(key); active.add(key);
    for (const edge of value.lineage.edges.filter(edge => refKey(edge.from) === key)) visit(edge.to, depth + 1);
    active.delete(key);
  }
  if (value.selection.authoringRef) visit(value.selection.authoringRef, 0);
  if (visited.size !== nodeMap.size || cycle !== reasonSet.has('AUTHORING_LINEAGE_CYCLE') || limited !== reasonSet.has('AUTHORING_LINEAGE_LIMIT')) throw invalid();
  const expectedLineageStatus = !value.selection.authoringRef || value.lineage.nodes.some(node => node.status === 'ABSENT') || cycle || limited ? 'ABSENT' : value.lineage.nodes.some(node => node.status === 'STALE') ? 'STALE' : 'CURRENT';
  if (value.lineage.status !== expectedLineageStatus) throw invalid();
  if (value.handoff.status !== revisionStatus(value.handoff.record, value.handoff.head)) throw invalid();
  if (value.handoff.head && ((value.handoff.head as WorkflowHead).kind !== 'production-handoff' || (value.handoff.head as WorkflowHead).id !== 'production-handoff:' + sceneId)) throw invalid();
  if (value.handoff.record && (value.handoff.record.kind !== 'production-handoff' || (value.handoff.record.data as { sceneId: string }).sceneId !== sceneId || !same((value.handoff.record.data as {authoringRef: AuthoringInputRef}).authoringRef, value.selection.authoringRef))) throw invalid();
  for (const link of value.linkedHandoffs) {
    if (!exact(link, ['record', 'status', 'authoringStatus', 'reason']) || link.record.kind !== 'production-handoff' || link.record.id !== 'production-handoff:' + sceneId || typeof link.reason !== 'string' || link.status !== link.authoringStatus || (link.status === 'CURRENT' && link.reason !== '') || !value.handoff.head || revisionStatus(link.record, value.handoff.head) !== 'CURRENT') throw invalid();
    const selected = (link.record.data as { authoringRef: AuthoringInputRef }).authoringRef;
    if (value.selection.authoringRef && (selected.id !== value.selection.authoringRef.id || (same(selected, value.selection.authoringRef) && link.authoringStatus !== value.lineage.status))) throw invalid();
  }
  const expectedStatus = value.lineage.status === 'ABSENT' || (value.selection.handoffRef && !value.handoff.record) ? 'ABSENT' : value.lineage.status === 'STALE' || value.handoff.status === 'STALE' ? 'STALE' : 'CURRENT';
  const expectedReadiness = expectedStatus === 'ABSENT' ? 'MISSING_INPUTS' : expectedStatus === 'STALE' ? 'NEEDS_REVIEW' : value.handoff.status === 'CURRENT' ? 'READY_FOR_PLANNING' : 'HANDOFF_REQUIRED';
  if (value.status !== expectedStatus || value.readiness !== expectedReadiness) throw invalid();
  return value;
}

export async function getWorkflowContext(project: Project, sceneId: string, selection: WorkflowSelection = {}, signal?: AbortSignal): Promise<WorkflowContext> {
  if (selection.authoringRef && selection.handoffRef) throw invalid();
  const query = new URLSearchParams({ sceneId });
  if (selection.authoringRef) { query.set('authoringId', selection.authoringRef.id); query.set('authoringSha256', selection.authoringRef.sha256); }
  if (selection.handoffRef) { query.set('handoffId', selection.handoffRef.id); query.set('handoffSha256', selection.handoffRef.sha256); }
  const response = await fetch(`/api/workflow/context?${query}`, { credentials: 'same-origin', redirect: 'error', signal });
  const text = await response.text();
  if (new TextEncoder().encode(text).length > 4 * 1024 * 1024) throw new Error('The workflow context exceeds the local preview limit.');
  const value = JSON.parse(text);
  if (!response.ok) throw new Error(typeof value?.error === 'string' ? value.error : 'The local workflow could not be checked.');
  return verifyWorkflowContext(value, project, sceneId, selection);
}
