import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { initialize, WorkspaceStore, canonical, sha256 } from '../local/server/storage.mjs';
import { validateRecord } from '../local/contracts/drifter.mjs';
import { createMovieSelectionService } from '../local/server/movie-selections.mjs';
import { createMediaIntake, reviewMediaTake } from '../local/server/media-takes.mjs';
import { openOwnerKernel } from '../local/server/kernel.mjs';
import { startServer } from '../local/server/http.mjs';

const reference = record => ({ id: record.id, sha256: record.sha256 });
const fullReference = record => ({ id: record.id, version: record.version, sha256: record.sha256 });
const copy = value => structuredClone(value);

async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qimovi-movie-selection-')), directory = path.join(root, 'film');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(directory);
  const store = new WorkspaceStore(directory, validateRecord); t.after(() => store.close());
  const source = 'INT. SYNTHETIC ROOM - DAY\nA performer enters.\nEXT. SYNTHETIC STREET - DAY\nA performer leaves.\n';
  const sourceHash = sha256(source);
  fs.writeFileSync(path.join(root, 'source.txt'), source);
  const project = { id: 'selection-test-film', title: 'Synthetic Selection Film', profile: 'drifter-hybrid-film/v1', sourceHash,
    scenes: [1, 2].map(number => ({ id: `scene-${number}`, heading: `SYNTHETIC SCENE ${number}`,
      paragraphs: [1, 2].map(i => ({ id: `paragraph-${number}-${i}`, text: `Synthetic paragraph ${i}` })),
      shots: [1, 2].map(i => ({ id: `shot-${number}-${i}`, label: `${number}${i}`, description: 'Synthetic shot', plannedDurationMs: 5000, shotHash: sha256(`shot-${number}-${i}`) })) })),
    cells: [], characters: [], continuityQuestions: [] };
  const seed = { project, records: [], blobs: [{ path: 'source.txt', sha256: sourceHash, mimeType: 'text/plain' }] };
  fs.writeFileSync(path.join(root, 'seed.json'), JSON.stringify(seed)); store.importSeed(path.join(root, 'seed.json'));
  const kernel = openOwnerKernel(directory, project, { allowCreate: true }); kernel.runtime.close();
  const measurement = { durationMs: 5000, videoFrameCount: 120, width: 640, height: 360, frameRate: '24/1', videoCodec: 'h264', audio: [] };
  const probeFile = path.join(root, 'probe.json');
  fs.writeFileSync(probeFile, canonical({ schema: 'caniscreenwrite-native-media-probe/v1', ...measurement }));
  const probe = store.putBlob(probeFile, 'application/json');
  const takes = [], reviews = [];
  for (const [index, [sceneId, shotId]] of [['scene-1', 'shot-1-1'], ['scene-1', 'shot-1-2'], ['scene-2', 'shot-2-1']].entries()) {
    // Synthetic bytes and probe output exercise relationship/storage checks;
    // this fixture does not claim that a native decoder measured real footage.
    const filename = path.join(root, `synthetic-${index}.mp4`);
    fs.writeFileSync(filename, `Synthetic fixture media ${index}, not playable footage.`);
    const blob = store.putBlob(filename, 'video/mp4');
    const data = { schemaVersion: 1, sourceHash, sceneId, shotId, briefRef: null, originalFilename: path.basename(filename),
      origin: 'IMPORTED_USER_MEDIA', providerProvenance: 'UNVERIFIED', blob: { sha256: blob.sha256, byteLength: blob.bytes, mimeType: blob.mimeType },
      measurement, measuredAt: '2026-11-16T00:00:00.000Z', probe: { toolIdentity: 'AVFOUNDATION', outputSha256: probe.sha256 } };
    const take = store.saveMediaRecord(`measured-media-take:${sha256(canonical(data))}`, { kind: 'measured-media-take', data, expectedVersion: null, requestId: `fixture-take-${index}` }, sha256(canonical({ fixture: 'movie-selection', data })));
    takes.push(take);
    reviews.push(await reviewMediaTake(store, take.id, { decision: 'KEEP_CANDIDATE', expectedVersion: null, note: 'Fixture candidate preference only', requestId: `fixture-review-${index}`, takeSha256: take.sha256 }));
  }
  const service = createMovieSelectionService(store);
  function candidate() {
    return { sourceHash, title: 'Candidate cut', status: 'DRAFT', clips: [0, 1].map(index => ({ id: `clip-${index + 1}`, sceneId: 'scene-1', shotId: takes[index].data.shotId,
      plannedDurationMs: 3000, sourceRefs: ['paragraph-1-1'], note: 'Fixture clip',
      editSelection: { takeRef: reference(takes[index]), reviewRef: reference(reviews[index]), assetHash: takes[index].data.blob.sha256, inMs: 1000, outMs: 4000 } })) };
  }
  const input = (data = candidate(), expectedVersion = null, requestId = crypto.randomUUID(), recordId = 'movie-sequence:test-cut') => ({ recordId, expectedVersion, data, requestId });
  const commit = request => service.commit({ ...request, previewSha256: service.prepare(request).previewSha256 });
  async function review(index, decision = 'REJECT') {
    const take = takes[index], current = store.history(reviews[index].id).at(-1);
    return reviewMediaTake(store, take.id, { decision, expectedVersion: current.version, note: `Changed review ${current.version + 1}`, requestId: crypto.randomUUID(), takeSha256: take.sha256 });
  }
  return { root, directory, store, project, service, takes, reviews, candidate, input, commit, review };
}

