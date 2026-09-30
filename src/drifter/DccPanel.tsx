import { validateShotDirection, type ShotDirection } from '../../local/contracts/shot-direction.mjs';
import './shot-direction.css';
import { useEffect, useId, useRef, useState } from 'react';
import { downloadLocalBlob } from './localDownload';
import WorkflowContextBar from './WorkflowContextBar';
import CameraReturns from './CameraReturns';
import DccStageReturns from './DccStageReturns';
import DccRehearsals from './DccRehearsals';
import BlenderReadinessSummary, { type BlenderReadinessStatus } from './BlenderReadinessSummary';
import { verifyWorkflowContext, type FlowContextProps } from './workflowApi';
import type { Project, Scene, WorkspaceApi, WorkspaceRecord } from './types';
import { hashCanonical } from './canonical';
import { dccStageKitZip, verifyDccStageKit, type DccStageOptions, type DccPrevizOptions } from './DccApi';
import { getDrifterPrevizPreset } from './dccDrifterPresets';
import { FilmcraftDisclosure } from './FilmcraftGuide';
import { horizontalFieldOfViewDegrees, STAGE_SENSOR_WIDTH_MM } from './cameraPlanning';
import './dcc.css';

type DccContext = { schemaVersion: 'filmstack-dcc-context/v1'; observation: null | { observedAt: string; unityVersions: string[]; blenderInstallation: string }; unityConnection: 'UNVERIFIED'; blenderConnection: 'UNVERIFIED'; deviceCamera: 'NOT_ACTIVE' };
type ExchangeCell = { id:string; role:'START'|'MOMENT'|'END'; description:string; actionRefs:string[]; imageHash:string|null };
type Exchange = { schemaVersion: string; sha256: string; basis: { sha256: string }; source: { projectId: string; sourceHash: string }; scene: { id: string; heading: string; shots: { id: string; description: string; cells: ExchangeCell[]; artisticDirection?: { recordRef: { id: string; version: number; sha256: string }; direction: ShotDirection; text: string; authority: 'ARTISTIC_PLANNING_ONLY'; executable: false } }[] }; execution: { canExecute: false } };
type StageDraft = { shotId: string; target: DccStageOptions['target']; lensMm: string; durationSeconds: string; motion: DccStageOptions['motion']; travelMm: string; blockingNotes: string; greybox?: boolean; layout?: DccPrevizOptions['layout']; subjectCount?: string; depthLayers?: boolean; lookNotes?: string };
export type DccShotRequest = { nonce: string; projectId: string; sourceHash: string; sceneId: string; shotId: string };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const invalid = () => new Error('The camera exchange does not match this project and scene. Refresh the preparation before continuing.');

function validateContext(value: unknown): DccContext {
  if (!object(value) || value.schemaVersion !== 'filmstack-dcc-context/v1' || value.deviceCamera !== 'NOT_ACTIVE'
    || value.unityConnection !== 'UNVERIFIED' || value.blenderConnection !== 'UNVERIFIED') throw invalid();
  const observation = value.observation;
  if (observation !== null && (!object(observation) || typeof observation.observedAt !== 'string' || !Number.isFinite(Date.parse(observation.observedAt))
    || !Array.isArray(observation.unityVersions) || observation.unityVersions.length > 32
    || !observation.unityVersions.every(item => typeof item === 'string' && item.length > 0 && item.length <= 80)
    || !['NOT_FOUND_IN_CHECKED_LOCATIONS', 'FOUND'].includes(String(observation.blenderInstallation)))) throw invalid();
  return value as DccContext;
}

