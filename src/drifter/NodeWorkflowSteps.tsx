import { ArrowUpRight, Download } from 'lucide-react';
import { nodeReadinessLabel, type NodeValidation, type NodeWorkStep } from './nodeWorkflowModel';
import './node-workflow-steps.css';

export default function NodeWorkflowSteps({ check, current, saved, busy, selectedId, onInspect, onContinue, onExport, onValidate }: {
  check: NodeValidation | null; current: boolean; saved: boolean; busy: boolean; selectedId?: string;
  onInspect(id: string): void; onContinue(step: NodeWorkStep): void; onExport(): void; onValidate(): void;
}) {
  const next = check?.plan.find(step => step.nodeId === check.nextAction?.nodeId);
  return <section className="nw-work-plan" aria-label="Ordered workflow steps">
    <div className="nw-work-plan-heading">
      <div><span className="eyebrow">SCENE WORKFLOW</span><h3>{!check ? 'Find your next production step' : current ? 'Work through this scene' : 'Update this work order'}</h3>
        <p>{!check ? 'Check the connections and saved inputs to see what is available, what is missing and which tool to open.' : !current ? 'The graph or its saved inputs changed. Check again before continuing or exporting. You can still inspect the earlier steps.' : 'Follow the connected steps below. Each action opens the existing scene tool or highlights what needs attention.'}</p></div>
      <div className="nw-work-plan-actions">{!current && <button className="primary" disabled={busy} onClick={onValidate}>{busy ? 'Working…' : check ? 'Recheck saved inputs' : 'Check saved inputs'}</button>}
        {check && <button className="secondary" disabled={busy || !current || !saved} title={!saved ? 'Save this graph before exporting its checked version.' : 'Download this saved graph and its dated planning check.'} onClick={onExport}><Download size={14}/>Export checked plan</button>}</div>
    </div>
    {check && <>
      <div className="nw-work-counts" aria-label="Workflow readiness counts">
        <span>{check.summary.totalSteps} steps</span><span>{check.summary.readyForReview} with retained inputs</span>
        <span>{check.summary.needsInput} need input</span><span>{check.summary.waitingOnUpstream} waiting</span>
        <span>{check.summary.preparationOnly} preparation</span><span>{check.summary.connectorUnavailable} connection gaps</span>
      </div>
      {next && <div className="nw-next-step"><div><strong>{current ? 'Start here' : 'Previously suggested'}: {next.label}</strong><p>{next.nextAction.reason}</p></div>
        <button className="primary" disabled={busy || !current} onClick={() => onContinue(next)}>{next.nextAction.label}<ArrowUpRight size={14}/></button></div>}
      <ol className="nw-work-steps">{check.plan.map((step, index) => <li key={step.nodeId} data-readiness={step.readiness} data-selected={selectedId === step.nodeId}>
        <button className="nw-step-inspect" disabled={busy} aria-label={`Inspect workflow step ${index + 1}: ${step.label}`} aria-pressed={selectedId === step.nodeId} onClick={() => onInspect(step.nodeId)}>
          <span className="nw-step-number">{index + 1}</span><span><strong>{step.label}</strong><small>{nodeReadinessLabel[step.readiness]}</small></span>
        </button>
        <p>{step.nextAction.reason}</p>
        <small>{step.evidence === 'RETAINED_INPUTS' ? 'Saved inputs retained for review' : 'Planned step · result not established'}{step.inputRefs.length ? ` · ${step.inputRefs.length} input references` : ''}</small>
        {step.dependsOn.length > 0 && <div className="nw-step-dependencies"><small>Receives from</small>{step.dependsOn.map(id => <button key={id} disabled={busy} aria-label={`Inspect prerequisite ${check.plan.find(item => item.nodeId === id)?.label ?? id} for ${step.label}`} onClick={() => onInspect(id)}>{check.plan.find(item => item.nodeId === id)?.label ?? id}</button>)}</div>}
        {step.blockedBy.length > 0 && <div className="nw-step-dependencies nw-step-blocker"><small>Resolve first</small>{step.blockedBy.map(id => <button key={id} disabled={busy} aria-label={`Resolve ${check.plan.find(item => item.nodeId === id)?.label ?? id} before ${step.label}`} onClick={() => onInspect(id)}>{check.plan.find(item => item.nodeId === id)?.label ?? id}<ArrowUpRight size={12}/></button>)}</div>}
        <button className="nw-step-continue" aria-label={`${step.nextAction.label} for workflow step ${index + 1}`} disabled={busy || !current} onClick={() => onContinue(step)}>{step.nextAction.label}<ArrowUpRight size={13}/></button>
      </li>)}</ol>
      {check.plan.length === 0 && <p>Add a source or production node to begin.</p>}
      <p className="nw-work-save-note">{!saved ? 'Save graph to retain this work order and enable a checked-plan export. ' : ''}A connected step is a plan. Tool execution and creative approval happen in their own workspaces.</p>
    </>}
  </section>;
}
