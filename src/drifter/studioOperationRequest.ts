import type { HiggsfieldPlannedMedia, HiggsfieldToolsCatalog, HiggsfieldValue } from './higgsfieldToolsApi';
import type { StudioOperationTarget, StudioWritingRef, StudioCastingRef } from './studioOperationApi';
import type { Project, WorkspaceProject } from './types';
import type { StudioMedia } from './studioMediaApi';

/** A local editor handoff. It grants neither upload nor generation authority. */
export interface StudioOperationRequest {
  nonce: string;
  projectId: string;
  sourceHash: string | null;
  taskId: 'generate_image' | 'generate_video' | 'generate_audio';
  target: StudioOperationTarget;
  medias: HiggsfieldPlannedMedia[];
  title?: string;
  prompt?: string;
  modelId?: string;
  settings?: Record<string, HiggsfieldValue>;
  writingRef?: StudioWritingRef;
  castingRef?: StudioCastingRef;
}

export function studioMediaActions(media: Pick<StudioMedia, 'mimeType'>): { label: string; taskId: StudioOperationRequest['taskId']; modelId: string; role: HiggsfieldPlannedMedia['role']; settings?: StudioOperationRequest['settings'] }[] {
  if (media.mimeType.startsWith('image/')) return [
    { label: 'Create image', taskId: 'generate_image', modelId: 'nano_banana_pro', role: 'image' },
    { label: 'Animate image', taskId: 'generate_video', modelId: 'seedance_2_5', role: 'start_image', settings: { mode: 'omni_reference' } },
    { label: 'Create promotional artwork', taskId: 'generate_image', modelId: 'ms_image', role: 'image' },
  ];
  if (media.mimeType.startsWith('video/')) return [{ label: 'Edit video', taskId: 'generate_video', modelId: 'seedance_2_5', role: 'video', settings: { mode: 'video_edit' } }];
  if (media.mimeType.startsWith('audio/')) return [{ label: 'Plan video with audio', taskId: 'generate_video', modelId: 'seedance_2_5', role: 'audio', settings: { mode: 'omni_reference' } }];
  return [];
}

const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit && !value.includes('\0');
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
function need(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

export function validateStudioOperationRequest(request: StudioOperationRequest, project: WorkspaceProject, catalog: HiggsfieldToolsCatalog): StudioOperationRequest {
  need(object(request) && text(request.nonce, 200) && request.nonce.length > 0, 'This task selection has no valid request identity.');
  need(request.projectId === project.id && request.sourceHash === project.sourceHash, 'This task selection belongs to another project or source revision.');
  need(['generate_image', 'generate_video', 'generate_audio'].includes(request.taskId), 'This task selection is not a supported preparation action.');
  const target = request.target;
  need(object(target) && ['PROJECT', 'SCENE', 'SHOT', 'CELL'].includes(target.kind), 'This task selection has no valid target.');
  const fields = ['kind', ...(target.kind === 'PROJECT' ? [] : ['sceneId']), ...(['SHOT', 'CELL'].includes(target.kind) ? ['shotId'] : []), ...(target.kind === 'CELL' ? ['cellId'] : [])];
  need(Object.keys(target).sort().join() === fields.sort().join(), 'The task target has unexpected fields.');
  if (target.kind !== 'PROJECT') {
    need(!('profile' in project && project.profile === 'caniscreenwrite-creative/v1'), 'Attach a screenplay before targeting its scenes or shots.');
    const film = project as Project;
    const scene = film.scenes.find(row => row.id === target.sceneId);
    need(scene, 'The selected scene no longer exists in this source.');
    if (target.kind === 'SHOT' || target.kind === 'CELL') need(scene.shots.some(row => row.id === target.shotId), 'The selected shot no longer exists in this scene.');
    if (target.kind === 'CELL') need(film.cells.some(row => row.id === target.cellId && row.sceneId === target.sceneId && row.shotId === target.shotId), 'The selected storyboard cell no longer belongs to this shot.');
  }
  need(Array.isArray(request.medias) && request.medias.length <= 64, 'The selected media list is invalid.');
  const keys = new Set<string>();
  for (const media of request.medias) {
    need(object(media) && ['image', 'start_image', 'end_image', 'video', 'audio'].includes(media.role) && /^[a-f0-9]{64}$/.test(media.sha256) && text(media.label, 500) && media.label.trim(), 'A selected media reference is invalid.');
    const family = ['image', 'start_image', 'end_image'].includes(media.role) ? 'image' : media.role;
    need(typeof media.mimeType === 'string' && new RegExp(`^${family}/[A-Za-z0-9.+-]+$`).test(media.mimeType), 'A selected media type does not match its reference role.');
    const key = `${media.role}:${media.sha256}`;
    need(!keys.has(key), 'The same reference role was selected twice.'); keys.add(key);
  }
  need(request.title === undefined || text(request.title, 240) && !/[\r\n]/.test(request.title), 'The task title is invalid.');
  need(request.prompt === undefined || text(request.prompt, 50000), 'The selected prompt is invalid.');
  if (request.writingRef !== undefined) {
    const ref = request.writingRef;
    need(object(ref) && Object.keys(ref).sort().join() === ['id', 'version', 'sha256', 'sceneId'].sort().join()
      && typeof ref.id === 'string' && /^screenplay-draft:[A-Za-z0-9._:-]+$/.test(ref.id) && ref.id.length <= 160
      && Number.isSafeInteger(ref.version) && ref.version > 0 && typeof ref.sha256 === 'string' && /^[a-f0-9]{64}$/.test(ref.sha256)
      && typeof ref.sceneId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(ref.sceneId), 'The writing revision or scene reference is invalid.');
  }
  const action = catalog.actions.find(row => row.id === request.taskId);
  if (request.castingRef !== undefined) {
    const ref = request.castingRef;
    need(object(ref) && Object.keys(ref).sort().join() === ['id', 'version', 'sha256', 'characterId'].sort().join()
      && project.sourceHash !== null && typeof ref.characterId === 'string' && (project as Project).characters.some(character => character.id === ref.characterId)
      && ref.id === `casting-draft:${ref.characterId}` && Number.isSafeInteger(ref.version) && ref.version > 0
      && typeof ref.sha256 === 'string' && /^[a-f0-9]{64}$/.test(ref.sha256), 'The casting revision or character reference is invalid.');
  }
  need(action, 'This task is absent from the retained tool catalog.');
  if (request.modelId !== undefined) need(action.modelIds.includes(request.modelId) && catalog.composerModelIds.includes(request.modelId), 'The selected model has no request builder for this task.');
  if (request.settings !== undefined) {
    need(object(request.settings) && Object.keys(request.settings).length <= 100, 'The selected model settings are invalid.');
    for (const [key, value] of Object.entries(request.settings)) need(text(key, 100) && !['__proto__', 'constructor', 'prototype'].includes(key) && (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || text(value, 50000) || Array.isArray(value) && value.length <= 100 && value.every(item => text(item, 5000))), 'The selected model settings are invalid.');
  }
  return structuredClone(request);
}
