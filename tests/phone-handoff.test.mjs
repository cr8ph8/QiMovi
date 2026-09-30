import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { initialize, WorkspaceStore, canonical, sha256 } from '../local/server/storage.mjs';
import { validateRecord } from '../local/contracts/drifter.mjs';
import { blankShotDirection } from '../local/contracts/shot-direction.mjs';
import { createCreativeProject } from '../local/server/creative-project.mjs';
import { createWritingProductionService } from '../local/server/writing-production.mjs';
import { createProductionAttachmentService } from '../local/server/production-attachment.mjs';
import { createPhoneHandoffService, PHONE_HANDOFF_MAX_BYTES } from '../local/server/phone-handoff.mjs';

function setup(t, { creative = false, direction = true, shots = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qimovi-phone-test-')), directory = path.join(root, 'film');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  if (creative) createCreativeProject(directory, 'Synthetic Phone Film'); else initialize(directory);
  const store = new WorkspaceStore(directory, validateRecord); t.after(() => store.close());
  if (!creative) {
    const body = 'INT. SYNTHETIC ROOM - DAY\nA performer enters.\n', sourceHash = sha256(body);
    fs.writeFileSync(path.join(root, 'source.txt'), body);
    const project = { id: 'synthetic-phone-film', title: 'Synthetic Phone Film', sourceHash, profile: 'drifter-hybrid-film/v1', scenes: [{ id: 'scene-1', heading: 'INT. SYNTHETIC ROOM - DAY', shots: [1, 2].map(i => ({ id: `shot-${i}`, label: `1${i}`, description: `Synthetic shot ${i}`, plannedDurationMs: 5000, shotHash: sha256(`shot-${i}`) })) }], cells: [], characters: [], continuityQuestions: [] };
    const seed = { project, records: [], blobs: [{ path: 'source.txt', sha256: sourceHash, mimeType: 'text/plain' }] };
    fs.writeFileSync(path.join(root, 'seed.json'), JSON.stringify(seed)); store.importSeed(path.join(root, 'seed.json'));
  }
  const project = store.project();
  if (direction) store.save(`project-direction:${project.id}`, { kind: 'project-direction', requestId: crypto.randomUUID(), expectedVersion: null, data: {
    schemaVersion: 1, sourceHash: project.sourceHash, title: project.title, stage: 'DEVELOPMENT', planningNotes: 'Preserve these desktop notes.', businessObjectives: '', audienceHypotheses: '', canonQuestions: '', marketingPlan: '',
    nextActions: [{ id: 'task-1', title: 'Check coverage', stage: 'PREPRODUCTION', status: 'IN_PROGRESS' }, { id: 'task-2', title: 'Review edit', stage: 'FINISHING', status: 'TODO' }], slate: [], status: 'DRAFT', scope: 'OWNER_PLANNING_ONLY',
  } });
  if (!creative && shots) for (const shot of project.scenes[0].shots) store.save(`shot-direction:scene-1:${shot.id}`, { kind: 'shot-direction', requestId: crypto.randomUUID(), expectedVersion: null, data: { ...blankShotDirection(project, 'scene-1', shot.id), shotSize: 'Wide', movement: 'Still', purpose: 'Establish geography', composition: 'Preserve desktop composition' } });
  const service = createPhoneHandoffService(store);
  function review() {
    const snapshot = service.exportSnapshot();
    return structuredClone({ schemaVersion: 'qimovi-production-review/v1', exportedAt: '2026-09-29T12:00:00Z', origin: 'QiMovi iPhone Alpha', scope: 'PHONE_PLANNING_REVIEW_ONLY', desktopApplied: false, productionApproval: false, sourceSnapshotDate: snapshot.exportedAt, project: snapshot.projects[0] });
  }
  function apply(reviewPackage, changeId, requestId = crypto.randomUUID(), preview = service.preview(reviewPackage)) {
    const row = preview.changes.find(change => change.id === changeId);
    return service.apply({ reviewPackage, changeId, requestId, previewSha256: preview.previewSha256, expectedVersion: row.expectedVersion });
  }
  return { store, service, review, apply, project };
}
function edit(store, id, changes) {
  const current = store.rawList().find(row => row.id === id);
  return store.save(id, { kind: current.kind, requestId: crypto.randomUUID(), expectedVersion: current.version, data: { ...current.data, ...changes } });
}

test('snapshot exports current existing direction and normalized task baselines; preview is read-only', t => {
  const { store, service, review } = setup(t), input = review(), before = store.db.prepare('SELECT COUNT(*) AS n FROM records').get().n;
  assert.equal(input.project.shots[0].framing, 'Wide');
  assert.equal(input.project.desktopBaseline.shotDirections[0].ref.version, 1);
  assert.equal(input.project.tasks[0].status, 'todo');
  assert.equal(input.project.desktopBaseline.projectDirectionRef.version, 1);
  assert.equal(input.project.sourceRecordHash, sha256(canonical(store.project())));
  assert.notEqual(input.project.sourceRecordHash, sha256(canonical(store.resolvedProject())));
  const preview = service.preview(input);
  assert.ok(preview.changes.every(row => row.status === 'UNCHANGED'));
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM records').get().n, before);
});

test('review selectively applies one shot direction, preserving source, other fields and other records', t => {
  const { store, service, review, apply, project } = setup(t), input = review(), originalProject = canonical(store.project());
  input.project.shots[0].framing = 'Close-up'; input.project.shots[0].movement = 'Slow push'; input.project.shots[0].notes = 'Reveal uncertainty';
  input.project.shots[1].framing = 'Medium';
  const preview = service.preview(input);
  assert.equal(preview.changes.filter(row => row.status === 'READY').length, 2);
  const result = apply(input, 'shot-direction:scene-1:shot-1');
  assert.equal(result.record.data.shotSize, 'Close-up'); assert.equal(result.record.data.movement, 'Slow push'); assert.equal(result.record.data.purpose, 'Reveal uncertainty');
  assert.equal(result.record.data.composition, 'Preserve desktop composition'); assert.equal(result.record.data.status, 'DRAFT');
  assert.equal(store.rawList('shot-direction').find(row => row.id.endsWith('shot-2')).version, 1);
  assert.equal(canonical(store.project()), originalProject); assert.equal(store.project().sourceHash, project.sourceHash);
  assert.equal(service.preview(input).changes.find(row => row.id.endsWith('shot-1')).status, 'UNCHANGED');
  assert.equal(service.preview(input).changes.find(row => row.id.endsWith('shot-2')).status, 'READY');
});

test('phase and task mapping preserves omitted tasks and unchanged IN_PROGRESS states', t => {
  const { store, review, apply, project } = setup(t), input = review();
  input.project.phase = 'Production'; input.project.tasks[0].title = 'Check changed coverage'; input.project.tasks.splice(1, 1);
  input.project.tasks.push({ id: 'phone-task:new', title: 'Phone planning', phase: 'Post-production', status: 'done' });
  const result = apply(input, `project-direction:${project.id}`).record;
  assert.equal(result.data.stage, 'PRODUCTION'); assert.equal(result.data.nextActions[0].status, 'IN_PROGRESS');
  assert.equal(result.data.nextActions[0].title, 'Check changed coverage'); assert.equal(result.data.nextActions[1].id, 'task-2');
  assert.deepEqual(result.data.nextActions[2], { id: 'phone-task:new', title: 'Phone planning', stage: 'FINISHING', status: 'DONE' });
  assert.equal(result.data.planningNotes, 'Preserve these desktop notes.'); assert.equal(store.history(result.id).length, 2);
});

test('absent directions create the existing record kinds with null CAS versions', t => {
  const { service, review, apply, project } = setup(t, { direction: false, shots: false }), input = review();
  assert.equal(input.project.desktopBaseline.projectDirectionRef, null); assert.equal(input.project.desktopBaseline.shotDirections[0].ref, null);
  input.project.shots[0].framing = 'Wide'; input.project.phase = 'Pre-production';
  const preview = service.preview(input);
  assert.equal(preview.changes.find(row => row.id.endsWith('shot-1')).expectedVersion, null);
  assert.equal(apply(input, 'shot-direction:scene-1:shot-1').record.kind, 'shot-direction');
  assert.equal(apply(input, `project-direction:${project.id}`).record.version, 1);
});

test('source-free creative project can apply phase and tasks without acquiring production source', t => {
  const { store, review, apply, project } = setup(t, { creative: true, direction: false }), input = review();
  delete input.project.sourceHash; // Swift Codable omits nil optional properties.
  input.project.phase = 'Development'; input.project.tasks.push({ id: 'phone-task:draft', title: 'Write a draft', phase: 'Development', status: 'todo' });
  const result = apply(input, `project-direction:${project.id}`);
  assert.equal(result.record.data.sourceHash, null); assert.equal(store.project().sourceHash, null); assert.deepEqual(store.project().scenes, []);
});

test('desktop edits after export conflict, including changes outside the mapped phone fields', t => {
  const { store, service, review, apply } = setup(t), input = review(); input.project.shots[0].framing = 'Close-up';
  edit(store, 'shot-direction:scene-1:shot-1', { composition: 'New desktop composition' });
  assert.equal(service.preview(input).changes.find(row => row.id.endsWith('shot-1')).status, 'CONFLICT');
  assert.throws(() => apply(input, 'shot-direction:scene-1:shot-1'), /PHONE_CHANGE_NOT_APPLICABLE/);
  assert.equal(store.history('shot-direction:scene-1:shot-1').length, 2);
});

test('stale reviewed digest and changed package are rejected without saving', t => {
  const { store, service, review, apply } = setup(t), input = review(); input.project.shots[0].framing = 'Close-up';
  const preview = service.preview(input); input.project.shots[0].framing = 'Medium';
  assert.throws(() => apply(input, 'shot-direction:scene-1:shot-1', crypto.randomUUID(), preview), /PHONE_PREVIEW_STALE/);
  assert.equal(store.history('shot-direction:scene-1:shot-1').length, 1);
});

test('foreign projects, stale source and altered retained baseline are rejected', t => {
  const { service, review } = setup(t);
  let input = review(); input.project.id = 'foreign-film'; assert.throws(() => service.preview(input), /PHONE_PROJECT_MISMATCH/);
  input = review(); input.project.sourceHash = 'a'.repeat(64); assert.throws(() => service.preview(input), /PHONE_SOURCE_STALE/);
  input = review(); input.project.desktopBaseline.sourceRecordHash = 'b'.repeat(64); assert.throws(() => service.preview(input), /PHONE_SOURCE_STALE/);
  input = review(); input.project.desktopBaseline.shotDirections[0].framing = 'Forged baseline'; assert.throws(() => service.preview(input), /PHONE_BASELINE_CONTENT_MISMATCH/);
  input = review(); input.project.desktopBaseline.project.tasks[0].title = 'Forged task'; assert.throws(() => service.preview(input), /PHONE_BASELINE_CONTENT_MISMATCH/);
});

test('exact request retries are idempotent after subsequent desktop edits; changed request reuse fails', t => {
  const { store, service, review } = setup(t), reviewPackage = review(); reviewPackage.project.shots[0].framing = 'Close-up';
  const preview = service.preview(reviewPackage), request = { reviewPackage, changeId: 'shot-direction:scene-1:shot-1', previewSha256: preview.previewSha256, expectedVersion: 1, requestId: 'retry-example' };
  const first = service.apply(request); edit(store, request.changeId, { movement: 'Later desktop movement' });
  const again = service.apply(request); assert.equal(again.replayed, true); assert.equal(again.record.version, first.record.version); assert.equal(store.history(request.changeId).length, 3);
  assert.throws(() => service.apply({ ...request, expectedVersion: 2 }), /REQUEST_ID_CONFLICT/);
});

test('phone labels, duration, capture status, notes on tasks and new shots remain review-only', t => {
  const { store, service, review } = setup(t), input = review();
  input.project.shots[0].title = 'Phone name'; input.project.shots[0].durationSeconds = 7; input.project.shots[0].status = 'captured';
  input.project.tasks[0].notes = 'Phone task notes';
  input.project.shots.push({ id: 'phone-shot:new', sceneId: '', sceneHeading: 'Unassigned scene', title: 'New shot', order: 3, framing: '', movement: '', notes: '', status: 'captured' });
  const preview = service.preview(input), rows = preview.changes.filter(row => row.status === 'REVIEW_ONLY');
  assert.equal(rows.length, 3); assert.ok(preview.changes.every(row => row.status !== 'READY'));
  assert.equal(store.rawList('measured-media-take').length, 0); assert.equal(store.rawList('take-review').length, 0);
});

test('legacy packages without desktop baseline are readable but cannot be applied', t => {
  const { service, review } = setup(t), input = review(); delete input.project.desktopBaseline;
  input.project.shots[0].framing = 'Close-up'; const preview = service.preview(input);
  assert.equal(preview.changes.length, 1); assert.equal(preview.changes[0].status, 'REVIEW_ONLY');
});

test('shape, IDs, duplicate identities, authority assertions and oversized input are bounded', t => {
  const { service, review } = setup(t);
  let input = review(); input.productionApproval = true; assert.throws(() => service.preview(input), /PHONE_REVIEW_AUTHORITY_INVALID/);
  input = review(); input.project.credentials = {}; assert.throws(() => service.preview(input), /PHONE_FIELDS_INVALID/);
  input = review(); input.project.shots[0].id = '../outside'; assert.throws(() => service.preview(input), /PHONE_SHOT_INVALID/);
  input = review(); input.project.shots.push(structuredClone(input.project.shots[0])); assert.throws(() => service.preview(input), /PHONE_SHOT_INVALID/);
  input = review(); input.project.shots[0].notes = 'x'.repeat(PHONE_HANDOFF_MAX_BYTES); assert.throws(() => service.preview(input), /PHONE_PACKAGE_TOO_LARGE/);
  input = review(); input.project.shots[0].notes = 'x'.repeat(4001); assert.equal(service.preview(input).changes.find(row => row.id.endsWith('shot-1')).status, 'REVIEW_ONLY');
  input = review(); input.project.tasks[0].title = 'Invalid\nline'; assert.throws(() => service.preview(input), /PHONE_TEXT_INVALID/);
});

test('source guard is recomputed inside the storage transaction and a failed guard leaves no record', t => {
  const { store, service, review } = setup(t), reviewPackage = review(); reviewPackage.project.shots[0].framing = 'Close-up';
  const preview = service.preview(reviewPackage), original = store.savePhoneHandoff.bind(store); let observed = false;
  store.savePhoneHandoff = (id, input, fingerprint, verify) => original(id, input, fingerprint, () => {
    observed = store.db.isTransaction;
    const source = store.project(); source.title = 'Changed concurrently';
    store.db.prepare("UPDATE metadata SET value=? WHERE key='project'").run(canonical(source));
    verify();
  });
  assert.throws(() => service.apply({ reviewPackage, changeId: 'shot-direction:scene-1:shot-1', previewSha256: preview.previewSha256, expectedVersion: 1, requestId: 'guard-race' }), /PHONE_SOURCE_STALE/);
  assert.equal(observed, true); assert.equal(store.history('shot-direction:scene-1:shot-1').length, 1); assert.equal(store.project().title, 'Synthetic Phone Film');
});

test('generic saves cannot impersonate the phone request namespace', t => {
  const { store } = setup(t), current = store.rawList('shot-direction')[0];
  assert.throws(() => store.save(current.id, { kind: current.kind, data: current.data, requestId: 'phone-apply:forged', expectedVersion: 1 }), /PHONE_HANDOFF_TRUSTED_SAVE_REQUIRED/);
});


test('attached creative project retains its original source-free project direction when phone planning returns', t => {
  const { store, service, review, apply, project } = setup(t, { creative: true });
  const draft = store.save('screenplay-draft:phone-fixture', { kind: 'screenplay-draft', expectedVersion: null, requestId: crypto.randomUUID(), data: { schemaVersion: 2, projectId: project.id, sourceHash: null, title: project.title, format: 'FOUNTAIN', body: 'INT. SYNTHETIC ROOM - DAY\n\nA performer enters.\n', status: 'DRAFT' } });
  const draftRef = { id: draft.id, version: draft.version, sha256: draft.sha256 }, writing = createWritingProductionService(store);
  const basis = writing.preview({ projectId: project.id, draftRef });
  const handoff = writing.handoff({ projectId: project.id, draftRef, previewSha256: basis.previewSha256, requestId: crypto.randomUUID() });
  const initial = handoff.record ?? handoff;
  const saved = writing.save({ projectId: project.id, planId: initial.id, expectedVersion: initial.version, requestId: crypto.randomUUID(), scenes: initial.data.scenes.map(scene => ({ sceneId: scene.sceneId, notes: '', shots: [{ id: 'attached-shot', title: 'Establish room', description: '', shotType: '', cameraMovement: '', durationSeconds: 5 }] })) });
  const plan = saved.record ?? saved, planRef = { id: plan.id, version: plan.version, sha256: plan.sha256 }, attachment = createProductionAttachmentService(store);
  const prepared = attachment.prepare({ projectId: project.id, planRef });
  attachment.attach({ projectId: project.id, planRef, previewSha256: prepared.previewSha256, requestId: crypto.randomUUID() });
  assert.equal(store.project().creativeOrigin.id, project.id);
  const input = review(); assert.notEqual(input.project.sourceHash, null);
  input.project.phase = 'Production';
  const result = apply(input, `project-direction:${project.id}`);
  assert.equal(result.record.data.sourceHash, null); assert.equal(result.record.data.stage, 'PRODUCTION');
  assert.equal(store.project().sourceHash, prepared.sourceHash);
  assert.equal(service.preview(input).changes.find(row => row.kind === 'project-direction').status, 'UNCHANGED');
});
