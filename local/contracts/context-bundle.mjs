import { validateLoreRefs, validateLoreSource } from './lore.mjs';
import { validateAuthoringRecord } from './authoring.mjs';
import { validateWorkflowRef } from './production-handoff.mjs';

export const CONTEXT_BUNDLE_LIMITS=Object.freeze({lore:32,notes:16,casting:16,excerpt:12000,guidance:4000,rendered:16000});
const fail=message=>{throw Object.assign(new Error(message),{code:'INVALID_CONTEXT_BUNDLE',status:422});};
const assert=(value,message)=>{if(!value)fail(message);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const label=value=>typeof value==='string'&&value.trim().length>0&&value.length<=200&&!/[\r\n\0]/.test(value);
const text=(value,max)=>typeof value==='string'&&value.length<=max;
const unique=values=>new Set(values).size===values.length;
function wellFormed(value){
  for(let index=0;index<value.length;index++){
    const unit=value.charCodeAt(index);
    if(unit>=0xd800&&unit<=0xdbff){const next=value.charCodeAt(++index);if(!(next>=0xdc00&&next<=0xdfff))return false;}
    else if(unit>=0xdc00&&unit<=0xdfff)return false;
  }
  return true;
}
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':object(value)?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
const equal=(a,b)=>stable(a)===stable(b);
function shape(value,fields){assert(object(value)&&Object.keys(value).length===fields.length&&fields.every(key=>Object.hasOwn(value,key)),'Unknown or missing context field');}
export function validateContextBundleId(id){assert(typeof id==='string'&&/^context-bundle:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id),'Context identity must be a UUID');return id;}
export function contextSceneCharacters(project,sceneId){
  const scene=project.scenes.find(scene=>scene.id===sceneId);if(!scene)return[];
  const tokens=new Set(scene.shots.flatMap(shot=>[...shot.description.matchAll(/<([A-Z_]+)>/g)].map(match=>match[1])));
  return(project.characters??[]).filter(character=>tokens.has(character.id.toUpperCase())||(character.id==='al'&&tokens.has('AL_PACK'))||(character.id==='mutants'&&tokens.has('MUTANT')));
}
export function validateContextBundle(data,project){
  shape(data,['schemaVersion','sourceHash','sceneId','shotIds','title','status','guidance','loreSelections','noteSelections','characterSelections']);
  assert(data.schemaVersion===1&&data.status==='DRAFT'&&digest(data.sourceHash)&&(!project||data.sourceHash===project.sourceHash),'Context cannot assert production authority or another source');
  assert(typeof data.sceneId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(data.sceneId)&&label(data.title)&&text(data.guidance,4000),'Invalid context title, scene or guidance');
  assert(wellFormed(data.title)&&wellFormed(data.guidance),'Context title and guidance must be valid Unicode that round-trips through UTF-8');
  assert(Array.isArray(data.shotIds)&&data.shotIds.length>0&&data.shotIds.length<=10&&unique(data.shotIds)&&data.shotIds.every(id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(id)),'Invalid context shot selection');
  if(project){const scene=project.scenes.find(scene=>scene.id===data.sceneId);assert(scene,'Unknown context scene');let prior=-1;for(const id of data.shotIds){const index=scene.shots.findIndex(shot=>shot.id===id);assert(index>prior,'Unknown or reversed context shot');prior=index;}}
  assert(Array.isArray(data.loreSelections)&&data.loreSelections.length<=32&&Array.isArray(data.noteSelections)&&data.noteSelections.length<=16&&Array.isArray(data.characterSelections)&&data.characterSelections.length<=16,'Too many context selections');
  assert(data.guidance.trim().length||data.loreSelections.length||data.noteSelections.length||data.characterSelections.length,'Select context or enter guidance');
  validateLoreRefs(data.loreSelections.map(selection=>{shape(selection,['ref','excerpt']);assert(text(selection.excerpt,12000)&&wellFormed(selection.excerpt)&&(selection.ref?.pageNumber===0?selection.excerpt==='':selection.excerpt.length>0),'Research excerpt must be valid Unicode and exact source text');return selection.ref;}));
  for(const selection of data.noteSelections){shape(selection,['ref','excerpt']);validateWorkflowRef(selection.ref);assert(selection.ref.id.startsWith('writing-note:')&&text(selection.excerpt,12000)&&wellFormed(selection.excerpt)&&selection.excerpt.length>0,'Select a nonempty writing-note excerpt containing valid Unicode');}
  assert(unique(data.noteSelections.map(selection=>selection.ref.id)),'Duplicate selected note');
  for(const selection of data.characterSelections){shape(selection,['ref','referenceHashes']);validateWorkflowRef(selection.ref);assert(selection.ref.id.startsWith('casting-draft:')&&Array.isArray(selection.referenceHashes)&&selection.referenceHashes.length<=100&&selection.referenceHashes.every(digest)&&unique(selection.referenceHashes),'Invalid casting image selection');}
  assert(unique(data.characterSelections.map(selection=>selection.ref.id)),'Duplicate selected casting record');
  return data;
}
const reduced=compiled=>({schemaVersion:1,sourceHash:compiled.sourceHash,sceneId:compiled.sceneId,shotIds:compiled.shotIds,title:compiled.title,status:'DRAFT',guidance:compiled.guidance,loreSelections:compiled.loreSelections.map(({ref,excerpt})=>({ref,excerpt})),noteSelections:compiled.noteSelections.map(({ref,excerpt})=>({ref,excerpt})),characterSelections:compiled.characterSelections.map(({ref,referenceHashes})=>({ref,referenceHashes}))});
function record(value,ref,kind,sourceHash){shape(value,['id','kind','version','sha256','data']);assert(value.id===ref.id&&value.sha256===ref.sha256&&value.kind===kind&&Number.isSafeInteger(value.version)&&value.version>0&&digest(value.sha256)&&object(value.data)&&value.data.sourceHash===sourceHash,'Selected evidence identity or source mismatch');}
export function validateCompiledContext(compiled,data,project){
  shape(compiled,['schemaVersion','sourceHash','sceneId','sceneHash','shotIds','title','guidance','loreSelections','noteSelections','characterSelections']);
  assert(compiled.schemaVersion===1&&digest(compiled.sceneHash),'Invalid compiled source scene');
  const bound=reduced(compiled);validateContextBundle(bound,project);
  if(data){validateContextBundle(data,project);assert(equal(bound,data),'Compiled selections differ from requested context');}
  for(const selection of compiled.loreSelections){
    shape(selection,['ref','excerpt','record','pageText']);record(selection.record,selection.ref,'lore-source',compiled.sourceHash);validateLoreSource(selection.record.data,project);
    const lore=selection.record.data,ref=selection.ref;assert(lore.original.sha256===ref.originalSha256,'Research original mismatch');
    assert(ref.pageNumber===0?lore.documentType==='IMAGE'&&selection.pageText===null&&ref.extractionSha256===null:lore.extraction?.sha256===ref.extractionSha256&&lore.extraction.pages[ref.pageNumber-1]?.textSha256===ref.textSha256&&typeof selection.pageText==='string'&&selection.pageText.includes(selection.excerpt),'Research excerpt is not in the selected page');
  }
  for(const selection of compiled.noteSelections){shape(selection,['ref','excerpt','record']);record(selection.record,selection.ref,'writing-note',compiled.sourceHash);validateAuthoringRecord('writing-note',selection.record.data,project);assert(selection.record.data.body.includes(selection.excerpt),'Note excerpt is not in the saved revision');}
  for(const selection of compiled.characterSelections){
    shape(selection,['ref','referenceHashes','record','characterName']);record(selection.record,selection.ref,'casting-draft',compiled.sourceHash);
    const cast=selection.record.data;shape(cast,['sourceHash','characterId','performer','referenceHashes','useScope','evidenceHashes','notes']);
    assert(selection.ref.id==='casting-draft:'+cast.characterId&&typeof cast.performer==='string'&&cast.performer.length>0&&cast.performer.length<=300&&typeof cast.notes==='string'&&cast.notes.length<=8000&&['INTERNAL_STORYBOARD_REFERENCE_ONLY','FILM_USE_REQUESTED'].includes(cast.useScope),'Invalid selected casting evidence');
    assert([cast.referenceHashes,cast.evidenceHashes].every(hashes=>Array.isArray(hashes)&&hashes.every(digest)&&unique(hashes))&&selection.referenceHashes.every(hash=>cast.referenceHashes.includes(hash))&&label(selection.characterName),'Unknown casting image');
    if(project)assert(contextSceneCharacters(project,compiled.sceneId).some(character=>character.id===cast.characterId&&character.name===selection.characterName),'Casting does not belong to the context scene');
  }
  return compiled;
}
export function renderContextBundle(compiled){
  validateCompiledContext(compiled);
  const parts=['SELECTED PRODUCTION CONTEXT — draft guidance, not screenplay replacement',compiled.title,`Scope: ${compiled.sceneId} / ${compiled.shotIds.join(', ')}`,'Use only these selected excerpts and references to inform the selected clip. They do not add dialogue, expand shot coverage, grant film use or authorize generation.'];
  if(compiled.guidance.length)parts.push('OWNER CONTEXT GUIDANCE',compiled.guidance);
  for(const selection of compiled.loreSelections)parts.push(`RESEARCH — ${selection.record.data.originalFilename} / ${selection.ref.pageNumber===0?'image reference':`page ${selection.ref.pageNumber}`} / ${selection.ref.textSha256??selection.ref.originalSha256}`,selection.excerpt||'Selected image research reference; no transcription supplied.');
  for(const selection of compiled.noteSelections)parts.push(`SAVED NOTE EXCERPT — ${selection.record.data.title} / ${selection.ref.id} / ${selection.ref.sha256}`,selection.excerpt);
  for(const selection of compiled.characterSelections)parts.push(`CASTING REFERENCE — ${selection.characterName} / ${selection.record.data.performer}`,`Recorded use scope: ${selection.record.data.useScope}. Selected images: ${selection.referenceHashes.join(', ')||'none'}.`);
  const rendered=parts.join('\n\n');assert(wellFormed(rendered),'Selected context metadata must be valid Unicode that round-trips through UTF-8');assert(rendered.length<=16000,'Rendered selected context exceeds 16000 characters; select less content');return rendered;
}
