// One owner planning draft per selected project, persisted by the existing
// versioned workspace. Focus and task states never establish film completion,
// canonical admission, rights clearance, budgets or audience outcomes.
import { PRODUCTION_STAGES, PRODUCTION_REQUIREMENTS } from './production-lifecycle.mjs';
import { isCreativeProject, validateCreativeProject, projectOwnedContext } from './creative-project.mjs';
export const PROJECT_DIRECTION_STAGES = Object.freeze(PRODUCTION_STAGES.map(stage => stage.id));
export const PRODUCTION_REVIEW_STATUSES = Object.freeze(['TODO', 'IN_PROGRESS', 'BLOCKED', 'READY_FOR_REVIEW', 'NOT_APPLICABLE']);
export const PROJECT_DIRECTION_ACTION_STATUSES = Object.freeze(['TODO', 'IN_PROGRESS', 'DONE']);
export const PROJECT_DIRECTION_LIMITS = Object.freeze({ title: 240, notes: 8000, actions: 50, actionTitle: 500, slate: 40, slateNotes: 1000 });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(value);
function need(condition, code) { if (!condition) throw Object.assign(new Error(code), { code, status: 422 }); }
function shape(value, fields) { need(object(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(','), 'PROJECT_DIRECTION_FIELDS_INVALID'); }
function text(value, limit, nonempty = false, singleLine = false) {
  return typeof value === 'string' && value.length <= limit && value.isWellFormed() && (!nonempty || value.trim().length > 0) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) && (!singleLine || !/[\t\r\n]/.test(value));
}
export function validateProjectDirectionId(recordId, project) {
  need(typeof project?.id === 'string' && recordId === `project-direction:${project.id}` && recordId.length <= 160, 'PROJECT_DIRECTION_IDENTITY_MISMATCH');
  return recordId;
}
export function validateProjectDirection(data, project) {
  project = projectOwnedContext(project, 'project-direction', data);
  const notes = ['planningNotes', 'businessObjectives', 'audienceHypotheses', 'canonQuestions', 'marketingPlan'];
  shape(data, ['schemaVersion', 'sourceHash', 'title', 'stage', ...notes, 'nextActions', 'slate', 'status', 'scope', ...(data?.schemaVersion === 2 ? ['productionPlan'] : [])]);
  need([1, 2].includes(data.schemaVersion), 'PROJECT_DIRECTION_SOURCE_MISMATCH');
  if (data.sourceHash === null) {
    // A source-free plan belongs only to a fully validated creative workspace.
    // Its record identity binds the project; it cannot admit a screenplay.
    need(isCreativeProject(project), 'PROJECT_DIRECTION_SOURCE_MISMATCH');
    validateCreativeProject(project);
  } else {
    need(digest(data.sourceHash) && (!project || data.sourceHash === project.sourceHash), 'PROJECT_DIRECTION_SOURCE_MISMATCH');
  }
  need(data.status === 'DRAFT' && data.scope === 'OWNER_PLANNING_ONLY', 'PROJECT_DIRECTION_AUTHORITY_INVALID');
  need(text(data.title, PROJECT_DIRECTION_LIMITS.title, true, true) && PROJECT_DIRECTION_STAGES.includes(data.stage), 'PROJECT_DIRECTION_TITLE_OR_STAGE_INVALID');
  need(notes.every(field => text(data[field], PROJECT_DIRECTION_LIMITS.notes)), 'PROJECT_DIRECTION_NOTES_INVALID');
  need(Array.isArray(data.nextActions) && data.nextActions.length <= PROJECT_DIRECTION_LIMITS.actions, 'PROJECT_DIRECTION_ACTION_LIMIT');
  const actions = new Set();
  for (const action of data.nextActions) {
    shape(action, ['id', 'title', 'stage', 'status']);
    need(id(action.id) && !actions.has(action.id) && text(action.title, PROJECT_DIRECTION_LIMITS.actionTitle, true, true) && PROJECT_DIRECTION_STAGES.includes(action.stage) && PROJECT_DIRECTION_ACTION_STATUSES.includes(action.status), 'PROJECT_DIRECTION_ACTION_INVALID');
    actions.add(action.id);
  }
  need(Array.isArray(data.slate) && data.slate.length <= PROJECT_DIRECTION_LIMITS.slate, 'PROJECT_DIRECTION_SLATE_LIMIT');
  const entries = new Set(), slateNotes = ['nextAction', 'canonNotes', 'businessGoal', 'audienceHypothesis', 'marketingAngle'];
  for (const entry of data.slate) {
    shape(entry, ['id', 'title', 'stage', ...slateNotes]);
    need(id(entry.id) && !entries.has(entry.id) && text(entry.title, PROJECT_DIRECTION_LIMITS.title, true, true) && PROJECT_DIRECTION_STAGES.includes(entry.stage) && slateNotes.every(field => text(entry[field], PROJECT_DIRECTION_LIMITS.slateNotes)), 'PROJECT_DIRECTION_SLATE_INVALID');
    entries.add(entry.id);
  }
  if (data.schemaVersion === 2) validateProductionPlan(data.productionPlan);
  return data;
}

// Date-only production planning: do not normalize impossible dates into another day.
function date(value) {
  if (value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function emptyProductionPlan() {
  return { catalogVersion: 1, reviews: [], coproduction: { route: 'NONE', format: 'UNDECIDED', canadianProducer: '', irishProducer: '', shootStart: '', notes: '' } };
}
export function validateProductionPlan(plan) {
  shape(plan, ['catalogVersion', 'reviews', 'coproduction']);
  need(plan.catalogVersion === 1 && Array.isArray(plan.reviews) && plan.reviews.length <= PRODUCTION_REQUIREMENTS.length, 'PRODUCTION_PLAN_CATALOG_INVALID');
  shape(plan.coproduction, ['route', 'format', 'canadianProducer', 'irishProducer', 'shootStart', 'notes']);
  const co = plan.coproduction;
  need(['NONE', 'CANADA_IRELAND_EXPLORATORY'].includes(co.route) && ['UNDECIDED', 'FILM', 'TELEVISION'].includes(co.format), 'COPRODUCTION_ROUTE_INVALID');
  need(text(co.canadianProducer, 240, false, true) && text(co.irishProducer, 240, false, true) && text(co.notes, 8000) && date(co.shootStart), 'COPRODUCTION_DETAILS_INVALID');
  const seen = new Set();
  for (const review of plan.reviews) {
    shape(review, ['requirementId', 'owner', 'dueDate', 'status', 'evidence', 'notes']);
    need(PRODUCTION_REQUIREMENTS.some(item => item.id === review.requirementId) && !seen.has(review.requirementId), 'PRODUCTION_REVIEW_ID_INVALID');
    seen.add(review.requirementId);
    need(PRODUCTION_REVIEW_STATUSES.includes(review.status) && text(review.owner, 240, false, true) && date(review.dueDate) && text(review.evidence, 4000) && text(review.notes, 4000), 'PRODUCTION_REVIEW_INVALID');
    need(review.status !== 'READY_FOR_REVIEW' || (review.owner.trim() && review.evidence.trim()), 'PRODUCTION_REVIEW_OWNER_AND_EVIDENCE_REQUIRED');
    need(review.status !== 'NOT_APPLICABLE' || (review.owner.trim() && review.notes.trim()), 'PRODUCTION_REVIEW_EXCLUSION_REASON_REQUIRED');
  }
  return plan;
}
