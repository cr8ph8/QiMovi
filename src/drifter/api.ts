import { canonicalJson } from './canonical';
import { validateBootstrap, validateWorkspaceBootstrap, validateRecord } from './validation';
import type { WorkspaceApi, WorkspaceProject } from './types';
import { writingRecoveryApi } from './writingRecoveryApi';

export class WorkspaceError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof data?.error === 'string' ? data.error : typeof data?.message === 'string' ? data.message : 'The local workspace did not confirm this request.';
    throw new WorkspaceError(detail, response.status);
  }
  return data as T;
}

export const workspaceApi: WorkspaceApi = {
  draftRecovery: writingRecoveryApi,
  bootstrap: async () => validateBootstrap(await request('/api/bootstrap')),
  openWorkspace: async () => validateWorkspaceBootstrap(await request('/api/bootstrap')),
  history: (id, project) => getRecordHistory(id, project),
  login: async token => { await request('/api/session', { method: 'POST', body: JSON.stringify({ token }) }); },
  saveRecord: async (input, project) => {
    // Freeze the complete attempt before hashing or awaiting the transport.
    const { id, ...body } = JSON.parse(canonicalJson(input));
    const expectedData = canonicalJson(body.data);
    const record = await validateRecord(await request(`/api/records/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }), project);
    if (record.id !== id || record.kind !== body.kind || canonicalJson(record.data) !== expectedData || record.version !== (body.expectedVersion ?? 0) + 1) {
      throw new Error('The local workspace response does not match this save. Save not confirmed; reload before continuing.');
    }
    return record;
  },
};

export async function getRecordHistory(id: string, project?: WorkspaceProject): Promise<import('./types').WorkspaceRecord[]> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(id)) throw new Error('Invalid local record identity.');
  const values = await request<unknown>(`/api/records/${encodeURIComponent(id)}/history`);
  if (!Array.isArray(values) || values.length > 10000) throw new Error('The local workspace returned invalid history.');
  const records = await Promise.all(values.map(value => validateRecord(value, project)));
  if (records.some((record,index) => record.id !== id || record.version !== index + 1 || record.kind !== records[0].kind || record.reviewState !== undefined || record.replayed === true)) {
    throw new Error('The local workspace history does not match this record.');
  }
  return records;
}

export function blobUrl(hash: string): string { return `/api/blobs/${encodeURIComponent(hash)}`; }
