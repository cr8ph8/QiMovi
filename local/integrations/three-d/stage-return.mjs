import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual as same } from 'node:util';
import { inflateSync } from 'node:zlib';
import { hashCanonical } from '../../kernel/src/canonical-json.mjs';
import { buildDccStageKit } from './stage-kit.mjs';
import { validateUnityDirectorObservation } from './unity-director/contract.mjs';

export const DCC_STAGE_RETURN_SCHEMA = 'caniscreenwrite-dcc-stage-return/v1';
export const DCC_STAGE_RETURN_MAX_BYTES = 256 * 1024 * 1024;
const need = (value, code) => { if (!value) throw Object.assign(new Error(code), { code }); };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const shape = (value, keys) => need(value && typeof value === 'object' && !Array.isArray(value) && same(Object.keys(value).sort(), [...keys].sort()), 'DCC_RETURN_FIELDS_INVALID');
const text = (value, max = 240) => typeof value === 'string' && value.length > 0 && value.length <= max && value.isWellFormed() && !/[\x00-\x1f\x7f]/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const filename = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value) && !value.includes('..');
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function parse(bytes) {
  need(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 1024 * 1024, 'DCC_RETURN_JSON_SIZE_INVALID');
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { need(false, 'DCC_RETURN_JSON_INVALID'); }
  return value;
}
function kitContext(expectedKit, snapshot) {
  shape(expectedKit, ['schemaVersion', 'projectId', 'sourceHash', 'sceneId', 'shotId', 'basisSha256', 'target', 'planSha256', 'files', 'execution', 'sha256']);
  const { sha256: claimed, ...body } = expectedKit;
  need(expectedKit.schemaVersion === 'caniscreenwrite-dcc-stage-kit/v1' && digest(claimed) && hashCanonical(body) === claimed && same(expectedKit.execution, { canExecute: false }), 'DCC_RETURN_KIT_INVALID');
  need(Array.isArray(expectedKit.files) && expectedKit.files.length >= 4 && expectedKit.files.length <= 20, 'DCC_RETURN_KIT_FILES_INVALID');
  const files = new Map();
  for (const item of expectedKit.files) {
    shape(item, ['path', 'content', 'sha256']);
    need(typeof item.path === 'string' && !files.has(item.path) && typeof item.content === 'string' && Buffer.byteLength(item.content) <= 1024 * 1024 && sha(item.content) === item.sha256, 'DCC_RETURN_KIT_FILES_INVALID');
    files.set(item.path, item);
  }
  const planFile = files.get('stage-plan.json'), exchangeFile = files.get('camera-exchange.json'), manifestFile = files.get('files.json');
  need(planFile && exchangeFile && manifestFile && planFile.sha256 === expectedKit.planSha256, 'DCC_RETURN_KIT_FILES_INVALID');
  const plan = parse(Buffer.from(planFile.content)), exchange = parse(Buffer.from(exchangeFile.content));
  const manifest = parse(Buffer.from(manifestFile.content));
  need(same(manifest, { schemaVersion: 'caniscreenwrite-dcc-stage-files/v1', files: expectedKit.files.filter(f => f.path !== 'files.json').map(({ path, sha256 }) => ({ path, sha256 })) }), 'DCC_RETURN_KIT_MANIFEST_INVALID');
  // Rebuild only the immutable plan/exchange under the current source/basis.
  // Exporter code may evolve after a kit was retained; do not substitute its new
  // bytes for those of the actual originating kit.
  const settings = plan.cameraTemplate;
  need(settings && typeof settings === 'object', 'DCC_RETURN_PLAN_INVALID');
  const current = buildDccStageKit(snapshot, { sceneId: expectedKit.sceneId, expectedSourceHash: expectedKit.sourceHash, expectedBasisHash: expectedKit.basisSha256,
    shotId: expectedKit.shotId, target: expectedKit.target, lensMm: settings.lensMm, durationSeconds: settings.durationSeconds,
    motion: settings.motion, travelMm: settings.travelMm, blockingNotes: plan.blockingNotes,
    ...(Object.hasOwn(plan, 'previz') ? { previz: plan.previz } : {}) });
  need(current.planSha256 === planFile.sha256 && current.files.find(f => f.path === 'camera-exchange.json').sha256 === exchangeFile.sha256, 'DCC_RETURN_PLAN_CHANGED');
  for (const key of ['projectId', 'sourceHash', 'sceneId', 'shotId', 'target', 'basisSha256']) need(plan[key] === expectedKit[key], 'DCC_RETURN_KIT_SCOPE_MISMATCH');
  const origin = { projectId: plan.projectId, sourceHash: plan.sourceHash, sceneId: plan.sceneId, shotId: plan.shotId, target: plan.target,
    basisSha256: plan.basisSha256, exchangeSha256: exchange.sha256, planFileSha256: planFile.sha256, exchangeFileSha256: exchangeFile.sha256 };
  return { plan, exchange, files, origin, kitFilesSha256: manifestFile.sha256 };
}
const crc32 = bytes => {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
};
/** Decode the bounded scanline envelope and CRCs; dimensions come from PNG bytes,
 * never the planned render size. Pixel appearance still needs human review. */
