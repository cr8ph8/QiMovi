import { canonical, check, sha256 } from './storage.mjs';
import { validateContextBundle, validateContextBundleId, validateCompiledContext, renderContextBundle, contextSceneCharacters } from '../contracts/context-bundle.mjs';
import { getLore, lorePages } from './lore.mjs';
import { readAuthoringLineage } from './authoring-lineage.mjs';
import { validateWorkflowRef } from '../contracts/production-handoff.mjs';

const stableRecord=record=>({id:record.id,kind:record.kind,version:record.version,sha256:record.sha256,data:record.data});
function exact(store,ref,kind){
  validateWorkflowRef(ref);const history=store.history(ref.id),record=history.find(record=>record.sha256===ref.sha256);
  check(record&&record.kind===kind&&record.data.sourceHash===store.project().sourceHash,'CONTEXT_REFERENCE_MISSING',409);
  store.validateRecord(kind,record.data,store.project());
  const head=history.at(-1);check(head&&head.kind===kind&&head.data.sourceHash===record.data.sourceHash,'CONTEXT_REFERENCE_MISSING',409);
  return{record:stableRecord(record),current:head.sha256===record.sha256};
}
export function contextImage(store,hash){
  const value=store.blob(hash),bytes=value.bytes,mime=store.blobInfo(hash).mimeType;
  check(['image/png','image/jpeg','image/webp','image/gif'].includes(mime)&&sha256(bytes)===hash,'CONTEXT_IMAGE_INVALID',409);
  const signature=mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:mime==='image/gif'?/^GIF8[79]a$/.test(bytes.subarray(0,6).toString()):bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
  check(signature,'CONTEXT_IMAGE_INVALID',409);return{bytes,mimeType:mime};
}
export function compileContextBundle(store,data,{requireCurrent=true}={}){
  const project=store.project();validateContextBundle(data,project);store.blobInfo(project.sourceHash);
  const scene=project.scenes.find(scene=>scene.id===data.sceneId);let current=true;
  const loreSelections=data.loreSelections.map(selection=>{
    const record=stableRecord(getLore(store,selection.ref.id));check(record.sha256===selection.ref.sha256&&record.data.original.sha256===selection.ref.originalSha256,'CONTEXT_LORE_REFERENCE_MISMATCH',409);
    let pageText=null;
    if(selection.ref.pageNumber>0){
      check(record.data.extraction?.sha256===selection.ref.extractionSha256,'CONTEXT_LORE_EXTRACTION_MISMATCH',409);
      const page=JSON.parse(lorePages(store,record.id).bytes.toString('utf8'))[selection.ref.pageNumber-1];
      check(page&&page.textSha256===selection.ref.textSha256&&page.text.includes(selection.excerpt),'CONTEXT_LORE_EXCERPT_MISMATCH',409);pageText=page.text;
    }else check(record.data.documentType==='IMAGE'&&selection.excerpt==='','CONTEXT_LORE_EXCERPT_MISMATCH',409);
    return{...selection,record,pageText};
  });
  const noteSelections=data.noteSelections.map(selection=>{
    const found=exact(store,selection.ref,'writing-note');current&&=found.current;
    check(found.record.data.body.includes(selection.excerpt),'CONTEXT_NOTE_EXCERPT_MISMATCH',409);
    const lineage=readAuthoringLineage(store,selection.ref,project.sourceHash);
    check(lineage.status!=='ABSENT','CONTEXT_NOTE_LINEAGE_MISSING',409);current&&=lineage.status==='CURRENT';
    return{...selection,record:found.record};
  });
  const characters=contextSceneCharacters(project,data.sceneId);
  const characterSelections=data.characterSelections.map(selection=>{
    const found=exact(store,selection.ref,'casting-draft');current&&=found.current;
    const character=characters.find(character=>character.id===found.record.data.characterId);check(character,'CONTEXT_CASTING_WRONG_SCENE',409);
    check(selection.referenceHashes.every(hash=>found.record.data.referenceHashes.includes(hash)),'CONTEXT_CASTING_REFERENCE_MISMATCH',409);
    for(const hash of selection.referenceHashes)contextImage(store,hash);
    return{...selection,record:found.record,characterName:character.name};
  });
  check(!requireCurrent||current,'CONTEXT_INPUT_STALE',409);
  const compiled={schemaVersion:1,sourceHash:project.sourceHash,sceneId:scene.id,sceneHash:sha256(canonical(scene)),shotIds:data.shotIds,title:data.title,guidance:data.guidance,loreSelections,noteSelections,characterSelections};
  validateCompiledContext(compiled,data,project);const contextText=renderContextBundle(compiled);
  let contextHash;try{contextHash=sha256(canonical(compiled));}catch(error){if(error.code==='JSON_TOO_LARGE'||error.code==='JSON_TOO_DEEP')check(false,'CONTEXT_EVIDENCE_TOO_LARGE',413);throw error;}
  return{preview:{schema:'filmstack-context-preview/v1',sourceHash:project.sourceHash,sceneId:scene.id,bundleHash:sha256(canonical(data)),compiled,contextText,contextHash},currentness:current?'CURRENT':'STALE'};
}
export function previewContextBundle(store,data){return compileContextBundle(store,data).preview;}
export function resolveContextBundle(store,ref,{requireCurrent=true}={}){
  validateWorkflowRef(ref);validateContextBundleId(ref.id);
  const found=exact(store,ref,'context-bundle'),compiled=compileContextBundle(store,found.record.data,{requireCurrent});
  check(!requireCurrent||found.current,'CONTEXT_BUNDLE_STALE',409);
  return{record:found.record,preview:compiled.preview,currentness:found.current?compiled.currentness:'STALE'};
}
export function listContextBundles(store,sceneId){
  const project=store.project();check(project.scenes.some(scene=>scene.id===sceneId),'CONTEXT_SCENE_NOT_FOUND',404);
  return{schema:'filmstack-context-bundles/v1',sourceHash:project.sourceHash,sceneId,bundles:store.rawList('context-bundle').filter(record=>record.data.sceneId===sceneId).map(record=>{
    try{const result=resolveContextBundle(store,{id:record.id,sha256:record.sha256},{requireCurrent:false});return{record:stableRecord(record),currentness:result.currentness,reason:result.currentness==='CURRENT'?'':'CONTEXT_INPUT_STALE'};}
    catch(error){return{record:stableRecord(record),currentness:'ABSENT',reason:error.code??'CONTEXT_EVIDENCE_INVALID'};}
  })};
}
export function contextBundleForBrief(store,data,{requireCurrent=true}={}){
  if(!Object.hasOwn(data,'contextBundleRef'))return null;
  const resolved=resolveContextBundle(store,data.contextBundleRef,{requireCurrent}),bundle=resolved.record.data;
  check(bundle.sourceHash===data.sourceHash&&bundle.sceneId===data.sceneId&&canonical(bundle.shotIds)===canonical(data.shotIds),'CONTEXT_BRIEF_SCOPE_MISMATCH',409);
  check(bundle.characterSelections.every(selection=>data.characterIds.includes(resolved.preview.compiled.characterSelections.find(item=>item.ref.id===selection.ref.id).record.data.characterId)),'CONTEXT_BRIEF_CHARACTER_NOT_SELECTED',409);
  return{record:resolved.record,preview:resolved.preview};
}
export function validateContextRecordReferences(store,kind,data,{requireCurrent=true}={}){
  if(kind==='context-bundle')compileContextBundle(store,data,{requireCurrent});
  if(kind==='generation-brief')contextBundleForBrief(store,data,{requireCurrent});
}
// Full evidence is archival; only preview.contextText is supplemental prose.
export function exportContextEvidence(store,context,add){
  const root='selected-context';add(root+'/bundle-record.json',canonical(context.record));add(root+'/compiled.json',canonical(context.preview.compiled));add(root+'/prompt-context.txt',context.preview.contextText);
  const lore=new Map(),notes=new Map();
  for(const selection of context.preview.compiled.loreSelections)lore.set(selection.record.id,selection.record);
  for(const selection of context.preview.compiled.noteSelections){
    const chain=readAuthoringLineage(store,selection.ref,context.record.data.sourceHash);check(chain.status==='CURRENT','CONTEXT_INPUT_STALE',409);
    for(const node of chain.nodes){notes.set(node.record.id+':'+node.record.sha256,stableRecord(node.record));for(const ref of node.record.data.loreRefs??[])lore.set(ref.id,stableRecord(getLore(store,ref.id)));}
  }
  for(const record of notes.values())add(root+'/note-lineage/'+sha256(canonical({id:record.id,sha256:record.sha256}))+'.json',canonical(record));
  for(const record of lore.values()){
    const folder=root+'/research/'+record.id.slice('lore-source:'.length);add(folder+'/record.json',canonical(record));
    const extension=record.data.original.mimeType==='application/pdf'?'pdf':record.data.original.mimeType==='image/png'?'png':'jpg';
    add(folder+'/original.'+extension,store.blob(record.data.original.sha256).bytes);
    if(record.data.extraction)add(folder+'/extracted-pages.json',store.blob(record.data.extraction.sha256).bytes);
    add(folder+'/intake-manifest.json',store.blob(record.data.intakeManifest.sha256).bytes);
  }
  for(const selection of context.preview.compiled.characterSelections){
    add(root+'/casting/'+selection.record.sha256+'.json',canonical(selection.record));
    // Images are in Dreamina's selected upload sheet; unselected hashes in the
    // immutable casting record are metadata only, not additional exported assets.
    for(const hash of selection.referenceHashes)contextImage(store,hash);
  }
}
