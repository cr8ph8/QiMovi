import { projectOwnedContext } from './creative-project.mjs';
// Original reference bytes, not measured/selected production takes.
export const STUDIO_MEDIA_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm', 'audio/wav', 'audio/mpeg'];
export const STUDIO_MEDIA_MAX_BYTES = 256 * 1024 * 1024;
const need = (value, code) => { if (!value) throw Object.assign(new Error(code), { code, status: 422 }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validateStudioMediaIdentity(recordId, kind, data) {
  if (kind !== 'studio-media' && !recordId?.startsWith('studio-media:')) return;
  need(kind === 'studio-media' && typeof recordId === 'string' && /^studio-media:[a-f0-9]{64}$/.test(recordId), 'STUDIO_MEDIA_IDENTITY_INVALID');
  if (data) need(recordId === `studio-media:${data.assetHash}`, 'STUDIO_MEDIA_IDENTITY_INVALID');
}
export function validateStudioMedia(data, project) {
  project = projectOwnedContext(project, 'studio-media', data);
  need(object(data) && Object.keys(data).sort().join(',') === ['schemaVersion', 'projectId', 'sourceHash', 'originalFilename', 'assetHash', 'byteLength', 'mimeType', 'status'].sort().join(','), 'STUDIO_MEDIA_FIELDS_INVALID');
  need(data.schemaVersion === 1 && data.sourceHash === null && data.status === 'REFERENCE_UNREVIEWED', 'STUDIO_MEDIA_AUTHORITY_INVALID');
  need(typeof data.projectId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(data.projectId), 'STUDIO_MEDIA_PROJECT_INVALID');
  if (project) need(project.profile === 'caniscreenwrite-creative/v1' && project.sourceHash === null && project.id === data.projectId, 'STUDIO_MEDIA_PROJECT_MISMATCH');
  need(typeof data.originalFilename === 'string' && data.originalFilename.trim().length > 0 && data.originalFilename.length <= 240 && data.originalFilename.isWellFormed() && !/[\x00-\x1f\x7f/\\]/.test(data.originalFilename) && !['.', '..'].includes(data.originalFilename), 'STUDIO_MEDIA_FILENAME_INVALID');
  need(digest(data.assetHash) && Number.isSafeInteger(data.byteLength) && data.byteLength > 0 && data.byteLength <= STUDIO_MEDIA_MAX_BYTES && STUDIO_MEDIA_MIMES.includes(data.mimeType), 'STUDIO_MEDIA_ASSET_INVALID');
  return data;
}
export function validateStudioMediaReferences(data, lookupBlob) {
  const blob = lookupBlob(data.assetHash);
  need(blob && blob.byteLength === data.byteLength && blob.mimeType === data.mimeType, 'STUDIO_MEDIA_BLOB_MISSING_OR_CHANGED');
}
