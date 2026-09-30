import { projectOwnedContext } from '../contracts/creative-project.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { atomicPrivateFile, canonical, hashFile, sha256 } from './storage.mjs';
import { USAGE_ACCOUNTING_LIMITS as LIMITS, normalizeUsageReport, usageNeed as need, validateUsageIdentity, validateUsageObservation } from '../contracts/usage-accounting.mjs';
import { studioGenerationDetails } from '../contracts/studio-generation.mjs';

const nano = value => { const units = BigInt(value); return `${units / 1000000000n}.${String(units % 1000000000n).padStart(9, '0')}`.replace(/\.?0+$/, '') || '0'; };
const eventIdentity = event => canonical([event.provider, event.account, event.event_id]);
// Date.parse retains milliseconds; the exported Python timestamps may carry six fractional digits.
const micros = value => BigInt(Date.parse(value)) * 1000n + BigInt((/\.(\d+)/.exec(value)?.[1] ?? '').slice(3).padEnd(3, '0'));
const chronological = (a, b) => micros(a) < micros(b) ? -1 : micros(a) > micros(b) ? 1 : 0;
const scope = (project, input) => { project = projectOwnedContext(project, 'usage-observation', input); need(project && input.projectId === project.id && input.sourceHash === project.sourceHash, 'USAGE_PROJECT_MISMATCH', 409); };
const sumTokens = (events, key) => {
  if (events.some(event => !event.usage_known)) return null;
  const total = events.reduce((sum, event) => sum + BigInt(event[key]), 0n);
  need(total <= BigInt(Number.MAX_SAFE_INTEGER), 'USAGE_TOKEN_TOTAL_OVERFLOW', 413);
  return Number(total);
};
const ref = record => ({ id: record.id, sha256: record.sha256 });

function mergeEvents(reports) {
  const seen = new Map(), outcomes = new Map();
  for (const report of reports) for (const event of report.events) {
    const key = eventIdentity(event), prior = seen.get(key);
    need(!prior || canonical(prior) === canonical(event), 'USAGE_EVENT_IDENTITY_CONFLICT', 409);
    seen.set(key, event);
    if (event.accepted !== null) {
      const outcomeKey = canonical([event.account, event.project, event.task_id, micros(event.timestamp).toString(), event.attempt]);
      need(!outcomes.has(outcomeKey) || outcomes.get(outcomeKey) === event.accepted, 'USAGE_TASK_OUTCOME_CONFLICT', 409);
      outcomes.set(outcomeKey, event.accepted);
    }
  }
  need(seen.size <= LIMITS.maxWorkspaceEvents, 'USAGE_WORKSPACE_EVENT_LIMIT', 413);
  const totals = new Map();
  for (const event of seen.values()) for (const field of ['input_tokens', 'output_tokens', 'cached_tokens', 'cache_write_tokens', 'reasoning_tokens']) {
    const key = canonical([event.project, field]), total = (totals.get(key) ?? 0n) + BigInt(event[field]);
    need(total <= BigInt(Number.MAX_SAFE_INTEGER), 'USAGE_TOKEN_TOTAL_OVERFLOW', 413); totals.set(key, total);
  }
  return [...seen.values()].sort((a, b) => chronological(a.timestamp, b.timestamp) || a.attempt - b.attempt || eventIdentity(a).localeCompare(eventIdentity(b)));
}

function savedReport(store, record) {
  validateUsageIdentity(record.id, record.kind, record.data, record.version);
  validateUsageObservation(record.data, store.project());
  need(sha256(canonical(record.data)) === record.sha256, 'USAGE_RECORD_HASH_MISMATCH', 409);
  const blob = store.blobInfo(record.data.reportHash);
  need(blob.byteLength === record.data.byteLength && blob.mimeType === 'application/json', 'USAGE_REPORT_BLOB_MISMATCH', 409);
  const bytes = fs.readFileSync(blob.filename), report = normalizeUsageReport(bytes.toString('utf8'));
  need(sha256(bytes) === record.data.reportHash && report.byteLength === record.data.byteLength && report.generatedAt === record.data.generatedAt && report.eventCount === record.data.eventCount, 'USAGE_REPORT_METADATA_MISMATCH', 409);
  return { ...report, record };
}

export function validateUsageRecordReferences(store, record, { compare = false } = {}) {
  if (record.kind !== 'usage-observation' && !record.id?.startsWith('usage-observation:')) return;
  const report = savedReport(store, record);
  if (compare) {
    const existing = store.rawList('usage-observation').filter(row => row.id !== record.id);
    need(existing.length < LIMITS.maxImports, 'USAGE_IMPORT_LIMIT', 413);
    mergeEvents([...existing.map(row => savedReport(store, row)), report]);
  }
  return report;
}

function excludedProjects(events, projectId) {
  const groups = new Map();
  for (const event of events) if (event.project !== projectId) groups.set(event.project, (groups.get(event.project) ?? 0) + 1);
  return [...groups].map(([project, eventCount]) => ({ project, eventCount })).sort((a, b) => a.project.localeCompare(b.project));
}

