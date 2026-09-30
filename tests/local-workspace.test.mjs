import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCreativeProject } from '../local/server/creative-project.mjs';
import { WorkspaceStore } from '../local/server/storage.mjs';
import { validateRecord } from '../local/contracts/drifter.mjs';
import { createBackup, restoreBackup, verifyBackup } from '../local/server/recovery.mjs';
import { startServer } from '../local/server/http.mjs';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qimovi-source-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'film');
  const result = createCreativeProject(directory, 'Synthetic Example Film');
  return { root, directory, result };
}

test('a new film persists empty and existing destinations are never overwritten', t => {
  const { directory, result } = workspace(t);
  const store = new WorkspaceStore(directory, validateRecord);
  try {
    assert.equal(store.project().id, result.projectId);
    assert.equal(store.project().title, 'Synthetic Example Film');
    assert.equal(store.project().sourceHash, null);
    assert.deepEqual(store.project().scenes, []);
  } finally { store.close(); }
  const prior = fs.readFileSync(path.join(directory, 'config.json'));
  assert.throws(() => createCreativeProject(directory, 'Replacement'), /CREATIVE_PROJECT_DESTINATION_EXISTS/);
  assert.deepEqual(fs.readFileSync(path.join(directory, 'config.json')), prior);
});

test('backup excludes credentials and restores the same film identity', t => {
  const { root, directory, result } = workspace(t);
  const backup = path.join(root, 'backup');
  const receipt = createBackup(directory, backup);
  assert.equal(receipt.credentialsIncluded, false);
  assert.equal(fs.existsSync(path.join(backup, 'config.json')), false);
  verifyBackup(backup);
  const restored = restoreBackup(backup, path.join(root, 'restored'), validateRecord);
  assert.equal(restored.projectId, result.projectId);
  assert.equal(restored.eventReplayVerified, true);
});

test('local owner session protects project data and rejects foreign origins', async t => {
  const { directory } = workspace(t);
  // Ephemeral loopback only; this never invokes external providers.
  const server = await startServer({ directory, port: 0, validateRecord });
  try {
    const unauthenticated = await fetch(`${server.origin}/api/bootstrap`);
    assert.equal(unauthenticated.status, 401);
    const { ownerToken } = JSON.parse(fs.readFileSync(path.join(directory, 'config.json')));
    const session = await fetch(`${server.origin}/api/session`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: server.origin },
      body: JSON.stringify({ token: ownerToken }),
    });
    assert.equal(session.status, 200);
    const cookie = session.headers.get('set-cookie').split(';')[0];
    const project = await fetch(`${server.origin}/api/bootstrap`, { headers: { cookie } });
    assert.equal(project.status, 200);
    const blocked = await fetch(`${server.origin}/api/bootstrap`, { headers: { cookie, origin: 'https://example.invalid' } });
    assert.equal(blocked.status, 403);
    assert.equal((await fetch(`${server.origin}/api/phone/export`)).status, 401);
    const slate = await (await fetch(`${server.origin}/api/phone/export`, { headers: { cookie } })).json();
    slate.projects[0].tasks.push({ id: 'phone-task:synthetic', title: 'Confirm camera blocking', phase: 'Pre-production', status: 'todo' });
    const review = { schemaVersion: 'qimovi-production-review/v1', exportedAt: new Date().toISOString(), origin: 'Synthetic phone', scope: 'PHONE_PLANNING_REVIEW_ONLY', desktopApplied: false, productionApproval: false, project: slate.projects[0] };
    const headers = { cookie, origin: server.origin, 'content-type': 'application/json' };
    const previewResponse = await fetch(`${server.origin}/api/phone/preview`, { method: 'POST', headers, body: JSON.stringify(review) });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    const change = preview.changes.find(row => row.status === 'READY');
    assert.ok(change);
    const applied = await fetch(`${server.origin}/api/phone/apply`, { method: 'POST', headers, body: JSON.stringify({ reviewPackage: review, changeId: change.id, previewSha256: preview.previewSha256, expectedVersion: change.expectedVersion, requestId: 'http-phone-test' }) });
    assert.equal(applied.status, 200);
    assert.equal((await applied.json()).record.data.nextActions[0].title, 'Confirm camera blocking');
    const bridge = await fetch(`${server.origin}/api/caniscreenwrite/session`, { method: 'POST', headers, body: JSON.stringify({ token: ownerToken }) });
    const bridgeCookie = bridge.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${server.origin}/api/phone/export`, { headers: { cookie: bridgeCookie } })).status, 403);

    const phonePrevizFolder = path.join(directory, 'integrations', 'phone-previz');
    assert.equal(fs.existsSync(phonePrevizFolder), false);
    for (const [method, route] of [
      ['GET', '/api/phone-previz?sceneId=synthetic-scene&shotId=synthetic-shot'],
      ['POST', '/api/phone-previz/preview'],
      ['POST', '/api/phone-previz/retain'],
    ]) {
      // Auth must reject before parsing artifact data or looking up a shot.
      const request = { method, headers: { origin: server.origin, 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}) };
      const anonymous = await fetch(`${server.origin}${route}`, request);
      assert.equal(anonymous.status, 401, `${method} ${route} requires the owner session`);
      assert.equal((await anonymous.json()).error, 'OWNER_SESSION_REQUIRED');
      const writer = await fetch(`${server.origin}${route}`, { ...request, headers: { ...request.headers, cookie: bridgeCookie } });
      assert.equal(writer.status, 403, `${method} ${route} rejects the scoped writer session`);
      assert.equal((await writer.json()).error, 'CANISCREENWRITE_SCOPE_REJECTED');
    }
    assert.equal(fs.existsSync(phonePrevizFolder), false, 'rejected clients must not retain phone artifacts');
    const ownerPreviz = await fetch(`${server.origin}/api/phone-previz?sceneId=synthetic-scene&shotId=synthetic-shot`, { headers: { cookie } });
    assert.equal(ownerPreviz.status, 409, 'the owner reaches source/shot validation in this empty film');
    assert.equal((await ownerPreviz.json()).error, 'PHONE_PREVIZ_SHOT_UNAVAILABLE');

  } finally { await server.close(); }
});