async function validateExchange(value: unknown, project: Project, scene: Scene): Promise<Exchange> {
  if (!object(value) || value.schemaVersion !== 'filmstack-camera-exchange/v1' || !digest(value.sha256)
    || !object(value.basis) || !digest(value.basis.sha256) || !object(value.source)
    || value.source.sourceHash !== project.sourceHash || value.source.projectId !== project.id
    || !object(value.scene) || value.scene.id !== scene.id || value.scene.heading !== scene.heading
    || !Array.isArray(value.scene.shots) || value.scene.shots.length !== scene.shots.length || value.scene.shots.length > 10
    || !object(value.execution) || value.execution.canExecute !== false) throw invalid();
  const cells = new Set<string>();
  for (const [index, shot] of value.scene.shots.entries()) {
    if (!object(shot) || shot.id !== scene.shots[index].id || typeof shot.description !== 'string' || !Array.isArray(shot.cells)) throw invalid();
    if (shot.artisticDirection !== undefined) {
      const direction = shot.artisticDirection;
      if (!object(direction) || direction.authority !== 'ARTISTIC_PLANNING_ONLY' || direction.executable !== false || typeof direction.text !== 'string' || !object(direction.recordRef) || !digest(direction.recordRef.sha256)) throw invalid();
      const checked = validateShotDirection(direction.direction, project);
      if (checked.sceneId !== scene.id || checked.shotId !== shot.id) throw invalid();
    }
    for (const cell of shot.cells) {
      if (!object(cell) || typeof cell.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(cell.id)
        || cells.has(cell.id) || !['START', 'MOMENT', 'END'].includes(String(cell.role)) || typeof cell.description !== 'string'
        || !Array.isArray(cell.actionRefs) || !cell.actionRefs.every(item => typeof item === 'string')
        || (cell.imageHash !== null && !digest(cell.imageHash))) throw invalid();
      cells.add(cell.id);
    }
  }
  if (cells.size > 400) throw invalid();
  const { sha256, ...payload } = value;
  if (await hashCanonical(payload) !== sha256) throw new Error('The camera exchange failed its content-hash check. No file was exported.');
  return value as unknown as Exchange;
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    if (response.status === 409) throw new Error('This camera plan is stale. Refresh the preparation and export again. No file was exported.');
    if (response.status === 401) throw new Error('The local owner session expired. Reconnect to the workspace before exporting.');
    throw new Error('The local service could not prepare this scene. Refresh the preparation and try again.');
  }
  if (response.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') throw new Error('The local service returned an unexpected file type. No file was exported.');
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > 1024 * 1024) throw new Error('The camera exchange exceeds the local preview limit. No file was exported.');
  return JSON.parse(text);
}

