// Retained private derivative files. This record is not a publication, licence,
// visual acceptance, token issuance or ownership transfer.
export const COMIC_PACKAGE_KIND = 'comic-package';
export const COMIC_PACKAGE_MAX_BYTES = 96 * 1024 * 1024;
export const COMIC_PACKAGE_REQUEST_MAX_BYTES = 130 * 1024 * 1024;
export const COMIC_PACKAGE_FILE_LIMITS = Object.freeze({ PDF: 64 * 1024 * 1024, CBZ: 64 * 1024 * 1024, MANIFEST: 2 * 1024 * 1024 });
export const COMIC_PACKAGE_MIMES = Object.freeze({ PDF: 'application/pdf', CBZ: 'application/vnd.comicbook+zip', MANIFEST: 'application/json' });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (value, code) => { if (!value) throw Object.assign(new Error(code), { code, status: 422 }); };
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && value.isWellFormed() && !/[\x00-\x1f\x7f]/.test(value);
const exact = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

export function validateComicPackageIdentity(id, kind, data) {
  if (kind !== COMIC_PACKAGE_KIND && !id?.startsWith('comic-package:')) return;
  need(kind === COMIC_PACKAGE_KIND && typeof id === 'string' && /^comic-package:[a-f0-9]{64}$/.test(id), 'COMIC_PACKAGE_IDENTITY_INVALID');
  if (data) need(id === `comic-package:${data.manifestSha256}`, 'COMIC_PACKAGE_IDENTITY_INVALID');
}

export function validateComicPackage(data, project) {
  need(exact(data, ['schemaVersion', 'projectId', 'sourceHash', 'title', 'status', 'manifestSha256', 'files', 'parentAssetHashes', 'panelCount', 'pageCount', 'recordRefs', 'verification']), 'COMIC_PACKAGE_FIELDS_INVALID');
  need(data.schemaVersion === 1 && data.status === 'PRIVATE_DRAFT' && data.verification === 'SOURCE_BINDINGS_AND_CONTAINERS_ONLY', 'COMIC_PACKAGE_AUTHORITY_INVALID');
  need(text(data.projectId, 160) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(data.projectId) && digest(data.sourceHash), 'COMIC_PACKAGE_PROJECT_INVALID');
  if (project) need(project.id === data.projectId && project.sourceHash === data.sourceHash, 'COMIC_PACKAGE_PROJECT_MISMATCH');
  need(text(data.title, 240) && digest(data.manifestSha256), 'COMIC_PACKAGE_TITLE_OR_MANIFEST_INVALID');
  need(Number.isSafeInteger(data.panelCount) && data.panelCount >= 1 && data.panelCount <= 200 && Number.isSafeInteger(data.pageCount) && data.pageCount >= 1 && data.pageCount <= data.panelCount, 'COMIC_PACKAGE_COUNTS_INVALID');
  need(Array.isArray(data.files) && data.files.length === 3 && new Set(data.files.map(file => file.role)).size === 3, 'COMIC_PACKAGE_FILES_INVALID');
  let total = 0;
  for (const file of data.files) {
    need(exact(file, ['role', 'filename', 'mimeType', 'sha256', 'byteLength']) && Object.hasOwn(COMIC_PACKAGE_MIMES, file.role), 'COMIC_PACKAGE_FILE_FIELDS_INVALID');
    need(file.mimeType === COMIC_PACKAGE_MIMES[file.role] && digest(file.sha256) && Number.isSafeInteger(file.byteLength) && file.byteLength > 0 && file.byteLength <= COMIC_PACKAGE_FILE_LIMITS[file.role], 'COMIC_PACKAGE_FILE_INVALID');
    need(text(file.filename, 240) && !/[\\/]/.test(file.filename) && (file.role === 'MANIFEST' ? file.filename === 'comic-manifest.json' : file.filename.toLowerCase().endsWith(file.role === 'PDF' ? '.pdf' : '.cbz')), 'COMIC_PACKAGE_FILENAME_INVALID');
    total += file.byteLength;
  }
  need(total <= COMIC_PACKAGE_MAX_BYTES && new Set(data.files.map(file => file.filename)).size === 3 && data.files.find(file => file.role === 'MANIFEST').sha256 === data.manifestSha256, 'COMIC_PACKAGE_FILES_MISMATCH');
  need(Array.isArray(data.parentAssetHashes) && data.parentAssetHashes.length >= 1 && data.parentAssetHashes.length <= data.panelCount && data.parentAssetHashes.every(digest) && new Set(data.parentAssetHashes).size === data.parentAssetHashes.length, 'COMIC_PACKAGE_PARENT_ASSETS_INVALID');
  need(Array.isArray(data.recordRefs) && data.recordRefs.length <= 400 && new Set(data.recordRefs.map(ref => ref.id)).size === data.recordRefs.length, 'COMIC_PACKAGE_RECORD_REFS_INVALID');
  for (const ref of data.recordRefs) need(exact(ref, ['id', 'version', 'sha256']) && typeof ref.id === 'string' && /^(storyboard-cell|scene-plan):[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(ref.id) && ref.id.length <= 160 && Number.isSafeInteger(ref.version) && ref.version > 0 && digest(ref.sha256), 'COMIC_PACKAGE_RECORD_REF_INVALID');
  return data;
}

export function validateComicPackageReferences(data, lookupBlob, lookupRecord) {
  for (const file of data.files) {
    const blob = lookupBlob(file.sha256);
    need(blob && blob.mimeType === file.mimeType && blob.byteLength === file.byteLength, 'COMIC_PACKAGE_FILE_MISSING_OR_CHANGED');
  }
  need(lookupBlob(data.sourceHash)?.byteLength > 0, 'COMIC_PACKAGE_SOURCE_MISSING');
  for (const hash of data.parentAssetHashes) {
    const blob = lookupBlob(hash);
    need(blob && blob.byteLength > 0 && ['image/png', 'image/jpeg', 'image/webp'].includes(blob.mimeType), 'COMIC_PACKAGE_PARENT_MISSING_OR_CHANGED');
  }
  for (const ref of data.recordRefs) {
    // Validate before invoking history lookup: no comic self-reference or cycle.
    need(/^(storyboard-cell|scene-plan):/.test(ref.id), 'COMIC_PACKAGE_RECORD_REF_INVALID');
    const record = lookupRecord(ref);
    need(record && ['storyboard-cell', 'scene-plan'].includes(record.kind) && record.id === ref.id && record.version === ref.version && record.sha256 === ref.sha256 && record.data.sourceHash === data.sourceHash, 'COMIC_PACKAGE_RECORD_MISSING_OR_CHANGED');
  }
}
