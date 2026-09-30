import { blobUrl } from './api';
import type { Project, StoryCell } from './types';
import type { StudioOperationRequest } from './studioOperationRequest';

export type StoryboardCellAction = 'CREATE_IMAGE' | 'ANIMATE_IMAGE';

export function selectedStoryboardCell(project: Project, sceneId: string, shotId: string, cellId: string): StoryCell {
  const scene = project.scenes.find(row => row.id === sceneId);
  if (!scene?.shots.some(row => row.id === shotId)) throw new Error('This shot is no longer part of the selected source.');
  const cell = project.cells.find(row => row.id === cellId && row.sceneId === sceneId && row.shotId === shotId);
  if (!cell) throw new Error('This storyboard cell no longer belongs to the selected shot.');
  return cell;
}

export async function storyboardOperationRequest(project: Project, sceneId: string, shotId: string, cellId: string, action: StoryboardCellAction, signal?: AbortSignal): Promise<StudioOperationRequest> {
  const cell = structuredClone(selectedStoryboardCell(project, sceneId, shotId, cellId));
  if (!['CREATE_IMAGE', 'ANIMATE_IMAGE'].includes(action)) throw new Error('Choose image or animation preparation.');
  if (action === 'ANIMATE_IMAGE' && !cell.imageHash) throw new Error('Choose an existing image before preparing its animation.');
  if (action === 'ANIMATE_IMAGE' && cell.crop) throw new Error('This frame is a panel within a larger image. Extract and save the individual frame before preparing its animation. The whole sheet cannot be used as its opening image.');
  const medias: StudioOperationRequest['medias'] = [];
  if (cell.imageHash) {
    if (!/^[a-f0-9]{64}$/.test(cell.imageHash)) throw new Error('The selected image has an invalid retained identity.');
    // The local blob route supports byte ranges, not HEAD. Read one owned byte.
    const response = await fetch(blobUrl(cell.imageHash), { credentials: 'same-origin', redirect: 'error', headers: { Range: 'bytes=0-0' }, signal });
    const mimeType = response.headers.get('Content-Type') ?? '';
    const range = /^bytes 0-0\/([1-9]\d*)$/.exec(response.headers.get('Content-Range') ?? '');
    if (response.status !== 206 || !range || !Number.isSafeInteger(Number(range[1])) || response.headers.get('Content-Length') !== '1' || !/^image\/(png|jpeg|webp|gif)$/.test(mimeType)) {
      await response.body?.cancel();
      throw new Error('The retained image metadata could not be confirmed. Refresh the project before preparing it.');
    }
    if ((await response.arrayBuffer()).byteLength !== 1) throw new Error('The retained image metadata response was incomplete.');
    medias.push({ role: action === 'CREATE_IMAGE' ? 'image' : 'start_image', sha256: cell.imageHash, label: (cell.description || cell.id).slice(0, 500), mimeType });
  }
  const shot = project.scenes.find(row => row.id === sceneId)!.shots.find(row => row.id === shotId)!;
  const cropNote = cell.crop ? `\nThe selected cell has a planned crop: x=${cell.crop.x}, y=${cell.crop.y}, width=${cell.crop.width}, height=${cell.crop.height}. The input is the unchanged original image; this crop has not been rendered.` : '';
  return { nonce: crypto.randomUUID(), projectId: project.id, sourceHash: project.sourceHash,
    taskId: action === 'CREATE_IMAGE' ? 'generate_image' : 'generate_video',
    modelId: action === 'CREATE_IMAGE' ? 'nano_banana_pro' : 'seedance_2_5',
    ...(action === 'ANIMATE_IMAGE' ? { settings: { mode: 'omni_reference' } } : {}),
    target: { kind: 'CELL', sceneId, shotId, cellId }, medias,
    title: `${action === 'CREATE_IMAGE' ? 'Create image' : 'Animate image'} · ${shot.label} · ${cell.role}`.slice(0, 240),
    prompt: `${cell.description || 'Describe the intended image or movement.'}${cropNote}`,
  };
}
