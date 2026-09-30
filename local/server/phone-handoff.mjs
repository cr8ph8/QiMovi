import { canonical, check, sha256 } from './storage.mjs';
import { blankShotDirection, shotDirectionId, validateShotDirection } from '../contracts/shot-direction.mjs';
import { validateProjectDirection } from '../contracts/project-direction.mjs';

export const PHONE_HANDOFF_MAX_BYTES = 2 * 1024 * 1024;
const stages = Object.freeze({ PREDEVELOPMENT: 'Pre-development', DEVELOPMENT: 'Development', PREPRODUCTION: 'Pre-production', PRODUCTION: 'Production', WRAP: 'Wrap', FINISHING: 'Post-production', MARKETING: 'Marketing', DISTRIBUTION: 'Distribution' });
const stageFor = phase => Object.keys(stages).find(key => stages[key] === phase);
const phases = ['Unassigned', ...Object.values(stages)];
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (a, b) => canonical(a) === canonical(b);
const ref = record => record ? { id: record.id, version: record.version, sha256: record.sha256 } : null;
const nullable = value => value ?? null;
function shape(value, required, optional = []) {
  check(object(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key)), 'PHONE_FIELDS_INVALID', 422);
}
function text(value, max, nonempty = false, singleLine = false) {
  check(typeof value === 'string' && value.length <= max && value.isWellFormed() && (!nonempty || value.trim()) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) && (!singleLine || !/[\t\r\n]/.test(value)), 'PHONE_TEXT_INVALID', 422);
}
function bounded(value) {
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(value)); } catch { check(false, 'PHONE_JSON_INVALID', 422); }
  check(bytes <= PHONE_HANDOFF_MAX_BYTES, 'PHONE_PACKAGE_TOO_LARGE', 413);
}
function timestamp(value) { check(typeof value === 'string' && value.length <= 40 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)), 'PHONE_TIMESTAMP_INVALID', 422); }
function validateRef(value) {
  if (value == null) return;
  shape(value, ['id', 'version', 'sha256']);
  check(id(value.id) && Number.isSafeInteger(value.version) && value.version > 0 && value.version < 2147483647 && hash(value.sha256), 'PHONE_BASELINE_REF_INVALID', 422);
}
function validateTasks(tasks) {
  check(Array.isArray(tasks) && tasks.length <= 50, 'PHONE_TASK_LIMIT', 422);
  const seen = new Set();
  for (const task of tasks) {
    shape(task, ['id', 'title', 'phase', 'status'], ['notes']);
    check(id(task.id) && task.id.length <= 80 && !seen.has(task.id) && phases.includes(task.phase) && ['todo', 'done'].includes(task.status), 'PHONE_TASK_INVALID', 422);
    seen.add(task.id); text(task.title, 500, true, true);
    if (task.notes != null) text(task.notes, 8000);
  }
}
function validateBaseline(value) {
  shape(value, ['schemaVersion', 'projectId', 'sourceRecordHash', 'project', 'shotDirections'], ['sourceHash', 'projectDirectionRef']);
  check(value.schemaVersion === 1 && id(value.projectId) && (value.sourceHash == null || hash(value.sourceHash)) && hash(value.sourceRecordHash), 'PHONE_BASELINE_INVALID', 422);
  validateRef(value.projectDirectionRef);
  shape(value.project, ['phase', 'tasks']); check(phases.includes(value.project.phase), 'PHONE_PHASE_INVALID', 422); validateTasks(value.project.tasks);
  check(Array.isArray(value.shotDirections) && value.shotDirections.length <= 400, 'PHONE_SHOT_LIMIT', 422);
  const seen = new Set();
  for (const shot of value.shotDirections) {
    shape(shot, ['sceneId', 'shotId', 'framing', 'movement', 'notes'], ['ref']);
    check(id(shot.sceneId) && id(shot.shotId), 'PHONE_SHOT_ID_INVALID', 422);
    const key = shotDirectionId(shot.sceneId, shot.shotId); check(!seen.has(key), 'PHONE_SHOT_DUPLICATE', 422); seen.add(key);
    validateRef(shot.ref); text(shot.framing, 2000); text(shot.movement, 2000); text(shot.notes, 4000);
  }
}
export function validatePhoneReview(value) {
  bounded(value);
  shape(value, ['schemaVersion', 'exportedAt', 'origin', 'scope', 'desktopApplied', 'productionApproval', 'project'], ['sourceSnapshotDate']);
  check(value.schemaVersion === 'qimovi-production-review/v1' && value.scope === 'PHONE_PLANNING_REVIEW_ONLY' && value.desktopApplied === false && value.productionApproval === false, 'PHONE_REVIEW_AUTHORITY_INVALID', 422);
  timestamp(value.exportedAt); if (value.sourceSnapshotDate != null) timestamp(value.sourceSnapshotDate); text(value.origin, 500, true);
  const project = value.project;
  shape(project, ['id', 'title', 'phase', 'shots', 'tasks'], ['synopsis', 'sourceHash', 'sourceStatus', 'phaseOrigin', 'sourceRecordHash', 'desktopBaseline']);
  check(id(project.id) && phases.includes(project.phase) && (project.sourceHash == null || hash(project.sourceHash)) && (project.sourceRecordHash == null || hash(project.sourceRecordHash)), 'PHONE_PROJECT_INVALID', 422);
  text(project.title, 240, true, true);
  for (const field of ['synopsis', 'sourceStatus', 'phaseOrigin']) if (project[field] != null) text(project[field], field === 'synopsis' ? 8000 : 500);
  validateTasks(project.tasks);
  check(Array.isArray(project.shots) && project.shots.length <= 400, 'PHONE_SHOT_LIMIT', 422);
  const seen = new Set();
  for (const shot of project.shots) {
    shape(shot, ['id', 'sceneId', 'sceneHeading', 'title', 'order', 'framing', 'movement', 'notes', 'status'], ['durationSeconds', 'thumbnail', 'sourceHash', 'sourceRecordHash', 'storyboardRecordID', 'storyboardImageHash', 'storyboardReview']);
    check(id(shot.id) && !seen.has(shot.id) && (shot.sceneId === '' || id(shot.sceneId)) && Number.isSafeInteger(shot.order) && shot.order >= 0 && shot.order <= 100000 && ['planned', 'ready', 'captured', 'reviewed'].includes(shot.status), 'PHONE_SHOT_INVALID', 422);
    seen.add(shot.id); text(shot.sceneHeading, 500, true); text(shot.title, 300, true); text(shot.framing, 2000); text(shot.movement, 2000); text(shot.notes, 50000);
    check(shot.durationSeconds == null || (Number.isFinite(shot.durationSeconds) && shot.durationSeconds > 0 && shot.durationSeconds <= 86400), 'PHONE_DURATION_INVALID', 422);
    for (const field of ['sourceHash', 'sourceRecordHash', 'storyboardImageHash']) check(shot[field] == null || hash(shot[field]), 'PHONE_HASH_INVALID', 422);
    if (shot.storyboardRecordID != null) check(id(shot.storyboardRecordID), 'PHONE_STORYBOARD_ID_INVALID', 422);
    if (shot.storyboardReview != null) text(shot.storyboardReview, 100);
    if (shot.thumbnail != null) check(typeof shot.thumbnail === 'string' && /^Thumbnails\/[A-Za-z0-9._-]{1,200}$/.test(shot.thumbnail) && !shot.thumbnail.includes('..'), 'PHONE_THUMBNAIL_INVALID', 422);
  }
  if (project.desktopBaseline != null) validateBaseline(project.desktopBaseline);
  return value;
}
function emptyDirection(project) {
  return { schemaVersion: 1, sourceHash: project.sourceHash, title: project.title, stage: project.sourceHash === null ? 'PREDEVELOPMENT' : 'DEVELOPMENT', planningNotes: '', businessObjectives: '', audienceHypotheses: '', canonQuestions: '', marketingPlan: '', nextActions: [], slate: [], status: 'DRAFT', scope: 'OWNER_PLANNING_ONLY' };
}
const phoneTasks = data => data.nextActions.map(task => ({ id: task.id, title: task.title, phase: stages[task.stage], status: task.status === 'DONE' ? 'done' : 'todo' }));
const phoneDirection = data => ({ phase: stages[data.stage], tasks: phoneTasks(data) });
const phoneShot = data => ({ framing: data.shotSize, movement: data.movement, notes: data.purpose });
const mappedShot = data => ({ shotSize: data.shotSize, movement: data.movement, purpose: data.purpose });
const mappedProject = data => ({ stage: data.stage, nextActions: data.nextActions });
function historical(store, recordRef, recordId, kind) {
  if (recordRef == null) return null;
  check(recordRef.id === recordId, 'PHONE_BASELINE_ID_MISMATCH', 409);
  const record = store.history(recordId).find(item => item.version === recordRef.version);
  check(record && record.kind === kind && record.sha256 === recordRef.sha256 && sha256(canonical(record.data)) === recordRef.sha256, 'PHONE_BASELINE_RECORD_MISSING', 409);
  return record;
}

