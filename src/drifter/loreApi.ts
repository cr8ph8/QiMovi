import { WorkspaceError, blobUrl } from './api';
import { validateRecord } from './validation';
import { LORE_SOURCE_KINDS, sourceKindFromIntake } from '../../local/contracts/lore.mjs';
import type { LoreLibraryResponse, LorePage, LoreSource, Project, WorkspaceRecord } from './types';

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export type LoreSourceKind = 'PRIMARY_SCREENPLAY' | 'LORE_NOTES' | 'PRODUCTION_REFERENCE' | 'ANALYSIS';
export type ClassifiedLoreLibrary = LoreLibraryResponse & { sourceKinds?: Record<string, LoreSourceKind> };
function check(value: unknown, message = 'The source library response did not match its retained records.'): asserts value {
  if (!value) throw new Error(message);
}
function shape(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  check(object(value) && keys.every(key => Object.prototype.hasOwnProperty.call(value, key)) && Object.keys(value).every(key => keys.includes(key)));
}
async function request(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { credentials: 'same-origin', redirect: 'error', signal });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new WorkspaceError(object(value) && typeof value.error === 'string' ? value.error : 'The local source library could not be read.', response.status);
  return value;
}
async function textHash(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function getLoreLibrary(project: Project, signal?: AbortSignal): Promise<ClassifiedLoreLibrary> {
  const value = await request('/api/lore', signal);
  shape(value, ['schema', 'projectId', 'sourceHash', 'records', ...(object(value) && Object.prototype.hasOwnProperty.call(value, 'sourceKinds') ? ['sourceKinds'] : [])]);
  check(value.schema === 'filmstack-lore-library/v1' && value.projectId === project.id && value.sourceHash === project.sourceHash && Array.isArray(value.records) && value.records.length <= 1000);
  const records = await Promise.all(value.records.map(record => validateRecord(record, project)));
  check(records.every(record => record.kind === 'lore-source') && new Set(records.map(record => record.id)).size === records.length);
  const sourceKinds: Record<string, LoreSourceKind> = {};
  if (value.sourceKinds !== undefined) {
    check(object(value.sourceKinds));
    const manifests = new Map<string, Promise<unknown>>();
    await Promise.all(Object.entries(value.sourceKinds).map(async ([id, kind]) => {
      const record = records.find(record => record.id === id);
      check(record && LORE_SOURCE_KINDS.includes(kind));
      const source = record.data as LoreSource;
      let manifest = manifests.get(source.intakeManifest.sha256);
      if (!manifest) {
        manifest = (async () => {
          const response = await fetch(blobUrl(source.intakeManifest.sha256), { credentials: 'same-origin', redirect: 'error', signal });
          check(response.ok);
          const bytes = await response.arrayBuffer();
          check(bytes.byteLength === source.intakeManifest.bytes && bytes.byteLength <= 5 * 1024 ** 2);
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          check(await textHash(text) === source.intakeManifest.sha256, 'The source-category intake failed its retained checksum.');
          return JSON.parse(text) as unknown;
        })();
        manifests.set(source.intakeManifest.sha256, manifest);
      }
      check(sourceKindFromIntake(await manifest, source) === kind, 'The source category differs from its retained intake.');
      sourceKinds[id] = kind as LoreSourceKind;
    }));
  }
  return { schema: 'filmstack-lore-library/v1', projectId: project.id, sourceHash: project.sourceHash, records, sourceKinds };
}

export async function getLorePages(record: WorkspaceRecord, signal?: AbortSignal): Promise<LorePage[]> {
  check(record.kind === 'lore-source');
  const source = record.data as LoreSource;
  if (!source.extraction) return [];
  const response = await fetch(`/api/lore/${encodeURIComponent(record.id)}/pages`, { credentials: 'same-origin', redirect: 'error', signal });
  if (!response.ok) throw new WorkspaceError('The retained source pages could not be read.', response.status);
  const bytes = await response.arrayBuffer();
  check(bytes.byteLength === source.extraction.bytes && bytes.byteLength <= 32000000);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  check(hash === source.extraction.sha256, 'The extracted document failed its retained checksum. Restore or reimport the source before using it.');
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const index = source.extraction.pages;
  check(Array.isArray(value) && value.length === index.length);
  await Promise.all(value.map(async (page, position) => {
    shape(page, ['pageNumber', 'text', 'textSha256', 'characters', 'textPath', 'pageWidthPoints', 'pageHeightPoints']);
    const expected = index[position];
    check(page.pageNumber === expected.pageNumber && page.textSha256 === expected.textSha256 && typeof page.text === 'string' && page.text.length <= 500000);
    check(await textHash(page.text) === expected.textSha256, 'Extracted page text failed its retained checksum. Reimport or restore the source before using it.');
  }));
  return value as LorePage[];
}

export function loreOriginalUrl(record: WorkspaceRecord): string {
  if (record.kind !== 'lore-source') throw new Error('Select a retained library source.');
  return `/api/lore/${encodeURIComponent(record.id)}/original`;
}