function state(store) {
  return JSON.stringify({
    records: store.db.prepare('SELECT * FROM records ORDER BY id,version').all(),
    requests: store.db.prepare('SELECT * FROM requests ORDER BY id').all(),
    metadata: store.db.prepare('SELECT * FROM metadata ORDER BY key').all(),
    blobs: store.db.prepare('SELECT * FROM blobs ORDER BY sha256').all(),
  });
}
function refused(store, action, pattern) {
  const before = state(store);
  assert.throws(action, pattern);
  assert.equal(state(store), before, 'refusal must leave records, requests, metadata and blob registrations unchanged');
  assert.equal(store.db.isTransaction, false);
}
function genericSave(store, input) {
  return store.save(input.recordId, { kind: 'movie-sequence', data: input.data, expectedVersion: input.expectedVersion, requestId: input.requestId });
}
function unselected(data) {
  const result = copy(data); for (const clip of result.clips) delete clip.editSelection; return result;
}
function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]));
}

test('prepare derives exact candidate, prestate and current take/review bindings without writing', async t => {
  const { store, service, input, takes, reviews } = await setup(t), request = input(), before = state(store);
  const preview = service.prepare(request), { previewSha256, ...descriptor } = preview;
  assert.equal(state(store), before);
  assert.equal(preview.schemaVersion, 'qimovi-movie-selection-preview/v1');
  assert.equal(preview.requestId, request.requestId); assert.equal(preview.recordId, request.recordId);
  assert.equal(preview.expectedVersion, null); assert.equal(preview.baseRef, null);
  assert.equal(preview.candidateSha256, sha256(canonical(request.data)));
  assert.match(preview.projectSha256, /^[a-f0-9]{64}$/);
  assert.equal(preview.actorId, 'local-owner'); assert.equal(preview.scope, 'CANDIDATE_PREFERENCE_ONLY');
  assert.equal(previewSha256, sha256(canonical(descriptor)));
  assert.deepEqual(preview.bindings[0], { clipId: 'clip-1', sceneId: 'scene-1', shotId: 'shot-1-1', takeRef: fullReference(takes[0]), reviewRef: fullReference(reviews[0]),
    assetHash: takes[0].data.blob.sha256, inMs: 1000, outMs: 4000, reviewActor: 'local-owner', reviewScope: 'CANDIDATE_PREFERENCE_ONLY' });
  assert.deepEqual(service.prepare(reverseKeys(request)), preview, 'JSON member order has no authority');
});

test('valid commits preserve exact relations, bind the previous sequence revision and accept fresh renamed labels', async t => {
  const { store, service, input, commit, project } = await setup(t), request = input();
  request.data.title = 'Owner chosen label'; request.data.clips[0].id = 'arbitrary-instance-name'; request.data.clips[0].note = 'PASS is just prose here';
  const saved = commit(reverseKeys(request));
  assert.equal(saved.version, 1); assert.equal(saved.replayed, false); assert.deepEqual(saved.data, request.data);
  const next = input({ ...saved.data, title: 'New label with a fresh preview' }, 1);
  const preview = service.prepare(next); assert.deepEqual(preview.baseRef, fullReference(saved));
  const changed = service.commit({ ...next, previewSha256: preview.previewSha256 });
  assert.equal(changed.version, 2); assert.equal(changed.sha256, sha256(canonical(next.data)));
  assert.equal(store.project().sourceHash, project.sourceHash);
  assert.deepEqual(store.history(request.recordId).map(record => record.version), [1, 2]);
});

