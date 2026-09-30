import { validateProjectDirection, validateProjectDirectionId, emptyProductionPlan } from '../../local/contracts/project-direction.mjs';
import { PRODUCTION_STAGES, PRODUCTION_REQUIREMENTS } from '../../local/contracts/production-lifecycle.mjs';
import { FILM_PRESERVATION_CONTEXT, preservationGuidanceLines } from '../../local/contracts/film-preservation.mjs';
import { canonicalJson, hashCanonical } from './canonical';
import type { WorkspaceProject, RecordInput, WorkspaceApi, WorkspaceRecord } from './types';

export type ProjectDirectionStage = 'PREDEVELOPMENT' | 'DEVELOPMENT' | 'PREPRODUCTION' | 'PRODUCTION' | 'WRAP' | 'FINISHING' | 'MARKETING' | 'DISTRIBUTION';
export type ProductionWorkspace = 'write' | 'storyboard' | 'timeline' | 'pitch' | 'documents';
export interface ProductionReview { requirementId: string; owner: string; dueDate: string; status: 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'READY_FOR_REVIEW' | 'NOT_APPLICABLE'; evidence: string; notes: string }
export interface ProductionPlan { catalogVersion: 1; reviews: ProductionReview[]; coproduction: { route: 'NONE' | 'CANADA_IRELAND_EXPLORATORY'; format: 'UNDECIDED' | 'FILM' | 'TELEVISION'; canadianProducer: string; irishProducer: string; shootStart: string; notes: string } }
export { emptyProductionPlan };
export type DirectionActionStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
export interface DirectionAction { id: string; title: string; stage: ProjectDirectionStage; status: DirectionActionStatus }
export interface SlateProject { id: string; title: string; stage: ProjectDirectionStage; nextAction: string; canonNotes: string; businessGoal: string; audienceHypothesis: string; marketingAngle: string }
export interface ProjectDirection {
  schemaVersion: 1 | 2; sourceHash: string | null; title: string; stage: ProjectDirectionStage; productionPlan?: ProductionPlan;
  planningNotes: string; businessObjectives: string; audienceHypotheses: string; canonQuestions: string; marketingPlan: string;
  nextActions: DirectionAction[]; slate: SlateProject[]; status: 'DRAFT'; scope: 'OWNER_PLANNING_ONLY';
}
export type ProjectDirectionRecord = WorkspaceRecord & { kind: 'project-direction'; data: ProjectDirection };
export const directionStages = PRODUCTION_STAGES as { id: ProjectDirectionStage; label: string; detail: string }[];
export const directionGuidance: Record<ProjectDirectionStage, string> = {
  PREDEVELOPMENT: 'Define the concept, underlying rights, intended audience and feasibility with a producer.',
  DEVELOPMENT: 'Resolve key canon questions and prepare an editable story draft.',
  PREPRODUCTION: 'Review casting-reference scope, opening frames and shot coverage.',
  PRODUCTION: 'Review exact saved clip briefs and import scene takes for candidate review.',
  WRAP: 'Verify media handoff, returns, location restoration, payroll and departmental closeout.',
  FINISHING: 'Review picture, sound and captions, then prepare an edit handoff.',
  MARKETING: 'Draft positioning and a pitch, then plan how to collect audience feedback.',
  DISTRIBUTION: 'Confirm release rights, delivery specifications, territory agreements and reporting responsibilities.',
};
export function emptyProjectDirection(project: WorkspaceProject): ProjectDirection { return { schemaVersion: 1, sourceHash: project.sourceHash, title: project.title.slice(0, 240), stage: project.sourceHash === null ? 'PREDEVELOPMENT' : 'DEVELOPMENT', planningNotes: '', businessObjectives: '', audienceHypotheses: '', canonQuestions: '', marketingPlan: '', nextActions: [], slate: [], status: 'DRAFT', scope: 'OWNER_PLANNING_ONLY' }; }
export function currentProjectDirection(project: WorkspaceProject, records: WorkspaceRecord[]): ProjectDirectionRecord | null {
  const row = records.filter(record => record.id === `project-direction:${project.id}`).sort((a, b) => b.version - a.version)[0];
  if (!row) return null;
  if (row.kind !== 'project-direction') throw new Error('The saved project direction has an unexpected identity.');
  validateProjectDirectionId(row.id, project); validateProjectDirection(row.data, project); return row as ProjectDirectionRecord;
}
export async function saveProjectDirection(api: WorkspaceApi, project: WorkspaceProject, input: RecordInput<ProjectDirection>): Promise<ProjectDirectionRecord> {
  const captured = JSON.parse(canonicalJson(input)) as RecordInput<ProjectDirection>;
  validateProjectDirectionId(captured.id, project); validateProjectDirection(captured.data, project);
  const result = await api.saveRecord(captured, project);
  validateProjectDirectionId(result.id, project); validateProjectDirection(result.data, project);
  if (result.id !== captured.id || result.kind !== 'project-direction' || result.version !== (captured.expectedVersion ?? 0) + 1 || canonicalJson(result.data) !== canonicalJson(captured.data) || result.sha256 !== await hashCanonical(captured.data)) throw new Error('The saved project direction did not match this attempt. Refresh before continuing.');
  return result as ProjectDirectionRecord;
}
export function directionContextText(record: ProjectDirectionRecord): string {
  const data = record.data;
  const text = [`OWNER PROJECT DIRECTION — PLANNING ONLY`, `${record.id}@${record.sha256} · v${record.version}\nSource: ${data.sourceHash ?? 'No production screenplay attached'}`, `${data.title}\nWorking focus: ${data.stage}. This is not a completed stage, production approval or canon decision.`, `Business objectives: ${data.businessObjectives}`, `Audience hypotheses: ${data.audienceHypotheses}`, `Planning notes: ${data.planningNotes}`, `Canon questions: ${data.canonQuestions}`, `Marketing plan: ${data.marketingPlan}`, 'Next actions (owner task tracking only):', ...data.nextActions.map(item => `${item.id}: ${item.title} — ${item.stage} / ${item.status}`), 'Whole-slate planning entries (not separate active workspace projects):', ...data.slate.map(item => `${item.id}: ${item.title} — ${item.stage}\nNext: ${item.nextAction}\nBusiness goal: ${item.businessGoal}\nAudience hypothesis: ${item.audienceHypothesis}\nCanon notes: ${item.canonNotes}\nMarketing angle: ${item.marketingAngle}`)].join('\n\n');
  const production = data.productionPlan;
  const fullText = production ? text + '\n\nPRODUCTION DEPARTMENT PLANNING — evidence references are owner notes, not verified approvals.\n' +
    `Co-production exploration: ${production.coproduction.route}; format ${production.coproduction.format}. No eligibility or funding decision.\n` +
    production.reviews.map(review => `${review.requirementId}: ${review.status}; owner ${review.owner || 'unassigned'}; due ${review.dueDate || 'unset'}; evidence ${review.evidence}; notes ${review.notes}`).join('\n') : text;
  if (fullText.length <= 12000) return fullText;
  const suffix = '\n\n[Planning selection shortened; open the saved direction for complete notes.]';
  return fullText.slice(0, 12000 - suffix.length).replace(/[\uD800-\uDBFF]$/, '') + suffix;
}

