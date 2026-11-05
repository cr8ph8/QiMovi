import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createCreativeProject } from '../local/server/creative-project.mjs';
import { WorkspaceStore, canonical } from '../local/server/storage.mjs';
import { validateRecord } from '../local/contracts/drifter.mjs';
import { createProductionBudgetService } from '../local/server/production-budget.mjs';
import { createBrandFinancingService } from '../local/server/brand-financing.mjs';

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
  const source = () => service.load().sources.find(row => row.id === draft.id);
  const scan = () => service.scan({ projectId: project.id, sourceId: draft.id, sourceFingerprint: source().fingerprint });
  const command = (action, data, overrides = {}) => service.command({ projectId: project.id, expectedVersion: service.load().version, requestId: crypto.randomUUID(), action, data, ...overrides });
  const review = (decision = 'approved') => { const opportunity = scan().opportunities[0]; command('review', { sourceId: draft.id, sourceFingerprint: source().fingerprint, opportunityId: opportunity.id, decision, reason: 'Existing natural action; reviewed by owner.' }); return opportunity; };
  const deal = (overrides = {}) => ({ id: `deal:${crypto.randomUUID()}`, sponsor: 'Synthetic Sponsor', opportunityId: review().id, currency: 'USD', cash: '40', extraCost: '5', marketingSupport: '200', savings: [], milestones: [{ id: 'deposit', label: 'Deposit', amount: '40', dueDate: '2026-11-20' }], notes: 'Synthetic fixture. No commercial agreement exists.', ...overrides });
  const add = value => command('deal', { deal: value, budgetHash: service.load().budget.recordRef?.sha256 ?? null });
  return { store, project, draft, service, source, scan, command, deal, add };
}


test('multiline review, deal and receipt evidence survives ledger replay and separate milestone accounting', t => {
  const f = setup(t), opportunity = f.scan().opportunities[0];
  const reason = 'Natural character action.\r\nNo change to dialogue.';
  const notes = 'Deliver the reviewed scene.\nNo rights clearance implied.';
  const evidence = 'Synthetic contract\r\nFixture reference only.';
  const authored = canonical(f.store.rawList());
  f.command('review', { sourceId: f.draft.id, sourceFingerprint: f.source().fingerprint, opportunityId: opportunity.id, decision: 'approved', reason });
  const deal = { ...f.deal({ opportunityId: opportunity.id }), notes,
    milestones: [{ id: 'deposit|first', label: 'First payment', amount: '20', dueDate: null },
      { id: 'final', label: 'Final payment', amount: '20', dueDate: '2026-12-01' }] };
  // The fixture helper reviews once; retain the explicit multiline review as the latest decision.
  f.command('review', { sourceId: f.draft.id, sourceFingerprint: f.source().fingerprint, opportunityId: opportunity.id, decision: 'approved', reason });
  f.add(deal);
  f.command('sign', { dealId: deal.id, evidence, confirmed: true });
  const request = { projectId: f.project.id, expectedVersion: f.service.load().version, requestId: crypto.randomUUID(), action: 'payment',
    data: { dealId: deal.id, milestoneId: 'deposit|first', kind: 'receipt', amount: '10', externalId: 'split-deposit-1',
      evidence: 'Synthetic receipt\nNo real funds moved.', receivedDate: '2026-11-04', confirmed: true } };
  const beforePayment = f.service.load().version;
  f.service.command(request); const result = f.service.command(request);
  assert.equal(result.replayed, true); assert.equal(result.version, beforePayment + 1);
  assert.equal(result.reviews[0].reason, reason); assert.equal(result.deals[0].notes, notes);
  assert.equal(result.deals[0].contractEvidence, evidence); assert.equal(result.payments[0].evidence, request.data.evidence);
  assert.equal(result.payments[0].milestoneId, 'deposit|first');
  assert.equal(result.schedule.find(row => row.milestoneId === 'deposit|first').outstanding, '10');
  assert.equal(result.schedule.find(row => row.milestoneId === 'final').outstanding, '20');
  assert.equal(result.totals[0].signedCash, '40'); assert.equal(result.totals[0].receivedCash, '10');
  assert.equal(result.totals[0].remainingBeforeOtherFunding, '65');
  assert.equal(canonical(f.store.rawList()), authored, 'financing never edits screenplay or expense records');
});

test('invalid narrative controls reject atomically and cannot turn a draft into signed funding', t => {
  const f = setup(t), deal = f.deal(); f.add(deal); const before = f.service.load();
  for (const evidence of ['synthetic\u0000hidden', '\n\t ', 'x'.repeat(2001)]) {
    assert.throws(() => f.command('sign', { dealId: deal.id, evidence, confirmed: true }), /BRAND_TEXT_INVALID/);
    assert.equal(f.service.load().headHash, before.headHash);
    assert.equal(f.service.load().version, before.version);
    assert.equal(f.service.load().totals[0].signedCash, '0');
  }
});
