import { validateCreativeProject } from './creative-project.mjs';
import { buildProductionAttachment, productionAttachmentId, validateProductionAttachment, validateProductionAttachmentRequest } from './production-attachment.mjs';
import { validateWritingProductionPlan, validateWritingProductionRecord, writingProductionPlanId } from './writing-production.mjs';
import { listWritingSceneIdentities, validateWritingSceneTransition } from './writing-scene-map.mjs';
import { canonicalJson } from '../kernel/src/canonical-json-core.mjs';

const need = (value, code, status = 409) => { if (!value) throw Object.assign(new Error(code), { code, status }); };
const ref = ({ id, version, sha256 }) => ({ id, version, sha256 });
const same = (left, right) => canonicalJson(left) === canonicalJson(right);
const identity = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validRecord = record => record && identity(record.id) && identity(record.kind) && Number.isSafeInteger(record.version) && record.version > 0 && digest(record.sha256);
const status = (before, after, changes) => !before ? 'added' : !after ? 'removed' : changes.length ? 'changed' : 'unchanged';
const union = (before, after) => [...new Set([...before, ...after])];
const counts = deltas => deltas.reduce((out, delta) => { out[delta.status]++; if (delta.reordered) out.reordered++; return out; }, { added: 0, removed: 0, changed: 0, unchanged: 0, reordered: 0 });
const snapshot = scene => scene ? { ordinal: scene.ordinal, heading: scene.heading, textSha256: scene.textSha256, notes: scene.notes, characters: [...scene.characters], shotIds: scene.shots.map(shot => shot.id) } : null;

/** Compare retained order only: inserting or removing coverage does not itself reorder surviving IDs. */
function reorderedIds(before, after) {
  const oldSet = new Set(before), newSet = new Set(after), oldOrder = before.filter(id => newSet.has(id)), newOrder = after.filter(id => oldSet.has(id));
  return new Set(oldOrder.filter((id, index) => newOrder[index] !== id));
}

export function validateProductionRevisionRequest(input) {
  return validateProductionAttachmentRequest('prepare', input);
}

function coverageReuseIds(attachment, candidateDraft, draftHistory, hash) {
  const baseline = attachment.data.draftRef;
  need(candidateDraft.id === baseline.id && candidateDraft.version >= baseline.version, 'PRODUCTION_REVISION_DRAFT_LINEAGE_REQUIRED');
  const history = draftHistory.length ? draftHistory : [candidateDraft];
  const start = history.findIndex(row => same(ref(row), baseline)), end = history.findIndex(row => same(ref(row), ref(candidateDraft)));
  need(start >= 0 && end >= start && end - start === candidateDraft.version - baseline.version, 'PRODUCTION_REVISION_DRAFT_LINEAGE_REQUIRED');
  const roots = new Set(attachment.data.projection.scenes.map(scene => scene.id));
  const occurrenceKey = (id, sha256) => `${sha256}:${id}`;
  const provenOccurrences = new Set();
  let eligible = new Set(), previousScenes = [];
  for (let index = start; index <= end; index++) {
    const row = history[index];
    need(row.kind === 'screenplay-draft' && row.id === baseline.id && row.version === baseline.version + index - start && hash(canonicalJson(row.data)) === row.sha256, 'PRODUCTION_REVISION_DRAFT_LINEAGE_INVALID');
    if (index > start) validateWritingSceneTransition(row.data, history[index - 1]);
    const scenes = listWritingSceneIdentities(row.data, row.sha256);
    const carriedById = new Map();
    for (const previous of previousScenes) for (const candidate of previous.candidates) {
      const carried = carriedById.get(candidate.id) ?? [];
      carried.push(candidate); carriedById.set(candidate.id, carried);
    }
    const nextEligible = new Set();
    for (const [sceneIndex, scene] of scenes.entries()) {
      if (!roots.has(scene.id) || scene.candidates.length) continue;
      const decision = row.data.sceneMap?.scenes[sceneIndex];
      // An unresolved save suspends reuse, but retains exact candidate refs.
      // Only explicit OWNER resolution can recover their proved lineage. A
      // coincidentally reused ID from NEW has no proved occurrence at its SHA.
      const carried = carriedById.get(scene.id) ?? [];
      const resolvedCandidate = decision?.match === 'OWNER' && decision.previousId === scene.id && carried.length > 0
        && carried.every(candidate => provenOccurrences.has(occurrenceKey(candidate.id, candidate.sha256)));
      const continued = ['EXACT', 'OWNER'].includes(decision?.match) && decision.previousId === scene.id && eligible.has(scene.id);
      if (index === start || continued || resolvedCandidate) nextEligible.add(scene.id);
    }
    eligible = nextEligible;
    for (const id of eligible) provenOccurrences.add(occurrenceKey(id, row.sha256));
    previousScenes = scenes;
  }
  return [...roots].filter(id => eligible.has(id));
}

