import { useEffect, useRef, useState } from 'react';
import MandateReviewPanel from './MandateReviewPanel';
import { ArrowRight, Plus, Save, X } from 'lucide-react';
import { validateProjectDirection } from '../../local/contracts/project-direction.mjs';
import { canonicalJson } from './canonical';
import { currentProjectDirection, directionGuidance, directionStages, emptyProjectDirection, emptyProductionPlan, productionPlanReport, saveProjectDirection, type DirectionActionStatus, type ProjectDirection, type ProjectDirectionRecord, type ProjectDirectionStage, type ProductionWorkspace, type SlateProject } from './projectDirection';
import ProductionReadinessPanel from './ProductionReadinessPanel';
import { downloadLocalBlob } from './localDownload';
import type { WorkspaceProject, Scene, RecordInput, WorkspaceApi, WorkspaceRecord } from './types';
import './project-direction.css';

export interface ProjectDirectionPanelProps { project: WorkspaceProject; records: WorkspaceRecord[]; api: WorkspaceApi; onSaved: (record: WorkspaceRecord) => void; onDirty?: (dirty: boolean) => void; onOpenStage?: (stage: ProjectDirectionStage) => void; onOpenWorkspace?: (workspace: ProductionWorkspace) => void }
export default function ProjectDirectionPanel(props: ProjectDirectionPanelProps) { return <DirectionEditor key={`${props.project.id}:${props.project.sourceHash}`} {...props}/>; }
function DirectionEditor({ project, records, api, onSaved, onDirty, onOpenStage, onOpenWorkspace }: ProjectDirectionPanelProps) {
  let incoming: ProjectDirectionRecord | null = null, readError = '';
  try { incoming = currentProjectDirection(project, records); } catch (error) { readError = error instanceof Error ? error.message : 'The saved direction could not be read.'; }
  const [baseline, setBaseline] = useState(incoming), [data, setData] = useState<ProjectDirection>(() => incoming?.data ?? emptyProjectDirection(project));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [browsedStage, setBrowsedStage] = useState<ProjectDirectionStage | null>(null);
  const attempt = useRef<RecordInput<ProjectDirection> | null>(null), alive = useRef(true);
  const original = baseline?.data ?? emptyProjectDirection(project), dirty = canonicalJson(data) !== canonicalJson(original);
  const newer = Boolean(incoming && incoming.version > (baseline?.version ?? 0));
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onDirty?.(dirty || busy || Boolean(attempt.current)); }, [dirty, busy, error, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  useEffect(() => { if (incoming && incoming.version > (baseline?.version ?? 0) && !dirty && !busy && !attempt.current) { setBaseline(incoming); setData(incoming.data); } }, [incoming, baseline, dirty, busy]);
  function edit(next: ProjectDirection) { if (busy || attempt.current) return; setData(next); setNotice(''); setError(''); }
  function changeSlate(id: string, patch: Partial<SlateProject>) { edit({ ...data, slate: data.slate.map(item => item.id === id ? { ...item, ...patch } : item) }); }
  async function save() {
    if (busy || readError) return;
    try { validateProjectDirection(data, project); } catch { setError('Check titles and dates. Ready for review needs an owner and evidence reference; not applicable needs an owner and a reason. Keep notes within the displayed limits.'); return; }
    const input = attempt.current ?? { id: `project-direction:${project.id}`, kind: 'project-direction', expectedVersion: baseline?.version ?? null, requestId: crypto.randomUUID(), data: JSON.parse(canonicalJson(data)) as ProjectDirection };
    attempt.current = input; setBusy(true); setError('');
    try { const saved = await saveProjectDirection(api, project, input); if (!alive.current) return; setBaseline(saved); setData(saved.data); attempt.current = null; setNotice(`Planning direction saved · v${saved.version}.`); onSaved(saved); }
    catch (caught) { if (alive.current) setError(caught instanceof Error ? caught.message : 'Save was not confirmed. Retry preserves this attempt.'); }
    finally { if (alive.current) setBusy(false); }
  }
  const locked = busy || Boolean(attempt.current) || Boolean(readError);
  const visibleStage = browsedStage ?? data.stage;
  const stage = directionStages.find(item => item.id === visibleStage)!;
  const nextAction = data.nextActions.find(item => item.stage === visibleStage && item.status !== 'DONE');
  const current = records.filter(record => (record.data as { sourceHash?: string | null }).sourceHash === project.sourceHash);
  const count = (kind: string) => current.filter(record => record.kind === kind).length;
  const stageEvidence: Record<ProjectDirectionStage, string> = {
    PREDEVELOPMENT: `${count('concept-draft')} saved concepts`,
    DEVELOPMENT: `${count('screenplay-draft')} saved writing drafts`,
    PREPRODUCTION: project.sourceHash === null ? 'Screenplay not attached' : `${(project.scenes as Scene[]).reduce((sum, scene) => sum + scene.shots.length, 0)} planned shots`,
    PRODUCTION: project.sourceHash === null ? `${count('studio-operation')} saved preparations` : `${count('generation-brief')} saved clip briefs`,
    WRAP: 'Department closeout',
    FINISHING: project.sourceHash === null ? `${count('studio-media')} imported references` : `${count('measured-media-take')} measured takes`,
    MARKETING: `${count('pitch-draft')} saved pitches`,
    DISTRIBUTION: 'Release & reporting',
  };
  const summaries = [
    ['Business', data.businessObjectives, 'Define the objective'], ['Audience', data.audienceHypotheses, 'Name the audience hypothesis'],
    ['Canon', data.canonQuestions, 'Record open questions'], ['Marketing', data.marketingPlan, 'Outline the approach'],
  ];
  function addSlate() { setEditing(true); edit({ ...data, slate: [...data.slate, { id: crypto.randomUUID(), title: 'Untitled project', stage: 'DEVELOPMENT', nextAction: '', canonNotes: '', businessGoal: '', audienceHypothesis: '', marketingAngle: '' }] }); }
  function note(field: 'businessObjectives' | 'audienceHypotheses' | 'planningNotes' | 'canonQuestions' | 'marketingPlan', label: string, placeholder: string) { return <label>{label}<textarea aria-label={label} rows={3} maxLength={8000} disabled={locked} value={data[field]} placeholder={placeholder} onChange={event => edit({ ...data, [field]: event.target.value })}/></label>; }
  return <section className="project-direction" aria-label="Project direction" data-unsaved={dirty || Boolean(attempt.current) ? 'true' : 'false'}>
    <header className="direction-heading"><div><span className="eyebrow">STORY TO RELEASE</span><h2>Production pipeline</h2></div><div className="direction-heading-actions"><span className="direction-draft">{dirty ? 'Unsaved planning' : baseline ? `Saved · v${baseline.version}` : 'Planning draft'}</span><button className="direction-edit-toggle" aria-expanded={editing} onClick={() => setEditing(value => !value)}>{editing ? 'Close editor' : 'Edit direction'}</button></div></header>
    {readError && <p role="alert">{readError}</p>}
    <nav className="direction-rail" aria-label="Lifecycle working focus">{directionStages.map((item, index) => <button key={item.id} disabled={busy} aria-pressed={visibleStage === item.id} onClick={() => setBrowsedStage(item.id)}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.label}</strong><small>{stageEvidence[item.id]}</small></button>)}</nav>
    <div className="direction-focus"><div><span className="direction-focus-label">{nextAction ? 'UP NEXT' : 'SUGGESTED NEXT STEP'}</span><p>{nextAction?.title || directionGuidance[visibleStage]}</p><small>{stage.label} · {stage.detail}. Counts show saved work, not completed gates.</small></div>{onOpenStage && <button onClick={() => onOpenStage(visibleStage)}>Open workspace <ArrowRight size={14}/></button>}</div>
    <ProductionReadinessPanel plan={data.productionPlan ?? emptyProductionPlan()} stage={visibleStage} disabled={locked} onChange={productionPlan => edit({ ...data, schemaVersion: 2, productionPlan })} onOpenWorkspace={onOpenWorkspace} onSelectStage={setBrowsedStage}/>
    <div className="direction-handoff-export"><button disabled={Boolean(readError) || busy} onClick={() => { downloadLocalBlob(new Blob([productionPlanReport(project, data, baseline?.version ?? null, dirty)], { type: 'text/markdown;charset=utf-8' }), 'production-department-handoff.md'); setNotice('Department handoff prepared for local export. It includes current working edits and labels their save status.'); }}>Export department handoff</button><small>All stages · owner assignments, evidence references and open work</small></div>
    <div className="direction-overview" hidden={editing}>
      <details className="direction-project-notes"><summary>Project brief, canon & related ideas · {data.slate.length} other titles</summary>
      <div className="direction-summary-grid">{summaries.map(([label, value, placeholder]) => <button key={label} onClick={() => setEditing(true)}><span>{label}</span><p className={value.trim() ? '' : 'is-empty'}>{value.trim() || placeholder}</p><ArrowRight size={12}/></button>)}</div>
      <div className="direction-section-heading"><div><h3>Related project ideas <span>{data.slate.length}</span></h3></div><button disabled={locked || data.slate.length >= 40} onClick={addSlate}><Plus size={14}/>Add project idea</button></div>
      <div className="direction-slate-overview">{data.slate.slice(0, 5).map(item => <button key={item.id} onClick={() => setEditing(true)}><strong>{item.title}</strong><span>{directionStages.find(stage => stage.id === item.stage)?.label}</span><p>{item.nextAction || 'Set the next step'}</p><ArrowRight size={13}/></button>)}{!data.slate.length && <p className="direction-empty">Add another title to plan its focus and next step alongside this project.</p>}{data.slate.length > 5 && <button className="direction-all-slate" onClick={() => setEditing(true)}>View all {data.slate.length} slate entries <ArrowRight size={13}/></button>}</div>
      </details>
    </div>
    <div className="direction-editor" hidden={!editing}>
    <label className="direction-saved-focus">Saved working focus<select aria-label="Saved working focus" disabled={locked} value={data.stage} onChange={event => edit({ ...data, stage: event.target.value as ProjectDirectionStage })}>{directionStages.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <div className="direction-starter"><div><small>Suggested starting point</small><p>{directionGuidance[data.stage]}</p></div><button disabled={locked || data.nextActions.length >= 50} onClick={() => edit({ ...data, nextActions: [...data.nextActions, { id: crypto.randomUUID(), title: directionGuidance[data.stage], stage: data.stage, status: 'TODO' }] })}><Plus size={14}/>Add suggested action</button></div>
    <MandateReviewPanel disabled={locked} remainingCharacters={Math.max(0, 8000 - data.planningNotes.length - (data.planningNotes ? 2 : 0))} onAddNote={text => edit({ ...data, planningNotes: [data.planningNotes, text].filter(Boolean).join('\n\n') })}/>
    <div className="direction-business">{note('businessObjectives' , 'Business objectives', 'What should this project achieve, and what would make it worthwhile?')}{note('audienceHypotheses', 'Audience hypotheses', 'Who might this be for? What evidence would test that idea?')}</div>
    <details className="direction-planning"><summary>Story, canon questions & marketing plan</summary><div className="direction-business">{note('planningNotes', 'Planning notes', 'Creative intention, constraints and decisions to revisit.')}{note('canonQuestions', 'Canon questions', 'Record unresolved identities, events or contradictions without declaring them canon.')}{note('marketingPlan', 'Marketing plan', 'Positioning, pitch materials, channels and experiments to prepare.')}</div></details>
    <div className="direction-section-heading"><div><h3>Next actions</h3><p>Owner task tracking. Marking an action done does not clear a production gate.</p></div><button disabled={locked || data.nextActions.length >= 50} onClick={() => edit({ ...data, nextActions: [...data.nextActions, { id: crypto.randomUUID(), title: '', stage: data.stage, status: 'TODO' }] })}><Plus size={14}/>Add action</button></div>
    <div className="direction-actions">{data.nextActions.map((item, index) => <div key={item.id}><input aria-label={`Action ${index + 1} title`} value={item.title} maxLength={500} disabled={locked} placeholder="The next useful step" onChange={event => edit({ ...data, nextActions: data.nextActions.map(action => action.id === item.id ? { ...action, title: event.target.value } : action) })}/><select aria-label={`Action ${index + 1} stage`} value={item.stage} disabled={locked} onChange={event => edit({ ...data, nextActions: data.nextActions.map(action => action.id === item.id ? { ...action, stage: event.target.value as ProjectDirectionStage } : action) })}>{directionStages.map(stage => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select><select aria-label={`Action ${index + 1} status`} value={item.status} disabled={locked} onChange={event => edit({ ...data, nextActions: data.nextActions.map(action => action.id === item.id ? { ...action, status: event.target.value as DirectionActionStatus } : action) })}><option value="TODO">To do</option><option value="IN_PROGRESS">In progress</option><option value="DONE">Done · task only</option></select><button aria-label={`Remove action ${index + 1}`} disabled={locked} onClick={() => edit({ ...data, nextActions: data.nextActions.filter(action => action.id !== item.id) })}><X size={14}/></button></div>)}{!data.nextActions.length && <p className="direction-empty">Add a concrete next step for the current focus.</p>}</div>
    <div className="direction-section-heading"><div><h3>Related project ideas</h3><p>Keep related project ideas and priorities here. To open a film, use Hampton’s Slate at the top of the desktop window.</p></div><button disabled={locked || data.slate.length >= 40} onClick={() => edit({ ...data, slate: [...data.slate, { id: crypto.randomUUID(), title: 'Untitled project', stage: 'DEVELOPMENT', nextAction: '', canonNotes: '', businessGoal: '', audienceHypothesis: '', marketingAngle: '' }] })}><Plus size={14}/>Add project idea</button></div>
    <div className="direction-slate">{data.slate.map((item, index) => <article key={item.id}><div className="direction-slate-row"><input aria-label={`Slate project ${index + 1} title`} value={item.title} maxLength={240} disabled={locked} onChange={event => changeSlate(item.id, { title: event.target.value })}/><select aria-label={`Slate project ${index + 1} stage`} value={item.stage} disabled={locked} onChange={event => changeSlate(item.id, { stage: event.target.value as ProjectDirectionStage })}>{directionStages.map(stage => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select><button disabled={locked} aria-label={`Remove slate project ${index + 1}`} onClick={() => edit({ ...data, slate: data.slate.filter(row => row.id !== item.id) })}><X size={14}/></button></div><label>Next step<input aria-label={`Slate project ${index + 1} next step`} value={item.nextAction} maxLength={1000} disabled={locked} placeholder="One useful next step" onChange={event => changeSlate(item.id, { nextAction: event.target.value })}/></label><details><summary>Business, audience, canon & marketing notes</summary><div className="direction-business">{(['businessGoal','audienceHypothesis','canonNotes','marketingAngle'] as const).map(field => { const label = { businessGoal: 'Business goal', audienceHypothesis: 'Audience hypothesis', canonNotes: 'Canon notes', marketingAngle: 'Marketing angle' }[field]; return <label key={field}>{label}<textarea aria-label={`Slate project ${index + 1} ${label.toLowerCase()}`} rows={2} maxLength={1000} disabled={locked} value={item[field]} onChange={event => changeSlate(item.id, { [field]: event.target.value })}/></label>; })}</div></details></article>)}{!data.slate.length && <p className="direction-empty">Start a planning entry for another title. Source-library groupings do not become productions automatically.</p>}</div>
    </div>
    {newer && <p className="direction-warning">A newer saved direction is available. Your edits remain here with their original version.</p>}
    {error && <p role="alert" className="direction-warning">{error} No automatic retry was made.</p>}{notice && <p role="status">{notice}</p>}
    <footer hidden={!editing && !dirty && !error && !notice}><span>{dirty ? 'Unsaved planning changes' : baseline ? `Saved · v${baseline.version}` : project.sourceHash === null ? 'Project planning · no production screenplay attached' : 'Separate from the frozen screenplay'}</span><div>{(newer || error) && <button disabled={busy} onClick={() => { attempt.current = null; setBaseline(incoming); setData(incoming?.data ?? emptyProjectDirection(project)); setError(''); setNotice('Loaded the latest supplied saved direction.'); }}>Discard edits and load saved</button>}<button className="direction-save" disabled={busy || Boolean(readError) || (!dirty && Boolean(baseline) && !error)} onClick={() => void save()}><Save size={14}/>{busy ? 'Saving…' : error && attempt.current ? 'Retry same direction' : 'Save direction'}</button></div></footer>
  </section>;
}