function pngSize(bytes) {
  need(bytes.length >= 57 && bytes.length <= 32 * 1024 * 1024 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'DCC_RETURN_PNG_INVALID');
  let offset = 8, width, height, channels, depth, ended = false, idatEnded = false;
  const compressed = [];
  while (offset < bytes.length) {
    need(offset + 12 <= bytes.length && !ended, 'DCC_RETURN_PNG_INVALID');
    const length = bytes.readUInt32BE(offset), end = offset + length + 12;
    need(end <= bytes.length, 'DCC_RETURN_PNG_INVALID');
    const type = bytes.toString('ascii', offset + 4, offset + 8), chunk = bytes.subarray(offset + 8, end - 4);
    need(/^[A-Za-z]{4}$/.test(type), 'DCC_RETURN_PNG_INVALID');
    need(crc32(bytes.subarray(offset + 4, end - 4)) === bytes.readUInt32BE(end - 4), 'DCC_RETURN_PNG_INVALID');
    if (offset === 8) {
      need(type === 'IHDR' && length === 13, 'DCC_RETURN_PNG_INVALID');
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); depth = chunk[8]; channels = chunk[9] === 2 ? 3 : chunk[9] === 6 ? 4 : 0;
      need(integer(width, 1, 8192) && integer(height, 1, 8192) && width * height <= 16_777_216 && [8, 16].includes(depth) && channels && chunk[10] === 0 && chunk[11] === 0 && chunk[12] === 0, 'DCC_RETURN_PNG_INVALID');
    } else need(type !== 'IHDR', 'DCC_RETURN_PNG_INVALID');
    if (type === 'IDAT') { need(!idatEnded, 'DCC_RETURN_PNG_INVALID'); compressed.push(chunk); }
    else if (compressed.length) idatEnded = true;
    if (type === 'IEND') { need(length === 0 && end === bytes.length, 'DCC_RETURN_PNG_INVALID'); ended = true; }
    else need(['IHDR', 'IDAT', 'PLTE'].includes(type) || /^[a-z]/.test(type), 'DCC_RETURN_PNG_INVALID');
    offset = end;
  }
  need(ended && compressed.length, 'DCC_RETURN_PNG_INVALID');
  const stride = width * channels * (depth / 8) + 1, expected = stride * height;
  need(expected <= 128 * 1024 * 1024, 'DCC_RETURN_PNG_INVALID');
  let decoded; try { decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected + 1 }); } catch { need(false, 'DCC_RETURN_PNG_INVALID'); }
  need(decoded.length === expected, 'DCC_RETURN_PNG_INVALID');
  for (let row = 0; row < height; row++) need(decoded[row * stride] <= 4, 'DCC_RETURN_PNG_INVALID');
  return { widthPixels: width, heightPixels: height };
}
function validateBlenderObservation(observation, receipt, files) {
  shape(observation, ['schemaVersion', 'sourceHash', 'projectId', 'sceneId', 'shotId', 'basisSha256', 'planFileSha256', 'exchangeFileSha256', 'exchangeSha256', 'kitFilesSha256', 'applicationVersion', 'cameraObjectName', 'sceneFile', 'coordinates', 'frameRate', 'frameRateBase', 'frameRange', 'resolution', 'resolutionPercentage', 'observedFrames', 'measuredMediaDurationMs', 'reopenedVerified', 'approvalGranted', 'finalMedia']);
  need(observation.schemaVersion === 'caniscreenwrite-blender-rehearsal-observation/v2' && observation.kitFilesSha256 === receipt.kitFilesSha256 && observation.applicationVersion === receipt.application.version && text(observation.cameraObjectName), 'DCC_RETURN_OBSERVATION_INVALID');
  for (const key of ['sourceHash', 'projectId', 'sceneId', 'shotId', 'basisSha256', 'planFileSha256', 'exchangeFileSha256', 'exchangeSha256']) need(observation[key] === receipt.origin[key], 'DCC_RETURN_OBSERVATION_SCOPE_MISMATCH');
  need(observation.measuredMediaDurationMs === null && observation.reopenedVerified === false && observation.approvalGranted === false && observation.finalMedia === false, 'DCC_RETURN_AUTHORITY_INVALID');
  need(same(observation.sceneFile, { filename: receipt.sceneFile.path, sha256: receipt.sceneFile.sha256 }) && observation.coordinates === 'BLENDER_RIGHT_HANDED_Z_UP_WORLD_METERS;OBSERVED_QUATERNION_WXYZ', 'DCC_RETURN_OBSERVATION_INVALID');
  need(number(observation.frameRate, 1, 240) && number(observation.frameRateBase, 0.001, 1000) && Array.isArray(observation.frameRange) && observation.frameRange.length === 2 && observation.frameRange.every(f => integer(f, 0, 1_000_000)) && observation.frameRange[0] <= observation.frameRange[1], 'DCC_RETURN_TIMING_INVALID');
  need(Array.isArray(observation.resolution) && observation.resolution.length === 2 && observation.resolution.every(n => integer(n, 1, 65536)) && integer(observation.resolutionPercentage, 1, 100), 'DCC_RETURN_RESOLUTION_INVALID');
  need(Array.isArray(observation.observedFrames) && observation.observedFrames.length > 0 && observation.observedFrames.length <= 16, 'DCC_RETURN_FRAMES_INVALID');
  const labels = new Set(), returnedMedia = [], frames = [];
  let previousFrame = -1;
  for (const frame of observation.observedFrames) {
    shape(frame, ['label', 'frame', 'worldPositionMeters', 'worldQuaternionWXYZ', 'lensMm', 'sensorWidthMm', 'sensorFit', 'media']);
    need(filename(frame.label) && !labels.has(frame.label) && integer(frame.frame, observation.frameRange[0], observation.frameRange[1]) && frame.frame >= previousFrame, 'DCC_RETURN_FRAMES_INVALID'); labels.add(frame.label); previousFrame = frame.frame;
    need((frame.label !== 'opening' || frame.frame === observation.frameRange[0]) && (frame.label !== 'ending' || frame.frame === observation.frameRange[1]), 'DCC_RETURN_FRAME_ROLE_MISMATCH');
    need(Array.isArray(frame.worldPositionMeters) && frame.worldPositionMeters.length === 3 && frame.worldPositionMeters.every(n => number(n, -1e9, 1e9))
      && Array.isArray(frame.worldQuaternionWXYZ) && frame.worldQuaternionWXYZ.length === 4 && frame.worldQuaternionWXYZ.every(n => number(n, -1, 1)) && Math.abs(Math.hypot(...frame.worldQuaternionWXYZ) - 1) <= 0.001
      && number(frame.lensMm, 0.01, 10000) && number(frame.sensorWidthMm, 0.01, 1000) && ['AUTO', 'HORIZONTAL', 'VERTICAL'].includes(frame.sensorFit), 'DCC_RETURN_CAMERA_INVALID');
    if (frame.media !== null) {
      shape(frame.media, ['filename', 'sha256', 'role']);
      need(frame.media.role === 'REHEARSAL_PREVIEW_PENDING_REVIEW', 'DCC_RETURN_AUTHORITY_INVALID');
      const role = frame.label === 'opening' ? 'OPENING' : frame.label === 'ending' ? 'ENDING' : 'MOMENT';
      const media = { path: frame.media.filename, sha256: frame.media.sha256, role, frame: frame.frame }; returnedMedia.push(media);
      need(filename(media.path) && media.path.endsWith('.png') && files[media.path] && sha(files[media.path]) === media.sha256, 'DCC_RETURN_MEDIA_MISMATCH');
      const dimensions = pngSize(files[media.path]);
      need(dimensions.widthPixels === Math.floor(observation.resolution[0] * observation.resolutionPercentage / 100) && dimensions.heightPixels === Math.floor(observation.resolution[1] * observation.resolutionPercentage / 100), 'DCC_RETURN_MEDIA_DIMENSIONS_MISMATCH');
      frames.push({ id: frame.label, shotId: receipt.origin.shotId, role, imageHash: media.sha256, ...dimensions, frame: frame.frame, reviewStatus: 'PENDING' });
    }
  }
  need(same(returnedMedia, receipt.media), 'DCC_RETURN_MEDIA_MISMATCH');
  return frames;
}

