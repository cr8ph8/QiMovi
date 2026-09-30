import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { canonical, check, PilotError } from './storage.mjs';
import { PRESERVATION_LIMITS as LIMITS, PRESERVATION_SCOPE, preservationSummary, validatePreservationInventoryItem, validatePreservationManifest, validatePreservationRequest } from '../contracts/preservation-integrity.mjs';

const SHA = /^[a-f0-9]{64}$/;
const JOB_FILE = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.json$/;
const now = () => new Date().toISOString();
const clone = value => structuredClone(value);
const sameFile = (a, b) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
const sameDirectory = (a, b) => a.dev === b.dev && a.ino === b.ino;
const summaryOf = ({ jobId, projectId, requestId, status, createdAt, updatedAt, completedAt, summary, evidencePath }) => ({ jobId, projectId, requestId, status, createdAt, updatedAt, completedAt, summary, evidencePath });

// Apply the canonical serializer only to individual bounded entries. The
// aggregate can legitimately exceed its 10,000-node single-record ceiling.
export function preservationManifestHash(manifest) {
  const hash = crypto.createHash('sha256');
  hash.update('{');
  Object.keys(manifest).filter(key => key !== 'sha256').sort().forEach((key, index) => {
    if (index) hash.update(',');
    hash.update(JSON.stringify(key)); hash.update(':');
    if (['items', 'results'].includes(key)) {
      hash.update('[');
      manifest[key].forEach((value, itemIndex) => { if (itemIndex) hash.update(','); hash.update(canonical(value)); });
      hash.update(']');
    } else hash.update(canonical(manifest[key]));
  });
  hash.update('}'); return hash.digest('hex');
}

function cleanHint(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && value.isWellFormed() && !/[\\/\x00-\x1f\x7f]/.test(value) && !['.', '..'].includes(value) ? value : null;
}

/** Registered rows are the inventory authority; record mentions supply hints,
 * never read locations. Historical mentions remain useful for orphaned files. */
function inventory(store) {
  const rows = store.db.prepare('SELECT sha256,byte_length,mime_type FROM blobs ORDER BY sha256 LIMIT ?').all(LIMITS.inventoryItems + 1);
  check(rows.length <= LIMITS.inventoryItems, 'PRESERVATION_INVENTORY_LIMIT', 413);
  const items = new Map(rows.map(row => {
    const item = { sha256: row.sha256, byteLength: row.byte_length, mimeType: row.mime_type, filenameHints: [], referenceCount: 0 };
    validatePreservationInventoryItem(item); return [item.sha256, item];
  }));
  const visit = (data, mentions) => {
    const stack = [data]; let nodes = 0;
    while (stack.length) {
      const value = stack.pop(); check(++nodes <= 10000, 'PRESERVATION_RECORD_LIMIT', 413);
      if (!value || typeof value !== 'object') continue;
      if (!Array.isArray(value)) {
        for (const [key, entry] of Object.entries(value)) if ((key === 'sha256' || /Hash$/.test(key)) && typeof entry === 'string' && items.has(entry)) mentions.add(entry);
        const hint = cleanHint(value.originalFilename) ?? cleanHint(value.filename);
        if (hint) for (const hash of [value.asset?.sha256, value.assetHash, value.blob?.sha256, value.original?.sha256, value.sha256, value.imageHash, value.mediaHash]) {
          const item = items.get(hash);
          if (item && !item.filenameHints.includes(hint) && item.filenameHints.length < LIMITS.filenameHints) item.filenameHints.push(hint);
        }
      }
      for (const entry of Object.values(value)) if (entry && typeof entry === 'object') stack.push(entry);
    }
  };
  const project = store.baseProject();
  const projectMentions = new Set(); visit(project, projectMentions);
  for (const hash of projectMentions) items.get(hash).referenceCount++;
  let recordCount = 0, recordBytes = 0;
  for (const row of store.db.prepare('SELECT data,sha256 FROM records ORDER BY id,version').iterate()) {
    const byteLength = Buffer.byteLength(row.data); recordBytes += byteLength;
    check(++recordCount <= 100000 && byteLength <= 2 * 1024 ** 2 && recordBytes <= 128 * 1024 ** 2, 'PRESERVATION_RECORD_LIMIT', 413);
    const data = JSON.parse(row.data);
    check(crypto.createHash('sha256').update(canonical(data)).digest('hex') === row.sha256, 'PRESERVATION_RECORD_HASH_MISMATCH', 409);
    const mentions = new Set(); visit(data, mentions);
    for (const hash of mentions) items.get(hash).referenceCount++;
  }
  for (const item of items.values()) item.filenameHints.sort();
  return [...items.values()];
}

