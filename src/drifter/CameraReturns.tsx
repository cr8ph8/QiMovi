import { useEffect, useRef, useState } from 'react';
import { CAMERA_FILES } from '../../local/contracts/camera-observation.mjs';
import { validateRecord } from './validation';
import { blobUrl } from './api';
import { canonicalJson } from './canonical';
import type { CameraObservation, Project, Scene, StoryboardCellDraft, WorkspaceApi, WorkspaceRecord } from './types';
import type { FlowContextProps } from './workflowApi';

export default function CameraReturns({ project, scene, api, flow, onSaved }: {project:Project;scene:Scene;api:WorkspaceApi;flow?:FlowContextProps;onSaved(record:WorkspaceRecord):void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [returned,setReturned]=useState<WorkspaceRecord[]>([]);
  const scope=useRef('');scope.current=`${project.id}:${project.sourceHash}:${scene.id}`;
  const alive=useRef(true),controller=useRef<AbortController>();
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();};},[]);
  const records=[...(flow?.records??[]),...returned].filter((r,i,all)=>r.kind==='camera-observation'&&(r.data as CameraObservation).sceneId===scene.id&&all.findIndex(v=>v.id===r.id)===i);
  const seen=(id:string)=>[...(flow?.records??[]),...returned].some(r=>r.id===id);
  async function importFiles(files:FileList|null){
    if(!files?.length||busy)return;
    const captured=scope.current; const current=()=>alive.current&&scope.current===captured;
    setError('');setNotice('');setBusy(true);
    try {
      const selected=Array.from(files);
      if(selected.length!==CAMERA_FILES.length||new Set(selected.map(f=>f.name)).size!==CAMERA_FILES.length||!selected.every(f=>CAMERA_FILES.includes(f.name))||selected.reduce((sum,f)=>sum+f.size,0)>32*1024*1024)throw new Error('Select all nine files from one Blender proof folder, totalling no more than 32 MB.');
      const parts=[];
      for(const file of selected){const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));parts.push({name:file.name,base64:btoa(binary)});}
      if(!current())return;
      const handoff=flow?.context?.readiness==='READY_FOR_PLANNING'?flow.context.handoff.record:null;
      controller.current=new AbortController();
      const response=await fetch('/api/dcc/import',{method:'POST',credentials:'same-origin',redirect:'error',signal:controller.current.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({files:parts,...(handoff?{handoffRef:{id:handoff.id,sha256:handoff.sha256}}:{})})});
      const value=await response.json();if(!response.ok)throw new Error(value.error??'The camera proof was not imported.');
      const record=await validateRecord(value,project);if(record.kind!=='camera-observation'||(record.data as CameraObservation).sceneId!==scene.id)throw new Error('The returned proof does not match this scene.');
      if(!current())return;
      setReturned(rows=>[...rows.filter(r=>r.id!==record.id),record]);onSaved(record);setNotice('Blender proof imported. Review each frame before adding a storyboard candidate.');
    }catch(reason){if(current())setError(reason instanceof Error?reason.message:'Camera import failed.');}
    finally{if(current())setBusy(false);}
  }
  async function addFrameCandidate(record:WorkspaceRecord,frame:CameraObservation['frames'][number]){
    if(busy)return;const captured=scope.current;const current=()=>alive.current&&scope.current===captured;
    const cellId=`BLENDER-${scene.id}-${frame.id}-${record.sha256.slice(0,12)}`;
    setBusy(true);setError('');setNotice('');
    try{
      const data:StoryboardCellDraft={sourceHash:project.sourceHash,sceneId:scene.id,shotId:frame.shotId,cellId,role:frame.role,imageHash:frame.imageHash,crop:null,pixelWidth:frame.width,pixelHeight:frame.height,
        description:`Blender staging candidate · ${frame.shotId} ${frame.role}. Simple stand-ins and proposed camera; owner review required.`,actionRefs:frame.actionRefs,plannedTimestampMs:null,review:'PENDING',originCameraRef:{id:record.id,sha256:record.sha256,frameId:frame.id}};
      const saved=await api.saveRecord({id:`storyboard-cell:${cellId}`,kind:'storyboard-cell',expectedVersion:null,requestId:`camera-cell:${record.sha256.slice(0,32)}:${frame.id}`,data});
      await validateRecord(saved,project);
      if(saved.id!==`storyboard-cell:${cellId}`||saved.kind!=='storyboard-cell'||saved.version!==1||canonicalJson(saved.data)!==canonicalJson(data))throw new Error('The returned storyboard save does not match the selected camera frame. Retry the same action.');
      if(!current())return;
      setReturned(rows=>[...rows.filter(r=>r.id!==saved.id),saved]);onSaved(saved);setNotice(`${frame.shotId} ${frame.role} added as a new storyboard candidate. Existing cells are preserved.`);
    }catch(reason){if(current())setError(reason instanceof Error?reason.message:'Storyboard save was not confirmed. Retry the same action.');}
    finally{if(current())setBusy(false);}
  }
  return <section className="dcc-returns" aria-label="Returned camera proofs"><div><span className="eyebrow">RETURN TO THE FILM</span><h3>Bring the camera test back.</h3><p>Import the nine files from a local Blender proof folder. The scene, camera observation and images stay together in owned storage.</p></div>
    <label className="dcc-file">{busy?'Checking and saving…':'Import Blender proof files'}<input aria-label="Import Blender proof files" type="file" multiple disabled={busy} onChange={event=>{void importFiles(event.currentTarget.files);event.currentTarget.value='';}}/></label>
    <details><summary>Files to select</summary><p>{CAMERA_FILES.join(', ')}</p><p>Only internal staging observations are imported. This does not approve casting, source, spending or final media.</p></details>
    {error&&<p role="alert" className="error-text">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {records.map(record=><article key={record.id}><p><strong>Blender staging proof</strong> · {(record.data as CameraObservation).handoffRef?'Saved writing link retained':'Source and shot mapping retained'} · Review required</p><div className="dcc-return-grid">{(record.data as CameraObservation).frames.map(frame=>{const used=seen(`storyboard-cell:BLENDER-${scene.id}-${frame.id}-${record.sha256.slice(0,12)}`);return <section key={frame.id}><img src={blobUrl(frame.imageHash)} alt={`${frame.shotId} ${frame.role} Blender staging candidate`}/><h4>{frame.shotId} · {frame.role}</h4><p>{frame.width} × {frame.height} · original target {frame.cellId}</p><button className="secondary" disabled={busy||used} onClick={()=>void addFrameCandidate(record,frame)}>{used?'Added to storyboard':`Use ${frame.shotId} ${frame.role} in storyboard`}</button></section>;})}</div><a href={blobUrl((record.data as CameraObservation).artifacts.find(a=>a.name==='observation.json')!.sha256)} download="camera-observation.json">Inspect saved camera observation ↗</a></article>)}
  </section>;
}
