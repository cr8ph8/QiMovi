import { projectOwnedContext } from '../../local/contracts/creative-project.mjs';
import type { LoreSource, WorkspaceProject, ProjectAsset, WorkspaceRecord } from './types';
import { studioGenerationDetails } from '../../local/contracts/studio-generation.mjs';
import type { MediaTakeData, TakeDecision } from './mediaTakeTypes';
import type { DccStageArtifact, DccStageReturn } from './dccStageReturnsApi';

export const PROJECT_FILE_FAMILIES = ['DOCUMENT', 'TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'THREE_D', 'ARCHIVE', 'OPAQUE'] as const;
export type ProjectAssetRecord = WorkspaceRecord & { kind: 'project-asset'; data: ProjectAsset };
export const ORGANIZATION_STATUSES = ['INBOX', 'SHORTLIST', 'ARCHIVED'] as const;
export interface AssetCuration { schemaVersion: 1 | 2; sourceHash: string | null; projectId?: string; assetRef: { id: string; sha256: string }; displayTitle: string; tags: string[]; notes: string; organizationStatus: typeof ORGANIZATION_STATUSES[number]; sceneIds: string[]; scope: 'PROJECT_ORGANIZATION' }
export type AssetCurationRecord = WorkspaceRecord & { kind: 'asset-curation'; data: AssetCuration };
export interface AssetExtraction { status: 'NO_RETAINED_EXTRACTION' | 'RETAINED_LORE'; sources: { ref: { id: string; sha256: string }; originalSha256: string; extractionSha256: string | null; pageCount: number; pagesWithText: number; textCharacters: number; ocrPerformed: boolean }[] }
export interface AssetUsage { record: { id: string; kind: string; version: number; sha256: string }; relation: 'CURATION' | 'LORE_ORIGINAL' | 'RECORD_REFERENCE' | 'BLOB_REFERENCE' | 'STORYBOARD_REFERENCE'; paths: string[]; sceneIds: string[] }
export interface ProjectLibraryAsset { record: ProjectAssetRecord; downloadUrl: string; curation?: AssetCurationRecord | null; extraction?: AssetExtraction; whereUsed?: AssetUsage[] }
export type ProjectLibraryCatalog = { schemaVersion: 'filmstack-project-library/v1'; sourceHash: string | null; projectId?: string; whereUsedScope?: 'CURRENT_RECORD_DIRECT_REFERENCES' | 'CURRENT_RECORD_AND_STORYBOARD_REFERENCES'; assets: ProjectLibraryAsset[]; dccReturns?: DccStageReturn[] };
export const PROJECT_FILE_ORIGINS = ['PROJECT_FILE', 'LORE_SOURCE', 'IMPORTED_MEDIA', 'MEASURED_TAKE', 'GENERATED_MEDIA', 'COMIC_EXPORT', 'DCC_RETURN'] as const;
export type ProjectFileOrigin = typeof PROJECT_FILE_ORIGINS[number];
export const originLabel = (origin: ProjectFileOrigin) => ({ PROJECT_FILE: 'Project files', LORE_SOURCE: 'Lore sources', IMPORTED_MEDIA: 'Imported media', MEASURED_TAKE: 'Measured takes', GENERATED_MEDIA: 'Generated results', COMIC_EXPORT: 'Comic exports', DCC_RETURN: 'DCC rehearsals' })[origin];
export interface RetainedDccProvenance { id: string; sha256: string; kitFilesSha256: string; origin: DccStageReturn['origin']; basis: DccStageReturn['basis']; artifact: DccStageArtifact; frameIds: string[] }
export type FileProvenance = { filename: string; status: string; sceneIds: string[]; detail?: string } & (
  { origin: Exclude<ProjectFileOrigin, 'DCC_RETURN'>; record: AssetUsage['record']; retainedReturn?: never } |
  { origin: 'DCC_RETURN'; record?: never; retainedReturn: RetainedDccProvenance }
);
export interface LibraryTakeSummary { record: AssetUsage['record']; sceneId: string; shotId: string | null; measurement: MediaTakeData['measurement']; decision: TakeDecision }
export type ProjectFileEntry = { id: string; sha256: string; title: string; filename: string; family: ProjectAsset['family']; category: string; collection: string; byteLength: number; mimeType: string; downloadUrl: string; asset?: ProjectAssetRecord; lore: WorkspaceRecord[]; curation?: AssetCurationRecord | null; extraction?: AssetExtraction; whereUsed?: AssetUsage[]; provenance?: FileProvenance[]; parentAssetHashes?: string[]; takes?: LibraryTakeSummary[] };
export const FILE_REVIEW_STATES = ['UNMEASURED', 'AWAITING_REVIEW', 'CANDIDATE', 'SET_ASIDE'] as const;
export const fileReviewLabel = (value: typeof FILE_REVIEW_STATES[number]) => ({ UNMEASURED: 'Needs measurement', AWAITING_REVIEW: 'Awaiting owner review', CANDIDATE: 'Selected candidate', SET_ASIDE: 'Set aside' })[value];
export function fileReviewStates(entry: ProjectFileEntry): typeof FILE_REVIEW_STATES[number][] {
  if (entry.family !== 'VIDEO') return [];
  if (!entry.takes?.length) return ['UNMEASURED'];
  return [...new Set(entry.takes.map(take => take.decision === 'KEEP_CANDIDATE' ? 'CANDIDATE' as const : take.decision === 'REJECT' ? 'SET_ASIDE' as const : 'AWAITING_REVIEW' as const))];
}
export interface ParsedSearchHit { assetIds: string[]; sourceRef: { id: string; sha256: string; originalSha256: string; extractionSha256: string; pageNumber: number; textSha256: string }; title: string; pageNumber: number; snippet: string; snippetStart: number; matchStart: number; matchLength: number }
export interface ParsedSearchResult { schemaVersion: 'filmstack-project-library-search/v1'; sourceHash: string; query: string; limit: number; totalMatches: number; truncated: boolean; searchedSources: number; searchedPages: number; results: ParsedSearchHit[] }
export const organizationLabel = (status: AssetCuration['organizationStatus']) => ({ INBOX: 'Inbox', SHORTLIST: 'Shortlisted', ARCHIVED: 'Archived' })[status];
export function freshCuration(entry: ProjectFileEntry, project: WorkspaceProject): AssetCuration | undefined {
  if (!entry.asset || !retainedRecordMatchesProject(entry.asset, project)) return;
  const sourceHash = entry.asset.data.sourceHash;
  return entry.curation?.data ?? { schemaVersion: sourceHash === null ? 2 : 1, sourceHash, ...(sourceHash === null ? { projectId: project.id } : {}), assetRef: { id: entry.asset.id, sha256: entry.asset.sha256 }, displayTitle: entry.asset.data.title, tags: [], notes: '', organizationStatus: 'INBOX', sceneIds: [], scope: 'PROJECT_ORGANIZATION' };
}
export function projectInventoryCsv(entries: ProjectFileEntry[]) {
  const cell = (value: string | number) => { const text = String(value); return '"' + (/^[=+@\-\t\r]/.test(text) ? "'" : '') + text.replace(/"/g, '""') + '"'; };
  return [['Title','Original filename','Type','Collection','Category','Organization','Tags','Scene IDs','Bytes','SHA-256','Origins','Retained status'], ...entries.map(entry => [entry.title, entry.filename, entry.family, entry.collection, entry.category, entry.asset ? entry.curation?.data.organizationStatus ?? 'INBOX' : 'NOT_APPLICABLE', entry.curation?.data.tags.join('; ') ?? '', [...new Set([...(entry.curation?.data.sceneIds ?? []), ...(entry.provenance ?? []).flatMap(item => item.sceneIds)])].join('; '), entry.byteLength, entry.sha256, [...new Set((entry.provenance ?? []).map(item => originLabel(item.origin)))].join('; '), (entry.provenance ?? []).map(item => item.status).join('; ')])].map(row => row.map(cell).join(',')).join('\r\n');
}
export const familyLabel = (family: ProjectAsset['family']) => ({ DOCUMENT: 'Documents', TEXT: 'Text & scripts', IMAGE: 'Images', AUDIO: 'Audio', VIDEO: 'Video', THREE_D: '3D files', ARCHIVE: 'Archives', OPAQUE: 'Other files' })[family];
export function fileSize(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(2)} GB`; }

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fileMetadata = (value: unknown): value is { sha256: string; byteLength: number; mimeType: string } => object(value) && digest(value.sha256) && Number.isSafeInteger(value.byteLength) && Number(value.byteLength) > 0 && typeof value.mimeType === 'string' && /^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/.test(value.mimeType);
const fileName = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 255 && [...value].every(char => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127 && char !== '/' && char !== '\\');
const fileFamily = (mime: string): ProjectAsset['family'] => mime.startsWith('image/') ? 'IMAGE' : mime.startsWith('video/') ? 'VIDEO' : mime.startsWith('audio/') ? 'AUDIO' : mime === 'application/pdf' ? 'DOCUMENT' : ['application/zip','application/vnd.comicbook+zip'].includes(mime) ? 'ARCHIVE' : mime.startsWith('text/') || mime === 'application/json' ? 'TEXT' : 'OPAQUE';
const recordRef = (record: WorkspaceRecord): AssetUsage['record'] => ({ id: record.id, kind: record.kind, version: record.version, sha256: record.sha256 });

/** Scope matching for already validated records, including original development records. */
export function retainedRecordMatchesProject(record: WorkspaceRecord, project: { id: string; sourceHash: string | null }): boolean {
  const data = record.data as unknown as { projectId?: string; sourceHash?: string | null };
  try {
    const context = projectOwnedContext(project, record.kind, data);
    return data.sourceHash === context.sourceHash && (data.sourceHash === null ? data.projectId === context.id : !data.projectId || data.projectId === context.id);
  } catch { return false; }
}

/** Read-only projection of validated workspace records. Owned bytes are verified by
 * the existing server contracts; a remote URL or prepared job never becomes a file. */
export function projectFileEntries(catalog: ProjectLibraryCatalog | undefined, records: WorkspaceRecord[], sourceHash: string | null, projectId?: string, project?: WorkspaceProject): ProjectFileEntry[] {
  const entries = new Map<string, ProjectFileEntry>();
  const latest = [...records.reduce((all, record) => { if (!all.has(record.id) || all.get(record.id)!.version < record.version) all.set(record.id, record); return all; }, new Map<string, WorkspaceRecord>()).values()];
  const inScope = (record: WorkspaceRecord) => {
    if (project && project.id === projectId && project.sourceHash === sourceHash) return retainedRecordMatchesProject(record, project);
    const data = record.data as unknown as Record<string, unknown>;
    return data.sourceHash === sourceHash && (!data.projectId || !projectId || data.projectId === projectId) && (sourceHash !== null || Boolean(projectId && data.projectId === projectId));
  };
  const scoped = latest.filter(inScope);
  const provenance = (record: WorkspaceRecord, origin: Exclude<ProjectFileOrigin, 'DCC_RETURN'>, filename: string, status: string, sceneIds: string[] = [], detail?: string): FileProvenance => ({ origin, record: recordRef(record), filename, status, sceneIds, ...(detail ? { detail } : {}) });
  function retain(record: WorkspaceRecord, file: unknown, filename: unknown, origin: Exclude<ProjectFileOrigin, 'DCC_RETURN'>, status: string, options: { title?: string; sceneIds?: string[]; detail?: string; path: string; parentAssetHashes?: string[] }) {
    if (!fileMetadata(file) || !fileName(filename)) return;
    const existing = entries.get(file.sha256);
    if (existing && (existing.byteLength !== file.byteLength || existing.mimeType !== file.mimeType)) return;
    const originRecord = provenance(record, origin, filename, status, options.sceneIds, options.detail);
    const usage: AssetUsage = { record: recordRef(record), relation: 'BLOB_REFERENCE', paths: [options.path], sceneIds: options.sceneIds ?? [] };
    const parentAssetHashes = [...new Set([...(existing?.parentAssetHashes ?? []), ...(options.parentAssetHashes ?? [])])].filter(hash => hash !== file.sha256);
    if (existing) { existing.provenance = [...(existing.provenance ?? []), originRecord]; existing.whereUsed = [...(existing.whereUsed ?? []).filter(item => item.record.id !== record.id), usage]; existing.parentAssetHashes = parentAssetHashes; return; }
    entries.set(file.sha256, { id: record.id, ...file, title: options.title ?? filename, filename, family: fileFamily(file.mimeType), category: originLabel(origin), collection: 'Working assets', downloadUrl: `/api/blobs/${file.sha256}`, lore: [], provenance: [originRecord], whereUsed: [usage], parentAssetHashes });
  }
  for (const { record, downloadUrl, curation, extraction, whereUsed } of catalog?.assets ?? []) {
    const data = record.data;
    if (!inScope(record)) continue;
    entries.set(data.asset.sha256, { id: record.id, sha256: data.asset.sha256, title: curation?.data.displayTitle ?? data.title, filename: data.originalFilename, family: data.family, category: data.category, collection: data.collection, byteLength: data.asset.byteLength, mimeType: data.asset.mimeType, downloadUrl, asset: record, lore: [], curation, extraction, whereUsed, provenance: [provenance(record, 'PROJECT_FILE', data.originalFilename, 'Project reference · pending review')] });
  }
  for (const record of scoped) {
    if (record.kind !== 'lore-source') continue;
    const data = record.data as LoreSource;
    if (data.sourceHash !== sourceHash) continue;
    const existing = entries.get(data.original.sha256);
    const origin = provenance(record, 'LORE_SOURCE', data.originalFilename, 'Research source · pending review');
    if (existing) { existing.lore.push(record); existing.provenance?.push(origin); continue; }
    entries.set(data.original.sha256, { id: record.id, sha256: data.original.sha256, title: data.title, filename: data.originalFilename, family: data.documentType === 'PDF' ? 'DOCUMENT' : 'IMAGE', category: 'Retained lore', collection: 'Existing project sources', byteLength: data.original.bytes, mimeType: data.original.mimeType, downloadUrl: `/api/lore/${encodeURIComponent(record.id)}/original`, lore: [record], provenance: [origin] });
  }
  for (const record of scoped) {
    const data = record.data as unknown as Record<string, unknown>;
    if (record.kind === 'studio-media' && data.status === 'REFERENCE_UNREVIEWED') retain(record, { sha256: data.assetHash, byteLength: data.byteLength, mimeType: data.mimeType }, data.originalFilename, 'IMPORTED_MEDIA', 'Imported reference · unreviewed', { path: 'data.assetHash' });
    if (record.kind === 'measured-media-take' && (['IMPORTED_USER_MEDIA', 'RETAINED_PROJECT_ASSET'].includes(String(data.origin)) && data.providerProvenance === 'UNVERIFIED' || data.origin === 'RETAINED_PROVIDER_OUTPUT' && data.providerProvenance === 'HIGGSFIELD_MCP_RECORD' || data.origin === 'RETAINED_DCC_MOTION' && data.providerProvenance === 'LOCAL_BLENDER_RENDER') && object(data.measurement) && Number.isSafeInteger(data.measurement.durationMs) && Number(data.measurement.durationMs) > 0) {
      const reviews = scoped.filter(item => { const review = item.data as unknown as Record<string, unknown>; return item.kind === 'take-review' && object(review.takeRef) && review.takeRef.id === record.id && review.takeRef.sha256 === record.sha256 && review.actor === 'local-owner' && review.scope === 'CANDIDATE_PREFERENCE_ONLY'; });
      const decision = (reviews.at(-1)?.data as { decision?: string } | undefined)?.decision;
      const preference = decision === 'KEEP_CANDIDATE' ? 'keep candidate' : decision === 'REJECT' ? 'rejected candidate' : 'review pending';
      retain(record, data.blob, data.originalFilename, 'MEASURED_TAKE', `Measured take · ${preference}`, { path: 'data.blob.sha256', sceneIds: typeof data.sceneId === 'string' ? [data.sceneId] : [], detail: `${(Number(data.measurement.durationMs) / 1000).toFixed(3)} seconds measured · ${data.providerProvenance === 'LOCAL_BLENDER_RENDER' ? 'local Blender scene and render linked' : data.providerProvenance === 'HIGGSFIELD_MCP_RECORD' ? 'retained Higgsfield job linked' : 'provider provenance unverified'}` });
      const entry = object(data.blob) && typeof data.blob.sha256 === 'string' ? entries.get(data.blob.sha256) : undefined;
      if (entry && entry.provenance?.some(item => item.record?.id === record.id)) entry.takes = [...(entry.takes ?? []), { record: recordRef(record), sceneId: String(data.sceneId), shotId: typeof data.shotId === 'string' ? data.shotId : null, measurement: data.measurement as unknown as MediaTakeData['measurement'], decision: decision === 'KEEP_CANDIDATE' || decision === 'REJECT' ? decision : 'PENDING' }];
    }
    if (record.kind === 'studio-generation' && ['COMPLETED', 'FAILED', 'RETAINED'].includes(String(data.phase)) && typeof data.detailsJson === 'string') {
      try {
        const details = studioGenerationDetails(data.detailsJson) as { outputs?: { sha256: string; byteLength: number; mimeType: string; filename: string }[] };
        const operationRef = object(data.operationRef) ? data.operationRef : undefined;
        const operation = operationRef && records.find(row => row.id === operationRef.id && row.sha256 === operationRef.sha256 && row.kind === 'studio-operation');
        const target = operation && object((operation.data as unknown as Record<string, unknown>).target) ? (operation.data as unknown as { target: { sceneId?: string } }).target : undefined;
        for (const output of details.outputs ?? []) retain(record, output, output.filename, 'GENERATED_MEDIA', `Retained generated result · unreviewed${data.phase === 'FAILED' ? ' · batch failed' : ''}`, { path: 'data.detailsJson.outputs[].sha256', sceneIds: typeof target?.sceneId === 'string' ? [target.sceneId] : [] });
      } catch { /* Invalid provider details are not projected as owned media. */ }
    }
    if (record.kind === 'comic-package' && data.status === 'PRIVATE_DRAFT' && data.verification === 'SOURCE_BINDINGS_AND_CONTAINERS_ONLY' && Array.isArray(data.files)) {
      for (const file of data.files) if (object(file) && ['PDF', 'CBZ', 'MANIFEST'].includes(String(file.role))) retain(record, file, file.filename, 'COMIC_EXPORT', 'Private comic draft · source bindings checked', { path: 'data.files[].sha256', title: `${typeof data.title === 'string' ? data.title : 'Comic'} · ${file.role}`, detail: 'Container and source checks do not establish creative acceptance or a licence.', parentAssetHashes: Array.isArray(data.parentAssetHashes) ? data.parentAssetHashes.filter(digest) : [] });
    }
  }
  // Returns are immutable retained receipts, not workspace records. Keep their
  // exact identity separate while projecting the same owned blobs into Library.
  for (const returned of catalog?.sourceHash === sourceHash ? catalog.dccReturns ?? [] : []) {
    if (!sourceHash || returned.origin.sourceHash !== sourceHash || projectId && returned.origin.projectId !== projectId || returned.status !== 'PENDING_REVIEW' || returned.scope !== 'INTERNAL_REHEARSAL_CANDIDATE' || returned.approvalGranted !== false || returned.finalMedia !== false || returned.measuredMediaDurationMs !== null || returned.rightsStatus !== 'UNKNOWN') continue;
    for (const artifact of returned.artifacts) {
      if (!fileMetadata(artifact) || !fileName(artifact.name) || artifact.url !== `/api/blobs/${artifact.sha256}`) continue;
      const existing = entries.get(artifact.sha256);
      const editableScene = artifact.mimeType === 'application/octet-stream' && artifact.name.endsWith(returned.origin.target === 'BLENDER' ? '.blend' : '.unity');
      if (existing && (existing.byteLength !== artifact.byteLength || existing.mimeType !== artifact.mimeType && !(editableScene && existing.family === 'THREE_D'))) continue;
      const frames = returned.frames.filter(frame => frame.imageHash === artifact.sha256);
      const uses: AssetUsage[] = scoped.flatMap(record => {
        const data = record.data as unknown as Record<string, unknown>, ref = data.originDccReturnRef;
        if (record.kind !== 'storyboard-cell' || !object(ref) || ref.receiptSha256 !== returned.receiptSha256 || ref.kitFilesSha256 !== returned.kitFilesSha256 || data.sceneId !== returned.origin.sceneId || data.shotId !== returned.origin.shotId || data.imageHash !== artifact.sha256 || !frames.some(frame => frame.id === ref.frameId && frame.shotId === data.shotId)) return [];
        return [{ record: recordRef(record), relation: 'BLOB_REFERENCE' as const, paths: ['data.imageHash', 'data.originDccReturnRef'], sceneIds: [returned.origin.sceneId] }];
      });
      const origin: FileProvenance = { origin: 'DCC_RETURN', filename: artifact.name, sceneIds: [returned.origin.sceneId], status: `Retained ${returned.application.name} rehearsal · pending review${returned.basis.status === 'STALE' ? ' · earlier scene basis' : ''}`,
        detail: `Shot ${returned.origin.shotId}${frames.length ? ` · ${frames.map(frame => `${frame.role.toLowerCase()} frame ${frame.frame}`).join(', ')}` : ''}. Rights unknown; no final media or quality approval.`,
        retainedReturn: { id: returned.id, sha256: returned.receiptSha256, kitFilesSha256: returned.kitFilesSha256, origin: returned.origin, basis: returned.basis, artifact, frameIds: frames.map(frame => frame.id) } };
      if (existing) {
        existing.provenance = [...(existing.provenance ?? []), origin];
        existing.whereUsed = [...(existing.whereUsed ?? []).filter(item => !uses.some(use => use.record.id === item.record.id)), ...uses];
      } else entries.set(artifact.sha256, { id: `dcc-file:${artifact.sha256}`, sha256: artifact.sha256, byteLength: artifact.byteLength, mimeType: artifact.mimeType, title: artifact.name, filename: artifact.name, family: editableScene ? 'THREE_D' : fileFamily(artifact.mimeType), category: originLabel('DCC_RETURN'), collection: 'Retained rehearsals', downloadUrl: artifact.url, lore: [], provenance: [origin], whereUsed: uses });
    }
  }
  return [...entries.values()].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}
