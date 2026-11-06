import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createCreativeProject } from '../local/server/creative-project.mjs';
import { loadConfig } from '../local/server/storage.mjs';
import { validateRecord } from '../local/contracts/drifter.mjs';
import { startServer } from '../local/server/http.mjs';

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qimovi-research-http-'));
  const directory = path.join(root, 'film');
  createCreativeProject(directory, 'Synthetic research test');
  let server = await startServer({ directory, port: 0, validateRecord });
  let cookie = '';
  t.after(async () => { await server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const call = async (route, method = 'GET', value, origin = server.origin) => {
    const response = await fetch(server.origin + route, {
      method, headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  const login = async (bridge = false) => {
    cookie = '';
    assert.equal((await call(bridge ? '/api/caniscreenwrite/session' : '/api/session', 'POST', { token: loadConfig(directory).ownerToken })).status, 200);
  };
  const settled = async () => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const response = await call('/api/research-loop');
      assert.equal(response.status, 200);
      if (!response.data.active) return response.data;
      await delay(10);
    }
    assert.fail('Research job did not settle within its test deadline');
  };
  return { directory, call, login, settled, async reopen() {
    await server.close();
    server = await startServer({ directory, port: 0, validateRecord });
    await login();
  } };
}

const request = projectId => ({ projectId, requestId: crypto.randomUUID(), maxTrials: 8, maxWallMs: 30000, trialTimeoutMs: 10000 });

test('research routes require the local owner and reject bridge, query, project and scope expansion', async t => {
  const f = await fixture(t);
  for (const route of ['/api/research-loop', '/api/research-loop/export']) assert.equal((await f.call(route)).status, 401);
  assert.equal((await f.call('/api/research-loop/start', 'POST', {})).status, 401);
  assert.equal((await f.call('/api/research-loop/review', 'POST', {})).status, 401);
  await f.login(true);
  for (const route of ['/api/research-loop', '/api/research-loop/export']) assert.equal((await f.call(route)).status, 403);
  for (const route of ['/api/research-loop/start', '/api/research-loop/cancel', '/api/research-loop/review']) assert.equal((await f.call(route, 'POST', {})).status, 403);
  await f.login();
  const initial = (await f.call('/api/research-loop')).data;
  assert.equal(initial.degraded, false);
  assert.equal(initial.contract.scope, 'RESEARCH_CONFIGURATION_ONLY');
  assert.equal(initial.contract.dataBasis, 'PUBLIC_SYNTHETIC_FIXTURE');
  assert.equal(initial.contract.provider, 'NONE');
  assert.equal((await f.call('/api/research-loop?projectId=foreign')).status, 422);
  assert.equal((await f.call('/api/research-loop/export?all=true')).status, 422);
  assert.equal((await f.call('/api/research-loop/start', 'POST', request(initial.projectId), 'http://foreign.invalid')).status, 403);
  assert.equal((await f.call('/api/research-loop/start', 'POST', request('foreign'))).data.error, 'RESEARCH_PROJECT_MISMATCH');
  assert.equal((await f.call('/api/research-loop/start', 'POST', { ...request(initial.projectId), productionWrite: true })).data.error, 'RESEARCH_FIELDS_INVALID');
  assert.equal((await f.call('/api/research-loop/start', 'POST', { ...request(initial.projectId), maxTrials: 25 })).data.error, 'RESEARCH_BUDGET_INVALID');
  assert.equal((await f.call('/api/research-loop/cancel', 'POST', { projectId: initial.projectId, runId: 'missing' })).status, 404);
  assert.equal((await f.call('/api/research-loop/unknown', 'GET')).status, 404);
  assert.deepEqual((await f.call('/api/research-loop')).data.accepted, initial.accepted);
});

test('owner research persists confirmed configuration only, exports receipts and accounts for the real job', async t => {
  const f = await fixture(t);
  await f.login();
  const before = (await f.call('/api/bootstrap')).data;
  const library = (await f.call('/api/project-library')).data;
  const financing = (await f.call('/api/brand-financing')).data;
  const initial = (await f.call('/api/research-loop')).data;
  const input = request(initial.projectId);
  const started = await f.call('/api/research-loop/start', 'POST', input);
  assert.equal(started.status, 200);
  assert.ok(started.data.active);
  assert.deepEqual(started.data.accepted, initial.accepted, 'starting work cannot promote a configuration');
  const replay = await f.call('/api/research-loop/start', 'POST', input);
  assert.equal(replay.status, 200);
  assert.equal(replay.data.runs[0].id, started.data.runs[0].id);
  assert.equal((await f.call('/api/research-loop/start', 'POST', { ...input, maxTrials: 7 })).data.error, 'RESEARCH_REPLAY_CONFLICT');
  const done = await f.settled();
  assert.equal(done.runs.length, 1);
  assert.equal(done.runs[0].status, 'COMPLETED');
  assert.equal(done.runs[0].reason, 'OWNER_REVIEW_REQUIRED');
  assert.deepEqual(done.accepted, initial.accepted);
  const approval = { projectId: initial.projectId, runId: done.runs[0].id, proposalHash: done.pendingReviews[0].proposalHash, action: 'APPROVE' };
  assert.equal((await f.call('/api/research-loop/review', 'POST', approval, 'http://foreign.invalid')).status, 403);
  assert.equal((await f.call('/api/research-loop/review', 'POST', { ...approval, productionWrite: true })).status, 422);
  assert.equal((await f.call('/api/research-loop/review', 'POST', { ...approval, proposalHash: 'a'.repeat(64) })).status, 409);
  const approved = await f.call('/api/research-loop/review', 'POST', approval);
  assert.equal(approved.status, 200);
  assert.equal(approved.data.runs[0].review.decision, 'COMMIT');
  assert.equal(approved.data.accepted.version, initial.accepted.version + 1);
  assert.deepEqual((await f.call('/api/research-loop/review', 'POST', approval)).data.accepted, approved.data.accepted);
  assert.ok(done.runs[0].confirmation.candidate.correct > done.runs[0].confirmation.baseline.correct);
  assert.equal(done.runs[0].resources.inputTokens, 0);
  assert.equal(done.runs[0].resources.outputTokens, 0);
  assert.equal(done.runs[0].resources.providerCostUsd, '0');
  assert.equal(done.runs[0].resources.energyKwh, null);
  assert.ok(done.runs[0].resources.elapsedMs > 0);
  assert.ok(done.runs[0].resources.resultBytes > 0);
  const accounting = (await f.call('/api/resource-accounting')).data;
  assert.ok(accounting.researchRuns.some(run => run.id === done.runs[0].id && run.resources?.energyKwh === null));
  assert.deepEqual((await f.call('/api/bootstrap')).data, before);
  assert.deepEqual((await f.call('/api/project-library')).data, library);
  assert.deepEqual((await f.call('/api/brand-financing')).data, financing);
  const exported = await f.call('/api/research-loop/export');
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-disposition'), /private-research-loop\.json/);
  assert.equal(exported.data.events.filter(event => event.data.decision === 'COMMIT').length, 1);
  assert.ok(exported.data.events.some(event => event.type === 'run-review' && event.data.actor === 'local-owner' && event.data.decision === 'COMMIT'));
  await f.reopen();
  const reopened = (await f.call('/api/research-loop')).data;
  assert.deepEqual(reopened.accepted, approved.data.accepted);
  assert.equal(reopened.runs[0].id, done.runs[0].id);
  assert.equal((await f.call('/api/research-loop/start', 'POST', input)).data.runs.length, 1);
});

test('a saved screenplay change after evaluation invalidates the approval', async t => {
  const f = await fixture(t); await f.login();
  const initial = (await f.call('/api/research-loop')).data;
  assert.equal((await f.call('/api/research-loop/start', 'POST', request(initial.projectId))).status, 200);
  const proposal = (await f.settled()).pendingReviews[0];
  const saved = await f.call('/api/records/screenplay-draft:review-stale', 'PUT', {
    kind: 'screenplay-draft', expectedVersion: null, requestId: crypto.randomUUID(),
    data: { schemaVersion: 2, projectId: initial.projectId, sourceHash: null, title: 'Saved owner draft', format: 'FOUNTAIN', body: 'INT. TEST ROOM - DAY\n\nA new revision.\n', status: 'DRAFT' },
  });
  assert.equal(saved.status, 200);
  const result = await f.call('/api/research-loop/review', 'POST', { projectId: initial.projectId, runId: proposal.id, proposalHash: proposal.proposalHash, action: 'APPROVE' });
  assert.equal(result.status, 200);
  assert.equal(result.data.runs[0].review.decision, 'ESCALATE');
  assert.equal(result.data.runs[0].review.reason, 'SOURCE_OR_ACCEPTED_STATE_CHANGED');
  assert.deepEqual(result.data.accepted, initial.accepted);
  assert.deepEqual(result.data.pendingReviews, []);
});

test('an owner edit during research invalidates its source snapshot without touching the edited draft', async t => {
  const f = await fixture(t);
  await f.login();
  const initial = (await f.call('/api/research-loop')).data;
  const started = await f.call('/api/research-loop/start', 'POST', request(initial.projectId));
  assert.ok(started.data.active);
  const saved = await f.call('/api/records/screenplay-draft:research-source-test', 'PUT', {
    kind: 'screenplay-draft', expectedVersion: null, requestId: crypto.randomUUID(),
    data: { schemaVersion: 2, projectId: initial.projectId, sourceHash: null, title: 'Owner draft', format: 'FOUNTAIN', body: 'INT. TEST ROOM - DAY\n\nThe owner changes the scene.\n', status: 'DRAFT' },
  });
  assert.equal(saved.status, 200);
  const done = await f.settled();
  assert.equal(done.runs[0].reason, 'SOURCE_OR_ACCEPTED_STATE_CHANGED');
  assert.equal(done.runs[0].decision, 'ESCALATE');
  assert.deepEqual(done.accepted, initial.accepted);
  assert.ok((await f.call('/api/records?kind=screenplay-draft')).data.some(record => record.id === saved.data.id && record.sha256 === saved.data.sha256));
});

test('explicit cancellation and server shutdown stop research before closing storage', async t => {
  const f = await fixture(t);
  await f.login();
  const initial = (await f.call('/api/research-loop')).data;
  const started = await f.call('/api/research-loop/start', 'POST', request(initial.projectId));
  assert.ok(started.data.active);
  const cancelled = await f.call('/api/research-loop/cancel', 'POST', { projectId: initial.projectId, runId: started.data.active.id });
  assert.equal(cancelled.status, 200);
  assert.equal((await f.settled()).runs[0].status, 'CANCELLED');
  const closing = await f.call('/api/research-loop/start', 'POST', request(initial.projectId));
  assert.ok(closing.data.active);
  await f.reopen();
  const reopened = (await f.call('/api/research-loop')).data;
  assert.equal(reopened.active, null);
  assert.equal(reopened.runs[0].status, 'CANCELLED');
  assert.equal(reopened.runs[0].id, closing.data.active.id);
  assert.notEqual(reopened.runs[0].decision, 'COMMIT');
  assert.deepEqual(reopened.accepted, initial.accepted);
  assert.equal((await f.call('/api/resource-accounting')).data.researchRuns[0].status, 'CANCELLED');
});
