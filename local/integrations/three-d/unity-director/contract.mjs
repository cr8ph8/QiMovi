import crypto from 'node:crypto';
import { canonicalJson } from '../../../kernel/src/canonical-json.mjs';
import { buildCameraExchange, validateCameraExchange } from '../exchange.mjs';

export const UNITY_DIRECTOR_SCHEMA = 'caniscreenwrite-unity-director/v1';
export const UNITY_DIRECTOR_ENVELOPE = 'caniscreenwrite-unity-director-envelope/v1';
export const UNITY_OBSERVATION_SCHEMA = 'caniscreenwrite-unity-director-observation/v1';
const sha = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const need = (value, code) => { if (!value) throw Object.assign(new Error(code), { code }); };
const shape = (value, keys) => need(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','), 'UNITY_DIRECTOR_FIELDS_INVALID');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const boundedText = (value, max) => typeof value === 'string' && value.isWellFormed() && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const decimal = value => typeof value === 'string' && value.length <= 40 && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 1e12;
const vector = (value, length) => Array.isArray(value) && value.length === length && value.every(decimal);

/** Only an unchanged, snapshot-validated camera exchange can become a stage. */
export function buildUnityDirectorBundle(snapshot, options) {
  const exchange = buildCameraExchange(snapshot, options);
  validateCameraExchange(exchange, snapshot);
  const payload = {
    schemaVersion: UNITY_DIRECTOR_SCHEMA,
    authority: 'PROPOSED_BLOCKING_ONLY',
    projectId: exchange.source.projectId,
    sourceHash: exchange.source.sourceHash,
    sceneId: exchange.scene.id,
    heading: exchange.scene.heading,
    basisSha256: exchange.basis.sha256,
    exchangeSha256: exchange.sha256,
    exchangeJson: canonicalJson(exchange),
    paragraphs: exchange.scene.paragraphs,
    shots: exchange.scene.shots.map(shot => ({
      id: shot.id, label: shot.label, description: shot.description,
      durationKnown: shot.plannedDurationMs !== null, plannedDurationMs: shot.plannedDurationMs ?? 0,
      cells: shot.cells.map(cell => ({ id: cell.id, role: cell.role, description: cell.description, actionRefs: cell.actionRefs,
        imageHash: cell.imageHash ?? '', timestampKnown: cell.plannedTimestampMs !== null,
        plannedTimestampMs: cell.plannedTimestampMs ?? 0, timestampBasis: cell.timestampBasis })),
    })),
    sourceCameraStatus: 'UNKNOWN',
    editorDefaultsStatus: 'PLACEHOLDERS_NOT_SOURCE_MEASUREMENTS',
    sceneCreation: 'NEW_ADDITIVE_UNSAVED',
    approvalGranted: false,
  };
  const payloadJson = canonicalJson(payload);
  return { schemaVersion: UNITY_DIRECTOR_ENVELOPE, payloadJson, payloadSha256: sha(payloadJson) };
}

