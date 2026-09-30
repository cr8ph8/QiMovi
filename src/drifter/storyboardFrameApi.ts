import { canonicalJson, hashCanonical } from './canonical';
import { validateRecord } from './validation';
import { WorkspaceError } from './api';
import type { Project, StoryCell, StoryboardCellDraft, WorkspaceRecord, ProjectAsset } from './types';

export interface ExtractedFrameImage { sha256: string; byteLength: number; mimeType: 'image/png'; pixelWidth: number; pixelHeight: number }
export interface FrameExtractionProvenance {
  schemaVersion: 1; projectId: string; sourceHash: string; cellId: string;
  parent: { imageHash: string; byteLength: number; mimeType: 'image/png' | 'image/jpeg'; pixelWidth: number; pixelHeight: number; crop: NonNullable<StoryCell['crop']> };
  originalCell: StoryCell; originalCellSha256: string; originalRecordRef: { id: string; version: number; sha256: string } | null;
  image: ExtractedFrameImage; engine: { name: 'macOS sips'; version: string };
  scope: 'INTERNAL_STORYBOARD_REFERENCE_ONLY'; review: 'PENDING';
}
export interface FrameExtractionResult {
  schemaVersion: 1;
  cellRecord: WorkspaceRecord & { kind: 'storyboard-cell'; data: StoryboardCellDraft };
  assetRecord: WorkspaceRecord & { kind: 'project-asset'; data: ProjectAsset };
  provenanceRecord: WorkspaceRecord & { kind: 'storyboard-frame-extraction'; data: FrameExtractionProvenance };
  image: ExtractedFrameImage; replayed: boolean;
}
function confirm(condition: unknown): asserts condition {
  if (!condition) throw new Error('The extracted frame response does not match this cell. Reload before continuing.');
}
export const storyboardFrameApi = {
  async extract(project: Project, cell: StoryCell, record: WorkspaceRecord | undefined, requestId: string): Promise<FrameExtractionResult> {
    // Freeze all source inputs before hashing or crossing the transport boundary.
    const frozen = JSON.parse(canonicalJson({ projectId: project.id, sourceHash: project.sourceHash, cell, record: record ?? null, requestId }));
    confirm(frozen.cell.crop && frozen.cell.imageHash && (!frozen.record || frozen.record.kind === 'storyboard-cell' && frozen.record.id === `storyboard-cell:${cell.id}`));
    const input = { requestId: frozen.requestId, projectId: frozen.projectId, sourceHash: frozen.sourceHash, cellId: frozen.cell.id,
      expectedCellSha256: await hashCanonical(frozen.cell), expectedRecordRef: frozen.record ? { id: frozen.record.id, version: frozen.record.version, sha256: frozen.record.sha256 } : null,
      imageHash: frozen.cell.imageHash, crop: frozen.cell.crop };
    const response = await fetch('/api/storyboard/frames/extract', { method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new WorkspaceError(typeof data?.error === 'string' ? data.error : 'Frame extraction was not confirmed. Reload before retrying.', response.status);
    confirm(data?.schemaVersion === 1 && typeof data.replayed === 'boolean');
    await Promise.all([validateRecord(data.cellRecord, project), validateRecord(data.assetRecord, project), validateRecord(data.provenanceRecord, project)]);
    const provenance = data.provenanceRecord.data, next = data.cellRecord.data, image = data.image;
    confirm(data.cellRecord.kind === 'storyboard-cell' && data.assetRecord.kind === 'project-asset' && data.provenanceRecord.kind === 'storyboard-frame-extraction');
    confirm(provenance.projectId === input.projectId && provenance.sourceHash === input.sourceHash && provenance.cellId === input.cellId && provenance.originalCellSha256 === input.expectedCellSha256 && canonicalJson(provenance.originalCell) === canonicalJson(frozen.cell) && canonicalJson(provenance.originalRecordRef) === canonicalJson(input.expectedRecordRef));
    confirm(data.cellRecord.version === (input.expectedRecordRef?.version ?? 0) + 1 && canonicalJson(provenance.image) === canonicalJson(image) && provenance.parent.imageHash === input.imageHash && canonicalJson(provenance.parent.crop) === canonicalJson(input.crop));
    const draft = frozen.record?.data ?? { sourceHash: input.sourceHash, cellId: frozen.cell.id, sceneId: frozen.cell.sceneId, shotId: frozen.cell.shotId, role: frozen.cell.role, description: frozen.cell.description, actionRefs: frozen.cell.actionRefs ?? [], plannedTimestampMs: frozen.cell.plannedTimestampMs ?? null, review: 'PENDING' };
    confirm(canonicalJson(next) === canonicalJson({ ...draft, imageHash: image.sha256, crop: null, pixelWidth: image.pixelWidth, pixelHeight: image.pixelHeight, review: 'PENDING' }));
    confirm(canonicalJson(data.assetRecord.data.asset) === canonicalJson({ sha256: image.sha256, byteLength: image.byteLength, mimeType: image.mimeType }));
    return data as FrameExtractionResult;
  },
};
