import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { check, canonical, sha256 } from './storage.mjs';
import { DEFAULT_BLENDER_PATH } from './dcc-rehearsals.mjs';
import { loadDccStageReturnForMotion } from './dcc-stage-returns.mjs';
import { validateMediaRecord, measurementFromProbe } from '../contracts/media-takes.mjs';

const schemaVersion = 'qimovi-dcc-motion/v1';
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const activePhases = new Set(['QUEUED', 'RENDERING', 'MEASURING', 'STOPPING']);
const phases = new Set([...activePhases, 'RETAINED', 'STOPPED', 'FAILED', 'INTERRUPTED', 'EVIDENCE_MISSING']);
const maximumVideo = 256 * 1024 * 1024;
const scriptUrl = new URL('../integrations/three-d/blender-motion.py', import.meta.url);
const fail = code => Object.assign(new Error(code), { code, status: 409 });
const shape = (value, keys) => check(object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','), 'DCC_MOTION_INPUT_INVALID', 422);
const scopeInput = value => Object.fromEntries(['projectId', 'sourceHash', 'sceneId', 'shotId', 'returnReceiptSha256'].map(key => [key, value[key]]));
function directory(parent, name, create = false) {
  const filename = path.join(parent, name);
  if (create && !fs.existsSync(filename)) fs.mkdirSync(filename, { mode: 0o700 });
  const stat = fs.lstatSync(filename);
  check(stat.isDirectory() && !stat.isSymbolicLink(), 'DCC_MOTION_DIRECTORY_INVALID', 409);
  return filename;
}
function jobDirectory(store, jobId) {
  check(uuid(jobId), 'DCC_MOTION_JOB_INVALID', 422);
  return directory(directory(directory(store.directory, 'integrations'), 'dcc-motion'), jobId);
}
function fileInfo(filename, maximum) {
  const stat = fs.lstatSync(filename);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= maximum, 'DCC_MOTION_FILE_INVALID', 409);
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd), hash = crypto.createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    let count = 0, length;
    while ((length = fs.readSync(fd, buffer, 0, buffer.length, null))) { count += length; check(count <= maximum, 'DCC_MOTION_FILE_TOO_LARGE', 413); hash.update(buffer.subarray(0, length)); }
    const after = fs.fstatSync(fd);
    check(count === before.size && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs, 'DCC_MOTION_FILE_CHANGED', 409);
    return { sha256: hash.digest('hex'), byteLength: count };
  } finally { fs.closeSync(fd); }
}
function readJson(filename) {
  fileInfo(filename, 1024 * 1024);
  try { return JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { throw fail('DCC_MOTION_JSON_INVALID'); }
}
function immutable(filename, value) {
  const pending = `${filename}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(pending, canonical(value), { flag: 'wx', mode: 0o600 });
    const fd = fs.openSync(pending, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.linkSync(pending, filename);
  } finally { if (fs.existsSync(pending)) fs.unlinkSync(pending); }
}
function validateRenderReceipt(receipt, evidence, owned) {
  const preview = receipt.previewSettings, renderer = receipt.renderer, origin = owned.returned.origin;
  check(receipt.schemaVersion === 'caniscreenwrite-blender-motion-preview/v1' && receipt.classification === 'INTERNAL_PREVIS' && receipt.status === 'PENDING_REVIEW'
    && receipt.approvalGranted === false && receipt.finalMedia === false && receipt.measuredMediaDurationMs === null && receipt.mediaProbeRequired === true
    && receipt.rightsStatus === 'UNKNOWN' && receipt.sourceCoverage === 'NOT_ESTABLISHED', 'DCC_MOTION_RECEIPT_AUTHORITY_INVALID', 409);
  check(['projectId', 'sourceHash', 'sceneId', 'shotId', 'basisSha256', 'exchangeSha256', 'planFileSha256'].every(key => receipt[key] === origin[key])
    && receipt.kitFilesSha256 === owned.returned.kitFilesSha256 && receipt.inputScene?.sha256 === owned.sceneFile.sha256
    && receipt.inputScene.filename === owned.sceneFile.name && receipt.inputScene.unchanged === true, 'DCC_MOTION_RECEIPT_ORIGIN_MISMATCH', 409);
  check(renderer?.application === 'Blender' && typeof renderer.version === 'string' && renderer.version.length > 0 && renderer.version.length <= 120
    && renderer.scriptSha256 === evidence.scriptSha256 && renderer.engine === 'BLENDER_WORKBENCH' && renderer.codec === 'H264' && renderer.container === 'MPEG4' && renderer.audio === 'NONE', 'DCC_MOTION_RENDERER_MISMATCH', 409);
  check(preview && Number.isInteger(preview.width) && preview.width >= 2 && preview.width <= 960 && Number.isInteger(preview.height) && preview.height >= 2 && preview.height <= 540
    && Number.isInteger(preview.frameRate) && preview.frameRate >= 1 && preview.frameRate <= 120 && Number.isFinite(preview.frameRateBase) && preview.frameRateBase > 0 && preview.frameRateBase <= 100
    && preview.frameRate / preview.frameRateBase <= 120 && Array.isArray(preview.frameRange) && preview.frameRange.length === 2 && preview.frameRange.every(Number.isSafeInteger)
    && preview.frameRange[0] >= 0 && Number.isSafeInteger(preview.renderedFrameCount) && preview.renderedFrameCount >= 1 && preview.renderedFrameCount <= 4320
    && preview.frameRange[1] - preview.frameRange[0] + 1 === preview.renderedFrameCount && preview.everyFrameRendered === true, 'DCC_MOTION_FRAME_EVIDENCE_INVALID', 409);
  check(receipt.video?.filename === 'internal-previs.mp4' && receipt.video.mimeType === 'video/mp4' && receipt.video.sha256 === evidence.blob.sha256
    && receipt.video.byteLength === evidence.blob.byteLength, 'DCC_MOTION_VIDEO_MISMATCH', 409);
}

/** Used by the ordinary measured-take validator and backup/reopen verification.
 * The float-bearing Blender receipt remains raw, content-addressed JSON. */
export function verifyDccMotionSource(store, ref, assetHash, { current = false, target = null, measurement = null } = {}) {
  check(object(ref) && /^dcc-motion:/.test(ref.id) && digest(ref.sha256), 'DCC_MOTION_SOURCE_INVALID', 409);
  const jobId = ref.id.slice('dcc-motion:'.length), dir = jobDirectory(store, jobId), saved = readJson(path.join(dir, 'render-evidence.json'));
  const evidence = saved.body;
  check(object(evidence) && saved.sha256 === ref.sha256 && sha256(canonical(evidence)) === ref.sha256
    && evidence.schemaVersion === 'qimovi-dcc-motion-render/v1' && evidence.jobId === jobId && evidence.approvalGranted === false && evidence.finalMedia === false
    && digest(evidence.scriptSha256) && digest(evidence.runtimeSha256) && digest(evidence.motionReceiptSha256)
    && evidence.blob?.sha256 === assetHash && evidence.blob.mimeType === 'video/mp4' && Number.isSafeInteger(evidence.blob.byteLength)
    && evidence.blob.byteLength > 16 && evidence.blob.byteLength <= maximumVideo, 'DCC_MOTION_EVIDENCE_INVALID', 409);
  if (target) check(['sourceHash', 'sceneId', 'shotId'].every(key => evidence[key] === target[key]), 'DCC_MOTION_TAKE_SCOPE_MISMATCH', 409);
  const owned = loadDccStageReturnForMotion(store, evidence, { requireCurrent: current });
  check(fileInfo(path.join(dir, 'motion.py'), 1024 * 1024).sha256 === evidence.scriptSha256
    && fileInfo(path.join(dir, owned.sceneFile.name), 64 * 1024 * 1024).sha256 === owned.sceneFile.sha256, 'DCC_MOTION_INPUT_EVIDENCE_CHANGED', 409);
  const kitDir = directory(dir, 'kit');
  for (const file of owned.kit.files) check(fileInfo(path.join(kitDir, file.path), 4 * 1024 * 1024).sha256 === file.sha256, 'DCC_MOTION_KIT_EVIDENCE_CHANGED', 409);
  const raw = store.blob(evidence.motionReceiptSha256);
  check(raw.mimeType === 'application/json' && raw.bytes.length <= 1024 * 1024, 'DCC_MOTION_RECEIPT_MISSING', 409);
  let receipt; try { receipt = JSON.parse(raw.bytes.toString('utf8')); } catch { throw fail('DCC_MOTION_RECEIPT_INVALID'); }
  validateRenderReceipt(receipt, evidence, owned);
  const blob = store.blobInfo(assetHash);
  check(blob.mimeType === evidence.blob.mimeType && blob.byteLength === evidence.blob.byteLength, 'DCC_MOTION_VIDEO_MISMATCH', 409);
  if (measurement) {
    const preview = receipt.previewSettings, [numerator, denominator] = measurement.frameRate.split('/').map(Number), rate = preview.frameRate / preview.frameRateBase;
    check(measurement.videoFrameCount === preview.renderedFrameCount && measurement.width === preview.width && measurement.height === preview.height
      && measurement.audio.length === 0 && Math.abs(numerator / denominator - rate) < 0.001
      && Math.abs(measurement.durationMs - preview.renderedFrameCount * 1000 / rate) <= Math.max(50, 1000 / rate), 'DCC_MOTION_MEASUREMENT_MISMATCH', 409);
  }
  return { blob: evidence.blob, originalFilename: 'internal-previs.mp4', origin: 'RETAINED_DCC_MOTION', providerProvenance: 'LOCAL_BLENDER_RENDER' };
}

/** Only owned ChildProcess handles are stopped. Client paths, code, PIDs and
 * render settings are never accepted; restart never resubmits a render. */
export function createDccMotionService(store, { mediaIntake, blenderPath = process.env.CANISCREENWRITE_BLENDER_PATH || DEFAULT_BLENDER_PATH, spawnImpl = spawn,
  timeoutMs = 10 * 60_000, writeReceiptImpl = immutable } = {}) {
  check(typeof mediaIntake?.measureRetained === 'function', 'DCC_MOTION_MEDIA_INTAKE_REQUIRED', 422);
  check(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30 * 60_000, 'DCC_MOTION_TIMEOUT_INVALID', 422);
  const script = fs.readFileSync(scriptUrl), scriptSha256 = sha256(script), root = path.join(store.directory, 'integrations', 'dcc-motion'), jobs = new Map();
  let active = null, closed = false, storageFailed = false;
  function runtime() {
    try { check(typeof blenderPath === 'string' && path.isAbsolute(blenderPath), 'DCC_MOTION_RUNTIME_UNAVAILABLE', 409); const stat = fs.lstatSync(blenderPath); check(stat.isFile() && !stat.isSymbolicLink(), 'DCC_MOTION_RUNTIME_UNAVAILABLE', 409); fs.accessSync(blenderPath, fs.constants.X_OK); return { available: true, interactiveEditor: false }; }
    catch { return { available: false, interactiveEditor: false }; }
  }
  function publish(previous, patch) {
    const { sha256: previousSha256, ...before } = previous ?? {};
    const body = { ...before, ...patch, previousSha256: previousSha256 ?? null, version: (previous?.version ?? 0) + 1, updatedAt: Date.now() }, result = { ...body, sha256: sha256(canonical(body)) };
    try { writeReceiptImpl(path.join(root, result.jobId, `receipt-${String(result.version).padStart(6, '0')}.json`), result); }
    catch { storageFailed = true; throw Object.assign(fail('DCC_MOTION_STORAGE_UNAVAILABLE'), { status: 503 }); }
    jobs.set(result.jobId, result); return result;
  }
  function verifyRetained(job) {
    check(job.takeRef && digest(job.renderEvidenceSha256), 'DCC_MOTION_EVIDENCE_MISSING', 409);
    const history = store.history(job.takeRef.id), take = history[0];
    check(history.length === 1 && take.kind === 'measured-media-take' && take.sha256 === job.takeRef.sha256 && sha256(canonical(take.data)) === take.sha256
      && take.data.retainedSource?.id === `dcc-motion:${job.jobId}` && take.data.retainedSource.sha256 === job.renderEvidenceSha256
      && ['sourceHash', 'sceneId', 'shotId'].every(key => take.data[key] === job[key]), 'DCC_MOTION_TAKE_EVIDENCE_MISSING', 409);
    validateMediaRecord(take.kind, take.data, store.project());
    const probe = store.blob(take.data.probe.outputSha256);
    check(probe.mimeType === 'application/json' && probe.bytes.length <= 8 * 1024 * 1024
      && canonical(measurementFromProbe(JSON.parse(probe.bytes.toString('utf8')), take.data.probe.toolIdentity)) === canonical(take.data.measurement), 'DCC_MOTION_PROBE_EVIDENCE_MISSING', 409);
    verifyDccMotionSource(store, take.data.retainedSource, take.data.blob.sha256, { target: take.data, measurement: take.data.measurement });
  }
  if (fs.existsSync(root)) {
    directory(directory(store.directory, 'integrations'), 'dcc-motion');
    const names = fs.readdirSync(root); check(names.length <= 1000, 'DCC_MOTION_HISTORY_LIMIT', 413);
    for (const name of names) {
      check(uuid(name), 'DCC_MOTION_DIRECTORY_INVALID', 409);
      const dir = directory(root, name), files = fs.readdirSync(dir).filter(value => /^receipt-\d{6}\.json$/.test(value)).sort();
      check(files.length <= 5000, 'DCC_MOTION_HISTORY_LIMIT', 413);
      let latest;
      for (const filename of files) {
        const saved = readJson(path.join(dir, filename)), { sha256: claimed, ...body } = saved;
        check(saved.schemaVersion === schemaVersion && saved.jobId === name && saved.projectId === store.project().id && saved.sourceHash === store.project().sourceHash
          && phases.has(saved.phase) && saved.approvalGranted === false && saved.finalMedia === false && saved.version === (latest?.version ?? 0) + 1
          && saved.previousSha256 === (latest?.sha256 ?? null) && sha256(canonical(body)) === claimed, 'DCC_MOTION_RECEIPT_INVALID', 409);
        latest = saved;
      }
      if (!latest) continue;
      jobs.set(name, latest);
      try {
        if (activePhases.has(latest.phase)) publish(latest, { phase: 'INTERRUPTED', error: 'DCC_MOTION_SERVICE_RESTARTED_NO_RESUBMISSION', processExited: false });
        else if (latest.phase === 'RETAINED') { try { verifyRetained(latest); } catch { publish(latest, { phase: 'EVIDENCE_MISSING', error: 'DCC_MOTION_EVIDENCE_MISSING' }); } }
      } catch (error) { if (error.code !== 'DCC_MOTION_STORAGE_UNAVAILABLE') throw error; }
    }
  }
  function list(sceneId) {
    check(!storageFailed, 'DCC_MOTION_STORAGE_UNAVAILABLE', 503);
    check(store.project().scenes?.some(scene => scene.id === sceneId), 'DCC_MOTION_SCENE_REQUIRED', 422);
    return { schemaVersion: 'qimovi-dcc-motion-jobs/v1', projectId: store.project().id, sourceHash: store.project().sourceHash, sceneId, busy: !!active, runtime: runtime(),
      jobs: [...jobs.values()].filter(job => job.sceneId === sceneId).sort((a, b) => b.createdAt - a.createdAt) };
  }
  function runProcess(owner, args) {
    return new Promise((resolve, reject) => {
      if (owner.stopReason) return reject(fail(owner.stopReason));
      const log = fs.openSync(path.join(owner.directory, 'blender.log'), 'wx', 0o600); let total = 0, settled = false, killTimer, lines = '';
      let child;
      try { child = spawnImpl(blenderPath, args, { cwd: owner.directory, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: owner.directory, TMPDIR: owner.directory, LANG: 'en_US.UTF-8' } }); }
      catch { fs.closeSync(log); return reject(fail('DCC_MOTION_PROCESS_FAILED')); }
      owner.child = child;
      owner.terminate = () => { if (settled) return; child.kill('SIGTERM'); killTimer ??= setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 1500); };
      const capture = (bytes, progress) => {
        try {
          const chunk = Buffer.from(bytes); total += chunk.length;
          if (total > 4 * 1024 * 1024) { owner.stopReason ??= 'DCC_MOTION_LOG_LIMIT'; owner.terminate(); return; }
          fs.writeSync(log, chunk);
          if (!progress || owner.stopReason) return;
          lines += chunk.toString('utf8'); const complete = lines.split('\n'); lines = complete.pop();
          for (const line of complete) if (line.startsWith('QIMOVI_MOTION_PROGRESS=')) {
            const value = JSON.parse(line.slice('QIMOVI_MOTION_PROGRESS='.length)), old = jobs.get(owner.jobId).progress;
            check(Number.isSafeInteger(value.completedFrames) && Number.isSafeInteger(value.totalFrames) && value.totalFrames > 0 && value.totalFrames <= 4320
              && value.completedFrames > (old.completedFrames ?? 0) && value.completedFrames <= value.totalFrames, 'DCC_MOTION_PROGRESS_INVALID', 409);
            publish(jobs.get(owner.jobId), { progress: { completedFrames: value.completedFrames, totalFrames: value.totalFrames } });
          }
        } catch (error) { owner.stopReason ??= error.code ?? 'DCC_MOTION_PROGRESS_INVALID'; owner.terminate(); }
      };
      child.stdout?.on('data', bytes => capture(bytes, true)); child.stderr?.on('data', bytes => capture(bytes, false));
      const finish = (error, code) => {
        if (settled) return; settled = true; clearTimeout(killTimer); fs.closeSync(log); owner.child = null; owner.terminate = null;
        if (owner.stopReason) reject(fail(owner.stopReason)); else if (error || code !== 0) reject(fail('DCC_MOTION_PROCESS_FAILED')); else resolve();
      };
      child.once('error', error => finish(error)); child.once('close', code => finish(null, code));
    });
  }
  async function execute(owner, owned) {
    const { jobId, directory: dir } = owner, kitDir = path.join(dir, 'kit'), output = path.join(dir, 'rendered');
    const timer = setTimeout(() => { owner.stopReason ??= 'DCC_MOTION_TIMEOUT'; owner.controller.abort(); owner.terminate?.(); }, timeoutMs);
    const running = () => { if (owner.stopReason) throw fail(owner.stopReason); check(sha256(fs.readFileSync(scriptUrl)) === scriptSha256, 'DCC_MOTION_SCRIPT_CHANGED', 409); };
    try {
      // Yield once so the caller can observe QUEUED and cancel before spawn.
      await Promise.resolve(); running();
      const runtimeSha256 = fileInfo(blenderPath, 1024 * 1024 * 1024).sha256;
      directory(dir, 'kit', true);
      for (const file of owned.kit.files) { check(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file.path) && sha256(file.content) === file.sha256, 'DCC_MOTION_KIT_INVALID', 409); fs.writeFileSync(path.join(kitDir, file.path), file.content, { flag: 'wx', mode: 0o600 }); }
      fs.writeFileSync(path.join(dir, 'motion.py'), script, { flag: 'wx', mode: 0o600 });
      fs.copyFileSync(owned.sceneFile.filename, path.join(dir, owned.sceneFile.name), fs.constants.COPYFILE_EXCL);
      check(fileInfo(path.join(dir, owned.sceneFile.name), 64 * 1024 * 1024).sha256 === owned.sceneFile.sha256, 'DCC_MOTION_INPUT_CHANGED', 409);
      publish(jobs.get(jobId), { phase: 'RENDERING', runtimeSha256 });
      await runProcess(owner, ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '17', '--python', path.join(dir, 'motion.py'), '--', '--scene', path.join(dir, owned.sceneFile.name), '--kit', kitDir, '--output', output]);
      running(); check(fileInfo(blenderPath, 1024 * 1024 * 1024).sha256 === runtimeSha256, 'DCC_MOTION_RUNTIME_CHANGED', 409);
      loadDccStageReturnForMotion(store, jobs.get(jobId));
      directory(dir, 'rendered');
      const receiptFile = path.join(output, 'motion-preview.json'), videoFile = path.join(output, 'internal-previs.mp4'), receipt = readJson(receiptFile), video = fileInfo(videoFile, maximumVideo);
      const evidence = { schemaVersion: 'qimovi-dcc-motion-render/v1', jobId, ...scopeInput(jobs.get(jobId)), scriptSha256, runtimeSha256,
        motionReceiptSha256: fileInfo(receiptFile, 1024 * 1024).sha256, blob: { ...video, mimeType: 'video/mp4' }, approvalGranted: false, finalMedia: false };
      validateRenderReceipt(receipt, evidence, owned);
      const prefix = Buffer.alloc(12), fd = fs.openSync(videoFile, 'r'); try { fs.readSync(fd, prefix, 0, 12, 0); } finally { fs.closeSync(fd); }
      check(prefix.toString('ascii', 4, 8) === 'ftyp', 'DCC_MOTION_VIDEO_CONTAINER_INVALID', 409);
      store.putBlob(receiptFile, 'application/json', { sha256: evidence.motionReceiptSha256, byteLength: fs.statSync(receiptFile).size, maxBytes: 1024 * 1024 });
      store.putBlob(videoFile, 'video/mp4', { ...video, maxBytes: maximumVideo });
      const renderEvidenceSha256 = sha256(canonical(evidence));
      immutable(path.join(dir, 'render-evidence.json'), { body: evidence, sha256: renderEvidenceSha256 });
      running();
      publish(jobs.get(jobId), { phase: 'MEASURING', processExited: true, renderEvidenceSha256, progress: { completedFrames: receipt.previewSettings.renderedFrameCount, totalFrames: receipt.previewSettings.renderedFrameCount } });
      const result = await mediaIntake.measureRetained({ requestId: `dcc-motion:${jobId}`, sourceHash: evidence.sourceHash, sceneId: evidence.sceneId, shotId: evidence.shotId,
        briefRef: null, retainedSource: { id: `dcc-motion:${jobId}`, sha256: renderEvidenceSha256 }, assetHash: video.sha256 }, { signal: owner.controller.signal });
      // Intake checks cancellation and current source immediately before its
      // synchronous commit. Cancellation arriving during cleanup cannot undo
      // an already retained take or hide its reference behind STOPPED.
      verifyDccMotionSource(store, result.record.data.retainedSource, video.sha256, { target: result.record.data, measurement: result.record.data.measurement });
      publish(jobs.get(jobId), { phase: 'RETAINED', takeRef: { id: result.record.id, sha256: result.record.sha256 }, error: null });
    } catch (error) {
      publish(jobs.get(jobId), { phase: owner.stopReason === 'DCC_MOTION_STOPPED' ? 'STOPPED' : 'FAILED', error: owner.stopReason ?? (typeof error.code === 'string' ? error.code : 'DCC_MOTION_FAILED'), processExited: !owner.child });
    } finally { clearTimeout(timer); if (active === owner) active = null; }
  }
  function start(input) {
    check(!storageFailed, 'DCC_MOTION_STORAGE_UNAVAILABLE', 503); check(!closed, 'DCC_MOTION_CLOSED', 503);
    shape(input, ['jobId', 'projectId', 'sourceHash', 'sceneId', 'shotId', 'returnReceiptSha256']);
    check(uuid(input.jobId), 'DCC_MOTION_JOB_INVALID', 422);
    const requestSha256 = sha256(canonical(input)), existing = jobs.get(input.jobId);
    if (existing) { check(existing.requestSha256 === requestSha256, 'DCC_MOTION_RETRY_CONFLICT', 409); return existing; }
    check(!active, 'DCC_MOTION_BUSY', 409); check(runtime().available, 'DCC_MOTION_RUNTIME_UNAVAILABLE', 409);
    check(jobs.size < 1000, 'DCC_MOTION_HISTORY_LIMIT', 413);
    const owned = loadDccStageReturnForMotion(store, input);
    check(sha256(fs.readFileSync(scriptUrl)) === scriptSha256, 'DCC_MOTION_SCRIPT_CHANGED', 409);
    directory(directory(store.directory, 'integrations', true), 'dcc-motion', true);
    const dir = path.join(root, input.jobId); check(!fs.existsSync(dir), 'DCC_MOTION_JOB_DIRECTORY_EXISTS', 409); fs.mkdirSync(dir, { mode: 0o700 });
    const job = publish(null, { schemaVersion, ...input, requestSha256, phase: 'QUEUED', createdAt: Date.now(), error: null,
      scriptSha256, runtimeSha256: null, processExited: false, renderEvidenceSha256: null, progress: { completedFrames: null, totalFrames: null }, takeRef: null, approvalGranted: false, finalMedia: false });
    const owner = { jobId: input.jobId, directory: dir, controller: new AbortController(), child: null, terminate: null, stopReason: null, done: null }; active = owner;
    owner.done = execute(owner, owned).catch(() => { storageFailed = true; });
    return job;
  }
  function stop(input) {
    shape(input, ['jobId']); check(uuid(input.jobId), 'DCC_MOTION_JOB_INVALID', 422);
    const job = jobs.get(input.jobId); check(job, 'DCC_MOTION_NOT_FOUND', 404);
    if (active?.jobId !== input.jobId || active.stopReason) return job;
    active.stopReason = 'DCC_MOTION_STOPPED'; active.controller.abort(); active.terminate?.(); return publish(job, { phase: 'STOPPING' });
  }
  return { list, start, stop, async close() { closed = true; if (active) { const owner = active; owner.stopReason ??= 'DCC_MOTION_STOPPED'; owner.controller.abort(); owner.terminate?.(); await owner.done; } } };
}