function validateUnitySceneObservation(observation, receipt, bundle, snapshot) {
  validateUnityDirectorObservation(observation, bundle, snapshot);
  need(observation.sceneFile.status === 'FILE_PRESENT_NOT_REOPEN_VERIFIED' && observation.sceneFile.dirty === false && observation.sceneFile.sha256 === receipt.sceneFile.sha256 && observation.application.version === receipt.application.version, 'DCC_RETURN_UNITY_SCENE_MISMATCH');
}

/** Three sampled camera renders from the explicitly applied Unity plan. This
 * checks package coherence, not independent execution, scene reopen or quality. */
function validateUnityRehearsalObservation(observation, receipt, files, context, bundle, snapshot) {
  shape(observation, ['schemaVersion', 'authority', 'directorObservation', 'projectId', 'sourceHash', 'sceneId', 'shotId', 'basisSha256', 'exchangeSha256', 'planJson', 'planSha256', 'kitFilesSha256', 'cameraMarkerId', 'cameraObjectGlobalId', 'frameRate', 'frameRange', 'resolution', 'appliedStartPositionMeters', 'appliedStartQuaternionXYZW', 'observedFrames', 'measuredMediaDurationMs', 'reopenedVerified', 'approvalGranted', 'finalMedia']);
  need(observation.schemaVersion === 'caniscreenwrite-unity-rehearsal-observation/v1' && observation.authority === 'CONTROLLED_PLAN_RENDER_PENDING_REVIEW'
    && observation.measuredMediaDurationMs === null && observation.reopenedVerified === false && observation.approvalGranted === false && observation.finalMedia === false, 'DCC_RETURN_AUTHORITY_INVALID');
  for (const key of ['projectId', 'sourceHash', 'sceneId', 'shotId', 'basisSha256', 'exchangeSha256']) need(observation[key] === receipt.origin[key], 'DCC_RETURN_OBSERVATION_SCOPE_MISMATCH');
  need(observation.planJson === context.files.get('stage-plan.json').content && observation.planSha256 === receipt.origin.planFileSha256
    && sha(observation.planJson) === observation.planSha256 && observation.kitFilesSha256 === receipt.kitFilesSha256, 'DCC_RETURN_UNITY_PLAN_MISMATCH');
  const director = observation.directorObservation;
  validateUnitySceneObservation(director, receipt, bundle, snapshot);
  const cameraId = `camera:${receipt.origin.shotId}`, originalCamera = director.objects.find(item => item.id === cameraId);
  need(observation.cameraMarkerId === cameraId && text(observation.cameraObjectGlobalId) && originalCamera?.globalObjectId === observation.cameraObjectGlobalId, 'DCC_RETURN_UNITY_CAMERA_IDENTITY_MISMATCH');
  const template = context.plan.cameraTemplate, lastFrame = template.durationSeconds * template.frameRate;
  need(observation.frameRate === template.frameRate && same(observation.frameRange, [1, lastFrame]), 'DCC_RETURN_TIMING_INVALID');
  need(same(observation.resolution, [template.widthPixels, template.heightPixels]), 'DCC_RETURN_RESOLUTION_INVALID');
  const decimal = value => typeof value === 'string' && value.length <= 40 && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) && number(Number(value), -1e6, 1e6);
  const vector = (value, length) => Array.isArray(value) && value.length === length && value.every(decimal);
  need(vector(observation.appliedStartPositionMeters, 3) && vector(observation.appliedStartQuaternionXYZW, 4)
    && Math.abs(Math.hypot(...observation.appliedStartQuaternionXYZW.map(Number)) - 1) <= 0.0001, 'DCC_RETURN_CAMERA_INVALID');
  const start = observation.appliedStartPositionMeters.map(Number), rotation = observation.appliedStartQuaternionXYZW.map(Number), [x, y, z, w] = rotation;
  const forward = [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
  const near = (actual, expected) => Math.abs(Number(actual) - expected) <= Math.max(0.0001, Math.abs(expected) * 0.000001);
  const samples = [['opening', 1, 'OPENING'], ['midpoint', 1 + Math.floor((lastFrame - 1) / 2), 'MOMENT'], ['ending', lastFrame, 'ENDING']];
  need(Array.isArray(observation.observedFrames) && observation.observedFrames.length === samples.length, 'DCC_RETURN_FRAMES_INVALID');
  const frames = [], returnedMedia = [];
  for (let index = 0; index < samples.length; index++) {
    const sample = observation.observedFrames[index], [label, frameNumber, role] = samples[index];
    shape(sample, ['label', 'frame', 'camera', 'media']);
    need(sample.label === label && sample.frame === frameNumber, 'DCC_RETURN_FRAME_ROLE_MISMATCH');
    const camera = sample.camera;
    need(camera && ['id', 'kind', 'shotId', 'cellId', 'name', 'globalObjectId'].every(key => camera[key] === originalCamera[key]) && same(camera.scale, originalCamera.scale), 'DCC_RETURN_UNITY_CAMERA_IDENTITY_MISMATCH');
    validateUnityDirectorObservation({ ...director, objects: director.objects.map(item => item.id === cameraId ? camera : item) }, bundle, snapshot);
    const direction = template.motion === 'DOLLY_IN' ? 1 : template.motion === 'DOLLY_OUT' ? -1 : 0;
    const travel = direction * template.travelMm / 1000 * (frameNumber - 1) / (lastFrame - 1);
    need(camera.position.every((value, axis) => near(value, start[axis] + forward[axis] * travel))
      && (camera.rotation.every((value, axis) => near(value, rotation[axis])) || camera.rotation.every((value, axis) => near(value, -rotation[axis]))), 'DCC_RETURN_UNITY_CAMERA_POSE_MISMATCH');
    const lens = camera.camera[0];
    // Directed optics are observed separately from the original proposal. A
    // user's lens edit is retained, while substituted per-frame optics reject.
    need(lens.physical === true && lens.orthographic === false && same(lens, originalCamera.camera[0])
      && number(Number(lens.focalLengthMm), 0.01, 10000) && number(Number(lens.sensorWidthMm), 0.01, 1000) && number(Number(lens.sensorHeightMm), 0.01, 1000)
      && ['None', 'Vertical', 'Horizontal', 'Fill', 'Overscan'].includes(lens.gateFit), 'DCC_RETURN_UNITY_CAMERA_SETTINGS_MISMATCH');
    shape(sample.media, ['filename', 'sha256', 'role']);
    need(sample.media.role === 'REHEARSAL_PREVIEW_PENDING_REVIEW', 'DCC_RETURN_AUTHORITY_INVALID');
    const media = { path: sample.media.filename, sha256: sample.media.sha256, role, frame: frameNumber };
    need(media.path === `${label}.png` && files[media.path] && sha(files[media.path]) === media.sha256, 'DCC_RETURN_MEDIA_MISMATCH');
    const dimensions = pngSize(files[media.path]);
    need(dimensions.widthPixels === observation.resolution[0] && dimensions.heightPixels === observation.resolution[1], 'DCC_RETURN_MEDIA_DIMENSIONS_MISMATCH');
    returnedMedia.push(media);
    frames.push({ id: label, shotId: receipt.origin.shotId, role, imageHash: media.sha256, ...dimensions, frame: frameNumber, reviewStatus: 'PENDING' });
  }
  need(same(returnedMedia, receipt.media), 'DCC_RETURN_MEDIA_MISMATCH');
  return frames;
}
/** Pure verifier. expectedKit must come from the locally retained export, never
 * from a client-supplied replacement. No file is executed, approved or admitted. */
