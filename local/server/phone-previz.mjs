import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonical as sourceCanonical, check, sha256 } from './storage.mjs';
import { canonicalPhonePreviz as canonical, validatePhonePrevizArtifact, PHONE_PREVIZ_MAX_BYTES } from '../contracts/phone-previz.mjs';
export { PHONE_PREVIZ_MAX_BYTES };
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const schema = 'qimovi-phone-previz-receipt/v1';
function shape(value, fields) { check(object(value) && Object.keys(value).sort().join(',') === fields.sort().join(','), 'PHONE_PREVIZ_INPUT_INVALID', 422); }
function directory(parent, name, create = false) {
  const target = path.join(parent, name);
  let stat;
  try { stat = fs.lstatSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; if (!create) return null; fs.mkdirSync(target, { mode: 0o700 }); stat = fs.lstatSync(target); }
  check(stat.isDirectory() && !stat.isSymbolicLink(), 'PHONE_PREVIZ_DIRECTORY_INVALID', 409);
  return target;
}
function read(filename, maximum) {
  const stat = fs.lstatSync(filename);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= maximum, 'PHONE_PREVIZ_FILE_INVALID', 409);
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const current = fs.fstatSync(fd);
    check(current.isFile() && current.dev === stat.dev && current.ino === stat.ino && current.size <= maximum, 'PHONE_PREVIZ_FILE_CHANGED', 409);
    const bytes = fs.readFileSync(fd);
    check(bytes.length <= maximum, 'PHONE_PREVIZ_FILE_INVALID', 409);
    return { bytes, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  } finally { fs.closeSync(fd); }
}
function summary(value) {
  return value.schemaVersion === 'qimovi-phone-rotation/v1'
    ? { kind: 'ROTATION', artifactId: value.id, label: value.shotTitle || value.shotId, recordedAt: value.recordedAt, durationSeconds: value.durationSeconds, sampleCount: value.samples.length, clapperCount: value.clapperMarks?.length ?? 0 }
    : { kind: 'CLAPPER', artifactId: value.id, label: value.shotTitle || value.shotId, recordedAt: value.markedAt, takeNumber: value.takeNumber, roll: value.roll, camera: value.camera, soundMode: value.soundMode, slatePosition: value.slatePosition, purpose: value.purpose, frameRate: value.frameRate, notes: value.notes, recordingId: value.recordingId ?? null, recordingTimeSeconds: value.recordingTimeSeconds ?? null };
}
export function createPhonePrevizService(store) {
  function folder(create = false) { const integrations = directory(store.directory, 'integrations', create); return integrations ? directory(integrations, 'phone-previz', create) : null; }
  function scope(sceneId, shotId) {
    check(id(sceneId) && id(shotId), 'PHONE_PREVIZ_SCOPE_INVALID', 422);
    const project = store.resolvedProject(), scenes = project?.scenes?.filter(item => item.id === sceneId), shots = scenes?.[0]?.shots?.filter(item => item.id === shotId);
    check(project && hash(project.sourceHash) && scenes?.length === 1 && shots?.length === 1, 'PHONE_PREVIZ_SHOT_UNAVAILABLE', 409);
    const shot = shots[0];
    return { projectId: project.id, sourceHash: project.sourceHash, sceneId, shotId, shotSourceHash: shot.shotHash ?? sha256(sourceCanonical(shot)) };
  }
  function preview(input) {
    shape(input, ['sceneId', 'shotId', 'artifact']); validatePhonePrevizArtifact(input.artifact);
    const binding = scope(input.sceneId, input.shotId), artifact = input.artifact;
    const mismatch = artifact.projectId !== binding.projectId ? 'This file belongs to another film.' : artifact.sourceHash !== binding.sourceHash ? 'The screenplay source does not match the current film.' : artifact.sceneId !== binding.sceneId || artifact.shotId !== binding.shotId ? 'The scene or shot does not match the selected shot.' : artifact.shotSourceHash != null && artifact.shotSourceHash !== binding.shotSourceHash ? 'The shot changed after the phone snapshot.' : null;
    const warnings = ['Retaining this file stores a planning reference. It does not create accepted media, synchronize sound or execute a camera in Blender or Unity.'];
    if (artifact.shotSourceHash == null) warnings.push('This older phone export has no shot revision hash. Only its film, screenplay, scene and shot identifiers can be matched.');
    if (artifact.schemaVersion === 'qimovi-phone-rotation/v1') warnings.push('Orientation only: position, lens and calibrated DCC coordinates are not captured.');
    else warnings.push('The slate uses the phone wall clock. Its mark is not synchronized production timecode or proof of a recorded take.');
    const body = { schemaVersion: 'qimovi-phone-previz-preview/v1', ...binding, artifactSha256: sha256(canonical(artifact)), status: mismatch ? 'MISMATCH' : 'READY', reason: mismatch ?? 'The file matches this shot and can be retained after review.', summary: summary(artifact), warnings };
    return { ...body, previewSha256: sha256(canonical(body)) };
  }
  function verify(root, receiptId) {
    check(hash(receiptId), 'PHONE_PREVIZ_RECEIPT_INVALID', 409);
    const target = directory(root, receiptId), saved = read(path.join(target, 'receipt.json'), 32 * 1024).value;
    const { sha256: digest, ...body } = saved;
    check(saved.schemaVersion === schema && saved.id === receiptId && saved.approvalGranted === false && saved.desktopPlaybackReady === false && saved.finalMedia === false && hash(saved.artifactSha256) && hash(saved.shotSourceHash) && hash(saved.sourceHash) && id(saved.projectId) && id(saved.sceneId) && id(saved.shotId) && hash(digest) && sha256(canonical(body)) === digest, 'PHONE_PREVIZ_RECEIPT_INVALID', 409);
    const artifact = read(path.join(target, 'artifact.json'), PHONE_PREVIZ_MAX_BYTES); validatePhonePrevizArtifact(artifact.value);
    check(sha256(artifact.bytes) === saved.artifactSha256 && artifact.value.projectId === saved.projectId && artifact.value.sourceHash === saved.sourceHash && artifact.value.sceneId === saved.sceneId && artifact.value.shotId === saved.shotId && (artifact.value.shotSourceHash == null || artifact.value.shotSourceHash === saved.shotSourceHash) && canonical(summary(artifact.value)) === canonical(saved.summary), 'PHONE_PREVIZ_ARTIFACT_CHANGED', 409);
    const binding = { projectId: saved.projectId, sourceHash: saved.sourceHash, sceneId: saved.sceneId, shotId: saved.shotId, shotSourceHash: saved.shotSourceHash };
    check(receiptId === sha256(canonical({ binding, artifactSha256: saved.artifactSha256 })), 'PHONE_PREVIZ_RECEIPT_INVALID', 409);
    return saved;
  }
  function entries(root) {
    const names = fs.readdirSync(root);
    check(names.length <= 250 && names.every(name => hash(name) || /^\.pending-[a-f0-9-]{36}$/.test(name)), 'PHONE_PREVIZ_STORAGE_LIMIT', 409);
    return names.filter(hash);
  }
  function list(input) {
    shape(input, ['sceneId', 'shotId']); const binding = scope(input.sceneId, input.shotId), root = folder();
    const receipts = root ? entries(root).map(key => verify(root, key)).filter(receipt => Object.entries(binding).every(([key, value]) => receipt[key] === value)).sort((a, b) => b.retainedAt.localeCompare(a.retainedAt)) : [];
    return { schemaVersion: 'qimovi-phone-previz-list/v1', ...binding, receipts };
  }
  function retain(input) {
    shape(input, ['sceneId', 'shotId', 'artifact', 'previewSha256']); check(hash(input.previewSha256), 'PHONE_PREVIZ_PREVIEW_INVALID', 422);
    const result = preview({ sceneId: input.sceneId, shotId: input.shotId, artifact: input.artifact });
    check(result.status === 'READY', 'PHONE_PREVIZ_BINDING_MISMATCH', 409);
    check(result.previewSha256 === input.previewSha256, 'PHONE_PREVIZ_PREVIEW_STALE', 409);
    const binding = scope(input.sceneId, input.shotId), receiptId = sha256(canonical({ binding, artifactSha256: result.artifactSha256 }));
    let root = folder();
    if (root && entries(root).includes(receiptId)) return { status: 'RETAINED', replayed: true, receipt: verify(root, receiptId) };
    if (root) check(entries(root).length < 200, 'PHONE_PREVIZ_STORAGE_LIMIT', 409);
    root = folder(true);
    const pending = directory(root, `.pending-${crypto.randomUUID()}`, true), target = path.join(root, receiptId);
    try {
      const body = { schemaVersion: schema, id: receiptId, ...binding, artifactSha256: result.artifactSha256, summary: result.summary, retainedAt: new Date().toISOString(), approvalGranted: false, desktopPlaybackReady: false, finalMedia: false };
      const receipt = { ...body, sha256: sha256(canonical(body)) };
      fs.writeFileSync(path.join(pending, 'artifact.json'), canonical(input.artifact), { flag: 'wx', mode: 0o600 });
      fs.writeFileSync(path.join(pending, 'receipt.json'), canonical(receipt), { flag: 'wx', mode: 0o600 });
      // Synchronous filesystem writes cannot interleave another service request.
      check(!fs.existsSync(target), 'PHONE_PREVIZ_RECEIPT_CONFLICT', 409);
      fs.renameSync(pending, target);
      return { status: 'RETAINED', replayed: false, receipt: verify(root, receiptId) };
    } finally {
      // Only remove this operation's two known files, never an arbitrary tree.
      if (fs.existsSync(pending) && !fs.lstatSync(pending).isSymbolicLink()) {
        for (const name of ['artifact.json', 'receipt.json']) { try { fs.unlinkSync(path.join(pending, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
        fs.rmdirSync(pending);
      }
    }
  }
  return { list, preview, retain };
}
