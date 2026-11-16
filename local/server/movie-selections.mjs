import { canonical, check, sha256 } from './storage.mjs';
import { createHash } from 'node:crypto';
import { validateMovieSequence } from '../contracts/movie-sequence.mjs';
import { MOVIE_SELECTION_PREVIEW_SCHEMA, MOVIE_SELECTION_REPLAY_SCHEMA, MOVIE_SELECTION_ACTOR, MOVIE_SELECTION_SCOPE, validateMovieSelectionRequest, movieSelectionRequestBasis } from '../contracts/movie-selection.mjs';

const ref = record => record ? { id: record.id, version: record.version, sha256: record.sha256 } : null;

// A resolved project combines separately bounded records and may exceed the
// canonical serializer's single-document limit. Hash its trusted projection as
// a tree without relaxing any request/record bounds. Fixed-size child digests,
// explicit type/length tags and canonical key boundaries preserve all content,
// object member equivalence and array order without ambiguous concatenation.
function projectDigest(value) {
  const hash = createHash('sha256').update('qimovi-movie-project-basis/v1\0');
  if (Array.isArray(value)) {
    hash.update(`ARRAY\0${value.length}\0`);
    for (const child of value) hash.update(projectDigest(child), 'hex');
  } else if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    hash.update(`OBJECT\0${keys.length}\0`);
    for (const key of keys) hash.update(canonical(key)).update('\0').update(projectDigest(value[key]), 'hex');
  } else hash.update('VALUE\0').update(canonical(value));
  return hash.digest('hex');
}

// This proof records the local owner's candidate preference, not final approval
// or a signature. Its authority comes from the owner-only route and the trusted
// store entry point; every relationship is derived again inside the write lock.
export function createMovieSelectionService(store) {
  function compute(input) {
    const project = store.resolvedProject();
    check(project, 'PROJECT_NOT_SEEDED', 409);
    const current = store.rawList().find(record => record.id === input.recordId) ?? null;
    check(!current || current.kind === 'movie-sequence' && sha256(canonical(current.data)) === current.sha256, 'MOVIE_SELECTION_BASE_CHANGED', 409);
    check((current?.version ?? null) === input.expectedVersion, 'VERSION_CONFLICT', 409);
    validateMovieSequence(input.data, project);
    store.validateMovieSequenceReferences('movie-sequence', input.data, undefined, { newWrite: true });
    const bindings = input.data.clips.filter(clip => clip.editSelection).map(clip => {
      const selection = clip.editSelection;
      const take = store.history(selection.takeRef.id).find(record => record.sha256 === selection.takeRef.sha256);
      const review = store.history(selection.reviewRef.id).at(-1);
      check(take && review?.sha256 === selection.reviewRef.sha256, 'MOVIE_SEQUENCE_EDIT_REVIEW_STALE', 409);
      check(review.data.actor === MOVIE_SELECTION_ACTOR && review.data.scope === MOVIE_SELECTION_SCOPE, 'MOVIE_SELECTION_REVIEW_AUTHORITY_INVALID', 409);
      return { clipId: clip.id, sceneId: clip.sceneId, shotId: clip.shotId, takeRef: ref(take), reviewRef: ref(review),
        assetHash: selection.assetHash, inMs: selection.inMs, outMs: selection.outMs,
        reviewActor: review.data.actor, reviewScope: review.data.scope };
    });
    const descriptor = { schemaVersion: MOVIE_SELECTION_PREVIEW_SCHEMA, recordId: input.recordId, requestId: input.requestId,
      expectedVersion: input.expectedVersion, baseRef: ref(current), candidateSha256: sha256(canonical(input.data)),
      projectSha256: projectDigest(project), actorId: MOVIE_SELECTION_ACTOR, scope: MOVIE_SELECTION_SCOPE, bindings };
    return { ...descriptor, previewSha256: sha256(canonical(descriptor)) };
  }
  return {
    prepare(value) {
      validateMovieSelectionRequest(value);
      const input = JSON.parse(canonical(value));
      const replay = store.replayMovieSelectionRequest(input);
      if (replay) return { schemaVersion: MOVIE_SELECTION_REPLAY_SCHEMA, recordId: input.recordId, requestId: input.requestId, record: replay };
      return compute(input);
    },
    commit(value) {
      validateMovieSelectionRequest(value, { commit: true });
      const input = JSON.parse(canonical(value));
      return store.commitMovieSelection(input, () => {
        check(store.db.isTransaction, 'MOVIE_SELECTION_TRANSACTION_REQUIRED', 409);
        const preview = compute(movieSelectionRequestBasis(input));
        check(preview.previewSha256 === input.previewSha256, 'MOVIE_SELECTION_PREVIEW_STALE', 409);
      });
    },
  };
}