// Export exactly the displayed working plan. Never synthesize approvals from task states.
export function productionPlanReport(project: WorkspaceProject, data: ProjectDirection, savedVersion: number | null, unsaved: boolean): string {
  const plan: ProductionPlan = data.productionPlan ?? emptyProductionPlan();
  const active = PRODUCTION_REQUIREMENTS.filter(item => item.when === 'ALWAYS' || plan.coproduction.route === 'CANADA_IRELAND_EXPLORATORY');
  const lines = [`# ${data.title} — production department handoff`, '', `Project: ${project.id}`, `Source: ${data.sourceHash ?? 'No production screenplay attached'}`, `Based on saved direction: ${savedVersion === null ? 'none' : `v${savedVersion}`}; working edits: ${unsaved ? 'UNSAVED' : 'none'}.`, '', 'Planning only. Evidence references are unverified owner notes. No production, spending, release, rights, funding or treaty approval is conferred by this report.', '', `Co-production route: ${plan.coproduction.route}`, `Format: ${plan.coproduction.format}; planned photography: ${plan.coproduction.shootStart || 'unset'}`, `Canadian producer: ${plan.coproduction.canadianProducer || 'unassigned'}`, `Irish producer: ${plan.coproduction.irishProducer || 'unassigned'}`, plan.coproduction.notes, '', 'Marketing and audience development begin in development; wrap and post may overlap. Department leads determine project-specific requirements.', ''];
  for (const stage of directionStages) {
    lines.push(`## ${stage.label}`, '');
    for (const task of active.filter(item => item.stage === stage.id)) {
      const review = plan.reviews.find(item => item.requirementId === task.id);
      lines.push(`### ${task.title} [${task.id}]`, `Department: ${task.department}; accountable role: ${task.accountableRole}`, `Assigned owner: ${review?.owner || 'UNASSIGNED'}; due: ${review?.dueDate || 'unset'}; state: ${review?.status || 'TODO'}`, `Deliverable: ${task.deliverable}`, `Handoff: ${task.handoff}`, `Evidence references (unverified): ${review?.evidence || 'none'}`, `Notes / exclusion rationale: ${review?.notes || 'none'}`, '');
      const preservation = preservationGuidanceLines(task.id);
      if (preservation.length) lines.push(...preservation, '');
    }
  }
  const inactive = plan.reviews.filter(review => !active.some(item => item.id === review.requirementId));
  if (inactive.length) lines.push('## Retained reviews outside the current route', '', ...inactive.map(review => `${review.requirementId}: ${review.status}; owner ${review.owner}; evidence ${review.evidence}; notes ${review.notes}`), '');
  lines.push('## Preservation reference scope', '', FILM_PRESERVATION_CONTEXT, 'Supplied references and filled worksheets do not establish successful file checks, accepted custody, rights clearance or archive deposit.', '');
  return lines.join('\n');
}
