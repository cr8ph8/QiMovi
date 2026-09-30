import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { canonical, sha256, check, PilotError } from './storage.mjs';
import { verifyProjectAssetRecord, importProjectLibraryUpload } from './project-library.mjs';
import { validateMediaRecordReferences } from './media-takes.mjs';

// This is an original file/process adapter. The separately supplied GPL runtime
// is neither imported nor bundled into the QiMovi application.
export const OPENCREATOR_LIMITS = Object.freeze({ videoBytes: 256 * 1024 ** 2, subtitleBytes: 256 * 1024, durationMs: 30 * 60 * 1000 });
const idPattern = /^[a-f0-9]{32}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const subtitleStyle = { version: 1, horizontal: { major: { font_name: 'OpenCreator Sans Regular', primary_color: '#FFFFFF' }, minor: { font_name: 'OpenCreator Sans Regular', primary_color: '#FFFFFF' } }, vertical: { major: { font_name: 'OpenCreator Sans Regular', primary_color: '#FFFFFF' }, minor: { font_name: 'OpenCreator Sans Regular', primary_color: '#FFFFFF' } } };
const ref = record => ({ id: record.id, version: record.version, sha256: record.sha256 });
const shape = (value, keys) => check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join(), 'OPENCREATOR_INPUT', 422);
const jsonFile = filename => {
  const stat = fs.lstatSync(filename);
  check(stat.isFile() && stat.size <= 1024 ** 2, 'OPENCREATOR_RECORD_INVALID', 409);
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
};
function writeJson(filename, value) {
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, canonical(value) + '\n', { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, filename);
}
function directory(filename) {
  fs.mkdirSync(filename, { recursive: true, mode: 0o700 });
  check(fs.lstatSync(filename).isDirectory(), 'OPENCREATOR_DIRECTORY_INVALID', 409);
  return filename;
}
export function hashLocalFile(filename, maximum = OPENCREATOR_LIMITS.videoBytes) {
  const stat = fs.lstatSync(filename);
  check(stat.isFile() && stat.size > 0 && stat.size <= maximum, 'OPENCREATOR_FILE_INVALID', 422);
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd), hash = crypto.createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    let count = 0, size;
    while ((size = fs.readSync(fd, buffer, 0, buffer.length, null))) { count += size; check(count <= maximum, 'OPENCREATOR_FILE_TOO_LARGE', 422); hash.update(buffer.subarray(0, size)); }
    const after = fs.fstatSync(fd);
    check(count === before.size && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs, 'OPENCREATOR_FILE_CHANGED', 409);
    return { sha256: hash.digest('hex'), byteLength: count };
  } finally { fs.closeSync(fd); }
}
export function validateOpenCreatorSubtitles(value) {
  check(typeof value === 'string' && value.isWellFormed() && Buffer.byteLength(value) <= OPENCREATOR_LIMITS.subtitleBytes && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value), 'OPENCREATOR_SUBTITLES_INVALID', 422);
  const normalized = value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  const blocks = normalized.split(/\n[ \t]*\n/), time = (h, m, s, ms) => ((+h * 60 + +m) * 60 + +s) * 1000 + +ms;
  let lastStart = -1, endMs = 0;
  for (const block of blocks) {
    const lines = block.split('\n');
    const match = /^(\d{2}):([0-5]\d):([0-5]\d),(\d{3}) --> (\d{2}):([0-5]\d):([0-5]\d),(\d{3})$/.exec(lines[1] ?? '');
    check(/^\d+$/.test(lines[0]) && match && lines.slice(2).some(line => line.trim()), 'OPENCREATOR_SUBTITLES_INVALID', 422);
    const start = time(...match.slice(1, 5)), end = time(...match.slice(5, 9));
    check(start >= lastStart && end > start && end <= OPENCREATOR_LIMITS.durationMs, 'OPENCREATOR_SUBTITLE_TIMING', 422);
    lastStart = start; endMs = Math.max(endMs, end);
  }
  return { text: normalized + '\n', endMs, cueCount: blocks.length };
}
function runtimeStatus(root, sandboxPath) {
  if (!root) return { state: 'NOT_CONFIGURED', message: 'A separate OpenCreator media runtime has not been configured.' };
  const required = ['bin/krillinai-cli', 'bin/ffmpeg', 'bin/ffprobe', 'bin/yt-dlp', 'fonts/manifest.json'];
  try {
    check(path.isAbsolute(root), 'OPENCREATOR_RUNTIME_PATH', 422);
    for (const name of required) {
      const filename = path.join(root, name);
      check(fs.statSync(filename).isFile(), 'OPENCREATOR_RUNTIME_MISSING', 422);
      if (name.startsWith('bin/')) fs.accessSync(filename, fs.constants.X_OK);
    }
    fs.accessSync(sandboxPath, fs.constants.X_OK);
    const fonts = jsonFile(path.join(root, 'fonts/manifest.json'));
    check(fonts.version === 1 && Array.isArray(fonts.fonts) && fonts.fonts.some(font => font.family === 'OpenCreator Sans Regular'), 'OPENCREATOR_FONTS_MISSING', 422);
    for (const font of fonts.fonts) {
      check(typeof font.file === 'string' && /^(?:fonts\/)?[A-Za-z0-9._-]+\.ttf$/.test(font.file) && digestPattern.test(font.sha256), 'OPENCREATOR_FONTS_INVALID', 422);
      check(hashLocalFile(path.join(root, 'fonts', path.basename(font.file)), 32 * 1024 ** 2).sha256 === font.sha256, 'OPENCREATOR_FONTS_CHANGED', 422);
    }
    return { state: 'READY', message: 'Local subtitle rendering is available. No model service is used; network access is blocked during rendering.' };
  } catch { return { state: 'MISSING_DEPENDENCIES', message: 'The separate runtime, subtitle fonts or macOS network sandbox is missing or changed. Check the local runtime setup.' }; }
}
function runProcess(executable, args, { cwd, env, signal, timeoutMs }) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new PilotError('OPENCREATOR_CANCELLED', 409));
    const child = spawn(executable, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [], stderr = []; let total = 0, failure;
    const stop = error => {
      failure ??= error;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    };
    const abort = () => stop(new PilotError('OPENCREATOR_CANCELLED', 409));
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop(new PilotError('OPENCREATOR_TIMED_OUT', 422)), timeoutMs);
    const collect = chunks => chunk => { total += chunk.length; if (total > 4 * 1024 ** 2) stop(new PilotError('OPENCREATOR_LOG_LIMIT', 422)); else chunks.push(chunk); };
    child.stdout.on('data', collect(stdout)); child.stderr.on('data', collect(stderr));
    child.once('error', () => { failure = new PilotError('OPENCREATOR_PROCESS_UNAVAILABLE', 422); });
    child.once('close', code => {
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      const result = { code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') };
      if (failure) reject(failure); else resolve(result);
    });
  });
}
function measurement(value) {
  const video = value?.streams?.find(stream => stream.codec_type === 'video');
  const durationMs = Math.round(Number(value?.format?.duration ?? video?.duration) * 1000);
  check(video && Number.isInteger(video.width) && video.width > 0 && Number.isInteger(video.height) && video.height > 0 && video.width * video.height <= 4096 * 4096 && Number.isSafeInteger(durationMs) && durationMs > 0 && durationMs <= OPENCREATOR_LIMITS.durationMs, 'OPENCREATOR_MEDIA_MEASUREMENT', 422);
  return { width: video.width, height: video.height, durationMs, audioStreams: value.streams.filter(stream => stream.codec_type === 'audio').length };
}
export async function runOfflineOpenCreator({ runtimeRoot, sandboxPath, jobDirectory, id, format, subtitleEndMs, signal, timeoutMs }) {
  const env = { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', KRILLINAI_OFFLINE_DEPENDENCIES: '1', KRILLINAI_RESOURCE_ROOT: runtimeRoot };
  // Deny outbound access in the whole process tree, including FFmpeg. Do not
  // inherit API keys, proxy settings, Codex home or upstream user configuration.
  const call = (binary, args) => runProcess(sandboxPath, ['-p', '(version 1) (allow default) (deny network*)', path.join(runtimeRoot, 'bin', binary), ...args], { cwd: jobDirectory, env, signal, timeoutMs });
  const probe = async filename => {
    const result = await call('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file', '-show_format', '-show_streams', '-of', 'json', filename]);
    check(result.code === 0, 'OPENCREATOR_PROBE_FAILED', 422);
    try { return measurement(JSON.parse(result.stdout)); } catch (error) { throw error instanceof PilotError ? error : new PilotError('OPENCREATOR_PROBE_FAILED', 422); }
  };
  const input = await probe(path.join(jobDirectory, 'input.mp4'));
  check(subtitleEndMs <= input.durationMs + 100, 'OPENCREATOR_SUBTITLES_EXCEED_VIDEO', 422);
  const stage = `render-${format}`;
  const result = await call('krillinai-cli', [stage, '--workdir', jobDirectory, '--task-id', id, '--video', path.join(jobDirectory, 'input.mp4'), '--subtitle', path.join(jobDirectory, 'subtitles.srt'), '--subtitle-style-file', path.join(jobDirectory, 'subtitle-style.json')]);
  fs.writeFileSync(path.join(jobDirectory, 'process.log'), result.stdout + '\n' + result.stderr, { flag: 'wx', mode: 0o600 });
  let terminal;
  for (const line of result.stdout.split('\n')) {
    try { const value = JSON.parse(line); if (typeof value?.ok === 'boolean') terminal = value; } catch { /* upstream logger can write non-JSON lines */ }
  }
  check(result.code === 0 && terminal?.ok === true && terminal.stage === stage && terminal.task_id === id && terminal.workdir === jobDirectory, 'OPENCREATOR_RENDER_FAILED', 422);
  const output = await probe(path.join(jobDirectory, `${format}_bilingual.mp4`));
  check(Math.abs(output.durationMs - input.durationMs) <= 500 && (input.audioStreams === 0 || output.audioStreams > 0) && (format === 'vertical' ? output.height > output.width : output.width === input.width && output.height === input.height), 'OPENCREATOR_OUTPUT_MEASUREMENT', 422);
  return output;
}
export function createOpenCreatorService(store, { runtimeRoot = process.env.FILMSTACK_OPENCREATOR_RUNTIME, sandboxPath = '/usr/bin/sandbox-exec', run = runOfflineOpenCreator, timeoutMs = 10 * 60 * 1000 } = {}) {
  check(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30 * 60 * 1000, 'OPENCREATOR_TIMEOUT_INVALID', 422);
  const root = path.join(store.directory, 'opencreator-jobs'), active = new Map();
  let closing = false;
  const scope = () => ({ projectId: store.project().id, sourceHash: store.project().sourceHash });
  const checkScope = value => check(value.projectId === scope().projectId && value.sourceHash === scope().sourceHash, 'OPENCREATOR_PROJECT_CHANGED', 409);
  const jobDirectory = id => { check(typeof id === 'string' && idPattern.test(id), 'OPENCREATOR_JOB_ID', 404); return path.join(root, id); };
  const save = job => writeJson(path.join(jobDirectory(job.id), 'job.json'), job);
  const summary = job => Object.fromEntries(['id', 'requestId', 'projectId', 'sourceHash', 'format', 'phase', 'createdAt', 'finishedAt', 'error', 'output', 'cost', 'retainedAssetId'].map(key => [key, job[key]]));
  const read = id => {
    let job;
    try { const dir = jobDirectory(id); check(fs.lstatSync(dir).isDirectory(), 'OPENCREATOR_JOB_INVALID', 409); job = jsonFile(path.join(dir, 'job.json')); }
    catch (error) { throw error instanceof PilotError ? error : new PilotError('OPENCREATOR_JOB_NOT_FOUND', 404); }
    check(job.id === id && job.schemaVersion === 'qimovi-opencreator-job/v1', 'OPENCREATOR_JOB_INVALID', 409); checkScope(job);
    // A process from a previous service lifetime is never silently restarted.
    if (job.phase === 'RUNNING' && !active.has(id)) { job.phase = 'INTERRUPTED'; job.output = null; job.error = 'OPENCREATOR_INTERRUPTED'; job.finishedAt = new Date().toISOString(); save(job); }
    return job;
  };
  const source = assetRef => {
    shape(assetRef, ['id', 'version', 'sha256']);
    const record = store.rawList().find(row => row.id === assetRef.id);
    check(record && canonical(ref(record)) === canonical(assetRef), 'OPENCREATOR_ASSET_CHANGED', 409);
    check(record.data.sourceHash === scope().sourceHash && (scope().sourceHash !== null || record.data.projectId === scope().projectId), 'OPENCREATOR_PROJECT_CHANGED', 409);
    if (record.kind === 'project-asset') verifyProjectAssetRecord(store, record);
    else {
      check(record.kind === 'measured-media-take', 'OPENCREATOR_VIDEO_REQUIRED', 422);
      validateMediaRecordReferences(store, record.kind, record.data, { id: record.id, version: record.version, verifyMediaBytes: true });
    }
    const blob = record.data.asset ?? record.data.blob;
    check(blob?.mimeType === 'video/mp4' && blob.byteLength <= OPENCREATOR_LIMITS.videoBytes, 'OPENCREATOR_VIDEO_REQUIRED', 422);
    const original = store.blobInfo(blob.sha256);
    return { recordRef: ref(record), assetHash: blob.sha256, byteLength: blob.byteLength, originalFilename: record.data.originalFilename, filename: original.filename };
  };
  const outputFile = job => {
    check(job.phase === 'COMPLETED' && job.output, 'OPENCREATOR_OUTPUT_NOT_READY', 409);
    const filename = path.join(jobDirectory(job.id), `${job.format}_bilingual.mp4`), hash = hashLocalFile(filename);
    check(hash.sha256 === job.output.sha256 && hash.byteLength === job.output.byteLength, 'OPENCREATOR_OUTPUT_CHANGED', 409);
    return filename;
  };
  const receipt = job => {
    outputFile(job);
    const filename = path.join(jobDirectory(job.id), 'receipt.json');
    check(hashLocalFile(filename, 1024 ** 2).sha256 === job.receiptSha256, 'OPENCREATOR_RECEIPT_CHANGED', 409);
    const value = jsonFile(filename);
    check(value.job.id === job.id && value.job.output.sha256 === job.output.sha256, 'OPENCREATOR_RECEIPT_CHANGED', 409);
    return { ...value, job: summary(job) };
  };
  const service = {
    snapshot() {
      check(!closing, 'OPENCREATOR_CLOSED', 503);
      const seen = new Set();
      const videos = store.rawList().filter(row => ['project-asset', 'measured-media-take'].includes(row.kind)).flatMap(record => {
        const blob = record.data.asset ?? record.data.blob;
        if (record.data.sourceHash !== scope().sourceHash || (scope().sourceHash === null && record.data.projectId !== scope().projectId) || blob?.mimeType !== 'video/mp4' || blob.byteLength > OPENCREATOR_LIMITS.videoBytes || seen.has(blob.sha256)) return [];
        seen.add(blob.sha256);
        return [{ recordRef: ref(record), assetHash: blob.sha256, title: record.data.title ?? record.data.originalFilename, originalFilename: record.data.originalFilename, byteLength: blob.byteLength }];
      });
      const jobs = fs.existsSync(root) ? fs.readdirSync(root).filter(id => idPattern.test(id)).flatMap(id => { try { return [summary(read(id))]; } catch { return []; } }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50) : [];
      return { schemaVersion: 'qimovi-opencreator/v1', ...scope(), runtime: runtimeStatus(runtimeRoot, sandboxPath), videos, jobs };
    },
    start(input) {
      check(!closing, 'OPENCREATOR_CLOSED', 503);
      shape(input, ['projectId', 'sourceHash', 'requestId', 'assetRef', 'format', 'subtitles']); checkScope(input);
      check(typeof input.requestId === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(input.requestId) && ['horizontal', 'vertical'].includes(input.format), 'OPENCREATOR_INPUT', 422);
      const subtitles = validateOpenCreatorSubtitles(input.subtitles), fingerprint = sha256(canonical(input));
      const id = sha256(canonical({ ...scope(), requestId: input.requestId })).slice(0, 32), dir = jobDirectory(id);
      if (fs.existsSync(dir)) { const job = read(id); check(job.fingerprint === fingerprint, 'OPENCREATOR_REQUEST_REUSED', 409); return { job: summary(job) }; }
      check(active.size === 0, 'OPENCREATOR_BUSY', 409);
      check(runtimeStatus(runtimeRoot, sandboxPath).state === 'READY', 'OPENCREATOR_RUNTIME_NOT_READY', 422);
      const selected = source(input.assetRef), { filename, ...sourceInfo } = selected;
      const runtime = { interfaceRelease: '3.2.3', cliSha256: hashLocalFile(path.join(runtimeRoot, 'bin/krillinai-cli')).sha256, ffmpegSha256: hashLocalFile(path.join(runtimeRoot, 'bin/ffmpeg')).sha256, ffprobeSha256: hashLocalFile(path.join(runtimeRoot, 'bin/ffprobe')).sha256 };
      directory(root); fs.mkdirSync(dir, { mode: 0o700 });
      try {
        directory(path.join(dir, 'config'));
        fs.copyFileSync(filename, path.join(dir, 'input.mp4'), fs.constants.COPYFILE_EXCL);
        check(hashLocalFile(path.join(dir, 'input.mp4')).sha256 === sourceInfo.assetHash, 'OPENCREATOR_INPUT_CHANGED', 409);
        fs.writeFileSync(path.join(dir, 'subtitles.srt'), subtitles.text, { flag: 'wx', mode: 0o600 });
        writeJson(path.join(dir, 'subtitle-style.json'), subtitleStyle);
        fs.writeFileSync(path.join(dir, 'config/config.toml'), '[app]\nproxy = ""\n', { flag: 'wx', mode: 0o600 });
      } catch (error) { fs.rmSync(dir, { recursive: true, force: true }); throw error; }
      const job = { schemaVersion: 'qimovi-opencreator-job/v1', id, requestId: input.requestId, ...scope(), format: input.format, phase: 'RUNNING', createdAt: new Date().toISOString(), finishedAt: null, error: null, output: null, retainedAssetId: null,
        fingerprint, source: sourceInfo, subtitlesSha256: sha256(subtitles.text), runtime, cost: { providerCalls: 0, providerCharge: 0, totalCost: null, localCompute: 'UNMEASURED' } };
      save(job);
      const controller = new AbortController(), operation = { controller, completed: null }; active.set(id, operation);
      operation.completed = (async () => {
        try {
          const measured = await run({ runtimeRoot, sandboxPath, jobDirectory: dir, id, format: input.format, subtitleEndMs: subtitles.endMs, signal: controller.signal, timeoutMs });
          check(!controller.signal.aborted, 'OPENCREATOR_CANCELLED', 409);
          checkScope(job);
          const manifestFile = path.join(dir, 'krillinai_manifest.json'), manifest = jsonFile(manifestFile), stage = `render-${input.format}`;
          const output = path.join(dir, `${input.format}_bilingual.mp4`);
          check(manifest.task_id === id && manifest.workdir === dir && manifest.stages?.[stage]?.ok === true && manifest.outputs?.[`${input.format}_video`] === output, 'OPENCREATOR_MANIFEST_INVALID', 422);
          check(hashLocalFile(path.join(dir, 'input.mp4')).sha256 === job.source.assetHash && sha256(fs.readFileSync(path.join(dir, 'subtitles.srt'))) === job.subtitlesSha256, 'OPENCREATOR_INPUT_CHANGED', 409);
          check(canonical(jsonFile(path.join(dir, 'subtitle-style.json'))) === canonical(subtitleStyle), 'OPENCREATOR_STYLE_CHANGED', 409);
          for (const [binary, expected] of [['krillinai-cli', runtime.cliSha256], ['ffmpeg', runtime.ffmpegSha256], ['ffprobe', runtime.ffprobeSha256]]) check(hashLocalFile(path.join(runtimeRoot, 'bin', binary)).sha256 === expected, 'OPENCREATOR_RUNTIME_CHANGED', 409);
          job.output = { ...hashLocalFile(output), filename: `opencreator-${input.format}-${id}.mp4` };
          job.phase = 'COMPLETED'; job.finishedAt = new Date().toISOString();
          writeJson(path.join(dir, 'receipt.json'), { schemaVersion: 'qimovi-opencreator-receipt/v1', job: summary(job), source: sourceInfo, subtitlesSha256: job.subtitlesSha256, subtitleStyleSha256: sha256(canonical(subtitleStyle)), runtime, manifestSha256: hashLocalFile(manifestFile, 1024 ** 2).sha256, measurement: measured, network: 'DENIED_BY_OS_SANDBOX', approval: 'PENDING_REVIEW' });
          job.receiptSha256 = hashLocalFile(path.join(dir, 'receipt.json'), 1024 ** 2).sha256;
        } catch (error) {
          job.phase = controller.signal.aborted ? 'CANCELLED' : 'FAILED'; job.finishedAt = new Date().toISOString(); job.output = null;
          job.error = error instanceof PilotError ? error.code : 'OPENCREATOR_RENDER_FAILED';
        } finally { save(job); active.delete(id); }
      })();
      return { job: summary(job) };
    },
    get(id) { return { job: summary(read(id)) }; },
    async cancel(id) { read(id); const operation = active.get(id); operation?.controller.abort(); await operation?.completed; return service.get(id); },
    video(id) { const job = read(id); return { filename: outputFile(job), downloadName: job.output.filename, byteLength: job.output.byteLength }; },
    receipt(id) { return receipt(read(id)); },
    retain(id) {
      const job = read(id), filename = outputFile(job);
      receipt(job);
      // Keep the original processing receipt immutable. A later retention action
      // must not create a second receipt asset with only its own status changed.
      const evidence = jsonFile(path.join(jobDirectory(id), 'receipt.json'));
      const result = importProjectLibraryUpload(store, { filename, originalFilename: job.output.filename, collection: 'OpenCreator local finishing', category: 'Rendered references' });
      const receiptPath = path.join(jobDirectory(id), 'retained-receipt.json');
      writeJson(receiptPath, evidence);
      importProjectLibraryUpload(store, { filename: receiptPath, originalFilename: `opencreator-${id}-receipt.json`, collection: 'OpenCreator local finishing', category: 'Processing evidence' });
      job.retainedAssetId = result.records[0].id; save(job);
      return { job: summary(job) };
    },
    async close() { closing = true; for (const operation of active.values()) operation.controller.abort(); await Promise.all([...active.values()].map(operation => operation.completed)); },
  };
  return service;
}
