import { useEffect, useRef, useState } from 'react';
import type { DccStageOptions } from './DccApi';
import { canonicalJson } from './canonical';
import DccOperationEvidence from './DccOperationEvidence';
import type { BlenderReadinessStatus } from './BlenderReadinessSummary';
import { dccRehearsalsApi, type DccRehearsalRequest, type DccRehearsalState, type DccRehearsalJob } from './dccRehearsalsApi';

const active = (job: DccRehearsalJob) => ['QUEUED','RUNNING','VERIFYING','STOPPING'].includes(job.phase);
const labels = { QUEUED:'Preparing rehearsal', RUNNING:'Rendering opening, midpoint and ending previews', VERIFYING:'Reopening the saved scene', STOPPING:'Stopping owned Blender process', RETAINED:'Frames ready for review', FAILED:'Rehearsal needs attention', STOPPED:'Stopped', INTERRUPTED:'Interrupted · no automatic rerun', EVIDENCE_MISSING:'Retained evidence needs attention' };
function sameOptions(a: DccStageOptions, b: DccStageOptions) { try { return canonicalJson(a) === canonicalJson(b); } catch { return false; } }
export default function DccRehearsals({ projectId, options, disabled, onRetained, onReviewReturn, onStatusChange, api=dccRehearsalsApi }: { projectId:string; options:DccStageOptions; disabled:boolean; onRetained():void; onReviewReturn?(receiptSha256:string):void; onStatusChange?(status:BlenderReadinessStatus):void; api?:typeof dccRehearsalsApi }) {
  const [state,setState]=useState<DccRehearsalState|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
  const [statusError,setStatusError]=useState('');
  const pending=useRef<DccRehearsalRequest|null>(null),alive=useRef(true),seen=useRef(new Set<string>()),callback=useRef(onRetained);callback.current=onRetained;
  const statusCallback=useRef(onStatusChange);statusCallback.current=onStatusChange;
  const pendingMatches=!pending.current||sameOptions(options,pending.current.options);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    statusCallback.current?.({state:null});
    const load=async()=>{
      try {
        const next=await api.load(projectId,options.expectedSourceHash,options.sceneId,controller.signal);if(controller.signal.aborted)return;setState(next);setStatusError('');statusCallback.current?.({state:next});
        if(pending.current&&next.jobs.some(job=>job.jobId===pending.current?.jobId))pending.current=null;
        for(const job of next.jobs)if(job.phase==='RETAINED'&&!seen.current.has(job.jobId)){seen.current.add(job.jobId);callback.current();}
        if(next.busy)timer=setTimeout(()=>void load(),1500);
      }catch(reason){if(!controller.signal.aborted){const message=reason instanceof Error?reason.message:'Rehearsal status unavailable.';setState(null);setStatusError(message);statusCallback.current?.({state:null,error:message});}}
    };
    void load();return()=>{controller.abort();clearTimeout(timer);};
  },[api,projectId,options.expectedSourceHash,options.sceneId,refresh]);
  async function start(){
    if(busy||disabled||!pendingMatches)return;
    const attempt=pending.current??{jobId:crypto.randomUUID(),options:structuredClone(options)};pending.current=attempt;setBusy(true);setError('');
    try{await api.start(attempt,projectId);pending.current=null;}catch(reason){if(reason&&typeof reason==='object'&&'confirmedRejection' in reason&&reason.confirmedRejection===true)pending.current=null;if(alive.current)setError(reason instanceof Error?reason.message:'Rehearsal was not confirmed.');}
    finally{if(alive.current){setBusy(false);setRefresh(value=>value+1);}}
  }
  async function stop(job:DccRehearsalJob){
    setBusy(true);setError('');try{await api.stop(job);}catch(reason){if(alive.current)setError(reason instanceof Error?reason.message:'Stop was not confirmed.');}
    finally{if(alive.current){setBusy(false);setRefresh(value=>value+1);}}
  }
  return <section className="dcc-local-rehearsal" aria-label="Run local Blender rehearsal">
    <h4>Rehearse on this Mac</h4><p>Render opening, midpoint and ending stills from your camera plan, then reopen and check the editable scene. Closing this panel keeps the job running; closing the workspace stops its owned process.</p>
    <DccOperationEvidence projectId={projectId} options={options} disabled={disabled} refreshKey={`${refresh}:${state?.jobs.map(job=>`${job.jobId}:${job.version}`).join(',')??''}`}/>
    <div className="dcc-stage-export"><button className="primary" disabled={disabled||busy||!pendingMatches||!state?.runtime.available||state.busy} onClick={()=>void start()}>{pending.current?'Retry same rehearsal request':'Run local Blender rehearsal'}</button><button disabled={busy} onClick={()=>setRefresh(value=>value+1)}>Refresh rehearsal status</button></div>
    {pending.current&&<p>Unconfirmed request: shot {pending.current.options.shotId}, {pending.current.options.lensMm} mm, {pending.current.options.durationSeconds} s, {pending.current.options.motion}. {pendingMatches?'Retry uses that exact request.':'Restore those settings and the original plan basis to retry, or refresh status to recover a saved job.'}</p>}
    {state?.runtime.available&&<p className="scope-note">Local rehearsal service responding · Blender executable available · {state.runtime.configurationSource==='AUDITED_LOCAL_FALLBACK'?'audited installation on this Mac':'configured local installation'}. Interactive editor connection remains unverified.</p>}
    {state&&!state.runtime.available&&<p>Configured Blender executable is unavailable. Set CANISCREENWRITE_BLENDER_PATH when starting the local service, or use the exported kit.</p>}
    {(statusError||error)&&<p role="alert">{statusError||error}</p>}
    <ul>{state?.jobs.slice(0,8).map(job=><li key={job.jobId}><strong>Shot {job.shotId} · {labels[job.phase]}</strong>{active(job)&&<button disabled={busy||job.phase==='STOPPING'} onClick={()=>void stop(job)}>Stop rehearsal</button>}
      {job.phase==='RETAINED'&&<><p>Saved scene reopened and checked. Review the returned frames below; no frame has been selected for you.</p>{onReviewReturn&&job.returnReceiptSha256&&<button className="secondary" disabled={busy} onClick={()=>onReviewReturn(job.returnReceiptSha256!)}>Review this rehearsal’s frames</button>}</>}
      {job.error&&<p>{job.error==='DCC_REHEARSAL_TIMEOUT'?'The rehearsal reached its time limit and was stopped.':job.phase==='STOPPED'?'The owned process stopped. Partial files were preserved.':`Local status: ${job.error}`}</p>}
      <details><summary>Local receipt and files</summary><p>{job.outputDirectory}</p><p>Receipt {job.sha256} · revision {job.version}</p></details></li>)}</ul>
    <p className="scope-note">Rehearsal frames remain pending. These stand-ins do not establish cast identity, licensed scenery, continuous rendered motion or final film quality.</p>
  </section>;
}
