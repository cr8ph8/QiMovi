import { hashCanonical } from '../kernel/src/canonical-json.mjs';
import { validateProductionHandoff, validateWorkflowRef } from '../contracts/production-handoff.mjs';
import { check } from './storage.mjs';
import { exactWorkflowRecord, readAuthoringLineage, workflowHead } from './authoring-lineage.mjs';

export function resolveUnifiedWorkflow(store,input) {
  check(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(key=>['sceneId','authoringRef','handoffRef'].includes(key)),'INVALID_WORKFLOW_SELECTION');
  const project=store.project(),scene=project.scenes.find(scene=>scene.id===input.sceneId);
  check(scene,'WORKFLOW_SCENE_NOT_FOUND',404);store.blobInfo(project.sourceHash);
  for(const key of ['authoringRef','handoffRef'])if(Object.hasOwn(input,key))validateWorkflowRef(input[key]);
  const heads=store.rawList(),sceneHead=heads.find(record=>record.id==='production-handoff:'+scene.id&&record.kind==='production-handoff')??null;
  const handoffRef=input.handoffRef??(!input.authoringRef&&sceneHead?{id:sceneHead.id,sha256:sceneHead.sha256}:null);
  let handoffRecord=handoffRef?exactWorkflowRecord(store,handoffRef):null;
  let handoffStatus='ABSENT';
  if(handoffRecord) {
    check(handoffRecord.kind==='production-handoff'&&handoffRecord.id==='production-handoff:'+scene.id&&handoffRecord.data.sceneId===scene.id,'WORKFLOW_HANDOFF_SELECTION_MISMATCH',409);
    try{validateProductionHandoff(handoffRecord.data,project);}catch{handoffRecord=null;}
    if(handoffRecord)handoffStatus=sceneHead?.sha256===handoffRecord.sha256?'CURRENT':'STALE';
  }
  const authoringRef=input.authoringRef??handoffRecord?.data.authoringRef??null;
  if(input.authoringRef&&handoffRecord)check(hashCanonical(input.authoringRef)===hashCanonical(handoffRecord.data.authoringRef),'WORKFLOW_AUTHORING_SELECTION_MISMATCH',409);
  const lineage=readAuthoringLineage(store,authoringRef,project.sourceHash);
  const selected=lineage.nodes[0]??null;
  const linkedHandoffs=heads.filter(record=>record.kind==='production-handoff'&&record.data.sceneId===scene.id&&(!authoringRef||record.data.authoringRef.id===authoringRef.id)).map(record=>{
    let reason='',status='CURRENT',authoringStatus='ABSENT';
    try{validateProductionHandoff(record.data,project);check(record.sha256===hashCanonical(record.data),'SAVED_RECORD_HASH_MISMATCH',409);const chain=readAuthoringLineage(store,record.data.authoringRef,project.sourceHash);authoringStatus=chain.status;status=chain.status;reason=chain.reasons.join(',');}
    catch{status='ABSENT';reason='HANDOFF_SOURCE_OR_HASH_MISMATCH';}
    return{record,status,authoringStatus,reason};
  });
  const status=lineage.status==='ABSENT'||(handoffRef&&!handoffRecord)?'ABSENT':lineage.status==='STALE'||handoffStatus==='STALE'?'STALE':'CURRENT';
  return{schema:'filmstack-unified-workflow/v1',sourceBasis:{projectId:project.id,sourceHash:project.sourceHash,sceneId:scene.id,sceneHash:hashCanonical(scene),shotIds:scene.shots.map(shot=>shot.id)},selection:{authoringRef,handoffRef},status,
    readiness:status==='ABSENT'?'MISSING_INPUTS':status==='STALE'?'NEEDS_REVIEW':handoffStatus==='CURRENT'?'READY_FOR_PLANNING':'HANDOFF_REQUIRED',
    authoring:{status:selected?.status??'ABSENT',record:selected?.record??null,head:selected?.head??null},lineage,
    handoff:{status:handoffStatus,record:handoffRecord,head:workflowHead(sceneHead)},linkedHandoffs,authority:'PLANNING_CONTEXT_ONLY',productionAuthorized:false,sourceReplacement:false};
}
