import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCreativeProject } from '../local/server/creative-project.mjs';
import { loadConfig } from '../local/server/storage.mjs';
import { validateRecord } from '../local/contracts/drifter.mjs';
import { startServer } from '../local/server/http.mjs';
test('global accounting reuses the budget, remains owner-only and never creates financial approval', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-movi-http-')), directory = path.join(root, 'film'); createCreativeProject(directory, 'Synthetic');
  const server = await startServer({ directory, port: 0, validateRecord });
  t.after(async () => { await server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  let cookie = '';
  async function call(route, method = 'GET', value, origin = server.origin) {
    const response = await fetch(server.origin + route, { method, headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: value === undefined ? undefined : JSON.stringify(value) });
    const set = response.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]; return { status: response.status, data: await response.json() };
  }
  assert.equal((await call('/api/resource-accounting')).status, 401);
  await call('/api/session', 'POST', { token: loadConfig(directory).ownerToken });
  const before = (await call('/api/bootstrap')).data, costs = await call('/api/resource-accounting');
  assert.equal(costs.status, 200); assert.equal(costs.data.projectId, before.project.id); assert.equal(costs.data.spendAuthorized, false);
  assert.deepEqual(costs.data.production.totals, [], 'an empty saved budget must not invent a zero-dollar total'); assert.equal(costs.data.coverage.hardwareEnergy, 'UNMETERED');
  const beforeJournal = (await call('/api/resource-accounting/export')).data;
  await call('/api/resource-accounting');
  assert.deepEqual((await call('/api/resource-accounting/export')).data.events, beforeJournal.events);
  assert.equal((await call('/api/resource-accounting/rate', 'POST', {}, 'http://foreign.invalid')).status, 403);
  assert.deepEqual((await call('/api/bootstrap')).data.records, before.records);
  cookie = ''; await call('/api/caniscreenwrite/session', 'POST', { token: loadConfig(directory).ownerToken });
  assert.equal((await call('/api/resource-accounting')).status, 403); assert.equal((await call('/api/resource-accounting/entry', 'POST', {})).status, 403);
});
