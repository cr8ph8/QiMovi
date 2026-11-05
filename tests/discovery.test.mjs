import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashCanonical } from '../local/kernel/src/canonical-json.mjs';
import { validDiscoveryVideo, validRetentionRequest } from '../local/contracts/discovery.mjs';
import { datasetHash, sourceCatalog, videoRecords } from '../local/discovery/fixtures.mjs';
import { discoveryStateHash, governDiscovery } from '../local/discovery/admission.mjs';
import { benchmarkDiscovery, runDiscovery } from '../local/discovery/experiment.mjs';
import { validateRecord } from '../local/contracts/drifter.mjs';
import { createCreativeProject } from '../local/server/creative-project.mjs';
import { startServer } from '../local/server/http.mjs';
import { loadConfig } from '../local/server/storage.mjs';

const noteAtLimit = 'a'.repeat(498) + '\nb';

test('retention accepts multiline prose within the note length and character limits', () => {
  const review = {
    projectId: 'fixture', queryId: 'lighting', videoId: 'vid-lighting-01', receiptHash: 'a'.repeat(64),
    note: 'Compare the lighting.\r\n\tCheck the shadows.\nKeep the rehearsal short.', confirmed: true,
  };
  assert.ok(validRetentionRequest(review));
  assert.ok(validRetentionRequest({ ...review, note: noteAtLimit }));
  for (const note of [noteAtLimit + 'x', '', ' \t\r\n ', 'a\0b', 'a\vb', 'a\fb', 'a\x1bb', 'a\x7fb', '\ud800\n\udc00']) {
    assert.equal(validRetentionRequest({ ...review, note }), false, JSON.stringify(note));
  }
  for (const field of ['projectId', 'queryId', 'videoId', 'receiptHash']) {
    assert.equal(validRetentionRequest({ ...review, [field]: review[field] + '\n' }), false, field);
  }
  assert.equal(validDiscoveryVideo({ ...videoRecords[0], description: 'Line one.\nLine two.' }), false);
});

test('frozen 100-record experiment reproduces decision, quality and cost metrics', () => {
  assert.equal(datasetHash, 'bd878fcd1f0170daaa433ff08ca40918d2c4b37dcc1684e0332d387c22a62593');
  assert.equal(videoRecords.length, 100);
  assert.equal(new Set(videoRecords.map(row => row.sourceId)).size, 90);
  assert.ok(videoRecords.every(validDiscoveryVideo));
  assert.notEqual(videoRecords[0].evidence[0], sourceCatalog.get(videoRecords[0].sourceId).evidence[0]);
  const result = benchmarkDiscovery({ repetitions: 2, includeLedger: true });
  assert.deepEqual(result.decisions, { COMMIT: 40, DAMP: 10, ESCALATE: 20, REJECT: 30 });
  assert.equal(result.decisionMismatches, 0);
  assert.equal(result.baseline.fullCorpus.admittedRows, 100);
  assert.equal(result.baseline.fullCorpus.falseAdmissions, 50);
  assert.equal(result.baseline.fullCorpus.duplicateRows, 10);
  assert.equal(result.governed.fullCorpus.admittedRows, 40);
  assert.equal(result.governed.fullCorpus.falseAdmissions, 0);
  assert.equal(result.governed.fullCorpus.duplicateRows, 0);
  assert.equal(result.governed.fullCorpus.missedEligible, 0);
  assert.deepEqual(result.baseline.queryMacroAverage, { precisionAt5: 0.8, ndcgAt5: 0.840093, uniqueRelevantRecallAt5: 0.5 });
  assert.deepEqual(result.governed.queryMacroAverage, { precisionAt5: 0.6, ndcgAt5: 0.415021, uniqueRelevantRecallAt5: 0.375 });
  for (const arm of [result.baseline, result.governed]) {
    assert.deepEqual(arm.fullCorpus.usage, {
      provider: 'none', providerRequests: 0, inputTokens: 0, outputTokens: 0,
      estimatedProviderCostUsd: '0.00', basis: 'NO_PROVIDER_CALLS', hardwareEnergy: 'UNMETERED',
    });
    assert.ok(arm.fullCorpusTiming.medianMs >= 0 && arm.fullCorpusTiming.p95Ms >= arm.fullCorpusTiming.medianMs);
  }
  let previous = null;
  const records = new Map(videoRecords.map(row => [row.id, row]));
  const state = new Set();
  for (const { eventHash, ...event } of result.ledger) {
    assert.equal(event.previousEventHash, previous);
    assert.equal(hashCanonical(event), eventHash);
    assert.equal(event.preStateHash, discoveryStateHash(state));
    if (event.decision === 'COMMIT') state.add(records.get(event.proposal.videoId).sourceId);
    else assert.equal(event.preStateHash, event.postStateHash);
    assert.equal(event.postStateHash, discoveryStateHash(state));
    previous = eventHash;
  }
  assert.equal(previous, result.ledgerHead);
  assert.equal(previous, runDiscovery('all', { governedFirst: true }).ledgerHead);
});

