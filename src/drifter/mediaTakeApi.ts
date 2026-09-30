import { WorkspaceError } from './api';
import { canonicalJson } from './canonical';
import { validateRecord } from './validation';
import type { Project, Scene } from './types';
import { MAX_MEDIA_TAKE_BYTES, type MediaTakeApi, type MediaTakeEntry, type MediaTakeRecord, type TakeReviewRecord } from './mediaTakeTypes';

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function check(condition: unknown): asserts condition { if (!condition) throw new Error('The saved take response did not match this scene or clip. Refresh saved takes before continuing.'); }
export async function hashMediaBlob(blob: Blob): Promise<string> {
  const bytes = typeof blob.arrayBuffer === 'function' ? await blob.arrayBuffer() : await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(new Error('The selected clip could not be read.')); reader.readAsArrayBuffer(blob);
  });
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function validateMediaTake(value: unknown, project: Project, scene: Scene): Promise<MediaTakeRecord> {
  const record = await validateRecord(value, project);
  check(record.kind === 'measured-media-take' && record.version === 1 && record.id === `measured-media-take:${record.sha256}` && (record.data as MediaTakeRecord['data']).sceneId === scene.id);
  return record as MediaTakeRecord;
}
export async function validateTakeReview(value: unknown, project: Project, take: MediaTakeRecord): Promise<TakeReviewRecord> {
  const record = await validateRecord(value, project), data = record.data as TakeReviewRecord['data'];
  check(record.kind === 'take-review' && record.id === `take-review:${take.sha256}` && data.sceneId === take.data.sceneId && data.takeRef.id === take.id && data.takeRef.sha256 === take.sha256);
  return record as TakeReviewRecord;
}
async function entry(value: unknown, project: Project, scene: Scene): Promise<MediaTakeEntry> {
  check(object(value));
  const record = await validateMediaTake(value.record, project, scene);
  check(value.mediaUrl === `/api/blobs/${record.data.blob.sha256}`);
  return { record, review: value.review === null ? null : await validateTakeReview(value.review, project, record), mediaUrl: value.mediaUrl as string };
}
async function json(path: string, options: RequestInit = {}) {
  const response = await fetch(path, { ...options, credentials: 'same-origin', redirect: 'error' });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new WorkspaceError(typeof value?.error === 'string' ? value.error : 'The local workspace did not confirm this take request.', response.status);
  return value;
}
export const mediaTakeApi: MediaTakeApi = {
  async measureRetained(project, scene, input) {
    check(input.sourceHash === project.sourceHash && input.sceneId === scene.id && (input.shotId === null || scene.shots.some(shot => shot.id === input.shotId)));
    const value = await json('/api/media-takes/measure-retained', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: canonicalJson(input) });
    const saved = await entry(value, project, scene), data = saved.record.data;
    check(data.shotId === input.shotId && data.blob.sha256 === input.assetHash && canonicalJson(data.briefRef) === canonicalJson(input.briefRef) && canonicalJson(data.retainedSource) === canonicalJson(input.retainedSource));
    return saved;
  },
  async list(project, scene, signal) {
    const value = await json(`/api/media-takes?sceneId=${encodeURIComponent(scene.id)}`, { signal });
    check(value?.schemaVersion === 'filmstack-media-takes/v1' && value.sourceHash === project.sourceHash && value.sceneId === scene.id && Number.isSafeInteger(value.maxUploadBytes) && value.maxUploadBytes > 0 && value.maxUploadBytes <= MAX_MEDIA_TAKE_BYTES && Array.isArray(value.takes) && Array.isArray(value.legacyTakes));
    const takes = await Promise.all(value.takes.map(item => entry(item, project, scene)));
    check(new Set(takes.map(item => item.record.id)).size === takes.length);
    const legacyTakes = await Promise.all(value.legacyTakes.map(item => validateRecord(item, project)));
    check(legacyTakes.every(record => record.kind === 'media-take' && (record.data as { sourceHash: string }).sourceHash === project.sourceHash));
    return { ...value, takes, legacyTakes };
  },
  async importFile(project, scene, file, intake, signal) {
    check(file.size > 0 && file.size <= MAX_MEDIA_TAKE_BYTES && /\.mp4$/i.test(file.name));
    check(intake.sourceHash === project.sourceHash && intake.sceneId === scene.id && intake.originalFilename === file.name);
    const fileHash = await hashMediaBlob(file);
    if (signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError');
    const value = await json('/api/media-takes/import', { method: 'POST', signal, headers: { 'Content-Type': 'application/octet-stream', 'X-Media-Intake': encodeURIComponent(canonicalJson(intake)) }, body: file });
    const saved = await entry(value, project, scene), data = saved.record.data;
    check(data.shotId === intake.shotId && canonicalJson(data.briefRef) === canonicalJson(intake.briefRef) && data.originalFilename === file.name && data.blob.byteLength === file.size && data.blob.sha256 === fileHash);
    if (signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError');
    return saved;
  },
  async review(project, take, input) {
    const scene = project.scenes.find(item => item.id === take.record.data.sceneId);
    check(scene && input.takeSha256 === take.record.sha256);
    await validateMediaTake(take.record, project, scene);
    const value = await json(`/api/media-takes/${encodeURIComponent(take.record.id)}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: canonicalJson(input) });
    const saved = await validateTakeReview(value, project, take.record);
    check(saved.version === (input.expectedVersion ?? 0) + 1 && saved.data.decision === input.decision && saved.data.note === input.note && input.takeSha256 === take.record.sha256);
    return saved;
  },
  async preview(take, signal) {
    check(take.mediaUrl === `/api/blobs/${take.record.data.blob.sha256}`);
    const response = await fetch(take.mediaUrl, { credentials: 'same-origin', redirect: 'error', signal });
    if (!response.ok) throw new WorkspaceError('This saved clip could not be opened. Refresh saved takes and try again.', response.status);
    const blob = await response.blob();
    if (blob.type.split(';')[0] !== take.record.data.blob.mimeType || blob.size !== take.record.data.blob.byteLength) throw new Error('The returned clip does not match its saved file details. Preview was not opened.');
    if (await hashMediaBlob(blob) !== take.record.data.blob.sha256) throw new Error('The returned clip failed its file-hash check. Preview was not opened.');
    if (signal?.aborted) throw new DOMException('Preview cancelled.', 'AbortError');
    return blob;
  },
};
