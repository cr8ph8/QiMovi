import { useEffect, useRef, useState } from 'react';
import { dccStageReturnsApi, DCC_STAGE_RETURN_LIMIT, type DccFrameChoice, type DccStageFrame, type DccStageReturn, type DccStageReturnsApi } from './dccStageReturnsApi';
import type { Project, Scene, WorkspaceRecord } from './types';
import DccMotionRenders from './DccMotionRenders';
import type { DccMotionRequest } from './dccMotionApi';
import './dcc-stage-returns.css';

interface Props { project: Project; scene: Scene; open: boolean; disabled?: boolean; refreshKey?:number; returnsApi?: DccStageReturnsApi; onSaved?(record:WorkspaceRecord):void; onOpenStoryboard?(sceneId:string,shotId:string,cellId:string):void; returnRequest?:{receiptSha256:string;nonce:number}; selectedShotId?:string; onReviewTake?(takeId:string):void; onMotionRetained?(takeId:string):void|Promise<void> }
interface CandidateDraft { receiptSha256:string; frameId:string; role:DccFrameChoice['role']; description:string; actionRefs:string[]; seconds:string }
interface ViewState { rows: DccStageReturn[]; selected: string; files: File[]; error: string; notice: string; candidate:CandidateDraft|null; adopted:string[]; adoptedCells:Record<string,string> }
const empty = (): ViewState => ({rows:[],selected:'',files:[],error:'',notice:'',candidate:null,adopted:[],adoptedCells:{}});
const roleLabel = { OPENING:'Opening', MOMENT:'Intermediate', ENDING:'Ending' };
export default function DccStageReturns({ project, scene, open, disabled=false, refreshKey=0, returnsApi=dccStageReturnsApi, onSaved, onOpenStoryboard, returnRequest, selectedShotId, onReviewTake, onMotionRetained }: Props) {
  const scope = `${project.id}:${project.sourceHash}:${scene.id}`;
  const [scopes,setScopes] = useState<Record<string,ViewState>>({}), [loading,setLoading] = useState(false), [busy,setBusy] = useState(false), [refresh,setRefresh] = useState(0);
  const state = scopes[scope] ?? empty(), current = useRef(scope), alive = useRef(true), input = useRef<HTMLInputElement>(null);current.current=scope;
  const handledReturn = useRef<number>();
  const attempts = useRef(new Map<string,{fingerprint:string;requestId:string}>());
  const motionRequests = useRef(new Map<string,DccMotionRequest>());
  const patch = (key:string, update:Partial<ViewState>|((prior:ViewState)=>ViewState)) => setScopes(previous => ({...previous,[key]:typeof update === 'function' ? update(previous[key] ?? empty()) : {...(previous[key] ?? empty()),...update}}));
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();setLoading(true);
    void returnsApi.load(project,scene,controller.signal).then(value=>{if(!controller.signal.aborted&&current.current===scope)patch(scope,{rows:value.returns,error:''});}).catch(error=>{if(!controller.signal.aborted&&current.current===scope)patch(scope,{error:error instanceof Error?error.message:'Rehearsal returns could not be read.'});}).finally(()=>{if(!controller.signal.aborted&&current.current===scope)setLoading(false);});
    return()=>controller.abort();
  },[open,scope,project,scene,returnsApi,refresh,refreshKey]);
  useEffect(()=>{
    if(!returnRequest||handledReturn.current===returnRequest.nonce||state.candidate||busy)return;
    const match=state.rows.find(row=>row.receiptSha256===returnRequest.receiptSha256);
    if(!match)return;
    handledReturn.current=returnRequest.nonce;
    patch(scope,{selected:match.id,notice:'Selected the exact retained return for this rehearsal.',error:''});
  },[returnRequest,state.rows,state.candidate,busy,scope]);
  function choose(files: FileList|null) {
    if(!files?.length||busy||disabled)return;
    const selected=[...files], archives=selected.filter(file=>file.name==='stage-return.zip'), extracted=selected.filter(file=>file.name!=='stage-return.zip');
    if(new Set(selected.map(file=>file.name)).size!==selected.length||selected.some(file=>file.name.toLowerCase().endsWith('.zip')&&file.name!=='stage-return.zip')||archives.length&&(!extracted.length||!extracted.some(file=>file.name==='stage-return.json'))) {patch(scope,{error:'ZIP archives are not read here. Extract one stage-return.zip, then choose its receipt and listed files.',notice:''});return;}
    if(extracted.length<6||extracted.length>24||extracted.reduce((sum,file)=>sum+file.size,0)>DCC_STAGE_RETURN_LIMIT) {patch(scope,{error:'Choose all 6–24 files from one extracted return folder, totalling at most 64 MiB.',notice:''});return;}
    patch(scope,{files:extracted,error:'',notice:archives.length?'stage-return.zip was excluded. Only the selected extracted files will be checked and retained.':''});
  }
  async function importFiles() {
    if(busy||loading||disabled||!state.files.length)return;
    const captured=scope, files=[...state.files], capturedProject=project, capturedScene=scene;setBusy(true);patch(captured,{error:''});
    try {const result=await returnsApi.importFiles(capturedProject,capturedScene,files);if(alive.current)patch(captured,prior=>({...prior,rows:[result.return,...prior.rows.filter(row=>row.id!==result.return.id)],selected:result.return.id,files:[],error:'',notice:result.replayed?'This exact return is already retained. Frames remain rehearsal candidates.':'Rehearsal return retained. Review its frames and editable scene; the storyboard is unchanged.'}));}
    catch(error){if(alive.current)patch(captured,{error:`${error instanceof Error?error.message:'Import was not confirmed.'} The selected files are retained here for an explicit retry.`});}
    finally{if(alive.current)setBusy(false);}
  }
  function prepareCandidate(returned:DccStageReturn, frame:DccStageFrame) {
    if(busy||disabled)return;
    const role=frame.role==='OPENING'&&frame.shotId===scene.shots[0]?.id?'START':frame.role==='ENDING'?'END':'MOMENT';
    patch(scope,{candidate:{receiptSha256:returned.receiptSha256,frameId:frame.id,role,description:`${roleLabel[frame.role]} — ${scene.shots.find(shot=>shot.id===frame.shotId)?.description??'Rehearsal frame'}`,actionRefs:[...frame.sourceRefs],seconds:''},error:'',notice:''});
  }
  async function saveCandidate() {
    const candidate=state.candidate,returned=state.rows.find(row=>row.receiptSha256===candidate?.receiptSha256),frame=returned?.frames.find(item=>item.id===candidate?.frameId);
    if(busy||disabled||!candidate||!returned||!frame)return;
    const seconds=candidate.seconds.trim();
    if(seconds&&(!/^\d+(\.\d{1,3})?$/.test(seconds)||Number(seconds)>86400)){patch(scope,{error:'Enter a planned time between 0 and 86,400 seconds, with at most three decimal places.'});return;}
    if(!candidate.description.trim()){patch(scope,{error:'Add a short description of the frame.'});return;}
    const captured=scope, choice={role:candidate.role,description:candidate.description,actionRefs:[...candidate.actionRefs],plannedTimestampMs:seconds?Math.round(Number(seconds)*1000):null};
    const key=`${captured}:${returned.receiptSha256}:${frame.id}`,fingerprint=JSON.stringify(choice);
    const previous=attempts.current.get(key), attempt=previous?.fingerprint===fingerprint?previous:{fingerprint,requestId:`dcc-adopt:${crypto.randomUUID()}`};attempts.current.set(key,attempt);
    setBusy(true);patch(captured,{error:''});
    try {
      const result=await returnsApi.adoptFrame(project,scene,returned,frame,{...choice,requestId:attempt.requestId});
      if(!alive.current)return;
      patch(captured,prior=>({...prior,candidate:null,adopted:[...new Set([...prior.adopted,`${returned.receiptSha256}:${frame.id}`])],adoptedCells:{...prior.adoptedCells,[`${returned.receiptSha256}:${frame.id}`]:(result.record.data as {cellId:string}).cellId},error:'',notice:'Storyboard candidate added. Its original camera plan and returned image are retained; review it in Frames before production.'}));
      if(current.current===captured)onSaved?.(result.record);
    } catch(error) {if(alive.current)patch(captured,{error:`${error instanceof Error?error.message:'Adding the candidate was not confirmed.'} Your choices are retained for an explicit retry.`});}
    finally {if(alive.current)setBusy(false);}
  }
  const selected=state.rows.find(row=>row.id===state.selected)??state.rows[0];
  const sceneFile=selected?.artifacts.find(item=>item.name.endsWith(selected.origin.target==='BLENDER'?'.blend':'.unity'));
  const receipt=selected?.artifacts.find(item=>item.name==='stage-return.json');
  const candidate=state.candidate, candidateFrame=selected?.frames.find(frame=>selected.receiptSha256===candidate?.receiptSha256&&frame.id===candidate.frameId);
  const updateCandidate=(update:Partial<CandidateDraft>)=>patch(scope,prior=>({...prior,candidate:prior.candidate?{...prior.candidate,...update}:null}));
  return <section className="dcc-stage-returns" aria-label="Returned rehearsal packages" hidden={!open} data-unsaved={Object.values(scopes).some(value=>value.files.length||value.candidate)?'true':undefined}>
    <div className="dcc-stage-return-heading"><div><h3>Review returned frames</h3><p>Local Blender runs appear here automatically. Import an exported Blender or Unity return to review edited scenes.</p></div><button className="secondary" disabled={busy||loading||disabled} onClick={()=>input.current?.click()}>Choose extracted return files</button><input ref={input} hidden type="file" multiple disabled={busy||disabled} aria-label="Choose extracted rehearsal return files" onChange={event=>{choose(event.currentTarget.files);event.currentTarget.value='';}}/></div>
    <p className="dcc-stage-return-scope">Scene {scene.index} · {scene.heading} · up to 64 MiB. Extract the ZIP first; this importer reads the original files inside it.</p>
    {state.files.length>0&&<div className="dcc-stage-return-import"><span>{state.files.length} files chosen · {(state.files.reduce((sum,file)=>sum+file.size,0)/1024/1024).toFixed(2)} MiB</span><button className="primary" disabled={busy||loading||disabled} onClick={()=>void importFiles()}>{busy?'Checking and retaining…':'Import rehearsal return'}</button><button disabled={busy} onClick={()=>patch(scope,{files:[],notice:'File selection cleared. Original files remain on disk.',error:''})}>Clear selection</button></div>}
    {state.error&&<p role="alert" className="dcc-stage-return-error">{state.error}</p>}{state.notice&&<p role="status" className="dcc-stage-return-notice">{state.notice}</p>}
    <div className="dcc-stage-return-browser"><label>Retained returns<select aria-label="Retained rehearsal return" value={selected?.id??''} disabled={busy||Boolean(candidate)||!state.rows.length} onChange={event=>patch(scope,{selected:event.target.value})}>{!state.rows.length&&<option value="">{loading?'Reading returns…':'No returns for this scene'}</option>}{state.rows.map(row=><option key={row.id} value={row.id}>{row.application.name} · shot {scene.shots.find(shot=>shot.id===row.origin.shotId)?.label??row.origin.shotId} · {row.receiptSha256.slice(0,8)}</option>)}</select></label><button disabled={busy||loading} onClick={()=>setRefresh(value=>value+1)}>Refresh returns</button></div>
    {returnRequest&&handledReturn.current!==returnRequest.nonce&&state.candidate&&<p className="dcc-stage-return-scope">Finish or cancel the current frame choices to open the requested rehearsal.</p>}
    {selected&&<div className="dcc-stage-return-selected"><div className="dcc-stage-return-title"><strong>{selected.application.name} {selected.application.version} · shot {scene.shots.find(shot=>shot.id===selected.origin.shotId)?.label??selected.origin.shotId}</strong><span>{selected.basis.status==='CURRENT'?'Current camera-plan basis':'Earlier camera-plan basis · review changes'}</span></div>
      {selectedShotId&&selected.origin.target==='BLENDER'&&<DccMotionRenders project={project} scene={scene} returned={selected} selectedShotId={selectedShotId} open={open} disabled={disabled||busy||loading} onReviewTake={onReviewTake} onMotionRetained={onMotionRetained} pendingRequests={motionRequests.current}/>}
      {selected.frames.length>0&&<p className="dcc-return-output">{selected.frames.length} returned still{selected.frames.length===1?'':'s'} · ordered by source frame number · no measured video duration</p>}
      <div className="dcc-stage-return-frames">{[...selected.frames].sort((a,b)=>a.frame-b.frame).map(frame=>{
        const key=`${selected.receiptSha256}:${frame.id}`, existing=project.cells.find(cell=>cell.originDccReturnRef?.receiptSha256===selected.receiptSha256&&cell.originDccReturnRef.frameId===frame.id);
        const cellId=existing?.id??state.adoptedCells[key], added=Boolean(cellId)||state.adopted.includes(key);
        return <figure key={frame.id}><img src={frame.url} alt={`Shot ${scene.shots.find(shot=>shot.id===frame.shotId)?.label??frame.shotId} ${roleLabel[frame.role].toLowerCase()} rehearsal candidate`}/><figcaption><strong>{roleLabel[frame.role]} · frame {frame.frame}</strong><span>{frame.widthPixels} × {frame.heightPixels} · review pending</span><span className="dcc-frame-purpose">{frame.role==='OPENING'?'Clip starting-image candidate':'Action / cut reference · not a clip start'}</span></figcaption><button disabled={busy||disabled||added||Boolean(candidate)} aria-label={`${added?'Storyboard candidate added:':'Add storyboard candidate:'} ${roleLabel[frame.role]} frame ${frame.frame}`} onClick={()=>prepareCandidate(selected,frame)}>{added?'Added to storyboard':'Add storyboard candidate'}</button>{cellId&&onOpenStoryboard&&<button className="secondary" disabled={busy||disabled||Boolean(candidate)} onClick={()=>onOpenStoryboard(scene.id,frame.shotId,cellId)}>Review in storyboard</button>}</figure>;
      })}</div>
      {candidate&&candidateFrame&&<form className="dcc-frame-candidate" aria-label="Add rehearsal frame to storyboard" onSubmit={event=>{event.preventDefault();void saveCandidate();}}>
        <h4>{roleLabel[candidateFrame.role]} · shot {scene.shots.find(shot=>shot.id===candidateFrame.shotId)?.label??candidateFrame.shotId}</h4>
        <label>Storyboard role<select value={candidate.role} disabled={busy||disabled} onChange={event=>updateCandidate({role:event.target.value as CandidateDraft['role']})}>{candidateFrame.role==='OPENING'&&candidateFrame.shotId===scene.shots[0]?.id&&<option value="START">Scene opening</option>}<option value="MOMENT">Pivotal moment / shot opening</option>{candidateFrame.role==='ENDING'&&<option value="END">Ending</option>}</select></label>
        <label>Frame description<textarea value={candidate.description} maxLength={8000} required disabled={busy||disabled} onChange={event=>updateCandidate({description:event.target.value})}/></label>
        <label>Planned time in scene (seconds, optional)<input inputMode="decimal" value={candidate.seconds} disabled={busy||disabled} placeholder="Not yet planned" onChange={event=>updateCandidate({seconds:event.target.value})}/></label>
        <p>{candidateFrame.role==='OPENING'?'This original opening render can be used as a clip’s starting image.':'This is a later rehearsal frame. Choose an opening render for the clip’s starting image.'} Planned time is separate from the Blender or Unity frame number.</p>
        <section className="dcc-frame-passages" aria-label="Frame source passages"><h5>Source passages ({candidate.actionRefs.length} linked)</h5><div>{scene.paragraphs.map(paragraph=><label className="dcc-frame-source" key={paragraph.id}><input type="checkbox" checked={candidate.actionRefs.includes(paragraph.id)} disabled={busy||disabled} onChange={event=>updateCandidate({actionRefs:event.target.checked?[...candidate.actionRefs,paragraph.id]:candidate.actionRefs.filter(id=>id!==paragraph.id)})}/><span>{paragraph.text}</span></label>)}</div></section>
        <div className="dcc-frame-candidate-actions"><button className="primary" disabled={busy||disabled} type="submit">{busy?'Adding candidate…':'Add to storyboard'}</button><button type="button" disabled={busy} onClick={()=>patch(scope,{candidate:null,error:''})}>Cancel</button></div>
      </form>}
      {!selected.frames.length&&<p className="dcc-stage-return-scope">No rendered frames were returned. The editable scene and observations are retained.</p>}
      {selected.frames.length>0&&<section className="dcc-return-next" aria-label="Continue from returned frames"><strong>Next: storyboard → clip preparation</strong><p>Add the useful frames, then open the storyboard to review the opening image, action and cut before preparing a generation clip. Generated or imported footage later returns through Takes for selection, the movie timeline and editorial export.</p></section>}
      <div className="dcc-stage-return-downloads">{sceneFile&&<a href={sceneFile.url} download={sceneFile.name}>Download editable {selected.application.name} scene</a>}{receipt&&<a href={receipt.url} download={receipt.name}>Download return receipt</a>}</div>
      <p className="dcc-stage-return-scope">These are internal rehearsal candidates. Importing does not add storyboard frames. Add a chosen frame above to review it in Frames. Editor reopening, media duration, rights and final selection remain separate.</p>
      <section className="dcc-retained-artifacts" aria-label="Source links and retained files"><h4>Source links & retained files</h4><p>Scene {scene.index} · shot {scene.shots.find(shot=>shot.id===selected.origin.shotId)?.label??selected.origin.shotId} · source {selected.origin.sourceHash.slice(0,12)} · kit {selected.kitSha256.slice(0,12)}</p>{selected.frames.map(frame=><div key={frame.id} className="dcc-return-source"><strong>{roleLabel[frame.role]} source passages</strong>{frame.sourceRefs.length?frame.sourceRefs.map(id=><p key={id}><code>{id}</code>{scene.paragraphs.find(paragraph=>paragraph.id===id)?.text}</p>):<p>No source passages mapped in the exported plan.</p>}</div>)}<ul>{selected.artifacts.map(artifact=><li key={artifact.name}><a href={artifact.url} download={artifact.name}>{artifact.name}</a><span>{artifact.byteLength.toLocaleString()} bytes · {artifact.sha256.slice(0,12)}</span></li>)}</ul></section>
    </div>}
  </section>;
}