test('the independent verifier fails closed for tampered, missing and unavailable evidence', () => {
  const record = structuredClone(videoRecords[0]);
  const proposal = { videoId: record.id, score: 9999, matchedTerms: [], endorsements: 9999 };
  const run = (catalog = sourceCatalog, proposals = [proposal]) => governDiscovery(
    proposals, new Map([[record.id, record]]), catalog, { datasetHash, queryId: 'lighting' });
  const [commit, duplicate] = run(sourceCatalog, [proposal, proposal]);
  assert.equal(commit.decision, 'COMMIT');
  assert.equal(duplicate.decision, 'DAMP');
  assert.equal(duplicate.preStateHash, duplicate.postStateHash);
  assert.equal(run(new Map())[0].decision, 'ESCALATE');
  const [error] = run({ get() { throw new Error('Unavailable catalog'); } });
  assert.equal(error.checks[0].status, 'ERROR');
  assert.equal(error.decision, 'ESCALATE');
  record.evidence[0].atSeconds++;
  assert.equal(run()[0].decision, 'REJECT');
  record.evidence = [];
  assert.equal(run()[0].checks[0].status, 'FAIL');
  assert.equal(run()[0].decision, 'REJECT');
});

test('loopback owner reviews are evidence-bound, idempotent and isolated from production and financing', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qimovi-discovery-'));
  const directory = path.join(root, 'film');
  createCreativeProject(directory, 'Discovery fixture');
  const open = () => startServer({ directory, port: 0, validateRecord });
  let server = await open();
  t.after(async () => { await server.close(); fs.rmSync(root, { recursive: true, force: true }); });

  let cookie = '';
  const route = '/api/discovery';
  async function call(suffix, value, origin = server.origin) {
    const response = await fetch(server.origin + suffix, { method: value === undefined ? 'GET' : 'POST',
      headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
    const session = response.headers.get('set-cookie');
    if (session) cookie = session.split(';')[0];
    return { status: response.status, data: await response.json() };
  }
  const login = (endpoint = '/api/session') => call(endpoint, { token: loadConfig(directory).ownerToken });
  assert.equal((await call(route)).status, 401);
  assert.equal((await call(route + '/run?query=lighting')).status, 401);
  assert.equal((await login('/api/caniscreenwrite/session')).status, 200);
  assert.equal((await call(route)).status, 403);
  assert.equal((await call(route + '/retain', {})).status, 403);
  assert.equal((await login()).status, 200);

  const before = await Promise.all(['/api/bootstrap', '/api/project-library', '/api/brand-financing'].map(endpoint => call(endpoint)));
  for (const value of before) assert.equal(value.status, 200);
  assert.equal((await call(route + '/run?query=lighting&query=color')).status, 422);
  assert.equal((await call(route + '/run?query=private')).status, 422);
  const { status, data: run } = await call(route + '/run?query=lighting');
  assert.equal(status, 200);
  assert.equal(run.scope, 'RESEARCH_REFERENCE_ONLY');
  assert.equal((await call(route)).data.retained.length, 0);
  const committed = run.candidates.filter(row => row.event.decision === 'COMMIT');
  const rejected = run.candidates.find(row => row.event.decision === 'REJECT');
  const review = candidate => ({ projectId: run.projectId, queryId: run.query.id,
    videoId: candidate.record.id, receiptHash: candidate.event.eventHash,
    note: 'Useful as a synthetic rehearsal reference.', confirmed: true });
  const input = review(committed[0]);
  const retain = (body, origin) => call(route + '/retain', body, origin);
  assert.equal((await retain(input, 'http://foreign.invalid')).status, 403);
  assert.equal((await retain({ ...input, confirmed: false })).status, 422);
  assert.equal((await retain({ ...input, distributionAuthorized: true })).status, 422);
  assert.equal((await retain({ ...input, projectId: 'another-project' })).status, 409);
  assert.equal((await retain({ ...input, receiptHash: '0'.repeat(64) })).data.error, 'DISCOVERY_REVIEW_STALE');
  assert.equal((await retain(review(rejected))).data.error, 'DISCOVERY_CANDIDATE_NOT_ADMITTED');
  for (const note of [noteAtLimit + 'x', ' \n\t ', 'Invalid\ncontrol\x1b']) {
    const response = await retain({ ...input, note });
    assert.equal(response.status, 422);
    assert.equal(response.data.error, 'DISCOVERY_REVIEW_REQUIRED');
  }
  assert.equal((await call(route)).data.retained.length, 0);

  const multiline = { ...input, note: 'Use this for the lighting rehearsal.\n\n- Compare contrast between setups.' };
  const [first, retry] = await Promise.all([retain(multiline), retain(multiline)]);
  assert.equal(first.status, 200);
  assert.deepEqual(retry, first);
  assert.equal(first.data.scope, 'RESEARCH_REFERENCE_ONLY');
  assert.equal(first.data.reference.admission.eventHash, input.receiptHash);
  assert.equal(first.data.reference.note, multiline.note);
  assert.equal((await retain({ ...input, note: 'Changed review' })).data.error, 'DISCOVERY_ALREADY_RETAINED');
  const second = await retain({ ...review(committed[1]), note: noteAtLimit });
  assert.equal(second.status, 200);
  assert.equal(second.data.reference.note, noteAtLimit);
  assert.equal(second.data.previousEventHash, first.data.eventHash);
  assert.equal(second.data.preStateHash, first.data.postStateHash);
  const after = await Promise.all(['/api/bootstrap', '/api/project-library', '/api/brand-financing'].map(endpoint => call(endpoint)));
  assert.deepEqual(after, before);
  await server.close();

  server = await open();
  assert.equal((await login()).status, 200);
  assert.deepEqual((await call(route)).data.retained, [first.data, second.data]);
  assert.deepEqual(await retain(multiline), first);
  const db = new DatabaseSync(path.join(directory, 'workspace.sqlite'));
  try {
    const tamper = "UPDATE discovery_retention_events SET event_hash = 'tampered' WHERE seq = 1";
    assert.throws(() => db.exec(tamper), /DISCOVERY_LEDGER_APPEND_ONLY/);
    assert.throws(() => db.exec('DELETE FROM discovery_retention_events WHERE seq = 1'), /DISCOVERY_LEDGER_APPEND_ONLY/);
    db.exec('DROP TRIGGER immutable_discovery_events_update');
    db.exec(tamper);
  } finally { db.close(); }
  assert.equal((await call(route)).data.error, 'DISCOVERY_LEDGER_INVALID');
  assert.equal((await retain(review(committed[2]))).data.error, 'DISCOVERY_LEDGER_INVALID');
});
