import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { buildCameraExchange } from '../local/integrations/three-d/exchange.mjs';
import { createDccRehearsalService } from '../local/server/dcc-rehearsals.mjs';

// Synthetic store: no screenplay, production workspace or Blender is opened.
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qimovi-previz-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const project = {
    id: 'synthetic-film', sourceHash: 'a'.repeat(64), cells: [],
    scenes: [{ id: 'scene-1', heading: 'INT. SYNTHETIC ROOM - DAY', paragraphs: [],
      shots: [{ id: 'shot-1', label: '1A', description: 'An unassigned stand-in.' }] }],
  };
  const records = [];
  const store = { directory, project: () => project, resolvedProject: () => project, rawList: () => records };
  const exchange = buildCameraExchange({ project, records }, { sceneId: 'scene-1', expectedSourceHash: project.sourceHash });
  const input = { jobId: '00000000-0000-4000-8000-000000000001', options: {
    sceneId: 'scene-1', expectedSourceHash: project.sourceHash, expectedBasisHash: exchange.basis.sha256,
    shotId: 'shot-1', target: 'BLENDER', lensMm: 35, durationSeconds: 2, motion: 'STATIC', travelMm: 0, blockingNotes: '',
  } };
  const blenderPath = path.join(directory, 'synthetic-blender');
  fs.writeFileSync(blenderPath, 'synthetic executable identity; never executed', { mode: 0o700 });
  return { store, project, records, input, blenderPath, directory };
}

async function terminal(service) {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const result = service.list('scene-1');
    if (!result.busy) return result.jobs[0];
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Synthetic rehearsal did not settle');
}

for (const [label, edit, expectedError] of [
  ['source', f => { f.project.sourceHash = 'b'.repeat(64); }, 'DCC_SOURCE_CONFLICT'],
  ['shot description', f => { f.project.scenes[0].shots[0].description = 'Changed after queuing.'; }, 'DCC_BASIS_CONFLICT'],
  ['shot identity', f => { f.project.scenes[0].shots[0].id = 'replacement-shot'; }, 'DCC_BASIS_CONFLICT'],
]) test(`queued rehearsal rejects changed ${label} before launching Blender`, async t => {
  const f = fixture(t);
  let launched = 0;
  const service = createDccRehearsalService(f.store, { blenderPath: f.blenderPath, spawnImpl: () => { launched++; throw new Error('must not launch'); } });
  try {
    assert.equal(service.start(f.input).phase, 'QUEUED');
    edit(f); // Happens while the runtime is being hashed asynchronously.
    const job = await terminal(service);
    assert.equal(job.phase, 'FAILED');
    assert.equal(job.error, expectedError);
    assert.equal(job.executionVerified, false);
    assert.equal(launched, 0);
    assert.equal(fs.existsSync(path.join(f.directory, 'integrations/dcc-rehearsals', f.input.jobId, 'kit')), false);
  } finally { await service.close(); }
});

test('an unrelated record edit does not invalidate the queued shot basis', async t => {
  const f = fixture(t);
  let launched = 0;
  const service = createDccRehearsalService(f.store, { blenderPath: f.blenderPath, spawnImpl: () => {
    launched++;
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => true;
    queueMicrotask(() => child.emit('close', 1));
    return child;
  } });
  try {
    service.start(f.input);
    f.records.push({ id: 'unrelated-note', kind: 'lore-note', data: { description: 'An unrelated planning note.' } });
    const job = await terminal(service);
    assert.equal(launched, 1);
    assert.equal(job.error, 'DCC_REHEARSAL_PROCESS_FAILED');
  } finally { await service.close(); }
});

for (const stream of ['stdout', 'stderr']) test(`rehearsal ${stream} storage failure stops only its owned child and retains failure`, async t => {
  const f = fixture(t), signals = [];
  let child;
  const originalWrite = fs.writeSync;
  const logBytes = Buffer.from('SYNTHETIC_LOG_DISK_FULL');
  t.mock.method(fs, 'writeSync', function (fd, bytes, ...args) {
    if (Buffer.isBuffer(bytes) && bytes.equals(logBytes)) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return originalWrite.call(this, fd, bytes, ...args);
  });
  const service = createDccRehearsalService(f.store, { blenderPath: f.blenderPath, spawnImpl: () => {
    child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.kill = signal => { signals.push(signal); queueMicrotask(() => child.emit('close', 1)); return true; };
    queueMicrotask(() => child[stream].emit('data', logBytes));
    return child;
  } });
  try {
    service.start(f.input);
    const job = await terminal(service);
    assert.deepEqual(signals, ['SIGTERM']);
    assert.equal(job.phase, 'FAILED');
    assert.equal(job.error, 'DCC_REHEARSAL_LOG_UNAVAILABLE');
    assert.equal(job.processExited, true);
    assert.equal(job.executionVerified, false);
    assert.doesNotThrow(() => child[stream].emit('data', logBytes), 'late log data must not write to a closed descriptor');
    assert.equal(service.start(f.input).sha256, job.sha256, 'exact retry returns retained failure without another process');
    const saved = JSON.parse(fs.readFileSync(path.join(job.outputDirectory, `receipt-${String(job.version).padStart(6, '0')}.json`)));
    assert.equal(saved.error, job.error);
  } finally { await service.close(); }
});
