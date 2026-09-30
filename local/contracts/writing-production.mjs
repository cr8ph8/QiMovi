import { isCreativeProject, validateCreativeProject } from './creative-project.mjs';
import { validateCreativeScreenplayDraft } from './creative-screenplay.mjs';
import { buildScreenplayIndex } from './screenplay-index.mjs';
import { listWritingSceneIdentities, WRITING_SCENE_LIMIT } from './writing-scene-map.mjs';
import { canonicalJson } from '../kernel/src/canonical-json-core.mjs';

export const WRITING_PRODUCTION_KIND = 'writing-production-plan';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (condition, code, status = 422) => { if (!condition) throw Object.assign(new Error(code), { code, status }); };
const exact = (value, fields) => object(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(',');
const identity = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = (value, max, empty = true) => typeof value === 'string' && value.length <= max && value.isWellFormed() && !value.includes('\0') && (empty || value.trim().length > 0);
const sourceSceneFields = ['sceneId', 'ordinal', 'heading', 'start', 'end', 'textSha256', 'characters'];
const characters = value => Array.isArray(value) && value.length <= 500 && value.every(name => text(name, 200, false)) && new Set(value).size === value.length;

export function validateWritingProductionDraftRef(ref) {
  need(exact(ref, ['id', 'version', 'sha256']) && identity(ref.id) && ref.id.startsWith('screenplay-draft:') && Number.isSafeInteger(ref.version) && ref.version > 0 && ref.version < 2147483647 && digest(ref.sha256), 'WRITING_PRODUCTION_DRAFT_REF_INVALID');
  return ref;
}

export function validateWritingProductionRequest(operation, input) {
  const fields = operation === 'preview' ? ['projectId', 'draftRef'] : operation === 'handoff' ? ['projectId', 'draftRef', 'previewSha256', 'requestId'] : ['projectId', 'planId', 'expectedVersion', 'requestId', 'scenes'];
  need(['preview', 'handoff', 'save'].includes(operation) && exact(input, fields) && identity(input.projectId), 'WRITING_PRODUCTION_INPUT_INVALID');
  if (operation !== 'save') validateWritingProductionDraftRef(input.draftRef);
  if (operation === 'handoff') need(digest(input.previewSha256), 'WRITING_PRODUCTION_PREVIEW_INVALID');
  if (operation !== 'preview') need(identity(input.requestId), 'WRITING_PRODUCTION_REQUEST_ID_INVALID');
  if (operation === 'save') {
    need(typeof input.planId === 'string' && /^writing-production-plan:[a-f0-9]{64}$/.test(input.planId) && Number.isSafeInteger(input.expectedVersion) && input.expectedVersion > 0 && input.expectedVersion < 2147483647, 'WRITING_PRODUCTION_PLAN_REF_INVALID');
    validateWritingProductionEdits(input.scenes);
  }
  return input;
}

export function validateWritingProductionEdits(scenes) {
  need(Array.isArray(scenes) && scenes.length > 0 && scenes.length <= WRITING_SCENE_LIMIT, 'WRITING_PRODUCTION_SCENES_INVALID');
  const sceneIds = new Set(), shotIds = new Set();
  for (const scene of scenes) {
    need(exact(scene, ['sceneId', 'notes', 'shots']) && identity(scene.sceneId) && !sceneIds.has(scene.sceneId) && text(scene.notes, 10000) && Array.isArray(scene.shots) && scene.shots.length <= 100, 'WRITING_PRODUCTION_SCENE_EDIT_INVALID');
    sceneIds.add(scene.sceneId);
    for (const shot of scene.shots) {
      need(exact(shot, ['id', 'title', 'description', 'shotType', 'cameraMovement', 'durationSeconds']) && identity(shot.id) && !shotIds.has(shot.id) && text(shot.title, 200, false) && text(shot.description, 10000) && text(shot.shotType, 120) && text(shot.cameraMovement, 200) && (shot.durationSeconds === null || Number.isSafeInteger(shot.durationSeconds) && shot.durationSeconds > 0 && shot.durationSeconds <= 3600), 'WRITING_PRODUCTION_SHOT_INVALID');
      shotIds.add(shot.id);
    }
    need(shotIds.size <= 1000, 'WRITING_PRODUCTION_SHOT_LIMIT');
  }
  return scenes;
}

/** Derived only from retained text. This is a planning basis, never source or rights admission. */
export function buildWritingProductionBasis(project, draft, hash) {
  validateCreativeProject(project); validateCreativeScreenplayDraft(draft.data, project);
  validateWritingProductionDraftRef({ id: draft.id, version: draft.version, sha256: draft.sha256 });
  need(draft.kind === 'screenplay-draft' && hash(canonicalJson(draft.data)) === draft.sha256, 'WRITING_PRODUCTION_DRAFT_INVALID', 409);
  const index = buildScreenplayIndex(draft.data.body), identities = listWritingSceneIdentities(draft.data, draft.sha256);
  need(index.scenes.length > 0 && index.scenes.length <= WRITING_SCENE_LIMIT, 'WRITING_PRODUCTION_SCENES_REQUIRED');
  need(identities.every(scene => scene.candidates.length === 0), 'WRITING_PRODUCTION_SCENE_IDENTITY_REVIEW_REQUIRED', 409);
  const scenes = index.scenes.map((scene, offset) => ({ sceneId: identities[offset].id, ordinal: offset + 1, heading: scene.heading, start: scene.start, end: scene.end, textSha256: hash(scene.text), characters: scene.characters }));
  return { source: { draftRef: { id: draft.id, version: draft.version, sha256: draft.sha256 }, title: draft.data.title, bodySha256: hash(draft.data.body), sceneCount: scenes.length, characters: [...new Set(scenes.flatMap(scene => scene.characters))] }, scenes };
}

export function writingProductionPlanId(projectId, draftRef, hash) {
  return `${WRITING_PRODUCTION_KIND}:${hash(canonicalJson({ projectId, draftRef }))}`;
}

export function validateWritingProductionPlan(data, project) {
  need(isCreativeProject(project), 'WRITING_PRODUCTION_CREATIVE_PROJECT_REQUIRED'); validateCreativeProject(project);
  need(exact(data, ['schemaVersion', 'projectId', 'sourceHash', 'status', 'source', 'scenes']) && data.schemaVersion === 1 && data.projectId === project.id && data.sourceHash === null && data.status === 'PLANNING_ONLY', 'WRITING_PRODUCTION_AUTHORITY_INVALID');
  const source = data.source;
  need(exact(source, ['draftRef', 'title', 'bodySha256', 'sceneCount', 'characters']) && text(source.title, 200, false) && digest(source.bodySha256) && Number.isSafeInteger(source.sceneCount) && characters(source.characters), 'WRITING_PRODUCTION_SOURCE_INVALID');
  validateWritingProductionDraftRef(source.draftRef);
  need(Array.isArray(data.scenes) && data.scenes.length === source.sceneCount, 'WRITING_PRODUCTION_SCENES_INVALID');
  for (const [index, scene] of data.scenes.entries()) need(exact(scene, [...sourceSceneFields, 'notes', 'shots']) && scene.ordinal === index + 1 && text(scene.heading, 1000, false) && Number.isSafeInteger(scene.start) && scene.start >= 0 && Number.isSafeInteger(scene.end) && scene.end > scene.start && digest(scene.textSha256) && characters(scene.characters), 'WRITING_PRODUCTION_SCENE_SOURCE_INVALID');
  validateWritingProductionEdits(data.scenes.map(({ sceneId, notes, shots }) => ({ sceneId, notes, shots })));
  return data;
}

export function validateWritingProductionRecord(record, project, lookupDraft, hash) {
  if (record.kind !== WRITING_PRODUCTION_KIND && !record.id.startsWith(`${WRITING_PRODUCTION_KIND}:`)) return;
  need(record.kind === WRITING_PRODUCTION_KIND, 'WRITING_PRODUCTION_IDENTITY_INVALID', 409);
  validateWritingProductionPlan(record.data, project);
  need(record.id === writingProductionPlanId(project.id, record.data.source.draftRef, hash), 'WRITING_PRODUCTION_IDENTITY_INVALID', 409);
  const draft = lookupDraft(record.data.source.draftRef);
  need(draft, 'WRITING_PRODUCTION_SAVED_DRAFT_REQUIRED', 409);
  const basis = buildWritingProductionBasis(project, draft, hash);
  const captured = { source: record.data.source, scenes: record.data.scenes.map(scene => Object.fromEntries(sourceSceneFields.map(field => [field, scene[field]]))) };
  need(canonicalJson(captured) === canonicalJson(basis), 'WRITING_PRODUCTION_SOURCE_MISMATCH', 409);
}
