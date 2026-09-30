import { useEffect, useRef, useState } from 'react';
import { dccMotionApi, sameDccMotionRequest, type DccMotionApi, type DccMotionJob, type DccMotionRequest, type DccMotionState } from './dccMotionApi';
import type { DccStageReturn } from './dccStageReturnsApi';
import type { Project, Scene } from './types';

interface Props {
  project:Project; scene:Scene; returned:DccStageReturn; selectedShotId:string; open:boolean; disabled?:boolean;
  onReviewTake?(takeId:string):void; onMotionRetained?(takeId:string):void|Promise<void>; api?:DccMotionApi;
  pendingRequests?:Map<string,DccMotionRequest>;
}
interface View { state:DccMotionState|null; error:string; statusError:string; loading:boolean }
const active=(job:DccMotionJob)=>['QUEUED','RENDERING','MEASURING','STOPPING'].includes(job.phase);
const labels:Record<DccMotionJob['phase'],string>={QUEUED:'Preparing motion preview',RENDERING:'Rendering motion preview',MEASURING:'Checking video and duration',RETAINED:'Motion take ready for review',STOPPING:'Cancelling render',STOPPED:'Render cancelled',FAILED:'Render needs attention',INTERRUPTED:'Render interrupted',EVIDENCE_MISSING:'Saved render needs attention'};
const empty:View={state:null,error:'',statusError:'',loading:true};
export default function DccMotionRenders({project,scene,returned,selectedShotId,open,disabled=false,onReviewTake,onMotionRetained,api=dccMotionApi,pendingRequests}:Props) {
  const scope=JSON.stringify([project.id,project.sourceHash,scene.id,selectedShotId,returned.receiptSha256]);
  const [views,setViews]=useState<Record<string,View>>({}),[refresh,setRefresh]=useState(0),[operation,setOperation]=useState<string|null>(null);
  const view=views[scope]??empty,current=useRef(scope),alive=useRef(true),inFlight=useRef(false),ownRequests=useRef(new Map<string,DccMotionRequest>()),seen=useRef(new Set<string>());
  const pending=pendingRequests??ownRequests.current;
  current.current=scope;
  const retainedCallback=useRef(onMotionRetained);retainedCallback.current=onMotionRetained;
  const patch=(key:string,update:Partial<View>)=>setViews(previous=>({...previous,[key]:{...(previous[key]??empty),...update}}));
  const matches=returned.origin.projectId === project.id && returned.origin.sourceHash === project.sourceHash && returned.origin.sceneId === scene.id
    && returned.origin.shotId === selectedShotId && scene.shots.some(shot=>shot.id === selectedShotId);
  const currentBasis=returned.basis.status === 'CURRENT' && returned.basis.currentBasisSha256 === returned.origin.basisSha256;
  const eligible=matches && currentBasis && returned.origin.target === 'BLENDER';
  const attempt=pending.get(scope);
  const jobs=view.state?.jobs.filter(job=>job.returnReceiptSha256 === returned.receiptSha256 && job.shotId === returned.origin.shotId)??[];
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    patch(scope,{loading:true});
    async function load() {
      try {
        const next=await api.load({projectId:project.id,sourceHash:project.sourceHash,sceneId:scene.id},controller.signal);
        if(controller.signal.aborted || current.current !== scope)return;
        const saved=pending.get(scope);
        const recovered=Boolean(saved && next.jobs.some(job=>sameDccMotionRequest(job,saved)));
        if(recovered)pending.delete(scope);
        patch(scope,{state:next,statusError:'',loading:false,...(recovered?{error:''}:{})});
        for(const job of next.jobs) {
          if(job.phase !== 'RETAINED' || !job.takeRef || job.returnReceiptSha256 !== returned.receiptSha256 || job.shotId !== returned.origin.shotId)continue;
          const key=`${job.projectId}:${job.sourceHash}:${job.jobId}:${job.takeRef.sha256}`;
          if(!seen.current.has(key)) {
            seen.current.add(key);
            try {await retainedCallback.current?.(job.takeRef.id);}
            catch {seen.current.delete(key);if(!controller.signal.aborted && current.current===scope)patch(scope,{error:'The motion take was saved, but the workspace could not refresh. Open Takes or refresh render status to recover it.'});}
          }
        }
        if(!controller.signal.aborted && (next.busy || next.jobs.some(active)))timer=setTimeout(()=>void load(),1500);
      } catch(reason) {
        if(!controller.signal.aborted && current.current === scope)patch(scope,{state:null,loading:false,statusError:reason instanceof Error?reason.message:'Motion render status is unavailable.'});
      }
    }
    void load();return()=>{controller.abort();if(timer)clearTimeout(timer);};
  },[api,scope,open,project.id,project.sourceHash,scene.id,returned.receiptSha256,returned.origin.shotId,refresh,pending]);
  async function start() {
    if(inFlight.current || !open || disabled || !eligible || view.loading || !view.state?.runtime.available || view.state.busy || jobs.some(active))return;
    const captured=scope,request=pending.get(captured)??{jobId:crypto.randomUUID(),projectId:project.id,sourceHash:project.sourceHash,sceneId:scene.id,shotId:returned.origin.shotId,returnReceiptSha256:returned.receiptSha256};
    pending.set(captured,request);inFlight.current=true;setOperation(captured);patch(captured,{error:''});
    try {
      const job=await api.start(request);pending.delete(captured);
      if(alive.current&&view.state)patch(captured,{state:{...view.state,busy:active(job),jobs:[job,...view.state.jobs.filter(row=>row.jobId!==job.jobId)]}});
    }
    catch(reason) {
      if(reason && typeof reason === 'object' && 'confirmedRejection' in reason && reason.confirmedRejection === true)pending.delete(captured);
      if(alive.current)patch(captured,{error:reason instanceof Error?reason.message:'The motion render request was not confirmed.'});
    } finally {
      inFlight.current=false;
      if(alive.current){setOperation(null);setRefresh(value=>value+1);}
    }
  }
  async function stop(job:DccMotionJob) {
    if(inFlight.current || !active(job) || job.phase === 'STOPPING')return;
    const captured=scope;inFlight.current=true;setOperation(captured);patch(captured,{error:''});
    try {
      const stopped=await api.stop(job);
      if(alive.current&&view.state)patch(captured,{state:{...view.state,busy:active(stopped),jobs:view.state.jobs.map(row=>row.jobId===stopped.jobId?stopped:row)}});
    }
    catch(reason) {if(alive.current)patch(captured,{error:reason instanceof Error?reason.message:'Cancellation was not confirmed. Refresh render status and try again.'});}
    finally {inFlight.current=false;if(alive.current){setOperation(null);setRefresh(value=>value+1);}}
  }
  return <section className="dcc-motion-renders" aria-label="Motion preview from returned scene" hidden={!open}>
    <h4>Motion preview</h4>
    <p>Render a silent greybox video from this saved Blender scene on this Mac. No provider spend. The resulting take is pending review in Takes.</p>
    {!matches ? <p className="dcc-stage-return-scope">Choose this return’s shot in the camera controls to render it.</p> : !currentBasis ? <p className="dcc-stage-return-scope">This return uses an earlier camera plan. Run a current rehearsal or import a current return before rendering motion.</p> : null}
    <div className="dcc-motion-actions"><button className="primary" disabled={disabled||operation!==null||!eligible||view.loading||!view.state?.runtime.available||view.state.busy||jobs.some(active)} onClick={()=>void start()}>{attempt?'Retry same motion request':'Render motion preview'}</button><button disabled={operation!==null||view.loading} onClick={()=>setRefresh(value=>value+1)}>Refresh render status</button></div>
    {attempt&&<p className="dcc-stage-return-notice">The render request is unconfirmed. Refresh to recover its job, or retry this same request. No new render starts automatically.</p>}
    {view.state&&!view.state.runtime.available&&<p className="dcc-stage-return-scope">Local motion rendering is unavailable. Check the local Blender and video tools.</p>}
    {view.state?.busy&&!jobs.some(active)&&<p className="dcc-stage-return-scope">Another local render is running. This return can render when it finishes.</p>}
    {(view.statusError||view.error)&&<p className="dcc-stage-return-error" role="alert">{view.statusError||view.error}</p>}
    <ul className="dcc-motion-jobs" aria-live="polite">{jobs.slice(0,8).map(job=><li key={job.jobId}>
      <div><strong>{labels[job.phase]}</strong>
        {active(job)&&<><p>{job.progress.completedFrames !== null && job.progress.totalFrames !== null ? `${job.progress.completedFrames} of ${job.progress.totalFrames} frames rendered` : 'Waiting for measured frame progress.'}</p><progress aria-label="Motion render progress" max={job.progress.totalFrames??1} value={job.progress.completedFrames !== null && job.progress.totalFrames !== null ? job.progress.completedFrames : undefined}/></>}
        {job.phase==='RETAINED'&&<p>Saved as a pending take. Review it before keeping it or choosing it for the movie.</p>}
        {job.phase==='INTERRUPTED'&&<p>The local service stopped before finishing. This render will not restart automatically.</p>}
        {job.phase==='STOPPED'&&<p>The render stopped. Its partial files remain on disk.</p>}
        {(job.phase==='FAILED'||job.phase==='EVIDENCE_MISSING')&&<p>The local service could not verify a complete motion take. Check the saved render details before trying again.</p>}
        <details><summary>Render receipt</summary><p>Receipt {job.sha256} · revision {job.version}</p>{job.error&&<p>Local status: {job.error}</p>}</details>
      </div>
      {active(job)&&<button disabled={operation!==null||job.phase==='STOPPING'} onClick={()=>void stop(job)}>Cancel render</button>}
      {job.phase==='RETAINED'&&job.takeRef&&onReviewTake&&<button className="secondary" disabled={operation!==null||!matches} onClick={()=>onReviewTake(job.takeRef!.id)}>Review take</button>}
    </li>)}</ul>
  </section>;
}
