import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../kernel/src/canonical-json.mjs';
import { productionBudgetProject } from '../contracts/production-budget.mjs';
import { BRAND_SCHEMA, BRAND_LIMITS, requireBrand as need, brandShape as shape, brandText as text,
  brandDate, brandAmount as amount, scanBrandOpportunities, validateBrandDeal, projectBrandEvents, calculateBrandFinancing } from '../contracts/brand-financing.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const fingerprint = value => hash(canonicalJson(value));
const GENESIS = '0'.repeat(64);
const ref = record => ({ id: record.id, version: record.version, sha256: record.sha256 });

/** Owner-only planning ledger in the existing workspace DB. It does not write
 * screenplay records, the expense budget, or canonical admission state. */
export function createBrandFinancingService(store, { budgetService, actorId, now = () => new Date().toISOString() }) {
  text(actorId, 160);
  const db = store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS brand_financing_events (
    sequence INTEGER PRIMARY KEY, project_id TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL, previous_hash TEXT NOT NULL, event_hash TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS immutable_brand_events_update BEFORE UPDATE ON brand_financing_events
      BEGIN SELECT RAISE(ABORT,'BRAND_LEDGER_APPEND_ONLY'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_brand_events_delete BEFORE DELETE ON brand_financing_events
      BEGIN SELECT RAISE(ABORT,'BRAND_LEDGER_APPEND_ONLY'); END;`);

  function sources() {
    const project = store.project(), output = [];
    if (project.sourceHash) output.push({ id: 'production', label: 'Attached production screenplay',
      fingerprint: fingerprint({ projectId: project.id, sourceHash: project.sourceHash }), sourceHash: project.sourceHash, recordRef: null });
    for (const record of store.rawList('screenplay-draft')) {
      need(hash(canonicalJson(record.data)) === record.sha256, 'BRAND_SOURCE_CORRUPT', 409);
      output.push({ id: record.id, label: `${record.data.title} · saved v${record.version}`, fingerprint: fingerprint(ref(record)),
        sourceHash: hash(record.data.body), recordRef: ref(record) });
    }
    return output;
  }
  function scan(input) {
    shape(input, ['projectId', 'sourceId', 'sourceFingerprint']);
    need(input.projectId === store.project().id, 'BRAND_PROJECT_MISMATCH', 409);
    const source = sources().find(item => item.id === input.sourceId);
    need(source && source.fingerprint === input.sourceFingerprint, 'BRAND_SOURCE_CHANGED', 409);
    let body;
    if (source.id === 'production') {
      const blob = store.blobInfo(source.sourceHash);
      need(blob.mimeType === 'text/plain' && fs.statSync(blob.filename).size <= BRAND_LIMITS.sourceBytes, 'BRAND_SOURCE_UNSUPPORTED', 422);
      body = fs.readFileSync(blob.filename, 'utf8');
    } else {
      const record = store.rawList('screenplay-draft').find(row => row.id === source.id);
      store.validateSavedRecord(record); body = record.data.body;
    }
    need(Buffer.byteLength(body, 'utf8') <= BRAND_LIMITS.sourceBytes && hash(body) === source.sourceHash, 'BRAND_SOURCE_CORRUPT', 409);
    return { schemaVersion: BRAND_SCHEMA, projectId: input.projectId, source,
      ...scanBrandOpportunities(body, source, hash, source.id === 'production' ? store.project().scenes : []),
      method: 'LOCAL_KEYWORD_HEURISTIC', approvalGranted: false };
  }
  function readEvents() {
    const rows = db.prepare('SELECT * FROM brand_financing_events ORDER BY sequence LIMIT ?').all(BRAND_LIMITS.events + 1);
    need(rows.length <= BRAND_LIMITS.events, 'BRAND_LEDGER_LIMIT', 413);
    let previous = GENESIS;
    const events = rows.map((row, index) => {
      need(row.sequence === index + 1 && row.project_id === store.project().id && row.previous_hash === previous, 'BRAND_LEDGER_CHAIN_INVALID', 409);
      const event = JSON.parse(row.payload);
      need(event.schemaVersion === BRAND_SCHEMA && event.projectId === row.project_id &&
        row.event_hash === fingerprint({ sequence: row.sequence, requestId: row.request_id, requestHash: row.request_hash,
          previousHash: row.previous_hash, event }), 'BRAND_LEDGER_HASH_INVALID', 409);
      previous = row.event_hash; return event;
    });
    return { events, version: rows.length, headHash: previous };
  }
  function budget() {
    const owner = productionBudgetProject(store.project());
    return budgetService.load({ projectId: owner.id, sourceHash: owner.sourceHash });
  }
  function load() {
    const history = readEvents(), state = projectBrandEvents(history.events), sourceList = sources(), savedBudget = budget();
    return { schemaVersion: BRAND_SCHEMA, projectId: store.project().id, version: history.version, headHash: history.headHash,
      sources: sourceList, ...state, ...calculateBrandFinancing(state, savedBudget, sourceList),
      budget: { recordRef: savedBudget.record ? ref(savedBudget.record) : null,
        lines: savedBudget.report.lines.map(line => ({ id: line.id, label: line.label, currency: line.currency,
          estimate: line.estimate, actual: line.actual, committed: line.committed })) },
      events: history.events, authority: 'OWNER_RECORDED_PLANNING_ONLY', externalVerification: false, approvalGranted: false };
  }
  function approved(state, opportunityId) {
    const review = state.reviews.find(row => row.opportunity.id === opportunityId);
    need(review?.decision === 'approved', 'BRAND_OPPORTUNITY_NOT_APPROVED', 409);
    need(sources().some(source => source.id === review.opportunity.source.id && source.fingerprint === review.opportunity.source.fingerprint), 'BRAND_SOURCE_CHANGED', 409);
    return review;
  }
  function checkSavings(deal, state, savedBudget) {
    if (!deal.savings.length) return;
    need(savedBudget.record, 'BRAND_SAVED_BUDGET_REQUIRED', 409);
    for (const saving of deal.savings) {
      const line = savedBudget.report.lines.find(row => row.id === saving.lineId);
      need(line && line.currency === deal.currency && line.estimate !== null && line.actual === '0' && amount(line.committed) === 0n, 'BRAND_SAVING_BASIS_INVALID', 409);
      const reserved = state.deals.filter(row => row.id !== deal.id && row.status === 'signed' && row.budgetHash === savedBudget.record.sha256)
        .flatMap(row => row.savings).filter(row => row.lineId === saving.lineId).reduce((n, row) => n + amount(row.amount), 0n);
      need(reserved + amount(saving.amount) <= amount(line.estimate), 'BRAND_SAVING_EXCEEDS_COST', 409);
    }
  }
  function command(input) {
    shape(input, ['projectId', 'expectedVersion', 'requestId', 'action', 'data']);
    need(input.projectId === store.project().id, 'BRAND_PROJECT_MISMATCH', 409);
    text(input.requestId, 160);
    need(Number.isSafeInteger(input.expectedVersion) && input.expectedVersion >= 0, 'BRAND_VERSION_INVALID');
    need(['review', 'deal', 'sign', 'cancel', 'payment'].includes(input.action), 'BRAND_ACTION_INVALID');
    const requestHash = fingerprint(input);
    db.exec('BEGIN IMMEDIATE');
    let replayed = false;
    try {
      const history = readEvents(), prior = db.prepare('SELECT * FROM brand_financing_events WHERE request_id=?').get(input.requestId);
      if (prior) {
        need(prior.request_hash === requestHash, 'BRAND_REQUEST_ID_CONFLICT', 409); replayed = true;
      } else {
        need(history.version === input.expectedVersion, 'BRAND_VERSION_CONFLICT', 409);
        need(history.version < BRAND_LIMITS.events, 'BRAND_LEDGER_LIMIT', 413);
        const state = projectBrandEvents(history.events), data = structuredClone(input.data);
        let payload;
        if (input.action === 'review') {
          shape(data, ['sourceId', 'sourceFingerprint', 'opportunityId', 'decision', 'reason']);
          need(['approved', 'rejected'].includes(data.decision), 'BRAND_REVIEW_INVALID'); text(data.reason, 1000);
          const result = scan({ projectId: input.projectId, sourceId: data.sourceId, sourceFingerprint: data.sourceFingerprint });
          const opportunity = result.opportunities.find(row => row.id === data.opportunityId);
          need(opportunity, 'BRAND_OPPORTUNITY_MISSING', 409);
          payload = { opportunity, decision: data.decision, reason: data.reason };
        } else if (input.action === 'deal') {
          shape(data, ['deal', 'budgetHash']); validateBrandDeal(data.deal);
          need(!state.deals.some(row => row.id === data.deal.id), 'BRAND_DEAL_EXISTS', 409);
          approved(state, data.deal.opportunityId);
          const savedBudget = budget();
          need(data.budgetHash === (savedBudget.record?.sha256 ?? null), 'BRAND_BUDGET_CHANGED', 409);
          checkSavings(data.deal, state, savedBudget); payload = data;
        } else if (input.action === 'sign' || input.action === 'cancel') {
          shape(data, ['dealId', 'evidence', 'confirmed']); text(data.evidence, 2000);
          need(data.confirmed === true, 'BRAND_CONFIRMATION_REQUIRED');
          const deal = state.deals.find(row => row.id === data.dealId);
          need(deal && (input.action === 'sign' ? deal.status === 'draft' : deal.status !== 'cancelled'), 'BRAND_DEAL_STATE_INVALID', 409);
          if (input.action === 'sign') {
            approved(state, deal.opportunityId);
            const savedBudget = budget();
            if (deal.savings.length) need(deal.budgetHash === savedBudget.record?.sha256, 'BRAND_BUDGET_CHANGED', 409);
            checkSavings(deal, state, savedBudget);
          }
          payload = data;
        } else {
          shape(data, ['dealId', 'milestoneId', 'kind', 'amount', 'externalId', 'evidence', 'receivedDate', 'confirmed']);
          need(data.confirmed === true, 'BRAND_CONFIRMATION_REQUIRED');
          need(['receipt', 'refund'].includes(data.kind) && amount(data.amount) > 0n, 'BRAND_PAYMENT_INVALID');
          text(data.externalId, 200); text(data.evidence, 2000); brandDate(data.receivedDate);
          const deal = state.deals.find(row => row.id === data.dealId), milestone = deal?.milestones.find(row => row.id === data.milestoneId);
          need(deal?.signedAt && milestone && (deal.status === 'signed' || data.kind === 'refund' && deal.status === 'cancelled'), 'BRAND_PAYMENT_NOT_CONTRACTED', 409);
          need(!state.payments.some(row => row.externalId.trim().toLowerCase() === data.externalId.trim().toLowerCase()), 'BRAND_DUPLICATE_PAYMENT', 409);
          const received = state.payments.filter(row => row.dealId === data.dealId && row.milestoneId === data.milestoneId)
            .reduce((n, row) => n + (row.kind === 'refund' ? -1n : 1n) * amount(row.amount), 0n);
          const next = received + (data.kind === 'refund' ? -1n : 1n) * amount(data.amount);
          need(next >= 0n && next <= amount(milestone.amount), 'BRAND_PAYMENT_EXCEEDS_MILESTONE', 409);
          payload = data;
        }
        const event = { schemaVersion: BRAND_SCHEMA, projectId: input.projectId, action: input.action, data: payload, actorId, at: now() };
        const sequence = history.version + 1;
        const eventHash = fingerprint({ sequence, requestId: input.requestId, requestHash, previousHash: history.headHash, event });
        db.prepare('INSERT INTO brand_financing_events VALUES(?,?,?,?,?,?,?)').run(sequence, input.projectId, input.requestId, requestHash, history.headHash, eventHash, canonicalJson(event));
        // Fail closed on aggregate overflows and projection errors before commit.
        const projected = projectBrandEvents([...history.events, event]); calculateBrandFinancing(projected, budget(), sources());
      }
      db.exec('COMMIT');
    } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
    return { ...load(), replayed };
  }
  return { load, scan, command };
}