test('generic saves cannot add, edit, reorder or remove selected media; unselected drafts remain compatible', async t => {
  const { store, input, commit, candidate } = await setup(t);
  refused(store, () => genericSave(store, input()), /MOVIE_SELECTION_TRUSTED_SAVE_REQUIRED/);
  const saved = commit(input());
  for (const data of [unselected(saved.data), { ...saved.data, clips: [...saved.data.clips].reverse() }, { ...saved.data, title: 'Bypass title change' }, { ...saved.data, clips: [] }]) {
    refused(store, () => genericSave(store, input(data, saved.version)), /MOVIE_SELECTION_TRUSTED_SAVE_REQUIRED/);
  }
  const cleared = commit(input(unselected(saved.data), saved.version)); assert.equal(cleared.version, 2);
  const ordinary = genericSave(store, input({ ...cleared.data, title: 'Ordinary unselected save' }, 2)); assert.equal(ordinary.version, 3);
  assert.equal(genericSave(store, input(unselected(candidate()), null, 'plain-new', 'movie-sequence:plain')).version, 1);
});

test('a newer review revision invalidates prepare and commit while historical sequence reads remain valid', async t => {
  const { store, service, input, commit, review } = await setup(t);
  const first = commit(input()), request = input(first.data, 1), preview = service.prepare(request);
  await review(0, 'KEEP_CANDIDATE');
  refused(store, () => service.commit({ ...request, previewSha256: preview.previewSha256 }), /MOVIE_SEQUENCE_EDIT_REVIEW_STALE/);
  refused(store, () => service.prepare(request), /MOVIE_SEQUENCE_EDIT_REVIEW_STALE/);
  assert.equal(store.history(first.id)[0].sha256, first.sha256, 'historical review references remain readable');
  const clearing = input(unselected(first.data), 1); assert.equal(commit(clearing).version, 2);
});

test('a rejected review invalidates its old preview without appending any sequence or request', async t => {
  const { store, service, input, review } = await setup(t), request = input(), preview = service.prepare(request);
  await review(0);
  refused(store, () => service.commit({ ...request, previewSha256: preview.previewSha256 }), /MOVIE_SEQUENCE_EDIT_REVIEW_STALE/);
});

test('concurrent sequence changes and changed project basis cannot use an older preview', async t => {
  const { store, service, input, commit, candidate } = await setup(t);
  const first = commit(input()), request = input({ ...first.data, title: 'Prepared second revision' }, 1), preview = service.prepare(request);
  commit(input({ ...first.data, title: 'Concurrent second revision' }, 1));
  refused(store, () => service.commit({ ...request, previewSha256: preview.previewSha256 }), /VERSION_CONFLICT/);
  refused(store, () => service.commit({ ...request, expectedVersion: 2, previewSha256: preview.previewSha256 }), /MOVIE_SELECTION_PREVIEW_STALE/);
  const newRequest = input(candidate(), null, 'project-basis', 'movie-sequence:another'), newPreview = service.prepare(newRequest);
  const project = store.project(); project.title = 'Changed project basis';
  store.db.prepare("UPDATE metadata SET value=? WHERE key='project'").run(canonical(project));
  refused(store, () => service.commit({ ...newRequest, previewSha256: newPreview.previewSha256 }), /MOVIE_SELECTION_PREVIEW_STALE/);
});

