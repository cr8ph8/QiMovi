import { validateRecord } from './validation';
import { studioReferenceDetails } from '../../local/contracts/studio-reference.mjs';
import { canonicalJson } from './canonical';
import type { StudioReference, WorkspaceRecord } from './types';

export type StudioReferenceRecord = WorkspaceRecord & { kind: 'studio-reference'; data: StudioReference };
export type ReferenceScope = { projectId: string; sourceHash: string | null };
export type ReferencePrepare = { jobId: string; operationRef: StudioReference['operationRef']; workspaceId: string; referenceUseConfirmed: true };
export type ReferenceWorkspace = { id: string; name: string | null; is_selected: boolean; plan_type?: string | null };
export type ReferenceElementChoice = { id: string; name: string; category: string };
export type ReferenceElement = ReferenceElementChoice & { status: string; medias: { id: string; type: string; url: string }[]; video_medias: { id: string; type: string; url: string }[] };
export type ReferenceDetails = { title: string; workspaceId: string; workspaceName: string | null; connectionId: string; params: Record<string, unknown>; uploads: Record<string, unknown>[]; element: ReferenceElement | null; providerElementId?: string; error: string | null; costStatus: 'NOT_PROVIDED_BY_TOOL'; evidenceHashes: string[] };
export interface StudioReferenceApi {
  list(scope: ReferenceScope, signal?: AbortSignal): Promise<StudioReferenceRecord[]>;
  workspaces(scope: ReferenceScope, signal?: AbortSignal): Promise<ReferenceWorkspace[]>;
  prepare(scope: ReferenceScope, input: ReferencePrepare): Promise<StudioReferenceRecord>;
  create(scope: ReferenceScope, record: StudioReferenceRecord): Promise<StudioReferenceRecord>;
  refresh(scope: ReferenceScope, record: StudioReferenceRecord): Promise<StudioReferenceRecord>;
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value: unknown, max = 500): value is string => typeof value === 'string' && value.length <= max && !value.includes('\0');
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function need(value: unknown): asserts value { if (!value) throw Error('The reference response did not match this saved task. Refresh local status before continuing.'); }
export function referenceMessage(code: string) {
  const messages: Record<string, string> = {
    HIGGSFIELD_MCP_SIGN_IN_REQUIRED: 'Connect Higgsfield and discover its tools before preparing a reference.',
    HIGGSFIELD_WORKSPACE_CHANGED: 'The Higgsfield workspace changed. Review it before preparing again.',
    HIGGSFIELD_CONNECTION_CHANGED: 'The Higgsfield sign-in changed. Review the current connection.',
    SOURCE_ADMISSION_REQUIRED: 'Review and admit the linked screenplay before creating production references.',
    STUDIO_REFERENCE_CASTING_CHANGED: 'The linked casting candidate changed. Review and select its latest saved revision before preparing this reference.',
    STUDIO_REFERENCE_WRITING_CHANGED: 'The linked writing changed. Review the latest saved writing before preparing this reference.',
    STUDIO_REFERENCE_OPERATION_CHANGED: 'The saved reference task changed. Prepare its current version.',
    STUDIO_REFERENCE_CONTEXT_CHANGED: 'The linked source, scene or image changed. Review the task before preparing again.',
    STUDIO_REFERENCE_RESTART_DURING_CREATION: 'The app restarted during creation. The provider may already have the reference; this attempt will not be created again.',
    STUDIO_REFERENCE_PREPARATION_INTERRUPTED: 'Preparation was interrupted. Review the retained attempt before starting another.',
  };
  return messages[code] ?? 'Higgsfield did not confirm this reference step. Review the saved attempt and refresh local status before continuing.';
}
export function referenceDetails(record: StudioReferenceRecord): ReferenceDetails {
  const value: unknown = studioReferenceDetails(record.data.detailsJson);
  need(object(value) && text(value.title, 2000) && uuid(value.workspaceId) && (value.workspaceName === null || text(value.workspaceName)) && text(value.connectionId, 500));
  need(object(value.params) && value.params.action === 'create' && (value.params.name === undefined || text(value.params.name, 32)) && (value.params.category === undefined || ['auto', 'character', 'environment', 'prop'].includes(String(value.params.category))));
  need(value.params.medias === undefined || Array.isArray(value.params.medias) && value.params.medias.length <= 100 && value.params.medias.every(row => object(row) && uuid(row.id) && ['media_input', 'image_job'].includes(String(row.type)) && text(row.url, 16384)));
  need(Array.isArray(value.uploads) && value.uploads.length <= 100 && value.uploads.every(object));
  need(value.costStatus === 'NOT_PROVIDED_BY_TOOL' && (value.error === null || text(value.error, 2000)) && Array.isArray(value.evidenceHashes) && value.evidenceHashes.length <= 10000 && value.evidenceHashes.every(sha));
  need(value.providerElementId === undefined || uuid(value.providerElementId));
  if (value.element !== null) {
    const item = value.element;
    need(object(item) && uuid(item.id) && text(item.name) && Boolean(item.name.trim()) && text(item.category, 200) && Boolean(item.category) && text(item.status, 100) && Boolean(item.status));
    need(value.providerElementId === undefined || item.id === value.providerElementId);
    for (const media of [item.medias, item.video_medias]) need(Array.isArray(media) && media.length <= 100 && media.every(row => object(row) && uuid(row.id) && text(row.type, 200) && text(row.url, 16384)));
  }
  return value as unknown as ReferenceDetails;
}
function scopeMatches(value: unknown, scope: ReferenceScope) { need(object(value) && value.projectId === scope.projectId && value.sourceHash === scope.sourceHash); }
async function validated(value: unknown, scope: ReferenceScope): Promise<StudioReferenceRecord> {
  const record = await validateRecord(value); need(record.kind === 'studio-reference'); scopeMatches(record.data, scope);
  const result = record as StudioReferenceRecord; referenceDetails(result); return result;
}
async function request(route: string, input?: object, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/studio/references${route}`, { credentials: 'same-origin', redirect: 'error', signal, ...(input ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {}) });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw Error(object(value) && typeof value.error === 'string' ? referenceMessage(value.error) : 'The app did not confirm this request. Refresh local status before continuing.');
  return value;
}
async function update(route: '/create' | '/refresh', scope: ReferenceScope, record: StudioReferenceRecord) {
  const captured = structuredClone(record), expected = { ...scope };
  const result = await validated(await request(route, { jobId: captured.id, ...(route === '/create' ? { expectedVersion: captured.version, creationAuthorized: true } : {}) }), expected);
  need(result.id === captured.id && canonicalJson(result.data.operationRef) === canonicalJson(captured.data.operationRef) && result.version >= captured.version);
  if (result.version === captured.version) need(result.sha256 === captured.sha256);
  const before = referenceDetails(captured), after = referenceDetails(result), previousId = before.element?.id ?? before.providerElementId; need(after.workspaceId === before.workspaceId && (!previousId || (after.element?.id ?? after.providerElementId) === previousId));
  return result;
}
export const studioReferenceApi: StudioReferenceApi = {
  async list(scope, signal) {
    const expected = { ...scope }, value = await request('', undefined, signal); scopeMatches(value, expected);
    need(object(value) && Array.isArray(value.records) && value.records.length <= 10000);
    const rows = await Promise.all(value.records.map(row => validated(row, expected))); need(new Set(rows.map(row => row.id)).size === rows.length); return rows;
  },
  async workspaces(scope, signal) {
    const expected = { ...scope }, value = await request('/workspaces', undefined, signal); scopeMatches(value, expected);
    need(object(value) && Array.isArray(value.workspaces) && value.workspaces.length <= 1000 && value.workspaces.every(row => object(row) && uuid(row.id) && (row.name === null || text(row.name)) && typeof row.is_selected === 'boolean' && (row.plan_type === undefined || row.plan_type === null || text(row.plan_type, 200))));
    need(new Set(value.workspaces.map(row => row.id)).size === value.workspaces.length); return value.workspaces as ReferenceWorkspace[];
  },
  async prepare(scope, input) {
    const captured = structuredClone(input), expected = { ...scope }, record = await validated(await request('/prepare', captured), expected);
    need(record.id === captured.jobId && canonicalJson(record.data.operationRef) === canonicalJson(captured.operationRef) && referenceDetails(record).workspaceId === captured.workspaceId); return record;
  },
  create: (scope, record) => update('/create', scope, record),
  refresh: (scope, record) => update('/refresh', scope, record),
};
