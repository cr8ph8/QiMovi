import { validateLoreReferences } from './lore.mjs';
import { hashCanonical } from '../kernel/src/canonical-json.mjs';
import { HANDOFF_AUTHORING_KINDS, validateWorkflowRef } from '../contracts/production-handoff.mjs';
import { isCreativeProject, projectOwnedContext } from '../contracts/creative-project.mjs';
import { BIBLE_AUTHORING_INPUT_KINDS, BIBLE_AUTHORING_INPUT_LIMIT } from '../contracts/authoring.mjs';
import { validateUniverseRecordReferences } from './universe.mjs';

export function bibleAuthoringScopeMatches(project,record,sourceHash) {
  if(!record||!BIBLE_AUTHORING_INPUT_KINDS.includes(record.kind))return false;
  if(record.data?.sourceHash!==null)return typeof sourceHash==='string'&&project?.sourceHash===sourceHash&&record.data?.sourceHash===sourceHash;
  try {
    const owner=projectOwnedContext(project,record.kind,record.data);
    return isCreativeProject(owner)&&record.data.projectId===owner.id&&(sourceHash===null||sourceHash===project.sourceHash);
  } catch { return false; }
}

/** Verify a retained Bible revision without promoting its author intentions or
 * importing a second universe. Seed imports have no retained universe history. */
export function validateBibleAuthoringRecord(store,record,sourceHash,{seedRecords}={}) {
  const reject=code=>{throw Object.assign(new Error(code),{code,status:409});};
  if(seedRecords)reject('BIBLE_AUTHORING_REQUIRES_SAVED_WORKSPACE_REFERENCES');
  if(!record||!BIBLE_AUTHORING_INPUT_KINDS.includes(record.kind)||!record.id.startsWith(record.kind+':')||record.id.length<=record.kind.length+1||!bibleAuthoringScopeMatches(store.project(),record,sourceHash)||record.sha256!==hashCanonical(record.data))reject('AUTHORING_BIBLE_REFERENCE_INVALID');
  const retained=store.history(record.id).find(item=>item.version===record.version&&item.sha256===record.sha256);
  if(!retained||retained.kind!==record.kind)reject('AUTHORING_BIBLE_REFERENCE_INVALID');
  validateUniverseRecordReferences(store,record.kind,record.data,{id:record.id,version:record.version});
}

export const workflowHead=record=>record?{id:record.id,kind:record.kind,version:record.version,sha256:record.sha256,title:typeof record.data?.title==='string'?record.data.title:record.id}:null;
export function exactWorkflowRecord(store,ref,seedRecords) {
  validateWorkflowRef(ref);
  const records=seedRecords?.map(record=>({...record,version:record.version??1,sha256:record.sha256??hashCanonical(record.data),replayed:false}));
  const record=records?records.find(record=>record.id===ref.id&&record.sha256===ref.sha256):(()=>{const row=store.db.prepare('SELECT * FROM records WHERE id=? AND sha256=? ORDER BY version DESC LIMIT 1').get(ref.id,ref.sha256);return row?store.row(row):null;})();
  return record&&record.sha256===hashCanonical(record.data)?record:null;
}
export function readAuthoringLineage(store,ref,sourceHash,{seedRecords}={}) {
  const nodes=[],edges=[],reasons=[],visited=new Map(),active=new Set();let bytes=0;
  const effective=store.project();
  const project=sourceHash===null?projectOwnedContext(effective,'writing-note',{projectId:effective.id,sourceHash:null}):null;
  const matchesProject=data=>data?.sourceHash===sourceHash&&(sourceHash!==null||(isCreativeProject(project)&&data.projectId===project.id));
  const heads=new Map((seedRecords?seedRecords.map(record=>({...record,version:record.version??1,sha256:record.sha256??hashCanonical(record.data)})):store.rawList()).map(record=>[record.id,record]));
  const visit=(current,depth,parentKind=null)=>{
    const key=current.id+':'+current.sha256;
    const record=exactWorkflowRecord(store,current,seedRecords),bible=record&&BIBLE_AUTHORING_INPUT_KINDS.includes(record.kind);
    // Check the edge before de-duplication: a valid note must not make a second,
    // direct concept-to-Bible edge or a Bible root acceptable.
    if(bible&&parentKind!=='writing-note'){reasons.push('AUTHORING_BIBLE_PARENT_INVALID');return;}
    if(active.has(key)){reasons.push('AUTHORING_LINEAGE_CYCLE');return;}
    if(visited.has(key))return;
    if(nodes.length>=100||depth>24){reasons.push('AUTHORING_LINEAGE_LIMIT');return;}
    const head=heads.get(current.id)??null;
    const node={ref:current,status:'ABSENT',record:null,head:workflowHead(head),reason:''};visited.set(key,node);nodes.push(node);
    if(!record){node.reason='AUTHORING_REVISION_ABSENT';reasons.push(node.reason);return;}
    const matchesRecord=candidate=>bible?bibleAuthoringScopeMatches(effective,candidate,sourceHash):matchesProject(candidate?.data);
    if((!HANDOFF_AUTHORING_KINDS.includes(record.kind)&&!bible)||!record.id.startsWith(record.kind+':')||record.id.length<=record.kind.length+1||!matchesRecord(record)||!head||head.kind!==record.kind||!matchesRecord(head)||head.sha256!==hashCanonical(head.data)){node.reason='AUTHORING_SOURCE_OR_KIND_MISMATCH';reasons.push(node.reason);return;}
    bytes+=Buffer.byteLength(JSON.stringify(record.data));
    if(bytes>2*1024*1024){node.reason='AUTHORING_LINEAGE_BYTES_LIMIT';reasons.push(node.reason);return;}
    try{if(bible)validateBibleAuthoringRecord(store,record,sourceHash,{seedRecords});else validateLoreReferences(store,record.kind,record.data);}catch{node.reason=bible?'AUTHORING_BIBLE_REFERENCE_INVALID':'AUTHORING_LORE_REFERENCE_INVALID';reasons.push(node.reason);return;}
    if(!bible&&(record.data.inputRefs??[]).filter(input=>typeof input?.id==='string'&&BIBLE_AUTHORING_INPUT_KINDS.some(kind=>input.id.startsWith(kind+':'))).length>BIBLE_AUTHORING_INPUT_LIMIT){node.reason='AUTHORING_BIBLE_REFERENCE_LIMIT';reasons.push(node.reason);return;}
    node.record=record;node.status=head.sha256===record.sha256?'CURRENT':'STALE';
    if(node.status==='STALE'){node.reason='AUTHORING_HEAD_CHANGED';reasons.push(node.reason);}
    if(bible)return;
    active.add(key);
    for(const input of record.data.inputRefs??[]) {
      try{validateWorkflowRef(input);}catch{node.status='ABSENT';node.reason='AUTHORING_INPUT_REF_INVALID';reasons.push(node.reason);continue;}
      edges.push({from:current,to:input});visit(input,depth+1,record.kind);
    }
    active.delete(key);
  };
  if(ref)visit(ref,0);
  return{status:!ref||nodes.some(node=>node.status==='ABSENT')||reasons.some(reason=>/LIMIT|CYCLE|INVALID/.test(reason))?'ABSENT':nodes.some(node=>node.status==='STALE')?'STALE':'CURRENT',nodes,edges,reasons:[...new Set(reasons)]};
}