test('valid aggregated projects beyond one-record limits can prepare; later cell changes still invalidate their proof', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qimovi-large-selection-')), directory = path.join(root, 'film');
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); initialize(directory);
  const store = new WorkspaceStore(directory, validateRecord); t.after(() => store.close());
  const body = 'Synthetic source\n', sourceHash = sha256(body), sourceFile = path.join(root, 'source.txt'); fs.writeFileSync(sourceFile, body);
  const project = { id: 'large-selection-film', title: 'Synthetic valid project', profile: 'drifter-hybrid-film/v1', sourceHash,
    scenes: [{ id: 'scene-1', heading: 'SYNTHETIC ROOM', paragraphs: Array.from({ length: 3000 }, (_, i) => ({ id: `p-${i}`, text: 'Synthetic paragraph' })),
      shots: [{ id: 'shot-1', label: 'One', description: 'Synthetic', plannedDurationMs: 5000, shotHash: sha256('shot-1') }] }], cells: [], characters: [], continuityQuestions: [] };
  const seedFile = path.join(root, 'seed.json');
  fs.writeFileSync(seedFile, JSON.stringify({ project, records: [], blobs: [{ path: 'source.txt', sha256: sourceHash, mimeType: 'text/plain' }] })); store.importSeed(seedFile);
  for (let i = 0; i < 70; i++) store.save(`storyboard-cell:cell-${i}`, { kind: 'storyboard-cell', expectedVersion: null, requestId: `cell-request-${i}`,
    data: { sourceHash, cellId: `cell-${i}`, sceneId: 'scene-1', shotId: 'shot-1', role: 'MOMENT', imageHash: null, crop: null, description: 'Synthetic cell', actionRefs: [], plannedTimestampMs: null, review: 'PENDING' } });
  assert.doesNotThrow(() => canonical(store.project()));
  assert.throws(() => canonical(store.resolvedProject()), error => error.code === 'JSON_TOO_LARGE', 'a valid projection exceeds the single-record serializer bound');
  const data = { sourceHash, title: 'Minimal cut', status: 'DRAFT', clips: [] }, recordId = 'movie-sequence:large-cut';
  const legacy = genericSave(store, { recordId, data, expectedVersion: null, requestId: 'legacy-large-cut' });
  const service = createMovieSelectionService(store), request = { recordId, data, expectedVersion: legacy.version, requestId: 'prepared-large-cut' };
  const before = state(store), preview = service.prepare(request); assert.equal(state(store), before);
  assert.equal(service.commit({ ...request, previewSha256: preview.previewSha256 }).version, 2);
  const next = { ...request, expectedVersion: 2, requestId: 'large-cell-change' }, prepared = service.prepare(next);
  const cell = store.history('storyboard-cell:cell-0').at(-1);
  store.save(cell.id, { kind: cell.kind, expectedVersion: cell.version, requestId: 'changed-aggregate-cell', data: { ...cell.data, description: 'Changed aggregate cell' } });
  refused(store, () => service.commit({ ...next, previewSha256: prepared.previewSha256 }), /MOVIE_SELECTION_PREVIEW_STALE/);
  const fresh = service.prepare(next); assert.notEqual(fresh.projectSha256, prepared.projectSha256);
  assert.equal(service.commit({ ...next, previewSha256: fresh.previewSha256 }).version, 3);
});

test('shot, scene, take, review, asset and range substitutions fail before a write', async t => {
  const { store, service, input, takes, reviews } = await setup(t), request = input(), preview = service.prepare(request);
  const changes = [
    data => { data.clips[0].shotId = 'shot-1-2'; },
    data => { data.clips[0].sceneId = 'scene-2'; data.clips[0].shotId = 'shot-2-1'; data.clips[0].sourceRefs = ['paragraph-2-1']; },
    data => { data.clips[0].editSelection.takeRef = reference(takes[1]); },
    data => { data.clips[0].editSelection.reviewRef = reference(reviews[1]); },
    data => { data.clips[0].editSelection.assetHash = takes[1].data.blob.sha256; },
    data => { data.clips[0].editSelection.inMs = -1; },
    data => { data.clips[0].editSelection.outMs = 6000; },
    data => { data.clips[0].editSelection.reviewRef.sha256 = '0'.repeat(64); },
    data => { data.clips[0].editSelection.takeRef.sha256 = '0'.repeat(64); },
    data => { data.sourceHash = '0'.repeat(64); },
  ];
  for (const change of changes) {
    const data = copy(request.data); change(data);
    refused(store, () => service.commit({ ...request, data, previewSha256: preview.previewSha256 }), /MOVIE_SEQUENCE/);
  }
});

