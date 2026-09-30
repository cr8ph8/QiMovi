#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

// This process belongs to one native parent. Its only stdout message is the
// ready envelope. Owner credentials stay in the existing private config file.
const safeCodes = new Set([
  'NODE_24_10_OR_NEWER_REQUIRED', 'INVALID_DESKTOP_ARGUMENTS',
  'ABSOLUTE_DESKTOP_PATH_REQUIRED', 'DESKTOP_EPHEMERAL_PORT_REQUIRED',
  'DESKTOP_DATA_DIRECTORY_INVALID', 'DESKTOP_WORKSPACE_FILE_INVALID',
  'DESKTOP_DIST_DIRECTORY_INVALID', 'DESKTOP_DIST_ENTRY_INVALID',
  'LOCAL_PILOT_ALREADY_RUNNING', 'PROCESS_LOCK_REQUIRES_INSPECTION',
  'PROCESS_LOCK_CONFLICT', 'DATA_DIRECTORY_SYMLINK', 'RUN_INIT_FIRST',
  'CONFIG_SYMLINK', 'CONFIG_PERMISSIONS_TOO_OPEN', 'INVALID_CONFIG',
  'PROJECT_NOT_SEEDED', 'CANONICAL_DATABASE_MISSING_RESTORE_REQUIRED',
  'KERNEL_POLICY_CHANGED', 'KERNEL_POLICY_MISSING_RESTORE_REQUIRED',
  'CANONICAL_TITLE_MISSING_RESTORE_REQUIRED',
]);
const reject = code => { throw Object.assign(new Error(code), { code }); };
function directoryExists(filename, code) {
  try { if (!fs.lstatSync(filename).isDirectory()) reject(code); }
  catch { reject(code); }
}
function regularFile(filename, code) {
  try { if (!fs.lstatSync(filename).isFile()) reject(code); }
  catch { reject(code); }
}
function configuration(args) {
  const options = {};
  if (args.length !== 6) reject('INVALID_DESKTOP_ARGUMENTS');
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!['--data', '--dist', '--port'].includes(key) || Object.hasOwn(options, key) || !value) reject('INVALID_DESKTOP_ARGUMENTS');
    options[key] = value;
  }
  if (!path.isAbsolute(options['--data']) || !path.isAbsolute(options['--dist'])) reject('ABSOLUTE_DESKTOP_PATH_REQUIRED');
  if (options['--port'] !== '0') reject('DESKTOP_EPHEMERAL_PORT_REQUIRED');
  const directory = path.normalize(options['--data']), dist = path.normalize(options['--dist']);
  directoryExists(directory, 'DESKTOP_DATA_DIRECTORY_INVALID');
  // Opening a wrong folder must not initialize a database or a new identity.
  for (const filename of ['config.json', 'workspace.sqlite', 'canonical.sqlite', 'kernel-policy.json']) {
    regularFile(path.join(directory, filename), 'DESKTOP_WORKSPACE_FILE_INVALID');
  }
  directoryExists(path.join(directory, 'blobs'), 'DESKTOP_WORKSPACE_FILE_INVALID');
  directoryExists(dist, 'DESKTOP_DIST_DIRECTORY_INVALID');
  const entry = fs.existsSync(path.join(dist, 'drifter.html')) ? 'drifter.html' : 'index.html';
  regularFile(path.join(dist, entry), 'DESKTOP_DIST_ENTRY_INVALID');
  return { directory, dist, port: 0 };
}

let service;
let stopRequested = false;
let closing;
async function stop() {
  stopRequested = true;
  if (!service || closing) return closing;
  closing = (async () => {
    // Existing HTTP request timeouts normally finish earlier. If shutdown is
    // stuck, a dead-PID lock remains recoverable by the existing lock contract.
    const deadline = setTimeout(() => {
      process.stderr.write(JSON.stringify({ type: 'error', code: 'DESKTOP_SHUTDOWN_TIMEOUT' }) + '\n');
      process.exit(1);
    }, 20_000);
    try {
      await service.close();
      clearTimeout(deadline);
      process.exit(0);
    } catch {
      process.stderr.write(JSON.stringify({ type: 'error', code: 'DESKTOP_SHUTDOWN_FAILED' }) + '\n');
      process.exit(1);
    }
  })();
  return closing;
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
process.stdin.once('end', stop);
process.stdin.once('close', stop);
process.stdin.once('error', stop);
process.stdin.resume(); // The native parent retains the write end until quitting.

try {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 24 || (major === 24 && minor < 10)) reject('NODE_24_10_OR_NEWER_REQUIRED');
  const options = configuration(process.argv.slice(2));
  const { startServer } = await import('../server/http.mjs');
  const { validateRecord } = await import('../contracts/drifter.mjs');
  if (stopRequested) process.exit(0);
  service = await startServer({ ...options, validateRecord });
  if (stopRequested) await stop();
  else process.stdout.write(JSON.stringify({ type: 'ready', origin: service.origin, pid: process.pid }) + '\n');
} catch (error) {
  const code = safeCodes.has(error?.code) ? error.code : 'DESKTOP_STARTUP_FAILED';
  process.stderr.write(JSON.stringify({ type: 'error', code }) + '\n');
  process.exit(1);
}
