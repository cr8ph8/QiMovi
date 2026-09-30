import { buildScreenplayIndex } from './screenplay-index.mjs';

/** Authoring identity only. None of these IDs replace an admitted film scene. */
export const WRITING_SCENE_LIMIT = 500;
export const WRITING_SCENE_CANDIDATE_LIMIT = 1000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const assert = (condition, message) => { if (!condition) throw Object.assign(new Error(message), { code: 'INVALID_WRITING_SCENE_MAP', status: 422 }); };
const keys = (value, expected) => object(value) && Object.keys(value).sort().join(',') === expected;
const refKey = value => `${value.sha256}:${value.id}`;
const sameRefs = (left, right) => left.length === right.length && left.every((ref, index) => refKey(ref) === refKey(right[index]));
const uniqueRefs = values => [...new Map(values.map(ref => [refKey(ref), { id: ref.id, sha256: ref.sha256 }])).values()].sort((a, b) => refKey(a) < refKey(b) ? -1 : refKey(a) > refKey(b) ? 1 : 0);
const defaultId = () => `writing-scene:${globalThis.crypto.randomUUID()}`;

export function validateWritingSceneMap(value, body) {
  assert(typeof body === 'string', 'A scene map requires exact screenplay text.');
  assert(keys(value, 'predecessorSha256,scenes,schemaVersion') && value.schemaVersion === 1 && (value.predecessorSha256 === null || digest(value.predecessorSha256)), 'Invalid writing scene-map envelope.');
  const parsed = buildScreenplayIndex(body).scenes;
  assert(Array.isArray(value.scenes) && value.scenes.length <= WRITING_SCENE_LIMIT && value.scenes.length === parsed.length, `Scene identity supports at most ${WRITING_SCENE_LIMIT} parsed scenes and must cover every scene.`);
  const ids = new Set(); let candidateCount = 0;
  for (let index = 0; index < value.scenes.length; index++) {
    const scene = value.scenes[index], span = parsed[index];
    assert(keys(scene, 'candidates,end,id,match,previousId,start') && identity(scene.id) && !ids.has(scene.id), 'Writing scenes require unique bounded identities and known fields.');
    ids.add(scene.id);
    assert(Number.isSafeInteger(scene.start) && Number.isSafeInteger(scene.end) && scene.start === span.start && scene.end === span.end, 'Scene identity ranges must match the exact shared screenplay parser.');
    assert(['EXACT', 'OWNER', 'NEW', 'UNRESOLVED'].includes(scene.match) && (scene.previousId === null || identity(scene.previousId)), 'Invalid scene identity match decision.');
    assert(Array.isArray(scene.candidates), 'Scene identity candidates must be an array.');
    for (const ref of scene.candidates) assert(keys(ref, 'id,sha256') && identity(ref.id) && digest(ref.sha256), 'A candidate must bind a scene ID to its exact saved draft revision.');
    assert(sameRefs(scene.candidates, uniqueRefs(scene.candidates)), 'Scene identity candidates must be unique and deterministically ordered.');
    candidateCount += scene.candidates.length;
    assert(candidateCount <= WRITING_SCENE_CANDIDATE_LIMIT, `Scene identity review supports at most ${WRITING_SCENE_CANDIDATE_LIMIT} candidate references per draft.`);
    if (scene.match === 'EXACT') assert(scene.previousId === scene.id, 'An exact match must retain its previous scene ID.');
    if (scene.match === 'OWNER') assert((scene.previousId === null || scene.previousId === scene.id) && !scene.candidates.length, 'An owner decision must resolve the selected identity or explicitly establish a new identity.');
    if (scene.match === 'NEW') assert(scene.previousId === null && !scene.candidates.length, 'A new scene cannot claim prior identity.');
    if (scene.match === 'UNRESOLVED') assert(scene.previousId === null && scene.candidates.length > 0, 'An unresolved scene must retain its possible prior identities.');
  }
  return value;
}

/** Legacy anchors bind the exact previous record digest and ordinal. They do not
 * infer identity from an ordinal across revisions. */
