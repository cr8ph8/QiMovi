import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { check, sha256, canonical } from './storage.mjs';
import { validateLoreSource, validateLoreRefs, sourceKindFromIntake, LORE_SOURCE_KINDS } from '../contracts/lore.mjs';

export const loreId=data=>'lore-source:'+sha256(canonical({originalFilename:data.originalFilename,originalSha256:data.original.sha256}));
function checkedBytes(bytes,asset){check(bytes.length===asset.bytes&&sha256(bytes)===asset.sha256,'LORE_ARTIFACT_MISMATCH',409);return bytes;}
function originalBytes(bytes,data){
  checkedBytes(bytes,data.original);
  const mime=data.original.mimeType;
  check(mime==='application/pdf'?bytes.subarray(0,5).toString()==='%PDF-':mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes[0]===255&&bytes[1]===216&&bytes[2]===255,'LORE_MEDIA_SIGNATURE_MISMATCH',422);
  return bytes;
}
function extractPages(bytes,data){
  checkedBytes(bytes,data.extraction);
  let pages;try{pages=JSON.parse(bytes.toString('utf8'));}catch{check(false,'LORE_EXTRACTION_JSON_INVALID',422);}
  check(Array.isArray(pages)&&pages.length===data.extraction.pageCount,'LORE_EXTRACTION_PAGE_COUNT_MISMATCH',409);
  pages.forEach((page,index)=>{
    const expected=data.extraction.pages[index];
    check(page&&Object.keys(page).sort().join(',')==='characters,pageHeightPoints,pageNumber,pageWidthPoints,text,textPath,textSha256','LORE_EXTRACTION_PAGE_INVALID',422);
    check(page.pageNumber===index+1&&typeof page.text==='string'&&page.text.length<=2000000&&sha256(Buffer.from(page.text,'utf8'))===expected.textSha256&&page.textSha256===expected.textSha256&&[...page.text].length===expected.characters&&page.characters===expected.characters,'LORE_PAGE_TEXT_MISMATCH',409);
    check(typeof page.textPath==='string'&&page.textPath.length<=4096&&Number.isFinite(page.pageWidthPoints)&&page.pageWidthPoints>0&&Number.isFinite(page.pageHeightPoints)&&page.pageHeightPoints>0,'LORE_EXTRACTION_METADATA_INVALID',422);
  });
  return pages;
}
export function verifyStoredLore(store,record){
  check(record&&record.kind==='lore-source'&&record.version===1&&record.sha256===sha256(canonical(record.data))&&record.id===loreId(record.data),'LORE_RECORD_MISMATCH',409);
  const data=validateLoreSource(record.data,store.project());
  originalBytes(store.blob(data.original.sha256).bytes,data);
  const intake=checkedBytes(store.blob(data.intakeManifest.sha256).bytes,data.intakeManifest);
  let manifest;try{manifest=JSON.parse(intake.toString('utf8'));}catch{check(false,'LORE_INTAKE_JSON_INVALID',409);}
  sourceKindFromIntake(manifest,data);
  check(manifest.schema==='filmstack-lore-source-intake/v1'&&manifest.status==='REFERENCE_CANDIDATES_ONLY'&&manifest.documents.some(doc=>doc.originalFilename===data.originalFilename&&doc.sha256===data.original.sha256&&doc.bytes===data.original.bytes&&doc.title===data.title&&(data.extraction===null?doc.extraction===null:doc.extraction?.sha256===data.extraction.sha256)),'LORE_INTAKE_BINDING_MISMATCH',409);
  const doc=manifest.documents.find(doc=>doc.originalFilename===data.originalFilename&&doc.sha256===data.original.sha256);
  check(doc.mimeType===data.original.mimeType&&doc.bytes===data.original.bytes,'LORE_INTAKE_BINDING_MISMATCH',409);
  if(data.extraction){
    const e=data.extraction;
    check(['tool','version','mode','ocrPerformed'].every(key=>e[key]===doc.extraction[key])&&e.pageCount===doc.pageCount&&canonical(e.pagesWithNoExtractedText)===canonical(doc.extraction.pagesWithNoExtractedText)&&canonical(e.pages)===canonical(doc.pages.map(({pageNumber,textSha256,characters})=>({pageNumber,textSha256,characters}))),'LORE_EXTRACTION_PROVENANCE_MISMATCH',409);
    extractPages(store.blob(e.sha256).bytes,data);
  }
  return record;
}
export function getLore(store,id){check(/^lore-source:[a-f0-9]{64}$/.test(id),'INVALID_LORE_ID');const record=store.history(id)[0];check(record,'LORE_NOT_FOUND',404);return verifyStoredLore(store,record);}
export function retainedLoreSourceKind(store,record){
  const bytes=checkedBytes(store.blob(record.data.intakeManifest.sha256).bytes,record.data.intakeManifest);
  return sourceKindFromIntake(JSON.parse(bytes.toString('utf8')),record.data);
}
export function listLore(store){
  const records=store.rawList('lore-source').map(record=>verifyStoredLore(store,record));
  const sourceKinds=Object.fromEntries(records.map(record=>[record.id,retainedLoreSourceKind(store,record)]).filter(([,kind])=>kind!==null));
  return{schema:'filmstack-lore-library/v1',projectId:store.project().id,sourceHash:store.project().sourceHash,records,sourceKinds};
}
export function lorePages(store,id){const record=getLore(store,id);check(record.data.extraction,'LORE_NO_TEXT_EXTRACTION',404);return{record,bytes:store.blob(record.data.extraction.sha256).bytes};}
export function loreOriginal(store,id){const record=getLore(store,id);return{record,bytes:store.blob(record.data.original.sha256).bytes};}
export function validateLoreReferences(store,kind,data){
  if(kind!=='writing-note'||!Object.hasOwn(data,'loreRefs'))return;
  validateLoreRefs(data.loreRefs);
  for(const ref of data.loreRefs){
    const record=getLore(store,ref.id),source=record.data;
    check(record.sha256===ref.sha256&&source.sourceHash===data.sourceHash&&source.original.sha256===ref.originalSha256,'LORE_REFERENCE_MISSING_OR_CHANGED',409);
    check(ref.pageNumber===0?source.documentType==='IMAGE'&&ref.extractionSha256===null&&ref.textSha256===null:source.extraction?.sha256===ref.extractionSha256&&source.extraction.pages[ref.pageNumber-1]?.textSha256===ref.textSha256,'LORE_REFERENCE_PAGE_MISMATCH',409);
  }
}
function intakeFile(root,filename,max){
  check(typeof filename==='string'&&path.isAbsolute(filename),'LORE_INTAKE_PATH_INVALID');
  const resolved=fs.realpathSync(filename);check(resolved.startsWith(root+path.sep)&&!fs.lstatSync(filename).isSymbolicLink(),'LORE_INTAKE_PATH_OUTSIDE_PACKET');
  const stat=fs.statSync(resolved);check(stat.isFile()&&stat.size<=max,'LORE_INTAKE_FILE_TOO_LARGE',413);return fs.readFileSync(resolved);
}
// Trusted local import only. All supplied hashes, page files and existing identities
// are checked before writes. Exact retries can finish an interrupted import.
export function importLoreManifest(store,{manifestPath,sourceHash}){
  check(sourceHash===store.project().sourceHash,'LORE_SOURCE_BASIS_MISMATCH',409);
  const root=fs.realpathSync(path.dirname(manifestPath));
  const manifestBytes=intakeFile(root,path.resolve(manifestPath),5*1024**2),manifest=JSON.parse(manifestBytes.toString('utf8'));
  check(manifest.schema==='filmstack-lore-source-intake/v1'&&manifest.status==='REFERENCE_CANDIDATES_ONLY'&&manifest.sourceReplacement===false&&manifest.canonApproval===false&&manifest.sourceAdmission==='NOT_PERFORMED'&&Array.isArray(manifest.documents)&&manifest.documents.length>0&&manifest.documents.length<=100,'LORE_INTAKE_MANIFEST_INVALID');
  const intakeManifest={sha256:sha256(manifestBytes),bytes:manifestBytes.length};const seen=new Set();let total=manifestBytes.length;
  const prepared=manifest.documents.map(doc=>{
    check(doc.sourceKind===undefined||LORE_SOURCE_KINDS.includes(doc.sourceKind),'LORE_SOURCE_KIND_INVALID');
    const bytes=intakeFile(root,doc.ownedPath,100*1024**2);
    const extractionBytes=doc.extraction?intakeFile(root,doc.extraction.pagesPath,20*1024**2):null;
    const data={sourceHash,title:doc.title,originalFilename:doc.originalFilename,documentType:doc.mimeType==='application/pdf'?'PDF':'IMAGE',original:{sha256:doc.sha256,bytes:doc.bytes,mimeType:doc.mimeType},extraction:doc.extraction?{sha256:doc.extraction.sha256,bytes:extractionBytes.length,tool:doc.extraction.tool,version:doc.extraction.version,mode:doc.extraction.mode,pageCount:doc.pageCount,ocrPerformed:doc.extraction.ocrPerformed,pagesWithNoExtractedText:doc.extraction.pagesWithNoExtractedText,pages:doc.pages.map(({pageNumber,textSha256,characters})=>({pageNumber,textSha256,characters}))}:null,intakeManifest,scope:'PROJECT_RESEARCH',review:'PENDING'};
    validateLoreSource(data,store.project());originalBytes(bytes,data);
    if(extractionBytes){const pages=extractPages(extractionBytes,data);pages.forEach((page,index)=>{const text=intakeFile(root,doc.pages[index].textPath,4*1024**2);check(text.equals(Buffer.from(page.text,'utf8')),'LORE_PAGE_FILE_MISMATCH',409);});}
    const id=loreId(data);check(!seen.has(id),'LORE_DUPLICATE_INTAKE_ID');seen.add(id);
    const existing=store.history(id);check(existing.length===0||existing.length===1&&existing[0].sha256===sha256(canonical(data)),'LORE_EXISTING_REFERENCE_CONFLICT',409);
    total+=bytes.length+(extractionBytes?.length??0);check(total<=250*1024**2,'LORE_INTAKE_BATCH_TOO_LARGE',413);
    return{id,data,bytes,extractionBytes,existing:existing[0]};
  });
  function put(bytes,mime){const temp=path.join(store.directory,`lore-intake-${crypto.randomUUID()}.tmp`);try{fs.writeFileSync(temp,bytes,{mode:0o600,flag:'wx'});return store.putBlob(temp,mime);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
  put(manifestBytes,'application/json');const records=[];
  for(const item of prepared){
    put(item.bytes,item.data.original.mimeType);if(item.extractionBytes)put(item.extractionBytes,'application/json');
    records.push(item.existing?{...verifyStoredLore(store,item.existing),replayed:true}:store.save(item.id,{kind:'lore-source',data:item.data,expectedVersion:null,requestId:'lore-import:'+sha256(canonical(item.data))}));
  }
  return{schema:'filmstack-lore-import-result/v1',projectId:store.project().id,sourceHash,intakeManifest,records,sourceAdmission:'NOT_PERFORMED',sourceReplacement:false,canonApproval:false};
}
