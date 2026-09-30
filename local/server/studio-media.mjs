import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { check } from './storage.mjs';
import { validateCreativeProject, projectOwnedContext } from '../contracts/creative-project.mjs';
import { STUDIO_MEDIA_MAX_BYTES, STUDIO_MEDIA_MIMES, validateStudioMedia } from '../contracts/studio-media.mjs';

const entry = record => ({ id: record.id, sha256: record.data.assetHash, originalFilename: record.data.originalFilename,
  mimeType: record.data.mimeType, byteLength: record.data.byteLength, status: record.data.status });

/** Container signatures protect intake from obvious mismatches; they are not playback QC. */
export function matchesStudioMediaContainer(bytes, mime) {
  const ascii = (start, end) => bytes.subarray(start, end).toString('ascii');
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (mime === 'audio/wav') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE';
  if (mime === 'audio/mpeg') return ascii(0, 3) === 'ID3' || bytes.length >= 2 && bytes[0] === 255 && (bytes[1] & 224) === 224;
  if (mime === 'video/webm') return bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) && bytes.includes(Buffer.from('webm'));
  if (['video/mp4', 'video/quicktime'].includes(mime)) {
    if (bytes.length < 16 || ascii(4, 8) !== 'ftyp') return false;
    const brand = ascii(8, 12);
    return mime === 'video/quicktime' ? brand === 'qt  ' : ['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'MSNV', 'dash'].includes(brand);
  }
  return false;
}

export function createStudioMediaService(store) {
  let active = null, closing = false;
  const project = () => {
    const current = store.project();
    const value = projectOwnedContext(current, 'studio-media', { projectId: current.id, sourceHash: null });
    validateCreativeProject(value);
    return value;
  };
  function list() {
    const current = project();
    const records = store.rawList('studio-media');
    for (const record of records) store.validateSavedRecord(record);
    return { schemaVersion: 1, projectId: current.id, sourceHash: null, media: records.map(entry), maxUploadBytes: STUDIO_MEDIA_MAX_BYTES };
  }
  async function importMedia(req) {
    check(!closing, 'STUDIO_MEDIA_SERVICE_CLOSING', 503);
    check(!active, 'STUDIO_MEDIA_IMPORT_BUSY', 409);
    const current = project();
    check(req.headers['x-studio-project-id'] === current.id, 'STUDIO_MEDIA_PROJECT_MISMATCH', 409);
    const mimeType = req.headers['content-type'];
    check(typeof mimeType === 'string' && STUDIO_MEDIA_MIMES.includes(mimeType), 'STUDIO_MEDIA_TYPE_NOT_SUPPORTED', 415);
    const expectedHash = req.headers['x-studio-sha256'], declared = req.headers['x-studio-byte-length'];
    check(typeof expectedHash === 'string' && /^[a-f0-9]{64}$/.test(expectedHash) && typeof declared === 'string' && /^[1-9][0-9]*$/.test(declared), 'STUDIO_MEDIA_INTAKE_HEADERS_INVALID', 422);
    const expectedBytes = Number(declared);
    check(Number.isSafeInteger(expectedBytes) && expectedBytes <= STUDIO_MEDIA_MAX_BYTES, 'STUDIO_MEDIA_TOO_LARGE', 413);
    if (req.headers['content-length']) check(req.headers['content-length'] === declared, 'STUDIO_MEDIA_LENGTH_MISMATCH', 422);
    let originalFilename;
    check(typeof req.headers['x-studio-filename'] === 'string' && req.headers['x-studio-filename'].length <= 2400, 'STUDIO_MEDIA_FILENAME_INVALID', 422);
    try { originalFilename = decodeURIComponent(req.headers['x-studio-filename']); } catch { check(false, 'STUDIO_MEDIA_FILENAME_INVALID', 422); }
    const data = { schemaVersion: 1, projectId: current.id, sourceHash: null, originalFilename, assetHash: expectedHash, byteLength: expectedBytes, mimeType, status: 'REFERENCE_UNREVIEWED' };
    validateStudioMedia(data, current);
    const filename = path.join(store.directory, 'blobs', `studio-intake-${crypto.randomUUID()}.tmp`);
    let finished;
    const done = new Promise(resolve => { finished = resolve; });
    active = { req, done };
    let fd;
    try {
      fd = fs.openSync(filename, 'wx', 0o600);
      let byteLength = 0, prefix = Buffer.alloc(0);
      const hash = crypto.createHash('sha256');
      for await (const chunk of req) {
        check(!closing, 'STUDIO_MEDIA_IMPORT_INTERRUPTED', 409);
        byteLength += chunk.length;
        check(byteLength <= expectedBytes && byteLength <= STUDIO_MEDIA_MAX_BYTES, 'STUDIO_MEDIA_TOO_LARGE', 413);
        if (prefix.length < 4096) prefix = Buffer.concat([prefix, chunk.subarray(0, 4096 - prefix.length)]);
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.length) offset += fs.writeSync(fd, chunk, offset, chunk.length - offset);
      }
      check(!closing && !req.aborted && req.complete, 'STUDIO_MEDIA_IMPORT_INTERRUPTED', 409);
      check(byteLength === expectedBytes && hash.digest('hex') === expectedHash, 'STUDIO_MEDIA_BYTES_MISMATCH', 422);
      check(matchesStudioMediaContainer(prefix, mimeType), 'STUDIO_MEDIA_CONTAINER_MISMATCH', 415);
      fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      const id = `studio-media:${expectedHash}`;
      const prior = store.rawList('studio-media').find(record => record.id === id);
      if (prior) {
        store.validateSavedRecord(prior);
        check(prior.data.mimeType === mimeType && prior.data.byteLength === byteLength, 'STUDIO_MEDIA_EXISTING_METADATA_CONFLICT', 409);
        return { schemaVersion: 1, projectId: current.id, sourceHash: null, media: entry(prior), replayed: true };
      }
      store.putBlob(filename, mimeType, { sha256: expectedHash, byteLength, maxBytes: STUDIO_MEDIA_MAX_BYTES });
      const saved = store.save(id, { kind: 'studio-media', expectedVersion: null, requestId: crypto.randomUUID(), data });
      return { schemaVersion: 1, projectId: current.id, sourceHash: null, media: entry(saved), replayed: false };
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      // Only the disposable stream buffer is removed; owned blobs remain retained.
      if (fs.existsSync(filename)) fs.unlinkSync(filename);
      active = null; finished();
    }
  }
  return { list, import: importMedia, async close() {
    closing = true;
    if (active) { const current = active; current.req.destroy(); await current.done; }
  } };
}