export function verifyDccStageReturnFiles(files, { expectedKit, snapshot }) {
  need(files && typeof files === 'object' && !Array.isArray(files) && Object.keys(files).length >= 6 && Object.keys(files).length <= 24, 'DCC_RETURN_FILES_INVALID');
  let total = 0;
  for (const [name, bytes] of Object.entries(files)) {
    need(filename(name) && Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 192 * 1024 * 1024, 'DCC_RETURN_FILE_INVALID');
    total += bytes.length; need(total <= DCC_STAGE_RETURN_MAX_BYTES, 'DCC_RETURN_SIZE_INVALID');
  }
  const context = kitContext(expectedKit, snapshot), receipt = parse(files['stage-return.json']);
  shape(receipt, ['schemaVersion', 'authority', 'kitFilesSha256', 'origin', 'application', 'observation', 'sceneFile', 'media', 'files', 'measuredMediaDurationMs', 'rightsStatus', 'reopenedVerified', 'approvalGranted', 'finalMedia']);
  need(receipt.schemaVersion === DCC_STAGE_RETURN_SCHEMA && receipt.authority === 'DCC_RETURN_PENDING_REVIEW' && receipt.measuredMediaDurationMs === null && receipt.rightsStatus === 'UNKNOWN' && receipt.reopenedVerified === false && receipt.approvalGranted === false && receipt.finalMedia === false, 'DCC_RETURN_AUTHORITY_INVALID');
  need(receipt.kitFilesSha256 === context.kitFilesSha256 && same(receipt.origin, context.origin), 'DCC_RETURN_ORIGIN_MISMATCH');
  shape(receipt.application, ['name', 'version']);
  need(receipt.application.name === (expectedKit.target === 'BLENDER' ? 'Blender' : 'Unity') && text(receipt.application.version, 80), 'DCC_RETURN_APPLICATION_MISMATCH');
  const manifestPaths = new Set();
  need(Array.isArray(receipt.files) && receipt.files.length === Object.keys(files).length - 1, 'DCC_RETURN_INVENTORY_MISMATCH');
  for (const item of receipt.files) {
    shape(item, ['path', 'sha256', 'byteLength']);
    need(filename(item.path) && item.path !== 'stage-return.json' && !manifestPaths.has(item.path) && Buffer.isBuffer(files[item.path]) && integer(item.byteLength, 1, 192 * 1024 * 1024) && item.byteLength === files[item.path].length && digest(item.sha256) && item.sha256 === sha(files[item.path]), 'DCC_RETURN_INVENTORY_MISMATCH'); manifestPaths.add(item.path);
  }
  for (const [returned, original] of [['stage-plan.json', 'stage-plan.json'], ['camera-exchange.json', 'camera-exchange.json'], ['kit-files.json', 'files.json']]) {
    need(Buffer.isBuffer(files[returned]) && files[returned].equals(Buffer.from(context.files.get(original).content)), 'DCC_RETURN_KIT_BYTES_MISMATCH');
  }
  for (const item of [receipt.observation, receipt.sceneFile]) {
    shape(item, ['path', 'sha256']); need(filename(item.path) && Buffer.isBuffer(files[item.path]) && sha(files[item.path]) === item.sha256, 'DCC_RETURN_ARTIFACT_MISMATCH');
  }
  need(receipt.observation.path === 'observation.json' && Array.isArray(receipt.media) && receipt.media.length <= 16, 'DCC_RETURN_FILES_INVALID');
  const mediaPaths = new Set();
  for (const item of receipt.media) {
    shape(item, ['path', 'sha256', 'role', 'frame']);
    need(filename(item.path) && item.path.endsWith('.png') && !mediaPaths.has(item.path) && ['OPENING', 'MOMENT', 'ENDING'].includes(item.role) && integer(item.frame, 0, 1_000_000), 'DCC_RETURN_MEDIA_INVALID'); mediaPaths.add(item.path);
  }
  need(same([...manifestPaths].sort(), ['stage-plan.json', 'camera-exchange.json', 'kit-files.json', 'observation.json', receipt.sceneFile.path, ...mediaPaths].sort()), 'DCC_RETURN_UNEXPECTED_FILE');
  const observation = parse(files['observation.json']); let frames = [];
  if (expectedKit.target === 'BLENDER') {
    need(receipt.sceneFile.path.endsWith('.blend') && /^BLENDER[-_][vV]\d{3}$/.test(files[receipt.sceneFile.path].subarray(0, 12).toString('ascii')), 'DCC_RETURN_SCENE_FORMAT_INVALID');
    frames = validateBlenderObservation(observation, receipt, files);
  } else {
    need(receipt.sceneFile.path.endsWith('.unity') && files[receipt.sceneFile.path].subarray(0, 128).toString('utf8').startsWith('%YAML 1.1'), 'DCC_RETURN_SCENE_FORMAT_INVALID');
    const bundle = parse(Buffer.from(context.files.get('unity-scene.json').content));
    if (observation.schemaVersion === 'caniscreenwrite-unity-rehearsal-observation/v1') frames = validateUnityRehearsalObservation(observation, receipt, files, context, bundle, snapshot);
    else {
      need(receipt.media.length === 0, 'DCC_RETURN_UNITY_RENDER_UNVERIFIED');
      validateUnitySceneObservation(observation, receipt, bundle, snapshot);
    }
  }
  const artifacts = Object.entries(files).map(([name, bytes]) => ({ name, sha256: sha(bytes), byteLength: bytes.length,
    mimeType: name.endsWith('.png') ? 'image/png' : name.endsWith('.json') ? 'application/json' : 'application/octet-stream' }));
  return { status: 'PACKAGE_AND_CURRENT_SOURCE_VERIFIED', receiptSha256: sha(files['stage-return.json']), kitSha256: expectedKit.sha256, kitFilesSha256: context.kitFilesSha256,
    origin: context.origin, plan: context.plan, exchange: context.exchange, receipt, observation, artifacts,
    frames: frames.map(frame => ({ ...frame, sourceRefs: [...context.plan.sourceRefs], sourceRefsStatus: context.plan.sourceRefsStatus })),
    scope: 'INTERNAL_REHEARSAL_CANDIDATE', association: expectedKit.target === 'UNITY' ? 'KIT_ASSOCIATED_ON_RETURN_NOT_EMBEDDED_PLAN_PROOF' : 'EXPORTER_REPORTED_EMBEDDED_PLAN_NOT_INDEPENDENT_REOPEN',
    executionVerified: false, reopenedVerified: false, measuredMediaDurationMs: null, rightsStatus: 'UNKNOWN', approvalGranted: false, finalMedia: false };
}
/** The existing Unity exporter returns observations, not renders. Package a
 * saved scene with those observations without adding new execution claims. */