/** The constructor performs no disk or database work. */
export function createPreservationIntegrityService(store) {
  let root, rootIdentity, active = null, closed = false;
  const checkedRoot = () => {
    if (!root) {
      const supplied = path.resolve(store.directory), initial = fs.lstatSync(supplied, { bigint: true });
      check(initial.isDirectory() && !initial.isSymbolicLink(), 'PRESERVATION_DIRECTORY_UNSAFE', 409);
      root = fs.realpathSync(supplied); rootIdentity = fs.lstatSync(root, { bigint: true });
      check(sameDirectory(initial, rootIdentity), 'PRESERVATION_DIRECTORY_CHANGED', 409);
    }
    const current = fs.lstatSync(root, { bigint: true });
    check(current.isDirectory() && !current.isSymbolicLink() && sameDirectory(rootIdentity, current), 'PRESERVATION_DIRECTORY_CHANGED', 409);
    return root;
  };
  // Check every path component, including canonical ancestors, on each use.
  const directory = (relative, create = false) => {
    const base = checkedRoot(), target = path.join(base, relative);
    let current = path.parse(target).root;
    for (const part of target.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part); let stat;
      try { stat = fs.lstatSync(current, { bigint: true }); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (!create) return null;
        check(current.startsWith(base + path.sep), 'PRESERVATION_DIRECTORY_UNSAFE', 409);
        fs.mkdirSync(current, { mode: 0o700 }); stat = fs.lstatSync(current, { bigint: true });
      }
      check(stat.isDirectory() && !stat.isSymbolicLink(), 'PRESERVATION_DIRECTORY_UNSAFE', 409);
    }
    return { filename: target, stat: fs.lstatSync(target, { bigint: true }) };
  };
  const projectId = () => {
    check(!closed, 'PRESERVATION_SERVICE_CLOSED', 503);
    const project = store.baseProject();
    check(project && typeof project.id === 'string', 'PRESERVATION_PROJECT_REQUIRED', 409); return project.id;
  };
  const scope = (action, input) => { validatePreservationRequest(action, input); check(input.projectId === projectId(), 'PRESERVATION_PROJECT_MISMATCH', 409); };
  const seal = job => {
    job.summary = preservationSummary(job.items, job.results); job.sha256 = preservationManifestHash(job);
    validatePreservationManifest(job); return job;
  };
  const save = job => {
    seal(job);
    const bytes = Buffer.from(JSON.stringify(job, null, 2) + '\n');
    check(bytes.length <= LIMITS.receiptBytes, 'PRESERVATION_RECEIPT_LIMIT', 413);
    const parent = directory('integrations/preservation/checks', true);
    const filename = path.join(parent.filename, `${job.jobId}.json`), temp = `${filename}.${crypto.randomUUID()}.tmp`;
    let fd;
    try {
      fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      const after = directory('integrations/preservation/checks');
      check(after && sameDirectory(parent.stat, after.stat), 'PRESERVATION_DIRECTORY_CHANGED', 409);
      try { const old = fs.lstatSync(filename); check(old.isFile() && !old.isSymbolicLink() && old.nlink === 1, 'PRESERVATION_RECEIPT_UNSAFE', 409); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      fs.renameSync(temp, filename);
      const dirFd = fs.openSync(parent.filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      // Only remove our own temporary file after confirming its parent.
      try { const safe = directory('integrations/preservation/checks'); if (safe && sameDirectory(parent.stat, safe.stat)) fs.unlinkSync(temp); } catch { /* absent temp or unsafe parent */ }
    }
    return job;
  };
  const read = id => {
    const parent = directory('integrations/preservation/checks');
    check(parent, 'PRESERVATION_JOB_NOT_FOUND', 404);
    const filename = path.join(parent.filename, `${id}.json`); let fd;
    try {
      fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const before = fs.fstatSync(fd, { bigint: true });
      check(before.isFile() && before.nlink === 1n && before.size <= BigInt(LIMITS.receiptBytes) && (before.mode & 0o077n) === 0n, 'PRESERVATION_RECEIPT_UNSAFE', 409);
      const buffer = Buffer.alloc(Number(before.size) + 1); let length = 0, count;
      while (length < buffer.length && (count = fs.readSync(fd, buffer, length, buffer.length - length, null))) length += count;
      const bytes = buffer.subarray(0, length), after = fs.fstatSync(fd, { bigint: true });
      check(sameFile(before, after) && sameFile(before, fs.lstatSync(filename, { bigint: true })) && sameDirectory(parent.stat, directory('integrations/preservation/checks').stat), 'PRESERVATION_RECEIPT_CHANGED', 409);
      const job = JSON.parse(bytes.toString('utf8')); validatePreservationManifest(job);
      check(job.jobId === id && job.projectId === projectId() && preservationManifestHash(job) === job.sha256, 'PRESERVATION_RECEIPT_HASH_MISMATCH', 409);
      return job;
    } catch (error) {
      if (error.code === 'ENOENT') throw new PilotError('PRESERVATION_JOB_NOT_FOUND', 404);
      if (error.code === 'ELOOP') throw new PilotError('PRESERVATION_RECEIPT_UNSAFE', 409);
      if (error instanceof SyntaxError) throw new PilotError('PRESERVATION_RECEIPT_INVALID', 409);
      throw error;
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  };
  const jobs = () => {
    const parent = directory('integrations/preservation/checks'); if (!parent) return [];
    const names = fs.readdirSync(parent.filename);
    check(names.length <= LIMITS.jobs * 2, 'PRESERVATION_JOB_LIMIT', 413);
    const files = names.filter(name => JOB_FILE.test(name)).sort();
    check(files.length <= LIMITS.jobs, 'PRESERVATION_JOB_LIMIT', 413);
    let totalBytes = 0;
    return files.map(file => {
      totalBytes += fs.lstatSync(path.join(parent.filename, file)).size;
      check(totalBytes <= 64 * 1024 ** 2, 'PRESERVATION_RECEIPT_INVENTORY_LIMIT', 413);
      const job = read(file.slice(0, -5));
      if (job.status === 'RUNNING' && active?.job.jobId !== job.jobId) {
        job.status = 'INTERRUPTED'; job.updatedAt = now(); save(job);
      }
      return job;
    });
  };
  const inspect = async (item, run) => {
    const result = { sha256: item.sha256, expectedByteLength: item.byteLength, status: 'UNREADABLE', startedAt: now(), checkedAt: now(), observedSha256: null, observedByteLength: null, reason: 'READ_FAILED' };
    let handle, before, parent, reading = false;
    try {
      parent = directory('blobs');
      if (!parent) { result.status = 'MISSING'; result.reason = 'REGISTERED_COPY_MISSING'; return result; }
      const filename = path.join(parent.filename, item.sha256), leaf = fs.lstatSync(filename, { bigint: true });
      check(leaf.isFile() && !leaf.isSymbolicLink(), 'UNSAFE_FILE_TYPE', 409);
      handle = await fs.promises.open(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      before = await handle.stat({ bigint: true });
      check(before.isFile() && sameFile(leaf, before) && sameDirectory(parent.stat, directory('blobs').stat), 'FILE_CHANGED', 409);
      if (before.size <= BigInt(Number.MAX_SAFE_INTEGER)) result.observedByteLength = Number(before.size);
      check(before.size <= BigInt(LIMITS.fileBytes), 'FILE_BYTE_LIMIT', 413);
      check(before.size <= BigInt(LIMITS.jobBytes - run.bytes), 'JOB_BYTE_LIMIT', 413);
      result.observedByteLength = Number(before.size);
      const hash = crypto.createHash('sha256'), buffer = Buffer.allocUnsafe(256 * 1024); let length = 0; reading = true;
      while (true) {
        if (run.stop) return null;
        const count = (await handle.read(buffer, 0, buffer.length, null)).bytesRead;
        if (!count) break;
        length += count; run.bytes += count;
        check(length <= LIMITS.fileBytes && run.bytes <= LIMITS.jobBytes && BigInt(length) <= before.size, 'FILE_BYTE_LIMIT', 413);
        hash.update(buffer.subarray(0, count));
        await yieldTurn();
      }
      if (run.stop) return null;
      const after = await handle.stat({ bigint: true });
      const retained = fs.lstatSync(filename, { bigint: true }), parentAfter = directory('blobs');
      result.observedByteLength = length;
      result.observedSha256 = hash.digest('hex');
      if (!sameFile(before, after) || !sameFile(before, retained) || !parentAfter || !sameDirectory(parent.stat, parentAfter.stat) || BigInt(length) !== before.size) {
        result.status = 'CHANGED_DURING_CHECK'; result.reason = 'FILE_CHANGED';
      } else if (result.observedSha256 === item.sha256 && length === item.byteLength) {
        result.status = 'MATCH'; result.reason = null;
      } else { result.status = 'MISMATCH'; result.reason = 'REGISTERED_HASH_OR_LENGTH_DIFFERS'; }
    } catch (error) {
      result.observedSha256 = null;
      if (error.code === 'FILE_CHANGED' || reading && ['ENOENT', 'ENOTDIR', 'ELOOP', 'FILE_BYTE_LIMIT', 'PRESERVATION_DIRECTORY_UNSAFE', 'PRESERVATION_DIRECTORY_CHANGED'].includes(error.code)) { result.status = 'CHANGED_DURING_CHECK'; result.reason = error.code === 'FILE_BYTE_LIMIT' ? 'FILE_GREW_BEYOND_LIMIT' : 'FILE_CHANGED'; }
      else if (error.code === 'ENOENT') { result.status = 'MISSING'; result.reason = 'REGISTERED_COPY_MISSING'; result.observedByteLength = null; }
      else { result.status = 'UNREADABLE'; result.reason = ['UNSAFE_FILE_TYPE', 'ELOOP', 'EACCES', 'EPERM', 'FILE_BYTE_LIMIT', 'JOB_BYTE_LIMIT'].includes(error.code) ? error.code : 'UNSAFE_PATH_OR_READ_FAILED'; }
    } finally { if (handle) await handle.close(); result.checkedAt = now(); }
    return result;
  };
  const launch = job => {
    check(!active, 'PRESERVATION_JOB_ALREADY_RUNNING', 409);
    const run = { job, stop: null, promise: null, bytes: job.results.reduce((sum, result) => sum + (result.observedSha256 ? result.observedByteLength : 0), 0) }; active = run;
    run.promise = (async () => {
      await yieldTurn();
      try {
        while (!run.stop && job.results.length < job.items.length) {
          const result = await inspect(job.items[job.results.length], run);
          if (result) { job.results.push(result); job.updatedAt = now(); save(job); }
        }
        job.status = run.stop ?? 'COMPLETED'; job.updatedAt = now();
        job.completedAt = job.status === 'COMPLETED' ? job.updatedAt : null; save(job);
      } catch (error) {
        job.status = 'INTERRUPTED'; job.updatedAt = now(); job.completedAt = null;
        run.error = error;
        try { save(job); } catch { /* The last atomic checkpoint remains authoritative. */ }
      } finally { if (active === run) active = null; }
    })();
  };
  const get = input => {
    scope('get', input); const job = jobs().find(row => row.jobId === input.jobId);
    check(job, 'PRESERVATION_JOB_NOT_FOUND', 404); return clone(job);
  };
  return {
    catalog() {
      const id = projectId(); return { schemaVersion: 'qimovi-preservation-catalog/v1', projectId: id, scope: PRESERVATION_SCOPE, limits: { ...LIMITS }, items: inventory(store), jobs: jobs().map(summaryOf).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
    },
    start(input) {
      scope('start', input); const saved = jobs(), hashes = [...input.hashes].sort();
      const prior = saved.find(job => job.requestId === input.requestId);
      if (prior) {
        check(prior.items.length === hashes.length && prior.items.every((item, index) => item.sha256 === hashes[index]), 'PRESERVATION_REQUEST_ID_CONFLICT', 409);
        return clone(prior);
      }
      check(!active, 'PRESERVATION_JOB_ALREADY_RUNNING', 409);
      check(saved.length < LIMITS.jobs, 'PRESERVATION_JOB_LIMIT', 413);
      const available = new Map(inventory(store).map(item => [item.sha256, item]));
      const items = hashes.map(hash => { const item = available.get(hash); check(item, 'PRESERVATION_BLOB_NOT_REGISTERED', 422); return item; });
      check(items.every(item => item.byteLength <= LIMITS.fileBytes) && items.reduce((sum, item) => sum + item.byteLength, 0) <= LIMITS.jobBytes, 'PRESERVATION_BYTE_LIMIT', 413);
      const id = crypto.randomUUID(), createdAt = now();
      const job = save({ schemaVersion: 'qimovi-preservation-check/v1', jobId: id, projectId: input.projectId, requestId: input.requestId, status: 'RUNNING', createdAt, updatedAt: createdAt, completedAt: null, items, results: [], summary: preservationSummary(items, []), evidencePath: `integrations/preservation/checks/${id}.json`, scope: PRESERVATION_SCOPE, sha256: '0'.repeat(64) });
      launch(job); return clone(job);
    },
    get,
    resume(input) {
      scope('resume', input); const job = get(input);
      if (job.status === 'COMPLETED' || job.status === 'RUNNING') return job;
      check(!active, 'PRESERVATION_JOB_ALREADY_RUNNING', 409);
      const registered = new Map(inventory(store).map(item => [item.sha256, item]));
      check(job.items.every(item => registered.get(item.sha256)?.byteLength === item.byteLength && registered.get(item.sha256)?.mimeType === item.mimeType), 'PRESERVATION_REGISTRATION_CHANGED', 409);
      job.status = 'RUNNING'; job.updatedAt = now(); save(job); launch(job); return clone(job);
    },
    async cancel(input) {
      scope('cancel', input); const job = get(input);
      if (job.status === 'COMPLETED' || job.status === 'CANCELLED') return job;
      if (active?.job.jobId === input.jobId) { active.stop = 'CANCELLED'; await active.promise; return get(input); }
      job.status = 'CANCELLED'; job.updatedAt = now(); return clone(save(job));
    },
    async close() {
      if (closed) return;
      if (active) { active.stop = 'INTERRUPTED'; await active.promise; }
      closed = true;
    },
  };
}
