import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Users } from 'lucide-react';
import { PRODUCTION_REQUIREMENTS, PRODUCTION_STAGES } from '../../local/contracts/production-lifecycle.mjs';
import { FILM_PRESERVATION_CONTEXT, preservationGuidanceFor, preservationSourceLabel } from '../../local/contracts/film-preservation.mjs';
import type { ProductionPlan, ProductionReview, ProjectDirectionStage } from './projectDirection';
import './production-readiness.css';

type Workspace = 'write' | 'storyboard' | 'timeline' | 'pitch' | 'documents';
type Requirement = {
  id: string; stage: ProjectDirectionStage; title: string; department: string;
  accountableRole: string; deliverable: string; handoff: string;
  workspace: Workspace; when: 'ALWAYS' | 'CANADA_IRELAND';
};
export interface ProductionReadinessPanelProps {
  plan: ProductionPlan;
  stage: ProjectDirectionStage;
  disabled: boolean;
  onChange: (plan: ProductionPlan) => void;
  onOpenWorkspace?: (workspace: Workspace) => void;
  onSelectStage?: (stage: ProjectDirectionStage) => void;
}
const statusLabels: Record<ProductionReview['status'], string> = {
  TODO: 'To do', IN_PROGRESS: 'In progress', BLOCKED: 'Blocked',
  READY_FOR_REVIEW: 'Ready for review', NOT_APPLICABLE: 'Not applicable',
};
const workspaceLabels: Record<Workspace, string> = {
  write: 'Writing', storyboard: 'Storyboard', timeline: 'Movie timeline',
  pitch: 'Pitch & audience', documents: 'Production documents',
};
const requirements = PRODUCTION_REQUIREMENTS as readonly Requirement[];
const blankReview = (requirementId: string): ProductionReview => ({
  requirementId, owner: '', dueDate: '', status: 'TODO', evidence: '', notes: '',
});

