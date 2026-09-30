import { deriveMovieClipVisual, type MovieClip } from './movieSequenceModel';
import type { CastingDraft, GenerationBrief, Project, StoryCell, WorkspaceRecord } from './types';

export type ClipPreparationStep = 'frames' | 'references' | 'prompt' | 'review';
export interface ClipPreparationGap {
  id: 'opening' | 'extraction' | 'references' | 'timing' | 'prompt' | 'brief';
  label: string;
  detail: string;
  state: 'NEEDED' | 'REVIEW' | 'PRESENT';
  step: ClipPreparationStep;
}
export interface ClipPreparationReadiness {
  status: 'CANDIDATE_INPUTS_ONLY';
  basis: 'LIVE_DRAFT' | 'SAVED_BRIEF' | 'STORYBOARD';
  unsaved: boolean;
  items: ClipPreparationGap[];
  remaining: number;
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validDuration = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 180000;
function matchingBrief(value: unknown, clip: MovieClip, project: Project): value is GenerationBrief {
  return object(value) && value.sourceHash === project.sourceHash && value.sceneId === clip.sceneId
    && value.status === 'DRAFT' && Array.isArray(value.shotIds) && value.shotIds.includes(clip.shotId)
    && Array.isArray(value.cellIds) && Array.isArray(value.characterIds) && typeof value.prompt === 'string' && object(value.settings);
}
function extractedCandidate(cell: StoryCell, project: Project, records: WorkspaceRecord[]) {
  return records.some(record => record.kind === 'storyboard-frame-extraction' && object(record.data)
    && record.data.sourceHash === project.sourceHash && record.data.projectId === project.id
    && record.data.cellId === cell.id && record.data.scope === 'INTERNAL_STORYBOARD_REFERENCE_ONLY'
    && record.data.review === 'PENDING' && object(record.data.image) && record.data.image.sha256 === cell.imageHash
    && record.data.image.pixelWidth === cell.pixelWidth && record.data.image.pixelHeight === cell.pixelHeight && !cell.crop);
}

/** Local preparation observations, never admission, rights, budget or readiness
 * authority. Only the selected clip's exact brief or its mounted local draft is
 * considered; an unrelated brief on the same shot cannot fill these gaps. */
export function deriveClipPreparationReadiness(clip: MovieClip, project: Project, records: WorkspaceRecord[],
  local?: { draft: GenerationBrief | null; unsaved: boolean }): ClipPreparationReadiness {
  const latest = clip.briefRef ? records.filter(record => record.kind === 'generation-brief' && record.id === clip.briefRef!.id)
    .sort((a, b) => b.version - a.version)[0] : undefined;
  const saved = latest && latest.sha256 === clip.briefRef?.sha256 && matchingBrief(latest.data, clip, project) ? latest : undefined;
  const draft = local?.draft && matchingBrief(local.draft, clip, project) ? local.draft : undefined;
  const brief = draft ?? saved?.data as GenerationBrief | undefined;
  const visual = deriveMovieClipVisual(clip, project, records);
  const selectedOpening = brief?.initialFrameCellId && brief.cellIds[0] === brief.initialFrameCellId
    ? project.cells.find(cell => cell.id === brief.initialFrameCellId && cell.sceneId === clip.sceneId && cell.shotId === brief.shotIds[0]) : undefined;
  const frame = selectedOpening ?? visual.cell;
  const hasImage = digest(frame?.imageHash), extraction = Boolean(hasImage && frame?.crop);
  const items: ClipPreparationGap[] = [{ id: 'opening', label: 'Opening frame', step: 'frames',
    state: selectedOpening && hasImage ? 'PRESENT' : hasImage ? 'REVIEW' : 'NEEDED',
    detail: selectedOpening && hasImage ? 'Opening candidate selected' : hasImage ? 'Choose the clip’s first instant' : visual.cell ? 'Add an image to this beat' : visual.label },
  { id: 'extraction', label: 'Individual image', step: 'frames', state: extraction || !hasImage ? 'NEEDED' : 'PRESENT',
    detail: extraction ? 'Extract this panel from its sheet' : !hasImage ? 'Image needed first'
      : frame && extractedCandidate(frame, project, records) ? 'Extracted frame · pending review' : 'Uncropped image candidate' }];
  const selectedCharacters = brief?.characterIds ?? [];
  const referenceCount = selectedCharacters.filter(characterId => {
    const character = project.characters.find(value => value.id === characterId);
    if (!character) return false;
    const casting = records.filter(record => record.kind === 'casting-draft' && object(record.data)
      && record.data.sourceHash === project.sourceHash && record.data.characterId === characterId).sort((a, b) => b.version - a.version)[0]?.data as CastingDraft | undefined;
    return casting ? Array.isArray(casting.referenceHashes) && casting.referenceHashes.some(digest) : digest(character.referenceImageHash);
  }).length;
  const mediaCount = (brief?.mediaInputs ?? []).filter(input => digest(input.sha256)).length;
  items.push({ id: 'references', label: 'Cast & references', step: 'references',
    state: selectedCharacters.length > 0 && referenceCount === selectedCharacters.length || !selectedCharacters.length && mediaCount > 0 ? 'PRESENT' : 'REVIEW',
    detail: selectedCharacters.length ? `${referenceCount}/${selectedCharacters.length} cast references${mediaCount ? ` · ${mediaCount} media` : ''}`
      : mediaCount ? `${mediaCount} media references selected` : 'Choose references or review what is needed' });
  const clipMs = validDuration(clip.plannedDurationMs) ? clip.plannedDurationMs : null;
  const briefMs = validDuration(brief?.settings.durationMs) ? brief!.settings.durationMs : null;
  items.push({ id: 'timing', label: 'Planned timing', step: 'prompt',
    state: briefMs !== null && clipMs === briefMs ? 'PRESENT' : briefMs !== null || clipMs !== null ? 'REVIEW' : 'NEEDED',
    detail: briefMs !== null && clipMs === briefMs ? `${briefMs / 1000}s in movie and brief`
      : briefMs !== null ? `${briefMs / 1000}s in brief · ${clipMs === null ? 'movie untimed' : 'movie timing differs'}`
        : clipMs !== null ? `${clipMs / 1000}s in movie · set brief duration` : 'Untimed · choose a duration' });
  items.push({ id: 'prompt', label: 'Generation prompt', step: 'prompt', state: brief?.prompt.trim() ? 'PRESENT' : 'NEEDED',
    detail: brief?.prompt.trim() ? 'Prompt draft present · review fidelity' : 'Prepare instructions from this clip' });
  items.push({ id: 'brief', label: 'Saved preparation', step: 'review', state: saved && !local?.unsaved && latest?.reviewState?.status !== 'NEEDS_REVIEW' ? 'PRESENT' : saved || clip.briefRef ? 'REVIEW' : 'NEEDED',
    detail: local?.unsaved ? 'Local draft has unsaved changes' : saved ? latest?.reviewState?.status === 'NEEDS_REVIEW' ? 'Saved inputs changed · review before saving' : `Saved v${saved.version} · candidate only`
      : clip.briefRef ? 'Saved brief changed or unavailable' : 'Review and save a clip brief' });
  return { status: 'CANDIDATE_INPUTS_ONLY', basis: draft ? 'LIVE_DRAFT' : saved ? 'SAVED_BRIEF' : 'STORYBOARD',
    unsaved: Boolean(local?.unsaved), items, remaining: items.filter(item => item.state !== 'PRESENT').length };
}
