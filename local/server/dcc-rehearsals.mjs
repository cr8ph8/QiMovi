import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { check, canonical, sha256 } from './storage.mjs';
import { buildDccStageKit } from '../integrations/three-d/stage-kit.mjs';
import { buildCameraExchange } from '../integrations/three-d/exchange.mjs';
import { readDccStageReturnDirectory } from '../integrations/three-d/stage-return.mjs';
import { retainDccStageKit, importDccStageReturn, listDccStageReturns } from './dcc-stage-returns.mjs';
import { describeBlenderOperation, qualifyBlenderOperation } from '../integrations/three-d/blender-operation.mjs';

const standardBlender = '/Applications/Blender.app/Contents/MacOS/Blender';
const auditedLocalBlender = path.join(os.homedir(), 'Documents/ChatGPT/ARCHi/output/creative-tools/runtime/Blender-4.5.13.app/Contents/MacOS/Blender');
export const DEFAULT_BLENDER_PATH = fs.existsSync(standardBlender) ? standardBlender : auditedLocalBlender;
const schemaVersion = 'caniscreenwrite-dcc-rehearsal/v1';
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const activePhases = new Set(['QUEUED', 'RUNNING', 'VERIFYING', 'STOPPING']);
const fail = code => Object.assign(new Error(code), { code });
function childDirectory(parent, name) {
  const target = path.join(parent, name);
  if (!fs.existsSync(target)) fs.mkdirSync(target, { mode: 0o700 });
  const stat = fs.lstatSync(target); check(stat.isDirectory() && !stat.isSymbolicLink(), 'DCC_REHEARSAL_DIRECTORY_INVALID', 409);
  return target;
}
function readJson(filename) {
  const stat = fs.lstatSync(filename); check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024 * 1024, 'DCC_REHEARSAL_RECEIPT_INVALID', 409);
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}
const write = (filename, value) => fs.writeFileSync(filename, canonical(value), { flag: 'wx', mode: 0o600 });
async function fileHash(filename) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

/** Only this process's ChildProcess handles may be stopped. No PID recovery,
 * shell command, user Python, active Editor connection or automatic rerun. */
