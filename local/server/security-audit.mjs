import fs from 'node:fs';
import path from 'node:path';

const MAXIMUM_BYTES = 1024 * 1024;
const WINDOW_MS = 60_000;
const CODES = new Set([
  'HOST_REJECTED', 'ORIGIN_REJECTED', 'EXACT_ORIGIN_REQUIRED',
  'OWNER_TOKEN_REJECTED', 'OWNER_SESSION_REQUIRED', 'SESSION_RATE_LIMITED',
  'JSON_REQUIRED', 'INVALID_JSON', 'REQUEST_TOO_LARGE', 'INVALID_PATH',
  'STATIC_PATH_REJECTED', 'NOT_FOUND', 'METHOD_NOT_ALLOWED',
  'HIGGSFIELD_MCP_CALLBACK_REJECTED', 'HIGGSFIELD_MCP_SIGN_IN_FAILED',
  'HIGGSFIELD_MCP_SIGN_IN_REQUIRED', 'HIGGSFIELD_MCP_ACTION_NOT_AVAILABLE',
  'SOURCE_ADMISSION_REQUIRED', 'STALE_VERSION', 'REQUEST_ID_CONFLICT',
  'LORE_REQUIRES_TRUSTED_IMPORT', 'CAMERA_PROOFS_REQUIRE_VERIFIED_IMPORT',
  'MEDIA_REQUIRES_TRUSTED_SERVICE', 'PROJECT_ASSET_REQUIRES_TRUSTED_IMPORT',
  'USAGE_TRUSTED_IMPORT_REQUIRED', 'RECORD_IDENTITY_MISMATCH', 'REQUEST_REJECTED',
]);
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'OTHER']);
const ROUTES = new Set(['SESSION', 'API', 'STATIC', 'OAUTH', 'UNKNOWN']);
const STATUSES = new Set([400, 401, 403, 404, 405, 409, 413, 415, 422, 429]);
const keys = ['schema', 'sequence', 'atMs', 'code', 'status', 'method', 'route'];

function privateRegular(stat) {
  return stat.isFile() && stat.nlink === 1 && (stat.mode & 0o077) === 0;
}
function validRow(row, sequence) {
  return row && typeof row === 'object' && !Array.isArray(row)
    && Object.keys(row).sort().join(',') === [...keys].sort().join(',')
    && row.schema === 'qimovi-security-denial/v1' && row.sequence === sequence
    && Number.isSafeInteger(row.atMs) && row.atMs >= 0
    && CODES.has(row.code) && STATUSES.has(row.status)
    && METHODS.has(row.method) && ROUTES.has(row.route);
}

/**
 * Operational observations only, never owner approval or canonical evidence.
 * The fixed vocabulary intentionally excludes request URLs, query strings,
 * headers, payloads, project IDs, filenames and provider/error messages.
 * Logging failure must not change the HTTP request's original disposition.
 */
export function createLocalSecurityAudit({ directory, now = Date.now, maximumBytes = MAXIMUM_BYTES }) {
  let state = 'ACTIVE', retainedEvents = 0, suppressedEvents = 0, bytesUsed = 0, fd = null;
  // At most CODES × METHODS × ROUTES × STATUSES entries: input cannot grow keys.
  const lastRecorded = new Map();
  const filename = path.join(directory, 'security-audit.jsonl');
  const increment = value => Math.min(Number.MAX_SAFE_INTEGER, value + 1);
  const unavailable = () => {
    state = 'UNAVAILABLE';
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* Retain the failure state. */ } fd = null; }
  };
  const status = () => ({ state, retainedEvents, suppressedEvents, bytesUsed, maximumBytes });
  const verifyFile = () => {
    const file = fs.fstatSync(fd), entry = fs.lstatSync(filename);
    if (!privateRegular(file) || !privateRegular(entry) || entry.isSymbolicLink()
      || file.dev !== entry.dev || file.ino !== entry.ino || file.size !== bytesUsed) throw new Error('audit-file-changed');
  };

  try {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 256 || maximumBytes > MAXIMUM_BYTES
      || typeof now !== 'function') throw new Error('audit-options');
    const directoryStat = fs.lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || (directoryStat.mode & 0o077) !== 0) throw new Error('audit-directory');
    // Do not follow links or alter permissions on an existing insecure file.
    if (fs.existsSync(filename) && !privateRegular(fs.lstatSync(filename))) throw new Error('audit-file');
    fd = fs.openSync(filename, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW, 0o600);
    bytesUsed = fs.fstatSync(fd).size;
    if (bytesUsed > maximumBytes) throw new Error('audit-size');
    verifyFile();
    const bytes = Buffer.alloc(bytesUsed);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new Error('audit-truncated');
      offset += count;
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text && !text.endsWith('\n')) throw new Error('audit-incomplete');
    for (const line of text ? text.slice(0, -1).split('\n') : []) {
      const row = JSON.parse(line);
      if (!validRow(row, retainedEvents + 1)) throw new Error('audit-invalid');
      retainedEvents += 1;
    }
    if (bytesUsed === maximumBytes) state = 'CAPACITY_REACHED';
  } catch { unavailable(); }

  function recordDenied(input) {
    if (state !== 'ACTIVE') return false;
    try {
      if (!input || !STATUSES.has(input.status)) return false;
      const code = CODES.has(input.code) ? input.code : 'REQUEST_REJECTED';
      const method = METHODS.has(input.method) ? input.method : 'OTHER';
      const route = ROUTES.has(input.route) ? input.route : 'UNKNOWN';
      const atMs = now();
      if (!Number.isSafeInteger(atMs) || atMs < 0) throw new Error('audit-time');
      const key = `${code}:${input.status}:${method}:${route}`;
      const previous = lastRecorded.get(key);
      if (previous !== undefined && atMs >= previous && atMs - previous < WINDOW_MS) {
        suppressedEvents = increment(suppressedEvents); return false;
      }
      const row = { schema: 'qimovi-security-denial/v1', sequence: retainedEvents + 1, atMs, code, status: input.status, method, route };
      const bytes = Buffer.from(JSON.stringify(row) + '\n');
      if (bytesUsed + bytes.length > maximumBytes) { state = 'CAPACITY_REACHED'; return false; }
      verifyFile();
      const written = fs.writeSync(fd, bytes);
      // A partial write is retained for diagnosis, never repaired by deletion.
      bytesUsed += written;
      if (written !== bytes.length) throw new Error('audit-short-write');
      fs.fsyncSync(fd);
      retainedEvents += 1;
      lastRecorded.set(key, atMs);
      return true;
    } catch { unavailable(); return false; }
  }

  return { recordDenied, status, close: unavailable };
}
