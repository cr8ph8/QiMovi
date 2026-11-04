import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createCreativeProject } from '../local/server/creative-project.mjs';
import { WorkspaceStore, canonical, sha256 } from '../local/server/storage.mjs';
import { validateRecord } from '../local/contracts/drifter.mjs';
import { createProductionBudgetService } from '../local/server/production-budget.mjs';
import { createBrandFinancingService } from '../local/server/brand-financing.mjs';
import { brandAmount, brandDecimal, scanBrandOpportunities, validateBrandDeal } from '../local/contracts/brand-financing.mjs';
import { createBackup, restoreBackup } from '../local/server/recovery.mjs';
import { startServer } from '../local/server/http.mjs';

function setup(t, { priced = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qimovi-brand-')), directory = path.join(root, 'film');
  createCreativeProject(directory, 'Synthetic Placement Film');
  const store = new WorkspaceStore(directory, validateRecord);
  t.after(() => { try { store.close(); } catch {} fs.rmSync(root, { recursive: true, force: true }); });
  const project = store.project();
  const draft = store.save('screenplay-draft:synthetic-brand', { kind: 'screenplay-draft', expectedVersion: null, requestId: crypto.randomUUID(),
    data: { schemaVersion: 2, projectId: project.id, sourceHash: null, title: project.title, format: 'FOUNTAIN',
      body: 'Title: Coffee in Metadata\n\nINT. STUDIO - DAY\n\nAri sips coffee beside a laptop.\n[[a truck in a note]]\n/* a sandwich in a boneyard */\n\nEXT. STREET - NIGHT\n\nA car stops.\n', status: 'DRAFT' } });
  const budgetService = createProductionBudgetService(store);
  if (priced) {
    const response = budgetService.generate({ projectId: project.id, sourceHash: null });
    for (const line of response.budget.lines) Object.assign(line, { rateLow: '0', rate: line.targetId === 'department:equipment' ? '100' : '0', rateHigh: line.targetId === 'department:equipment' ? '100' : '0', basis: 'Synthetic test assumption; not a vendor quote.' });
    budgetService.save({ projectId: project.id, sourceHash: null, expectedVersion: null, requestId: crypto.randomUUID(), inventoryHash: response.inventoryHash, budget: response.budget });
  }
  const service = createBrandFinancingService(store, { budgetService, actorId: 'synthetic-owner', now: () => '2026-11-04T18:00:00Z' });
  const scope = () => ({ projectId: project.id, sourceHash: null });
  const source = () => service.load().sources.find(row => row.id === draft.id);
  const scan = () => service.scan({ projectId: project.id, sourceId: draft.id, sourceFingerprint: source().fingerprint });
  const command = (action, data, overrides = {}) => service.command({ projectId: project.id, expectedVersion: service.load().version, requestId: crypto.randomUUID(), action, data, ...overrides });
  const review = (decision = 'approved') => { const opportunity = scan().opportunities[0]; command('review', { sourceId: draft.id, sourceFingerprint: source().fingerprint, opportunityId: opportunity.id, decision, reason: 'Existing natural action; reviewed by owner.' }); return opportunity; };
  const deal = (overrides = {}) => ({ id: `deal:${crypto.randomUUID()}`, sponsor: 'Synthetic Sponsor', opportunityId: review().id, currency: 'USD', cash: '40', extraCost: '5', marketingSupport: '200', savings: [], milestones: [{ id: 'deposit', label: 'Deposit', amount: '40', dueDate: '2026-11-20' }], notes: 'Synthetic fixture. No commercial agreement exists.', ...overrides });
  const add = value => command('deal', { deal: value, budgetHash: service.load().budget.recordRef?.sha256 ?? null });
  const sign = id => command('sign', { dealId: id, evidence: 'Synthetic signed contract fixture', confirmed: true });
  const payment = (id, overrides = {}) => command('payment', { dealId: id, milestoneId: 'deposit', kind: 'receipt', amount: '10', externalId: crypto.randomUUID(), evidence: 'Synthetic bank receipt fixture', receivedDate: '2026-11-04', confirmed: true, ...overrides });
  return { root, directory, store, project, draft, service, budgetService, scope, source, scan, command, review, deal, add, sign, payment };
}

test('scanner is deterministic, traceable, local and does not modify any authored state', t => {
  const f = setup(t), before = canonical(f.store.rawList()), first = f.scan();
  assert.deepEqual(first, f.scan()); assert.equal(canonical(f.store.rawList()), before); assert.equal(f.service.load().version, 0);
  assert.equal(first.approvalGranted, false); assert.equal(first.method, 'LOCAL_KEYWORD_HEURISTIC');
  assert.deepEqual(first.opportunities.map(row => row.quote), ['coffee', 'laptop', 'car']);
  for (const row of first.opportunities) assert.equal(f.draft.data.body.slice(row.start, row.end), row.quote);
});

test('scanner handles CRLF and emoji offsets and ignores unclosed comments', () => {
  const body = 'INT. ROOM - DAY\r\n😀 coffee, phone.\r\n/* car\n', source = { fingerprint: 'x' };
  const result = scanBrandOpportunities(body, source, sha256);
  assert.deepEqual(result.opportunities.map(row => row.quote), ['coffee', 'phone']);
  for (const row of result.opportunities) assert.equal(body.slice(row.start, row.end), row.quote);
  assert.equal(scanBrandOpportunities('coffee without a scene heading', source, sha256).opportunities.length, 0);
});

test('rejecting an opportunity leaves screenplay and budget untouched; unreviewed deals fail', t => {
  const f = setup(t), before = canonical(f.store.rawList());
  const opportunity = f.review('rejected'); assert.equal(canonical(f.store.rawList()), before);
  const deal = f.deal({ opportunityId: opportunity.id }); // helper reapproves, then reject explicitly
  f.review('rejected'); assert.throws(() => f.add(deal), /BRAND_OPPORTUNITY_NOT_APPROVED/);
});

test('a changed draft invalidates earlier reviews and refuses stale scans and signing', t => {
  const f = setup(t), deal = f.deal(); f.add(deal); const old = f.source();
  f.store.save(f.draft.id, { kind: f.draft.kind, expectedVersion: 1, requestId: crypto.randomUUID(), data: { ...f.draft.data, body: `${f.draft.data.body}\nA different ending.\n` } });
  assert.equal(f.service.load().reviews[0].stale, true);
  assert.throws(() => f.service.scan({ projectId: f.project.id, sourceId: old.id, sourceFingerprint: old.fingerprint }), /BRAND_SOURCE_CHANGED/);
  assert.throws(() => f.sign(deal.id), /BRAND_SOURCE_CHANGED/);
});

test('exact retries replay once, mismatched retries and stale CAS fail atomically', t => {
  const f = setup(t), opportunity = f.scan().opportunities[0];
  const request = { projectId: f.project.id, expectedVersion: 0, requestId: 'retry-test', action: 'review', data: { sourceId: f.draft.id, sourceFingerprint: f.source().fingerprint, opportunityId: opportunity.id, decision: 'approved', reason: 'Synthetic review' } };
  f.service.command(request); assert.equal(f.service.command(request).replayed, true); assert.equal(f.service.load().version, 1);
  assert.throws(() => f.service.command({ ...request, data: { ...request.data, decision: 'rejected' } }), /BRAND_REQUEST_ID_CONFLICT/);
  assert.throws(() => f.service.command({ ...request, requestId: 'another' }), /BRAND_VERSION_CONFLICT/);
  assert.equal(f.service.load().version, 1);
});

test('drafts are not funding; cash, receipts, costs and marketing are never double counted', t => {
  const f = setup(t), deal = f.deal(); f.add(deal);
  let total = f.service.load().totals.find(row => row.currency === 'USD');
  assert.equal(total.proposedCash, '40'); assert.equal(total.signedCash, '0'); assert.equal(total.remainingBeforeOtherFunding, '100');
  f.sign(deal.id); f.payment(deal.id);
  total = f.service.load().totals.find(row => row.currency === 'USD');
  assert.equal(total.signedCash, '40'); assert.equal(total.receivedCash, '10'); assert.equal(total.outstandingCash, '30');
  assert.equal(total.extraCost, '5'); assert.equal(total.marketingSupport, '200'); assert.equal(total.netBrandBenefit, '35');
  assert.equal(total.remainingBeforeOtherFunding, '65'); assert.equal(f.service.load().schedule[0].outstanding, '30');
});

test('in-kind savings replace cost once, use the saved budget and cannot oversubscribe a line', t => {
  const f = setup(t), line = f.service.load().budget.lines.find(row => row.label === 'Equipment');
  assert.ok(line);
  const one = f.deal({ savings: [{ lineId: line.id, amount: '70', basis: 'Rental expense avoided' }] }); f.add(one); f.sign(one.id);
  assert.equal(f.service.load().totals[0].savings, '70'); assert.equal(f.service.load().totals[0].remainingBeforeOtherFunding, '0');
  const two = f.deal({ savings: [{ lineId: line.id, amount: '40', basis: 'Overlapping rental' }] });
  assert.throws(() => f.add(two), /BRAND_SAVING_EXCEEDS_COST/);
});

test('budget changes demote saved savings without deleting the signed cash obligation', t => {
  const f = setup(t), line = f.service.load().budget.lines.find(row => row.label === 'Equipment');
  const deal = f.deal({ savings: [{ lineId: line.id, amount: '20', basis: 'Rental expense avoided' }] }); f.add(deal); f.sign(deal.id);
  const b = f.budgetService.load(f.scope()); b.budget.title += ' revised';
  f.budgetService.save({ ...f.scope(), expectedVersion: b.record.version, requestId: crypto.randomUUID(), inventoryHash: b.inventoryHash, budget: b.budget });
  const result = f.service.load(); assert.equal(result.totals[0].savings, '0'); assert.equal(result.totals[0].signedCash, '40');
  assert.ok(result.warnings.some(row => row.includes('budget changed')));
});

test('payments require a signed deal and explicit evidence confirmation', t => {
  const f = setup(t), deal = f.deal(); f.add(deal);
  assert.throws(() => f.payment(deal.id), /BRAND_PAYMENT_NOT_CONTRACTED/);
  assert.throws(() => f.command('sign', { dealId: deal.id, evidence: 'Fixture', confirmed: false }), /BRAND_CONFIRMATION_REQUIRED/);
  f.sign(deal.id); assert.throws(() => f.payment(deal.id, { evidence: '' }), /BRAND_TEXT_INVALID/);
  assert.throws(() => f.payment(deal.id, { confirmed: false }), /BRAND_CONFIRMATION_REQUIRED/);
});

test('duplicate external payments, overpayments and excessive refunds are rejected', t => {
  const f = setup(t), deal = f.deal(); f.add(deal); f.sign(deal.id); f.payment(deal.id, { externalId: 'BANK-001' });
  assert.throws(() => f.payment(deal.id, { externalId: ' bank-001 ' }), /BRAND_DUPLICATE_PAYMENT/);
  assert.throws(() => f.payment(deal.id, { amount: '31' }), /BRAND_PAYMENT_EXCEEDS_MILESTONE/);
  assert.throws(() => f.payment(deal.id, { kind: 'refund', amount: '11' }), /BRAND_PAYMENT_EXCEEDS_MILESTONE/);
  f.payment(deal.id, { kind: 'refund', amount: '3' }); assert.equal(f.service.load().totals[0].receivedCash, '7');
});

test('cancellation preserves receipts and costs but removes unreceived funding; refunds still work', t => {
  const f = setup(t), deal = f.deal(); f.add(deal); f.sign(deal.id); f.payment(deal.id);
  f.command('cancel', { dealId: deal.id, evidence: 'Synthetic cancellation', confirmed: true });
  let total = f.service.load().totals[0]; assert.equal(total.signedCash, '0'); assert.equal(total.cancelledHeldCash, '10'); assert.equal(total.extraCost, '5');
  assert.throws(() => f.payment(deal.id), /BRAND_PAYMENT_NOT_CONTRACTED/);
  f.payment(deal.id, { kind: 'refund', amount: '10' }); total = f.service.load().totals[0]; assert.equal(total.receivedCash, '0');
});

test('unknown budgets stay unknown and currencies are never converted or combined', t => {
  const f = setup(t, { priced: false }), usd = f.deal(), eur = f.deal({ currency: 'EUR' }); f.add(usd); f.sign(usd.id); f.add(eur); f.sign(eur.id);
  const totals = f.service.load().totals; assert.equal(totals.length, 2);
  for (const row of totals) { assert.equal(row.signedCash, '40'); assert.equal(row.remainingBeforeOtherFunding, null); }
});

test('decimal arithmetic is exact, bounded, and rejects NaN, negative or ambiguous inputs', () => {
  assert.equal(brandDecimal(brandAmount('0.1') + brandAmount('0.2')), '0.3');
  for (const value of [NaN, Infinity, -1, 'NaN', '1e3', '-1', '01', '1,000', '0.0000000001']) assert.throws(() => brandAmount(value), /BRAND_AMOUNT_INVALID/);
  assert.throws(() => brandDecimal(10n ** 27n), /BRAND_AMOUNT_OVERFLOW/);
});

test('request shapes, wrong project, forged review IDs and invalid milestone dates fail closed', t => {
  const f = setup(t), deal = f.deal();
  assert.throws(() => f.command('deal', { deal, budgetHash: f.service.load().budget.recordRef.sha256 }, { projectId: 'foreign' }), /BRAND_PROJECT_MISMATCH/);
  assert.throws(() => f.command('review', { sourceId: f.draft.id, sourceFingerprint: f.source().fingerprint, opportunityId: 'forged', decision: 'approved', reason: 'No source' }), /BRAND_OPPORTUNITY_MISSING/);
  assert.throws(() => validateBrandDeal({ ...deal, secretField: true }), /BRAND_FIELDS_INVALID/);
  assert.throws(() => validateBrandDeal({ ...deal, milestones: [{ ...deal.milestones[0], dueDate: '2026-02-30' }] }), /BRAND_DATE_INVALID/);
  assert.throws(() => validateBrandDeal({ ...deal, milestones: [{ ...deal.milestones[0], amount: '41' }] }), /BRAND_MILESTONE_TOTAL_MISMATCH/);
});

test('SQLite blocks event updates/deletes; reopen retains the hash-linked ledger', t => {
  const f = setup(t); f.review(); const before = f.service.load();
  assert.throws(() => f.store.db.exec("UPDATE brand_financing_events SET request_id='changed'"), /BRAND_LEDGER_APPEND_ONLY/);
  assert.throws(() => f.store.db.exec('DELETE FROM brand_financing_events'), /BRAND_LEDGER_APPEND_ONLY/);
  f.store.close(); const store = new WorkspaceStore(f.directory, validateRecord); t.after(() => store.close());
  const service = createBrandFinancingService(store, { budgetService: createProductionBudgetService(store), actorId: 'synthetic-owner' });
  assert.equal(service.load().headHash, before.headHash); assert.equal(service.load().version, 1);
});

test('ledger tampering is detected on read rather than presented as funding', t => {
  const f = setup(t); f.review();
  f.store.db.exec("DROP TRIGGER immutable_brand_events_update; UPDATE brand_financing_events SET payload='{}'");
  assert.throws(() => f.service.load(), /BRAND_LEDGER_HASH_INVALID/);
});

test('workspace backup/restore retains the financing ledger without credentials', t => {
  const f = setup(t); f.review(); const expected = f.service.load().headHash; f.store.close();
  createBackup(f.directory, path.join(f.root, 'backup'));
  restoreBackup(path.join(f.root, 'backup'), path.join(f.root, 'restored'), validateRecord);
  const restored = new WorkspaceStore(path.join(f.root, 'restored'), validateRecord); t.after(() => restored.close());
  const service = createBrandFinancingService(restored, { budgetService: createProductionBudgetService(restored), actorId: 'restored-owner' });
  assert.equal(service.load().headHash, expected);
});

test('HTTP requires owner session and rejects bridge scope, foreign origins and oversized input', async t => {
  const f = setup(t); f.store.close(); const server = await startServer({ directory: f.directory, port: 0, validateRecord });
  try {
    const base = `${server.origin}/api/brand-financing`;
    assert.equal((await fetch(base)).status, 401);
    const { ownerToken } = JSON.parse(fs.readFileSync(path.join(f.directory, 'config.json')));
    async function login(route) { const r = await fetch(`${server.origin}${route}`, { method: 'POST', headers: { origin: server.origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: ownerToken }) }); assert.equal(r.status, 200); return r.headers.get('set-cookie').split(';')[0]; }
    const bridge = await login('/api/caniscreenwrite/session'); assert.equal((await fetch(base, { headers: { cookie: bridge } })).status, 403);
    const cookie = await login('/api/session'), headers = { cookie, origin: server.origin, 'content-type': 'application/json' };
    assert.equal((await fetch(base, { headers })).status, 200);
    assert.equal((await fetch(base, { headers: { ...headers, origin: 'https://example.invalid' } })).status, 403);
    assert.equal((await fetch(`${base}?unexpected=1`, { headers })).status, 422);
    assert.equal((await fetch(`${base}/command`, { method: 'POST', headers, body: JSON.stringify({ junk: 'x'.repeat(33000) }) })).status, 413);
    const snapshot = await (await fetch(base, { headers })).json(), source = snapshot.sources[0];
    const scan = await (await fetch(`${base}/scan`, { method: 'POST', headers, body: JSON.stringify({ projectId: f.project.id, sourceId: source.id, sourceFingerprint: source.fingerprint }) })).json();
    assert.equal(scan.opportunities.length, 3);
    const bridgeHeaders = { cookie: bridge, origin: server.origin, 'content-type': 'application/json' };
    const request = { projectId: f.project.id, sourceId: source.id, sourceHash: source.sourceHash };
    const contextResponse = await fetch(`${server.origin}/api/caniscreenwrite/brand-context`, { method: 'POST', headers: bridgeHeaders, body: JSON.stringify(request) });
    assert.equal(contextResponse.status, 200); assert.equal((await contextResponse.json()).readOnly, true);
    assert.equal((await fetch(`${base}/command`, { method: 'POST', headers: bridgeHeaders, body: '{}' })).status, 403);
    assert.equal((await fetch(`${server.origin}/api/caniscreenwrite/brand-context`, { method: 'POST', headers: bridgeHeaders, body: JSON.stringify({ ...request, sourceHash: 'f'.repeat(64) }) })).status, 409);
    assert.equal((await fetch(`${server.origin}/api/caniscreenwrite/brand-context?all=true`, { method: 'POST', headers: bridgeHeaders, body: JSON.stringify(request) })).status, 403);
  } finally { await server.close(); }
});