export default function DccPanel({ project, scene, open, onClose, flow, api, onSaved, shotRequest, onOpenStoryboard, onReviewTake, embedded = false }: { project: Project; scene: Scene; open: boolean; onClose(): void; flow?: FlowContextProps; api?: WorkspaceApi; onSaved?(record:WorkspaceRecord):void; shotRequest?: DccShotRequest; onOpenStoryboard?(sceneId:string,shotId:string,cellId:string):void; onReviewTake?(sceneId:string,shotId:string,takeId:string):void; embedded?: boolean }) {
  const [data, setData] = useState<{ scope: string; context: DccContext; exchange: Exchange } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [returnRefresh, setReturnRefresh] = useState(0);
  const [returnRequest, setReturnRequest] = useState<{scope:string;receiptSha256:string;nonce:number}>();
  const [stageDrafts, setStageDrafts] = useState<Record<string, StageDraft>>({});
  const [promptPreview, setPromptPreview] = useState<{ key: string; text: string } | null>(null);
  const [blenderStatus, setBlenderStatus] = useState<{scope:string;status:BlenderReadinessStatus}>();
  const [preparedKitKey, setPreparedKitKey] = useState('');
  const panel = useRef<HTMLElement>(null);
  const lensHelpId = useId();
  const blockingHelpId = useId();
  const generation = useRef(0);
  const download = useRef<AbortController | null>(null);
  const handledShotRequest = useRef<string>();
  const url = `/api/dcc/exchange?sceneId=${encodeURIComponent(scene.id)}&sourceHash=${encodeURIComponent(project.sourceHash)}`;
  const scope = `${project.id}:${project.sourceHash}:${scene.id}`;
  const visible = data?.scope === scope ? data : null;
  const requestKey = shotRequest ? JSON.stringify([scope, shotRequest.nonce, shotRequest.projectId, shotRequest.sourceHash, shotRequest.sceneId, shotRequest.shotId]) : '';
  const requestInvalid = Boolean(shotRequest && (typeof shotRequest.nonce !== 'string' || !shotRequest.nonce.length
    || shotRequest.projectId !== project.id || shotRequest.sourceHash !== project.sourceHash || shotRequest.sceneId !== scene.id
    || !scene.shots.some(shot => shot.id === shotRequest.shotId)));
  const requestPending = Boolean(shotRequest && handledShotRequest.current !== requestKey);
  const retainedDraft: StageDraft = stageDrafts[scope] ?? { shotId: scene.shots[0]?.id ?? '', target: 'BLENDER', lensMm: '50', durationSeconds: '5', motion: 'STATIC', travelMm: '1000', blockingNotes: '' };
  const draft: StageDraft = requestInvalid ? { ...retainedDraft, shotId: '' } : requestPending ? { ...retainedDraft, shotId: shotRequest!.shotId } : retainedDraft;
  const updateStage = (patch: Partial<StageDraft>) => setStageDrafts(previous => ({ ...previous, [scope]: { ...draft, ...patch } }));
  const scenePreset = getDrifterPrevizPreset(project.sourceHash, scene.id);
  const previz: DccPrevizOptions | undefined = draft.target === 'BLENDER' && draft.greybox ? { layout: draft.layout ?? 'OPEN_GROUND', subjectCount: Number(draft.subjectCount ?? '1'), depthLayers: draft.depthLayers ?? true, lookNotes: draft.lookNotes ?? '' } : undefined;
  const previewKey = `${scope}:${visible?.exchange.basis.sha256}:${JSON.stringify(draft)}`;
  const boundedInteger = (value: string, min: number, max: number) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
  const lensValid = boundedInteger(draft.lensMm, 10, 200);
  const horizontalFieldOfView = lensValid ? horizontalFieldOfViewDegrees(Number(draft.lensMm), STAGE_SENSOR_WIDTH_MM) : null;
  const stageValid = !requestInvalid && !requestPending && scene.shots.some(shot => shot.id === draft.shotId) && lensValid
    && boundedInteger(draft.durationSeconds, 1, 180) && boundedInteger(draft.travelMm, 0, 5000) && draft.blockingNotes.length <= 4000
    && (!previz || (boundedInteger(draft.subjectCount ?? '1', 1, 6) && previz.lookNotes.length <= 4000));
  useEffect(() => {
    if (!open || !shotRequest || handledShotRequest.current === requestKey) return;
    download.current?.abort(); download.current = null; setExporting(false); setPromptPreview(null);
    if (requestInvalid) return;
    handledShotRequest.current = requestKey;
    setStageDrafts(previous => ({ ...previous, [scope]: { ...(previous[scope] ?? retainedDraft), shotId: shotRequest.shotId } }));
    setNotice('Requested storyboard shot selected. Existing camera settings and direction notes are retained for review; no rehearsal has started.');
    // Apply a deliberate navigation request once; typing must not reapply it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, requestKey, requestInvalid, scope]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); const serial = ++generation.current; let current = true;
    setLoading(true); setData(null); setError(''); setNotice(''); setExporting(false);
    const read = async (path: string) => {
      const response = await fetch(path, { credentials: 'same-origin', redirect: 'error', signal: controller.signal });
      return readJson(response);
    };
    void Promise.all([read('/api/dcc/context'), read(url)]).then(async ([context, exchange]) => {
      const checkedContext = validateContext(context), checkedExchange = await validateExchange(exchange, project, scene);
      if (current && generation.current === serial) setData({ scope, context: checkedContext, exchange: checkedExchange });
    }).catch(reason => { if (current) setError(reason instanceof Error ? reason.message : 'Camera preparation failed.'); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; generation.current = serial + 1; controller.abort(); download.current?.abort(); download.current = null; };
  }, [open, url, project, scene, scope, refresh]);

  async function exportExchange() {
    if (!visible || loading || exporting || requestInvalid || requestPending) return;
    const serial = generation.current, controller = new AbortController(); download.current = controller;
    setExporting(true); setError(''); setNotice('');
    try {
      const response = await fetch(`${url}&basisHash=${visible.exchange.basis.sha256}&download=1`, { credentials: 'same-origin', redirect: 'error', signal: controller.signal });
      const checked = await validateExchange(await readJson(response), project, scene);
      if (checked.basis.sha256 !== visible.exchange.basis.sha256 || checked.sha256 !== visible.exchange.sha256) throw new Error('The downloaded camera exchange changed after preview. Refresh the preparation. No file was exported.');
      if (generation.current !== serial || controller.signal.aborted) return;
      downloadLocalBlob(new Blob([JSON.stringify(checked, null, 2) + '\n'], { type: 'application/json' }), `camera-exchange-${checked.sha256.slice(0, 12)}.json`);
      setNotice('Verified exchange prepared. Choose its destination to finish saving.');
    } catch (reason) { if (generation.current === serial && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Camera export failed. No file was exported.'); }
    finally { if (generation.current === serial) setExporting(false); if (download.current === controller) download.current = null; }
  }
  async function exportStageKit(previewOnly = false) {
    if (!visible || loading || exporting || !stageValid) return;
    const serial = generation.current, controller = new AbortController(); download.current = controller;
    const options: DccStageOptions = { sceneId: scene.id, expectedSourceHash: project.sourceHash, expectedBasisHash: visible.exchange.basis.sha256,
      shotId: draft.shotId, target: draft.target, lensMm: Number(draft.lensMm), durationSeconds: Number(draft.durationSeconds),
      motion: draft.motion, travelMm: Number(draft.travelMm), blockingNotes: draft.blockingNotes, ...(previz ? { previz } : {}) };
    setExporting(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/dcc/stage-kit', { method: 'POST', credentials: 'same-origin', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options) });
      const kit = await verifyDccStageKit(await readJson(response), project.id, options);
      const checked = await validateExchange(JSON.parse(kit.files.find(file => file.path === 'camera-exchange.json')!.content), project, scene);
      if (checked.sha256 !== visible.exchange.sha256) throw invalid();
      if (generation.current !== serial || controller.signal.aborted) return;
      setPreparedKitKey(previewKey);
      const prompts = kit.files.find(file => file.path === 'previz-prompts.md');
      if (prompts) setPromptPreview({ key: previewKey, text: prompts.content });
      if (previewOnly) { setNotice('Source-linked rehearsal and look prompts prepared. Review them before exporting or generating.'); return; }
      const bytes = await dccStageKitZip(kit);
      if (generation.current !== serial || controller.signal.aborted) return;
      downloadLocalBlob(new Blob([bytes as BlobPart], { type: 'application/zip' }), `caniscreenwrite-${draft.target.toLowerCase()}-${draft.shotId}-${kit.sha256.slice(0, 8)}.zip`);
      setNotice(`${draft.target === 'BLENDER' ? 'Blender rehearsal' : 'Unity Director'} kit verified. Choose a destination, then follow README.txt in the kit. No editor has run.`);
    } catch (reason) { if (generation.current === serial && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Directing kit export failed.'); }
    finally { if (generation.current === serial) setExporting(false); if (download.current === controller) download.current = null; }
  }
  async function exportLinkedPlan() {
    const handoff=flow?.context?.handoff.record;
    if(!visible||loading||exporting||requestInvalid||requestPending||flow?.context?.readiness!=='READY_FOR_PLANNING'||!handoff)return;
    const serial=generation.current,controller=new AbortController();download.current=controller;setExporting(true);setError('');setNotice('');
    try {
      const query=new URLSearchParams({sceneId:scene.id,sourceHash:project.sourceHash,basisHash:visible.exchange.basis.sha256,handoffId:handoff.id,handoffSha256:handoff.sha256});
      const response=await fetch(`/api/dcc/linked-export?${query}`,{credentials:'same-origin',redirect:'error',signal:controller.signal});
      const raw=await readJson(response);
      if(!object(raw)||Object.keys(raw).some(key=>!['schema','exchange','workflowContext','authority','productionAuthorized','sourceReplacement','sha256'].includes(key))||raw.schema!=='filmstack-linked-camera-plan/v1'||!digest(raw.sha256)||raw.authority!=='PLANNING_CONTEXT_ONLY'||raw.productionAuthorized!==false||raw.sourceReplacement!==false)throw invalid();
      const {sha256,...body}=raw;if(await hashCanonical(body)!==sha256)throw invalid();
      const checked=await validateExchange(raw.exchange,project,scene);
      if(checked.sha256!==visible.exchange.sha256||checked.basis.sha256!==visible.exchange.basis.sha256)throw invalid();
      const workflow=await verifyWorkflowContext(raw.workflowContext,project,scene.id,{handoffRef:{id:handoff.id,sha256:handoff.sha256}});
      if(workflow.status!=='CURRENT'||workflow.readiness!=='READY_FOR_PLANNING')throw new Error('The linked writing changed after preview. Refresh and review the planning link before exporting. No file was exported.');
      if(generation.current!==serial||controller.signal.aborted)return;
      downloadLocalBlob(new Blob([JSON.stringify(raw,null,2)+'\n'],{type:'application/json'}),`writing-camera-plan-${sha256.slice(0,12)}.json`);setNotice('Writing revision and camera exchange verified together. Choose a destination to finish saving.');
    }catch(reason){if(generation.current===serial&&!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Writing and camera export failed.');}
    finally{if(generation.current===serial)setExporting(false);if(download.current===controller)download.current=null;}
  }
  useEffect(() => {
    if (!open || embedded) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary') ?? []);
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, [open, onClose, embedded]);
  if (!open) return null;
  const observation = visible?.context.observation;
  const directedShot=visible?.exchange.scene.shots.find(shot=>shot.id===draft.shotId);
  const sourceRefs=new Set(directedShot?.cells.flatMap(cell=>cell.actionRefs)??[]);
  const sourcePassages=(scene.paragraphs??[]).filter(paragraph=>sourceRefs.has(paragraph.id));
  const shotLabel=scene.shots.find(shot=>shot.id===draft.shotId)?.label??draft.shotId;
  function showSection(selector:string) {
    const element=panel.current?.querySelector<HTMLElement>(selector);
    element?.scrollIntoView?.({block:'start'});
    element?.querySelector<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')?.focus({preventScroll:true});
  }
  function reviewReturn(receiptSha256:string) {
    setReturnRequest(prior=>({scope,receiptSha256,nonce:(prior?.nonce??0)+1}));
    showSection('.dcc-stage-returns');
  }
  const content = <section className={embedded ? 'dcc-panel dcc-panel-embedded' : 'dcc-panel'} role={embedded ? 'region' : 'dialog'} aria-modal={embedded ? undefined : true} aria-label="3D and cameras" ref={panel}>
    <header><div><span className="eyebrow">CANISCREENWRITE / DIRECTING</span><h2>Stage your scene.</h2><p>Block the action, find the camera and rehearse the move before generating the shot.</p></div>{embedded ? <button type="button" className="secondary dcc-back-to-storyboard" onClick={onClose}>Back to movie</button> : <button aria-label="Close 3D and cameras" onClick={onClose}>×</button>}</header>
    {flow && <WorkflowContextBar {...flow} stage="cameras"/>}
    {loading && <p role="status">Preparing this scene’s camera exchange…</p>}{error && <p role="alert" className="error-text">{error}</p>}{notice && <p role="status" aria-label="Preparation status">{notice}</p>}
    {requestInvalid && <p role="alert" className="error-text">The requested storyboard shot is unavailable or belongs to a different project source or scene. Reopen its current storyboard target before preparing a camera kit.</p>}
    <button className="secondary" disabled={loading || exporting} onClick={() => setRefresh(value => value + 1)}>Refresh preparation</button>
    {visible && <>
      <section className="dcc-director" aria-label="Scene directing workflow"><div className="dcc-director-heading"><div><span className="eyebrow">SCENE {String(scene.index).padStart(2, '0')}</span><h3>{scene.heading}</h3></div><span className="dcc-proposal-tag">Rehearsal proposal</span></div>
        <nav aria-label="Rehearsal workflow"><ol className="dcc-workflow-steps"><li><button onClick={()=>showSection('.dcc-stage-fields')}><b>01</b><strong>Plan the shot</strong><span>Camera, blocking and timing</span></button></li><li><button onClick={()=>showSection(draft.target==='BLENDER'?'.dcc-local-rehearsal':'.dcc-stage-export')}><b>02</b><strong>Run or export</strong><span>{draft.target==='BLENDER'?'Local Blender rehearsal':'Unity Director kit'}</span></button></li><li><button onClick={()=>showSection('.dcc-stage-returns')}><b>03</b><strong>Review returned frames</strong><span>Import or choose a return</span></button></li><li><button onClick={()=>showSection('.dcc-stage-return-selected')}><b>04</b><strong>Use in storyboard</strong><span>Add a pending frame candidate</span></button></li></ol></nav>
        <fieldset disabled={loading || exporting || requestInvalid || requestPending} className="dcc-stage-fields"><legend>Prepare a local directing kit</legend>
          <div className="dcc-application-choices" role="group" aria-label="Application"><span>Application</span><div><button type="button" aria-pressed={draft.target==='BLENDER'} onClick={()=>updateStage({target:'BLENDER'})}>Blender · camera rehearsal</button><button type="button" aria-pressed={draft.target==='UNITY'} onClick={()=>updateStage({target:'UNITY'})}>Unity · scene blocking</button></div></div>
          <label>Shot to direct<select value={draft.shotId} onChange={event => updateStage({ shotId: event.target.value })}>{requestInvalid && <option value="">Requested shot unavailable</option>}{scene.shots.map(shot => <option key={shot.id} value={shot.id}>{shot.label ?? shot.id} · {shot.description ?? ''}</option>)}</select></label>
          {directedShot&&<section className="dcc-shot-context" aria-label="Selected shot context"><div><span className="eyebrow">SHOT {shotLabel}</span><h4>{directedShot.description||'Direction not yet recorded'}</h4><p>{draft.lensMm} mm · {draft.durationSeconds} s planned · {draft.motion==='STATIC'?'Locked off':draft.motion==='DOLLY_IN'?'Dolly in':'Dolly out'} · {directedShot.cells.length} reference frames</p></div>
            {directedShot.cells.length>0&&<div className="dcc-shot-references">{directedShot.cells.map(cell=><article key={cell.id}>{cell.imageHash&&<img src={`/api/blobs/${cell.imageHash}`} alt={`${cell.role==='START'?'Opening':cell.role==='END'?'Ending':'Moment'} reference: ${cell.description}`}/>}<strong>{cell.role==='START'?'Scene opening':cell.role==='END'?'Ending':'Moment'}</strong><p>{cell.description}</p>{onOpenStoryboard&&<button type="button" className="secondary" onClick={()=>onOpenStoryboard(scene.id,directedShot.id,cell.id)}>Open reference in storyboard</button>}</article>)}</div>}
            {sourcePassages.length>0?<div className="dcc-shot-passages"><strong>Source passages linked by these frames</strong>{sourcePassages.map(paragraph=><p key={paragraph.id}><span>{paragraph.type}</span>{paragraph.text}</p>)}</div>:<p>No source passages are linked through this shot’s reference frames. The shot description and camera settings remain planning directions.</p>}
          </section>}
          {draft.target==='BLENDER'&&directedShot&&<BlenderReadinessSummary shotId={draft.shotId} status={blenderStatus?.scope===scope?blenderStatus.status:undefined} kitPrepared={preparedKitKey===previewKey} disabled={loading||exporting||!stageValid} onRehearsal={()=>showSection('.dcc-local-rehearsal')} onExport={()=>void exportStageKit()} onReview={reviewReturn}/>}
          <label className="dcc-stage-notes">Blocking direction<textarea rows={3} maxLength={4000} value={draft.blockingNotes} aria-describedby={blockingHelpId} placeholder="Where should the action happen? Add your staging intention without changing the screenplay." onChange={event => updateStage({ blockingNotes: event.target.value })}/></label>
          <p id={blockingHelpId} className="dcc-blocking-help">Blocking means where performers stand and how they move through the scene.</p>
          <div className="dcc-lens-setting">
            <label>Lens · mm<input type="number" min="10" max="200" step="1" value={draft.lensMm} aria-describedby={lensHelpId} aria-invalid={!lensValid} onChange={event => updateStage({ lensMm: event.target.value })}/></label>
            <div id={lensHelpId} className="dcc-lens-coverage">
              <output aria-label="Horizontal field of view">{horizontalFieldOfView === null ? 'Enter a whole 10–200 mm lens for coverage.' : `${horizontalFieldOfView.toFixed(1)}° horizontal field of view`}</output>
              <small>{STAGE_SENSOR_WIDTH_MM} mm stage sensor · ideal rectilinear estimate</small>
            </div>
          </div>
          <label>Rehearsal · seconds<input type="number" min="1" max="180" step="1" value={draft.durationSeconds} onChange={event => updateStage({ durationSeconds: event.target.value })}/></label>
          <label>Camera move<select value={draft.motion} onChange={event => updateStage({ motion: event.target.value as StageDraft['motion'] })}><option value="STATIC">Locked off</option><option value="DOLLY_IN">Dolly in</option><option value="DOLLY_OUT">Dolly out</option></select></label>
          <label>Travel · mm<input type="number" min="0" max="5000" step="100" disabled={draft.motion === 'STATIC'} value={draft.travelMm} onChange={event => updateStage({ travelMm: event.target.value })}/></label>
          {draft.target === 'BLENDER' && scenePreset && <div className="dcc-stage-notes"><button type="button" disabled={loading || exporting} onClick={() => {
            updateStage({ greybox: true, layout: scenePreset.layout, subjectCount: String(scenePreset.subjectCount), depthLayers: true, blockingNotes: scenePreset.blockingNotes, lookNotes: scenePreset.lookNotes, lensMm: '24', durationSeconds: '5', motion: 'DOLLY_IN', travelMm: '1000' });
            setNotice('Drifter scene draft loaded. Review the layout, source questions and five-second camera test before rehearsing.');
          }}>Use Drifter scene setup</button><p>A prepared starting point for this exact screenplay revision. Sets, staging and timing remain editable proposals.</p></div>}
          {draft.target === 'BLENDER' && <label className="dcc-stage-notes dcc-previz-toggle"><input type="checkbox" checked={Boolean(draft.greybox)} onChange={event => updateStage({ greybox: event.target.checked })}/>Use greybox blocking + look prompts</label>}
          {previz && <>
            <label>Blocking layout<select value={previz.layout} onChange={event => updateStage({ layout: event.target.value as DccPrevizOptions['layout'] })}><option value="OPEN_GROUND">Open ground / road</option><option value="VEHICLE_DECK">Vehicle platform / rails</option><option value="ALLEY">Alley / corridor</option><option value="ENCLOSED_ROOM">Room / shop</option><option value="STAIRWELL">Stairs / landing</option><option value="WOODED_PATH">Wooded path</option></select></label>
            <label>Unassigned stand-ins<input type="number" min="1" max="6" step="1" value={draft.subjectCount ?? '1'} onChange={event => updateStage({ subjectCount: event.target.value })}/></label>
            <label className="dcc-stage-notes dcc-previz-toggle"><input type="checkbox" checked={previz.depthLayers} onChange={event => updateStage({ depthLayers: event.target.checked })}/>Foreground, action space and background depth cues</label>
            <label className="dcc-stage-notes">Look / visual treatment<textarea rows={3} maxLength={4000} value={previz.lookNotes} onChange={event => updateStage({ lookNotes: event.target.value })} placeholder="Describe the lighting, palette and surface detail for the later generated image. The greybox stays neutral."/></label>
          </>}
        </fieldset>
        {visible?.exchange.scene.shots.filter(shot => shot.id === draft.shotId && shot.artisticDirection).map(shot => <section key={shot.id} className="saved-shot-direction" aria-label="Saved camera direction"><h4>Shot direction · v{shot.artisticDirection!.recordRef.version}</h4><pre>{shot.artisticDirection!.text}</pre><p>Included in the camera package as planning context. Set supported camera motion and physical values above.</p></section>)}
        <FilmcraftDisclosure context="camera" compact className="dcc-camera-guide" label="Camera, framing & focus guide"/>
        {scenePreset && scenePreset.conflicts.length > 0 && <section className="dcc-phone-workflow"><h4>{scenePreset.conflicts.length} source and shot-plan questions for this scene</h4><ul>{scenePreset.conflicts.map((conflict, index) => <li key={`${conflict.shotId}:${index}`}><strong>{conflict.shotId.replace('drifter-vr-', '').toUpperCase()}</strong> — {conflict.description} <small>Source: {conflict.sourceParagraphIds.join(', ')}</small></li>)}</ul><p>Resolve the intended staging before generation. The current shot plan and screenplay are retained.</p></section>}
        <p className="scope-note">These editable template settings are proposed, not extracted from the screenplay. Preview template: 24 fps, 1920 × 1080, 36 mm sensor. {draft.target==='UNITY' ? 'Frame the camera in Unity Director, then apply the plan from that pose. Add and position your blocking objects in Unity.' : <>Blender starts 6 m back and 2 m high. {previz ? 'Greybox geometry tests framing and depth; it is not your finished set or cast. The kit keeps blocking and visual-treatment prompts separate.' : 'It frames an unassigned stand-in; it does not reconstruct your set or cast.'}</>}</p>
        {previz && <div className="dcc-previz-prompts"><button disabled={loading || exporting || !stageValid} onClick={() => void exportStageKit(true)}>Preview rehearsal & look prompts</button>{promptPreview?.key === previewKey && <details open><summary>Source-linked prompt pair</summary><pre>{promptPreview.text}</pre></details>}{promptPreview && promptPreview.key !== previewKey && <p>Settings changed. Preview again to refresh the prompt pair.</p>}</div>}
        {draft.target === 'UNITY' && <section className="dcc-editor-route" aria-label="Unity directing steps"><h4>Continue in your Unity project</h4><ol><li>Export the Director kit, open its README and import it into a separate Unity project.</li><li>Apply the selected-shot plan, adjust blocking, and save the scene.</li><li>Use <strong>Render opening / midpoint / ending return to QiMovi</strong> for three 1920 × 1080 stills, or <strong>Export editable scene return to QiMovi</strong> for the scene alone.</li><li>Import the extracted return files below, then review each frame in the storyboard.</li></ol><p>The render action requires a saved scene and the built-in render pipeline. Unity runs through this exported kit; an interactive Unity MCP connection is not established here.</p></section>}
        {!stageValid && <p className="error-text">Choose a valid shot, a 10–200 mm lens, 1–180 whole seconds, and 0–5000 mm travel. {previz && 'Use 1–6 stand-ins and keep each note within 4,000 characters.'}</p>}
        <div className="dcc-stage-export"><button className="primary" disabled={loading || exporting || !stageValid} onClick={() => void exportStageKit()}>{exporting ? 'Checking export…' : draft.target === 'BLENDER' ? 'Export Blender rehearsal kit ↗' : 'Export Unity Director kit ↗'}</button><p>ZIP includes exact source links, editable preparation, instructions and local application files. Exporting does not open an editor.</p></div>
        {draft.target === 'BLENDER' && <DccRehearsals key={scope} projectId={project.id} options={{sceneId:scene.id,expectedSourceHash:project.sourceHash,expectedBasisHash:visible.exchange.basis.sha256,shotId:draft.shotId,target:'BLENDER',lensMm:Number(draft.lensMm),durationSeconds:Number(draft.durationSeconds),motion:draft.motion,travelMm:Number(draft.travelMm),blockingNotes:draft.blockingNotes,...(previz?{previz}:{})}} disabled={loading||exporting||!stageValid} onRetained={()=>setReturnRefresh(value=>value+1)} onReviewReturn={reviewReturn} onStatusChange={status=>setBlenderStatus({scope,status})}/>}
      </section>
      <DccStageReturns key={`stage-return:${scope}`} project={project} scene={scene} open={open} disabled={loading || exporting} refreshKey={returnRefresh} returnRequest={returnRequest?.scope===scope?returnRequest:undefined} onSaved={onSaved} selectedShotId={draft.shotId} onReviewTake={onReviewTake ? takeId => onReviewTake(scene.id,draft.shotId,takeId) : undefined} onMotionRetained={async takeId => { if (!api) return; const snapshot = await api.bootstrap(); if (snapshot.project.id !== project.id || snapshot.project.sourceHash !== project.sourceHash) return; const take = snapshot.records.find(record => record.id === takeId && record.kind === 'measured-media-take'); if (take) onSaved?.(take); }} onOpenStoryboard={onOpenStoryboard}/>
      {previz && <section className="dcc-phone-workflow"><h4>Optional phone-directed camera take</h4><ol><li>Open a copy of the exported Blender rehearsal and select CAM_PHONE.</li><li>Connect a compatible phone bridge in Blender, calibrate scale and record a separate camera take.</li><li>Export a viewport motion clip and matching starting image for generation preparation.</li></ol><p>Phone pairing and capture are not connected in QiMovi yet. Rehearsal stills do not establish continuous footage.</p><a href="https://virtucamera.com/installation-in-blender/" target="_blank" rel="noreferrer">Example phone bridge setup: VirtuCamera ↗</a></section>}
      <section className="dcc-connection-details"><h3>Applications and connection status</h3><div className="dcc-connections"><section><span className="eyebrow">LOCAL UNITY</span><h3>Virtual production</h3><p>{observation?.unityVersions.length ? `Editors found: ${observation.unityVersions.join(', ')}` : 'Installation has not been checked.'}</p><strong>Editor connection unverified</strong></section><section><span className="eyebrow">LOCAL BLENDER</span><h3>Scene and camera design</h3><p>{observation?.blenderInstallation === 'NOT_FOUND_IN_CHECKED_LOCATIONS' ? 'No local installation found in the checked locations.' : observation?.blenderInstallation === 'FOUND' ? 'Local installation found.' : 'Installation has not been checked.'}</p><strong>Editor connection unverified</strong></section><section><span className="eyebrow">DEVICE CAMERA</span><h3>Reference capture</h3><p>Planned for reference and motion workflows.</p><strong>Camera is not active</strong></section></div>
      {observation && <p className="scope-note">Installation check retained {new Date(observation.observedAt).toLocaleString()}. Installed software does not establish a live editor connection.</p>}
      <p>Higgsfield Scene Builder runs in remote Blender. Its projects and cameras are separate from files on this Mac.</p></section>
      <div className="dcc-scene"><div><h3>Source and reference handoff</h3><p>The original exchange preserves every shot and ordered reference cell. Its source camera measurements remain unknown.</p></div><button className="secondary" disabled={exporting || loading || requestInvalid || requestPending} onClick={() => void exportExchange()}>Export camera exchange ↗</button></div>
      {flow?.context?.readiness==='READY_FOR_PLANNING' && <button className="primary" disabled={exporting||loading||requestInvalid||requestPending} onClick={()=>void exportLinkedPlan()}>Export writing + camera plan ↗</button>}
      <ol className="dcc-shots">{visible.exchange.scene.shots.map(shot => <li key={shot.id}><strong>{shot.id}</strong><span>{shot.description}</span><small>{shot.cells.length} reference frames</small></li>)}</ol>
      {api && onSaved && <section className="dcc-return-details"><h3>Return earlier Scene 4 Blender proof</h3><p>Use this importer only for the earlier fixed nine-file proof bundle.</p><CameraReturns key={scope} project={project} scene={scene} api={api} flow={flow} onSaved={onSaved}/></section>}
    </>}
  </section>;
  return embedded ? content : <div className="drawer-scrim dcc-scrim">{content}</div>;
}
