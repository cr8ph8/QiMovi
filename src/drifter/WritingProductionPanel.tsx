import { useEffect, useRef, useState } from 'react';
import { canonicalJson } from './canonical';
import { downloadLocalBlob } from './localDownload';
import type { CreativeProject, CreativeScreenplayDraft, Project, WorkspaceRecord } from './types';
import { writingProductionApi, writingDraftRef, type SavedDraftRef, type WritingProductionApi, type WritingProductionPreview, type WritingProductionRecord, type WritingProductionScene } from './writingProductionApi';
import ProductionAttachmentPanel, { type ProductionDestination } from './ProductionAttachmentPanel';
import './writing-production.css';

export type WritingPlanRequest = { nonce: string; draftRef: SavedDraftRef };
type Props = { project: CreativeProject; records: WorkspaceRecord[]; open: boolean; disabled?: boolean; request?: WritingPlanRequest; onSaved(record: WorkspaceRecord): void; onDirty?(dirty: boolean): void; onWrite(): void; api?: WritingProductionApi; handoffBlocked?: boolean; attachedProject?: Project; onAttached?: () => void | Promise<void>; onOpenProduction?: (destination: ProductionDestination) => void };
const failure = (error: unknown) => error instanceof Error ? error.message : 'The scene plan was not saved. Your open work is retained.';

