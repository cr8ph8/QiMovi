import { hashCanonical } from '../../kernel/src/canonical-json.mjs';
import { formatShotDirection, validateShotDirection, validateShotDirectionIdentity } from '../../contracts/shot-direction.mjs';

export const CAMERA_EXCHANGE_SCHEMA = 'filmstack-camera-exchange/v1';
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const check = (value, code) => { if (!value) fail(code); };
const clone = value => JSON.parse(JSON.stringify(value));
const text = value => typeof value === 'string';
const duration = value => value === null || (Number.isSafeInteger(value) && value > 0 && value <= 86400000);
const timestamp = value => value === null || (Number.isSafeInteger(value) && value >= 0 && value <= 86400000);
const relevantKinds = new Set(['scene-plan', 'storyboard-cell', 'casting-draft', 'generation-brief', 'shot-direction']);

function cameraRequest(shotId) {
  return {
    shotId,
    status: 'CAMERA_BLOCKING_REQUIRED',
    planned: {
      pose: { status: 'UNKNOWN', coordinateSystem: 'UNSPECIFIED', space: 'WORLD', positionUnit: 'METERS', rotationEncoding: 'QUATERNION_XYZW', position: null, rotation: null },
      lens: { status: 'UNKNOWN', projection: null, focalLengthMm: null, sensorWidthMm: null, sensorHeightMm: null, lensShift: null, gateFit: null },
      render: { frameRate: null, widthPixels: null, heightPixels: null, pixelAspectRatio: null },
      motion: { status: 'UNSPECIFIED', keyframes: [] },
    },
    actual: { status: 'NOT_OBSERVED', camera: null, mediaHash: null, measuredDurationMs: null, evidenceHash: null },
  };
}

