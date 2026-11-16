import { validateMovieSequenceIdentity } from './movie-sequence.mjs';

export const MOVIE_SELECTION_PREVIEW_SCHEMA = 'qimovi-movie-selection-preview/v1';
export const MOVIE_SELECTION_REPLAY_SCHEMA = 'qimovi-movie-selection-replay/v1';
export const MOVIE_SELECTION_ACTOR = 'local-owner';
export const MOVIE_SELECTION_SCOPE = 'CANDIDATE_PREFERENCE_ONLY';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const need = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code, status: 422 }); };

export function validateMovieSelectionRequest(input, { commit = false } = {}) {
  const fields = ['recordId', 'expectedVersion', 'data', 'requestId', ...(commit ? ['previewSha256'] : [])];
  need(object(input) && Object.keys(input).sort().join(',') === fields.sort().join(','), 'MOVIE_SELECTION_FIELDS_INVALID');
  validateMovieSequenceIdentity(input.recordId, 'movie-sequence');
  need(id(input.requestId), 'MOVIE_SELECTION_REQUEST_ID_INVALID');
  need(input.expectedVersion === null || Number.isSafeInteger(input.expectedVersion) && input.expectedVersion > 0 && input.expectedVersion < 2147483647, 'MOVIE_SELECTION_VERSION_INVALID');
  need(object(input.data), 'MOVIE_SELECTION_DATA_INVALID');
  if (commit) need(digest(input.previewSha256), 'MOVIE_SELECTION_PREVIEW_INVALID');
  return input;
}

export function movieSelectionRequestBasis(input) {
  return { recordId: input.recordId, expectedVersion: input.expectedVersion, data: input.data, requestId: input.requestId };
}

export function movieSequenceHasSelection(data) {
  return Array.isArray(data?.clips) && data.clips.some(clip => object(clip) && Object.hasOwn(clip, 'editSelection'));
}
