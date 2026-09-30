import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { isDeepStrictEqual as same } from 'node:util';
import { check, canonical, sha256 } from './storage.mjs';
import { buildCameraExchange } from '../integrations/three-d/exchange.mjs';
import { buildDccStageKit } from '../integrations/three-d/stage-kit.mjs';
import { verifyDccStageReturnFiles } from '../integrations/three-d/stage-return.mjs';
import { validateDccReturnOriginRef } from '../contracts/dcc-return-origin.mjs';

export const DCC_STAGE_RETURN_UPLOAD_MAX_BYTES = 64 * 1024 * 1024;
const schemaVersion = 'caniscreenwrite-dcc-stage-returns/v1';
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const basename = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value) && !value.includes('..');
const recordKinds = new Set(['scene-plan', 'storyboard-cell', 'casting-draft', 'generation-brief', 'shot-direction']);

// Retain precisely the inputs used by the DCC exchange, not unrelated lore/media
// records. The complete resolved project remains unchanged in this snapshot.
const snapshotFor = (store, sceneId) => ({ project: store.resolvedProject(), records: store.rawList().filter(record => recordKinds.has(record.kind) && (record.kind === 'casting-draft' || record.data?.sceneId === sceneId)) });
function scope(store, projectId, sourceHash, sceneId) {
  const project = store.project();
  check(project?.id === projectId && digest(sourceHash) && project.sourceHash === sourceHash, 'DCC_RETURN_PROJECT_OR_SOURCE_MISMATCH', 409);
  check(project.scenes?.some(scene => scene.id === sceneId), 'DCC_RETURN_SCENE_MISSING', 409);
  return project;
}
function folder(store, name, create = false) {
  let target = store.directory;
  for (const part of ['integrations', name]) {
    target = path.join(target, part);
    if (!fs.existsSync(target)) {
      if (!create) return null;
      fs.mkdirSync(target, { mode: 0o700 });
    }
    const stat = fs.lstatSync(target);
    check(stat.isDirectory() && !stat.isSymbolicLink(), 'DCC_RETURN_STORAGE_DIRECTORY_INVALID', 409);
  }
  return target;
}
function readJson(filename, maxBytes) {
  const stat = fs.lstatSync(filename);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= maxBytes, 'DCC_RETURN_SIDECAR_INVALID', 409);
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(filename))); }
  catch { check(false, 'DCC_RETURN_SIDECAR_INVALID', 409); }
  return parsed;
}
function immutable(filename, bytes) {
  if (fs.existsSync(filename)) {
    const stat = fs.lstatSync(filename);
    check(stat.isFile() && !stat.isSymbolicLink() && fs.readFileSync(filename).equals(bytes), 'DCC_RETURN_RETENTION_CONFLICT', 409);
    return true;
  }
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    const fd = fs.openSync(temporary, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    // A hard link publishes atomically and never overwrites another return.
    try { fs.linkSync(temporary, filename); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stat = fs.lstatSync(filename);
      check(stat.isFile() && !stat.isSymbolicLink() && fs.readFileSync(filename).equals(bytes), 'DCC_RETURN_RETENTION_CONFLICT', 409);
      return true;
    }
    return false;
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function retainedKit(store, key) {
  check(digest(key), 'DCC_RETURN_KIT_REFERENCE_INVALID', 422);
  const directory = folder(store, 'dcc-stage-kits');
  const filename = directory && path.join(directory, `${key}.json`);
  check(filename && fs.existsSync(filename), 'DCC_RETURN_RETAINED_KIT_MISSING', 409);
  const saved = readJson(filename, 64 * 1024 * 1024);
  check(object(saved) && Object.keys(saved).sort().join(',') === 'body,sha256' && digest(saved.sha256) && sha256(canonical(saved.body)) === saved.sha256, 'DCC_RETURN_RETAINED_KIT_INVALID', 409);
  const { body } = saved;
  check(body.schemaVersion === 'caniscreenwrite-retained-dcc-kit/v1' && body.kitFilesSha256 === key && body.snapshotScope === 'DCC_EXCHANGE_DEPENDENCIES'
    && sha256(canonical(body.snapshot)) === body.snapshotSha256 && body.kit?.files?.find(file => file.path === 'files.json')?.sha256 === key, 'DCC_RETURN_RETAINED_KIT_INVALID', 409);
  scope(store, body.kit.projectId, body.kit.sourceHash, body.kit.sceneId);
  return body;
}

/** Called on the actual locally built export before returning it to the user. */
export function retainDccStageKit(store, kit) {
  check(object(kit) && digest(kit.sha256) && Array.isArray(kit.files), 'DCC_RETURN_KIT_INVALID', 422);
  scope(store, kit.projectId, kit.sourceHash, kit.sceneId);
  const manifest = kit.files.find(file => file.path === 'files.json');
  check(manifest && digest(manifest.sha256) && sha256(manifest.content) === manifest.sha256, 'DCC_RETURN_KIT_INVALID', 422);
  const existingDirectory = folder(store, 'dcc-stage-kits');
  if (existingDirectory && fs.existsSync(path.join(existingDirectory, `${manifest.sha256}.json`))) {
    check(same(retainedKit(store, manifest.sha256).kit, kit), 'DCC_RETURN_RETENTION_CONFLICT', 409);
    return kit;
  }
  const snapshot = snapshotFor(store, kit.sceneId), file = kit.files.find(item => item.path === 'stage-plan.json');
  check(file && typeof file.content === 'string', 'DCC_RETURN_KIT_INVALID', 422);
  let plan; try { plan = JSON.parse(file.content); } catch { check(false, 'DCC_RETURN_KIT_INVALID', 422); }
  const settings = plan.cameraTemplate;
  check(object(settings), 'DCC_RETURN_KIT_INVALID', 422);
  const rebuilt = buildDccStageKit(snapshot, { sceneId: kit.sceneId, expectedSourceHash: kit.sourceHash, expectedBasisHash: kit.basisSha256,
    shotId: kit.shotId, target: kit.target, lensMm: settings.lensMm, durationSeconds: settings.durationSeconds, motion: settings.motion, travelMm: settings.travelMm, blockingNotes: plan.blockingNotes,
    ...(Object.hasOwn(plan, 'previz') ? { previz: plan.previz } : {}) });
  check(same(rebuilt, kit), 'DCC_RETURN_KIT_NOT_CURRENT_EXPORT', 409);
  const body = { schemaVersion: 'caniscreenwrite-retained-dcc-kit/v1', kitFilesSha256: manifest.sha256,
    snapshotScope: 'DCC_EXCHANGE_DEPENDENCIES', snapshotSha256: sha256(canonical(snapshot)), snapshot, kit };
  const bytes = Buffer.from(canonical({ body, sha256: sha256(canonical(body)) }));
  check(bytes.length <= 64 * 1024 * 1024, 'DCC_RETURN_RETAINED_KIT_TOO_LARGE', 413);
  immutable(path.join(folder(store, 'dcc-stage-kits', true), `${manifest.sha256}.json`), bytes);
  return kit;
}

function projection(verified) {
  return { id: `dcc-stage-return:${verified.receiptSha256}`, receiptSha256: verified.receiptSha256,
    kitSha256: verified.kitSha256, kitFilesSha256: verified.kitFilesSha256, origin: verified.origin,
    application: verified.receipt.application, artifacts: [...verified.artifacts].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0), frames: verified.frames,
    status: 'PENDING_REVIEW', scope: verified.scope, association: verified.association,
    executionVerified: false, reopenedVerified: false, measuredMediaDurationMs: null, rightsStatus: 'UNKNOWN', approvalGranted: false, finalMedia: false };
}
function currentBasis(store, origin) {
  try {
    const exchange = buildCameraExchange(snapshotFor(store, origin.sceneId), { sceneId: origin.sceneId, expectedSourceHash: origin.sourceHash });
    const current = exchange.basis.sha256;
    return { status: current === origin.basisSha256 ? 'CURRENT' : 'STALE', currentBasisSha256: current,
      reason: current === origin.basisSha256 ? 'EXACT_CURRENT_SCENE_BASIS' : 'SCENE_INPUTS_CHANGED' };
  } catch { return { status: 'STALE', currentBasisSha256: null, reason: 'CURRENT_SCENE_BASIS_UNAVAILABLE' }; }
}
function present(store, value) {
  return { ...value, artifacts: value.artifacts.map(item => ({ ...item, url: `/api/blobs/${item.sha256}` })),
    frames: value.frames.map(frame => ({ ...frame, url: `/api/blobs/${frame.imageHash}` })), basis: currentBasis(store, value.origin) };
}
function verifySavedReturn(store, receiptSha256) {
  const directory = folder(store, 'dcc-stage-returns');
  check(directory && digest(receiptSha256), 'DCC_RETURN_SIDECAR_INVALID', 409);
  const saved = readJson(path.join(directory, `${receiptSha256}.json`), 1024 * 1024);
  check(object(saved) && Object.keys(saved).sort().join(',') === 'body,sha256' && digest(saved.sha256) && sha256(canonical(saved.body)) === saved.sha256, 'DCC_RETURN_SIDECAR_INVALID', 409);
  const value = saved.body;
  check(value.receiptSha256 === receiptSha256 && Array.isArray(value.artifacts) && value.artifacts.length >= 6 && value.artifacts.length <= 24, 'DCC_RETURN_SIDECAR_INVALID', 409);
  scope(store, value.origin?.projectId, value.origin?.sourceHash, value.origin?.sceneId);
  const retained = retainedKit(store, value.kitFilesSha256), files = Object.create(null);
  let total = 0;
  for (const asset of value.artifacts) {
    check(basename(asset.name) && !Object.hasOwn(files, asset.name) && digest(asset.sha256) && Number.isSafeInteger(asset.byteLength) && asset.byteLength > 0, 'DCC_RETURN_SIDECAR_INVALID', 409);
    total += asset.byteLength; check(total <= DCC_STAGE_RETURN_UPLOAD_MAX_BYTES, 'DCC_RETURN_SIZE_INVALID', 413);
    const info = store.blobInfo(asset.sha256);
    check(info.byteLength === asset.byteLength && info.mimeType === asset.mimeType, 'DCC_RETURN_BLOB_MISMATCH', 409);
    files[asset.name] = fs.readFileSync(info.filename);
  }
  const verified = verifyDccStageReturnFiles(files, { expectedKit: retained.kit, snapshot: retained.snapshot });
  check(same(projection(verified), value), 'DCC_RETURN_PROJECTION_MISMATCH', 409);
  return value;
}

export function importDccStageReturn(store, input) {
  check(object(input) && Object.keys(input).sort().join(',') === 'files,sceneId' && typeof input.sceneId === 'string' && Array.isArray(input.files) && input.files.length >= 6 && input.files.length <= 24, 'DCC_RETURN_IMPORT_INVALID', 422);
  const project = store.project(); scope(store, project?.id, project?.sourceHash, input.sceneId);
  const files = Object.create(null); let total = 0;
  for (const part of input.files) {
    check(object(part) && Object.keys(part).sort().join(',') === 'base64,name' && basename(part.name) && !Object.hasOwn(files, part.name)
      && typeof part.base64 === 'string' && part.base64.length <= Math.ceil(DCC_STAGE_RETURN_UPLOAD_MAX_BYTES / 3) * 4
      && part.base64.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(part.base64), 'DCC_RETURN_IMPORT_FILE_INVALID', 422);
    const bytes = Buffer.from(part.base64, 'base64'); total += bytes.length;
    check(bytes.length > 0 && total <= DCC_STAGE_RETURN_UPLOAD_MAX_BYTES && bytes.toString('base64') === part.base64, 'DCC_RETURN_IMPORT_SIZE_OR_ENCODING', 413);
    files[part.name] = bytes;
  }
  check(files['stage-return.json']?.length <= 1024 * 1024, 'DCC_RETURN_RECEIPT_REQUIRED', 422);
  let receipt; try { receipt = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files['stage-return.json'])); } catch { check(false, 'DCC_RETURN_RECEIPT_INVALID', 422); }
  check(receipt?.origin?.sceneId === input.sceneId, 'DCC_RETURN_SELECTED_SCENE_MISMATCH', 409);
  const retained = retainedKit(store, receipt?.kitFilesSha256);
  const verified = verifyDccStageReturnFiles(files, { expectedKit: retained.kit, snapshot: retained.snapshot });
  scope(store, verified.origin.projectId, verified.origin.sourceHash, verified.origin.sceneId);
  const value = projection(verified), directory = folder(store, 'dcc-stage-returns');
  if (directory && fs.existsSync(path.join(directory, `${value.receiptSha256}.json`))) {
    check(same(verifySavedReturn(store, value.receiptSha256), value), 'DCC_RETURN_RETENTION_CONFLICT', 409);
    return { schemaVersion, projectId: value.origin.projectId, sourceHash: value.origin.sourceHash, sceneId: value.origin.sceneId, maxUploadBytes: DCC_STAGE_RETURN_UPLOAD_MAX_BYTES, return: present(store, value), replayed: true };
  }
  // Observation floats stay in their original JSON blob. Only integer/hash
  // summaries enter the immutable sidecar; no camera approval record is created.
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'caniscreenwrite-dcc-return-'));
  try {
    for (const asset of value.artifacts) {
      const filename = path.join(temporary, asset.name); fs.writeFileSync(filename, files[asset.name], { flag: 'wx', mode: 0o600 });
      store.putBlob(filename, asset.mimeType, { sha256: asset.sha256, byteLength: asset.byteLength, maxBytes: DCC_STAGE_RETURN_UPLOAD_MAX_BYTES });
      const info = store.blobInfo(asset.sha256); check(info.mimeType === asset.mimeType && info.byteLength === asset.byteLength, 'DCC_RETURN_BLOB_MISMATCH', 409);
    }
    const replayed = immutable(path.join(folder(store, 'dcc-stage-returns', true), `${value.receiptSha256}.json`), Buffer.from(canonical({ body: value, sha256: sha256(canonical(value)) })));
    return { schemaVersion, projectId: value.origin.projectId, sourceHash: value.origin.sourceHash, sceneId: value.origin.sceneId, maxUploadBytes: DCC_STAGE_RETURN_UPLOAD_MAX_BYTES, return: present(store, value), replayed };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

/** One verified pass for read-only project-wide file catalogs. No asset records are created. */
export function listProjectDccStageReturns(store) {
  const directory = folder(store, 'dcc-stage-returns'), values = [];
  const names = directory ? fs.readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort() : [];
  check(names.length <= 1000, 'DCC_RETURN_HISTORY_TOO_LARGE', 413);
  for (const name of names) {
    const value = verifySavedReturn(store, name.slice(0, -5));
    values.push(present(store, value));
  }
  return values;
}

export function listDccStageReturns(store, sceneId) {
  const project = store.project(); scope(store, project?.id, project?.sourceHash, sceneId);
  const values = listProjectDccStageReturns(store).filter(value => value.origin.sceneId === sceneId);
  return { schemaVersion, projectId: project.id, sourceHash: project.sourceHash, sceneId, maxUploadBytes: DCC_STAGE_RETURN_UPLOAD_MAX_BYTES, returns: values };
}

/** Read-only, verified input for an owned render. Always loads the actual
 * returned scene (including an imported edited scene), never a generic job. */
export function loadDccStageReturnForMotion(store, input, { requireCurrent = true } = {}) {
  scope(store, input.projectId, input.sourceHash, input.sceneId);
  check(digest(input.returnReceiptSha256), 'DCC_MOTION_RETURN_REQUIRED', 422);
  const value = verifySavedReturn(store, input.returnReceiptSha256);
  check(value.origin.target === 'BLENDER' && value.application.name === 'Blender', 'DCC_MOTION_BLENDER_RETURN_REQUIRED', 422);
  check(value.origin.projectId === input.projectId && value.origin.sourceHash === input.sourceHash
    && value.origin.sceneId === input.sceneId && value.origin.shotId === input.shotId, 'DCC_MOTION_RETURN_SCOPE_MISMATCH', 409);
  if (requireCurrent) check(currentBasis(store, value.origin).status === 'CURRENT', 'DCC_MOTION_BASIS_STALE', 409);
  const retained = retainedKit(store, value.kitFilesSha256);
  const receipt = JSON.parse(store.blob(value.receiptSha256).bytes.toString('utf8'));
  const scene = value.artifacts.find(asset => asset.name === receipt.sceneFile.path && asset.sha256 === receipt.sceneFile.sha256);
  check(scene && scene.name.endsWith('.blend'), 'DCC_MOTION_SCENE_MISSING', 409);
  const observation = JSON.parse(store.blob(receipt.observation.sha256).bytes.toString('utf8'));
  return { returned: value, kit: retained.kit, sceneFile: { ...scene, filename: store.blobInfo(scene.sha256).filename }, observation };
}

const candidateCellId = (receiptSha256, frameId) => `dcc-return:${receiptSha256}:${sha256(frameId).slice(0, 16)}`;
const mappingFields = ['sourceHash', 'cellId', 'sceneId', 'shotId', 'role', 'imageHash', 'crop', 'pixelWidth', 'pixelHeight', 'actionRefs', 'originDccReturnRef'];
function sameMapping(a, b) { return mappingFields.every(key => same(a?.[key], b?.[key])); }
function frameMapping(store, data, value) {
  const ref = validateDccReturnOriginRef(data.originDccReturnRef);
  check(!data.originCameraRef && value.receiptSha256 === ref.receiptSha256 && value.kitFilesSha256 === ref.kitFilesSha256,
    'DCC_RETURN_CELL_ORIGIN_MISMATCH', 409);
  scope(store, value.origin.projectId, data.sourceHash, data.sceneId);
  store.blobInfo(data.sourceHash);
  const frame = value.frames.find(item => item.id === ref.frameId);
  check(frame && value.origin.sourceHash === data.sourceHash && value.origin.sceneId === data.sceneId
    && value.origin.shotId === data.shotId && frame.shotId === data.shotId, 'DCC_RETURN_CELL_FRAME_MISMATCH', 409);
  check(data.cellId === candidateCellId(ref.receiptSha256, ref.frameId) && data.imageHash === frame.imageHash && data.crop === null
    && data.pixelWidth === frame.widthPixels && data.pixelHeight === frame.heightPixels && data.review === 'PENDING', 'DCC_RETURN_CELL_IMAGE_MISMATCH', 409);
  const scene = store.project().scenes.find(item => item.id === data.sceneId);
  check(['START', 'MOMENT', 'END'].includes(data.role), 'DCC_RETURN_CELL_ROLE_INVALID', 422);
  check(data.role !== 'START' || frame.role === 'OPENING' && scene.shots[0].id === data.shotId, 'DCC_RETURN_SCENE_OPENING_MISMATCH', 409);
  check(data.role !== 'END' || frame.role === 'ENDING', 'DCC_RETURN_END_FRAME_MISMATCH', 409);
  const paragraphs = [...scene.paragraphs, ...(store.project().prologue ?? [])];
  check(Array.isArray(data.actionRefs) && data.actionRefs.length <= 1000 && new Set(data.actionRefs).size === data.actionRefs.length
    && data.actionRefs.every(id => paragraphs.some(item => item.id === id)), 'DCC_RETURN_ACTION_REFS_INVALID', 422);
  return frame;
}

// Adding one candidate must not prevent adding its sibling returned frame. Only
// exact, unedited v1 candidate additions from this same retained kit are removed
// for this comparison. Any other edit or record change still stales the return.
function requireAdoptionBasis(store, value) {
  const retained = retainedKit(store, value.kitFilesSha256), snapshot = snapshotFor(store, value.origin.sceneId);
  const originalCellIds = new Set(retained.snapshot.project.cells.map(cell => cell.id));
  const originalRecordIds = new Set(retained.snapshot.records.map(record => record.id));
  const excluded = new Set(), returned = new Map([[value.receiptSha256, value]]);
  for (const record of snapshot.records) {
    const ref = record.data?.originDccReturnRef;
    if (record.kind !== 'storyboard-cell' || record.version !== 1 || ref?.kitFilesSha256 !== value.kitFilesSha256
      || originalCellIds.has(record.data.cellId) || originalRecordIds.has(record.id)) continue;
    check(record.id === `storyboard-cell:${record.data.cellId}` && sha256(canonical(record.data)) === record.sha256, 'DCC_RETURN_ADOPTION_HISTORY_INVALID', 409);
    const history = store.history(record.id);
    check(history.length === 1 && same(history[0], record), 'DCC_RETURN_ADOPTION_HISTORY_INVALID', 409);
    if (!returned.has(ref.receiptSha256)) returned.set(ref.receiptSha256, verifySavedReturn(store, ref.receiptSha256));
    frameMapping(store, record.data, returned.get(ref.receiptSha256));
    excluded.add(record.id);
  }
  const excludedCells = new Set(snapshot.records.filter(record => excluded.has(record.id)).map(record => record.data.cellId));
  snapshot.records = snapshot.records.filter(record => !excluded.has(record.id));
  snapshot.project.cells = snapshot.project.cells.filter(cell => !excludedCells.has(cell.id));
  let exchange;
  try { exchange = buildCameraExchange(snapshot, { sceneId: value.origin.sceneId, expectedSourceHash: value.origin.sourceHash }); }
  catch { check(false, 'DCC_RETURN_ADOPTION_BASIS_STALE', 409); }
  check(exchange.basis.sha256 === value.origin.basisSha256, 'DCC_RETURN_ADOPTION_BASIS_STALE', 409);
}

/** Storage calls this inside its save transaction and while validating history. */
export function validateDccReturnCellReferences(store, kind, data, { newWrite = false, previous = null } = {}) {
  if (kind !== 'storyboard-cell') return;
  const prior = previous?.data;
  if (prior?.originDccReturnRef) check(sameMapping(prior, data), 'DCC_RETURN_CELL_ORIGIN_IMMUTABLE', 409);
  if (!data.originDccReturnRef) return;
  const ref = validateDccReturnOriginRef(data.originDccReturnRef), value = verifySavedReturn(store, ref.receiptSha256);
  frameMapping(store, data, value);
  if (newWrite && !prior?.originDccReturnRef) {
    check(!prior && !store.project().cells?.some(cell => cell.id === data.cellId), 'DCC_RETURN_CANDIDATE_CELL_EXISTS', 409);
    requireAdoptionBasis(store, value);
  }
}

/** Explicit owner selection creates a new pending candidate in the existing store. */
export function adoptDccStageReturnFrame(store, input) {
  const keys = ['projectId', 'sourceHash', 'sceneId', 'shotId', 'receiptSha256', 'frameId', 'role', 'description', 'actionRefs', 'plannedTimestampMs', 'requestId'];
  check(object(input) && Object.keys(input).sort().join(',') === keys.sort().join(','), 'DCC_RETURN_ADOPTION_INPUT_INVALID', 422);
  scope(store, input.projectId, input.sourceHash, input.sceneId);
  check(digest(input.receiptSha256) && typeof input.requestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(input.requestId), 'DCC_RETURN_ADOPTION_INPUT_INVALID', 422);
  check(typeof input.description === 'string' && input.description.trim().length > 0 && input.description.length <= 8000
    && input.description.isWellFormed() && !input.description.includes('\0'), 'DCC_RETURN_ADOPTION_DESCRIPTION_INVALID', 422);
  check(input.plannedTimestampMs === null || Number.isSafeInteger(input.plannedTimestampMs) && input.plannedTimestampMs >= 0 && input.plannedTimestampMs <= 86400000,
    'DCC_RETURN_ADOPTION_TIMESTAMP_INVALID', 422);
  const value = verifySavedReturn(store, input.receiptSha256);
  check(value.origin.sceneId === input.sceneId && value.origin.shotId === input.shotId, 'DCC_RETURN_ADOPTION_TARGET_MISMATCH', 409);
  const frame = value.frames.find(item => item.id === input.frameId);
  check(frame, 'DCC_RETURN_ADOPTION_FRAME_MISSING', 404);
  const data = { sourceHash: input.sourceHash, cellId: candidateCellId(input.receiptSha256, input.frameId), sceneId: input.sceneId, shotId: input.shotId,
    role: input.role, imageHash: frame.imageHash, crop: null, pixelWidth: frame.widthPixels, pixelHeight: frame.heightPixels,
    description: input.description, actionRefs: input.actionRefs, plannedTimestampMs: input.plannedTimestampMs, review: 'PENDING',
    originDccReturnRef: { receiptSha256: value.receiptSha256, kitFilesSha256: value.kitFilesSha256, frameId: frame.id } };
  frameMapping(store, data, value);
  check(typeof store.saveDccReturnStoryboardCell === 'function', 'DCC_RETURN_ADOPTION_STORAGE_UNAVAILABLE', 503);
  // Storage resolves the exact request retry before testing the current basis.
  const record = store.saveDccReturnStoryboardCell(`storyboard-cell:${data.cellId}`, { kind: 'storyboard-cell', expectedVersion: null, requestId: input.requestId, data });
  return { schemaVersion: 'caniscreenwrite-dcc-frame-adoption/v1', projectId: input.projectId, sourceHash: input.sourceHash,
    sceneId: input.sceneId, shotId: input.shotId, receiptSha256: value.receiptSha256, frameId: frame.id,
    initialFrameEligible: frame.role === 'OPENING', scope: 'INTERNAL_STORYBOARD_CANDIDATE', rightsStatus: 'UNKNOWN', approvalGranted: false, record };
}

/** Carries exact origins through generation preparation without granting film use. */
export function dccReturnEvidenceForCells(store, cellIds, { initialFrameCellId = null } = {}) {
  check(Array.isArray(cellIds) && cellIds.length <= 400, 'DCC_RETURN_CELL_SELECTION_INVALID', 422);
  const project = store.resolvedProject(), entries = new Map();
  for (const cellId of cellIds) {
    const cell = project.cells.find(item => item.id === cellId);
    check(cell, 'DCC_RETURN_SELECTED_CELL_MISSING', 409);
    if (!cell.originDccReturnRef) continue;
    const data = { ...cell, sourceHash: project.sourceHash, cellId: cell.id }, ref = cell.originDccReturnRef;
    const value = entries.get(ref.receiptSha256)?.value ?? verifySavedReturn(store, ref.receiptSha256);
    const frame = frameMapping(store, data, value);
    if (cell.id === initialFrameCellId) check(frame.role === 'OPENING', 'DCC_RETURN_LATER_FRAME_CANNOT_OPEN_CLIP', 409);
    if (!entries.has(ref.receiptSha256)) entries.set(ref.receiptSha256, { value, cellIds: [], frames: [] });
    const entry = entries.get(ref.receiptSha256);
    entry.cellIds.push(cell.id);
    entry.frames.push({ cellId: cell.id, frameId: frame.id, originReturnRole: frame.role, imageHash: frame.imageHash,
      widthPixels: frame.widthPixels, heightPixels: frame.heightPixels, frame: frame.frame,
      storyboardRole: cell.role, actionRefs: [...cell.actionRefs], plannedTimestampMs: cell.plannedTimestampMs ?? null });
  }
  return [...entries.values()].map(({ value, cellIds, frames }) => ({ receiptSha256: value.receiptSha256, kitFilesSha256: value.kitFilesSha256,
    origin: value.origin, cellIds, frames, scope: value.scope, rightsStatus: 'UNKNOWN', approvalGranted: false,
    artifacts: value.artifacts.map(artifact => ({ ...artifact })) }));
}