function affectedRecords(records, projectId, attachment, candidate, sceneDeltas, shotDeltas, materialChanged) {
  const changedScenes = new Set(sceneDeltas.filter(row => row.status !== 'unchanged' || row.reordered).map(row => row.sceneId));
  const changedShots = new Set(shotDeltas.filter(row => row.status !== 'unchanged' || row.reordered).map(row => row.shotId));
  // Paragraph identities bind an exact draft revision and byte range. A different
  // draft reference invalidates that binding even when the visible line is equal.
  const draftChanged = !same(attachment.data.draftRef, candidate.data.source.draftRef);
  const changedParagraphs = new Set(draftChanged ? [...attachment.data.projection.prologue, ...attachment.data.projection.scenes.flatMap(scene => scene.paragraphs)].map(paragraph => paragraph.id) : []);
  const budgetTargets = new Set([
    ...[...changedScenes].map(id => `scene:${id}`),
    ...shotDeltas.filter(row => changedShots.has(row.shotId)).map(row => `shot:${row.sceneId}:${row.shotId}`),
  ]);
  const ignored = new Set(['production-attachment', 'writing-production-plan', 'screenplay-draft']);
  const output = [];
  for (const record of records) {
    need(validRecord(record), 'PRODUCTION_REVISION_RECORD_INVALID');
    if (ignored.has(record.kind) || record.data?.projectId && record.data.projectId !== projectId) continue;
    const reasons = new Set();
    if (materialChanged && record.data?.sourceHash === attachment.data.sourceHash) reasons.add('BOUND_SOURCE_SCOPE');
    const inspect = value => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(inspect); return; }
      for (const [key, item] of Object.entries(value)) {
        const values = Array.isArray(item) ? item : [item];
        if (['sceneId', 'sceneIds'].includes(key) && values.some(id => changedScenes.has(id))) reasons.add('EXPLICIT_SCENE_ID');
        if (['shotId', 'shotIds'].includes(key) && values.some(id => changedShots.has(id))) reasons.add('EXPLICIT_SHOT_ID');
        if (['paragraphId', 'paragraphIds', 'actionRefs'].includes(key) && values.some(id => changedParagraphs.has(id))) reasons.add('EXACT_PARAGRAPH_BINDING');
        if (['targetId', 'coveredTargetIds'].includes(key) && values.some(id => budgetTargets.has(id))) reasons.add('EXPLICIT_BUDGET_TARGET');
        inspect(item);
      }
    };
    inspect(record.data);
    if (reasons.size) output.push({ ref: ref(record), kind: record.kind, reasons: [...reasons].sort() });
  }
  return output.sort((a, b) => a.ref.id < b.ref.id ? -1 : a.ref.id > b.ref.id ? 1 : a.ref.version - b.ref.version);
}

/** Deterministic, read-only impact review of immutable attachment and saved plan.
 * Scene and shot matching uses exact IDs. Headings and ordinals are display data.
 */