test('source-bound writer context omits financial evidence and never mutates the ledger', t => {
  const f = setup(t), deal = f.deal(); f.add(deal); f.sign(deal.id); f.payment(deal.id);
  const before = f.service.load(), input = { projectId: f.project.id, sourceId: f.draft.id, sourceHash: f.source().sourceHash };
  const context = f.service.context(input);
  assert.equal(context.readOnly, true); assert.equal(context.approvalGranted, false); assert.equal(context.totalsScope, 'PROJECT_NOT_DRAFT');
  assert.equal(context.reviews.length, 1); assert.equal(context.deals.length, 1); assert.equal(context.totals[0].signedCash, '40');
  const serialized = JSON.stringify(context);
  for (const field of ['contractEvidence', 'externalId', 'payments', 'events', 'budgetHash']) assert.equal(serialized.includes(`"${field}"`), false);
  assert.equal(f.service.load().headHash, before.headHash);
  assert.throws(() => f.service.context({ ...input, projectId: 'other' }), /BRAND_PROJECT_MISMATCH/);
  assert.throws(() => f.service.context({ ...input, sourceHash: 'f'.repeat(64) }), /BRAND_SOURCE_CHANGED/);
  assert.throws(() => f.service.context({ ...input, includeEvidence: true }), /BRAND_FIELDS_INVALID/);
});