export function listWritingSceneIdentities(data, sha256) {
  if (!data) return [];
  assert(typeof data.body === 'string' && digest(sha256), 'A baseline scene map requires a saved draft and its exact revision digest.');
  if (data.sceneMap !== undefined) validateWritingSceneMap(data.sceneMap, data.body);
  return buildScreenplayIndex(data.body).scenes.map((scene, index) => ({
    id: data.sceneMap?.scenes[index].id ?? `writing-scene:legacy:${sha256}:${String(index + 1).padStart(4, '0')}`,
    heading: scene.heading, index: index + 1, start: scene.start, end: scene.end, text: scene.text,
    candidates: (data.sceneMap?.scenes[index].candidates ?? []).map(ref => ({ ...ref })),
  }));
}

function textCounts(scenes) {
  const counts = new Map();
  for (const scene of scenes) counts.set(scene.text, (counts.get(scene.text) ?? 0) + 1);
  return counts;
}

function availableCandidates(baseline, sha256, retainedIds) {
  return uniqueRefs(baseline.filter(scene => !retainedIds.has(scene.id)).flatMap(scene => [{ id: scene.id, sha256 }, ...scene.candidates]));
}

/** A failed proposal is data, not an exception during ordinary typing. The
 * caller retains the text and can present the bounded mapping problem. Cache
 * createId results or the proposal while saving/retrying the same draft. */
export function proposeWritingSceneMap(body, baselineData = null, baselineSha256 = null, choices = {}, createId = defaultId) {
  try {
    assert(typeof body === 'string', 'A scene map requires exact screenplay text.');
    assert((baselineData === null && baselineSha256 === null) || (object(baselineData) && digest(baselineSha256)), 'A scene map requires an exact saved baseline revision.');
    const current = buildScreenplayIndex(body).scenes;
    assert(current.length <= WRITING_SCENE_LIMIT, `Scene identity supports at most ${WRITING_SCENE_LIMIT} scenes. Your writing is retained.`);
    const baseline = listWritingSceneIdentities(baselineData, baselineSha256);
    const oldCounts = textCounts(baseline), newCounts = textCounts(current);
    const knownIds = new Set(baseline.flatMap(scene => [scene.id, ...scene.candidates.map(ref => ref.id)]));
    const retained = new Set(), result = new Array(current.length);
    assert(object(choices), 'Scene identity choices must be indexed by the current scene.');
    for (const [key, choice] of Object.entries(choices)) {
      const index = Number(key);
      assert(/^(0|[1-9]\d*)$/.test(key) && Number.isSafeInteger(index) && index < current.length, 'A scene identity choice targets an unknown current scene.');
      assert(keys(choice, 'kind') && choice.kind === 'NEW' || keys(choice, 'kind,previousId') && choice.kind === 'OWNER' && identity(choice.previousId), 'Invalid owner scene identity choice.');
      const previousId = choice.kind === 'OWNER' ? choice.previousId : null;
      if (previousId !== null) {
        assert(knownIds.has(previousId) && !retained.has(previousId), 'That prior scene identity is unavailable or already selected by another scene.');
        retained.add(previousId);
      }
      result[index] = { id: previousId ?? createId(current[index], index), start: current[index].start, end: current[index].end, match: 'OWNER', previousId, candidates: [] };
    }
    for (let index = 0; index < current.length; index++) {
      if (result[index]) continue;
      const scene = current[index];
      // The entire unchanged saved body provides exact range correspondence,
      // including duplicate scenes. No correspondence is inferred after edits.
      const exact = baselineData?.sceneMap && baselineData.body === body ? baseline[index] : oldCounts.get(scene.text) === 1 && newCounts.get(scene.text) === 1 ? baseline.find(previous => previous.text === scene.text) : null;
      if (exact && !retained.has(exact.id)) {
        retained.add(exact.id);
        result[index] = { id: exact.id, start: scene.start, end: scene.end, match: 'EXACT', previousId: exact.id, candidates: uniqueRefs(exact.candidates) };
      }
    }
    const candidates = availableCandidates(baseline, baselineSha256, retained);
    for (let index = 0; index < current.length; index++) if (!result[index]) {
      const scene = current[index];
      result[index] = { id: createId(scene, index), start: scene.start, end: scene.end, match: candidates.length ? 'UNRESOLVED' : 'NEW', previousId: null, candidates: candidates.map(ref => ({ ...ref })) };
    }
    const map = { schemaVersion: 1, predecessorSha256: baselineSha256, scenes: result };
    validateWritingSceneTransition({ body, sceneMap: map }, baselineData === null ? null : { data: baselineData, sha256: baselineSha256 });
    const comparisons = result.map((scene, sceneIndex) => {
      const previous = baseline.find(row => row.id === scene.previousId);
      const status = scene.candidates.length ? 'NEEDS_REVIEW' : scene.previousId === null ? 'NEW' : !previous || previous.text !== current[sceneIndex].text ? 'EDITED' : previous.index !== sceneIndex + 1 ? 'MOVED' : 'UNCHANGED';
      return { sceneIndex, id: scene.id, status, previousId: scene.previousId, candidates: scene.candidates.map(ref => ({ ...ref })) };
    });
    const liveIds = new Set(result.map(scene => scene.id));
    const removed = baseline.filter(scene => !liveIds.has(scene.id)).map(({ id, heading, index }) => ({ id, heading, index }));
    return { map, comparisons, removed };
  } catch (error) {
    return { map: null, comparisons: [], removed: [], error: error instanceof Error ? error.message : 'Scene identity could not be prepared. Your writing is retained.' };
  }
}

