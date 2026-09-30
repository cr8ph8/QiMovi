import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashCanonical } from '../kernel/src/canonical-json.mjs';
import { verifyBlenderProofFiles, BLENDER_PROOF_FILES } from '../integrations/three-d/blender-proof.mjs';
import { buildCameraExchange } from '../integrations/three-d/exchange.mjs';
import { validateCameraObservation } from '../contracts/camera-observation.mjs';
import { resolveUnifiedWorkflow } from './unified-workflow.mjs';
const check=(v,code)=>{if(!v)throw Object.assign(new Error(code),{code,status:409});};
const same=(a,b)=>hashCanonical(a)===hashCanonical(b);
export function cameraObservationData(verified,handoffRef,{allowHistoricalAssociation=false}={}){
  const {exchange,observation,artifacts}=verified;
  const carriedRef=verified.proposal.workflowContext?.selection?.handoffRef;
  if(carriedRef&&handoffRef)check(same(carriedRef,handoffRef),'CAMERA_OUTBOUND_HANDOFF_CONFLICT');
  if(!carriedRef&&handoffRef)check(allowHistoricalAssociation,'CAMERA_OUTBOUND_WORKFLOW_REQUIRED');
  handoffRef=carriedRef??handoffRef;
  const data={sourceHash:exchange.source.sourceHash,sceneId:exchange.scene.id,exchangeHash:exchange.sha256,basisHash:exchange.basis.sha256,
    proofHash:artifacts.find(a=>a.relativePath==='proof-receipt.json').sha256,
    artifacts:artifacts.map(a=>({name:a.relativePath,sha256:a.sha256,bytes:a.bytes})),
    frames:observation.frames.map(f=>({id:f.id,shotId:f.shotId,cellId:f.cellId,role:f.cellRole,imageHash:f.image.sha256,width:f.image.widthPixels,height:f.image.heightPixels,frame:f.frame,actionRefs:[...new Set([...f.cellActionRefs,...f.sourceActionRefsProposed])]})),
    scope:'INTERNAL_BLOCKING_PROOF',status:'CANDIDATE'};
  if(handoffRef)data.handoffRef=handoffRef;
  return data;
}
export function verifyStoredCameraObservation(store,data){
  validateCameraObservation(data,store.project());
  const files=Object.fromEntries(data.artifacts.map(a=>{const info=store.blobInfo(a.sha256);check(info.byteLength===a.bytes,'CAMERA_ARTIFACT_SIZE_MISMATCH');return [a.name,store.blob(a.sha256).bytes];}));
  const verified=verifyBlenderProofFiles(files);
  check(same(cameraObservationData(verified,data.handoffRef,{allowHistoricalAssociation:true}),data),'CAMERA_OBSERVATION_PROJECTION_MISMATCH');
  if(data.handoffRef){const context=resolveUnifiedWorkflow(store,{sceneId:data.sceneId,handoffRef:data.handoffRef});check(context.handoff.record,'CAMERA_HANDOFF_HISTORY_MISSING');}
  return verified;
}
export function validateCameraRecordReferences(store,kind,data,{newWrite=false}={}){
  if(kind==='camera-observation'){
    const verified=verifyStoredCameraObservation(store,data);
    if(newWrite)verifyCurrentCameraContext(store,data,verified);
  }
  if(kind==='storyboard-cell'&&data.originCameraRef){
    const ref=data.originCameraRef;
    const record=store.history(ref.id).find(r=>r.sha256===ref.sha256);
    check(record?.kind==='camera-observation'&&record.data.sourceHash===data.sourceHash&&record.data.sceneId===data.sceneId,'CAMERA_ORIGIN_MISSING');
    verifyStoredCameraObservation(store,record.data);
    const frame=record.data.frames.find(f=>f.id===ref.frameId);
    check(frame&&frame.shotId===data.shotId&&frame.role===data.role&&frame.imageHash===data.imageHash&&frame.width===data.pixelWidth&&frame.height===data.pixelHeight&&same(frame.actionRefs,data.actionRefs),'CAMERA_FRAME_MAPPING_MISMATCH');
  }
}
function verifyCurrentCameraContext(store,data,verified){
  const current=buildCameraExchange({project:store.resolvedProject(),records:store.rawList()},{sceneId:data.sceneId,expectedSourceHash:data.sourceHash,expectedBasisHash:data.basisHash});
  check(current.sha256===data.exchangeHash,'CAMERA_EXCHANGE_STALE');
  if(data.handoffRef){const context=resolveUnifiedWorkflow(store,{sceneId:data.sceneId,handoffRef:data.handoffRef});check(context.readiness==='READY_FOR_PLANNING','CAMERA_HANDOFF_STALE');check(data.frames.every(f=>context.handoff.record.data.shotIds.includes(f.shotId)),'CAMERA_SHOTS_OUTSIDE_HANDOFF');if(verified?.proposal.workflowContext)check(same(context,verified.proposal.workflowContext),'CAMERA_OUTBOUND_CONTEXT_CHANGED');}
}
export function importCameraProof(store,input){
  check(input&&Object.keys(input).every(k=>['files','handoffRef'].includes(k))&&Array.isArray(input.files)&&input.files.length===BLENDER_PROOF_FILES.length,'CAMERA_IMPORT_INVALID');
  const files=Object.create(null);let total=0;
  for(const part of input.files){
    check(part&&Object.keys(part).sort().join(',')==='base64,name'&&BLENDER_PROOF_FILES.includes(part.name)&&!Object.hasOwn(files,part.name)&&typeof part.base64==='string'&&part.base64.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(part.base64),'CAMERA_IMPORT_FILE_INVALID');
    const bytes=Buffer.from(part.base64,'base64');total+=bytes.length;check(total<=32*1024*1024&&bytes.length>0&&bytes.toString('base64')===part.base64,'CAMERA_IMPORT_SIZE_OR_ENCODING');files[part.name]=bytes;
  }
  const verified=verifyBlenderProofFiles(files);
  // Preserve exact retries of historical post-hoc associations, but never create one now.
  if(!verified.proposal.workflowContext&&input.handoffRef){
    const legacy=cameraObservationData(verified,input.handoffRef,{allowHistoricalAssociation:true});
    const old=store.rawList('camera-observation').find(r=>r.id===`camera-observation:${hashCanonical(legacy)}`);
    check(old&&old.sha256===hashCanonical(legacy),'CAMERA_OUTBOUND_WORKFLOW_REQUIRED');
    verifyStoredCameraObservation(store,old.data);return {...old,replayed:true};
  }
  const data=cameraObservationData(verified,input.handoffRef);
  validateCameraObservation(data,store.project());
  const id=`camera-observation:${hashCanonical(data)}`;
  const existing=store.rawList('camera-observation').find(r=>r.id===id);
  // A lost response is repeatable even after the selected cells have been added.
  if(existing){check(existing.sha256===hashCanonical(data),'CAMERA_IMPORT_CONFLICT');verifyStoredCameraObservation(store,existing.data);return {...existing,replayed:true};}
  verifyCurrentCameraContext(store,data,verified);
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'filmstack-camera-import-'));
  try{
    for(const [name,bytes] of Object.entries(files)){const file=path.join(temporary,name);fs.writeFileSync(file,bytes,{mode:0o600});store.putBlob(file,name.endsWith('.png')?'image/png':name.endsWith('.json')?'application/json':name.endsWith('.log')?'text/plain':'application/octet-stream');}
    return store.save(id,{kind:'camera-observation',expectedVersion:null,requestId:`camera-import:${hashCanonical(data)}`,data});
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
