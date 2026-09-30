export const PRESERVATION_SCOPE = 'Checks only the retained workspace copy against its registered SHA-256 and byte length at the recorded check time. It does not establish an external backup, media decodability, rights, or archive readiness.';
export const PRESERVATION_LIMITS = Object.freeze({ inventoryItems: 10000, jobItems: 1000, fileBytes: 64 * 1024 ** 3, jobBytes: 256 * 1024 ** 3, jobs: 200, receiptBytes: 16 * 1024 ** 2, filenameHints: 16 });
export const PRESERVATION_ITEM_STATUSES = Object.freeze(['MATCH', 'MISMATCH', 'MISSING', 'UNREADABLE', 'CHANGED_DURING_CHECK']);
export const PRESERVATION_JOB_STATUSES = Object.freeze(['RUNNING', 'INTERRUPTED', 'CANCELLED', 'COMPLETED']);
const fail = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code, status: 422 }); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, fields) => fail(plain(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key)), 'PRESERVATION_FIELDS_INVALID');
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value.isWellFormed() && !/[\x00-\x1f\x7f]/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identity = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value);
const jobId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const size = value => Number.isSafeInteger(value) && value >= 0;

export function validatePreservationRequest(action, input) {
  exact(input, action === 'start' ? ['projectId', 'requestId', 'hashes'] : ['projectId', 'jobId']);
  fail(identity(input.projectId), 'PRESERVATION_PROJECT_INVALID');
  if (action === 'start') {
    fail(text(input.requestId, 160), 'PRESERVATION_REQUEST_ID_INVALID');
    fail(Array.isArray(input.hashes) && input.hashes.length > 0 && input.hashes.length <= PRESERVATION_LIMITS.jobItems && input.hashes.every(digest) && new Set(input.hashes).size === input.hashes.length, 'PRESERVATION_SELECTION_INVALID');
  } else fail(['get', 'resume', 'cancel'].includes(action) && jobId(input.jobId), 'PRESERVATION_JOB_ID_INVALID');
  return input;
}

export function validatePreservationInventoryItem(item) {
  exact(item, ['sha256', 'byteLength', 'mimeType', 'filenameHints', 'referenceCount']);
  fail(digest(item.sha256) && size(item.byteLength) && text(item.mimeType, 200) && size(item.referenceCount), 'PRESERVATION_INVENTORY_INVALID');
  fail(Array.isArray(item.filenameHints) && item.filenameHints.length <= PRESERVATION_LIMITS.filenameHints && new Set(item.filenameHints).size === item.filenameHints.length && item.filenameHints.every(value => text(value, 255) && !/[\\/]/.test(value) && !['.', '..'].includes(value)), 'PRESERVATION_FILENAME_INVALID');
  return item;
}

export function preservationSummary(items, results) {
  const counts = { total: items.length, checked: results.length, match: 0, mismatch: 0, missing: 0, unreadable: 0, changedDuringCheck: 0 };
  const keys = { MATCH: 'match', MISMATCH: 'mismatch', MISSING: 'missing', UNREADABLE: 'unreadable', CHANGED_DURING_CHECK: 'changedDuringCheck' };
  for (const result of results) counts[keys[result.status]]++;
  return counts;
}

export function validatePreservationManifest(value) {
  exact(value, ['schemaVersion', 'jobId', 'projectId', 'requestId', 'status', 'createdAt', 'updatedAt', 'completedAt', 'items', 'results', 'summary', 'evidencePath', 'scope', 'sha256']);
  fail(value.schemaVersion === 'qimovi-preservation-check/v1' && jobId(value.jobId) && identity(value.projectId) && text(value.requestId, 160) && digest(value.sha256), 'PRESERVATION_RECEIPT_INVALID');
  fail(PRESERVATION_JOB_STATUSES.includes(value.status) && timestamp(value.createdAt) && timestamp(value.updatedAt) && value.updatedAt >= value.createdAt && (value.completedAt === null || timestamp(value.completedAt) && value.completedAt >= value.createdAt && value.completedAt <= value.updatedAt), 'PRESERVATION_RECEIPT_TIME_INVALID');
  fail((value.status === 'COMPLETED') === (value.completedAt !== null), 'PRESERVATION_COMPLETION_INVALID');
  fail(value.scope === PRESERVATION_SCOPE && value.evidencePath === `integrations/preservation/checks/${value.jobId}.json`, 'PRESERVATION_SCOPE_INVALID');
  fail(Array.isArray(value.items) && value.items.length > 0 && value.items.length <= PRESERVATION_LIMITS.jobItems && Array.isArray(value.results) && value.results.length <= value.items.length, 'PRESERVATION_RECEIPT_LIMIT');
  value.items.forEach(validatePreservationInventoryItem);
  fail(new Set(value.items.map(item => item.sha256)).size === value.items.length && value.items.every(item => item.byteLength <= PRESERVATION_LIMITS.fileBytes) && value.items.reduce((sum, item) => sum + item.byteLength, 0) <= PRESERVATION_LIMITS.jobBytes, 'PRESERVATION_RECEIPT_LIMIT');
  for (const [index, result] of value.results.entries()) {
    exact(result, ['sha256', 'expectedByteLength', 'status', 'startedAt', 'checkedAt', 'observedSha256', 'observedByteLength', 'reason']);
    const item = value.items[index];
    fail(result.sha256 === item.sha256 && result.expectedByteLength === item.byteLength && PRESERVATION_ITEM_STATUSES.includes(result.status), 'PRESERVATION_RESULT_INVALID');
    fail(timestamp(result.startedAt) && timestamp(result.checkedAt) && result.startedAt >= value.createdAt && result.checkedAt >= result.startedAt && result.checkedAt <= value.updatedAt && (!index || result.startedAt >= value.results[index - 1].checkedAt), 'PRESERVATION_RESULT_TIME_INVALID');
    fail((result.observedSha256 === null || digest(result.observedSha256)) && (result.observedByteLength === null || size(result.observedByteLength)) && (result.reason === null || text(result.reason, 120)), 'PRESERVATION_OBSERVATION_INVALID');
    const matches = result.observedSha256 === item.sha256 && result.observedByteLength === item.byteLength;
    if (result.status === 'MATCH') fail(matches && result.reason === null, 'PRESERVATION_MATCH_INVALID');
    if (result.status === 'MISMATCH') fail(!matches && digest(result.observedSha256) && size(result.observedByteLength) && result.reason !== null, 'PRESERVATION_MISMATCH_INVALID');
    if (result.status === 'MISSING') fail(result.observedSha256 === null && result.observedByteLength === null && result.reason !== null, 'PRESERVATION_MISSING_INVALID');
    if (['UNREADABLE', 'CHANGED_DURING_CHECK'].includes(result.status)) fail(result.reason !== null, 'PRESERVATION_FAILURE_INVALID');
  }
  const summary = preservationSummary(value.items, value.results);
  exact(value.summary, Object.keys(summary));
  fail(Object.keys(summary).every(key => value.summary[key] === summary[key]), 'PRESERVATION_SUMMARY_INVALID');
  fail(value.status !== 'COMPLETED' || value.results.length === value.items.length, 'PRESERVATION_COMPLETION_INVALID');
  return value;
}
