import type { Project, StoryCell, WorkspaceRecord } from './types';
import { getDrifterStoryboardBeats } from './drifterStoryboardBeats';

export interface ClipEditSelection {
  takeRef: { id: string; sha256: string };
  reviewRef: { id: string; sha256: string };
  assetHash: string;
  inMs: number;
  outMs: number;
}

export interface MovieClip {
  id: string;
  sceneId: string;
  shotId: string;
  plannedDurationMs: number | null;
  sourceRefs: string[];
  briefRef?: { id: string; sha256: string };
  editSelection?: ClipEditSelection;
  note: string;
}

export interface MovieSequence {
  sourceHash: string;
  title: string;
  clips: MovieClip[];
  status: 'DRAFT';
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function need(value: unknown, message = 'The movie sequence contains invalid planning data.'): asserts value {
  if (!value) throw new Error(message);
}
function shape(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
  need(object(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(','));
}

/** Validate transport without a project, and source associations when supplied. */
export function validateMovieSequence(data: unknown, project?: Project): MovieSequence {
  shape(data, ['sourceHash', 'title', 'clips', 'status']);
  need(digest(data.sourceHash) && (!project || data.sourceHash === project.sourceHash) && data.status === 'DRAFT', 'The movie sequence does not match this screenplay revision.');
  need(typeof data.title === 'string' && data.title.trim().length > 0 && data.title.length <= 200 && !/[\r\n\0]/.test(data.title));
  need(Array.isArray(data.clips) && data.clips.length <= 1000);
  const clipIds = new Set<string>();
  for (const clip of data.clips) {
    shape(clip, ['id', 'sceneId', 'shotId', 'plannedDurationMs', 'sourceRefs', 'note', ...['briefRef', 'editSelection'].filter(key => object(clip) && Object.prototype.hasOwnProperty.call(clip, key))]);
    need(id(clip.id) && !clipIds.has(clip.id), 'Each proposed movie clip needs a unique identity.'); clipIds.add(clip.id);
    need(id(clip.sceneId) && id(clip.shotId));
    const scene = project?.scenes.find(value => value.id === clip.sceneId);
    if (project) need(scene?.shots.some(shot => shot.id === clip.shotId), 'A movie clip refers to a shot outside its scene.');
    need(clip.plannedDurationMs === null || (typeof clip.plannedDurationMs === 'number' && Number.isSafeInteger(clip.plannedDurationMs) && clip.plannedDurationMs > 0 && clip.plannedDurationMs <= 180000), 'Each proposed clip must be untimed or at most 180 seconds.');
    need(Array.isArray(clip.sourceRefs) && new Set(clip.sourceRefs).size === clip.sourceRefs.length && clip.sourceRefs.every(ref => id(ref) && (!project || scene?.paragraphs.some(paragraph => paragraph.id === ref))), 'A movie clip contains invalid or cross-scene source references.');
    need(typeof clip.note === 'string' && clip.note.length <= 8000);
    if (Object.prototype.hasOwnProperty.call(clip, 'briefRef')) {
      shape(clip.briefRef, ['id', 'sha256']);
      need(id(clip.briefRef.id) && clip.briefRef.id.startsWith('generation-brief:') && clip.briefRef.id.length > 'generation-brief:'.length && digest(clip.briefRef.sha256), 'A movie clip contains an invalid saved brief reference.');
    }
    if (Object.prototype.hasOwnProperty.call(clip, 'editSelection')) validateClipEditSelection(clip.editSelection);
  }
  return data as unknown as MovieSequence;
}

export function validateClipEditSelection(value: unknown): ClipEditSelection {
  shape(value, ['takeRef', 'reviewRef', 'assetHash', 'inMs', 'outMs']);
  shape(value.takeRef, ['id', 'sha256']); shape(value.reviewRef, ['id', 'sha256']);
  need(typeof value.takeRef.id === 'string' && /^measured-media-take:[a-f0-9]{64}$/.test(value.takeRef.id) && digest(value.takeRef.sha256), 'Choose an exact measured take.');
  need(value.reviewRef.id === `take-review:${value.takeRef.sha256}` && digest(value.reviewRef.sha256) && digest(value.assetHash), 'Choose a current reviewed take.');
  need(typeof value.inMs === 'number' && Number.isSafeInteger(value.inMs) && value.inMs >= 0 && typeof value.outMs === 'number' && Number.isSafeInteger(value.outMs) && value.outMs > value.inMs && value.outMs - value.inMs <= 180000, 'Use a take range greater than zero and no longer than 180 seconds.');
  return value as unknown as ClipEditSelection;
}

export function validateMovieSequenceIdentity(recordId: unknown, kind: unknown): void {
  if (kind !== 'movie-sequence' && !(typeof recordId === 'string' && recordId.startsWith('movie-sequence:'))) return;
  need(kind === 'movie-sequence' && id(recordId) && recordId.startsWith('movie-sequence:') && recordId.length > 'movie-sequence:'.length, 'The movie sequence record identity does not match its kind.');
}

export interface MovieClipVisual {
  binding: 'EXACT_BEAT' | 'UNIQUE_SOURCE' | 'AMBIGUOUS' | 'MISSING' | 'CHANGED';
  cell: StoryCell | null;
  label: string;
  reason: string;
  provenance: { recordId: string; generator: string; prompt: string } | null;
}
const sameRefs = (left: string[], right: string[]) => left.length === right.length
  && new Set(left).size === left.length && new Set(right).size === right.length
  && left.every(value => right.includes(value));
const sameCrop = (left: unknown, right: StoryCell['crop']) => object(left) && right
  && ['x', 'y', 'width', 'height'].every(key => left[key] === right[key as keyof typeof right]);

function visualProvenance(cell: StoryCell, project: Project, records: WorkspaceRecord[], includeExtraction = true) {
  if (includeExtraction) {
    const extracted = records.filter(record => {
      if (record.kind !== 'storyboard-frame-extraction' || !object(record.data)) return false;
      const data = record.data;
      if (data.schemaVersion !== 1 || data.projectId !== project.id || data.sourceHash !== project.sourceHash
        || data.cellId !== cell.id || data.scope !== 'INTERNAL_STORYBOARD_REFERENCE_ONLY' || data.review !== 'PENDING'
        || !object(data.image) || data.image.sha256 !== cell.imageHash || cell.crop
        || data.image.pixelWidth !== cell.pixelWidth || data.image.pixelHeight !== cell.pixelHeight
        || !object(data.originalCell) || !object(data.parent)) return false;
      const original = data.originalCell;
      return original.id === cell.id && original.sceneId === cell.sceneId && original.shotId === cell.shotId
        && Array.isArray(original.actionRefs) && sameRefs(original.actionRefs, cell.actionRefs ?? [])
        && original.imageHash === data.parent.imageHash && sameCrop(data.parent.crop, original.crop as StoryCell['crop']);
    });
    if (extracted.length === 1) {
      const parent = visualProvenance((extracted[0].data as { originalCell: StoryCell }).originalCell, project, records, false);
      return { value: parent.value, needsReview: parent.needsReview, extracted: true };
    }
    if (extracted.length > 1) return { value: null, needsReview: true, extracted: false };
  }
  let related = false;
  const matches: NonNullable<MovieClipVisual['provenance']>[] = [];
  for (const record of records) {
    if (record.kind !== 'document-draft' || !object(record.data)
      || record.data.typeId !== 'drifter-storyboard-visual-provenance' || record.data.sourceHash !== project.sourceHash
      || typeof record.data.body !== 'string') continue;
    try {
      const value: unknown = JSON.parse(record.data.body);
      if (!object(value) || value.schemaVersion !== 'drifter-generated-concept-provenance/v1'
        || value.projectId !== project.id || value.sourceHash !== project.sourceHash || value.sceneId !== cell.sceneId
        || !Array.isArray(value.mappings)) continue;
      const mapping = value.mappings.find(row => object(row) && row.cellId === cell.id && row.shotId === cell.shotId);
      if (!object(mapping)) continue;
      related = true;
      if (value.classification !== 'GENERATED_CONCEPT' || value.scope !== 'INTERNAL_STORYBOARD_REFERENCE_ONLY'
        || value.review !== 'PENDING' || !object(value.image) || value.image.sha256 !== cell.imageHash
        || value.image.pixelWidth !== cell.pixelWidth || value.image.pixelHeight !== cell.pixelHeight
        || !sameCrop(mapping.pixelCrop, cell.crop) || typeof value.generator !== 'string' || typeof value.prompt !== 'string'
        || !Array.isArray(record.data.dependencyHashes) || !record.data.dependencyHashes.includes(cell.imageHash)) continue;
      matches.push({ recordId: record.id, generator: value.generator, prompt: value.prompt });
    } catch { /* Malformed historical notes never establish image provenance. */ }
  }
  return { value: matches.length === 1 ? matches[0] : null, needsReview: related && matches.length !== 1, extracted: false };
}

/** Read-only candidate association. A shot can contain multiple dramatic beats;
 * its first available image must never stand in for the selected clip's beat.
 * This display binding does not select or rebase a generation starting frame. */
export function deriveMovieClipVisual(clip: MovieClip, project: Project, records: WorkspaceRecord[]): MovieClipVisual {
  const unresolved = (binding: MovieClipVisual['binding'], label: string, reason: string): MovieClipVisual =>
    ({ binding, cell: null, label, reason, provenance: null });
  const scene = project.scenes.find(value => value.id === clip.sceneId);
  if (!scene?.shots.some(shot => shot.id === clip.shotId)) return unresolved('CHANGED', 'Storyboard link needs review', 'The clip no longer matches a shot in this scene.');
  const paragraphIds = new Set(scene.paragraphs.map(row => row.id));
  const cells = project.cells.filter(cell => cell.sceneId === clip.sceneId && cell.shotId === clip.shotId);
  let matched: StoryCell[] = [], binding: MovieClipVisual['binding'];
  let refsOutsideFrame: string[] = [];
  if (clip.id.startsWith('drifter-clip:')) {
    const prefix = `drifter-clip:${project.sourceHash}:`;
    const beat = clip.id.startsWith(prefix)
      ? getDrifterStoryboardBeats(project, clip.sceneId, clip.shotId).find(value => value.id === clip.id.slice(prefix.length)) : undefined;
    if (!beat || !sameRefs(clip.sourceRefs, beat.sourceParagraphIds.filter(ref => paragraphIds.has(ref)))) {
      return unresolved('CHANGED', 'Storyboard link needs review', 'The clip identity or source passages no longer match its retained storyboard beat.');
    }
    const expectedId = `drifter-beat:${project.sourceHash}:${beat.id}`;
    const exact = project.cells.find(cell => cell.id === expectedId);
    if (exact) {
      const imageRefs = exact.actionRefs ?? [];
      const localImageRefs = imageRefs.filter(ref => paragraphIds.has(ref));
      const prologueContext = new Set((project.prologue ?? [])
        .filter(row => beat.sourceParagraphIds.includes(row.id)).map(row => row.id));
      if (exact.sceneId !== clip.sceneId || exact.shotId !== clip.shotId
        || localImageRefs.length === 0 || new Set(imageRefs).size !== imageRefs.length
        || !imageRefs.every(ref => paragraphIds.has(ref) ? clip.sourceRefs.includes(ref) : prologueContext.has(ref))) {
        return unresolved('CHANGED', 'Storyboard link needs review', 'The exact beat cell now has different scene, shot or source associations.');
      }
      // An authored beat may span several actions while its exact image depicts
      // one of them. Keep the complete clip intact and expose that display gap.
      refsOutsideFrame = clip.sourceRefs.filter(ref => !localImageRefs.includes(ref));
      matched = [exact];
    } else {
      // Earlier manually saved beat cells may have non-deterministic IDs. Only
      // the exact authored beat text and source links qualify as an equivalent.
      const allowed = new Set([...paragraphIds, ...(project.prologue ?? []).map(row => row.id)]);
      const crossScene = beat.sourceParagraphIds.filter(ref => !allowed.has(ref));
      const description = `${beat.label}\n${beat.direction}${crossScene.length ? `\nContinuity context from another scene (not coverage links): ${crossScene.join(', ')}` : ''}`;
      matched = cells.filter(cell => cell.description === description
        && sameRefs(cell.actionRefs ?? [], beat.sourceParagraphIds.filter(ref => allowed.has(ref))));
    }
    binding = 'EXACT_BEAT';
  } else {
    matched = clip.sourceRefs.length ? cells.filter(cell => sameRefs(
      (cell.actionRefs ?? []).filter(ref => paragraphIds.has(ref)), clip.sourceRefs)) : [];
    binding = 'UNIQUE_SOURCE';
  }
  if (matched.length > 1) return unresolved('AMBIGUOUS', 'Choose a storyboard frame', 'Several storyboard cells match these source passages. No image is substituted automatically.');
  if (!matched.length) return unresolved('MISSING', 'Linked frame needed', 'No exact storyboard candidate is linked to this clip yet. Other images on the shot remain separate.');
  const cell = matched[0], hasImage = digest(cell.imageHash);
  const provenance = hasImage ? visualProvenance(cell, project, records) : { value: null, needsReview: false, extracted: false };
  return { binding, cell,
    label: !hasImage ? 'Image needed for this beat' : provenance.needsReview ? 'Image provenance needs review'
      : refsOutsideFrame.length ? 'Partial beat image · review coverage'
      : provenance.extracted ? 'Extracted frame · pending review' : provenance.value ? 'Generated concept · pending review' : 'Image candidate · pending review',
    reason: refsOutsideFrame.length ? `Exact storyboard beat · display link only. Source passages outside this frame: ${refsOutsideFrame.join(', ')}. Review the remaining coverage; this image does not approve coverage or production.`
      : binding === 'EXACT_BEAT' ? 'Exact storyboard beat · display link only; review the opening frame before preparation.'
      : 'Unique source-passages match · display link only; review the opening frame before preparation.',
    provenance: provenance.value };
}
