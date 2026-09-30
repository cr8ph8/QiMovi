import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { canonical, check, sha256, PilotError } from './storage.mjs';
import { MAX_MEDIA_UPLOAD_BYTES, MEDIA_RECORD_KINDS, validateMediaImportInput, validateRetainedMediaInput, validateMediaRecord, measurementFromProbe } from '../contracts/media-takes.mjs';
import { validateDreaminaDependencies } from './dreamina.mjs';
import { studioGenerationDetails } from '../contracts/studio-generation.mjs';
import { verifyDccMotionSource } from './dcc-motion.mjs';

const MAX_PROBE_BYTES = 8 * 1024 * 1024;
const requestHash = value => sha256(canonical(value));
const reviewId = take => `take-review:${take.sha256}`;
function savedTake(store, id, expectedHash) {
  const records = store.history(id), record = records[0];
  check(records.length === 1 && record?.kind === 'measured-media-take' && record.sha256 === expectedHash, 'MEDIA_TAKE_REFERENCE_CONFLICT', 409);
  validateMediaRecordReferences(store, record.kind, record.data, { id: record.id, version: record.version });
  return record;
}
function briefReference(store, data, current) {
  if (!data.briefRef) return;
  const records = store.history(data.briefRef.id);
  const brief = records.find(record => record.sha256 === data.briefRef.sha256);
  check(brief?.kind === 'generation-brief' && brief.data.sourceHash === data.sourceHash && brief.data.sceneId === data.sceneId && (data.shotId === null || brief.data.shotIds.includes(data.shotId)), 'MEDIA_BRIEF_REFERENCE_CONFLICT', 409);
  if (current) {
    check(records.at(-1).sha256 === brief.sha256, 'STALE_MEDIA_BRIEF', 409);
    validateDreaminaDependencies(brief.data, store.resolvedProject(), store.rawList(), store);
  }
}
function retainedMediaSource(store, ref, assetHash, current = false, target = null, measurement = null) {
  if (ref.id.startsWith('dcc-motion:')) return verifyDccMotionSource(store, ref, assetHash, { current, target, measurement });
  const history = store.history(ref.id), record = history.find(row => row.sha256 === ref.sha256);
  check(record && sha256(canonical(record.data)) === ref.sha256 && record.data.sourceHash === store.project().sourceHash, 'RETAINED_MEDIA_SOURCE_MISSING_OR_CHANGED', 409);
  if (current) check(history.at(-1).sha256 === ref.sha256, 'STALE_RETAINED_MEDIA_SOURCE', 409);
  if (record.kind === 'studio-generation') {
    check(record.data.projectId === store.project().id && record.data.provider === 'HIGGSFIELD_MCP' && ['COMPLETED', 'FAILED', 'RETAINED'].includes(record.data.phase), 'RETAINED_MEDIA_PROVIDER_MISMATCH', 409);
    const output = studioGenerationDetails(record.data.detailsJson).outputs?.find(row => row.sha256 === assetHash);
    check(output, 'RETAINED_MEDIA_OUTPUT_MISSING', 409);
    return { blob: { sha256: output.sha256, byteLength: output.byteLength, mimeType: output.mimeType }, originalFilename: output.filename, origin: 'RETAINED_PROVIDER_OUTPUT', providerProvenance: 'HIGGSFIELD_MCP_RECORD' };
  }
  check(record.kind === 'project-asset' && record.data.asset.sha256 === assetHash, 'RETAINED_MEDIA_ASSET_MISMATCH', 409);
  return { blob: record.data.asset, originalFilename: record.data.originalFilename, origin: 'RETAINED_PROJECT_ASSET', providerProvenance: 'UNVERIFIED' };
}
// Restore checks retained bytes and exact historical references. A historical
// brief becoming stale never rewrites measurement or the owner's review.
export function validateMediaRecordReferences(store, kind, data, { id, version, current = false, verifyMediaBytes = false } = {}) {
  if (!MEDIA_RECORD_KINDS.includes(kind)) return;
  validateMediaRecord(kind, data, store.project());
  if (kind === 'measured-media-take') {
    check(!id || id === `measured-media-take:${sha256(canonical(data))}`, 'MEDIA_RECORD_IDENTITY_MISMATCH', 409);
    check(!version || version === 1, 'MEASURED_MEDIA_IMMUTABLE', 409);
    briefReference(store, data, current);
    if (data.retainedSource) {
      const retained = retainedMediaSource(store, data.retainedSource, data.blob.sha256, current, data, data.measurement);
      check(canonical(retained.blob) === canonical(data.blob) && retained.originalFilename === data.originalFilename && retained.origin === data.origin && retained.providerProvenance === data.providerProvenance, 'RETAINED_MEDIA_BINDING_MISMATCH', 409);
    }
    const registered = store.db.prepare('SELECT * FROM blobs WHERE sha256=?').get(data.blob.sha256);
    check(registered && registered.byte_length === data.blob.byteLength && registered.mime_type === data.blob.mimeType, 'MEDIA_BLOB_BINDING_MISMATCH', 409);
    if (verifyMediaBytes) store.blobInfo(data.blob.sha256);
    const probe = store.blob(data.probe.outputSha256);
    check(probe.bytes.length <= MAX_PROBE_BYTES && probe.mimeType === 'application/json', 'MEDIA_PROBE_BLOB_INVALID', 409);
    let output; try { output = JSON.parse(probe.bytes.toString('utf8')); } catch { throw new PilotError('MEDIA_PROBE_BLOB_INVALID', 409); }
    check(canonical(measurementFromProbe(output, data.probe.toolIdentity)) === canonical(data.measurement), 'MEDIA_MEASUREMENT_EVIDENCE_MISMATCH', 409);
  } else {
    const take = savedTake(store, data.takeRef.id, data.takeRef.sha256);
    check(data.sceneId === take.data.sceneId && data.sourceHash === take.data.sourceHash && (!id || id === reviewId(take)), 'TAKE_REVIEW_BINDING_MISMATCH', 409);
    if (verifyMediaBytes) store.blobInfo(take.data.blob.sha256);
  }
}
async function hashFile(filename, signal) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename, { signal })) hash.update(chunk);
  return hash.digest('hex');
}
async function verifyMediaBytes(store, record, signal) {
  const filename = path.join(store.directory, 'blobs', record.data.blob.sha256);
  try {
    const stat = await fsp.lstat(filename);
    check(stat.isFile() && stat.size === record.data.blob.byteLength && await hashFile(filename, signal) === record.data.blob.sha256, 'MEDIA_BLOB_CORRUPT', 409);
  } catch (error) {
    if (error instanceof PilotError) throw error;
    throw new PilotError(signal?.aborted ? 'MEDIA_IMPORT_CANCELLED' : 'MEDIA_BLOB_CORRUPT', signal?.aborted ? 499 : 409);
  }
}
function mimeFromBytes(bytes) {
  if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp') return bytes.toString('ascii', 8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'video/webm';
  if (bytes.length >= 8 && ['wide', 'mdat', 'moov'].includes(bytes.toString('ascii', 4, 8))) return 'video/quicktime';
  throw new PilotError('MEDIA_CONTAINER_NOT_SUPPORTED', 415);
}
function probeFile(filename, { nativeProbe, ffprobe, signal, probeTimeoutMs }) {
  const toolIdentity = nativeProbe ? 'AVFOUNDATION' : 'FFPROBE';
  const executable = nativeProbe || ffprobe;
  const args = nativeProbe ? [filename] : ['-v', 'error', '-protocol_whitelist', 'file', '-count_frames', '-show_format', '-show_streams', '-of', 'json', filename];
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new PilotError('MEDIA_IMPORT_CANCELLED', 499));
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const chunks = []; let count = 0, stderrCount = 0, failure;
    const stop = error => { failure ??= error; child.kill('SIGKILL'); };
    const abort = () => stop(new PilotError('MEDIA_IMPORT_CANCELLED', 499));
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => stop(new PilotError('MEDIA_PROBE_TIMED_OUT', 422)), probeTimeoutMs);
    child.stdout.on('data', chunk => { count += chunk.length; if (count > MAX_PROBE_BYTES) stop(new PilotError('MEDIA_PROBE_OUTPUT_TOO_LARGE', 422)); else chunks.push(chunk); });
    child.stderr.on('data', chunk => { stderrCount += chunk.length; if (stderrCount > MAX_PROBE_BYTES) stop(new PilotError('MEDIA_PROBE_OUTPUT_TOO_LARGE', 422)); });
    child.once('error', error => { failure = new PilotError(error.code === 'ENOENT' ? 'MEDIA_PROBE_UNAVAILABLE' : 'MEDIA_PROBE_FAILED', 422); });
    child.once('close', code => {
      clearTimeout(timeout); signal.removeEventListener('abort', abort);
      if (failure || code !== 0) return reject(failure || new PilotError('MEDIA_PROBE_FAILED', 422));
      try {
        const bytes = Buffer.concat(chunks), output = JSON.parse(bytes.toString('utf8'));
        resolve({ toolIdentity, bytes, measurement: measurementFromProbe(output, toolIdentity) });
      } catch { reject(new PilotError('MEDIA_PROBE_INVALID_RESULT', 422)); }
    });
  });
}
export function createMediaIntake(store, { nativeProbe = process.env.FILMSTACK_MEDIA_PROBE, ffprobe = process.env.FILMSTACK_FFPROBE || 'ffprobe', maxUploadBytes = MAX_MEDIA_UPLOAD_BYTES, maxConcurrent = 2, probeTimeoutMs = 120000 } = {}) {
  check(Number.isInteger(maxUploadBytes) && maxUploadBytes > 0 && maxUploadBytes <= MAX_MEDIA_UPLOAD_BYTES, 'INVALID_MEDIA_UPLOAD_LIMIT');
  check(Number.isInteger(maxConcurrent) && maxConcurrent > 0 && maxConcurrent <= 2, 'INVALID_MEDIA_CONCURRENCY');
  const activeImports = new Map();
  let closing = false, closePromise;
  return {
    maxUploadBytes,
    close() {
      closing = true;
      return closePromise ??= (async () => {
        const imports = [...activeImports.values()];
        for (const operation of imports) operation.cancel();
        await Promise.all(imports.map(operation => operation.completed));
      })();
    },
    async measureRetained(input, { signal: externalSignal } = {}) {
      check(!closing, 'MEDIA_INTAKE_CLOSING', 503);
      check(!externalSignal?.aborted, 'MEDIA_IMPORT_CANCELLED', 499);
      validateRetainedMediaInput(input, store.project());
      const fingerprint = requestHash({ service: 'retained-media-intake/v1', input });
      const result = record => ({ record, review: store.rawList('take-review').find(row => row.id === reviewId(record)) ?? null, mediaUrl: `/api/blobs/${record.data.blob.sha256}` });
      const existingAssociation = () => store.rawList('measured-media-take').find(row => row.data.sourceHash === input.sourceHash && row.data.sceneId === input.sceneId && row.data.shotId === input.shotId && row.data.blob.sha256 === input.assetHash && canonical(row.data.briefRef) === canonical(input.briefRef) && row.data.retainedSource && canonical(row.data.retainedSource) === canonical(input.retainedSource));
      const rememberAssociation = record => {
        const previous = store.replayMediaRequest(input.requestId, fingerprint);
        if (previous) return { ...result(previous), replayed: true };
        // A second navigation attempt reuses the immutable measured record while
        // still binding its request ID. No second take or duplicated media bytes.
        store.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(input.requestId, fingerprint, canonical(record));
        return { ...result(record), replayed: true };
      };
      const replay = store.replayMediaRequest(input.requestId, fingerprint);
      if (replay) { savedTake(store, replay.id, replay.sha256); await verifyMediaBytes(store, replay); return { ...result(replay), replayed: true }; }
      check(activeImports.size < maxConcurrent, 'MEDIA_IMPORT_BUSY', 429);
      const retained = retainedMediaSource(store, input.retainedSource, input.assetHash, true, input);
      check(['video/mp4', 'video/quicktime', 'video/webm'].includes(retained.blob.mimeType) && retained.blob.byteLength <= maxUploadBytes, 'RETAINED_MEDIA_VIDEO_REQUIRED', 422);
      briefReference(store, input, true);
      const prior = existingAssociation();
      if (prior) { savedTake(store, prior.id, prior.sha256); await verifyMediaBytes(store, prior); return rememberAssociation(prior); }
      const signalController = new AbortController(), signal = signalController.signal;
      const abortExternal = () => signalController.abort();
      externalSignal?.addEventListener('abort', abortExternal, { once: true });
      if (externalSignal?.aborted) signalController.abort();
      let complete; const completed = new Promise(resolve => { complete = resolve; });
      activeImports.set(signalController, { completed, cancel() { signalController.abort(); } });
      const probeTemp = path.join(store.directory, 'blobs', `media-probe-${crypto.randomUUID()}.tmp`);
      try {
        const blob = store.blobInfo(input.assetHash);
        check(blob.byteLength === retained.blob.byteLength && blob.mimeType === retained.blob.mimeType, 'MEDIA_BLOB_BINDING_MISMATCH', 409);
        const probe = await probeFile(blob.filename, { nativeProbe, ffprobe, signal, probeTimeoutMs });
        check(await hashFile(blob.filename, signal) === input.assetHash, 'MEDIA_CHANGED_DURING_MEASUREMENT', 409);
        check(!signal.aborted, 'MEDIA_IMPORT_CANCELLED', 499);
        retainedMediaSource(store, input.retainedSource, input.assetHash, true, input, probe.measurement); briefReference(store, input, true);
        const concurrent = existingAssociation();
        if (concurrent) { savedTake(store, concurrent.id, concurrent.sha256); return rememberAssociation(concurrent); }
        const outputHash = sha256(probe.bytes);
        await fsp.writeFile(probeTemp, probe.bytes, { flag: 'wx', mode: 0o600 });
        check(!signal.aborted, 'MEDIA_IMPORT_CANCELLED', 499);
        retainedMediaSource(store, input.retainedSource, input.assetHash, true, input, probe.measurement);
        const probeBlob = store.putBlob(probeTemp, 'application/json', { sha256: outputHash, byteLength: probe.bytes.length, maxBytes: MAX_PROBE_BYTES });
        const { requestId, assetHash, ...metadata } = input;
        const data = { schemaVersion: 1, ...metadata, ...retained, measurement: probe.measurement, measuredAt: new Date().toISOString(), probe: { toolIdentity: probe.toolIdentity, outputSha256: probeBlob.sha256 } };
        const record = store.saveMediaRecord(`measured-media-take:${sha256(canonical(data))}`, { kind: 'measured-media-take', requestId, expectedVersion: null, data }, fingerprint);
        return { ...result(record), replayed: record.replayed };
      } finally { externalSignal?.removeEventListener('abort', abortExternal); await fsp.unlink(probeTemp).catch(() => {}); activeImports.delete(signalController); complete(); }
    },
    async import(req, res) {
      check(!closing, 'MEDIA_INTAKE_CLOSING', 503);
      check(req.headers['content-type']?.split(';')[0].trim() === 'application/octet-stream', 'MEDIA_BINARY_REQUIRED', 415);
      check(!req.headers['content-encoding'] || req.headers['content-encoding'] === 'identity', 'MEDIA_ENCODING_NOT_SUPPORTED', 415);
      let input;
      try { check(typeof req.headers['x-media-intake'] === 'string' && req.headers['x-media-intake'].length <= 8192, 'MEDIA_METADATA_REQUIRED'); input = JSON.parse(decodeURIComponent(req.headers['x-media-intake'])); }
      catch { throw new PilotError('MEDIA_METADATA_INVALID'); }
      try { validateMediaImportInput(input, store.project()); } catch (error) { throw new PilotError(error.code, error.status); }
      const declared = req.headers['content-length'];
      if (declared !== undefined) check(/^\d+$/.test(declared) && Number(declared) > 0 && Number(declared) <= maxUploadBytes, 'MEDIA_UPLOAD_TOO_LARGE', 413);
      check(activeImports.size < maxConcurrent, 'MEDIA_IMPORT_BUSY', 429);
      const signalController = new AbortController(), signal = signalController.signal;
      const abort = () => signalController.abort();
      let complete;
      const completed = new Promise(resolve => { complete = resolve; });
      activeImports.set(signalController, { completed, cancel() { abort(); req.destroy(); res.destroy(); } });
      req.once('aborted', abort); res.once('close', abort);
      const temp = path.join(store.directory, 'blobs', `media-upload-${crypto.randomUUID()}.tmp`);
      let handle, byteLength = 0, prefix = Buffer.alloc(0); const hasher = crypto.createHash('sha256'), createdFiles = [];
      try {
        handle = await fsp.open(temp, 'wx', 0o600);
        for await (const chunk of req.iterator({ destroyOnReturn: false })) {
          check(!signal.aborted, 'MEDIA_IMPORT_CANCELLED', 499);
          byteLength += chunk.length; check(byteLength <= maxUploadBytes, 'MEDIA_UPLOAD_TOO_LARGE', 413);
          if (prefix.length < 16) prefix = Buffer.concat([prefix, chunk.subarray(0, 16 - prefix.length)]);
          hasher.update(chunk); await handle.writeFile(chunk);
        }
        check(byteLength > 0 && (!declared || byteLength === Number(declared)), 'MEDIA_UPLOAD_INCOMPLETE', 400);
        await handle.sync(); await handle.close(); handle = null;
        const assetHash = hasher.digest('hex'), mimeType = mimeFromBytes(prefix);
        const fingerprint = requestHash({ service: 'media-intake/v1', input, assetHash, byteLength });
        const replay = store.replayMediaRequest(input.requestId, fingerprint);
        if (replay) {
          savedTake(store, replay.id, replay.sha256);
          await verifyMediaBytes(store, replay, signal);
          return { record: replay, review: store.rawList('take-review').find(record => record.id === reviewId(replay)) ?? null, mediaUrl: `/api/blobs/${assetHash}`, replayed: true };
        }
        briefReference(store, input, true);
        const probe = await probeFile(temp, { nativeProbe, ffprobe, signal, probeTimeoutMs });
        check(await hashFile(temp, signal) === assetHash, 'MEDIA_CHANGED_DURING_MEASUREMENT', 409);
        check(!signal.aborted, 'MEDIA_IMPORT_CANCELLED', 499);
        const outputHash = sha256(probe.bytes), probeTemp = path.join(store.directory, 'blobs', `media-probe-${crypto.randomUUID()}.tmp`);
        await fsp.writeFile(probeTemp, probe.bytes, { flag: 'wx', mode: 0o600 }); createdFiles.push(probeTemp);
        const pending = [{ filename: temp, sha256: assetHash, byteLength, mimeType }, { filename: probeTemp, sha256: outputHash, byteLength: probe.bytes.length, mimeType: 'application/json' }];
        // Only completed, hashed files are moved into content-addressed storage.
        for (const blob of pending) {
          const destination = path.join(store.directory, 'blobs', blob.sha256);
          try { await fsp.link(blob.filename, destination); createdFiles.push(destination); }
          catch (error) { if (error.code !== 'EEXIST') throw error; check((await fsp.lstat(destination)).isFile() && await hashFile(destination, signal) === blob.sha256, 'MEDIA_BLOB_CORRUPT', 409); }
        }
        check(!signal.aborted, 'MEDIA_IMPORT_CANCELLED', 499);
        const { requestId, ...metadata } = input;
        const data = { schemaVersion: 1, ...metadata, origin: 'IMPORTED_USER_MEDIA', providerProvenance: 'UNVERIFIED', blob: { sha256: assetHash, byteLength, mimeType },
          measurement: probe.measurement, measuredAt: new Date().toISOString(), probe: { toolIdentity: probe.toolIdentity, outputSha256: outputHash } };
        const record = store.saveMediaRecord(`measured-media-take:${sha256(canonical(data))}`, { kind: 'measured-media-take', requestId, expectedVersion: null, data }, fingerprint, pending);
        return { record, review: null, mediaUrl: `/api/blobs/${assetHash}`, replayed: record.replayed };
      } finally {
        try {
          req.removeListener('aborted', abort); res.removeListener('close', abort);
          if (!req.complete) req.resume();
          await handle?.close().catch(() => {});
          await fsp.unlink(temp).catch(() => {});
          for (const filename of createdFiles) {
            const hash = path.basename(filename);
            if (!store.db.prepare('SELECT 1 FROM blobs WHERE sha256=?').get(hash)) await fsp.unlink(filename).catch(() => {});
          }
        } finally {
          activeImports.delete(signalController);
          complete();
        }
      }
    },
  };
}
export async function listMediaTakes(store, sceneId, maxUploadBytes = MAX_MEDIA_UPLOAD_BYTES) {
  check(store.project().scenes.some(scene => scene.id === sceneId), 'MEDIA_SCENE_MISMATCH', 404);
  const reviews = store.rawList('take-review');
  const takes = [];
  for (const record of store.rawList('measured-media-take').filter(record => record.data.sceneId === sceneId)) {
    check(sha256(canonical(record.data)) === record.sha256, 'MEDIA_RECORD_HASH_MISMATCH', 409);
    validateMediaRecordReferences(store, record.kind, record.data, { id: record.id, version: record.version });
    await verifyMediaBytes(store, record);
    const review = reviews.find(value => value.id === reviewId(record)) ?? null;
    if (review) {
      check(sha256(canonical(review.data)) === review.sha256, 'MEDIA_REVIEW_HASH_MISMATCH', 409);
      validateMediaRecordReferences(store, review.kind, review.data, { id: review.id });
    }
    takes.push({ record, review, mediaUrl: `/api/blobs/${record.data.blob.sha256}` });
  }
  return { schemaVersion: 'filmstack-media-takes/v1', sourceHash: store.project().sourceHash, sceneId, maxUploadBytes, takes,
    legacyTakes: store.rawList('media-take') };
}
export async function reviewMediaTake(store, takeId, input) {
  check(input && Object.keys(input).sort().join(',') === 'decision,expectedVersion,note,requestId,takeSha256', 'INVALID_TAKE_REVIEW_REQUEST');
  check(typeof input.requestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(input.requestId), 'INVALID_MEDIA_REQUEST_ID');
  const fingerprint = requestHash({ service: 'take-review/v1', takeId, input });
  const take = savedTake(store, takeId, input.takeSha256);
  await verifyMediaBytes(store, take);
  const replay = store.replayMediaRequest(input.requestId, fingerprint);
  if (replay) return replay;
  const data = { schemaVersion: 1, sourceHash: take.data.sourceHash, sceneId: take.data.sceneId, takeRef: { id: take.id, sha256: take.sha256 },
    decision: input.decision, note: input.note, actor: 'local-owner', scope: 'CANDIDATE_PREFERENCE_ONLY', reviewedAt: new Date().toISOString() };
  return store.saveMediaRecord(reviewId(take), { kind: 'take-review', expectedVersion: input.expectedVersion, requestId: input.requestId, data }, fingerprint);
}