test('otherwise valid candidate, clip order, request and target edits require a fresh full-candidate preview', async t => {
  const { store, service, input, takes, reviews } = await setup(t), request = input(), preview = service.prepare(request);
  const changes = [
    value => { value.data.title = 'Changed title'; },
    value => { value.data.clips.reverse(); },
    value => { value.data.clips[0].id = 'new-instance-name'; },
    value => { value.data.clips[0].note = 'Changed note'; },
    value => { value.data.clips[0].sourceRefs = ['paragraph-1-2']; },
    value => { value.data.clips[0].plannedDurationMs = 3500; },
    value => { value.data.clips[0].editSelection.inMs = 500; },
    value => { value.data.clips[0].editSelection.outMs = 4500; },
    value => { value.data = unselected(value.data); },
    value => { value.requestId = 'substituted-attempt'; },
    value => { value.recordId = 'movie-sequence:substituted-target'; },
    value => { value.data.clips[0].shotId = takes[1].data.shotId; value.data.clips[0].editSelection = { takeRef: reference(takes[1]), reviewRef: reference(reviews[1]), assetHash: takes[1].data.blob.sha256, inMs: 1000, outMs: 4000 }; },
  ];
  for (const change of changes) {
    const modified = copy(request); change(modified);
    refused(store, () => service.commit({ ...modified, previewSha256: preview.previewSha256 }), /MOVIE_SELECTION_PREVIEW_STALE/);
  }
});

test('proof tampering, missing proofs and client PASS or authority assertions are rejected', async t => {
  const { store, service, input } = await setup(t), request = input(), preview = service.prepare(request);
  refused(store, () => service.commit(request), /MOVIE_SELECTION_FIELDS_INVALID/);
  refused(store, () => service.commit({ ...request, previewSha256: 'PASS' }), /MOVIE_SELECTION_PREVIEW_INVALID/);
  refused(store, () => service.commit({ ...request, previewSha256: '0'.repeat(64) }), /MOVIE_SELECTION_PREVIEW_STALE/);
  for (const assertion of [{ status: 'PASS' }, { actorId: 'local-owner' }, { approval: true }, { scope: 'FINAL_APPROVAL' }, { bindings: preview.bindings }]) {
    refused(store, () => service.commit({ ...request, previewSha256: preview.previewSha256, ...assertion }), /MOVIE_SELECTION_FIELDS_INVALID/);
    refused(store, () => service.prepare({ ...request, ...assertion }), /MOVIE_SELECTION_FIELDS_INVALID/);
  }
});

test('exact replay survives lost replies, changed reviews, later sequence revisions and a fresh service', async t => {
  const { store, service, input, commit, review } = await setup(t), request = input(), preview = service.prepare(request);
  const committedInput = { ...request, previewSha256: preview.previewSha256 }, saved = service.commit(committedInput);
  await review(0); commit(input(unselected(saved.data), 1));
  const before = state(store), reopened = createMovieSelectionService(store);
  const replay = reopened.prepare(reverseKeys(request));
  assert.deepEqual(replay, { schemaVersion: 'qimovi-movie-selection-replay/v1', recordId: request.recordId, requestId: request.requestId, record: { ...saved, replayed: true } });
  assert.deepEqual(reopened.commit(committedInput), { ...saved, replayed: true });
  assert.equal(state(store), before);
  refused(store, () => reopened.prepare({ ...request, data: { ...request.data, title: 'Changed retry' } }), /REQUEST_ID_CONFLICT/);
  refused(store, () => reopened.prepare({ ...request, expectedVersion: 2 }), /REQUEST_ID_CONFLICT/);
  refused(store, () => reopened.prepare({ ...request, recordId: 'movie-sequence:other' }), /REQUEST_ID_CONFLICT/);
  refused(store, () => reopened.commit({ ...committedInput, previewSha256: '0'.repeat(64) }), /REQUEST_ID_CONFLICT/);
});

test('both internal receipt namespaces reject generic preclaiming and other trusted service writes', async t => {
  const { store, input, candidate, reviews } = await setup(t);
  for (const requestId of ['movie-selection:preclaim', 'movie-selection-replay:preclaim']) {
    refused(store, () => genericSave(store, input(unselected(candidate()), null, requestId)), /MOVIE_SELECTION_TRUSTED_SAVE_REQUIRED/);
    refused(store, () => store.saveMediaRecord(reviews[0].id, { kind: 'take-review', data: reviews[0].data, expectedVersion: 1, requestId }, sha256(requestId)), /MOVIE_SELECTION_TRUSTED_SAVE_REQUIRED/);
  }
});