export function createPhoneHandoffService(store) {
  function source() {
    const raw = store.project(), project = store.resolvedProject();
    check(raw && project, 'PHONE_PROJECT_UNAVAILABLE', 409);
    const sourceRecordHash = sha256(canonical(raw));
    const records = store.rawList();
    const directions = new Map(records.filter(row => ['shot-direction', 'project-direction'].includes(row.kind)).map(row => [row.id, row]));
    return { project, sourceRecordHash, directions };
  }
  function exportSnapshot() {
    const { project, sourceRecordHash, directions } = source();
    const direction = directions.get(`project-direction:${project.id}`), data = direction?.data ?? emptyDirection(project);
    validateProjectDirection(data, project);
    const normalized = phoneDirection(data), shotDirections = [], shots = [], seen = new Set();
    for (const scene of project.scenes) for (const shot of scene.shots) {
      check(!seen.has(shot.id), 'PHONE_SHOT_ID_AMBIGUOUS', 409); seen.add(shot.id);
      const row = directions.get(shotDirectionId(scene.id, shot.id)), shotData = row?.data ?? blankShotDirection(project, scene.id, shot.id);
      validateShotDirection(shotData, project);
      shotDirections.push({ sceneId: scene.id, shotId: shot.id, ref: ref(row), ...phoneShot(shotData) });
      shots.push({ id: shot.id, sceneId: scene.id, sceneHeading: scene.heading, title: `${shot.label ?? shot.id}${shot.description ? ` · ${shot.description}` : ''}`.slice(0, 300), order: shots.length + 1, ...phoneShot(shotData), durationSeconds: shot.plannedDurationMs ? shot.plannedDurationMs / 1000 : null, status: 'planned', sourceHash: project.sourceHash, sourceRecordHash: shot.shotHash ?? sha256(canonical(shot)) });
    }
    const phone = { id: project.id, title: project.title, ...normalized, synopsis: null, sourceHash: project.sourceHash, shots, sourceStatus: project.sourceStatus ?? 'SOURCE_ATTACHED', phaseOrigin: direction ? 'DESKTOP_PROJECT_DIRECTION' : 'DESKTOP_PLANNING_DEFAULT', sourceRecordHash,
      desktopBaseline: { schemaVersion: 1, projectId: project.id, sourceHash: project.sourceHash, sourceRecordHash, project: structuredClone(normalized), projectDirectionRef: ref(direction), shotDirections } };
    const result = { schemaVersion: 'qimovi-phone-production/v1', exportedAt: new Date().toISOString(), origin: 'QiMovi desktop planning snapshot', projects: [phone] };
    // Reuse all receiving bounds so an exported snapshot can make a return trip.
    validatePhoneReview({ schemaVersion: 'qimovi-production-review/v1', exportedAt: result.exportedAt, origin: result.origin, scope: 'PHONE_PLANNING_REVIEW_ONLY', desktopApplied: false, productionApproval: false, project: phone });
    bounded(result); return result;
  }
  function compute(input) {
    validatePhoneReview(input);
    const { project, sourceRecordHash, directions } = source(), phone = input.project, baseline = phone.desktopBaseline;
    check(phone.id === project.id, 'PHONE_PROJECT_MISMATCH', 409);
    check(nullable(phone.sourceHash) === nullable(project.sourceHash), 'PHONE_SOURCE_STALE', 409);
    const changes = [], candidates = new Map();
    const warnings = ['Only reviewed planning direction is applied. Phone capture and review labels do not create or accept media takes.', 'Omitted desktop shots and tasks are preserved. Each Apply saves exactly one versioned direction record.'];
    function reviewOnly(key, label, reason, before, after) {
      changes.push({ id: `review:${key}`, kind: 'shot-direction', label, status: 'REVIEW_ONLY', reason, recordId: null, expectedVersion: null, before, after });
    }
    if (!baseline) {
      reviewOnly('baseline', 'Phone planning package', 'This package has no desktop baseline. Export a current desktop snapshot before applying changes.', {}, { phase: phone.phase, tasks: phone.tasks, shots: phone.shots });
    } else {
      check(baseline.projectId === project.id && nullable(baseline.sourceHash) === nullable(project.sourceHash) && baseline.sourceRecordHash === sourceRecordHash && phone.sourceRecordHash === sourceRecordHash, 'PHONE_SOURCE_STALE', 409);
      const projectId = `project-direction:${project.id}`, old = historical(store, baseline.projectDirectionRef, projectId, 'project-direction');
      const baseData = old?.data ?? emptyDirection(project);
      validateProjectDirection(baseData, project);
      check(equal(phoneDirection(baseData), baseline.project), 'PHONE_BASELINE_CONTENT_MISMATCH', 409);
      function row(recordId, kind, label, baseRef, candidate, changed, invalidReason = '') {
        const current = directions.get(recordId), map = kind === 'shot-direction' ? mappedShot : mappedProject;
        const before = current ? map(current.data) : map(kind === 'shot-direction' ? blankShotDirection(project, candidate.sceneId, candidate.shotId) : emptyDirection(project));
        const after = map(candidate), same = equal(before, after);
        const status = invalidReason ? 'REVIEW_ONLY' : !changed || same ? 'UNCHANGED' : equal(ref(current), nullable(baseRef)) ? 'READY' : 'CONFLICT';
        const reason = invalidReason || (status === 'READY' ? 'Ready to save this planning direction after review.' : status === 'CONFLICT' ? 'The desktop record changed after this phone snapshot. Export a new snapshot and reconcile the edits.' : 'No pending phone change for this record.');
        changes.push({ id: recordId, kind, label, status, reason, recordId, expectedVersion: current?.version ?? null, before, after });
        if (status === 'READY') candidates.set(recordId, candidate);
      }
      const proposal = structuredClone(baseData); let projectChanged = false, unsupported = '';
      if (phone.phase !== baseline.project.phase) {
        projectChanged = true;
        if (stageFor(phone.phase)) proposal.stage = stageFor(phone.phase); else unsupported = 'An unassigned phase has no desktop production stage.';
      }
      for (const task of phone.tasks) {
        const priorPhone = baseline.project.tasks.find(item => item.id === task.id), prior = proposal.nextActions.find(item => item.id === task.id);
        const changed = !priorPhone || ['title', 'phase', 'status'].some(field => task[field] !== priorPhone[field]);
        if (changed) {
          projectChanged = true;
          if (!stageFor(task.phase)) unsupported = 'Tasks need an assigned phase before they can be applied.';
          else {
            const next = { id: task.id, title: task.title, stage: stageFor(task.phase), status: prior && task.status === priorPhone?.status ? prior.status : task.status === 'done' ? 'DONE' : 'TODO' };
            if (prior) Object.assign(prior, next); else proposal.nextActions.push(next);
          }
        }
        if (task.notes) reviewOnly(`task:${task.id}`, task.title, 'Task notes have no corresponding desktop direction field.', {}, { notes: task.notes });
      }
      if (proposal.nextActions.length > 50) unsupported = 'Applying added tasks would exceed the 50 task desktop limit. Existing omitted tasks are preserved.';
      if (!unsupported) validateProjectDirection(proposal, project);
      row(projectId, 'project-direction', 'Project phase and tasks', baseline.projectDirectionRef, proposal, projectChanged, unsupported);
      const sourceShots = project.scenes.flatMap(scene => scene.shots.map(shot => ({ scene, shot })));
      check(baseline.shotDirections.length === sourceShots.length, 'PHONE_BASELINE_SHOTS_MISMATCH', 409);
      for (const { scene, shot } of sourceShots) {
        const recordId = shotDirectionId(scene.id, shot.id), saved = baseline.shotDirections.find(item => item.sceneId === scene.id && item.shotId === shot.id);
        check(saved, 'PHONE_BASELINE_SHOTS_MISMATCH', 409);
        const historicalRecord = historical(store, saved.ref, recordId, 'shot-direction'), beforeData = historicalRecord?.data ?? blankShotDirection(project, scene.id, shot.id);
        validateShotDirection(beforeData, project);
        check(equal(phoneShot(beforeData), { framing: saved.framing, movement: saved.movement, notes: saved.notes }), 'PHONE_BASELINE_CONTENT_MISMATCH', 409);
        const imported = phone.shots.find(item => item.sceneId === scene.id && item.id === shot.id);
        if (!imported) continue;
        check(nullable(imported.sourceHash) === nullable(project.sourceHash) && imported.sourceRecordHash === (shot.shotHash ?? sha256(canonical(shot))), 'PHONE_SHOT_SOURCE_STALE', 409);
        const candidate = { ...beforeData, shotSize: imported.framing, movement: imported.movement, purpose: imported.notes };
        const invalid = imported.notes.length > 4000 ? 'Shot notes exceed the desktop purpose limit of 4000 characters.' : '';
        if (!invalid) validateShotDirection(candidate, project);
        row(recordId, 'shot-direction', `${scene.heading} · ${shot.label ?? shot.id}`, saved.ref, candidate, !equal(phoneShot(beforeData), phoneShot(candidate)), invalid);
        const initial = { title: `${shot.label ?? shot.id}${shot.description ? ` · ${shot.description}` : ''}`.slice(0, 300), durationSeconds: shot.plannedDurationMs ? shot.plannedDurationMs / 1000 : null, status: 'planned', order: sourceShots.findIndex(item => item.shot === shot) + 1, sceneHeading: scene.heading };
        const edited = { title: imported.title, durationSeconds: nullable(imported.durationSeconds), status: imported.status, order: imported.order, sceneHeading: imported.sceneHeading };
        if (!equal(initial, edited)) reviewOnly(recordId, imported.title, 'Shot labels, timing, order, scene labels and phone status remain review-only.', initial, edited);
      }
      for (const shot of phone.shots) if (!sourceShots.some(item => item.scene.id === shot.sceneId && item.shot.id === shot.id)) reviewOnly(`new-shot:${shot.id}`, shot.title, 'This phone shot has no matching desktop source shot. It remains a planning proposal.', {}, shot);
      if (phone.title !== project.title || phone.synopsis) reviewOnly('project-labels', 'Project title and synopsis', 'Project source identity, title and synopsis remain unchanged.', { title: project.title }, { title: phone.title, synopsis: phone.synopsis ?? null });
    }
    const preview = { schemaVersion: 'qimovi-phone-review-preview/v1', projectId: project.id, sourceHash: project.sourceHash, changes, warnings };
    return { preview: { ...preview, previewSha256: sha256(canonical({ reviewPackage: input, sourceRecordHash, preview })) }, candidates };
  }
  function preview(input) { return compute(input).preview; }
  function apply(input) {
    bounded(input);
    shape(input, ['reviewPackage', 'changeId', 'previewSha256', 'expectedVersion', 'requestId']);
    validatePhoneReview(input.reviewPackage);
    check(id(input.changeId) && id(input.requestId) && hash(input.previewSha256) && (input.expectedVersion === null || (Number.isSafeInteger(input.expectedVersion) && input.expectedVersion > 0 && input.expectedVersion < 2147483647)), 'PHONE_APPLY_INVALID', 422);
    check(typeof store.savePhoneHandoff === 'function', 'PHONE_ATOMIC_STORAGE_UNAVAILABLE', 503);
    const requestId = `phone-apply:${sha256(input.requestId)}`, requestHash = sha256(canonical(input));
    const prior = store.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
    let data, kind;
    if (prior) {
      check(prior.request_sha256 === requestHash, 'REQUEST_ID_CONFLICT', 409);
      const retained = JSON.parse(prior.result); data = retained.data; kind = retained.kind;
      check(retained.id === input.changeId, 'PHONE_RECEIPT_MISMATCH', 409);
    } else {
      const result = compute(input.reviewPackage), change = result.preview.changes.find(item => item.id === input.changeId);
      check(result.preview.previewSha256 === input.previewSha256, 'PHONE_PREVIEW_STALE', 409);
      check(change?.status === 'READY' && change.expectedVersion === input.expectedVersion, 'PHONE_CHANGE_NOT_APPLICABLE', 409);
      data = result.candidates.get(input.changeId); kind = change.kind;
    }
    const record = store.savePhoneHandoff(input.changeId, { kind, data, requestId, expectedVersion: input.expectedVersion }, requestHash, () => {
      const current = compute(input.reviewPackage), change = current.preview.changes.find(item => item.id === input.changeId);
      check(current.preview.previewSha256 === input.previewSha256 && change?.status === 'READY' && change.expectedVersion === input.expectedVersion && equal(current.candidates.get(input.changeId), data), 'PHONE_PREVIEW_STALE', 409);
    });
    return { status: 'APPLIED', changeId: input.changeId, previewSha256: input.previewSha256, record, replayed: record.replayed === true };
  }
  return { exportSnapshot, preview, apply };
}
