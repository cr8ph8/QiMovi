import type { DreaminaContext } from './dreaminaApi';
import type { GenerationBrief, Project } from './types';
import { deriveMovieClipVisual, validateMovieSequence } from './movieSequenceModel';

/** A new local clip request, distinct from opening an exact saved node record. */
export type ShotPreparationRequest = {
  nonce: string;
  projectId: string;
  sourceHash: string;
  sceneId: string;
  shotId: string;
  movieClip?: { id: string; note: string; sourceRefs: string[]; plannedDurationMs: number | null };
};

export function prepareStoryboardShot(project: Project, context: DreaminaContext, request: ShotPreparationRequest): GenerationBrief {
  const scene = project.scenes.find(item => item.id === request.sceneId);
  const shot = scene?.shots.find(item => item.id === request.shotId);
  if (!request.nonce || request.projectId !== project.id || request.sourceHash !== project.sourceHash ||
      context.sourceHash !== project.sourceHash || context.sceneId !== request.sceneId || context.scene.id !== request.sceneId ||
      !shot || !context.scene.shots.some(item => item.id === shot.id)) {
    throw new Error('This shot selection does not match the current project, source and scene. Reopen the storyboard and select it again.');
  }
  const movie = request.movieClip;
  if (movie) validateMovieSequence({ sourceHash: project.sourceHash, title: 'Selected movie clip', status: 'DRAFT', clips: [{ ...movie, sceneId: scene.id, shotId: shot.id }] }, project);
  // A returning camera setup can contain several separate actions. Carry only
  // this movie instance's source-bound candidate, even when it has no image.
  // Use the freshly loaded generation context rather than an older UI cell.
  const movieVisual = movie ? deriveMovieClipVisual(
    { ...movie, sceneId: scene.id, shotId: shot.id }, { ...project, cells: context.cells }, [],
  ) : null;
  const prompt = movie ? [
    `MOVIE CLIP ${movie.id} / SHOT ${shot.label} / PROPOSED DIRECTION`,
    movie.note,
    'Use only the action assigned to this clip. A returning camera setup does not repeat its earlier action. Preserve the screenplay dialogue exactly. Review the opening state, pivotal movement, camera and ending cut before generation.',
    'EXACT SCREENPLAY PASSAGES FOR THIS CLIP',
    ...movie.sourceRefs.map(id => { const paragraph = scene.paragraphs.find(item => item.id === id)!; return `${paragraph.type} [${id}]\n${paragraph.text}`; }),
  ].join('\n\n') : '';
  if (prompt.length > 40000) throw new Error('This clip has too much source text for one prompt. Split the proposed clip before preparation.');
  return {
    schemaVersion: 1, sourceHash: context.sourceHash, sceneId: context.sceneId,
    title: `Scene ${scene.index} · shot ${shot.label}${movie ? ' · movie clip' : ''}`, shotIds: [shot.id],
    cellIds: movie ? (movieVisual?.cell ? [movieVisual.cell.id] : [])
      : context.cells.filter(cell => cell.sceneId === scene.id && cell.shotId === shot.id).map(cell => cell.id),
    initialFrameCellId: null, characterIds: context.characters.map(character => character.id), prompt,
    settings: { model: '', mode: movie ? 'CLIP' : 'UNCONFIRMED', durationMs: movie?.plannedDurationMs ?? null, aspectRatio: '', resolution: '' },
    basisHash: context.basisHash, status: 'DRAFT',
  };
}
