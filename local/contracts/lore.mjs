// Reference documents remain project research, never admitted screenplay or approval.
const check=(condition,message)=>{if(!condition)throw Object.assign(new Error(message),{status:422,code:'INVALID_LORE_RECORD'});};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const label=(value,max=240)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\r\n\0]/.test(value);
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
export const LORE_SOURCE_KINDS = ['PRIMARY_SCREENPLAY','LORE_NOTES','PRODUCTION_REFERENCE','ANALYSIS'];
// Classification is retained intake provenance, never an immutable-record field
// or a claim that a screenplay has been admitted as the current film source.
export function sourceKindFromIntake(manifest,data){
  check(object(manifest)&&manifest.schema==='filmstack-lore-source-intake/v1'&&manifest.status==='REFERENCE_CANDIDATES_ONLY'&&Array.isArray(manifest.documents),'Invalid source-category intake');
  const matches=manifest.documents.filter(doc=>doc.originalFilename===data.originalFilename&&doc.sha256===data.original.sha256);
  check(matches.length===1,'Source-category intake identity mismatch');
  const doc=matches[0];
  check(doc.title===data.title&&doc.bytes===data.original.bytes&&doc.mimeType===data.original.mimeType&&(data.extraction===null?doc.extraction===null:doc.extraction?.sha256===data.extraction.sha256),'Source-category intake binding mismatch');
  check(doc.sourceKind===undefined||LORE_SOURCE_KINDS.includes(doc.sourceKind),'Invalid source category');
  return doc.sourceKind??null;
}
function shape(value,keys){check(object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)),'Unknown or missing lore field');}
function asset(value,mime=false){shape(value,mime?['sha256','bytes','mimeType']:['sha256','bytes']);check(hash(value.sha256)&&integer(value.bytes,1,100*1024**2),'Invalid lore artifact');}
export function validateLoreSource(value,project){
  shape(value,['sourceHash','title','originalFilename','documentType','original','extraction','intakeManifest','scope','review']);
  check(hash(value.sourceHash)&&(!project||value.sourceHash===project.sourceHash),'Wrong frozen source for research library');
  check(label(value.title)&&label(value.originalFilename)&&!/[\\/]/.test(value.originalFilename),'Invalid research title or filename');
  check(['PDF','IMAGE'].includes(value.documentType)&&value.scope==='PROJECT_RESEARCH'&&value.review==='PENDING','Research cannot assert canon or approval');
  asset(value.original,true);asset(value.intakeManifest);
  check(value.documentType==='PDF'?value.original.mimeType==='application/pdf':['image/png','image/jpeg'].includes(value.original.mimeType),'Unsupported reference media');
  if(value.documentType==='IMAGE'){check(value.extraction===null,'Image text needs separate attributed transcription');return value;}
  const e=value.extraction;
  shape(e,['sha256','bytes','tool','version','mode','pageCount','ocrPerformed','pagesWithNoExtractedText','pages']);
  check(hash(e.sha256)&&integer(e.bytes,1,20*1024**2)&&label(e.tool,200)&&label(e.version,80)&&label(e.mode,80)&&integer(e.pageCount,1,2000)&&typeof e.ocrPerformed==='boolean','Invalid extraction provenance');
  check(Array.isArray(e.pages)&&e.pages.length===e.pageCount,'Extraction page count mismatch');
  e.pages.forEach((page,index)=>{shape(page,['pageNumber','textSha256','characters']);check(page.pageNumber===index+1&&hash(page.textSha256)&&integer(page.characters,0,1000000),'Invalid ordered extraction page');});
  check(Array.isArray(e.pagesWithNoExtractedText)&&JSON.stringify(e.pagesWithNoExtractedText)===JSON.stringify(e.pages.filter(page=>page.characters===0).map(page=>page.pageNumber)),'Empty extraction pages must remain visible');
  return value;
}
export function validateLoreRefs(refs){
  check(Array.isArray(refs)&&refs.length<=32,'Too many research citations');
  const seen=new Set();
  for(const ref of refs){
    shape(ref,['id','sha256','originalSha256','extractionSha256','pageNumber','textSha256']);
    check(/^lore-source:[a-f0-9]{64}$/.test(ref.id)&&hash(ref.sha256)&&hash(ref.originalSha256)&&integer(ref.pageNumber,0,2000),'Invalid research reference identity');
    check(ref.pageNumber===0?ref.extractionSha256===null&&ref.textSha256===null:hash(ref.extractionSha256)&&hash(ref.textSha256),'Invalid research page binding');
    const key=`${ref.id}:${ref.pageNumber}`;check(!seen.has(key),'Duplicate research citation');seen.add(key);
  }
}
