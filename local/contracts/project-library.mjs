import { isCreativeProject, validateCreativeProject, projectOwnedContext } from './creative-project.mjs';

export const PROJECT_ASSET_LIMITS = Object.freeze({ bytes: 1024 ** 3, sourcePaths: 32, manifestEntries: 2000, batchBytes: 20 * 1024 ** 3 });
export const ASSET_CURATION_LIMITS = Object.freeze({ tags: 24, tagCharacters: 60, notes: 8000, scenes: 100 });
export const PROJECT_LIBRARY_SEARCH_LIMITS = Object.freeze({ query: 160, results: 50, snippet: 360, sources: 500, pages: 20000, extractionBytes: 64 * 1024 ** 2, originalBytes: 512 * 1024 ** 2 });
export const PROJECT_ASSET_MIMES = Object.freeze({
  DOCUMENT: ['application/pdf', 'application/rtf', 'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet', 'application/vnd.oasis.opendocument.presentation'],
  TEXT: ['text/plain', 'application/xml', 'application/json'],
  IMAGE: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/tiff', 'image/vnd.adobe.photoshop', 'image/svg+xml'],
  AUDIO: ['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/ogg', 'audio/mp4'],
  VIDEO: ['video/mp4', 'video/quicktime', 'video/webm'],
  THREE_D: ['model/gltf-binary', 'model/gltf+json', 'application/x-blender', 'application/x-fbx', 'model/obj', 'model/vnd.usd'],
  ARCHIVE: ['application/zip', 'application/gzip', 'application/x-7z-compressed', 'application/vnd.rar', 'application/x-tar'],
  OPAQUE: ['application/octet-stream'],
});
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (value, code) => { if (!value) throw Object.assign(new Error(code), { code, status: 422 }); };
const shape = (value, keys) => need(object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','), 'PROJECT_ASSET_FIELDS_INVALID');
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && value.isWellFormed() && !/[\x00-\x1f\x7f]/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function validateProjectScope(data, project, code) {
  project = projectOwnedContext(project, data?.scope === 'PROJECT_ORGANIZATION' ? 'asset-curation' : 'project-asset', data);
  if (data.schemaVersion === 2) {
    // A null source alone is never an identity. Development references require
    // the complete creative workspace and its exact project id.
    need(data.sourceHash === null && isCreativeProject(project), code);
    validateCreativeProject(project);
    need(data.projectId === project.id, code);
  } else {
    need(data.schemaVersion === 1 && digest(data.sourceHash) && (!project || data.sourceHash === project.sourceHash), code);
  }
}
export function validateProjectCollectionPath(value) {
  need(text(value, 2048) && !value.startsWith('/') && !value.includes('\\') && value.split('/').every(part => part && part !== '.' && part !== '..'), 'PROJECT_ASSET_COLLECTION_PATH_INVALID');
  return value;
}
export function validateProjectAsset(data, project) {
  shape(data, ['schemaVersion', 'sourceHash', 'title', 'originalFilename', 'asset', 'family', 'category', 'collection', 'sourcePaths', 'collectionPath', 'scope', 'review', ...(data?.schemaVersion === 2 ? ['projectId'] : [])]);
  validateProjectScope(data, project, 'PROJECT_ASSET_SOURCE_MISMATCH');
  need(data.scope === 'PROJECT_REFERENCE' && data.review === 'PENDING', 'PROJECT_ASSET_AUTHORITY_INVALID');
  need(text(data.title, 240) && text(data.category, 120) && text(data.collection, 120), 'PROJECT_ASSET_LABEL_INVALID');
  need(text(data.originalFilename, 255) && !/[\/\\]/.test(data.originalFilename) && !['.', '..'].includes(data.originalFilename), 'PROJECT_ASSET_FILENAME_INVALID');
  shape(data.asset, ['sha256', 'byteLength', 'mimeType']);
  need(digest(data.asset.sha256) && Number.isSafeInteger(data.asset.byteLength) && data.asset.byteLength > 0 && data.asset.byteLength <= PROJECT_ASSET_LIMITS.bytes, 'PROJECT_ASSET_BYTES_INVALID');
  need(Object.hasOwn(PROJECT_ASSET_MIMES, data.family) && PROJECT_ASSET_MIMES[data.family].includes(data.asset.mimeType), 'PROJECT_ASSET_MIME_INVALID');
  need(Array.isArray(data.sourcePaths) && data.sourcePaths.length > 0 && data.sourcePaths.length <= PROJECT_ASSET_LIMITS.sourcePaths && new Set(data.sourcePaths).size === data.sourcePaths.length, 'PROJECT_ASSET_ORIGINS_INVALID');
  for (const value of data.sourcePaths) need(text(value, 2048) && value.startsWith('/') && !value.includes('\\') && value.slice(1).split('/').every(part => part && part !== '.' && part !== '..'), 'PROJECT_ASSET_ORIGIN_PATH_INVALID');
  validateProjectCollectionPath(data.collectionPath);
  return data;
}

export function validateAssetCuration(data, project) {
  shape(data, ['schemaVersion', 'sourceHash', 'assetRef', 'displayTitle', 'tags', 'notes', 'organizationStatus', 'sceneIds', 'scope', ...(data?.schemaVersion === 2 ? ['projectId'] : [])]);
  validateProjectScope(data, project, 'ASSET_CURATION_SOURCE_MISMATCH');
  shape(data.assetRef, ['id', 'sha256']);
  need(/^project-asset:[a-f0-9]{64}$/.test(data.assetRef.id) && digest(data.assetRef.sha256), 'ASSET_CURATION_REFERENCE_INVALID');
  need(data.scope === 'PROJECT_ORGANIZATION' && ['INBOX', 'SHORTLIST', 'ARCHIVED'].includes(data.organizationStatus), 'ASSET_CURATION_AUTHORITY_INVALID');
  need(text(data.displayTitle, 240), 'ASSET_CURATION_TITLE_INVALID');
  need(Array.isArray(data.tags) && data.tags.length <= ASSET_CURATION_LIMITS.tags && data.tags.every(tag => text(tag, ASSET_CURATION_LIMITS.tagCharacters) && tag.trim() === tag) && new Set(data.tags.map(tag => tag.toLowerCase())).size === data.tags.length, 'ASSET_CURATION_TAGS_INVALID');
  need(typeof data.notes === 'string' && data.notes.isWellFormed() && data.notes.length <= ASSET_CURATION_LIMITS.notes && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(data.notes), 'ASSET_CURATION_NOTES_INVALID');
  need(Array.isArray(data.sceneIds) && data.sceneIds.length <= ASSET_CURATION_LIMITS.scenes && new Set(data.sceneIds).size === data.sceneIds.length && data.sceneIds.every(id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(id) && (!project || project.scenes.some(scene => scene.id === id))), 'ASSET_CURATION_SCENES_INVALID');
  return data;
}