export function buildUnityStageReturnFiles({ expectedKit, snapshot, observationBytes, sceneBytes }) {
  const context = kitContext(expectedKit, snapshot); need(expectedKit.target === 'UNITY', 'DCC_RETURN_TARGET_INVALID');
  const observation = parse(observationBytes);
  const files = { 'stage-plan.json': Buffer.from(context.files.get('stage-plan.json').content), 'camera-exchange.json': Buffer.from(context.files.get('camera-exchange.json').content),
    'kit-files.json': Buffer.from(context.files.get('files.json').content), 'observation.json': observationBytes, 'returned-scene.unity': sceneBytes };
  need(Buffer.isBuffer(sceneBytes), 'DCC_RETURN_FILE_INVALID');
  const receipt = { schemaVersion: DCC_STAGE_RETURN_SCHEMA, authority: 'DCC_RETURN_PENDING_REVIEW', kitFilesSha256: context.kitFilesSha256, origin: context.origin,
    application: { name: 'Unity', version: observation.application?.version }, observation: { path: 'observation.json', sha256: sha(observationBytes) }, sceneFile: { path: 'returned-scene.unity', sha256: sha(sceneBytes) }, media: [],
    files: Object.entries(files).map(([path, bytes]) => ({ path, sha256: sha(bytes), byteLength: bytes.length })), measuredMediaDurationMs: null, rightsStatus: 'UNKNOWN', reopenedVerified: false, approvalGranted: false, finalMedia: false };
  files['stage-return.json'] = jsonBytes(receipt);
  verifyDccStageReturnFiles(files, { expectedKit, snapshot }); return files;
}
/** Folder reader uses only fixed receipt-declared basenames, refuses symlinks,
 * and never extracts or executes a returned scene. A ZIP may sit alongside it. */
