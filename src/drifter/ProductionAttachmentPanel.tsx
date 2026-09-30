import { useEffect, useRef, useState } from 'react';
import type { CreativeProject, Project } from './types';
import type { WritingProductionRecord } from './writingProductionApi';
import { productionAttachmentApi, type ProductionAttachmentApi, type ProductionAttachmentPreview } from './productionAttachmentApi';
import ProductionRevisionReview from './ProductionRevisionReview';
import type { WritingProductionScene } from './writingProductionApi';

export type ProductionDestination = 'storyboard' | 'cameras' | 'timeline' | 'budget';
type Props = { project: CreativeProject; plan: WritingProductionRecord; blocked: boolean; candidateBody?: string; attachedProject?: Project; onAttached(): Promise<void> | void; onOpenProduction?(destination: ProductionDestination): void; onBusy?(busy: boolean): void; onReuseCoverage?(scenes: WritingProductionScene[]): void; onScene?(sceneId: string): void; api?: ProductionAttachmentApi };

export default function ProductionAttachmentPanel({ project, plan, blocked, candidateBody, attachedProject, onAttached, onOpenProduction, onBusy, onReuseCoverage, onScene, api = productionAttachmentApi }: Props) {
  const [preview, setPreview] = useState<ProductionAttachmentPreview | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const attempt = useRef<{ basis: string; id: string }>();
  const alive = useRef(true), serial = useRef(0);
  useEffect(() => { alive.current = true; const sequence = serial; return () => { alive.current = false; ++sequence.current; }; }, []);
  useEffect(() => { setPreview(null); setError(''); setBusy(false); ++serial.current; }, [plan.id, plan.version, plan.sha256]);
  useEffect(() => { onBusy?.(busy); return () => onBusy?.(false); }, [busy, onBusy]);
  async function prepare() {
    if (blocked || busy) return;
    const id = ++serial.current; setBusy(true); setError('');
    try { const value = await api.prepare(project, plan); if (alive.current && id === serial.current) setPreview(value); }
    catch (caught) { if (alive.current && id === serial.current) setError(caught instanceof Error ? caught.message : 'The production handoff could not be prepared.'); }
    finally { if (alive.current && id === serial.current) setBusy(false); }
  }
  async function attach() {
    if (!preview || blocked || busy) return;
    const id = ++serial.current, selected = preview;
    if (attempt.current?.basis !== selected.previewSha256) attempt.current = { basis: selected.previewSha256, id: crypto.randomUUID() };
    setBusy(true); setError('');
    try {
      await api.attach(project, plan, selected, attempt.current.id);
      if (alive.current && id === serial.current) await onAttached();
    } catch (caught) { if (alive.current && id === serial.current) setError(caught instanceof Error ? caught.message : 'The handoff was not confirmed. Retry to recover the same attachment.'); }
    finally { if (alive.current && id === serial.current) setBusy(false); }
  }
  const shotCount = plan.data.scenes.reduce((total, scene) => total + scene.shots.length, 0);
  return <section className="writing-production-attachment" aria-label="Production screenplay handoff">
    <header className="writing-production-attachment-heading"><div><span className="writing-production-stage-label">Writing → Production</span><h3>{attachedProject ? 'Production screenplay attached' : 'Take this plan into production'}</h3>
      <p>{attachedProject ? `The storyboard, camera rehearsals and cost targets use screenplay v${attachedProject.productionDraftRef?.version} and scene plan v${attachedProject.productionPlanRef?.version}. Your working drafts stay editable.` : 'Keep an exact production copy of this saved screenplay and shot list. Its scenes and shots become available in Storyboard, 3D & cameras, the timeline and Budget.'}</p>
    </div><span className="writing-production-attachment-state">{attachedProject ? 'Production copy retained' : 'Ready when you are'}</span></header>
    {attachedProject ? <>
      {attachedProject.productionPlanRef?.sha256 !== plan.sha256 && <p className="writing-production-revision-notice" role="status">Working plan updated. Compare it with the production copy below.</p>}
      <nav className="writing-production-attachment-actions" aria-label="Continue production">{(['storyboard', 'cameras', 'timeline', 'budget'] as const).map(destination => <button key={destination} onClick={() => onOpenProduction?.(destination)}>{({ storyboard: 'Open storyboard', cameras: 'Rehearse in Blender', timeline: 'Open movie timeline', budget: 'Plan production costs' })[destination]}</button>)}</nav>
      <ProductionRevisionReview project={attachedProject} plan={plan} blocked={blocked} candidateBody={candidateBody} onReuseCoverage={onReuseCoverage} onScene={onScene}/>
    </> : <>
      {!shotCount && <p>Add and save at least one shot before preparing the production copy.</p>}
      <button disabled={blocked || busy || !shotCount} onClick={() => void prepare()}>{busy ? 'Preparing…' : 'Review production handoff'}</button>
      {preview && <div className="writing-production-attachment-review"><strong>{preview.sceneCount} scenes · {preview.shotCount} planned shots</strong>
        <p>Screenplay v{preview.draftRef.version} · scene plan v{preview.planRef.version}. Existing assets, drafts and budget history stay in this project.</p>
        {preview.unplannedSceneIds.length > 0 && <p>{preview.unplannedSceneIds.length} scenes have no shots yet. They remain visible as coverage still to plan.</p>}
        <p>This retains a production planning copy. It does not approve rights, commit spending or start a render.</p>
        <button disabled={blocked || busy} onClick={() => void attach()}>{attempt.current?.basis === preview.previewSha256 ? 'Retry production handoff' : 'Use for production'}</button>
        <button disabled={busy} onClick={() => setPreview(null)}>Keep planning</button>
      </div>}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
