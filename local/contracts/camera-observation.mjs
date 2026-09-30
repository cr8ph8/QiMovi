const isObject=v=>v&&typeof v==='object'&&!Array.isArray(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=v=>typeof v==='string'&&v.length>0&&v.length<=160;
const check=(v,message)=>{if(!v)throw Object.assign(new Error(message),{code:'INVALID_CAMERA_OBSERVATION',status:422});};
const shape=(v,keys,optional=[])=>check(isObject(v)&&keys.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>[...keys,...optional].includes(k)),'Unexpected camera observation fields');
export const CAMERA_FILES=['camera-exchange.json','blocking-proposal.json','scene-04-blocking.blend','observation.json','opening.png','later-moment.png','create.log','inspect.log','proof-receipt.json'];
export function validateCameraObservation(data,project){
  shape(data,['sourceHash','sceneId','exchangeHash','basisHash','proofHash','artifacts','frames','scope','status'],['handoffRef']);
  check([data.sourceHash,data.exchangeHash,data.basisHash,data.proofHash].every(digest)&&text(data.sceneId)&&data.scope==='INTERNAL_BLOCKING_PROOF'&&data.status==='CANDIDATE','Invalid camera proof scope or basis');
  if(data.handoffRef){shape(data.handoffRef,['id','sha256']);check(text(data.handoffRef.id)&&digest(data.handoffRef.sha256),'Invalid handoff reference');}
  check(Array.isArray(data.artifacts)&&data.artifacts.length===CAMERA_FILES.length,'Incomplete proof artifacts');
  check(new Set(data.artifacts.map(a=>a.name)).size===CAMERA_FILES.length,'Duplicate proof artifact');
  for(const artifact of data.artifacts){shape(artifact,['name','sha256','bytes']);check(CAMERA_FILES.includes(artifact.name)&&digest(artifact.sha256)&&Number.isSafeInteger(artifact.bytes)&&artifact.bytes>0&&artifact.bytes<=32*1024*1024,'Invalid proof artifact');}
  check(data.artifacts.find(a=>a.name==='proof-receipt.json').sha256===data.proofHash,'Receipt hash mismatch');
  check(Array.isArray(data.frames)&&data.frames.length===2&&new Set(data.frames.map(f=>f.id)).size===2,'Invalid proof frames');
  const scene=project?.scenes.find(s=>s.id===data.sceneId);
  if(project)check(data.sourceHash===project.sourceHash&&scene,'Camera source or scene mismatch');
  for(const frame of data.frames){
    shape(frame,['id','shotId','cellId','role','imageHash','width','height','frame','actionRefs']);
    check([frame.id,frame.shotId,frame.cellId].every(text)&&['START','MOMENT','END'].includes(frame.role)&&digest(frame.imageHash),'Invalid frame target');
    check([frame.width,frame.height,frame.frame].every(v=>Number.isSafeInteger(v)&&v>0&&v<=100000)&&Array.isArray(frame.actionRefs)&&frame.actionRefs.every(text),'Invalid measured frame metadata');
    check(data.artifacts.some(a=>a.sha256===frame.imageHash&&a.name.endsWith('.png')),'Missing frame artifact');
    if(scene)check(scene.shots.some(s=>s.id===frame.shotId)&&(frame.role!=='START'||frame.shotId===scene.shots[0].id)&&frame.actionRefs.every(id=>[...scene.paragraphs,...(project.prologue??[])].some(p=>p.id===id)),'Frame source mapping mismatch');
  }
  return data;
}
export function validateCameraOriginRef(ref){shape(ref,['id','sha256','frameId']);check(text(ref.id)&&ref.id.startsWith('camera-observation:')&&digest(ref.sha256)&&text(ref.frameId),'Invalid camera origin reference');}