export function buildProductionRevisionPreview(base, attachment, baselinePlan, candidateDraft, candidatePlan, records, hash, draftHistory = []) {
  validateCreativeProject(base);
  need(validRecord(attachment) && attachment.kind === 'production-attachment' && attachment.id === productionAttachmentId(base.id) && attachment.version === 1 && hash(canonicalJson(attachment.data)) === attachment.sha256, 'PRODUCTION_REVISION_ATTACHMENT_INVALID');
  validateProductionAttachment(attachment.data, base);
  need(validRecord(baselinePlan) && baselinePlan.kind === 'writing-production-plan' && same(ref(baselinePlan), attachment.data.planRef) && hash(canonicalJson(baselinePlan.data)) === baselinePlan.sha256, 'PRODUCTION_REVISION_BASELINE_PLAN_INVALID');
  validateWritingProductionPlan(baselinePlan.data, base);
  need(baselinePlan.id === writingProductionPlanId(base.id, baselinePlan.data.source.draftRef, hash) && same(baselinePlan.data.source.draftRef, attachment.data.draftRef) && baselinePlan.data.source.bodySha256 === attachment.data.sourceHash, 'PRODUCTION_REVISION_BASELINE_SOURCE_INVALID');
  need(validRecord(candidatePlan) && candidatePlan.kind === 'writing-production-plan' && hash(canonicalJson(candidatePlan.data)) === candidatePlan.sha256, 'PRODUCTION_REVISION_CANDIDATE_PLAN_INVALID');
  validateWritingProductionRecord(candidatePlan, base, wanted => candidateDraft && same(ref(candidateDraft), wanted) ? candidateDraft : null, hash);
  const coverageReuseSceneIds = coverageReuseIds(attachment, candidateDraft, draftHistory, hash);
  // A plan with no shots is reviewable coverage work. Attachment still requires
  // coverage; never manufacture a shot to bypass its stricter contract.
  const projected = candidatePlan.data.scenes.some(scene => scene.shots.length) ? buildProductionAttachment(base, candidateDraft, candidatePlan, hash) : null;
  const candidateSourceHash = projected?.sourceHash ?? candidatePlan.data.source.bodySha256;
  const baselineScenes = baselinePlan.data.scenes, candidateScenes = candidatePlan.data.scenes;
  const oldScenes = new Map(baselineScenes.map(scene => [scene.sceneId, scene])), newScenes = new Map(candidateScenes.map(scene => [scene.sceneId, scene]));
  const sceneOrder = reorderedIds([...oldScenes.keys()], [...newScenes.keys()]);
  const oldShotScenes = new Map(baselineScenes.flatMap(scene => scene.shots.map(shot => [shot.id, scene.sceneId])));
  for (const scene of candidateScenes) for (const shot of scene.shots) need(!oldShotScenes.has(shot.id) || oldShotScenes.get(shot.id) === scene.sceneId, 'PRODUCTION_REVISION_SHOT_SCENE_MISMATCH');
  const shotDeltas = [], sceneDeltas = [];
  for (const sceneId of union([...oldScenes.keys()], [...newScenes.keys()])) {
    const previous = oldScenes.get(sceneId), next = newScenes.get(sceneId), before = snapshot(previous), after = snapshot(next);
    const oldShots = new Map((previous?.shots ?? []).map((shot, index) => [shot.id, { ...shot, ordinal: index + 1 }])), newShots = new Map((next?.shots ?? []).map((shot, index) => [shot.id, { ...shot, ordinal: index + 1 }]));
    const shotOrder = reorderedIds([...oldShots.keys()], [...newShots.keys()]);
    const shots = union([...oldShots.keys()], [...newShots.keys()]).map(shotId => {
      const before = oldShots.get(shotId) ?? null, after = newShots.get(shotId) ?? null;
      const changes = before && after ? ['title', 'description', 'shotType', 'cameraMovement', 'durationSeconds'].filter(key => before[key] !== after[key]) : [];
      return { shotId, sceneId, status: status(before, after, changes), reordered: shotOrder.has(shotId), changes, before, after };
    });
    shotDeltas.push(...shots);
    const changes = before && after ? ['heading', 'textSha256', 'notes', 'characters'].filter(key => !same(before[key], after[key])) : [];
    if (before && after && shots.some(shot => shot.status !== 'unchanged' || shot.reordered)) changes.push('shots');
    sceneDeltas.push({ sceneId, status: status(before, after, changes), reordered: sceneOrder.has(sceneId), changes, before, after });
  }
  const oldCues = baselinePlan.data.source.characters, newCues = candidatePlan.data.source.characters;
  const characterCues = { added: newCues.filter(name => !oldCues.includes(name)), removed: oldCues.filter(name => !newCues.includes(name)), unchanged: oldCues.filter(name => newCues.includes(name)) };
  const metadata = plan => ({ title: plan.data.source.title, scenes: plan.data.scenes.map(scene => ({ sceneId: scene.sceneId, notes: scene.notes, shots: scene.shots })) });
  const sourceChanged = candidateSourceHash !== attachment.data.sourceHash, metadataChanged = !same(metadata(baselinePlan), metadata(candidatePlan));
  const impacted = affectedRecords(records, base.id, attachment, candidatePlan, sceneDeltas, shotDeltas, sourceChanged || metadataChanged);
  const preview = { schemaVersion: 1, status: 'REVIEW_ONLY', scope: 'REVIEW_ONLY', projectId: base.id, attachmentRef: ref(attachment), baselinePlanRef: ref(baselinePlan), baselineDraftRef: { ...attachment.data.draftRef }, candidatePlanRef: ref(candidatePlan), candidateDraftRef: { ...candidatePlan.data.source.draftRef },
    baselineSourceHash: attachment.data.sourceHash, candidateSourceHash, sourceChanged, metadataChanged, sceneDeltas, shotDeltas, characterCues, affectedRecords: impacted,
    summary: { scenes: counts(sceneDeltas), shots: counts(shotDeltas), characterCuesAdded: characterCues.added.length, characterCuesRemoved: characterCues.removed.length, affectedRecords: impacted.length },
    unplannedSceneIds: candidateScenes.filter(scene => !scene.shots.length).map(scene => scene.sceneId), coverageReuseSceneIds,
    explanation: 'Review only. Active production retains its attached source, scenes, shots, assets, and budget. Affected records are conservative review references, not automatic revisions or new costs. Scene and shot correspondence uses exact saved identities only.' };
  return validateProductionRevisionPreview({ ...preview, previewSha256: hash(canonicalJson(preview)) });
}

