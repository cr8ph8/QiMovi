import { canonicalJson, hashCanonical } from './canonical';
import type { RecordInput } from './types';
import type { MovieSequence } from './movieSequenceModel';

type Post = (action: 'prepare' | 'commit', input: unknown) => Promise<unknown>;
type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: unknown, keys: string[]): value is JsonObject => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const version = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const mismatch = () => new Error('The selected media or sequence changed. Reload the saved records and review the selection before saving again.');

/** The caller's existing Save action remains the commit authorization. A preview
 * performs no write. A hash binds the exact attempt; it grants no new authority. */
export async function saveMovieSelection(input: RecordInput<MovieSequence>, post: Post): Promise<unknown> {
  // Freeze before the first await; later UI edits belong to another attempt.
  const frozen = JSON.parse(canonicalJson(input)) as RecordInput<MovieSequence>;
  const request = { recordId: frozen.id, expectedVersion: frozen.expectedVersion, data: frozen.data, requestId: frozen.requestId };
  const value = await post('prepare', request);
  if (object(value) && value.schemaVersion === 'qimovi-movie-selection-replay/v1') {
    if (!exact(value, ['schemaVersion', 'recordId', 'requestId', 'record']) || value.recordId !== frozen.id || value.requestId !== frozen.requestId) throw mismatch();
    // The workspace API still verifies the full record, version, kind and data.
    return value.record;
  }
  if (!exact(value, ['schemaVersion', 'recordId', 'requestId', 'expectedVersion', 'baseRef', 'candidateSha256', 'projectSha256', 'actorId', 'scope', 'bindings', 'previewSha256'])
    || value.schemaVersion !== 'qimovi-movie-selection-preview/v1' || value.recordId !== frozen.id || value.requestId !== frozen.requestId
    || value.expectedVersion !== frozen.expectedVersion || value.actorId !== 'local-owner' || value.scope !== 'CANDIDATE_PREFERENCE_ONLY'
    || !digest(value.candidateSha256) || !digest(value.projectSha256) || !digest(value.previewSha256) || !Array.isArray(value.bindings)) throw mismatch();
  if (frozen.expectedVersion === null) {
    if (value.baseRef !== null) throw mismatch();
  } else if (!exact(value.baseRef, ['id', 'version', 'sha256']) || value.baseRef.id !== frozen.id
    || value.baseRef.version !== frozen.expectedVersion || !digest(value.baseRef.sha256)) throw mismatch();

  const selected = frozen.data.clips.filter(clip => clip.editSelection);
  if (value.bindings.length !== selected.length) throw mismatch();
  for (const [index, clip] of selected.entries()) {
    const binding = value.bindings[index], selection = clip.editSelection!;
    if (!exact(binding, ['clipId', 'sceneId', 'shotId', 'takeRef', 'reviewRef', 'assetHash', 'inMs', 'outMs', 'reviewActor', 'reviewScope'])
      || binding.clipId !== clip.id || binding.sceneId !== clip.sceneId || binding.shotId !== clip.shotId
      || binding.assetHash !== selection.assetHash || binding.inMs !== selection.inMs || binding.outMs !== selection.outMs
      || binding.reviewActor !== 'local-owner' || binding.reviewScope !== 'CANDIDATE_PREFERENCE_ONLY') throw mismatch();
    for (const key of ['takeRef', 'reviewRef'] as const) {
      if (!exact(binding[key], ['id', 'version', 'sha256']) || !version(binding[key].version)
        || binding[key].id !== selection[key].id || binding[key].sha256 !== selection[key].sha256) throw mismatch();
    }
  }
  const { previewSha256, ...descriptor } = value;
  if (await hashCanonical(frozen.data) !== value.candidateSha256 || await hashCanonical(descriptor) !== previewSha256) throw mismatch();
  return post('commit', { ...request, previewSha256 });
}
