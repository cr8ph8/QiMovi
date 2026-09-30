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
  } finally { await server.close(); }
});
