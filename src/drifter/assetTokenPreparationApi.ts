import { validateTokenPreparation, validateTokenPreparationIdentity, validateTokenPreparationRequest, tokenPublicMetadata, type TokenPreparation, type TokenPreparationRequest } from '../../local/contracts/asset-token-preparation.mjs';
import { canonicalJson, hashCanonical } from './canonical';
import { WorkspaceError } from './api';
import type { WorkspaceProject, WorkspaceRecord } from './types';

type Scope = Pick<WorkspaceProject, 'id' | 'sourceHash'>;
export type AssetTokenResult = { record: WorkspaceRecord; current: boolean; integrity: 'VERIFIED_LOCALLY' };
export interface AssetTokenPreparationApi {
  prepare(input: TokenPreparationRequest, project: Scope): Promise<AssetTokenResult>;
  verify(projectId: string, recordId: string, project: Scope): Promise<AssetTokenResult>;
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function need(condition: unknown): asserts condition { if (!condition) throw new Error('The NFT preparation response did not match this project and request. No export was confirmed.'); }
async function post(action: string, input: unknown): Promise<unknown> {
  const response = await fetch(`/api/asset-token/${action}`, { method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new WorkspaceError(object(raw) && typeof raw.error === 'string' ? raw.error : 'NFT preparation was not confirmed.', response.status);
  return raw;
}
async function validated(raw: unknown, project: Scope, recordId: string): Promise<AssetTokenResult> {
  need(object(raw) && Object.keys(raw).sort().join(',') === 'current,integrity,record' && typeof raw.current === 'boolean' && raw.integrity === 'VERIFIED_LOCALLY');
  const record = raw.record;
  need(object(record) && ['id', 'kind', 'version', 'sha256', 'data'].every(key => Object.prototype.hasOwnProperty.call(record, key)) && Object.keys(record).every(key => ['id', 'kind', 'version', 'sha256', 'data', 'replayed'].includes(key)));
  need(record.id === recordId && record.kind === 'asset-token-preparation' && record.version === 1 && (record.replayed === undefined || typeof record.replayed === 'boolean'));
  const data = validateTokenPreparation(record.data);
  need(data.projectId === project.id && (data.sourceHash === project.sourceHash || data.sourceHash === null));
  validateTokenPreparationIdentity(recordId, String(record.kind), data, Number(record.version));
  need(record.sha256 === await hashCanonical(data) && data.metadataSha256 === await hashCanonical(data.publicMetadata));
  need(canonicalJson(data.publicMetadata) === canonicalJson(tokenPublicMetadata(data)));
  return raw as AssetTokenResult;
}
export const assetTokenPreparationApi: AssetTokenPreparationApi = {
  async prepare(input, project) {
    const frozen = validateTokenPreparationRequest(JSON.parse(canonicalJson(input)));
    need(frozen.projectId === project.id);
    const value = await validated(await post('prepare', frozen), project, `asset-token:${frozen.requestId}`);
    const data = value.record.data as TokenPreparation;
    need(data.requestId === frozen.requestId && canonicalJson(data.passportRef) === canonicalJson(frozen.passportRef) && canonicalJson(data.participationRef) === canonicalJson(frozen.participationRef) && canonicalJson(data.publicFields) === canonicalJson(frozen.publicFields));
    return value;
  },
  async verify(projectId, recordId, project) {
    need(projectId === project.id && /^asset-token:[a-f0-9-]{36}$/.test(recordId));
    return validated(await post('verify', { projectId, recordId }), project, recordId);
  },
};