/** Validate inside the same transaction/CAS boundary as the screenplay save.
 * An OWNER flag records an owner-session decision; it is not a credential. */
export function validateWritingSceneTransition(data, previousRecord = null) {
  if (data.sceneMap === undefined) {
    assert(previousRecord?.data?.sceneMap === undefined, 'An existing writing scene map cannot be silently removed.');
    return data;
  }
  const map = validateWritingSceneMap(data.sceneMap, data.body);
  assert(map.predecessorSha256 === (previousRecord?.sha256 ?? null), 'The scene identity map refers to a stale saved draft revision.');
  const baseline = listWritingSceneIdentities(previousRecord?.data ?? null, previousRecord?.sha256 ?? null);
  const current = buildScreenplayIndex(data.body).scenes, oldCounts = textCounts(baseline), newCounts = textCounts(current);
  const knownIds = new Set(baseline.flatMap(scene => [scene.id, ...scene.candidates.map(ref => ref.id)]));
  const retainedIds = new Set(map.scenes.filter(scene => scene.previousId !== null).map(scene => scene.id));
  const candidates = availableCandidates(baseline, previousRecord?.sha256 ?? null, retainedIds);
  for (let index = 0; index < map.scenes.length; index++) {
    const scene = map.scenes[index], previous = baseline.find(row => row.id === scene.previousId);
    if (scene.match === 'EXACT') {
      const unchangedBodyRange = previousRecord?.data?.sceneMap && previousRecord.data.body === data.body && previous?.start === current[index].start && previous?.end === current[index].end;
      assert(previous && previous.text === current[index].text && (unchangedBodyRange || oldCounts.get(current[index].text) === 1 && newCounts.get(current[index].text) === 1), 'Only a unique exact scene-text match or an unchanged saved body may automatically retain identity. Review edited or duplicate scenes.');
      assert(sameRefs(scene.candidates, uniqueRefs(previous.candidates)), 'Unresolved scene identity candidates must survive later exact saves.');
    } else if (scene.match === 'OWNER' && scene.previousId !== null) {
      assert(knownIds.has(scene.previousId), 'The selected prior identity is not present in this saved draft or its retained review candidates.');
    } else {
      assert(!knownIds.has(scene.id), 'A new or unresolved scene cannot silently reuse a prior identity.');
      if (scene.match === 'NEW') assert(candidates.length === 0, 'Unmatched previous scenes require review before establishing an unrelated new scene.');
      if (scene.match === 'UNRESOLVED') assert(sameRefs(scene.candidates, candidates), 'Unresolved scene identity must retain the available previous candidates.');
    }
  }
  return data;
}
