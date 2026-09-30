import { AUTHORING_KINDS } from './authoring.mjs';
export const HANDOFF_AUTHORING_KINDS=Object.freeze(['screenplay-draft',...AUTHORING_KINDS.filter(kind=>kind!=='writing-session')]);
const assert=(condition,message)=>{if(!condition)throw Object.assign(new Error(message),{code:'INVALID_PRODUCTION_HANDOFF',status:422});};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const identity=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function validateWorkflowRef(value) {
  assert(object(value)&&Object.keys(value).sort().join(',')==='id,sha256'&&identity(value.id)&&digest(value.sha256),'Invalid exact workflow reference');
  return value;
}
export function validateProductionHandoff(value,project) {
  assert(object(value)&&Object.keys(value).sort().join(',')==='authoringRef,notes,purpose,sceneId,shotIds,sourceHash','Unknown handoff field, authority assertion, or missing field');
  assert(digest(value.sourceHash)&&identity(value.sceneId)&&(!project||value.sourceHash===project.sourceHash),'Wrong or stale handoff source');
  validateWorkflowRef(value.authoringRef);
  assert(HANDOFF_AUTHORING_KINDS.some(kind=>value.authoringRef.id.startsWith(kind+':')&&value.authoringRef.id.length>kind.length+1),'Handoff requires a saved authoring draft');
  assert(value.purpose==='PLANNING_CONTEXT'&&typeof value.notes==='string'&&value.notes.length<=20000,'Handoff is bounded planning context only');
  assert(Array.isArray(value.shotIds)&&value.shotIds.length>0&&value.shotIds.length<=10&&value.shotIds.every(identity)&&new Set(value.shotIds).size===value.shotIds.length,'Handoff requires unique ordered source shots');
  if(project) {
    const scene=project.scenes.find(scene=>scene.id===value.sceneId);assert(scene,'Unknown handoff scene');
    let previous=-1;
    for(const id of value.shotIds){const index=scene.shots.findIndex(shot=>shot.id===id);assert(index>=0&&index>previous,'Handoff shot order or scene mapping is invalid');previous=index;}
  }
  return value;
}
