import { COMIC_DRAFT_ID, keyframePlanId, keyframePlanCurrentness, storyboardCellSignature, validateStoryboardPlanning, validateStoryboardPlanningIdentity } from '../../local/contracts/storyboard-planning.mjs';
import type { ComicDraft, ComicDraftRecord, Project, ShotKeyframePlan, ShotKeyframeRecord, WorkspaceRecord } from './types';
export { COMIC_DRAFT_ID, keyframePlanId, keyframePlanCurrentness, storyboardCellSignature };
export type { ComicDraft, ComicDraftRecord, ShotKeyframePlan, ShotKeyframeRecord } from './types';

export function createShotKeyframePlan(project: Project, sceneId: string, shotId: string): ShotKeyframePlan {
  const shot = project.scenes.find(scene => scene.id === sceneId)?.shots.find(shot => shot.id === shotId);
  if (!shot) throw new Error('Choose a shot from this project.');
  const duration = shot.plannedDurationMs;
  return { schemaVersion: 1, projectId: project.id, sourceHash: project.sourceHash, sceneId, shotId,
    durationMs: Number.isSafeInteger(duration) && duration! > 0 && duration! <= 180000 ? duration : null,
    frames: [], cellBindings: [], notes: '', status: 'DRAFT' };
}

/** Call only after the user has reviewed the current referenced frames. */
export function bindShotKeyframes(plan: ShotKeyframePlan, project: Project): ShotKeyframePlan {
  return { ...plan, cellBindings: plan.frames.map(frame => {
    const cell = project.cells.find(cell => cell.id === frame.cellId && cell.sceneId === plan.sceneId && cell.shotId === plan.shotId);
    if (!cell) throw new Error('A planned key frame is missing or belongs to another shot.');
    return { cellId: cell.id, signature: storyboardCellSignature(cell) };
  }) };
}

export function createComicDraft(project: Project): ComicDraft {
  return { schemaVersion: 1, projectId: project.id, sourceHash: project.sourceHash,
    title: `${project.title} — storyboard comic`.slice(0, 240), credits: '', panelsPerPage: 2, panels: [], status: 'DRAFT' };
}

function latestRecord(records: WorkspaceRecord[], id: string, kind: string): WorkspaceRecord | null {
  const matching = records.filter(record => record.id === id);
  if (!matching.length) return null;
  if (matching.some(record => record.kind !== kind || !Number.isSafeInteger(record.version) || record.version < 1)) throw new Error('The saved storyboard plan has an invalid identity.');
  const version = Math.max(...matching.map(record => record.version)), latest = matching.filter(record => record.version === version);
  if (new Set(latest.map(record => record.sha256)).size !== 1) throw new Error('Conflicting saved storyboard plans are loaded. Refresh before editing.');
  return latest[0];
}
export function readShotKeyframeRecord(project: Project, records: WorkspaceRecord[], sceneId: string, shotId: string): ShotKeyframeRecord | null {
  const record = latestRecord(records, keyframePlanId(sceneId, shotId), 'shot-keyframes');
  if (!record) return null;
  validateStoryboardPlanningIdentity(record.id, record.kind, record.data);
  validateStoryboardPlanning('shot-keyframes', record.data, project, { references: false });
  return record as ShotKeyframeRecord;
}
export function readComicDraftRecord(project: Project, records: WorkspaceRecord[]): ComicDraftRecord | null {
  const record = latestRecord(records, COMIC_DRAFT_ID, 'comic-draft');
  if (!record) return null;
  validateStoryboardPlanningIdentity(record.id, record.kind, record.data);
  validateStoryboardPlanning('comic-draft', record.data, project, { references: false });
  return record as ComicDraftRecord;
}
