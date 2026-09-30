export const FRAME_MAX_BYTES = 32 * 1024 * 1024;
export const FRAME_MAX_PIXELS = 40 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (value, code) => { if (!value) throw Object.assign(new Error(code), { code, status: 422 }); };
const shape = (value, fields) => need(object(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(','), 'FRAME_FIELDS_INVALID');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value);
const pixels = value => Number.isSafeInteger(value) && value > 0 && value <= 20000;
export function validateFrameCrop(crop) {
  shape(crop, ['x', 'y', 'width', 'height']);
  need(Number.isSafeInteger(crop.x) && Number.isSafeInteger(crop.y) && crop.x >= 0 && crop.y >= 0 && pixels(crop.width) && pixels(crop.height) && crop.width * crop.height <= FRAME_MAX_PIXELS, 'FRAME_CROP_INVALID');
}
function ref(value) {
  if (value === null) return;
  shape(value, ['id', 'version', 'sha256']);
  need(typeof value.id === 'string' && /^storyboard-cell:[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value.id) && Number.isSafeInteger(value.version) && value.version > 0 && digest(value.sha256), 'FRAME_RECORD_REFERENCE_INVALID');
}
export function validateFrameExtractionRequest(input) {
  shape(input, ['requestId', 'projectId', 'sourceHash', 'cellId', 'expectedCellSha256', 'expectedRecordRef', 'imageHash', 'crop']);
  need(id(input.requestId) && id(input.projectId) && id(input.cellId) && digest(input.sourceHash) && digest(input.expectedCellSha256) && digest(input.imageHash), 'FRAME_REQUEST_INVALID');
  ref(input.expectedRecordRef); validateFrameCrop(input.crop);
  need(input.expectedRecordRef === null || input.expectedRecordRef.id === `storyboard-cell:${input.cellId}`, 'FRAME_RECORD_REFERENCE_INVALID');
  return input;
}
export function validateFrameExtraction(data, project) {
  shape(data, ['schemaVersion', 'projectId', 'sourceHash', 'cellId', 'parent', 'originalCell', 'originalCellSha256', 'originalRecordRef', 'image', 'engine', 'scope', 'review']);
  need(data.schemaVersion === 1 && id(data.projectId) && digest(data.sourceHash) && id(data.cellId) && (!project || data.projectId === project.id && data.sourceHash === project.sourceHash), 'FRAME_PROJECT_MISMATCH');
  need(data.scope === 'INTERNAL_STORYBOARD_REFERENCE_ONLY' && data.review === 'PENDING', 'FRAME_AUTHORITY_INVALID');
  shape(data.parent, ['imageHash', 'byteLength', 'mimeType', 'pixelWidth', 'pixelHeight', 'crop']);
  shape(data.image, ['sha256', 'byteLength', 'mimeType', 'pixelWidth', 'pixelHeight']);
  for (const image of [data.parent, data.image]) need(Number.isSafeInteger(image.byteLength) && image.byteLength > 0 && image.byteLength <= FRAME_MAX_BYTES && pixels(image.pixelWidth) && pixels(image.pixelHeight) && image.pixelWidth * image.pixelHeight <= FRAME_MAX_PIXELS, 'FRAME_IMAGE_INVALID');
  need(digest(data.parent.imageHash) && ['image/png', 'image/jpeg'].includes(data.parent.mimeType) && digest(data.image.sha256) && data.image.mimeType === 'image/png', 'FRAME_IMAGE_INVALID');
  validateFrameCrop(data.parent.crop);
  need(data.parent.crop.x + data.parent.crop.width <= data.parent.pixelWidth && data.parent.crop.y + data.parent.crop.height <= data.parent.pixelHeight && data.image.pixelWidth === data.parent.crop.width && data.image.pixelHeight === data.parent.crop.height, 'FRAME_CROP_BOUNDS_INVALID');
  need(object(data.originalCell) && data.originalCell.id === data.cellId && data.originalCell.imageHash === data.parent.imageHash && digest(data.originalCellSha256), 'FRAME_ORIGINAL_CELL_INVALID');
  ref(data.originalRecordRef);
  need(data.originalRecordRef === null || data.originalRecordRef.id === `storyboard-cell:${data.cellId}`, 'FRAME_RECORD_REFERENCE_INVALID');
  shape(data.engine, ['name', 'version']);
  need(data.engine.name === 'macOS sips' && typeof data.engine.version === 'string' && /^sips-[0-9.]+$/.test(data.engine.version), 'FRAME_ENGINE_INVALID');
  return data;
}