test('retained-media existing-association retries cannot preclaim either selection receipt namespace', async t => {
  const { root, store, takes, project, input, commit } = await setup(t);
  const filename = path.join(root, 'retained-synthetic.mp4');
  fs.writeFileSync(filename, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisomSynthetic fixture container header only.')]));
  const blob = store.putBlob(filename, 'video/mp4'), asset = { sha256: blob.sha256, byteLength: blob.bytes, mimeType: blob.mimeType };
  const assetData = { schemaVersion: 1, sourceHash: project.sourceHash, title: 'Retained synthetic asset', originalFilename: 'retained-synthetic.mp4', asset,
    family: 'VIDEO', category: 'Fixture', collection: 'Synthetic', sourcePaths: [filename], collectionPath: 'Synthetic/retained-synthetic.mp4', scope: 'PROJECT_REFERENCE', review: 'PENDING' };
  const assetRecord = store.saveProjectAssetRecord(`project-asset:${blob.sha256}`, { kind: 'project-asset', data: assetData, expectedVersion: null, requestId: 'fixture-retained-asset' });
  const takeData = { ...takes[0].data, originalFilename: assetData.originalFilename, blob: asset, origin: 'RETAINED_PROJECT_ASSET', retainedSource: reference(assetRecord) };
  const take = store.saveMediaRecord(`measured-media-take:${sha256(canonical(takeData))}`, { kind: 'measured-media-take', data: takeData, expectedVersion: null, requestId: 'fixture-retained-take' }, sha256(canonical(takeData)));
  const media = createMediaIntake(store); t.after(() => media.close());
  const association = { requestId: 'ordinary-retained-association', sourceHash: project.sourceHash, sceneId: takeData.sceneId, shotId: takeData.shotId,
    briefRef: null, retainedSource: reference(assetRecord), assetHash: blob.sha256 };
  const existing = await media.measureRetained(association);
  assert.equal(existing.record.id, take.id); assert.equal(existing.replayed, true);
  assert.ok(store.db.prepare('SELECT * FROM requests WHERE id=?').get(association.requestId), 'exercise the direct existing-association receipt writer');
  const request = input(), before = state(store);
  for (const prefix of ['movie-selection:', 'movie-selection-replay:']) {
    await assert.rejects(() => media.measureRetained({ ...association, requestId: `${prefix}${sha256(request.requestId)}` }), /MOVIE_SELECTION_TRUSTED_SAVE_REQUIRED/);
    assert.equal(state(store), before);
  }
  assert.equal(commit(request).version, 1, 'refused preclaiming leaves the real selection request usable');
});

test('verification runs inside BEGIN IMMEDIATE and a changed basis rolls the entire transaction back', async t => {
  const { store, service, input } = await setup(t), request = input(), preview = service.prepare(request);
  const original = store.commitMovieSelection.bind(store); let observed = false;
  store.commitMovieSelection = (value, verify) => original(value, () => {
    observed = store.db.isTransaction;
    const project = store.project(); project.title = 'Changed under lock';
    store.db.prepare("UPDATE metadata SET value=? WHERE key='project'").run(canonical(project));
    verify();
  });
  refused(store, () => service.commit({ ...request, previewSha256: preview.previewSha256 }), /MOVIE_SELECTION_PREVIEW_STALE/);
  assert.equal(observed, true);
});

test('media bytes are checked again at commit rather than trusting an earlier preview', async t => {
  const { store, service, directory, input, takes } = await setup(t), request = input(), preview = service.prepare(request);
  const filename = path.join(directory, 'blobs', takes[0].data.blob.sha256), bytes = fs.readFileSync(filename);
  fs.writeFileSync(filename, Buffer.alloc(bytes.length, 0));
  refused(store, () => service.commit({ ...request, previewSha256: preview.previewSha256 }), /BLOB_CORRUPT/);
  fs.writeFileSync(filename, bytes);
});

test('HTTP routes require an owner session and exact Origin; the scoped bridge cannot prepare or commit', async t => {
  const { directory, store, input } = await setup(t), server = await startServer({ directory, port: 0, validateRecord });
  t.after(() => server.close());
  const request = input(), before = state(store);
  const token = JSON.parse(fs.readFileSync(path.join(directory, 'config.json'), 'utf8')).ownerToken;
  const login = async route => {
    const response = await fetch(`${server.origin}${route}`, { method: 'POST', headers: { origin: server.origin, 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    assert.equal(response.status, 200); return response.headers.get('set-cookie').split(';')[0];
  };
  const bridge = await login('/api/caniscreenwrite/session'), cookie = await login('/api/session');
  for (const route of ['prepare', 'commit']) {
    const url = `${server.origin}/api/movie-selections/${route}`, body = JSON.stringify(request);
    let response = await fetch(url, { method: 'POST', headers: { origin: server.origin, 'content-type': 'application/json' }, body });
    assert.equal(response.status, 401); assert.equal((await response.json()).error, 'OWNER_SESSION_REQUIRED');
    response = await fetch(url, { method: 'POST', headers: { cookie: bridge, origin: server.origin, 'content-type': 'application/json' }, body });
    assert.equal(response.status, 403); assert.equal((await response.json()).error, 'CANISCREENWRITE_SCOPE_REJECTED');
    response = await fetch(url, { method: 'POST', headers: { cookie, origin: 'http://untrusted.invalid', 'content-type': 'application/json' }, body });
    assert.equal(response.status, 403); assert.equal((await response.json()).error, 'ORIGIN_REJECTED');
    response = await fetch(url, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body });
    assert.equal(response.status, 403); assert.equal((await response.json()).error, 'EXACT_ORIGIN_REQUIRED');
  }
  const query = await fetch(`${server.origin}/api/movie-selections/prepare?actor=local-owner`, { method: 'POST', headers: { cookie, origin: server.origin, 'content-type': 'application/json' }, body: JSON.stringify(request) });
  assert.equal(query.status, 422); assert.equal((await query.json()).error, 'MOVIE_SELECTION_QUERY_REJECTED');
  assert.equal(state(store), before);
});

test('authenticated HTTP preparation, commit and replay work while generic PUT cannot bypass selection proof', async t => {
  const { directory, store, input, candidate } = await setup(t), server = await startServer({ directory, port: 0, validateRecord });
  t.after(() => server.close());
  const token = JSON.parse(fs.readFileSync(path.join(directory, 'config.json'), 'utf8')).ownerToken;
  const login = await fetch(`${server.origin}/api/session`, { method: 'POST', headers: { origin: server.origin, 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  assert.equal(login.status, 200);
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0], origin: server.origin, 'content-type': 'application/json' };
  const send = async (route, value, method = 'POST') => { const response = await fetch(`${server.origin}${route}`, { method, headers, body: JSON.stringify(value) }); return { status: response.status, data: await response.json() }; };
  const request = input(), before = state(store);
  const bypass = await send(`/api/records/${request.recordId}`, { kind: 'movie-sequence', data: request.data, expectedVersion: null, requestId: 'http-bypass' }, 'PUT');
  assert.equal(bypass.status, 409); assert.equal(bypass.data.error, 'MOVIE_SELECTION_TRUSTED_SAVE_REQUIRED'); assert.equal(state(store), before);
  const prepared = await send('/api/movie-selections/prepare', request); assert.equal(prepared.status, 200); assert.equal(state(store), before);
  const saved = await send('/api/movie-selections/commit', { ...request, previewSha256: prepared.data.previewSha256 });
  assert.equal(saved.status, 200); assert.equal(saved.data.version, 1); assert.deepEqual(saved.data.data, request.data);
  const after = state(store), replay = await send('/api/movie-selections/prepare', request);
  assert.equal(replay.status, 200); assert.equal(replay.data.schemaVersion, 'qimovi-movie-selection-replay/v1'); assert.equal(replay.data.record.replayed, true); assert.equal(state(store), after);
  const remove = await send(`/api/records/${request.recordId}`, { kind: 'movie-sequence', data: unselected(request.data), expectedVersion: 1, requestId: 'http-remove-bypass' }, 'PUT');
  assert.equal(remove.status, 409); assert.equal(remove.data.error, 'MOVIE_SELECTION_TRUSTED_SAVE_REQUIRED'); assert.equal(state(store), after);
  const plain = await send('/api/records/movie-sequence:unselected', { kind: 'movie-sequence', data: unselected(candidate()), expectedVersion: null, requestId: 'http-plain' }, 'PUT'); assert.equal(plain.status, 200);
});
