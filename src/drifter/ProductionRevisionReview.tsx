import { useEffect, useRef, useState } from 'react';
import { downloadLocalBlob } from './localDownload';
import { productionRevisionApi, type ProductionRevisionApi, type ProductionRevisionPreview } from './productionRevisionApi';
import { reusableProductionCoverage } from './productionRevisionModel';
import ProductionRevisionChanges from './ProductionRevisionChanges';
import type { Project } from './types';
import type { WritingProductionRecord, WritingProductionScene } from './writingProductionApi';

type Props = { project: Project; plan: WritingProductionRecord; blocked: boolean; candidateBody?: string; onReuseCoverage?(scenes: WritingProductionScene[]): void; onScene?(sceneId: string): void; api?: ProductionRevisionApi };
export default function ProductionRevisionReview({ project, plan, blocked, candidateBody, onReuseCoverage, onScene, api = productionRevisionApi }: Props) {
  const [review, setReview] = useState<ProductionRevisionPreview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef<AbortController>();
  useEffect(() => { request.current?.abort(); setReview(null); setBusy(false); setError(''); return () => request.current?.abort(); }, [plan.id, plan.version, plan.sha256, project.productionAttachmentRef?.sha256]);
  async function compare() {
    if (blocked || busy) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try { const value = await api.review(project, plan, controller.signal); if (!controller.signal.aborted) setReview(value); }
    catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'The comparison could not be loaded.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const reuse = review ? reusableProductionCoverage(review, plan) : null;
  function workingTextForScene(sceneId: string) {
    const scene = plan.data.scenes.find(value => value.sceneId === sceneId);
    return candidateBody !== undefined && scene ? candidateBody.slice(scene.start, scene.end) : undefined;
  }
  return <section className="production-revision-review" aria-label="Production revision review" aria-busy={busy}>
    <header><div><h4>Compare with production</h4><p>Review screenplay changes and their effect on coverage, timing and production records.</p></div><button disabled={blocked || busy} onClick={() => void compare()}>{busy ? 'Comparing…' : review ? 'Refresh revision review' : 'Compare saved revisions'}</button></header>
    {blocked && <p className="production-revision-hint">Save open work and choose a current saved plan before comparing.</p>}
    {error && <p role="alert">{error}</p>}
    {review && <>
      <div className="production-revision-versions"><span><small>Production copy</small>Screenplay v{review.baselineDraftRef.version} · plan v{review.baselinePlanRef.version}</span><span aria-hidden="true">→</span><span><small>Working copy</small>Screenplay v{review.candidateDraftRef.version} · plan v{review.candidatePlanRef.version}</span></div>
      <p className="production-revision-hint">{review.sourceChanged ? 'The saved screenplay text differs.' : 'The screenplay text is unchanged.'} {review.metadataChanged && 'Screenplay or plan details also differ.'} {review.unplannedSceneIds.length > 0 && `${review.unplannedSceneIds.length} scenes still need planned coverage.`}</p>
      <ProductionRevisionChanges changes={review} originalTextForScene={sceneId => project.scenes.find(scene => scene.id === sceneId)?.paragraphs.map(paragraph => paragraph.text).join('')} workingTextForScene={workingTextForScene} onScene={onScene}/>
      <footer className="production-revision-action-context">
        <div className="production-revision-actions">{reuse && reuse.sceneCount > 0 && onReuseCoverage && <button className="production-revision-primary" disabled={blocked || busy} onClick={() => { onReuseCoverage(reuse.scenes); setReview(null); }}>Reuse {reuse.shotCount} planned {reuse.shotCount === 1 ? 'shot' : 'shots'} in {reuse.sceneCount} matching {reuse.sceneCount === 1 ? 'scene' : 'scenes'}</button>}<button disabled={blocked || busy} onClick={() => downloadLocalBlob(new Blob([JSON.stringify(review, null, 2)], { type: 'application/json' }), `production-revision-review-v${review.candidateDraftRef.version}.json`)}>Export revision review</button></div>
        {reuse && reuse.sceneCount > 0 && <p className="production-revision-hint">Reuse fills empty matching scenes with planned shots. Your new notes stay; copied coverage remains unsaved. Images and takes stay with their production revision.</p>}
        {reuse?.blockedReason && <p role="status">{reuse.blockedReason}</p>}
        {!review.coverageReuseSceneIds.length && review.summary.scenes.added > 0 && <p className="production-revision-hint">To reuse coverage, review scene identities in Write. Matching headings alone do not link scenes.</p>}
        <p className="production-revision-boundary">Review only. Production, storyboard, takes and budget keep their current revision. Applying a replacement production copy is not available yet.</p>
      </footer>
    </>}
  </section>;
}