export default function ProductionReadinessPanel({ plan, stage, disabled, onChange, onOpenWorkspace, onSelectStage }: ProductionReadinessPanelProps) {
  const fieldPrefix = useId();
  const [department, setDepartment] = useState('ALL');
  const [statusNotice, setStatusNotice] = useState('');
  const [attentionTarget, setAttentionTarget] = useState<Requirement | null>(null);
  const requirementElements = useRef(new Map<string, HTMLDetailsElement>());
  const copro = plan.coproduction;
  const activeRequirements = requirements.filter(item => item.when === 'ALWAYS' || copro.route === 'CANADA_IRELAND_EXPLORATORY');
  const applicable = activeRequirements.filter(item => item.stage === stage);
  const departments = [...new Set(applicable.map(item => item.department))].sort((a, b) => a.localeCompare(b));
  const activeDepartment = departments.includes(department) ? department : 'ALL';
  const visible = applicable.filter(item => activeDepartment === 'ALL' || item.department === activeDepartment);
  const reviewById = new Map(plan.reviews.map(review => [review.requirementId, review]));
  const stageReviews = applicable.map(item => reviewById.get(item.id) ?? blankReview(item.id));
  const blockedCount = stageReviews.filter(item => item.status === 'BLOCKED').length;
  const reviewCount = stageReviews.filter(item => item.status === 'READY_FOR_REVIEW' && item.owner.trim() && item.evidence.trim()).length;
  const unassignedCount = stageReviews.filter(item => !item.owner.trim()).length;
  // Target dates are local calendar days, not UTC instants or approval deadlines.
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const attention = activeRequirements.flatMap(requirement => {
    const review = reviewById.get(requirement.id);
    if (!review) return [];
    const blocked = review.status === 'BLOCKED';
    const overdue = Boolean(review.dueDate && review.dueDate < today && review.status !== 'NOT_APPLICABLE' && review.status !== 'READY_FOR_REVIEW');
    return blocked || overdue ? [{ requirement, review, blocked, overdue }] : [];
  }).sort((left, right) => Number(right.blocked) - Number(left.blocked) || (left.review.dueDate || '9999-12-31').localeCompare(right.review.dueDate || '9999-12-31') || left.requirement.title.localeCompare(right.requirement.title));
  const projectBlockedCount = attention.filter(item => item.blocked).length;
  const projectOverdueCount = attention.filter(item => item.overdue).length;

  useEffect(() => {
    if (!attentionTarget || attentionTarget.stage !== stage || activeDepartment !== 'ALL') return;
    const element = requirementElements.current.get(attentionTarget.id);
    if (!element) return;
    element.open = true;
    element.querySelector('summary')?.focus();
    element.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    setAttentionTarget(null);
  }, [attentionTarget, stage, activeDepartment]);

  function revealRequirement(requirement: Requirement) {
    setDepartment('ALL');
    setAttentionTarget(requirement);
    if (requirement.stage !== stage) onSelectStage?.(requirement.stage);
  }

  function editReview(requirementId: string, patch: Partial<ProductionReview>) {
    if (disabled) return;
    const existing = reviewById.get(requirementId);
    const next = { ...(existing ?? blankReview(requirementId)), ...patch, requirementId };
    if ((next.status === 'READY_FOR_REVIEW' && (!next.owner.trim() || !next.evidence.trim())) || (next.status === 'NOT_APPLICABLE' && (!next.owner.trim() || !next.notes.trim()))) {
      next.status = 'IN_PROGRESS';
      setStatusNotice(`${requirements.find(item => item.id === requirementId)?.title}: returned to In progress because required ownership or supporting details were removed.`);
    } else setStatusNotice('');
    onChange({ ...plan, reviews: existing ? plan.reviews.map(item => item.requirementId === requirementId ? next : item) : [...plan.reviews, next] });
  }
  function editCoproduction(patch: Partial<ProductionPlan['coproduction']>) {
    if (!disabled) onChange({ ...plan, coproduction: { ...copro, ...patch } });
  }

  return <section className="production-readiness" aria-label="Production departments and handoffs">
    <div className="production-readiness-heading">
      <div><h3><Users size={17} aria-hidden="true"/>Departments & handoffs</h3><p>Assign the person responsible, prepare the deliverable, then record its review evidence.</p></div>
      <label className="production-department-filter" htmlFor={`${fieldPrefix}-department`}>Department
        <select id={`${fieldPrefix}-department`} value={activeDepartment} onChange={event => setDepartment(event.target.value)}>
          <option value="ALL">All departments</option>{departments.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
    </div>
    {attention.length > 0 && <details className="production-attention" open>
      <summary>Needs attention across the project <span>{projectBlockedCount} blocked · {projectOverdueCount} overdue</span></summary>
      <ul aria-label="Production items needing attention">
        {attention.slice(0, 5).map(({ requirement, review, blocked, overdue }) => <li key={requirement.id}>
          <button type="button" onClick={() => revealRequirement(requirement)} disabled={requirement.stage !== stage && !onSelectStage}>
            <span className="production-attention-item"><strong>{requirement.title}</strong><span>{PRODUCTION_STAGES.find(item => item.id === requirement.stage)?.label} · {requirement.department} · {review.dueDate ? `Target ${review.dueDate}` : 'No target date'}</span></span>
            <span className="production-attention-reason">{[blocked && 'Blocked', overdue && 'Overdue'].filter(Boolean).join(' · ')}<ArrowUpRight size={14} aria-hidden="true"/></span>
          </button>
        </li>)}
      </ul>
      <p>{attention.length > 5 ? `Showing the first 5 of ${attention.length} items. ` : ''}Blocked items appear first. Target dates are planning dates; an item can be both blocked and overdue.</p>
    </details>}
    <ul className="production-readiness-counts" aria-label="Current stage planning counts">
      <li><strong>{applicable.length}</strong> requirements</li>
      <li><strong>{unassignedCount}</strong> unassigned</li>
      <li className={blockedCount ? 'has-blockers' : ''}><strong>{blockedCount}</strong> blocked</li>
      <li><strong>{reviewCount}</strong> ready for review</li>
    </ul>
    {statusNotice && <p role="status" className="production-field-help">{statusNotice}</p>}
    <div className="production-requirements">
      {visible.map(requirement => {
        const review = reviewById.get(requirement.id) ?? blankReview(requirement.id);
        const preservation = preservationGuidanceFor(requirement.id);
        const id = `${fieldPrefix}-${requirement.id}`;
        const canReview = Boolean(review.owner.trim() && review.evidence.trim());
        const canExclude = Boolean(review.owner.trim() && review.notes.trim());
        return <details className="production-requirement" key={requirement.id} ref={element => { if (element) requirementElements.current.set(requirement.id, element); else requirementElements.current.delete(requirement.id); }}>
          <summary>
            <span className="production-requirement-title"><strong>{requirement.title}</strong><span>{requirement.department}{review.owner.trim() ? ` · ${review.owner}` : ' · Owner needed'}</span></span>
            <span className={`production-status production-status-${review.status.toLowerCase()}`}>{statusLabels[review.status]}</span>
          </summary>
          <div className="production-requirement-body">
            <dl className="production-handoff">
              <div><dt>Accountable role</dt><dd>{requirement.accountableRole}</dd></div>
              <div><dt>Prepare</dt><dd>{requirement.deliverable}</dd></div>
              <div><dt>Hand off to</dt><dd>{requirement.handoff}</dd></div>
            </dl>
            {preservation && <aside aria-label={`Preservation guidance for ${requirement.title}`}>
              <h4>Preservation evidence to prepare</h4>
              <p>{preservation.summary}</p>
              <ul>{preservation.evidencePrompts.map(prompt => <li key={prompt}>{prompt}</li>)}</ul>
              <p className="production-field-help">Record references below. These planning entries do not run file checks or confirm an archive deposit.</p>
              <details><summary>Workshop sources</summary><p className="production-field-help">{FILM_PRESERVATION_CONTEXT}</p>
                <ul>{preservation.sources.map(reference => <li key={`${reference.sourceId}:${reference.locator}`}>{preservationSourceLabel(reference)}</li>)}</ul>
              </details>
            </aside>}
            <div className="production-review-fields">
              <label htmlFor={`${id}-owner`}>Responsible person / team<input id={`${id}-owner`} value={review.owner} disabled={disabled} maxLength={240} placeholder={requirement.accountableRole} onChange={event => editReview(requirement.id, { owner: event.target.value })}/></label>
              <label htmlFor={`${id}-due`}>Target date<input id={`${id}-due`} type="date" value={review.dueDate} disabled={disabled} onChange={event => editReview(requirement.id, { dueDate: event.target.value })}/></label>
              <label htmlFor={`${id}-status`}>Planning status<select id={`${id}-status`} value={review.status} disabled={disabled} aria-describedby={`${id}-status-help`} onChange={event => editReview(requirement.id, { status: event.target.value as ProductionReview['status'] })}>
                <option value="TODO">To do</option><option value="IN_PROGRESS">In progress</option><option value="BLOCKED">Blocked</option>
                <option value="READY_FOR_REVIEW" disabled={!canReview}>Ready for review</option><option value="NOT_APPLICABLE" disabled={!canExclude}>Not applicable</option>
              </select></label>
            </div>
            <p id={`${id}-status-help`} className="production-field-help">Ready for review needs an owner and evidence. Not applicable needs an owner and a reason in notes.</p>
            <div className="production-evidence-fields">
              <label htmlFor={`${id}-evidence`}>Evidence references · not independently verified<textarea id={`${id}-evidence`} rows={3} maxLength={4000} value={review.evidence} disabled={disabled} placeholder="Saved document or asset ID, revision, file location, and reviewer or receipt reference." onChange={event => editReview(requirement.id, { evidence: event.target.value })}/></label>
              <label htmlFor={`${id}-notes`}>Notes, blockers or non-applicability reason<textarea id={`${id}-notes`} rows={3} maxLength={4000} value={review.notes} disabled={disabled} placeholder="What is still needed, who receives it, and any conditions on the handoff." onChange={event => editReview(requirement.id, { notes: event.target.value })}/></label>
            </div>
            {onOpenWorkspace && <button type="button" className="production-open-workspace" onClick={() => onOpenWorkspace(requirement.workspace)}>Open {workspaceLabels[requirement.workspace]}<ArrowUpRight size={15} aria-hidden="true"/></button>}
          </div>
        </details>;
      })}
      {!visible.length && <p className="production-readiness-empty">No requirements match this department in the selected stage.</p>}
    </div>
    <p className="production-readiness-boundary">These are planning and handoff records. Ready for review does not mean approved, staffed, funded or cleared to shoot. Save changes with the project direction.</p>
    <details className="production-coproduction">
      <summary>Co-production planning <span>{copro.route === 'CANADA_IRELAND_EXPLORATORY' ? 'Canada + Ireland · exploratory' : 'No route selected'}</span></summary>
      <div className="production-coproduction-body">
        <p>Plan the producing partners and application work alongside the same film. Selecting a route adds its requirements to the relevant stages.</p>
        <div className="production-coproduction-fields">
          <label htmlFor={`${fieldPrefix}-copro-route`}>Planning route<select id={`${fieldPrefix}-copro-route`} value={copro.route} disabled={disabled} onChange={event => editCoproduction({ route: event.target.value as ProductionPlan['coproduction']['route'] })}><option value="NONE">No co-production route selected</option><option value="CANADA_IRELAND_EXPLORATORY">Canada + Ireland · exploratory</option></select></label>
          <label htmlFor={`${fieldPrefix}-copro-format`}>Production format<select id={`${fieldPrefix}-copro-format`} value={copro.format} disabled={disabled} onChange={event => editCoproduction({ format: event.target.value as ProductionPlan['coproduction']['format'] })}><option value="UNDECIDED">To determine</option><option value="FILM">Film</option><option value="TELEVISION">Television</option></select></label>
          <label htmlFor={`${fieldPrefix}-canadian-producer`}>Canadian producing company<input id={`${fieldPrefix}-canadian-producer`} maxLength={240} value={copro.canadianProducer} disabled={disabled} placeholder="Proposed company and producer" onChange={event => editCoproduction({ canadianProducer: event.target.value })}/></label>
          <label htmlFor={`${fieldPrefix}-irish-producer`}>Irish producing company<input id={`${fieldPrefix}-irish-producer`} maxLength={240} value={copro.irishProducer} disabled={disabled} placeholder="Proposed company and producer" onChange={event => editCoproduction({ irishProducer: event.target.value })}/></label>
          <label htmlFor={`${fieldPrefix}-shoot-start`}>Planned first day of principal photography<input id={`${fieldPrefix}-shoot-start`} type="date" value={copro.shootStart} disabled={disabled} onChange={event => editCoproduction({ shootStart: event.target.value })}/></label>
        </div>
        <label htmlFor={`${fieldPrefix}-copro-notes`}>Co-production questions and notes<textarea id={`${fieldPrefix}-copro-notes`} rows={3} maxLength={4000} value={copro.notes} disabled={disabled} placeholder="Financing and creative contributions, rights, territories, application timing and questions for the producers or advisers." onChange={event => editCoproduction({ notes: event.target.value })}/></label>
        <p className="production-readiness-boundary">Exploratory only. Treaty certification, tax incentives, financing, contracts and permission to begin production need their own supporting decisions and evidence.</p>
        <div className="production-coproduction-guidance">
          <h4>Canada–Ireland reference check <span>16 September 2026</span></h4>
          <p>The bilateral treaty sets a minimum 15% contribution for each co-producer. The percentage alone does not establish qualification; confirm the applicable creative, technical, producer and approval requirements with the authorities.</p>
          <p>For this hybrid workflow, keep human authorship and AI use documented. Telefilm’s funding policy permits assistive AI uses but excludes primarily AI-created projects. This is a funding rule, not a blanket treaty ban.</p>
          <nav aria-label="Official Canada–Ireland co-production references">
            <a href="https://www.treaty-accord.gc.ca/text-texte.aspx?id=105451" target="_blank" rel="noopener noreferrer">Canada–Ireland treaty<ArrowUpRight size={14} aria-hidden="true"/></a>
            <a href="https://www.screenireland.ie/filming/international-co-production/canada" target="_blank" rel="noopener noreferrer">Screen Ireland route & forms<ArrowUpRight size={14} aria-hidden="true"/></a>
            <a href="https://telefilm.ca/wp-content/uploads/2025/11/Business-Policy-AI_Nov2025.pdf" target="_blank" rel="noopener noreferrer">Telefilm AI funding policy<ArrowUpRight size={14} aria-hidden="true"/></a>
          </nav>
        </div>
      </div>
    </details>
  </section>;
}
