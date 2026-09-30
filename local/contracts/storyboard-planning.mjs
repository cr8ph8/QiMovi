// Editable visual plans. Saving these records grants no generation, production,
// distribution or rights authority. Shared by the local store and browser.
import { validateComicPagePlans } from './comic-layouts.mjs';
export const STORYBOARD_PLANNING_KINDS = Object.freeze(['shot-keyframes', 'comic-draft']);
export const COMIC_DRAFT_ID = 'comic-draft:main';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (value, code, status = 422) => { if (!value) throw Object.assign(new Error(code), { code, status }); };
const exact = (value, fields) => object(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(',');
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const unique = values => new Set(values).size === values.length;

/** Length-prefix the scene so colons in scene/shot IDs cannot cause aliases. */
export function keyframePlanId(sceneId, shotId) {
  need(id(sceneId) && id(shotId), 'KEYFRAME_SHOT_ID_INVALID');
  const result = `shot-keyframes:${sceneId.length}:${sceneId}${shotId}`;
  need(id(result), 'KEYFRAME_RECORD_ID_TOO_LONG');
  return result;
}

/** Exact, reproducible change marker, not a content hash or approval claim. */
export function storyboardCellSignature(cell) {
  const crop = cell.crop ? [cell.crop.x, cell.crop.y, cell.crop.width, cell.crop.height] : null;
  return JSON.stringify([cell.id, cell.sceneId, cell.shotId, cell.role, cell.imageHash ?? null,
    cell.pixelWidth ?? null, cell.pixelHeight ?? null, crop, cell.description ?? '',
    cell.actionRefs ?? [], cell.plannedTimestampMs ?? null,
    cell.candidateVersion ?? null, cell.candidateSha256 ?? null]);
}

export function validateStoryboardPlanningIdentity(recordId, kind, data) {
  if (!STORYBOARD_PLANNING_KINDS.includes(kind) && !recordId?.startsWith('shot-keyframes:') && !recordId?.startsWith('comic-draft:')) return;
  need(STORYBOARD_PLANNING_KINDS.includes(kind), 'STORYBOARD_PLANNING_IDENTITY_INVALID');
  need(recordId === (kind === 'comic-draft' ? COMIC_DRAFT_ID : keyframePlanId(data?.sceneId, data?.shotId)), 'STORYBOARD_PLANNING_IDENTITY_INVALID');
}

export function validateStoryboardPlanning(kind, data, project, { references = true } = {}) {
  need(STORYBOARD_PLANNING_KINDS.includes(kind), 'STORYBOARD_PLANNING_KIND_INVALID');
  const common = ['schemaVersion', 'projectId', 'sourceHash', 'status'];
  const fields = kind === 'shot-keyframes'
    ? [...common, 'sceneId', 'shotId', 'durationMs', 'frames', 'cellBindings', 'notes']
    : [...common, 'title', 'credits', 'panelsPerPage', 'panels', ...(data?.schemaVersion === 2 ? ['pages'] : [])];
  need(exact(data, fields), 'STORYBOARD_PLANNING_FIELDS_INVALID');
  need((data.schemaVersion === 1 || kind === 'comic-draft' && data.schemaVersion === 2) && data.status === 'DRAFT', 'STORYBOARD_PLANNING_AUTHORITY_INVALID');
  need(id(data.projectId) && digest(data.sourceHash), 'STORYBOARD_PLANNING_SOURCE_INVALID');
  if (project) need(data.projectId === project.id && data.sourceHash === project.sourceHash, 'STORYBOARD_PLANNING_SOURCE_MISMATCH');
  if (kind === 'shot-keyframes') {
    need(id(data.sceneId) && id(data.shotId), 'KEYFRAME_SHOT_ID_INVALID');
    keyframePlanId(data.sceneId, data.shotId);
    need(data.durationMs === null || Number.isSafeInteger(data.durationMs) && data.durationMs > 0 && data.durationMs <= 180000, 'KEYFRAME_DURATION_INVALID');
    need(text(data.notes, 8000), 'KEYFRAME_NOTES_INVALID');
    need(Array.isArray(data.frames) && data.frames.length <= 24 && unique(data.frames.map(frame => frame?.cellId)), 'KEYFRAME_FRAMES_INVALID');
    let previous = -1;
    for (const frame of data.frames) {
      need(exact(frame, ['cellId', 'atPermille', 'note']) && id(frame.cellId) && Number.isSafeInteger(frame.atPermille) && frame.atPermille >= 0 && frame.atPermille <= 1000 && frame.atPermille > previous && text(frame.note, 2000), 'KEYFRAME_POSITION_OR_NOTE_INVALID');
      previous = frame.atPermille;
    }
    need(Array.isArray(data.cellBindings) && data.cellBindings.length === data.frames.length, 'KEYFRAME_BINDINGS_INVALID');
    for (const [index, binding] of data.cellBindings.entries()) need(exact(binding, ['cellId', 'signature']) && binding.cellId === data.frames[index].cellId && text(binding.signature, 60000) && binding.signature.length > 0, 'KEYFRAME_BINDINGS_INVALID');
    if (project && references) {
      need(project.scenes.filter(scene => scene.id === data.sceneId && scene.shots.filter(shot => shot.id === data.shotId).length === 1).length === 1, 'KEYFRAME_SHOT_MISSING');
      for (const [index, frame] of data.frames.entries()) {
        const matches = project.cells.filter(cell => cell.id === frame.cellId && cell.sceneId === data.sceneId && cell.shotId === data.shotId);
        need(matches.length === 1, 'KEYFRAME_CELL_MISSING_OR_WRONG_SHOT');
        need(data.cellBindings[index].signature === storyboardCellSignature(matches[0]), 'KEYFRAME_CELLS_CHANGED', 409);
      }
    }
  } else {
    need(text(data.title, 240) && data.title.trim().length > 0 && text(data.credits, 2000), 'COMIC_DRAFT_TITLE_OR_CREDITS_INVALID');
    need([1, 2, 4].includes(data.panelsPerPage), 'COMIC_DRAFT_LAYOUT_INVALID');
    need(Array.isArray(data.panels) && data.panels.length <= 200 && unique(data.panels.map(panel => panel?.cellId)), 'COMIC_DRAFT_PANELS_INVALID');
    for (const panel of data.panels) {
      need(exact(panel, ['cellId', 'caption', 'paragraphIds']) && id(panel.cellId) && text(panel.caption, 8000) && Array.isArray(panel.paragraphIds) && panel.paragraphIds.length <= 200 && panel.paragraphIds.every(id) && unique(panel.paragraphIds), 'COMIC_DRAFT_PANEL_INVALID');
      if (project && references) {
        const matches = project.cells.filter(cell => cell.id === panel.cellId);
        need(matches.length === 1, 'COMIC_DRAFT_CELL_MISSING');
        const cell = matches[0], scene = project.scenes.find(row => row.id === cell.sceneId);
        need(scene && scene.shots.some(shot => shot.id === cell.shotId), 'COMIC_DRAFT_SHOT_MISSING');
        const paragraphs = [...(project.prologue ?? []), ...scene.paragraphs];
        need(panel.paragraphIds.every(paragraphId => (cell.actionRefs ?? []).includes(paragraphId) && paragraphs.filter(paragraph => paragraph.id === paragraphId).length === 1), 'COMIC_DRAFT_PARAGRAPH_NOT_LINKED');
      }
    }
    if (data.schemaVersion === 2) validateComicPagePlans(data.pages, data.panels.map(panel => panel.cellId));
  }
  return data;
}

export function keyframePlanCurrentness(plan, project) {
  const changedCellIds = [];
  if (plan.projectId !== project.id || plan.sourceHash !== project.sourceHash) return { status: 'STALE', changedCellIds: plan.frames.map(frame => frame.cellId), reason: 'SOURCE_CHANGED' };
  if (!project.scenes.some(scene => scene.id === plan.sceneId && scene.shots.some(shot => shot.id === plan.shotId))) return { status: 'STALE', changedCellIds: plan.frames.map(frame => frame.cellId), reason: 'SHOT_MISSING' };
  for (const frame of plan.frames) {
    const cell = project.cells.find(cell => cell.id === frame.cellId && cell.sceneId === plan.sceneId && cell.shotId === plan.shotId);
    const binding = plan.cellBindings.find(binding => binding.cellId === frame.cellId);
    if (!cell || !binding || binding.signature !== storyboardCellSignature(cell)) changedCellIds.push(frame.cellId);
  }
  return { status: changedCellIds.length ? 'STALE' : 'CURRENT', changedCellIds, reason: changedCellIds.length ? 'STORYBOARD_FRAMES_CHANGED' : 'EXACT_SAVED_FRAME_BASIS' };
}
