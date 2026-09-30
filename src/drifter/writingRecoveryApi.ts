import { canonicalJson, hashCanonical } from './canonical';
import { validateRecord } from './validation';
import type { CreativeScreenplayDraft, ScreenplayDraft } from './types';

export interface WritingRecovery {
  id: string; version: number; sha256: string; updatedAt: string; state: 'ACTIVE' | 'RESOLVED';
  draftId: string; data: ScreenplayDraft | CreativeScreenplayDraft;
  baseVersion: number | null; baseSha256: string | null; saveRequestId: string | null;
}
export interface WritingRecoveryInput {
  expectedVersion: number | null; requestId: string; draftId: string; data: ScreenplayDraft | CreativeScreenplayDraft;
  baseVersion: number | null; baseSha256: string | null; saveRequestId: string | null;
}
export interface WritingRecoveryApi {
  list(): Promise<WritingRecovery[]>;
  put(id: string, input: WritingRecoveryInput): Promise<WritingRecovery>;
  resolve(id: string, input: { expectedVersion: number; requestId: string }): Promise<WritingRecovery>;
}
export class WritingRecoveryError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const recoveryId = (value: unknown): value is string => typeof value === 'string' && /^writing-recovery:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const version = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function wellFormed(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function check(condition: unknown): asserts condition { if (!condition) throw new Error('The local workspace did not confirm this working copy.'); }
async function request(path: string, options: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, { ...options, credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json', ...options.headers } });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new WritingRecoveryError(typeof value?.error === 'string' ? value.error : 'The local workspace did not confirm this working copy.', response.status);
  return value;
}
async function validate(value: unknown): Promise<WritingRecovery> {
  const fields = ['id', 'version', 'sha256', 'updatedAt', 'state', 'draftId', 'data', 'baseVersion', 'baseSha256', 'saveRequestId'];
  check(object(value) && fields.every(key => Object.prototype.hasOwnProperty.call(value, key)) && Object.keys(value).every(key => fields.includes(key)));
  check(recoveryId(value.id) && version(value.version) && digest(value.sha256));
  check(typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt)) && new Date(value.updatedAt).toISOString() === value.updatedAt);
  check(['ACTIVE', 'RESOLVED'].includes(String(value.state)) && identity(value.draftId) && value.draftId.startsWith('screenplay-draft:') && value.draftId.length > 'screenplay-draft:'.length);
  check((value.baseVersion === null && value.baseSha256 === null) || (version(value.baseVersion) && digest(value.baseSha256)));
  check(value.saveRequestId === null || identity(value.saveRequestId));
  check(object(value.data) && wellFormed(value.data.title) && value.data.title.length <= 200 && !/[\r\n\0]/.test(value.data.title) && wellFormed(value.data.body));
  // The recovery envelope retains its exact text hash; the ordinary writer
  // validator receives a temporary nonblank title solely to check its shape.
  const checkedData = value.data.title.trim() ? value.data : { ...value.data, title: 'Working copy' };
  await validateRecord({ id: value.draftId, kind: 'screenplay-draft', version: 1, sha256: await hashCanonical(checkedData), data: checkedData });
  check(await hashCanonical(value.data) === value.sha256);
  return value as unknown as WritingRecovery;
}

export const writingRecoveryApi: WritingRecoveryApi = {
  async list() {
    const value = await request('/api/writing-recovery');
    check(Array.isArray(value));
    const recoveries = await Promise.all(value.map(validate));
    check(recoveries.every(item => item.state === 'ACTIVE') && new Set(recoveries.map(item => item.id)).size === recoveries.length);
    return recoveries;
  },
  async put(id, input) {
    check(recoveryId(id));
    const snapshot: WritingRecoveryInput = JSON.parse(canonicalJson(input));
    const result = await validate(await request(`/api/writing-recovery/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(snapshot) }));
    check(result.id === id && result.version === (snapshot.expectedVersion ?? 0) + 1 && result.state === 'ACTIVE'
      && result.draftId === snapshot.draftId && canonicalJson(result.data) === canonicalJson(snapshot.data)
      && result.baseVersion === snapshot.baseVersion && result.baseSha256 === snapshot.baseSha256 && result.saveRequestId === snapshot.saveRequestId);
    return result;
  },
  async resolve(id, input) {
    check(recoveryId(id));
    const snapshot = JSON.parse(canonicalJson(input));
    const result = await validate(await request(`/api/writing-recovery/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: JSON.stringify(snapshot) }));
    check(result.id === id && result.version === snapshot.expectedVersion + 1 && result.state === 'RESOLVED');
    return result;
  },
};
