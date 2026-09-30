import { projectOwnedContext } from './creative-project.mjs';
// Accounting imports are attributed observations, never execution or acceptance authority.
export const USAGE_ACCOUNTING_LIMITS = Object.freeze({ maxReportBytes: 2097152, maxEvents: 5000, maxImports: 200, maxWorkspaceEvents: 20000, attempts: 200 });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const usageNeed = (value, code, status = 422) => { if (!value) throw Object.assign(new Error(code), { code, status }); };
const text = (value, max = 240, empty = false) => typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0) && value.isWellFormed() && !/[\x00-\x1f\x7f]/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000000;
const shape = (value, keys) => usageNeed(object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','), 'USAGE_RECORD_FIELDS_INVALID');

export function validateUsageObservation(data, project) {
  project = projectOwnedContext(project, 'usage-observation', data);
  shape(data, ['schemaVersion', 'projectId', 'sourceHash', 'authority', 'reportHash', 'byteLength', 'generatedAt', 'importedAt', 'eventCount']);
  usageNeed(data.schemaVersion === 1 && text(data.projectId, 160) && (data.sourceHash === null || digest(data.sourceHash)) && data.authority === 'OBSERVATION_ONLY', 'USAGE_RECORD_SCOPE_INVALID');
  if (project) usageNeed(data.projectId === project.id && data.sourceHash === project.sourceHash, 'USAGE_PROJECT_MISMATCH', 409);
  usageNeed(digest(data.reportHash) && Number.isSafeInteger(data.byteLength) && data.byteLength > 0 && data.byteLength <= USAGE_ACCOUNTING_LIMITS.maxReportBytes, 'USAGE_REPORT_BYTES_INVALID');
  usageNeed(timestamp(data.generatedAt) && timestamp(data.importedAt) && Number.isSafeInteger(data.eventCount) && data.eventCount >= 0 && data.eventCount <= USAGE_ACCOUNTING_LIMITS.maxEvents, 'USAGE_RECORD_METADATA_INVALID');
  return data;
}

export function validateUsageIdentity(id, kind, data, version = 1) {
  if (kind !== 'usage-observation' && !id?.startsWith('usage-observation:')) return;
  usageNeed(kind === 'usage-observation' && id === `usage-observation:${data?.reportHash}` && version === 1, 'USAGE_RECORD_IDENTITY_INVALID', 409);
}

/** Accept only exported normalized ledger events. Prices and report totals are not recalculated or trusted. */
export function normalizeUsageReport(reportText) {
  usageNeed(typeof reportText === 'string' && reportText.isWellFormed(), 'USAGE_REPORT_TEXT_INVALID');
  const byteLength = new TextEncoder().encode(reportText).byteLength;
  usageNeed(byteLength > 0 && byteLength <= USAGE_ACCOUNTING_LIMITS.maxReportBytes, 'USAGE_REPORT_TOO_LARGE', 413);
  let report; try { report = JSON.parse(reportText); } catch { usageNeed(false, 'USAGE_REPORT_JSON_INVALID'); }
  usageNeed(object(report) && report.schema_version === 2 && timestamp(report.generated_at) && Array.isArray(report.events), 'USAGE_REPORT_FORMAT_INVALID');
  usageNeed(report.events.length <= USAGE_ACCOUNTING_LIMITS.maxEvents, 'USAGE_REPORT_EVENT_LIMIT', 413);
  const events = report.events.map(raw => {
    usageNeed(object(raw), 'USAGE_EVENT_INVALID');
    for (const key of ['provider', 'account', 'event_id', 'project', 'model', 'status']) usageNeed(text(raw[key], key === 'event_id' ? 512 : 240), 'USAGE_EVENT_IDENTITY_INVALID');
    usageNeed(text(raw.task_id, 240, true) && timestamp(raw.timestamp), 'USAGE_EVENT_METADATA_INVALID');
    for (const key of ['input_tokens', 'output_tokens', 'cached_tokens', 'cache_write_tokens', 'reasoning_tokens']) usageNeed(count(raw[key]), 'USAGE_EVENT_TOKENS_INVALID');
    usageNeed(typeof raw.usage_known === 'boolean' && Number.isSafeInteger(raw.attempt) && raw.attempt >= 1 && raw.attempt <= 1000000, 'USAGE_EVENT_USAGE_INVALID');
    usageNeed(raw.cached_tokens + raw.cache_write_tokens <= raw.input_tokens && raw.reasoning_tokens <= raw.output_tokens, 'USAGE_EVENT_TOKEN_SUBSETS_INVALID');
    usageNeed(raw.accepted === null || typeof raw.accepted === 'boolean', 'USAGE_EVENT_OUTCOME_INVALID');
    usageNeed(raw.accepted === null || raw.task_id.trim().length > 0, 'USAGE_EVENT_OUTCOME_REQUIRES_TASK');
    usageNeed(raw.cost_nano === null || Number.isSafeInteger(raw.cost_nano) && raw.cost_nano >= 0, 'USAGE_EVENT_COST_INVALID');
    usageNeed(raw.cost_nano === null ? raw.cost_kind === 'unknown' : ['reported', 'estimated'].includes(raw.cost_kind), 'USAGE_EVENT_COST_KIND_INVALID');
    return Object.fromEntries(['provider', 'account', 'event_id', 'project', 'task_id', 'model', 'status', 'timestamp', 'input_tokens', 'output_tokens', 'cached_tokens', 'cache_write_tokens', 'reasoning_tokens', 'usage_known', 'attempt', 'accepted', 'cost_nano', 'cost_kind'].map(key => [key, raw[key]]));
  });
  return { generatedAt: report.generated_at, byteLength, eventCount: events.length, events };
}
