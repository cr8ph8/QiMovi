import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonical, check, sha256 } from './storage.mjs';
import { FRAME_MAX_BYTES, FRAME_MAX_PIXELS, validateFrameExtractionRequest, validateFrameExtraction } from '../contracts/storyboard-frame.mjs';

const run = promisify(execFile), equal = (a, b) => canonical(a) === canonical(b);
const metadata = (bytes, mimeType, width, height) => ({ sha256: sha256(bytes), byteLength: bytes.length, mimeType, pixelWidth: width, pixelHeight: height });
function pngSize(bytes) {
  check(bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.readUInt32BE(8) === 13 && bytes.subarray(12,16).toString() === 'IHDR', 'FRAME_PNG_INVALID', 422);
  let offset = 8, end = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.subarray(offset + 4, offset + 8).toString();
    check(offset + length + 12 <= bytes.length && type !== 'acTL', 'FRAME_PNG_INVALID_OR_ANIMATED', 422);
    offset += length + 12;
    if (type === 'IEND') { end = length === 0 && offset === bytes.length; break; }
  }
  check(end, 'FRAME_PNG_INVALID', 422);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Native pixel extraction; no model, upload, rescale or orientation guess. */
export async function extractLocalFrame({ inputPath, outputPath, mimeType, crop, width, height }, options = {}) {
  const native = async args => {
    try { return (await run('/usr/bin/sips', args, { timeout: 30000, maxBuffer: 65536, signal: options.signal })).stdout; }
    catch (error) { check(false, error.code === 'ENOENT' ? 'FRAME_LOCAL_ENGINE_UNAVAILABLE' : error.name === 'AbortError' ? 'FRAME_EXTRACTION_INTERRUPTED' : 'FRAME_NATIVE_EXTRACTION_FAILED', 503); }
  };
  const info = await native(['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'format', '-g', 'orientation', inputPath]);
  const property = name => new RegExp(`^\\s+${name}: (.+)$`, 'm').exec(info)?.[1].trim();
  check(Number(property('pixelWidth')) === width && Number(property('pixelHeight')) === height && property('format') === (mimeType === 'image/png' ? 'png' : 'jpeg'), 'FRAME_SOURCE_DIMENSIONS_CHANGED', 409);
  check(['<nil>', '1'].includes(property('orientation')), 'FRAME_ORIENTATION_REQUIRES_NORMALIZATION', 422);
  const version = (await native(['--version'])).trim();
  await native(['--cropToHeightWidth', String(crop.height), String(crop.width), '--cropOffset', String(crop.y), String(crop.x), '-s', 'format', 'png', inputPath, '--out', outputPath]);
  const stat = fs.lstatSync(outputPath);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= FRAME_MAX_BYTES, 'FRAME_OUTPUT_INVALID', 422);
  const bytes = fs.readFileSync(outputPath), size = pngSize(bytes);
  check(size.width === crop.width && size.height === crop.height, 'FRAME_OUTPUT_DIMENSIONS_INVALID', 422);
  return { bytes, image: metadata(bytes, 'image/png', size.width, size.height), engine: { name: 'macOS sips', version } };
}

export function requireCurrentFrameCell(store, input) {
  const project = store.resolvedProject();
  check(project?.id === input.projectId && project.sourceHash === input.sourceHash, 'FRAME_SOURCE_CHANGED', 409);
  const cell = project.cells.find(row => row.id === input.cellId), record = store.rawList('storyboard-cell').find(row => row.data.cellId === input.cellId);
  check(cell && sha256(canonical(cell)) === input.expectedCellSha256 && equal(record ? { id: record.id, version: record.version, sha256: record.sha256 } : null, input.expectedRecordRef), 'FRAME_CELL_CHANGED', 409);
  if (record) store.validateSavedRecord(record);
  check(cell.imageHash === input.imageHash && equal(cell.crop ?? null, input.crop), 'FRAME_CROP_CHANGED', 409);
  check(!cell.originCameraRef && !cell.originDccReturnRef, 'FRAME_CAMERA_ORIGIN_PROTECTED', 409);
  check(Number.isSafeInteger(cell.pixelWidth) && Number.isSafeInteger(cell.pixelHeight) && cell.pixelWidth > 0 && cell.pixelHeight > 0 && cell.pixelWidth <= 20000 && cell.pixelHeight <= 20000 && cell.pixelWidth * cell.pixelHeight <= FRAME_MAX_PIXELS && input.crop.x + input.crop.width <= cell.pixelWidth && input.crop.y + input.crop.height <= cell.pixelHeight, 'FRAME_CROP_BOUNDS_INVALID', 422);
  const blob = store.blobInfo(input.imageHash);
  check(['image/png', 'image/jpeg'].includes(blob.mimeType), 'FRAME_IMAGE_TYPE_UNSUPPORTED', 415);
  check(blob.byteLength <= FRAME_MAX_BYTES, 'FRAME_IMAGE_TOO_LARGE', 413);
  return { project, cell, record, blob };
}

export function validateFrameExtractionReferences(store, record) {
  if (record.kind !== 'storyboard-frame-extraction') return;
  const data = record.data; validateFrameExtraction(data, store.project());
  check(record.version === 1 && record.id === `storyboard-frame-extraction:${sha256(canonical(data))}` && sha256(canonical(data.originalCell)) === data.originalCellSha256, 'FRAME_PROVENANCE_INVALID', 409);
  const original = data.originalRecordRef ? store.history(data.originalRecordRef.id).find(row => row.version === data.originalRecordRef.version && row.sha256 === data.originalRecordRef.sha256) : null;
  const source = original ? (() => { const { cellId, sourceHash, ...rest } = original.data; return { id: cellId, ...rest, review: 'PENDING', scope: 'INTERNAL_PREVISUALIZATION_ONLY', candidateRecordId: original.id, candidateVersion: original.version, candidateSha256: original.sha256 }; })() : store.project().cells.find(cell => cell.id === data.cellId);
  check((data.originalRecordRef === null || original) && equal(source, data.originalCell) && equal(data.originalCell.crop, data.parent.crop) && data.originalCell.pixelWidth === data.parent.pixelWidth && data.originalCell.pixelHeight === data.parent.pixelHeight, 'FRAME_ORIGINAL_HISTORY_CHANGED', 409);
  for (const item of [{ ...data.parent, sha256: data.parent.imageHash }, data.image]) {
    const blob = store.blobInfo(item.sha256);
    check(blob.byteLength === item.byteLength && blob.mimeType === item.mimeType, 'FRAME_BLOB_CHANGED', 409);
  }
}

export function createStoryboardFrameService(store, options = {}) {
  let active = null, closing = false;
  const controller = new AbortController();
  async function perform(input) {
    validateFrameExtractionRequest(input);
    const replay = store.replayStoryboardFrameExtraction(input); if (replay) return replay;
    const basis = requireCurrentFrameCell(store, input), source = store.blob(input.imageHash).bytes;
    if (basis.blob.mimeType === 'image/png') { const size = pngSize(source); check(size.width === basis.cell.pixelWidth && size.height === basis.cell.pixelHeight, 'FRAME_SOURCE_DIMENSIONS_CHANGED', 409); }
    else check(source.length >= 3 && source[0] === 255 && source[1] === 216 && source[2] === 255, 'FRAME_JPEG_INVALID', 422);
    const temporary = fs.mkdtempSync(path.join(store.directory, 'frame-extract-'));
    try {
      const inputPath = path.join(temporary, basis.blob.mimeType === 'image/png' ? 'source.png' : 'source.jpg'), outputPath = path.join(temporary, 'frame.png');
      fs.writeFileSync(inputPath, source, { mode: 0o600, flag: 'wx' });
      const extracted = await (options.extract ?? extractLocalFrame)({ inputPath, outputPath, mimeType: basis.blob.mimeType, crop: input.crop, width: basis.cell.pixelWidth, height: basis.cell.pixelHeight }, { signal: controller.signal });
      check(!closing, 'FRAME_EXTRACTION_INTERRUPTED', 409);
      check(extracted.bytes.length <= FRAME_MAX_BYTES && sha256(extracted.bytes) === extracted.image.sha256, 'FRAME_OUTPUT_INVALID', 422);
      const size = pngSize(extracted.bytes); check(size.width === input.crop.width && size.height === input.crop.height, 'FRAME_OUTPUT_DIMENSIONS_INVALID', 422);
      const image = metadata(extracted.bytes, 'image/png', size.width, size.height);
      const provenance = { schemaVersion: 1, projectId: input.projectId, sourceHash: input.sourceHash, cellId: input.cellId,
        parent: { imageHash: input.imageHash, byteLength: source.length, mimeType: basis.blob.mimeType, pixelWidth: basis.cell.pixelWidth, pixelHeight: basis.cell.pixelHeight, crop: input.crop },
        originalCell: basis.cell, originalCellSha256: input.expectedCellSha256, originalRecordRef: input.expectedRecordRef, image, engine: extracted.engine, scope: 'INTERNAL_STORYBOARD_REFERENCE_ONLY', review: 'PENDING' };
      validateFrameExtraction(provenance, basis.project);
      // Exact current basis is checked again inside the single append transaction.
      return store.commitStoryboardFrameExtraction(input, () => {
        const current = requireCurrentFrameCell(store, input);
        const draft = current.record ? structuredClone(current.record.data) : { sourceHash: input.sourceHash, cellId: current.cell.id, sceneId: current.cell.sceneId, shotId: current.cell.shotId, role: current.cell.role, description: current.cell.description, actionRefs: current.cell.actionRefs ?? [], plannedTimestampMs: current.cell.plannedTimestampMs ?? null, review: 'PENDING' };
        const cellData = { ...draft, imageHash: image.sha256, crop: null, pixelWidth: image.pixelWidth, pixelHeight: image.pixelHeight, review: 'PENDING' };
        const asset = { schemaVersion: 1, sourceHash: input.sourceHash, title: `Extracted storyboard frame · ${input.cellId}`.slice(0, 240), originalFilename: `frame-${image.sha256.slice(0,16)}.png`, asset: { sha256: image.sha256, byteLength: image.byteLength, mimeType: image.mimeType }, family: 'IMAGE', category: 'Extracted storyboard frames', collection: current.project.title.slice(0, 120), sourcePaths: [path.join(store.directory, 'blobs', image.sha256)], collectionPath: `Storyboard/Extracted frames/${image.sha256}.png`, scope: 'PROJECT_REFERENCE', review: 'PENDING' };
        return { image, bytes: extracted.bytes, asset, provenance, cellData };
      });
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }
  return {
    async extract(input) { check(!closing, 'FRAME_SERVICE_CLOSING', 503); check(!active, 'FRAME_EXTRACTION_BUSY', 409); active = perform(input); try { return await active; } finally { active = null; } },
    async close() { closing = true; controller.abort(); if (active) await active.catch(() => undefined); },
  };
}