/** One ordered handoff per current scene; this does not sum a film runtime. */
export function buildUnityDirectorFilm(snapshot, expectedSourceHash) {
  const project = snapshot?.project;
  need(project && Array.isArray(project.scenes) && project.scenes.length > 0 && project.scenes.length <= 100 && new Set(project.scenes.map(s => s.id)).size === project.scenes.length, 'UNITY_DIRECTOR_FILM_SCENES_INVALID');
  const files = [];
  const scenes = project.scenes.map((scene, index) => {
    const bundle = buildUnityDirectorBundle(snapshot, { sceneId: scene.id, expectedSourceHash });
    const filename = `scene-${String(index + 1).padStart(2, '0')}-${scene.id.replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
    const bytes = JSON.stringify(bundle, null, 2) + '\n'; files.push({ filename, bytes });
    return { sceneId: scene.id, filename, payloadSha256: bundle.payloadSha256, fileSha256: sha(bytes) };
  });
  return { manifest: { schemaVersion: 'caniscreenwrite-unity-director-film/v1', projectId: project.id, sourceHash: project.sourceHash, authority: 'PROPOSED_BLOCKING_ONLY', sceneOrder: scenes.map(s => s.sceneId), scenes, approvalGranted: false, runtimeEstablished: false }, files };
}

export function validateUnityDirectorBundle(bundle, snapshot) {
  shape(bundle, ['schemaVersion', 'payloadJson', 'payloadSha256']);
  need(bundle.schemaVersion === UNITY_DIRECTOR_ENVELOPE && boundedText(bundle.payloadJson, 1024 * 1024) && digest(bundle.payloadSha256) && sha(bundle.payloadJson) === bundle.payloadSha256, 'UNITY_DIRECTOR_BUNDLE_HASH_MISMATCH');
  let payload; try { payload = JSON.parse(bundle.payloadJson); } catch { need(false, 'UNITY_DIRECTOR_JSON_INVALID'); }
  const expected = buildUnityDirectorBundle(snapshot, { sceneId: payload.sceneId, expectedSourceHash: payload.sourceHash, expectedBasisHash: payload.basisSha256 });
  need(canonicalJson(bundle) === canonicalJson(expected), 'UNITY_DIRECTOR_BUNDLE_CHANGED');
  return payload;
}

/** Returned JSON is untrusted evidence, never a canonical record or an approval.
 * Validate against the CURRENT snapshot again so changed inputs invalidate it. */
export function validateUnityDirectorObservation(observation, bundle, snapshot) {
  const payload = validateUnityDirectorBundle(bundle, snapshot);
  shape(observation, ['schemaVersion', 'authority', 'payloadSha256', 'projectId', 'sourceHash', 'sceneId', 'basisSha256', 'exchangeSha256', 'stageInstanceId', 'application', 'sceneFile', 'coordinates', 'objects', 'notes', 'approvalGranted', 'finalMedia', 'reopenedVerified']);
  need(observation.schemaVersion === UNITY_OBSERVATION_SCHEMA && observation.authority === 'EDITOR_OBSERVATION_PENDING_REVIEW' && observation.approvalGranted === false && observation.finalMedia === false && observation.reopenedVerified === false, 'UNITY_OBSERVATION_AUTHORITY_INVALID');
  for (const key of ['projectId', 'sourceHash', 'sceneId', 'basisSha256', 'exchangeSha256']) need(observation[key] === payload[key], 'UNITY_OBSERVATION_SOURCE_MISMATCH');
  need(observation.payloadSha256 === bundle.payloadSha256 && /^[a-f0-9]{32}$/.test(observation.stageInstanceId), 'UNITY_OBSERVATION_STAGE_INVALID');
  shape(observation.application, ['name', 'version', 'projectPath']);
  need(observation.application.name === 'Unity' && boundedText(observation.application.version, 80) && observation.application.version.length > 0 && boundedText(observation.application.projectPath, 4096), 'UNITY_OBSERVATION_APPLICATION_INVALID');
  shape(observation.sceneFile, ['status', 'path', 'sha256', 'dirty']);
  const file = observation.sceneFile;
  need(typeof file.dirty === 'boolean' && boundedText(file.path, 4096) && (file.status === 'UNSAVED' ? file.path === '' && file.sha256 === '' : ['FILE_PRESENT_NOT_REOPEN_VERIFIED', 'SAVED_FILE_WITH_UNSAVED_CHANGES'].includes(file.status) && file.path.endsWith('.unity') && digest(file.sha256) && (file.status === 'SAVED_FILE_WITH_UNSAVED_CHANGES') === file.dirty), 'UNITY_OBSERVATION_SCENE_FILE_INVALID');
  need(observation.coordinates === 'UNITY_LEFT_HANDED_X_RIGHT_Y_UP_Z_FORWARD;WORLD;METERS_PER_UNIT_1_PROPOSED;QUATERNION_XYZW' && boundedText(observation.notes, 8000), 'UNITY_OBSERVATION_COORDINATES_INVALID');
  const expected = new Map();
  for (const shot of payload.shots) {
    expected.set('shot:' + shot.id, { kind: 'SHOT', shotId: shot.id, cellId: '' });
    expected.set('camera:' + shot.id, { kind: 'CAMERA', shotId: shot.id, cellId: '' });
    for (const cell of shot.cells) expected.set('cell:' + cell.id, { kind: 'CELL', shotId: shot.id, cellId: cell.id });
  }
  need(Array.isArray(observation.objects) && observation.objects.length >= expected.size && observation.objects.length <= expected.size + 200, 'UNITY_OBSERVATION_OBJECT_COUNT_INVALID');
  const seen = new Set();
  for (const item of observation.objects) {
    shape(item, ['id', 'kind', 'shotId', 'cellId', 'name', 'globalObjectId', 'position', 'rotation', 'scale', 'camera']);
    need(typeof item.id === 'string' && !seen.has(item.id) && boundedText(item.name, 240) && boundedText(item.globalObjectId, 240), 'UNITY_OBSERVATION_OBJECT_INVALID'); seen.add(item.id);
    if (item.kind === 'BLOCKING') need(/^blocking:[a-f0-9]{32}$/.test(item.id) && payload.shots.some(s => s.id === item.shotId) && item.cellId === '', 'UNITY_OBSERVATION_BLOCKING_ORPHAN');
    else { const match = expected.get(item.id); need(match && ['kind', 'shotId', 'cellId'].every(key => item[key] === match[key]), 'UNITY_OBSERVATION_OBJECT_ORPHAN'); }
    need(vector(item.position, 3) && vector(item.rotation, 4) && vector(item.scale, 3), 'UNITY_OBSERVATION_TRANSFORM_INVALID');
    const length = Math.hypot(...item.rotation.map(Number)); need(Math.abs(length - 1) <= 0.0001, 'UNITY_OBSERVATION_ROTATION_INVALID');
    need(Array.isArray(item.camera), 'UNITY_OBSERVATION_CAMERA_KIND_INVALID');
    if (item.kind === 'CAMERA') {
      need(item.camera.length === 1, 'UNITY_OBSERVATION_CAMERA_KIND_INVALID');
      const camera = item.camera[0];
      shape(camera, ['enabled', 'physical', 'orthographic', 'fieldOfViewDegrees', 'orthographicSize', 'focalLengthMm', 'sensorWidthMm', 'sensorHeightMm', 'lensShiftX', 'lensShiftY', 'nearClipMeters', 'farClipMeters', 'gateFit']);
      need(['enabled', 'physical', 'orthographic'].every(key => typeof camera[key] === 'boolean') && Object.entries(camera).every(([key, value]) => ['enabled', 'physical', 'orthographic'].includes(key) ? true : key === 'gateFit' ? boundedText(value, 80) : decimal(value)), 'UNITY_OBSERVATION_LENS_INVALID');
      need(Number(camera.nearClipMeters) > 0 && Number(camera.farClipMeters) > Number(camera.nearClipMeters) && Number(camera.fieldOfViewDegrees) > 0 && Number(camera.fieldOfViewDegrees) < 180, 'UNITY_OBSERVATION_LENS_RANGE_INVALID');
    } else need(item.camera.length === 0, 'UNITY_OBSERVATION_CAMERA_KIND_INVALID');
  }
  need([...expected.keys()].every(id => seen.has(id)), 'UNITY_OBSERVATION_REQUIRED_MARKER_MISSING');
  return { status: 'STRUCTURE_AND_CURRENT_SOURCE_VERIFIED', authority: 'PENDING_OWNER_REVIEW', objectCount: observation.objects.length, payloadSha256: bundle.payloadSha256, executionVerified: false, sceneReopenVerified: false, approvalGranted: false };
}

export function unityDirectorArtifactSha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
