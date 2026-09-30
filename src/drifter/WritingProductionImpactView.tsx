import type { WorkspaceRecord } from './types';
import type { WritingProductionImpact } from './writingProductionImpact';
import './scene-index.css';

function recordTitle(record: WorkspaceRecord) {
  const data = record.data as unknown as Record<string, unknown>;
  return typeof data.title === 'string' && data.title.trim() ? data.title : record.kind.replace(/-/g, ' ');
}

export default function WritingProductionImpactView({ impact, onOpenScene }: {
  impact: WritingProductionImpact;
  onOpenScene?: (sceneId: string) => void;
}) {
  const reviewCount = impact.dependents.filter(item => item.needsReview).length;
  const shotCount = new Set(impact.linkedScenes.flatMap(scene => scene.shotIds)).size;
  return <section className="writing-production-impact" aria-label="Writing production connections">
    <header><h3>Connected production</h3><span>Review preview</span></header>
    <p>Saved draft → planning handoff → production work. Draft scene numbers never change the retained film’s assignments.</p>
    {!impact.draftRef ? <p>Save this draft to begin connecting it to production.</p> : <>
      <p className="writing-impact-counts">{impact.linkedScenes.length} linked film {impact.linkedScenes.length === 1 ? 'scene' : 'scenes'} · {shotCount} planned {shotCount === 1 ? 'shot' : 'shots'} · {impact.dependents.length} connected {impact.dependents.length === 1 ? 'record' : 'records'}</p>
      {reviewCount > 0 && <p className="writing-impact-review">{reviewCount} connected {reviewCount === 1 ? 'record needs' : 'records need'} review{impact.hasUnsavedChanges ? ' against your draft changes' : ' because saved inputs differ or could not be checked'}.</p>}
      {!impact.linkedScenes.length && <p>No confirmed production scene handoff for this draft. Send a saved draft to a film scene to establish that connection.</p>}
      {impact.linkedScenes.length > 0 && <ul className="writing-impact-scenes" aria-label="Linked film scenes">
        {impact.linkedScenes.map(scene => <li key={scene.sceneId}>
          {onOpenScene ? <button type="button" onClick={() => onOpenScene(scene.sceneId)} aria-label={`Open film scene ${scene.index}: ${scene.heading}`}><strong>{String(scene.index).padStart(2, '0')} · {scene.heading}</strong></button> : <strong>{String(scene.index).padStart(2, '0')} · {scene.heading}</strong>}
          <small>{scene.shotIds.length} linked planned {scene.shotIds.length === 1 ? 'shot' : 'shots'} · {scene.needsReview ? 'Handoff needs review' : 'Uses current saved draft'}</small>
          {scene.relatedRecords.length > 0 && <details><summary>{scene.relatedRecords.length} {scene.relatedRecords.length === 1 ? 'record shares' : 'records share'} this scene or its shots</summary><p>These records share a production assignment. That alone does not establish that they used this draft.</p><ul>{scene.relatedRecords.map(record => <li key={record.id}><span>{recordTitle(record)}</span><small>{record.id}</small></li>)}</ul></details>}
        </li>)}
      </ul>}
      {impact.dependents.length > 0 && <details className="writing-impact-records"><summary>Review {impact.dependents.length} connected {impact.dependents.length === 1 ? 'record' : 'records'}</summary><ul>{impact.dependents.map(item => <li key={item.record.id}>
        <strong>{recordTitle(item.record)}</strong><span className={item.needsReview ? 'writing-impact-review' : ''}>{item.needsReview ? 'Needs review' : 'Uses current saved draft'}</span>
        <small>{item.relation === 'DIRECT' ? 'Direct draft reference' : 'Connected through saved inputs'} · {item.draftRevision === 'CURRENT' ? 'Current saved revision' : item.draftRevision === 'DIFFERENT' ? 'Another saved revision' : 'Current and other saved revisions'}</small>
        <small>{item.record.id} · v{item.record.version}</small>
      </li>)}</ul></details>}
    </>}
    {impact.unresolved.length > 0 && <details className="writing-impact-unresolved"><summary>{impact.unresolved.length} {impact.unresolved.length === 1 ? 'connection' : 'connections'} could not be checked</summary><p>These record chains could not be fully resolved. Their relationship to this draft is unknown; they are excluded from connected counts unless another complete path confirms it.</p><ul>{impact.unresolved.map((item, index) => <li key={`${item.record.id}:${item.ref.id}:${item.reason}:${index}`}><strong>{recordTitle(item.record)}</strong><small>{item.reason === 'REVISION_NOT_LOADED' ? 'Required saved revision is not loaded' : item.reason === 'SOURCE_MISMATCH' ? 'Source does not match this project' : item.reason === 'CYCLE' ? 'Circular input reference' : 'Input chain exceeds the review limit'} · {item.ref.id} · {item.ref.sha256.slice(0, 8)}</small></li>)}</ul></details>}
    <p className="writing-impact-boundary">This preview does not rebuild, reassign or approve production work.</p>
  </section>;
}
