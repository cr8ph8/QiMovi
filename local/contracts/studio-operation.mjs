import { projectOwnedContext } from './creative-project.mjs';
// A saved creative task is an editable plan, never a submission or approval.
// settingsJson preserves provider fractions without changing workspace canonical JSON.
import { listWritingSceneIdentities } from './writing-scene-map.mjs';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (value, code) => { if (!value) throw Object.assign(new Error(code), { code, status: 422 }); };
const shape = (value, keys) => need(object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','), 'STUDIO_OPERATION_FIELDS_INVALID');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const text = (value, max) => typeof value === 'string' && value.length <= max && value.isWellFormed() && !value.includes('\0');

export function studioSettings(value) {
  need(text(value, 131072), 'STUDIO_OPERATION_SETTINGS_INVALID');
  let parsed;
  try { parsed = JSON.parse(value); } catch { need(false, 'STUDIO_OPERATION_SETTINGS_INVALID'); }
  need(object(parsed), 'STUDIO_OPERATION_SETTINGS_INVALID');
  let count = 0;
  function visit(item, depth) {
    need(++count <= 10000 && depth <= 12, 'STUDIO_OPERATION_SETTINGS_TOO_COMPLEX');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number') { need(Number.isFinite(item), 'STUDIO_OPERATION_SETTINGS_INVALID'); return; }
    if (typeof item === 'string') { need(text(item, 50000), 'STUDIO_OPERATION_SETTINGS_INVALID'); return; }
    if (Array.isArray(item)) { item.forEach(child => visit(child, depth + 1)); return; }
    need(object(item), 'STUDIO_OPERATION_SETTINGS_INVALID');
    for (const [key, child] of Object.entries(item)) {
      need(text(key, 200) && !['__proto__', 'prototype', 'constructor'].includes(key), 'STUDIO_OPERATION_SETTINGS_INVALID');
      visit(child, depth + 1);
    }
  }
  visit(parsed, 0);
  return parsed;
}

export function validateStudioOperationIdentity(recordId, kind) {
  if (kind !== 'studio-operation' && !recordId?.startsWith('studio-operation:')) return;
  need(kind === 'studio-operation' && id(recordId) && recordId.length > 'studio-operation:'.length && recordId.startsWith('studio-operation:'), 'STUDIO_OPERATION_IDENTITY_INVALID');
}

export function validateStudioOperation(data, project) {
  project = projectOwnedContext(project, 'studio-operation', data);
  const independent = data?.schemaVersion === 2;
  shape(data, ['schemaVersion', 'sourceHash', 'title', 'taskId', 'modelId', 'prompt', 'settingsJson', 'medias', 'target', 'briefRef', 'catalogSha256', 'status', ...(independent ? ['projectId'] : []), ...['writingRef', 'castingRef'].filter(key => object(data) && Object.hasOwn(data, key))]);
  need([1, 2].includes(data.schemaVersion) && data.status === 'DRAFT', 'STUDIO_OPERATION_AUTHORITY_INVALID');
  if (independent) {
    need(id(data.projectId) && data.sourceHash === null && (!project || project.profile === 'caniscreenwrite-creative/v1' && project.sourceHash === null && data.projectId === project.id), 'STUDIO_OPERATION_PROJECT_MISMATCH');
    need(data.target?.kind === 'PROJECT' && data.briefRef === null, 'STUDIO_OPERATION_SOURCE_LINK_REQUIRED');
  } else need(digest(data.sourceHash) && (!project || data.sourceHash === project.sourceHash), 'STUDIO_OPERATION_SOURCE_MISMATCH');
  need(text(data.title, 240) && data.title.trim() && !/[\r\n]/.test(data.title), 'STUDIO_OPERATION_TITLE_INVALID');
  need(id(data.taskId) && (data.modelId === '' || id(data.modelId)) && digest(data.catalogSha256), 'STUDIO_OPERATION_CATALOG_INVALID');
  need(text(data.prompt, 50000), 'STUDIO_OPERATION_PROMPT_INVALID');
  studioSettings(data.settingsJson);
  need(Array.isArray(data.medias) && data.medias.length <= 64, 'STUDIO_OPERATION_MEDIA_INVALID');
  const seen = new Set();
  for (const media of data.medias) {
    shape(media, ['role', 'sha256', 'label', 'mimeType']);
    need(['image', 'start_image', 'end_image', 'video', 'audio'].includes(media.role) && digest(media.sha256) && text(media.label, 500) && media.label.trim(), 'STUDIO_OPERATION_MEDIA_INVALID');
    const family = ['image', 'start_image', 'end_image'].includes(media.role) ? 'image' : media.role;
    need(typeof media.mimeType === 'string' && new RegExp(`^${family}/[A-Za-z0-9.+-]+$`).test(media.mimeType), 'STUDIO_OPERATION_MEDIA_INVALID');
    const key = `${media.role}:${media.sha256}`;
    need(!seen.has(key), 'STUDIO_OPERATION_DUPLICATE_MEDIA'); seen.add(key);
  }
  need(object(data.target) && ['PROJECT', 'SCENE', 'SHOT', 'CELL'].includes(data.target.kind), 'STUDIO_OPERATION_TARGET_INVALID');
  const fields = ['kind', ...(data.target.kind === 'PROJECT' ? [] : ['sceneId']), ...(['SHOT', 'CELL'].includes(data.target.kind) ? ['shotId'] : []), ...(data.target.kind === 'CELL' ? ['cellId'] : [])];
  shape(data.target, fields);
  fields.filter(key => key !== 'kind').forEach(key => need(id(data.target[key]), 'STUDIO_OPERATION_TARGET_INVALID'));
  if (project && data.target.kind !== 'PROJECT') {
    const scene = project.scenes.find(item => item.id === data.target.sceneId);
    need(scene, 'STUDIO_OPERATION_SCENE_MISSING');
    if (data.target.shotId) need(scene.shots.some(item => item.id === data.target.shotId), 'STUDIO_OPERATION_SHOT_MISSING');
    if (data.target.cellId) need(project.cells?.some(item => item.id === data.target.cellId && item.sceneId === data.target.sceneId && item.shotId === data.target.shotId), 'STUDIO_OPERATION_CELL_MISSING');
  }
  if (data.briefRef !== null) {
    shape(data.briefRef, ['id', 'sha256']);
    need(id(data.briefRef.id) && data.briefRef.id.startsWith('generation-brief:') && digest(data.briefRef.sha256), 'STUDIO_OPERATION_BRIEF_INVALID');
  }
  if (Object.hasOwn(data, 'writingRef')) {
    shape(data.writingRef, ['id', 'version', 'sha256', 'sceneId']);
    need(id(data.writingRef.id) && data.writingRef.id.startsWith('screenplay-draft:') && data.writingRef.id.length > 'screenplay-draft:'.length
      && Number.isSafeInteger(data.writingRef.version) && data.writingRef.version > 0 && digest(data.writingRef.sha256) && id(data.writingRef.sceneId), 'STUDIO_OPERATION_WRITING_INVALID');
  }
  if (Object.hasOwn(data, 'castingRef')) {
    const ref = data.castingRef;
    shape(ref, ['id', 'version', 'sha256', 'characterId']);
    need(!independent && id(ref.characterId) && ref.id === `casting-draft:${ref.characterId}` && id(ref.id)
      && Number.isSafeInteger(ref.version) && ref.version > 0 && digest(ref.sha256)
      && (!project || project.characters.some(character => character.id === ref.characterId)), 'STUDIO_OPERATION_CASTING_INVALID');
  }
  return data;
}

