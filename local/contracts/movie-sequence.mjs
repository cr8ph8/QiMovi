import { hashCanonical } from '../kernel/src/canonical-json.mjs';
import { validateMediaRecord } from './media-takes.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const need = (value, code = 'INVALID_MOVIE_SEQUENCE', status = 422) => { if (!value) throw Object.assign(new Error(code), { code, status }); };
const shape = (value, fields) => need(object(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(','));

// An ordered list of proposed clip instances. Repeated coverage-shot identities
// are allowed; neither a clip nor its planned length is completed film material.
export function validateMovieSequence(data, project) {
  shape(data, ['sourceHash', 'title', 'clips', 'status']);
  need(digest(data.sourceHash) && data.sourceHash === project.sourceHash && data.status === 'DRAFT');
  need(typeof data.title === 'string' && data.title.trim().length > 0 && data.title.length <= 200 && !/[\r\n\0]/.test(data.title));
  need(Array.isArray(data.clips) && data.clips.length <= 1000);
  const clipIds = new Set();
  for (const clip of data.clips) {
    shape(clip, ['id', 'sceneId', 'shotId', 'plannedDurationMs', 'sourceRefs', 'note', ...(Object.hasOwn(clip ?? {}, 'briefRef') ? ['briefRef'] : []), ...(Object.hasOwn(clip ?? {}, 'editSelection') ? ['editSelection'] : [])]);
    need(id(clip.id) && !clipIds.has(clip.id)); clipIds.add(clip.id);
    const scene = project.scenes.find(value => value.id === clip.sceneId);
    need(id(clip.sceneId) && id(clip.shotId) && scene && scene.shots.some(shot => shot.id === clip.shotId), 'MOVIE_SEQUENCE_SHOT_MISMATCH');
    need(clip.plannedDurationMs === null || (Number.isSafeInteger(clip.plannedDurationMs) && clip.plannedDurationMs > 0 && clip.plannedDurationMs <= 180000));
    need(Array.isArray(clip.sourceRefs) && new Set(clip.sourceRefs).size === clip.sourceRefs.length && clip.sourceRefs.every(ref => id(ref) && scene.paragraphs.some(paragraph => paragraph.id === ref)), 'MOVIE_SEQUENCE_SOURCE_REF_MISMATCH');
    need(typeof clip.note === 'string' && clip.note.length <= 8000);
    if (Object.hasOwn(clip, 'briefRef')) {
      shape(clip.briefRef, ['id', 'sha256']);
      need(id(clip.briefRef.id) && clip.briefRef.id.startsWith('generation-brief:') && clip.briefRef.id.length > 'generation-brief:'.length && digest(clip.briefRef.sha256), 'MOVIE_SEQUENCE_BRIEF_REF_INVALID');
    }
    if (Object.hasOwn(clip, 'editSelection')) {
      const selection = clip.editSelection;
      shape(selection, ['takeRef', 'reviewRef', 'assetHash', 'inMs', 'outMs']);
      shape(selection.takeRef, ['id', 'sha256']); shape(selection.reviewRef, ['id', 'sha256']);
      need(/^measured-media-take:[a-f0-9]{64}$/.test(selection.takeRef.id) && digest(selection.takeRef.sha256)
        && selection.reviewRef.id === `take-review:${selection.takeRef.sha256}` && digest(selection.reviewRef.sha256)
        && digest(selection.assetHash), 'MOVIE_SEQUENCE_EDIT_REFERENCE_INVALID');
      need(Number.isSafeInteger(selection.inMs) && selection.inMs >= 0 && Number.isSafeInteger(selection.outMs)
        && selection.outMs > selection.inMs && selection.outMs - selection.inMs <= 180000, 'MOVIE_SEQUENCE_EDIT_RANGE_INVALID');
    }
  }
  return data;
}

export function validateMovieSequenceIdentity(recordId, kind) {
  if (kind !== 'movie-sequence' && !recordId?.startsWith('movie-sequence:')) return;
  need(kind === 'movie-sequence' && id(recordId) && recordId.startsWith('movie-sequence:') && recordId.length > 'movie-sequence:'.length, 'MOVIE_SEQUENCE_IDENTITY_MISMATCH');
}

// Exact historical brief revisions remain valid planning references after later
// edits. Current execution readiness must be checked by its own provider flow.
export function validateMovieSequenceReferences(data, resolveReference, { resolveCurrent } = {}) {
  for (const clip of data.clips) {
    if (clip.briefRef) {
      const record = resolveReference(clip.briefRef);
      need(record?.kind === 'generation-brief' && record.id === clip.briefRef.id && record.sha256 === clip.briefRef.sha256 && hashCanonical(record.data) === clip.briefRef.sha256,
        'MOVIE_SEQUENCE_BRIEF_MISSING_OR_CHANGED', 409);
      need(record.data.sourceHash === data.sourceHash && record.data.sceneId === clip.sceneId && record.data.shotIds.includes(clip.shotId), 'MOVIE_SEQUENCE_BRIEF_TARGET_MISMATCH', 409);
    }
    if (clip.editSelection) {
      const selection = clip.editSelection, take = resolveReference(selection.takeRef), review = resolveReference(selection.reviewRef);
      need(take?.kind === 'measured-media-take' && take.id === selection.takeRef.id && take.sha256 === selection.takeRef.sha256
        && hashCanonical(take.data) === take.sha256 && take.id === `measured-media-take:${take.sha256}`, 'MOVIE_SEQUENCE_EDIT_TAKE_MISSING_OR_CHANGED', 409);
      validateMediaRecord(take.kind, take.data);
      need(take.data.sourceHash === data.sourceHash && take.data.sceneId === clip.sceneId && take.data.shotId === clip.shotId
        && take.data.blob.sha256 === selection.assetHash, 'MOVIE_SEQUENCE_EDIT_TAKE_TARGET_MISMATCH', 409);
      need(selection.outMs <= take.data.measurement.durationMs, 'MOVIE_SEQUENCE_EDIT_RANGE_EXCEEDS_MEDIA', 409);
      need(review?.kind === 'take-review' && review.id === selection.reviewRef.id && review.sha256 === selection.reviewRef.sha256
        && hashCanonical(review.data) === review.sha256 && review.id === `take-review:${take.sha256}`, 'MOVIE_SEQUENCE_EDIT_REVIEW_MISSING_OR_CHANGED', 409);
      validateMediaRecord(review.kind, review.data);
      need(review.data.sourceHash === data.sourceHash && review.data.sceneId === clip.sceneId && review.data.takeRef.id === take.id
        && review.data.takeRef.sha256 === take.sha256 && review.data.decision === 'KEEP_CANDIDATE', 'MOVIE_SEQUENCE_EDIT_REVIEW_NOT_KEPT', 409);
      if (resolveCurrent) need(resolveCurrent(review.id)?.sha256 === review.sha256, 'MOVIE_SEQUENCE_EDIT_REVIEW_STALE', 409);
    }
  }
}