export function createDccRehearsalService(store, { blenderPath = process.env.CANISCREENWRITE_BLENDER_PATH || DEFAULT_BLENDER_PATH, spawnImpl = spawn, timeoutMs = 10 * 60_000, writeReceiptImpl = write } = {}) {
  check(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 30 * 60_000, 'DCC_REHEARSAL_TIMEOUT_INVALID', 422);
  const initialImplementationSha256 = describeBlenderOperation().implementation.sha256;
  let active = null, closed = false, receiptStorageFailed = false;
  const root = path.join(store.directory, 'integrations', 'dcc-rehearsals');
  if (fs.existsSync(root)) childDirectory(childDirectory(store.directory, 'integrations'), 'dcc-rehearsals');
  const jobs = new Map();
  function verifyRetained(job) {
    const directory=path.join(root,job.jobId),reopenFile=path.join(directory,'reopen.json'),evidence=readJson(reopenFile);
    check(sha256(fs.readFileSync(reopenFile))===job.reopenEvidenceSha256 && sha256(fs.readFileSync(path.join(directory,'reopen.py')))===job.reopenScriptSha256
      && evidence.kitFilesSha256===job.kitFilesSha256 && evidence.reopenedVerified===true && evidence.embeddedInputsExact===true && evidence.cameraReadbackMatches===true && evidence.sceneFileUnchanged===true && evidence.approvalGranted===false,'DCC_REHEARSAL_EVIDENCE_MISSING',409);
    const returned=listDccStageReturns(store,job.sceneId).returns.find(value=>value.receiptSha256===job.returnReceiptSha256);
    check(returned?.kitFilesSha256===job.kitFilesSha256 && returned.kitSha256===job.kitSha256 && returned.origin.shotId===job.shotId,'DCC_REHEARSAL_EVIDENCE_MISSING',409);
    const files=readDccStageReturnDirectory(path.join(directory,'returned'));
    check(sha256(files['stage-return.json'])===job.returnReceiptSha256 && sha256(files['rehearsal.blend'])===evidence.sceneFileSha256
      && returned.artifacts.every(item=>files[item.name] && sha256(files[item.name])===item.sha256),'DCC_REHEARSAL_EVIDENCE_MISSING',409);
  }
  function publish(previous, patch) {
    const { sha256: unused, ...before } = previous ?? {}; void unused;
    const body = { ...before, ...patch, version: (previous?.version ?? 0) + 1, updatedAt: Date.now() };
    const receipt = { ...body, sha256: sha256(canonical(body)) };
    try { writeReceiptImpl(path.join(root, receipt.jobId, `receipt-${String(receipt.version).padStart(6, '0')}.json`), receipt); }
    catch { receiptStorageFailed = true; throw Object.assign(fail('DCC_REHEARSAL_STORAGE_UNAVAILABLE'), { status: 503 }); }
    jobs.set(receipt.jobId, receipt); return receipt;
  }
  for (const name of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    check(uuid(name), 'DCC_REHEARSAL_DIRECTORY_INVALID', 409);
    const directory = childDirectory(root, name), receipts = fs.readdirSync(directory).filter(value => /^receipt-\d{6}\.json$/.test(value)).sort();
    let latest;
    for (const filename of receipts) {
      const saved = readJson(path.join(directory, filename)), { sha256: claimed, ...body } = saved;
      check(saved.schemaVersion === schemaVersion && saved.jobId === name && saved.projectId === store.project().id && saved.sourceHash === store.project().sourceHash && saved.version === (latest?.version ?? 0) + 1 && sha256(canonical(body)) === claimed, 'DCC_REHEARSAL_RECEIPT_INVALID', 409);
      latest = saved;
    }
    if (latest) {
      jobs.set(name, latest);
      try {
        if (activePhases.has(latest.phase)) publish(latest, { phase: 'INTERRUPTED', outputDirectory:directory, error: 'DCC_REHEARSAL_SERVICE_RESTARTED_NO_RESUBMISSION', processExited: false });
        else if(latest.phase==='RETAINED') {
          try { verifyRetained(latest); if(latest.outputDirectory!==directory)publish(latest,{outputDirectory:directory}); }
          catch(error) { if(error.code==='DCC_REHEARSAL_STORAGE_UNAVAILABLE')throw error;publish(latest,{phase:'EVIDENCE_MISSING',outputDirectory:directory,error:'DCC_REHEARSAL_EVIDENCE_MISSING',executionVerified:false,reopenedVerified:false}); }
        } else if(latest.outputDirectory!==directory)publish(latest,{outputDirectory:directory});
      } catch(error) { if(error.code!=='DCC_REHEARSAL_STORAGE_UNAVAILABLE')throw error; }
    }
  }
  function runtime() {
    try {
      check(typeof blenderPath === 'string' && path.isAbsolute(blenderPath), 'DCC_BLENDER_NOT_CONFIGURED', 409);
      const stat = fs.lstatSync(blenderPath); check(stat.isFile() && !stat.isSymbolicLink(), 'DCC_BLENDER_NOT_CONFIGURED', 409); fs.accessSync(blenderPath, fs.constants.X_OK);
      return { available: true, path: blenderPath, configurationSource:blenderPath===standardBlender?'STANDARD_INSTALLATION':blenderPath===auditedLocalBlender&&!process.env.CANISCREENWRITE_BLENDER_PATH?'AUDITED_LOCAL_FALLBACK':'CONFIGURED_PATH', connection: 'OWNED_BACKGROUND_PROCESS', interactiveEditor: false, currentBinaryRehashed: false };
    } catch { return { available: false, path: typeof blenderPath === 'string' ? blenderPath : null, connection: 'UNAVAILABLE', interactiveEditor: false, currentBinaryRehashed: false }; }
  }
  function list(sceneId) {
    check(!receiptStorageFailed, 'DCC_REHEARSAL_STORAGE_UNAVAILABLE', 503);
    check(store.project().scenes?.some(scene => scene.id === sceneId), 'DCC_REHEARSAL_SCENE_REQUIRED', 422);
    return { schemaVersion: 'caniscreenwrite-dcc-rehearsals/v1', projectId: store.project().id, sourceHash: store.project().sourceHash, sceneId, runtime: runtime(), busy: !!active,
      jobs: [...jobs.values()].filter(job => job.sceneId === sceneId).sort((a, b) => b.createdAt - a.createdAt) };
  }
  function runProcess(owner, args, logName) {
    return new Promise((resolve, reject) => {
      if (owner.stopReason) return reject(fail(owner.stopReason));
      const log = fs.openSync(path.join(owner.directory, logName), 'wx', 0o600); let total = 0, settled = false, killTimer;
      let child;
      try { child = spawnImpl(blenderPath, args, { cwd: owner.directory, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '/private/tmp', LANG: 'en_US.UTF-8' } }); }
      catch { fs.closeSync(log); return reject(fail('DCC_REHEARSAL_PROCESS_FAILED')); }
      owner.child = child;
      owner.terminate = () => { if (settled) return; child.kill('SIGTERM'); killTimer ??= setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 1500); };
      const capture = bytes => {
        if (settled || owner.stopReason) return;
        try {
          const chunk = Buffer.from(bytes).subarray(0, Math.max(0, 2 * 1024 * 1024 - total));
          if (chunk.length) { fs.writeSync(log, chunk); total += chunk.length; }
        } catch {
          // A full/unavailable log destination must not escape an EventEmitter
          // callback and terminate the whole local workspace service.
          owner.stopReason ??= 'DCC_REHEARSAL_LOG_UNAVAILABLE';
          owner.terminate();
        }
      };
      child.stdout?.on('data', capture); child.stderr?.on('data', capture);
      const timer = setTimeout(() => { owner.stopReason = 'DCC_REHEARSAL_TIMEOUT'; owner.terminate(); }, timeoutMs);
      const finish = (error, code) => {
        if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer); fs.closeSync(log); owner.child = null; owner.terminate = null;
        if (owner.stopReason) reject(fail(owner.stopReason)); else if (error || code !== 0) reject(fail('DCC_REHEARSAL_PROCESS_FAILED')); else resolve();
      };
      child.once('error', error => finish(error)); child.once('close', code => finish(null, code));
    });
  }
  async function execute(owner, kit) {
    const jobId = owner.jobId, directory = owner.directory, kitDirectory = path.join(directory, 'kit'), output = path.join(directory, 'returned');
    try {
      const runtimeSha256 = await fileHash(blenderPath);
      if (owner.stopReason) throw fail(owner.stopReason);
      check(describeBlenderOperation().implementation.sha256 === owner.implementationSha256, 'DCC_REHEARSAL_IMPLEMENTATION_CHANGED_RESTART_REQUIRED', 409);
      // Hashing the runtime yields to authoring requests. Recheck the queued
      // source/shot dependencies before creating or launching a stale rehearsal.
      buildCameraExchange({ project: store.resolvedProject(), records: store.rawList() }, {
        sceneId: kit.sceneId, expectedSourceHash: kit.sourceHash, expectedBasisHash: kit.basisSha256,
      });
      fs.mkdirSync(kitDirectory, { mode: 0o700 });
      for (const file of kit.files) { check(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file.path) && sha256(file.content) === file.sha256, 'DCC_REHEARSAL_KIT_INVALID', 422); fs.writeFileSync(path.join(kitDirectory, file.path), file.content, { flag: 'wx', mode: 0o600 }); }
      const reopenScript = fs.readFileSync(new URL('../integrations/three-d/blender-stage-reopen.py', import.meta.url));
      fs.writeFileSync(path.join(directory, 'reopen.py'), reopenScript, { flag: 'wx', mode: 0o600 });
      publish(jobs.get(jobId), { phase: 'RUNNING', runtimeSha256, reopenScriptSha256: sha256(reopenScript) });
      const flags = ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '17'];
      await runProcess(owner, [...flags, '--python', path.join(kitDirectory, 'blender-stage.py'), '--', '--output', output, '--render'], 'blender.log');
      if (owner.stopReason) throw fail(owner.stopReason);
      publish(jobs.get(jobId), { phase: 'VERIFYING', processExited: false });
      await runProcess(owner, [...flags, '--python', path.join(directory, 'reopen.py'), '--', '--kit', kitDirectory, '--returned', output, '--receipt', path.join(directory, 'reopen.json')], 'reopen.log');
      if (owner.stopReason) throw fail(owner.stopReason);
      check(await fileHash(blenderPath) === runtimeSha256, 'DCC_REHEARSAL_RUNTIME_CHANGED', 409);
      if (owner.stopReason) throw fail(owner.stopReason);
      check(describeBlenderOperation().implementation.sha256 === owner.implementationSha256, 'DCC_REHEARSAL_IMPLEMENTATION_CHANGED_RESTART_REQUIRED', 409);
      const files = readDccStageReturnDirectory(output), evidence = readJson(path.join(directory, 'reopen.json'));
      check(evidence.schemaVersion === 'caniscreenwrite-blender-reopen/v1' && evidence.kitFilesSha256 === kit.files.find(file => file.path === 'files.json').sha256
        && evidence.sceneFileSha256 === sha256(files['rehearsal.blend']) && evidence.reopenedVerified === true && evidence.embeddedInputsExact === true && evidence.cameraReadbackMatches === true && evidence.sceneFileUnchanged === true && evidence.approvalGranted === false, 'DCC_REHEARSAL_REOPEN_FAILED', 422);
      const imported = importDccStageReturn(store, { sceneId: kit.sceneId, files: Object.entries(files).map(([name, bytes]) => ({ name, base64: bytes.toString('base64') })) });
      publish(jobs.get(jobId), { phase: 'RETAINED', processExited: true, executionVerified: true, reopenedVerified: true,
        returnReceiptSha256: imported.return.receiptSha256, reopenEvidenceSha256: sha256(fs.readFileSync(path.join(directory, 'reopen.json'))), error: null });
    } catch (error) {
      publish(jobs.get(jobId), { phase: owner.stopReason === 'DCC_REHEARSAL_STOPPED' ? 'STOPPED' : 'FAILED', error: error.code?.startsWith('DCC_') ? error.code : 'DCC_REHEARSAL_FAILED', processExited: !owner.child });
    } finally { if (active === owner) active = null; }
  }
  function start(input) {
    check(!receiptStorageFailed, 'DCC_REHEARSAL_STORAGE_UNAVAILABLE', 503);
    check(!closed && object(input) && Object.keys(input).sort().join(',') === 'jobId,options' && uuid(input.jobId), 'DCC_REHEARSAL_INPUT_INVALID', 422);
    const requestSha256 = sha256(canonical(input)), existing = jobs.get(input.jobId);
    if (existing) { check(existing.requestSha256 === requestSha256, 'DCC_REHEARSAL_RETRY_CONFLICT', 409); return existing; }
    check(!active, 'DCC_REHEARSAL_BUSY', 409); check(runtime().available, 'DCC_BLENDER_NOT_CONFIGURED', 409);
    check(input.options?.target === 'BLENDER', 'DCC_REHEARSAL_BLENDER_ONLY', 422);
    const operation = describeBlenderOperation();
    check(operation.implementation.sha256 === initialImplementationSha256, 'DCC_REHEARSAL_IMPLEMENTATION_CHANGED_RESTART_REQUIRED', 409);
    const kit = buildDccStageKit({ project: store.resolvedProject(), records: store.rawList() }, input.options);
    retainDccStageKit(store, kit);
    childDirectory(childDirectory(store.directory, 'integrations'), 'dcc-rehearsals');
    const directory = path.join(root, input.jobId); fs.mkdirSync(directory, { mode: 0o700 });
    const receipt = publish(null, { schemaVersion, jobId: input.jobId, projectId: kit.projectId, sourceHash: kit.sourceHash, sceneId: kit.sceneId, shotId: kit.shotId,
      kitSha256: kit.sha256, kitFilesSha256: kit.files.find(file => file.path === 'files.json').sha256, requestSha256, phase: 'QUEUED', createdAt: Date.now(),
      operationId: operation.id, operationVersion: operation.version, implementationSha256: operation.implementation.sha256, optionsSha256: sha256(canonical(input.options)),
      runtimePath: blenderPath, runtimeSha256: null, reopenScriptSha256: null, outputDirectory: directory, processExited: false,
      returnReceiptSha256: null, reopenEvidenceSha256: null, executionVerified: false, reopenedVerified: false, approvalGranted: false, finalMedia: false, error: null });
    const owner = { jobId: input.jobId, directory, implementationSha256: operation.implementation.sha256, child: null, stopReason: null, terminate: null, done: null }; active = owner;
    // The failure receipt may itself fail (for example, a full disk). Consume
    // that rejection without fabricating a terminal receipt or exit evidence.
    owner.done = execute(owner, kit).catch(() => { receiptStorageFailed = true; }); return receipt;
  }
  function stop(input) {
    check(object(input) && Object.keys(input).join(',') === 'jobId' && uuid(input.jobId), 'DCC_REHEARSAL_INPUT_INVALID', 422);
    const receipt = jobs.get(input.jobId); check(receipt, 'DCC_REHEARSAL_NOT_FOUND', 404);
    if (active?.jobId !== input.jobId) return receipt;
    active.stopReason = 'DCC_REHEARSAL_STOPPED'; active.terminate?.(); return publish(receipt, { phase: 'STOPPING' });
  }
  function qualify(kit, options, operation) {
    check(!receiptStorageFailed, 'DCC_REHEARSAL_STORAGE_UNAVAILABLE', 503);
    return qualifyBlenderOperation({ kit, options, operation, jobs: [...jobs.values()], runtime: runtime(), verifyRetained });
  }
  return { list, start, stop, qualify, async close() { closed = true; if (active) { const owner = active; owner.stopReason = 'DCC_REHEARSAL_STOPPED'; owner.terminate?.(); await owner.done; } } };
}