export function validateStudioOperationReferences(data, lookupRecord, lookupBlob) {
  // Bind retained history, not the latest draft: later edits must not make an
  // existing task, output provenance or backup unreadable.
  if (data.castingRef) {
    const ref = data.castingRef, casting = lookupRecord(ref);
    need(casting?.kind === 'casting-draft' && casting.id === ref.id && casting.version === ref.version && casting.sha256 === ref.sha256
      && casting.data.sourceHash === data.sourceHash && casting.data.characterId === ref.characterId, 'STUDIO_OPERATION_CASTING_MISSING_OR_CHANGED');
  }
  if (data.writingRef) {
    const ref = data.writingRef, writing = lookupRecord(ref);
    need(writing?.kind === 'screenplay-draft' && writing.id === ref.id && writing.version === ref.version && writing.sha256 === ref.sha256, 'STUDIO_OPERATION_WRITING_MISSING_OR_CHANGED');
    need(writing.data.sourceHash === data.sourceHash && (data.schemaVersion === 2
      ? writing.data.schemaVersion === 2 && writing.data.projectId === data.projectId
      : writing.data.schemaVersion !== 2), 'STUDIO_OPERATION_WRITING_PROJECT_MISMATCH');
    need(listWritingSceneIdentities(writing.data, writing.sha256).some(scene => scene.id === ref.sceneId), 'STUDIO_OPERATION_WRITING_SCENE_MISSING');
  }
  if (data.briefRef) {
    const brief = lookupRecord(data.briefRef);
    need(brief?.kind === 'generation-brief' && brief.sha256 === data.briefRef.sha256 && brief.data.sourceHash === data.sourceHash, 'STUDIO_OPERATION_BRIEF_MISSING');
    need(brief.data.prompt === data.prompt, 'STUDIO_OPERATION_BRIEF_PROMPT_CHANGED');
    if (data.target.kind !== 'PROJECT') need(brief.data.sceneId === data.target.sceneId, 'STUDIO_OPERATION_BRIEF_TARGET_MISMATCH');
    if (data.target.shotId) need(brief.data.shotIds.includes(data.target.shotId), 'STUDIO_OPERATION_BRIEF_TARGET_MISMATCH');
    if (data.target.cellId) need(brief.data.cellIds.includes(data.target.cellId), 'STUDIO_OPERATION_BRIEF_TARGET_MISMATCH');
  }
  for (const media of data.medias) {
    const blob = lookupBlob(media.sha256);
    need(blob && blob.mimeType === media.mimeType, 'STUDIO_OPERATION_MEDIA_MISSING_OR_CHANGED');
  }
}