export function readDccStageReturnDirectory(directory) {
  need(typeof directory === 'string' && path.isAbsolute(directory) && fs.lstatSync(directory).isDirectory(), 'DCC_RETURN_DIRECTORY_INVALID');
  const read = (name, limit) => {
    need(filename(name), 'DCC_RETURN_FILE_INVALID');
    const fd = fs.openSync(path.join(directory, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const info = fs.fstatSync(fd);
      need(info.isFile() && info.size > 0 && info.size <= Math.min(limit, 192 * 1024 * 1024), 'DCC_RETURN_FILE_INVALID');
      const bytes = fs.readFileSync(fd); need(bytes.length === info.size, 'DCC_RETURN_FILE_CHANGED'); return bytes;
    } finally { fs.closeSync(fd); }
  };
  const receiptBytes = read('stage-return.json', 1024 * 1024), receipt = parse(receiptBytes);
  need(Array.isArray(receipt.files) && receipt.files.length >= 5 && receipt.files.length <= 23, 'DCC_RETURN_INVENTORY_MISMATCH');
  const files = { 'stage-return.json': receiptBytes }; let total = receiptBytes.length;
  for (const item of receipt.files) {
    need(filename(item?.path) && !Object.hasOwn(files, item.path), 'DCC_RETURN_FILE_INVALID');
    const bytes = read(item.path, DCC_STAGE_RETURN_MAX_BYTES - total); total += bytes.length; files[item.path] = bytes;
  }
  return files;
}
