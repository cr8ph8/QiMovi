import { PRESERVATION_LIMITS, PRESERVATION_SCOPE, PRESERVATION_JOB_STATUSES, validatePreservationInventoryItem, validatePreservationManifest, validatePreservationRequest, type PreservationCatalog, type PreservationCheckManifest, type PreservationJobSummary } from '../../local/contracts/preservation-integrity.mjs';
import { WorkspaceError } from './api';

export interface PreservationIntegrityApi {
  load(projectId: string, signal?: AbortSignal): Promise<PreservationCatalog>;
  start(projectId: string, hashes: string[], requestId: string, signal?: AbortSignal): Promise<PreservationCheckManifest>;
  get(projectId: string, jobId: string, signal?: AbortSignal): Promise<PreservationCheckManifest>;
  cancel(projectId: string, jobId: string, signal?: AbortSignal): Promise<PreservationCheckManifest>;
  resume(projectId: string, jobId: string, signal?: AbortSignal): Promise<PreservationCheckManifest>;
}
const root = '/api/preservation-integrity';
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const check: (condition: unknown) => asserts condition = condition => { if (!condition) throw new Error('The integrity response did not match this workspace. Refresh the inventory before continuing.'); };
const nonnegative = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const time = (value: unknown) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));

async function read(path: string, signal?: AbortSignal, body?: unknown): Promise<unknown> {
  const response = await fetch(path, { credentials: 'same-origin', redirect: 'error', signal, ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new WorkspaceError(object(raw) && typeof raw.error === 'string' ? raw.error : 'The local file check was not confirmed.', response.status);
  return raw;
}

function jobSummary(raw: unknown, projectId: string): PreservationJobSummary {
  check(object(raw));
  validatePreservationRequest('get', { projectId: raw.projectId, jobId: raw.jobId });
  check(raw.projectId === projectId && typeof raw.requestId === 'string' && PRESERVATION_JOB_STATUSES.includes(raw.status as PreservationJobSummary['status']));
  check(time(raw.createdAt) && time(raw.updatedAt) && (raw.completedAt === null || time(raw.completedAt)) && String(raw.updatedAt) >= String(raw.createdAt));
  check((raw.status === 'COMPLETED') === (raw.completedAt !== null));
  check(raw.evidencePath === `integrations/preservation/checks/${raw.jobId}.json` && object(raw.summary));
  const counts = raw.summary;
  check(['total', 'checked', 'match', 'mismatch', 'missing', 'unreadable', 'changedDuringCheck'].every(key => nonnegative(counts[key])));
  check(Number(counts.total) <= PRESERVATION_LIMITS.jobItems && Number(counts.checked) <= Number(counts.total) && Number(counts.checked) === Number(counts.match) + Number(counts.mismatch) + Number(counts.missing) + Number(counts.unreadable) + Number(counts.changedDuringCheck));
  check(raw.status !== 'COMPLETED' || counts.total === counts.checked);
  return raw as unknown as PreservationJobSummary;
}
function manifest(raw: unknown, projectId: string, jobId?: string) {
  const value = validatePreservationManifest(raw);
  check(value.projectId === projectId && (!jobId || value.jobId === jobId));
  return value;
}
async function change(action: 'cancel' | 'resume', projectId: string, jobId: string, signal?: AbortSignal) {
  validatePreservationRequest(action, { projectId, jobId });
  return manifest(await read(`${root}/${encodeURIComponent(jobId)}/${action}`, signal, { projectId }), projectId, jobId);
}

export const preservationIntegrityApi: PreservationIntegrityApi = {
  async load(projectId, signal) {
    const raw = await read(root, signal);
    check(object(raw) && raw.schemaVersion === 'qimovi-preservation-catalog/v1' && raw.projectId === projectId && raw.scope === PRESERVATION_SCOPE && object(raw.limits));
    check(Object.entries(PRESERVATION_LIMITS).every(([key, value]) => (raw.limits as Record<string, unknown>)[key] === value));
    check(Array.isArray(raw.items) && raw.items.length <= PRESERVATION_LIMITS.inventoryItems && Array.isArray(raw.jobs) && raw.jobs.length <= PRESERVATION_LIMITS.jobs);
    const items = raw.items.map(validatePreservationInventoryItem), jobs = raw.jobs.map(value => jobSummary(value, projectId));
    check(new Set(items.map(item => item.sha256)).size === items.length && new Set(jobs.map(item => item.jobId)).size === jobs.length);
    return { schemaVersion: 'qimovi-preservation-catalog/v1', projectId, scope: PRESERVATION_SCOPE, limits: { ...PRESERVATION_LIMITS }, items, jobs };
  },
  async start(projectId, hashes, requestId, signal) {
    const body = validatePreservationRequest('start', { projectId, requestId, hashes });
    const value = manifest(await read(`${root}/start`, signal, body), projectId);
    check(value.requestId === requestId && value.items.length === hashes.length && value.items.every(item => hashes.includes(item.sha256)));
    return value;
  },
  async get(projectId, jobId, signal) {
    validatePreservationRequest('get', { projectId, jobId });
    return manifest(await read(`${root}/${encodeURIComponent(jobId)}?projectId=${encodeURIComponent(projectId)}`, signal), projectId, jobId);
  },
  cancel: (projectId, jobId, signal) => change('cancel', projectId, jobId, signal),
  resume: (projectId, jobId, signal) => change('resume', projectId, jobId, signal),
};
