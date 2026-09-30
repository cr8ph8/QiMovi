import { ArrowUpRight, Download } from 'lucide-react';
import { nodeReadinessLabel, type NodeValidation, type NodeWorkStep } from './nodeWorkflowModel';
import './node-workflow-steps.css';

export default function NodeWorkflowSteps({ check, current, saved, busy, selectedId, onInspect, onContinue, onExport }: {
  check: NodeValidation | null; current: boolean; saved: boolean; busy: boolean; selectedId?: string;
  onInspect(id: string): void; onContinue(step: NodeWorkStep): void; onExport(): void;
}) {
  const next = check?.plan.find(step => step.nodeId === check.nextAction?.nodeId);
  return <section className="nw-work-plan" aria-label="Ordered workflow steps">
    <div className="nw-work-plan-heading">
      <div><span className="eyebrow">YOUR WORK ORDER</span><h3>{!check ? 'From saved inputs to the next decision' : current ? 'Work through this scene' : 'Update this work order'}</h3>
        <p>{!check ? 'Validate the plan to see each step, what it needs and where to continue.' : !current ? 'The graph or its saved inputs changed. Validate again before continuing or exporting.' : 'Steps use the existing scene tools. Saved inputs and planned branches still need review.'}</p></div>
      {check && <button className="secondary" disabled={busy || !current || !saved} title={!saved ? 'Save this graph before exporting its checked version.' : 'Download this saved graph and its dated planning check.'} onClick={onExport}><Download size={14}/>Export checked plan</button>}
    </div>
    {check && <>
      <div className="nw-work-counts" aria-label="Workflow readiness counts">
        <span>{check.summary.totalSteps} steps</span><span>{check.summary.readyForReview} with retained inputs</span>
        <span>{check.summary.needsInput} need input</span><span>{check.summary.waitingOnUpstream} waiting</span>
        <span>{check.summary.preparationOnly} preparation</span><span>{check.summary.connectorUnavailable} connection gaps</span>
      </div>
      {next && <div className="nw-next-step"><div><strong>Next: {next.label}</strong><p>{next.nextAction.reason}</p></div>
        <button className="primary" disabled={busy || !current} onClick={() => onContinue(next)}>{next.nextAction.label}<ArrowUpRight size={14}/></button></div>}
      <ol className="nw-work-steps">{check.plan.map((step, index) => <li key={step.nodeId} data-readiness={step.readiness} data-selected={selectedId === step.nodeId}>
        <button className="nw-step-inspect" disabled={busy || !current} aria-label={`Inspect workflow step ${index + 1}: ${step.label}`} onClick={() => onInspect(step.nodeId)}>
          <span className="nw-step-number">{index + 1}</span><span><strong>{step.label}</strong><small>{nodeReadinessLabel[step.readiness]}</small></span>
        </button>
        <p>{step.nextAction.reason}</p>
        {step.dependsOn.length > 0 && <small>After {step.dependsOn.map(id => check.plan.find(item => item.nodeId === id)?.label ?? id).join(', ')}</small>}
        {step.blockedBy.length > 0 && <small className="nw-step-blocker">Waiting on {step.blockedBy.map(id => check.plan.find(item => item.nodeId === id)?.label ?? id).join(', ')}</small>}
      </li>)}</ol>
      {check.plan.length === 0 && <p>Add a source or production node to begin.</p>}
      {!saved && <p className="nw-work-save-note">Save graph to retain this work order and enable a checked-plan export.</p>}
    </>}
  </section>;
}