function importedSummary(events, projectId) {
  const selected = events.filter(event => event.project === projectId), tasks = new Map();
  for (const event of selected) if (event.task_id) {
    const key = canonical([event.account, event.project, event.task_id]), task = tasks.get(key) ?? { cost: 0n, unknown: false, outcome: null };
    task.cost += BigInt(event.cost_nano ?? 0); task.unknown ||= event.cost_nano === null;
    if (event.accepted !== null) task.outcome = event.accepted;
    tasks.set(key, task);
  }
  const closed = [...tasks.values()].filter(task => task.outcome !== null), accepted = closed.filter(task => task.outcome === true).length;
  const unknown = selected.filter(event => event.cost_nano === null).length;
  return {
    eventCount: selected.length, excludedEventCount: events.length - selected.length, excludedProjects: excludedProjects(events, projectId),
    reportedUsd: nano(selected.filter(event => event.cost_kind === 'reported').reduce((sum, event) => sum + BigInt(event.cost_nano), 0n)),
    estimatedUsd: nano(selected.filter(event => event.cost_kind === 'estimated').reduce((sum, event) => sum + BigInt(event.cost_nano), 0n)),
    unknownCostEvents: unknown,
    inputTokens: sumTokens(selected, 'input_tokens'), outputTokens: sumTokens(selected, 'output_tokens'), cachedTokens: sumTokens(selected, 'cached_tokens'), cacheWriteTokens: sumTokens(selected, 'cache_write_tokens'), reasoningTokens: sumTokens(selected, 'reasoning_tokens'),
    observedAcceptedTasks: accepted, observedClosedTasks: closed.length,
    // Rounded down to a nano-dollar. These are imported outcomes, not owner acceptance.
    costPerObservedAcceptedTaskUsd: accepted && !unknown ? nano(closed.reduce((sum, task) => sum + task.cost, 0n) / BigInt(accepted)) : null,
  };
}

