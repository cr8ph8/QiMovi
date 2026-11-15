import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrevisPlan, resizePrevis, samplePrevis, validatePrevisPlan } from '../src/drifter/visualPrevis.mjs';

const scope = { projectId: 'project:one', sourceHash: 'a'.repeat(64), sceneId: 'scene-1', shotId: 'shot-1' };

test('shot plans bind to the exact screenplay revision and shot and stay proposals', () => {
  const draft = createPrevisPlan(scope);
  assert.equal(validatePrevisPlan(JSON.parse(JSON.stringify(draft)), scope).status, 'DRAFT');
  assert.throws(() => validatePrevisPlan(draft, { ...scope, shotId: 'shot-2' }), /different shot or screenplay revision/);
  assert.throws(() => validatePrevisPlan(draft, { ...scope, sourceHash: 'b'.repeat(64) }), /different shot or screenplay revision/);
  assert.throws(() => validatePrevisPlan({ ...draft, status: 'ACCEPTED' }, scope), /valid QiMovi/);
});

test('camera, lens and stand-in interpolate on the same clock and cuts land on the selected frame', () => {
  const draft = createPrevisPlan(scope);
  const start = { ...draft.keyframes[0], easing: 'LINEAR', subjectX: -100, lensMm: 25 };
  const end = { ...draft.keyframes[1], frame: 60, subjectX: 100, lensMm: 55 };
  const plan = validatePrevisPlan({ ...draft, keyframes: [start, end, draft.keyframes[2]] }, scope);
  assert.equal(samplePrevis(plan, 30).subjectX, 0);
  assert.equal(samplePrevis(plan, 30).lensMm, 40);
  assert.equal(samplePrevis(plan, 30).cameraX, (start.cameraX + end.cameraX) / 2);
  assert.ok(samplePrevis({ ...plan, keyframes: [{ ...start, easing: 'EASE_IN_OUT' }, ...plan.keyframes.slice(1)] }, 15).cameraX < samplePrevis(plan, 15).cameraX);
  plan.keyframes[0] = { ...start, easing: 'CUT' };
  assert.equal(samplePrevis(plan, 59).lensMm, 25);
  assert.equal(samplePrevis(plan, 60).lensMm, 55);
});

test('shortening a shot preserves ordered unique keyframes and the two endpoints', () => {
  const draft = createPrevisPlan(scope);
  draft.keyframes = [...Array.from({ length: 23 }, (_, frame) => ({ ...draft.keyframes[0], frame })), draft.keyframes[2]];
  const resized = validatePrevisPlan(resizePrevis(draft, 48), scope);
  const frames = resized.keyframes.map(key => key.frame);
  assert.equal(frames[0], 0);
  assert.equal(frames.at(-1), 47);
  assert.equal(new Set(frames).size, draft.keyframes.length);
  assert.deepEqual(frames, [...frames].sort((a, b) => a - b));
});
