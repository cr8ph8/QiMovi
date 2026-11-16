import fs from 'node:fs';
import { link, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { addAbortSignal } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import JSZip from 'jszip';

import { DEFAULT_BLENDER_PATH } from './dcc-rehearsals.mjs';
import { canonical, check, sha256 } from './storage.mjs';

const runFile = promisify(execFile);
const script = fileURLToPath(new URL('../integrations/three-d/dolly-benchmark/benchmark.py', import.meta.url));
const scopeKeys = ['projectId', 'sourceHash', 'sceneId', 'shotId'];
const archiveSha256 = 'f62e42b9d3ae742c45d4c4d954acb6f51e13c0d718a8cab23e7ae28773672124';
const archiveRoot = 'QiMovi_Mac_Dolly_Benchmark/';
const referenceSha256 = 'aa778cd6cbcf1153624b514d8e47c159560e3f18d0f0175d0f50fb9113e01151';
const cameraInputsSha256 = '8331cb7f80ed21a1dcdc7680df2dab39025b87c9ed94946e7601c0eb6a30e41a';
const outcomes = ['PASS', 'FAIL', 'SKIPPED', 'ERROR'];
export const DOLLY_BUNDLE_MAX_BYTES = 32 * 1024 ** 2;
const generatorFiles = ['first.png', 'last.png', 'cameras.npz', 'shot.json'];

export function dollyBenchmarkRequest(searchParams) {
  const keys = [...scopeKeys, 'action'];
  check([...searchParams].length === keys.length
    && keys.every(key => searchParams.getAll(key).length === 1 && searchParams.get(key).length > 0),
  'DOLLY_BENCHMARK_SCOPE_REQUIRED', 422);
  const action = searchParams.get('action');
  check(action === 'self-test' || action === 'validate', 'DOLLY_BENCHMARK_ACTION_INVALID', 422);
  return { action, scope: Object.fromEntries(scopeKeys.map(key => [key, searchParams.get(key)])) };
}

export async function dollyBinaryBody(req, signal, maxBytes = 64 * 1024 ** 2) {
  check(req.headers['content-type'] === 'application/octet-stream', 'DOLLY_BENCHMARK_BINARY_REQUIRED', 415);
  const length = Number(req.headers['content-length'] ?? 0);
  check(Number.isSafeInteger(length) && length >= 0 && length <= maxBytes,
    'DOLLY_BENCHMARK_CANDIDATE_TOO_LARGE', 413);
  const chunks = [];
  let total = 0;
  for await (const chunk of addAbortSignal(signal, req)) {
    total += chunk.length;
    check(total <= maxBytes, 'DOLLY_BENCHMARK_CANDIDATE_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  check(total > 0, 'DOLLY_BENCHMARK_CANDIDATE_REQUIRED', 422);
  return Buffer.concat(chunks, total);
}

export function createDollyBenchmarkService(store, {
  blenderPath = process.env.CANISCREENWRITE_BLENDER_PATH || DEFAULT_BLENDER_PATH,
  execute = runFile,
} = {}) {
  let active = null;
  let closed = false;
  const integrations = path.join(store.directory, 'integrations');
  const stored = path.join(integrations, 'dolly-benchmark-v1.zip');

  function checkDirectory() {
    const info = fs.lstatSync(integrations, { throwIfNoEntry: false });
    check(info?.isDirectory() && !info.isSymbolicLink(), 'DOLLY_BENCHMARK_FIXTURE_REQUIRED', 409);
  }

  async function readInstalled() {
    checkDirectory();
    let file;
    try { file = await open(stored, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
    catch (error) {
      if (error.code === 'ENOENT') check(false, 'DOLLY_BENCHMARK_FIXTURE_REQUIRED', 409);
      throw error;
    }
    try {
      const info = await file.stat();
      check(info.isFile() && info.size <= DOLLY_BUNDLE_MAX_BYTES, 'DOLLY_BENCHMARK_FIXTURE_INVALID', 422);
      const bytes = await file.readFile();
      check(sha256(bytes) === archiveSha256, 'DOLLY_BENCHMARK_FIXTURE_INVALID', 422);
      return bytes;
    } finally { await file.close(); }
  }

  async function install(bytes) {
    check(sha256(bytes) === archiveSha256, 'DOLLY_BENCHMARK_FIXTURE_INVALID', 422);
    try { await mkdir(integrations, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    checkDirectory();
    const pending = path.join(integrations, '.dolly-install-' + randomUUID());
    try {
      await writeFile(pending, bytes, { flag: 'wx', mode: 0o600 });
      try { await link(pending, stored); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        await readInstalled();
      }
    } finally { await rm(pending, { force: true }); }
    return { fixture: 'synthetic-dolly/v1', installed: true };
  }

  async function readArchive() {
    return JSZip.loadAsync(await readInstalled());
  }

  async function inputs() {
    const archive = await readArchive();
    const exportZip = new JSZip();
    for (const name of generatorFiles) exportZip.file(name, await archive.file(archiveRoot + 'inputs/' + name).async('nodebuffer'));
    return exportZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  function checkScope(scope) {
    const project = store.resolvedProject();
    check(project.id === scope.projectId && project.sourceHash === scope.sourceHash
      && project.scenes.some(scene => scene.id === scope.sceneId && scene.shots.some(shot => shot.id === scope.shotId)),
    'DOLLY_BENCHMARK_SCOPE_CHANGED', 409);
  }

  async function score(scope, action, readCandidate, signal) {
    const started = performance.now();
    const archive = await readArchive();
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'qimovi-dolly-'));
    try {
      for (const name of ['reference/reference.npz', 'inputs/cameras.npz']) {
        const destination = path.join(temporary, name);
        await mkdir(path.dirname(destination), { mode: 0o700 });
        await writeFile(destination, await archive.file(archiveRoot + name).async('nodebuffer'), { mode: 0o600 });
      }
      const candidatePath = path.join(temporary, 'candidate.npz');
      const reportPath = path.join(temporary, 'report.json');
      let candidateSha256 = null;
      const args = ['--background', '--factory-startup', '--disable-autoexec', '--threads', '2',
        '--python-exit-code', '17', '--python', script, '--', action];

      if (action === 'validate') {
        const bytes = await readCandidate(signal);
        candidateSha256 = sha256(bytes);
        await writeFile(candidatePath, bytes, { flag: 'wx', mode: 0o600 });
        args.push(candidatePath);
      }
      signal.throwIfAborted();
      checkScope(scope);
      let code = 0;
      try {
        await execute(blenderPath, [...args, '--fixture', temporary, '--report', reportPath],
          { cwd: temporary, signal, timeout: 60_000, maxBuffer: 256 * 1024, killSignal: 'SIGKILL' });
      } catch (error) {
        check(!signal.aborted && [1, 2, 3].includes(error.code), 'DOLLY_BENCHMARK_EXECUTION_FAILED', 422);
        code = error.code;
      }
      signal.throwIfAborted();

      let report;
      try { report = JSON.parse(await readFile(reportPath, 'utf8')); }
      catch { check(false, 'DOLLY_BENCHMARK_REPORT_MISSING', 422); }
      check(report?.status === outcomes[code] && report.mode === 'DRY-RUN'
        && report.reference_sha256 === referenceSha256 && report.camera_inputs_sha256 === cameraInputsSha256
        && JSON.stringify(report.held_out_frames) === '[2,49]'
        && (action === 'self-test' ? report.kind === 'validator_controls' && Object.keys(report.cases ?? {}).length === 7
          : report.candidate_sha256 === candidateSha256 && report.eligible_for_review === (report.status === 'PASS')),
      'DOLLY_BENCHMARK_REPORT_INVALID', 422);
      const canonicalReport = JSON.parse(JSON.stringify(report, (_key, value) =>
        typeof value === 'number' && !Number.isSafeInteger(value) ? String(value) : value));
      const receipt = {
        schemaVersion: 'qimovi-dolly-benchmark/v1', fixture: 'synthetic-dolly/v1', action, scope,
        approvalGranted: false, finalMedia: false, elapsedMs: Math.round(performance.now() - started), report: canonicalReport,
      };
      return { ...receipt, sha256: sha256(canonical(receipt)) };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async function run(scope, action, readCandidate, requestSignal) {
    checkScope(scope);
    check(!closed && !active, 'DOLLY_BENCHMARK_BUSY', 409);
    check(fs.existsSync(blenderPath), 'DOLLY_BENCHMARK_BLENDER_REQUIRED', 409);
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, requestSignal]);
    const operation = score(scope, action, readCandidate, signal);
    active = { controller, operation };
    try {
      const receipt = await operation;
      signal.throwIfAborted();
      checkScope(scope);
      return receipt;
    }
    finally { active = null; }
  }
  return {
    inputs, install, run,
    async close() {
      closed = true;
      active?.controller.abort();
      await active?.operation.catch(() => {});
    },
  };
}
