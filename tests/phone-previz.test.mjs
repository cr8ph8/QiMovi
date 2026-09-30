import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createPhonePrevizService } from '../local/server/phone-previz.mjs';
import { validatePhonePrevizArtifact, PHONE_ROTATION_MAX_SAMPLES } from '../local/contracts/phone-previz.mjs';
const source = 'a'.repeat(64), shotHash = 'b'.repeat(64), uuid = 'c8d5de3c-1e63-4c13-8476-a621677eb6a8';
function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qimovi-phone-previz-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const project = { id: 'film-1', sourceHash: source, scenes: [{ id: 'scene-1', shots: [{ id: 'shot-1', shotHash }, { id: 'shot-2', shotHash: 'd'.repeat(64) }] }] };
  const service = createPhonePrevizService({ directory, resolvedProject: () => project });
  const scope = { sceneId: 'scene-1', shotId: 'shot-1' };
  const preview = artifact => service.preview({ ...scope, artifact });
  const retain = (artifact, previewSha256 = preview(artifact).previewSha256) => service.retain({ ...scope, artifact, previewSha256 });
  return { directory, project, service, scope, preview, retain };
}
function rotation() {
  return { schemaVersion: 'qimovi-phone-rotation/v1', id: uuid, projectId: 'film-1', sourceHash: source, sceneId: 'scene-1', shotId: 'shot-1', shotSourceHash: shotHash,
    recordedAt: '2026-09-29T12:00:00Z', durationSeconds: 0.033, requestedSampleRateHz: 30, measurement: 'DEVICE_ORIENTATION_ONLY', referenceFrame: 'CORE_MOTION_X_ARBITRARY_Z_VERTICAL', deviceAxes: 'RIGHT_HANDED_X_RIGHT_Y_TOP_Z_OUT_OF_DISPLAY_PORTRAIT', relativeAttitudeMethod: 'CMAttitude.multiply(byInverseOf: startAttitude)', quaternionOrder: 'XYZW', screenOrientationAtStart: 'PORTRAIT', referenceQuaternionXYZW: [0, 0, 0, 1], stopReason: 'USER_STOPPED', classification: 'ROTATION_REHEARSAL_PENDING_REVIEW', desktopPlaybackReady: false,
    samples: [{ timeSeconds: 0, quaternionXYZW: [0, 0, 0, 1] }, { timeSeconds: 0.033, quaternionXYZW: [0, 0.6, 0, 0.8] }] };
}
function clapper() {
  return { schemaVersion: 'qimovi-clapper/v1', id: uuid, projectId: 'film-1', projectTitle: 'Synthetic film', sourceHash: source, sceneId: 'scene-1', shotId: 'shot-1', shotTitle: 'Synthetic shot', shotSourceHash: shotHash, takeNumber: 3, roll: 'A001', camera: 'A', frameRate: { numerator: 24000, denominator: 1001 }, soundMode: 'MOS', slatePosition: 'TAIL', purpose: 'PREVIZ', markedAt: '2026-09-29T12:00:01Z', clock: 'DEVICE_WALL_CLOCK_NOT_TIMECODE', cue: 'VISUAL', notes: 'Synthetic rehearsal', classification: 'SLATE_MARK_ONLY' };
}