/** Validate the bounded wire shape. Consumers additionally bind/hash the response
 * against the attachment and requested plan they are currently displaying. */
export function validateProductionRevisionPreview(value) {
  const object = item => item !== null && typeof item === 'object' && !Array.isArray(item);
  const exact = (item, fields) => object(item) && Object.keys(item).sort().join(',') === [...fields].sort().join(',');
  const array = (item, max) => Array.isArray(item) && item.length <= max;
  const text = (item, max) => typeof item === 'string' && item.length <= max && item.isWellFormed() && !item.includes('\0');
  const saved = item => exact(item, ['id', 'version', 'sha256']) && identity(item.id) && Number.isSafeInteger(item.version) && item.version > 0 && digest(item.sha256);
  const strings = (item, max, limit) => array(item, max) && item.every(value => text(value, limit)) && new Set(item).size === item.length;
  const ids = (item, max) => strings(item, max, 160) && item.every(identity);
  const integer = item => Number.isSafeInteger(item) && item >= 0;
  const fail = condition => need(condition, 'PRODUCTION_REVISION_PREVIEW_INVALID', 422);
  fail(exact(value, ['schemaVersion', 'status', 'scope', 'projectId', 'attachmentRef', 'baselinePlanRef', 'baselineDraftRef', 'candidatePlanRef', 'candidateDraftRef', 'baselineSourceHash', 'candidateSourceHash', 'sourceChanged', 'metadataChanged', 'sceneDeltas', 'shotDeltas', 'characterCues', 'affectedRecords', 'summary', 'unplannedSceneIds', 'coverageReuseSceneIds', 'explanation', 'previewSha256']));
  fail(value.schemaVersion === 1 && value.status === 'REVIEW_ONLY' && value.scope === 'REVIEW_ONLY' && identity(value.projectId));
  for (const key of ['attachmentRef', 'baselinePlanRef', 'baselineDraftRef', 'candidatePlanRef', 'candidateDraftRef']) fail(saved(value[key]));
  fail(value.attachmentRef.id === productionAttachmentId(value.projectId) && value.attachmentRef.version === 1);
  for (const key of ['baselinePlanRef', 'candidatePlanRef']) validateProductionAttachmentRequest('prepare', { projectId: value.projectId, planRef: value[key] });
  fail(value.baselineDraftRef.id.startsWith('screenplay-draft:') && value.candidateDraftRef.id === value.baselineDraftRef.id && value.candidateDraftRef.version >= value.baselineDraftRef.version);
  fail(['baselineSourceHash', 'candidateSourceHash', 'previewSha256'].every(key => digest(value[key])) && typeof value.sourceChanged === 'boolean' && typeof value.metadataChanged === 'boolean' && value.sourceChanged === (value.baselineSourceHash !== value.candidateSourceHash));
  const sceneSnapshot = item => exact(item, ['ordinal', 'heading', 'textSha256', 'notes', 'characters', 'shotIds']) && integer(item.ordinal) && item.ordinal > 0 && text(item.heading, 1000) && digest(item.textSha256) && text(item.notes, 10000) && strings(item.characters, 500, 200) && ids(item.shotIds, 100);
  const shotSnapshot = item => exact(item, ['id', 'title', 'description', 'shotType', 'cameraMovement', 'durationSeconds', 'ordinal']) && identity(item.id) && text(item.title, 200) && text(item.description, 10000) && text(item.shotType, 120) && text(item.cameraMovement, 200) && (item.durationSeconds === null || integer(item.durationSeconds) && item.durationSeconds > 0 && item.durationSeconds <= 3600) && integer(item.ordinal) && item.ordinal > 0;
  for (const [key, idKey, fields, snapshotValidator, limit] of [
    ['sceneDeltas', 'sceneId', ['sceneId', 'status', 'reordered', 'changes', 'before', 'after'], sceneSnapshot, 1000],
    ['shotDeltas', 'shotId', ['shotId', 'sceneId', 'status', 'reordered', 'changes', 'before', 'after'], shotSnapshot, 2000],
  ]) {
    fail(array(value[key], limit));
    const seen = new Set();
    for (const row of value[key]) {
      fail(exact(row, fields) && identity(row[idKey]) && !seen.has(row[idKey]) && identity(row.sceneId) && ['added', 'removed', 'changed', 'unchanged'].includes(row.status) && typeof row.reordered === 'boolean' && strings(row.changes, 10, 40));
      seen.add(row[idKey]);
      fail((row.before === null || snapshotValidator(row.before)) && (row.after === null || snapshotValidator(row.after)) && (row.before !== null || row.after !== null));
      fail(row.status === status(row.before, row.after, row.changes) && (!row.reordered || row.before !== null && row.after !== null));
      if (key === 'shotDeltas') fail((!row.before || row.before.id === row.shotId) && (!row.after || row.after.id === row.shotId));
    }
  }
  fail(exact(value.characterCues, ['added', 'removed', 'unchanged']) && Object.values(value.characterCues).every(cues => strings(cues, 500, 200)));
  fail(array(value.affectedRecords, 50000));
  const recordIds = new Set();
  for (const row of value.affectedRecords) { fail(exact(row, ['ref', 'kind', 'reasons']) && saved(row.ref) && !recordIds.has(row.ref.id) && identity(row.kind) && strings(row.reasons, 5, 40) && row.reasons.length > 0); recordIds.add(row.ref.id); }
  fail(exact(value.summary, ['scenes', 'shots', 'characterCuesAdded', 'characterCuesRemoved', 'affectedRecords']) && same(value.summary.scenes, counts(value.sceneDeltas)) && same(value.summary.shots, counts(value.shotDeltas)) && value.summary.characterCuesAdded === value.characterCues.added.length && value.summary.characterCuesRemoved === value.characterCues.removed.length && value.summary.affectedRecords === value.affectedRecords.length);
  fail(ids(value.unplannedSceneIds, 500) && ids(value.coverageReuseSceneIds, 500) && value.unplannedSceneIds.every(id => value.sceneDeltas.some(row => row.sceneId === id && row.after?.shotIds.length === 0)) && value.coverageReuseSceneIds.every(id => value.sceneDeltas.some(row => row.sceneId === id && row.before && row.after)) && text(value.explanation, 2000));
  return value;
}