/** A planning-only exchange. Does not infer spatial data from artwork or shot prose. */
export function buildCameraExchange(snapshot, { sceneId, expectedSourceHash, expectedBasisHash } = {}) {
  check(snapshot && typeof snapshot === 'object' && snapshot.project && Array.isArray(snapshot.records), 'DCC_SNAPSHOT_REQUIRED');
  const project = snapshot.project;
  check(ID.test(project.id) && SHA.test(project.sourceHash) && Array.isArray(project.scenes) && Array.isArray(project.cells), 'DCC_PROJECT_INVALID');
  check(SHA.test(expectedSourceHash) && expectedSourceHash === project.sourceHash, 'DCC_SOURCE_CONFLICT');
  check(ID.test(sceneId), 'DCC_SCENE_REQUIRED');
  const scene = project.scenes.find(item => item.id === sceneId);
  check(scene && Array.isArray(scene.shots) && scene.shots.length > 0 && scene.shots.length <= 100 && Array.isArray(scene.paragraphs), 'DCC_SCENE_INVALID');
  check(project.scenes.filter(item => item.id === sceneId).length === 1, 'DCC_DUPLICATE_SCENE');
  check(text(scene.heading) && scene.paragraphs.length <= 1000, 'DCC_SCENE_INVALID');
  const paragraphs = [...(project.prologue ?? []), ...scene.paragraphs];
  const paragraphIds = paragraphs.map(item => item.id);
  check(new Set(paragraphIds).size === paragraphIds.length && paragraphs.every(item => ID.test(item.id) && text(item.type) && text(item.text)), 'DCC_PARAGRAPH_INVALID');
  const shotIds = scene.shots.map(item => item.id);
  check(new Set(shotIds).size === shotIds.length && shotIds.every(id => ID.test(id)), 'DCC_SHOT_IDENTITY_INVALID');
  const cells = project.cells.filter(item => item.sceneId === sceneId);
  check(cells.length <= 400 && new Set(cells.map(item => item.id)).size === cells.length, 'DCC_CELL_IDENTITY_INVALID');
  for (const cell of cells) {
    check(ID.test(cell.id) && shotIds.includes(cell.shotId) && ['START', 'MOMENT', 'END'].includes(cell.role), 'DCC_ORPHAN_CELL');
    check(cell.imageHash == null || SHA.test(cell.imageHash), 'DCC_IMAGE_HASH_INVALID');
    check(text(cell.description ?? '') && Array.isArray(cell.actionRefs) && cell.actionRefs.every(id => paragraphIds.includes(id)) && new Set(cell.actionRefs).size === cell.actionRefs.length, 'DCC_ACTION_REFERENCE_INVALID');
    check(timestamp(cell.plannedTimestampMs ?? null), 'DCC_PLANNED_TIMESTAMP_INVALID');
    if (cell.role === 'START') check(cell.shotId === shotIds[0], 'DCC_SCENE_START_MAPPING_INVALID');
    if (cell.crop != null) {
      const crop = cell.crop;
      check(SHA.test(cell.imageHash) && Number.isSafeInteger(cell.pixelWidth) && Number.isSafeInteger(cell.pixelHeight) && cell.pixelWidth > 0 && cell.pixelHeight > 0, 'DCC_CROP_DIMENSIONS_REQUIRED');
      check([crop.x,crop.y,crop.width,crop.height].every(Number.isSafeInteger) && crop.x >= 0 && crop.y >= 0 && crop.width > 0 && crop.height > 0 && crop.x + crop.width <= cell.pixelWidth && crop.y + crop.height <= cell.pixelHeight, 'DCC_CROP_INVALID');
    }
  }
  const relevantRecords = snapshot.records.filter(record => relevantKinds.has(record.kind) && (record.kind === 'casting-draft' || record.data?.sceneId === sceneId));
  check(relevantRecords.length <= 1000 && new Set(relevantRecords.map(record => record.id)).size === relevantRecords.length, 'DCC_RECORD_IDENTITY_INVALID');
  for (const record of relevantRecords) {
    check(ID.test(record.id) && Number.isSafeInteger(record.version) && record.version > 0 && SHA.test(record.sha256) && record.sha256 === hashCanonical(record.data), 'DCC_RECORD_HASH_MISMATCH');
    check(record.data.sourceHash === project.sourceHash, 'DCC_RECORD_SOURCE_CONFLICT');
    if (record.kind === 'shot-direction') { validateShotDirectionIdentity(record.id, record.kind, record.data); validateShotDirection(record.data, project); }
  }
  const records = relevantRecords.map(({ id, kind, version, sha256 }) => ({ id, kind, version, sha256 })).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const basisHash = hashCanonical({ projectId: project.id, sourceHash: project.sourceHash, scene, paragraphs, cells, records });
  if (expectedBasisHash !== undefined) check(expectedBasisHash === basisHash, 'DCC_BASIS_CONFLICT');
  const shots = scene.shots.map(shot => {
    check(text(shot.label) && text(shot.description ?? '') && duration(shot.plannedDurationMs ?? null), 'DCC_SHOT_INVALID');
    const direction = relevantRecords.find(record => record.kind === 'shot-direction' && record.data.shotId === shot.id);
    return { id: shot.id, label: shot.label, description: shot.description ?? '', plannedDurationMs: shot.plannedDurationMs ?? null,
      ...(direction ? { artisticDirection: { recordRef: { id: direction.id, version: direction.version, sha256: direction.sha256 }, direction: clone(direction.data),
        text: formatShotDirection(direction.data), authority: 'ARTISTIC_PLANNING_ONLY', executable: false } } : {}),
      cells: cells.filter(cell => cell.shotId === shot.id).map(cell => ({
        id: cell.id, role: cell.role, description: cell.description ?? '', actionRefs: clone(cell.actionRefs),
        imageHash: cell.imageHash ?? null, crop: clone(cell.crop ?? null), pixelWidth: cell.pixelWidth ?? null, pixelHeight: cell.pixelHeight ?? null,
        plannedTimestampMs: cell.plannedTimestampMs ?? null, timestampBasis: 'UNCONFIRMED', review: 'REQUIRES_OWNER_REVIEW',
      })) };
  });
  const payload = {
    schemaVersion: CAMERA_EXCHANGE_SCHEMA,
    purpose: 'PLANNING_HANDOFF',
    readiness: 'CAMERA_BLOCKING_REQUIRED',
    source: { projectId: project.id, sourceHash: project.sourceHash, sourceAuthority: 'NOT_EVALUATED_BY_EXPORTER' },
    basis: { sha256: basisHash, records },
    scene: { id: scene.id, heading: scene.heading, paragraphs: paragraphs.map(({ id, type, text }) => ({ id, type, text })), shots },
    cameras: shots.map(shot => cameraRequest(shot.id)),
    execution: { application: null, localProject: null, command: null, canExecute: false },
  };
  return { ...payload, sha256: hashCanonical(payload) };
}

/** Binds an untouched handoff to the current project snapshot. Edited camera
 * proposals and application observations need separate future contracts. */
export function validateCameraExchange(exchange, snapshot) {
  check(exchange && typeof exchange === 'object' && exchange.schemaVersion === CAMERA_EXCHANGE_SCHEMA, 'DCC_EXCHANGE_INVALID');
  const expected = buildCameraExchange(snapshot, { sceneId: exchange.scene?.id, expectedSourceHash: exchange.source?.sourceHash, expectedBasisHash: exchange.basis?.sha256 });
  check(hashCanonical(exchange) === hashCanonical(expected), 'DCC_EXCHANGE_CHANGED');
  return exchange;
}
