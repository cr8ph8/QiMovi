import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { brandNarrative, brandText, validateBrandDeal, scanBrandOpportunities } from '../local/contracts/brand-financing.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const deal = () => ({ id: 'deal:synthetic', sponsor: 'Synthetic sponsor', opportunityId: 'placement:synthetic',
  currency: 'USD', cash: '40', extraCost: '5', marketingSupport: '100',
  savings: [{ lineId: 'equipment', amount: '10', basis: 'Avoid rental\r\nOwner estimate only' }],
  milestones: [{ id: 'deposit|first', label: 'Deposit', amount: '20', dueDate: null },
    { id: 'delivery', label: 'Delivery', amount: '20', dueDate: '2026-12-01' }],
  notes: 'One natural placement.\r\nNo screenplay changes.\n\tNo external rights clearance.' });

test('narrative inputs preserve authored LF, CRLF, tabs and Unicode without normalizing evidence', () => {
  for (const value of ['First\nSecond', 'First\r\nSecond', '\tSynthetic evidence: café 😀', 'First\rSecond']) {
    assert.equal(brandNarrative(value), value);
  }
  const value = deal(); assert.deepEqual(validateBrandDeal(value), value);
});

test('multiline narrative validation stays bounded and rejects hidden controls or malformed Unicode', () => {
  for (const value of ['', '\n\r\t ', 'x'.repeat(2001), 'valid\u0000hidden', 'valid\u000bhidden',
    'valid\u000chidden', 'valid\u001bhidden', 'valid\u007fhidden', '\ud800', 42, null]) {
    assert.throws(() => brandNarrative(value), /BRAND_TEXT_INVALID/);
  }
  assert.equal(brandNarrative('x'.repeat(2000)).length, 2000);
  assert.throws(() => validateBrandDeal({ ...deal(), notes: 'x'.repeat(2001) }), /BRAND_TEXT_INVALID/);
  assert.throws(() => validateBrandDeal({ ...deal(), savings: [{ ...deal().savings[0], basis: 'x'.repeat(1001) }] }), /BRAND_TEXT_INVALID/);
});

test('narrative support does not relax scalar sponsor, milestone or reference validation', () => {
  for (const value of ['bank\nreference', 'bank\rreference', 'bank\treference']) {
    assert.throws(() => brandText(value), /BRAND_TEXT_INVALID/);
  }
  assert.throws(() => validateBrandDeal({ ...deal(), sponsor: 'Synthetic\nsponsor' }), /BRAND_TEXT_INVALID/);
  assert.throws(() => validateBrandDeal({ ...deal(), milestones: [{ ...deal().milestones[0], id: 'bad\nid' }] }), /BRAND_TEXT_INVALID/);
});

test('split payment milestones retain their exact identities and must reconcile to contract cash', () => {
  const value = deal(); validateBrandDeal(value);
  assert.equal(value.milestones[0].id, 'deposit|first');
  assert.throws(() => validateBrandDeal({ ...value, milestones: [...value.milestones, value.milestones[0]] }), /BRAND_MILESTONE_INVALID/);
  assert.throws(() => validateBrandDeal({ ...value, cash: '41' }), /BRAND_MILESTONE_TOTAL_MISMATCH/);
});

test('shared scanner keeps exact saved-revision evidence and source inputs immutable', () => {
  const text = 'Title: Coffee\r\n\r\nINT. STUDIO - DAY\r\n\r\n😀 Ari carries coffee and a laptop.\r\n[[a car]]\r\n/* a truck */\r\n';
  const source = Object.freeze({ id: 'screenplay-draft:synthetic', fingerprint: hash('v1'), sourceHash: hash(text), recordRef: null });
  const a = scanBrandOpportunities(text, source, hash), b = scanBrandOpportunities(text, source, hash);
  assert.deepEqual(a, b); assert.equal(a.truncated, false);
  assert.deepEqual(a.opportunities.map(row => row.quote), ['coffee', 'laptop']);
  for (const row of a.opportunities) {
    assert.equal(row.quote, text.slice(row.start, row.end)); assert.equal(row.productionSceneId, null);
    assert.deepEqual(row.source, source);
  }
  const revised = scanBrandOpportunities(text, { ...source, fingerprint: hash('v2') }, hash);
  assert.notEqual(revised.opportunities[0].id, a.opportunities[0].id);
});