export default function WritingProductionPanel({ project, records, open, disabled = false, request, onSaved, onDirty, onWrite, api = writingProductionApi, attachedProject, onAttached, onOpenProduction, handoffBlocked = false }: Props) {
  const plans = records.filter(row => row.kind === 'writing-production-plan') as WritingProductionRecord[];
  const drafts = records.filter(row => row.kind === 'screenplay-draft');
  const [record, setRecord] = useState<WritingProductionRecord | null>(null);
  const [scenes, setScenes] = useState<WritingProductionScene[]>([]);
  const [sceneId, setSceneId] = useState('');
  const [draftId, setDraftId] = useState('');
  const [preview, setPreview] = useState<WritingProductionPreview | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [deferred, setDeferred] = useState<WritingPlanRequest | null>(null);
  const attempt = useRef<{ key: string; requestId: string }>();
  const handled = useRef(''), serial = useRef(0), alive = useRef(true);
  const coverageEditor = useRef<HTMLDivElement>(null);
  const dirty = Boolean(record && canonicalJson(scenes) !== canonicalJson(record.data.scenes));
  const scene = scenes.find(row => row.sceneId === sceneId) ?? scenes[0];
  const source = record?.data.source;
  const latestDraft = source && drafts.find(row => row.id === source.draftRef.id);
  const stale = Boolean(source && (!latestDraft || latestDraft.sha256 !== source.draftRef.sha256 || latestDraft.version !== source.draftRef.version));
  const newerPlan = record && plans.find(row => row.id === record.id && row.version > record.version);
  const saveKey = record ? canonicalJson({ id: record.id, version: record.version, scenes }) : '';
  const retryingSave = Boolean(attempt.current?.key === saveKey);
  const blocked = busy || disabled;
  const [attaching, setAttaching] = useState(false);
  const changes = dirty || busy || attaching;
  useEffect(() => { alive.current = true; return () => { alive.current = false; ++serial.current; }; }, []);
  useEffect(() => { onDirty?.(changes); }, [changes, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function load(next: WritingProductionRecord) {
    setRecord(next); setScenes(structuredClone(next.data.scenes)); setSceneId(next.data.scenes[0]?.sceneId ?? ''); setPreview(null); setNotice(`Scene plan opened · v${next.version}`); setError(''); attempt.current = undefined;
  }
  async function review(ref: SavedDraftRef) {
    if (blocked || dirty) return;
    const id = ++serial.current; setBusy(true); setError(''); setPreview(null); setNotice(''); setDraftId(ref.id);
    try { const next = await api.preview(project, ref); if (alive.current && serial.current === id) setPreview(next); }
    catch (caught) { if (alive.current && serial.current === id) setError(failure(caught)); }
    finally { if (alive.current && serial.current === id) setBusy(false); }
  }
  useEffect(() => {
    if (!open || !request || handled.current === request.nonce || blocked) return;
    handled.current = request.nonce;
    if (dirty) setDeferred(request); else void review(request.draftRef);
    // An explicit navigation request is consumed once; edits do not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, request?.nonce, blocked, dirty]);
  function requestId(key: string) {
    if (attempt.current?.key !== key) attempt.current = { key, requestId: crypto.randomUUID() };
    return attempt.current.requestId;
  }
  async function retain() {
    if (!preview || blocked || dirty) return;
    const captured = preview, id = ++serial.current; setBusy(true); setError('');
    try {
      const next = await api.handoff(project, captured, requestId(`handoff:${captured.previewSha256}`));
      if (alive.current && serial.current === id) { onSaved(next); load(next); setNotice('Scene plan saved. Select a scene and add the shots you intend to make.'); }
    } catch (caught) { if (alive.current && serial.current === id) setError(failure(caught)); }
    finally { if (alive.current && serial.current === id) setBusy(false); }
  }
  async function save() {
    if (!record || !dirty || blocked || (stale && !retryingSave)) return;
    const captured = record, content = structuredClone(scenes), id = ++serial.current; setBusy(true); setError('');
    try {
      const next = await api.save(project, captured, content, requestId(canonicalJson({ id: captured.id, version: captured.version, scenes: content })));
      if (alive.current && serial.current === id) { onSaved(next); setRecord(next); setScenes(structuredClone(next.data.scenes)); setNotice(`Scene plan saved locally · v${next.version}`); attempt.current = undefined; }
    } catch (caught) { if (alive.current && serial.current === id) setError(failure(caught)); }
    finally { if (alive.current && serial.current === id) setBusy(false); }
  }
  function editScene(patch: Partial<Pick<WritingProductionScene, 'notes' | 'shots'>>) {
    if (!scene || blocked || stale) return;
    setScenes(previous => previous.map(row => row.sceneId === scene.sceneId ? { ...row, ...patch } : row)); setNotice('');
  }
  const exactDraft = source && drafts.find(row => row.id === source.draftRef.id && row.sha256 === source.draftRef.sha256);
  const excerpt = scene && exactDraft ? (exactDraft.data as CreativeScreenplayDraft).body.slice(scene.start, scene.end) : null;
  if (!open) return null;
  return <section className="writing-production" aria-label="Screenplay production plan" data-unsaved={dirty ? 'true' : 'false'}>
    <header><div><h2>Scenes & shots</h2><p>Choose a saved screenplay revision, review its scenes, then plan your coverage.</p></div><button onClick={onWrite}>Back to writing</button></header>
    <div className="writing-production-toolbar">
      <label>Saved screenplay<select aria-label="Screenplay for scene planning" value={draftId} disabled={blocked || dirty} onChange={event => { setDraftId(event.target.value); setPreview(null); }}><option value="">Choose a revision</option>{drafts.map(row => <option key={row.id} value={row.id}>{(row.data as CreativeScreenplayDraft).title} · v{row.version}</option>)}</select></label>
      <button disabled={blocked || dirty || !draftId} onClick={() => { const draft = drafts.find(row => row.id === draftId); if (draft) void review(writingDraftRef(draft)); }}>Review scene handoff</button>
      <label>Saved scene plans<select aria-label="Saved scene plans" value={record?.id ?? ''} disabled={blocked || dirty} onChange={event => { const plan = plans.find(row => row.id === event.target.value); if (plan) load(plan); }}><option value="">Choose a plan</option>{plans.map(row => <option key={row.id} value={row.id}>{row.data.source.title} · screenplay v{row.data.source.draftRef.version} · plan v{row.version}</option>)}</select></label>
    </div>
    {!drafts.length && <p>Save a screenplay in Write to begin. Scene headings such as “INT. ROOM – DAY” identify the scene boundaries.</p>}
    {deferred && <div role="status"><p>A different writing revision is waiting. Save or discard this open plan before reviewing it.</p><button disabled={blocked || dirty} onClick={() => { setDeferred(null); void review(deferred.draftRef); }}>Review waiting revision</button><button onClick={() => setDeferred(null)}>Keep this plan</button></div>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {preview && <section className="writing-production-preview" aria-label="Review scene handoff"><h3>{preview.source.title} · screenplay v{preview.source.draftRef.version}</h3><p>{preview.scenes.length} scenes · {preview.source.characters.length} speaking character cues. Existing drafts, media and budgets stay in this project.</p><ol>{preview.scenes.map(row => <li key={row.sceneId}><strong>{row.heading}</strong><span>{row.characters.length ? row.characters.join(', ') : 'No character cues in this scene'}</span></li>)}</ol><details><summary>Saved revision identity</summary><p>Draft: {preview.source.draftRef.id} · revision {preview.source.draftRef.version}</p><code style={{ overflowWrap: 'anywhere' }}>{preview.source.draftRef.sha256}</code></details><p>This saves a planning copy of the scene structure. It does not replace an approved production screenplay or create shots automatically.</p><button disabled={blocked || dirty} onClick={() => void retain()}>{preview.existingPlanRef ? 'Open retained scene plan' : 'Create scene plan'}</button><button disabled={blocked} onClick={() => setPreview(null)}>Cancel handoff</button></section>}
    {record && <>
      <div className="writing-production-saved"><span>{record.data.source.title} · screenplay v{record.data.source.draftRef.version} · plan v{record.version}{dirty ? ' · Unsaved changes' : ' · Saved locally'}</span><div><button disabled={blocked || !dirty || (stale && !retryingSave)} onClick={() => void save()}>{retryingSave ? 'Retry scene plan save' : 'Save scene plan'}</button><button disabled={blocked || dirty} onClick={() => { const latest = plans.find(row => row.id === record.id); if (latest) load(latest); }}>Reopen saved plan</button><button disabled={blocked || !dirty} onClick={() => { setScenes(structuredClone(record.data.scenes)); setNotice('Open edits discarded; the saved plan is retained.'); }}>Discard plan edits</button><button disabled={blocked || dirty} onClick={() => downloadLocalBlob(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }), `scene-plan-v${record.version}.json`)}>Export saved plan</button></div></div>
      {onAttached && handoffBlocked && !attachedProject && <p role="status">Save your other open drafts before attaching the production copy. Use the unsaved-work links above to return to them.</p>}
      {onAttached && <ProductionAttachmentPanel project={project} plan={record} candidateBody={exactDraft ? (exactDraft.data as CreativeScreenplayDraft).body : undefined} blocked={blocked || dirty || stale || Boolean(newerPlan) || handoffBlocked} attachedProject={attachedProject} onAttached={onAttached} onOpenProduction={onOpenProduction} onBusy={setAttaching} onScene={id => { setSceneId(id); coverageEditor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} onReuseCoverage={next => { if (blocked || dirty || stale || newerPlan) return; setScenes(next); setNotice('Coverage copied into this working plan. Review the shots, then save the scene plan. Production has not changed.'); }}/>}
      {newerPlan && <p role="status">A newer saved plan v{newerPlan.version} is available. Your open changes are retained; save or discard them before reopening.</p>}
      {stale && <p role="alert">The screenplay has changed since this plan was made. This plan remains readable. Review the current saved revision to create its own plan; earlier shots are kept here for comparison.</p>}
      <div className="writing-production-layout" ref={coverageEditor}><nav aria-label="Production planning scenes">{scenes.map(row => <button key={row.sceneId} aria-pressed={scene?.sceneId === row.sceneId} onClick={() => setSceneId(row.sceneId)}><span>{String(row.ordinal).padStart(2, '0')} · {row.heading}</span><small>{row.shots.length} planned shots</small></button>)}</nav>
        {scene && <div className="writing-production-scene"><h3>{scene.ordinal}. {scene.heading}</h3><p>{scene.characters.length ? `Character cues: ${scene.characters.join(', ')}` : 'No speaking character cues recorded.'}</p>{excerpt && <details><summary>Read screenplay scene</summary><pre>{excerpt}</pre></details>}
          <fieldset disabled={blocked || stale}><label>Scene direction<textarea value={scene.notes} maxLength={4000} onChange={event => editScene({ notes: event.target.value })} placeholder="Dramatic purpose, blocking, continuity or production needs"/></label>
            <div className="writing-production-shot-heading"><h4>Shot list</h4><button type="button" disabled={scene.shots.length >= 100} onClick={() => editScene({ shots: [...scene.shots, { id: `planned-shot:${crypto.randomUUID()}`, title: `Shot ${scene.shots.length + 1}`, description: '', shotType: '', cameraMovement: '', durationSeconds: null }] })}>Add shot</button></div>
            {!scene.shots.length && <p>Add the coverage this scene needs. Shot size, movement and timing remain open until you choose them.</p>}
            {scene.shots.map((shot, index) => <section key={shot.id} className="writing-production-shot" aria-label={`Planned shot ${index + 1}`}><label>Shot label<input aria-label={`Shot ${index + 1} label`} value={shot.title} maxLength={160} onChange={event => editScene({ shots: scene.shots.map(row => row.id === shot.id ? { ...row, title: event.target.value } : row) })}/></label><label>Action & framing<textarea aria-label={`Shot ${index + 1} action`} value={shot.description} maxLength={4000} onChange={event => editScene({ shots: scene.shots.map(row => row.id === shot.id ? { ...row, description: event.target.value } : row) })}/></label><div className="writing-production-shot-options"><label>Shot size<input aria-label={`Shot ${index + 1} size`} value={shot.shotType} maxLength={120} placeholder="e.g. Wide shot" onChange={event => editScene({ shots: scene.shots.map(row => row.id === shot.id ? { ...row, shotType: event.target.value } : row) })}/></label><label>Camera movement<input aria-label={`Shot ${index + 1} movement`} value={shot.cameraMovement} maxLength={120} placeholder="e.g. Static, dolly in" onChange={event => editScene({ shots: scene.shots.map(row => row.id === shot.id ? { ...row, cameraMovement: event.target.value } : row) })}/></label><label>Planned seconds (whole seconds)<input aria-label={`Shot ${index + 1} planned seconds`} type="number" min="1" max="3600" step="1" value={shot.durationSeconds ?? ''} placeholder="Unknown" onChange={event => { const seconds = event.target.value === '' ? null : Number(event.target.value); if (seconds !== null && (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 3600)) { setError('Planned seconds must be blank or a whole number from 1 to 3,600.'); return; } setError(''); editScene({ shots: scene.shots.map(row => row.id === shot.id ? { ...row, durationSeconds: seconds } : row) }); }}/></label></div><div className="writing-production-shot-actions"><button type="button" disabled={!index} onClick={() => { const rows = [...scene.shots]; [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]]; editScene({ shots: rows }); }}>Move earlier</button><button type="button" disabled={index === scene.shots.length - 1} onClick={() => { const rows = [...scene.shots]; [rows[index], rows[index + 1]] = [rows[index + 1], rows[index]]; editScene({ shots: rows }); }}>Move later</button><button type="button" onClick={() => editScene({ shots: scene.shots.filter(row => row.id !== shot.id) })}>Remove from draft</button></div></section>)}
          </fieldset>
          <p className="writing-production-boundary">These are planned setups. Use the reviewed production handoff above to carry this revision into the storyboard, camera rehearsals and budget cost targets.</p>
        </div>}
      </div>
    </>}
  </section>;
}