function summary(store, reports, includeLocal = true, attemptLimit = LIMITS.attempts) {
  const project = store.project(), events = mergeEvents(reports), selected = events.filter(event => event.project === project.id);
  const eventRecords = new Map();
  for (const report of reports) for (const event of report.events) if (!eventRecords.has(eventIdentity(event))) eventRecords.set(eventIdentity(event), report.record.id);
  const attempts = selected.map(event => ({ id: `usage-event:${sha256(eventIdentity(event))}`, origin: 'TOKEN_STEWARD', provider: event.provider, model: event.model, taskId: event.task_id || null, sceneId: null, shotId: null, status: event.status, timestamp: event.timestamp, inputTokens: event.usage_known ? event.input_tokens : null, outputTokens: event.usage_known ? event.output_tokens : null, costUsd: event.cost_nano === null ? null : nano(event.cost_nano), costKind: event.cost_kind, quotedCredits: null, observedAccepted: event.accepted, recordId: eventRecords.get(eventIdentity(event)) ?? null }));
  const local = { attemptCount: 0, inputTokens: 0, outputTokens: 0, unknownUsageAttempts: 0, costUsd: null };
  const generation = { attemptCount: 0, quotedCredits: '0', quotedAttempts: 0, unquotedAttempts: 0, costUsd: null };
  let credits = 0n;
  if (includeLocal) for (const record of store.rawList()) {
    const data = record.data;
    if (!['model-assistance', 'studio-generation'].includes(record.kind) || data.projectId !== project.id || data.sourceHash !== projectOwnedContext(project, record.kind, data).sourceHash) continue;
    store.validateSavedRecord(record);
    if (record.kind === 'model-assistance') {
      const input = data.output?.promptTokens ?? null, output = data.output?.outputTokens ?? null;
      local.attemptCount++; if (input === null || output === null) local.unknownUsageAttempts++;
      local.inputTokens = local.inputTokens === null || input === null ? null : local.inputTokens + input;
      local.outputTokens = local.outputTokens === null || output === null ? null : local.outputTokens + output;
      attempts.push({ id: record.id, origin: 'LOCAL_MODEL', provider: data.provider.kind, model: data.provider.model, taskId: data.requestId, sceneId: data.sceneId ?? null, shotId: null, status: data.status, timestamp: data.startedAt, inputTokens: input, outputTokens: output, costUsd: null, costKind: 'unknown', quotedCredits: null, observedAccepted: null, recordId: record.id });
    } else {
      const details = studioGenerationDetails(data.detailsJson), quote = details.quote?.credits;
      let quoteNano = null;
      if (typeof quote === 'string' && /^(0|[1-9]\d{0,12})(?:\.\d{1,9})?$/.test(quote)) { const [whole, fraction = ''] = quote.split('.'); quoteNano = BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0')); }
      generation.attemptCount++; if (quoteNano === null) generation.unquotedAttempts++; else { generation.quotedAttempts++; credits += quoteNano; }
      const operation = store.history(data.operationRef.id).find(row => row.version === data.operationRef.version && row.sha256 === data.operationRef.sha256)?.data;
      attempts.push({ id: record.id, origin: 'HIGGSFIELD', provider: 'HIGGSFIELD_MCP', model: details.modelId ?? operation?.modelId ?? 'unknown', taskId: data.operationRef.id, sceneId: operation?.target?.sceneId ?? null, shotId: operation?.target?.shotId ?? null, status: data.phase, timestamp: new Date(data.createdAtMs).toISOString(), inputTokens: null, outputTokens: null, costUsd: null, costKind: 'unknown', quotedCredits: quoteNano === null ? null : nano(quoteNano), observedAccepted: null, recordId: record.id });
    }
  }
  generation.quotedCredits = nano(credits);
  attempts.sort((a, b) => chronological(b.timestamp, a.timestamp) || a.id.localeCompare(b.id));
  return { schemaVersion: 1, projectId: project.id, sourceHash: project.sourceHash, authority: 'OBSERVATION_ONLY', enforcement: 'NOT_CONNECTED',
    imports: reports.map(report => ({ ...ref(report.record), ...report.record.data, matchedEventCount: report.events.filter(event => event.project === project.id).length })),
    imported: importedSummary(events, project.id), local, generation, totalAttempts: attempts.length, attempts: attemptLimit === null ? attempts : attempts.slice(0, attemptLimit), limits: { maxReportBytes: LIMITS.maxReportBytes, maxEvents: LIMITS.maxEvents } };
}

export function createUsageAccountingService(store, { now = () => new Date().toISOString() } = {}) {
  const retained = () => store.rawList('usage-observation').map(record => savedReport(store, record));
  function prepare(input, forImport = false) {
    const allowed = ['projectId', 'sourceHash', 'reportText', ...(forImport ? ['expectedReportHash'] : [])];
    need(input && typeof input === 'object' && !Array.isArray(input) && ['projectId', 'sourceHash', 'reportText', ...(forImport ? ['expectedReportHash'] : [])].every(key => Object.hasOwn(input, key)) && Object.keys(input).every(key => allowed.includes(key)), 'USAGE_IMPORT_FIELDS_INVALID');
    scope(store.project(), input);
    const report = normalizeUsageReport(input.reportText), reportHash = sha256(Buffer.from(input.reportText, 'utf8'));
    if (Object.hasOwn(input, 'expectedReportHash')) need(input.expectedReportHash === reportHash, 'USAGE_PREVIEW_CHANGED', 409);
    const data = { schemaVersion: 1, projectId: input.projectId, sourceHash: input.sourceHash, authority: 'OBSERVATION_ONLY', reportHash, byteLength: report.byteLength, generatedAt: report.generatedAt, importedAt: now(), eventCount: report.eventCount };
    const existing = retained(), prior = existing.find(item => item.record.data.reportHash === reportHash);
    need(prior || existing.length < LIMITS.maxImports, 'USAGE_IMPORT_LIMIT', 413);
    const record = prior?.record ?? { id: `usage-observation:${reportHash}`, kind: 'usage-observation', version: 1, sha256: sha256(canonical(data)), data };
    const incoming = { ...report, record };
    mergeEvents([...existing, incoming]);
    return { ...incoming, existing, alreadyImported: Boolean(prior) };
  }
  return {
    summary(input) { scope(store.project(), input); return summary(store, retained()); },
    // Internal accounting projection: the presentation table's 200-row cap must
    // never become a financial reporting boundary. Preserve normalized IDs.
    budgetAttempts(input) { scope(store.project(), input); return summary(store, retained(), true, null).attempts; },
    preview(input) {
      const incoming = prepare(input);
      const projection = summary(store, [incoming], false);
      return { reportHash: incoming.record.data.reportHash, byteLength: incoming.byteLength, generatedAt: incoming.generatedAt, eventCount: incoming.eventCount, matchedEventCount: incoming.events.filter(event => event.project === input.projectId).length, excludedEventCount: incoming.events.filter(event => event.project !== input.projectId).length, excludedProjects: excludedProjects(incoming.events, input.projectId), alreadyImported: incoming.alreadyImported, summary: projection };
    },
    import(input) {
      const incoming = prepare(input, true), { record } = incoming;
      if (incoming.alreadyImported) return { replayed: true, record, summary: summary(store, incoming.existing) };
      const filename = path.join(store.directory, 'blobs', record.data.reportHash);
      if (fs.existsSync(filename)) need(fs.lstatSync(filename).isFile() && !fs.lstatSync(filename).isSymbolicLink() && hashFile(filename) === record.data.reportHash, 'USAGE_REPORT_BLOB_MISMATCH', 409);
      else atomicPrivateFile(filename, Buffer.from(input.reportText, 'utf8'));
      const saved = store.saveUsageObservation(record.id, { kind: record.kind, expectedVersion: null, requestId: `usage-import:${record.data.reportHash}`, data: record.data }, [{ sha256: record.data.reportHash, byteLength: record.data.byteLength, mimeType: 'application/json' }]);
      return { replayed: saved.replayed, record: saved, summary: summary(store, retained()) };
    },
  };
}
