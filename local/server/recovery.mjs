import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { check, sha256, canonical, privateDirectory, atomicPrivateFile, acquireLock, WorkspaceStore, assertSqliteDatabasePath } from './storage.mjs';
import { openOwnerKernel } from './kernel.mjs';
import { assertReplayMatches } from '../kernel/src/index.mjs';

function files(directory, relative = '') {
  return fs.readdirSync(path.join(directory, relative)).sort().flatMap(name => {
    if (!relative && ['process.lock', 'config.json'].includes(name)) return [];
    const item = path.join(relative, name);
    const stat = fs.lstatSync(path.join(directory, item));
    check(!stat.isSymbolicLink(), 'BACKUP_SYMLINK_REJECTED');
    return stat.isDirectory() ? files(directory, item) : [item];
  });
}
function assertDatabase(filename, checkpoint = false) {
  // Read/write open lets SQLite clean up its own empty WAL/SHM files on close.
  // A read-only WAL connection can leave those sidecars behind after integrity_check.
  check(assertSqliteDatabasePath(filename), 'BACKUP_DATABASE_MISSING', 409);
  const db = new DatabaseSync(filename);
  try {
    check(db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok', 'SQLITE_INTEGRITY_FAILED');
    if (checkpoint) check(db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy === 0, 'SQLITE_CHECKPOINT_BUSY');
  }
  finally { db.close(); }
}
export function verifyBackup(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'backup-manifest.json'), 'utf8'));
  check(manifest.schema_version === 'filmstack-local-backup/v1' && Array.isArray(manifest.files), 'INVALID_BACKUP');
  const root = fs.realpathSync(directory); const names = new Set();
  for (const item of manifest.files) {
    check(typeof item.path === 'string' && !['config.json', 'process.lock', 'backup-manifest.json'].includes(item.path) && !path.isAbsolute(item.path) && !item.path.split(/[\\/]/).some(p => p === '..' || p === '.') && !names.has(item.path), 'INVALID_BACKUP_PATH');
    names.add(item.path);
    const target = fs.realpathSync(path.join(root, item.path));
    check(target.startsWith(root + path.sep), 'BACKUP_PATH_ESCAPES_ROOT');
    const bytes = fs.readFileSync(target);
    check(bytes.length === item.bytes && sha256(bytes) === item.sha256, 'BACKUP_HASH_MISMATCH');
  }
  check(names.has('workspace.sqlite') && names.has('canonical.sqlite') && names.has('kernel-policy.json'), 'BACKUP_DATABASE_MISSING');
  check(files(root).filter(name => name !== 'backup-manifest.json').every(name => names.has(name)), 'BACKUP_UNLISTED_FILE');
  assertDatabase(path.join(root, 'workspace.sqlite'));
  assertDatabase(path.join(root, 'canonical.sqlite'));
  return manifest;
}
export function createBackup(directory, output) {
  check(path.resolve(output) !== path.resolve(directory) && !path.resolve(output).startsWith(path.resolve(directory) + path.sep), 'BACKUP_MUST_BE_OUTSIDE_LIVE_DATA');
  check(!fs.existsSync(output), 'BACKUP_DESTINATION_EXISTS', 409);
  const unlock = acquireLock(directory);
  try {
    for (const name of ['workspace.sqlite', 'canonical.sqlite']) assertDatabase(path.join(directory, name), true);
    const entries = files(directory);
    check(!entries.some(name => /-(wal|journal|shm)$/.test(name)), 'DATABASE_SIDECAR_REQUIRES_CLEAN_CLOSE');
    privateDirectory(output);
    const manifest = { schema_version: 'filmstack-local-backup/v1', createdAt: new Date().toISOString(), credentialsIncluded: false, files: [] };
    for (const name of entries) {
      const bytes = fs.readFileSync(path.join(directory, name));
      fs.mkdirSync(path.dirname(path.join(output, name)), { recursive: true, mode: 0o700 });
      atomicPrivateFile(path.join(output, name), bytes);
      manifest.files.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) });
    }
    atomicPrivateFile(path.join(output, 'backup-manifest.json'), canonical(manifest));
    verifyBackup(output);
    return { files: manifest.files.length, manifestSha256: sha256(canonical(manifest)), credentialsIncluded: false };
  } finally { unlock(); }
}
export function restoreBackup(backup, destination, validateRecord) {
  check(path.resolve(destination) !== path.resolve(backup) && !path.resolve(destination).startsWith(path.resolve(backup) + path.sep), 'RESTORE_MUST_BE_OUTSIDE_BACKUP');
  check(!fs.existsSync(destination), 'RESTORE_DESTINATION_EXISTS', 409);
  const manifest = verifyBackup(backup);
  privateDirectory(destination);
  // A restore receives a fresh owner credential through the ordinary init command.
  for (const item of manifest.files) {
    const target = path.join(destination, item.path);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    atomicPrivateFile(target, fs.readFileSync(path.join(backup, item.path)));
  }
  let store, kernel;
  try {
    store = new WorkspaceStore(destination, validateRecord);
    check(store.project(), 'RESTORED_PROJECT_MISSING');
    const records = store.list();
    // Validate each complete identity before interpreting its latest row: a
    // forged later kind must not hide immutable originals or corrupt history.
    for (const row of records) store.history(row.id);
    for (const row of records) store.validateSavedRecord(row);
    for (const row of store.db.prepare('SELECT sha256 FROM blobs').all()) store.blobInfo(row.sha256);
    kernel = openOwnerKernel(destination, store.project());
    assertReplayMatches(kernel.runtime.readModel.listEvents(), id => kernel.runtime.readModel.getAggregate(id));
    return { projectId: store.project().id, records: store.list().length, canonicalStateHash: kernel.runtime.readModel.getAggregate(store.project().id).state_hash, eventReplayVerified: true, ownerCredential: 'NEW_INIT_REQUIRED' };
  } finally { kernel?.runtime.close(); store?.close(); }
}