test('preview and list are read-only; exact retention is immutable and survives service restart', t => {
  const { directory, service, scope, preview, retain, project } = setup(t), file = rotation();
  const before = JSON.stringify(project);
  assert.equal(preview(file).status, 'READY'); assert.equal(service.list(scope).receipts.length, 0);
  assert.deepEqual(fs.readdirSync(directory), []);
  const first = retain(file), again = retain(file);
  assert.equal(first.replayed, false); assert.equal(again.replayed, true); assert.deepEqual(first.receipt, again.receipt);
  assert.equal(first.receipt.approvalGranted, false); assert.equal(first.receipt.desktopPlaybackReady, false); assert.equal(first.receipt.finalMedia, false);
  assert.equal(JSON.stringify(project), before);
  const reopened = createPhonePrevizService({ directory, resolvedProject: () => project });
  assert.deepEqual(reopened.list(scope).receipts, [first.receipt]);
  assert.equal(reopened.list({ sceneId: 'scene-1', shotId: 'shot-2' }).receipts.length, 0);
});
test('wrong project, source, scene, shot or shot revision is visible as mismatch and never retained', t => {
  const { directory, preview, retain } = setup(t);
  for (const patch of [{ projectId: 'other-film' }, { sourceHash: 'e'.repeat(64) }, { sceneId: 'other-scene' }, { shotId: 'shot-2' }, { shotSourceHash: 'f'.repeat(64) }, { sourceHash: null }]) {
    const file = { ...rotation(), ...patch }; assert.equal(preview(file).status, 'MISMATCH'); assert.throws(() => retain(file), /PHONE_PREVIZ_BINDING_MISMATCH/);
  }
  assert.deepEqual(fs.readdirSync(directory), []);
});
test('a changed shot cannot use an old preview, and old retained files are not shown as the new revision', t => {
  const { project, service, scope, preview, retain } = setup(t), file = rotation(); delete file.shotSourceHash;
  const view = preview(file); assert.match(view.warnings.join(' '), /no shot revision hash/); retain(file);
  project.scenes[0].shots[0].shotHash = 'e'.repeat(64);
  assert.throws(() => retain(file, view.previewSha256), /PHONE_PREVIZ_PREVIEW_STALE/);
  assert.equal(service.list(scope).receipts.length, 0);
});
test('finite normalized quaternions, increasing sample times, duration bounds and sample limits are enforced', () => {
  for (const mutate of [
    value => value.samples[1].quaternionXYZW = [0, 0, 0, 0],
    value => value.samples[1].quaternionXYZW = [NaN, 0, 0, 1],
    value => value.samples[1].quaternionXYZW = [0, 0, 0, 0.5],
    value => value.samples[1].timeSeconds = 0,
    value => value.samples[1].timeSeconds = Infinity,
    value => value.durationSeconds = 181,
    value => value.durationSeconds = 0.03,
    value => value.samples = Array.from({ length: PHONE_ROTATION_MAX_SAMPLES + 1 }, () => value.samples[0]),
    value => value.desktopPlaybackReady = true,
  ]) {
    const file = rotation(); mutate(file); assert.throws(() => validatePhonePrevizArtifact(file), /PHONE_PREVIZ_/);
  }
});
test('clapper references preserve frame rate and take identity without claiming footage or synchronized timecode', t => {
  const { retain } = setup(t), file = clapper(), result = retain(file);
  assert.equal(result.receipt.summary.takeNumber, 3); assert.deepEqual(result.receipt.summary.frameRate, { numerator: 24000, denominator: 1001 });
  assert.equal(result.receipt.finalMedia, false);
  file.recordingId = uuid; assert.throws(() => validatePhonePrevizArtifact(file), /RECORDING_PAIR/);
  file.recordingTimeSeconds = 0.033; assert.equal(validatePhonePrevizArtifact(file), file);
  file.frameRate.denominator = 0; assert.throws(() => validatePhonePrevizArtifact(file), /FRAME_RATE/);
});
test('rotation slate marks are bounded by their actual recording and cannot be duplicated', () => {
  const file = rotation(); file.clapperMarks = [{ clapperId: uuid, timeSeconds: 0.01, takeNumber: 1 }];
  validatePhonePrevizArtifact(file);
  file.clapperMarks.push({ ...file.clapperMarks[0] }); assert.throws(() => validatePhonePrevizArtifact(file), /CLAPPER_MARK/);
  file.clapperMarks = [{ clapperId: uuid, timeSeconds: 2, takeNumber: 1 }]; assert.throws(() => validatePhonePrevizArtifact(file), /CLAPPER_MARK/);
});
test('modified or symlinked retained files are rejected on every list and retry', t => {
  const { directory, service, scope, retain } = setup(t), file = rotation(), result = retain(file), target = path.join(directory, 'integrations', 'phone-previz', result.receipt.id, 'artifact.json');
  const original = fs.readFileSync(target); fs.writeFileSync(target, JSON.stringify({ ...file, stopReason: 'TAMPERED' }));
  assert.throws(() => service.list(scope), /PHONE_PREVIZ_ARTIFACT_CHANGED/); assert.throws(() => retain(file), /PHONE_PREVIZ_ARTIFACT_CHANGED/);
  fs.unlinkSync(target); const external = path.join(directory, 'outside.json'); fs.writeFileSync(external, original); fs.symlinkSync(external, target);
  assert.throws(() => service.list(scope), /PHONE_PREVIZ_FILE_INVALID/);
});
test('a symlinked integrations directory is never written through', t => {
  const { directory, preview, retain } = setup(t), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'qimovi-phone-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(directory, 'integrations'));
  assert.equal(preview(rotation()).status, 'READY');
  assert.throws(() => retain(rotation()), /PHONE_PREVIZ_DIRECTORY_INVALID/); assert.deepEqual(fs.readdirSync(outside), []);
});
