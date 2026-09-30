import { validateAssetCuration } from '../../local/contracts/project-library.mjs';
import { WorkspaceError, workspaceApi } from './api';
import type { Project, WorkspaceProject } from './types';
import { validateRecord } from './validation';
import type { AssetCuration, AssetCurationRecord, AssetExtraction, AssetUsage, ParsedSearchResult, ProjectAssetRecord, ProjectLibraryCatalog } from './projectLibraryModel';
import { validateDccStageReturn, type DccStageReturn } from './dccStageReturnsApi';

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function check(value: unknown): asserts value { if (!value) throw new Error('The project file catalog did not match its retained records. Refresh the library before using it.'); }
function shape(value: unknown, keys: string[], optional: string[] = []): asserts value is Record<string, unknown> { check(object(value) && Object.keys(value).every(key => [...keys, ...optional].includes(key)) && keys.every(key => Object.prototype.hasOwnProperty.call(value, key))); }
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;
export interface ProjectLibraryApi {
  importFile?(project: WorkspaceProject, file: File): Promise<ProjectAssetRecord>;
  load(project: WorkspaceProject, signal?: AbortSignal): Promise<ProjectLibraryCatalog>;
  search?(project: Project, query: string, signal?: AbortSignal): Promise<ParsedSearchResult>;
  saveCuration?(project: WorkspaceProject, data: AssetCuration, expectedVersion: number | null, requestId: string): Promise<AssetCurationRecord>;
}
async function read(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { credentials: 'same-origin', redirect: 'error', signal });
  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new WorkspaceError(object(raw) && typeof raw.error === 'string' ? raw.error : 'The project library could not be read.', response.status);
  return raw;
}
function extraction(value: unknown, originalHash: string): AssetExtraction {
  shape(value, ['status', 'sources']); check(['NO_RETAINED_EXTRACTION', 'RETAINED_LORE'].includes(String(value.status)) && Array.isArray(value.sources) && value.sources.length <= 10000);
  for (const source of value.sources) {
    shape(source, ['ref', 'originalSha256', 'extractionSha256', 'pageCount', 'pagesWithText', 'textCharacters', 'ocrPerformed']);
    shape(source.ref, ['id', 'sha256']); check(id(source.ref.id) && digest(source.ref.sha256) && source.originalSha256 === originalHash && (source.extractionSha256 === null || digest(source.extractionSha256)) && integer(source.pageCount) && integer(source.pagesWithText, Number(source.pageCount)) && integer(source.textCharacters) && typeof source.ocrPerformed === 'boolean');
  }
  check(value.status === (value.sources.length ? 'RETAINED_LORE' : 'NO_RETAINED_EXTRACTION'));
  return value as unknown as AssetExtraction;
}
function usage(value: unknown, project: WorkspaceProject): AssetUsage[] {
  check(Array.isArray(value) && value.length <= 10000);
  for (const item of value) {
    shape(item, ['record','relation','paths','sceneIds']); shape(item.record, ['id','kind','version','sha256']);
    check(id(item.record.id) && id(item.record.kind) && integer(item.record.version) && Number(item.record.version) > 0 && digest(item.record.sha256) && ['CURATION','LORE_ORIGINAL','RECORD_REFERENCE','BLOB_REFERENCE','STORYBOARD_REFERENCE'].includes(String(item.relation)));
    check(Array.isArray(item.paths) && item.paths.length <= 10000 && item.paths.every(value => typeof value === 'string' && value.length <= 2048));
    check(Array.isArray(item.sceneIds) && item.sceneIds.every(value => (project.scenes as Project['scenes']).some(scene => scene.id === value)));
  }
  return value as AssetUsage[];
}
export const projectLibraryApi: ProjectLibraryApi = {
  async importFile(project, file) {
    if (!file.size || file.size > 256 * 1024 * 1024) throw new Error('Choose a file between 1 byte and 256 MiB.');
    const bytes = await file.arrayBuffer();
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const response = await fetch('/api/project-library/upload', { method: 'POST', credentials: 'same-origin', redirect: 'error', headers: {
      'Content-Type': 'application/octet-stream', 'X-Library-Project-Id': project.id, 'X-Library-Source-Hash': String(project.sourceHash),
      'X-Library-Filename': encodeURIComponent(file.name), 'X-Library-Sha256': sha256, 'X-Library-Byte-Length': String(file.size),
    }, body: file });
    const raw: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new WorkspaceError(object(raw) && typeof raw.error === 'string' ? raw.error : 'The file import was not confirmed.', response.status);
    check(object(raw) && raw.schemaVersion === 'filmstack-project-library-upload-result/v1' && raw.sourceHash === project.sourceHash && (project.sourceHash !== null || raw.projectId === project.id));
    check(Array.isArray(raw.records) && raw.records.length === 1);
    const record = await validateRecord(raw.records[0], project) as ProjectAssetRecord;
    check(record.kind === 'project-asset' && record.data.asset.sha256 === sha256 && record.data.asset.byteLength === file.size);
    return record;
  },
  async load(project, signal) {
    const raw = await read('/api/project-library', signal);
    shape(raw, ['schemaVersion', 'sourceHash', 'assets'], ['whereUsedScope', 'dccReturns', 'projectId']);
    check(raw.schemaVersion === 'filmstack-project-library/v1' && raw.sourceHash === project.sourceHash && Array.isArray(raw.assets) && raw.assets.length <= 10000);
    check(project.sourceHash !== null || raw.projectId === project.id);
    check(raw.whereUsedScope === undefined || ['CURRENT_RECORD_DIRECT_REFERENCES', 'CURRENT_RECORD_AND_STORYBOARD_REFERENCES'].includes(String(raw.whereUsedScope)));
    const assets = await Promise.all(raw.assets.map(async entry => {
      shape(entry, ['record', 'downloadUrl'], ['curation','extraction','whereUsed']);
      const record = await validateRecord(entry.record, project);
      check(record.kind === 'project-asset' && record.version === 1 && entry.downloadUrl === `/api/project-library/assets/${encodeURIComponent(record.id)}`);
      const asset = record as ProjectAssetRecord;
      const curation = entry.curation == null ? null : await validateRecord(entry.curation, project) as AssetCurationRecord;
      if (curation) check(curation.kind === 'asset-curation' && curation.data.assetRef.id === record.id && curation.data.assetRef.sha256 === record.sha256);
      return { record: asset, downloadUrl: entry.downloadUrl as string, ...('curation' in entry ? { curation } : {}), ...(entry.extraction ? { extraction: extraction(entry.extraction, asset.data.asset.sha256) } : {}), ...(entry.whereUsed ? { whereUsed: usage(entry.whereUsed, project) } : {}) };
    }));
    check(new Set(assets.map(entry => entry.record.id)).size === assets.length);
    let dccReturns: DccStageReturn[] | undefined;
    if (raw.dccReturns !== undefined) {
      check(Array.isArray(raw.dccReturns) && raw.dccReturns.length <= 1000);
      dccReturns = raw.dccReturns.map(value => {
        check(object(value) && object(value.origin));
        const scene = (project.scenes as Project['scenes']).find(scene => scene.id === (value.origin as Record<string, unknown>).sceneId);
        check(scene && project.sourceHash !== null); validateDccStageReturn(value, project as Project, scene);
        return value;
      });
      check(new Set(dccReturns.map(value => value.id)).size === dccReturns.length);
    }
    return { schemaVersion: 'filmstack-project-library/v1', sourceHash: project.sourceHash, ...(project.sourceHash === null ? { projectId: project.id } : {}), ...(raw.whereUsedScope ? { whereUsedScope: raw.whereUsedScope as ProjectLibraryCatalog['whereUsedScope'] } : {}), assets, ...(dccReturns ? { dccReturns } : {}) };
  },
  async search(project, query, signal) {
    const text = query.trim(); if (!text || text.length > 160) throw new Error('Enter a phrase of 1–160 characters.');
    const raw = await read(`/api/project-library/search?sourceHash=${encodeURIComponent(project.sourceHash)}&q=${encodeURIComponent(text)}&limit=30`, signal);
    shape(raw, ['schemaVersion','sourceHash','query','limit','totalMatches','truncated','searchedSources','searchedPages','results']);
    check(raw.schemaVersion === 'filmstack-project-library-search/v1' && raw.sourceHash === project.sourceHash && raw.query === text && raw.limit === 30 && integer(raw.totalMatches) && typeof raw.truncated === 'boolean' && integer(raw.searchedSources) && integer(raw.searchedPages) && Array.isArray(raw.results) && raw.results.length <= 30 && raw.results.length <= Number(raw.totalMatches));
    for (const hit of raw.results) {
      shape(hit, ['assetIds','sourceRef','title','pageNumber','snippet','snippetStart','matchStart','matchLength']);
      shape(hit.sourceRef, ['id','sha256','originalSha256','extractionSha256','pageNumber','textSha256']);
      check(Array.isArray(hit.assetIds) && hit.assetIds.every(id) && id(hit.sourceRef.id) && ['sha256','originalSha256','extractionSha256','textSha256'].every(key => digest((hit.sourceRef as Record<string, unknown>)[key])));
      check(typeof hit.title === 'string' && hit.title.length <= 1000 && integer(hit.pageNumber) && Number(hit.pageNumber) > 0 && hit.sourceRef.pageNumber === hit.pageNumber && typeof hit.snippet === 'string' && hit.snippet.length <= 360 && integer(hit.snippetStart) && integer(hit.matchStart) && integer(hit.matchLength) && Number(hit.matchLength) > 0);
    }
    return raw as unknown as ParsedSearchResult;
  },
  async saveCuration(project, data, expectedVersion, requestId) {
    validateAssetCuration(data, project);
    const record = await workspaceApi.saveRecord({ id: `asset-curation:${data.assetRef.id.slice('project-asset:'.length)}`, kind: 'asset-curation', expectedVersion, requestId, data });
    return await validateRecord(record, project) as AssetCurationRecord;
  },
};
