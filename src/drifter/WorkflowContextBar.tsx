import type { ProductionHandoff } from './types';
import type { FlowContextProps, WorkflowStage } from './workflowApi';
import './workflow.css';

export default function WorkflowContextBar({ project, sceneId, handoff, context, loading, error, onNavigate, onManage, stage }: FlowContextProps & { stage: WorkflowStage }) {
  const scene = project.scenes.find(item => item.id === sceneId);
  const saved = context?.handoff.record ?? handoff;
  const link = saved?.data as ProductionHandoff | undefined;
  const author = context?.authoring.record;
  const title = (author?.data as { title?: string } | undefined)?.title;
  const state = loading ? 'Checking saved lineage…' : error ? 'Lineage check unavailable' : context?.status === 'STALE' ? 'Linked revision needs review' : context?.readiness === 'READY_FOR_PLANNING' ? 'Saved planning link' : saved ? 'Saved link · checking currentness' : 'Link a saved writing revision';
  return <section className="workflow-context" aria-label="Shared production workflow">
    <div className="workflow-context-top"><div><span className="eyebrow">ONE PROJECT / {project.title}</span><p>Scene {scene?.index ?? '—'} · {scene?.heading ?? 'Select a scene'}{link?.shotIds.length ? ` · ${link.shotIds.length} linked shot${link.shotIds.length === 1 ? '' : 's'}` : ''}</p></div><button onClick={onManage}>{saved ? 'Review planning link' : 'Link writing to this scene'} <span>↗</span></button></div>
    <nav aria-label="Writing to generation workflow">{([['writing', '01', 'Writing'], ['film', '02', 'Film plan'], ['cameras', '03', 'Cameras'], ['generation', '04', 'Generation']] as const).map(([key, number, label]) => <button key={key} aria-current={stage === key ? 'step' : undefined} onClick={() => onNavigate(key)}><small>{number}</small>{label}<span>→</span></button>)}</nav>
    <div className="workflow-lineage"><span className={context?.status === 'STALE' || error ? 'workflow-needs-review' : ''}>{state}</span>{title && <strong>{title} · v{author?.version}</strong>}<small>Planning context · screenplay unchanged</small></div>
    {error && <p className="workflow-detail" role="status">{error}</p>}
  </section>;
}
