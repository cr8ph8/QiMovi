import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson, hashCanonical } from '../kernel/src/canonical-json.mjs';
import { validateRecord,hash } from '../contracts/drifter.mjs';
import { AUTHORING_KINDS } from '../contracts/authoring.mjs';
const demand=(x,message)=>{if(!x)throw new Error(message);};
const exact=(x,keys)=>demand(x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).every(k=>keys.includes(k)),'Reviewer record contains unknown field or authority assertion');
const reviewKinds=['scene-plan','storyboard-cell','casting-draft','coverage-draft','media-take','document-draft','generation-brief','screenplay-draft',...AUTHORING_KINDS.filter(kind=>kind!=='writing-session')];
const basisRecords=store=>store.list().filter(r=>reviewKinds.includes(r.kind)).map(r=>({id:r.id,kind:r.kind,version:r.version,sha256:r.sha256})).sort((a,b)=>a.id.localeCompare(b.id));
const currentBasis=store=>({projectId:store.project().id,sourceHash:store.project().sourceHash,records:basisRecords(store)});
function createManifest(store) {
  const project=store.resolvedProject?.()??store.project();const basis=currentBasis(store);
  demand(hash(store.blob(project.sourceHash).bytes)===project.sourceHash,'Frozen review source bytes changed');
  return {schema:'drifter-review-package/v1',basis,basisHash:hashCanonical(basis),sourceHash:project.sourceHash,
    packHashes:basis.records.filter(r=>r.kind==='scene-plan').map(r=>r.sha256),cutHash:null,reviewScope:'CANDIDATE_PLANS_ONLY',
    paragraphs:[...(project.prologue??[]),...project.scenes.flatMap(s=>s.paragraphs)].map(p=>({id:p.id,type:p.type,text:p.text})),scenes:project.scenes.map(s=>({id:s.id,heading:s.heading,shots:s.shots})),
    cells:project.cells,records:store.list().filter(r=>basis.records.some(b=>b.id===r.id)),assets:[],authority:'OBSERVATIONS_ONLY'};
}
function archiveBody(store,bytes) {
  const directory=path.join(store.directory,'review-bodies');fs.mkdirSync(directory,{recursive:true,mode:0o700});
  demand(!fs.lstatSync(directory).isSymbolicLink(),'Review archive directory cannot be a symlink');
  const filename=path.join(directory,hash(bytes)+'.json');
  if(fs.existsSync(filename))demand(!fs.lstatSync(filename).isSymbolicLink()&&fs.readFileSync(filename).equals(Buffer.from(bytes)),'Retained review body changed');
  else fs.writeFileSync(filename,bytes,{flag:'wx',mode:0o600});
  store.putBlob(filename,'application/json');return hash(bytes);
}
function registerExport(store,packageHash,basisHash) {
  store.db.exec('CREATE TABLE IF NOT EXISTS review_exports (package_hash TEXT PRIMARY KEY,basis_hash TEXT NOT NULL,created_at TEXT NOT NULL)');
  store.db.prepare('INSERT INTO review_exports VALUES(?,?,?) ON CONFLICT(package_hash) DO NOTHING').run(packageHash,basisHash,new Date().toISOString());
}
export function exportReviewExchange(store) {
  const manifest=createManifest(store),packageText=canonicalJson(manifest);
  demand(Buffer.byteLength(packageText)<=1024*1024,'Review manifest exceeds JSON exchange limit; use the local package exporter');
  const packageHash=archiveBody(store,packageText);registerExport(store,packageHash,manifest.basisHash);
  return {schema:'drifter-review-exchange/v1',packageText,comments:{schema:'drifter-review-comments/v1',projectId:manifest.basis.projectId,sourceHash:manifest.sourceHash,packageHash,reviewerLabel:'',comments:[]}};
}
export function exportReviewPackage(store,output){
  demand(!fs.existsSync(output),'Review package destination already exists');fs.mkdirSync(output,{recursive:true,mode:0o700});
  const project=store.resolvedProject?.()??store.project();const manifest=createManifest(store);
  fs.mkdirSync(path.join(output,'images'),{mode:0o700});
  const source=store.blob(project.sourceHash);fs.writeFileSync(path.join(output,'source.fdx'),source.bytes,{flag:'wx',mode:0o600});manifest.assets.push({path:'source.fdx',sha256:project.sourceHash,mimeType:'application/xml'});
  for(const assetHash of new Set([...project.cells.map(c=>c.imageHash),...project.characters.map(c=>c.referenceImageHash)].filter(Boolean))){
    const asset=store.blob(assetHash);const filename=`images/${assetHash}.png`;fs.writeFileSync(path.join(output,filename),asset.bytes,{flag:'wx',mode:0o600});manifest.assets.push({path:filename,sha256:assetHash,mimeType:asset.mimeType});
  }
  const bytes=canonicalJson(manifest);const packageHash=hash(bytes);
  fs.writeFileSync(path.join(output,'review-package.json'),bytes,{flag:'wx',mode:0o600});
  store.putBlob(path.join(output,'review-package.json'),'application/json');
  registerExport(store,packageHash,manifest.basisHash);
  fs.writeFileSync(path.join(output,'return-comments.template.json'),JSON.stringify({schema:'drifter-review-comments/v1',projectId:project.id,sourceHash:project.sourceHash,packageHash,reviewerLabel:'',comments:[]},null,2)+'\n',{flag:'wx',mode:0o600});
  const escape=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Drifter candidate review</title><style>body{font:16px/1.7 system-ui;max-width:1000px;margin:40px auto;padding:24px;background:#f6f2ea;color:#29261f}img{max-width:100%}pre{white-space:pre-wrap;background:#e8e2d7;padding:20px}article{border-top:1px solid #aaa;margin-top:40px}small{color:#665}code{overflow-wrap:anywhere}figure{margin:25px 0}</style><h1>The Drifter VR — candidate review</h1><p>Internal storyboard scope. No final cut or creative approval is claimed.</p><p>Return comments against stable scene, cell and paragraph IDs.</p><p>Package SHA-256 <code>${packageHash}</code></p>${manifest.scenes.map(s=>`<article><h2>${escape(s.heading)}</h2><small>${escape(s.id)}</small>${manifest.cells.filter(c=>c.sceneId===s.id).map(c=>`<figure><h3>${escape(c.id)} · ${escape(c.role)}</h3>${c.imageHash?`<img src="images/${c.imageHash}.png" alt="${escape(c.description)}"><small>${c.crop?'Original contact sheet retained; target crop '+escape(JSON.stringify(c.crop)):'Standalone candidate'}</small>`:'<p>Starting image missing</p>'}<figcaption>${escape(c.description)}</figcaption></figure>`).join('')}${manifest.records.filter(r=>r.data.sceneId===s.id).map(r=>`<h3>Saved ${escape(r.kind)} · v${r.version}</h3><pre>${escape(JSON.stringify(r.data,null,2))}</pre>`).join('')}</article>`).join('')}<h2>All saved candidate records</h2>${manifest.records.map(r=>`<h3>${escape(r.id)}</h3><pre>${escape(JSON.stringify(r.data,null,2))}</pre>`).join('')}<h2>Exact extracted screenplay</h2>${manifest.paragraphs.map(p=>`<p><small>${escape(p.id)} · ${escape(p.type)}</small><br>${escape(p.text)}</p>`).join('')}`;
  fs.writeFileSync(path.join(output,'review.html'),html,{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(output,'README.md'),'# Drifter candidate review\n\nReturn attributed comments in return-comments.template.json. Each comment has a unique commentId, note, observedAt (ISO date), optional sceneId/cellId. No approval, actor credentials or status fields are accepted. This package has no selected final cut; it cannot approve a film.\n',{flag:'wx'});
  return {path:output,packageHash,basisHash:manifest.basisHash,authority:'OBSERVATIONS_ONLY'};
}
function importReviewBodies(store,packageBytes,commentsBytes){
  demand(packageBytes.length<=2*1024*1024,'Review package too large');const manifest=JSON.parse(packageBytes);
  demand(manifest.schema==='drifter-review-package/v1'&&canonicalJson(manifest)===packageBytes.toString('utf8'),'Review package canonical bytes changed');
  demand(commentsBytes.length<=1024*1024,'Comment package too large');
  const input=JSON.parse(commentsBytes);exact(input,['schema','projectId','sourceHash','packageHash','reviewerLabel','comments']);
  const project=store.resolvedProject?.()??store.project();const packageHash=hash(packageBytes);
  demand(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='review_exports'").get(),'No owner-exported review package registered');
  const registered=store.db.prepare('SELECT * FROM review_exports WHERE package_hash=?').get(packageHash);
  demand(registered&&registered.basis_hash===manifest.basisHash,'Review package was not exported by this owner workspace');
  demand(store.blob(packageHash).bytes.equals(packageBytes),'Retained owner export bytes do not match');
  demand(input.schema==='drifter-review-comments/v1'&&input.projectId===project.id&&input.sourceHash===project.sourceHash&&manifest.sourceHash===project.sourceHash&&input.packageHash===packageHash,'Wrong title/source/package');
  demand(manifest.basis.projectId===project.id&&hashCanonical(manifest.basis)===manifest.basisHash,'Review basis mismatch');
  demand(typeof input.reviewerLabel==='string'&&input.reviewerLabel.trim().length>0&&input.reviewerLabel.length<=160&&Array.isArray(input.comments)&&input.comments.length<=500,'Invalid reviewer/comments');
  const seen=new Set();const basisState=manifest.basisHash===hashCanonical(currentBasis(store))?'CURRENT':'HISTORICAL';
  const planned=input.comments.map(c=>{
    exact(c,['commentId','note','observedAt','sceneId','cellId','targetRecordId','targetRecordHash']);demand(!seen.has(c.commentId),'Duplicate comment IDs');seen.add(c.commentId);
    demand(typeof c.commentId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(c.commentId),'Invalid stable comment identity');
    if(Object.hasOwn(c,'targetRecordId')||Object.hasOwn(c,'targetRecordHash'))demand(manifest.records.some(record=>record.id===c.targetRecordId&&record.sha256===c.targetRecordHash),'Review target is not the exact exported record');
    const prior=store.list('review-observation').find(r=>r.id===`review-observation:${c.commentId}`);
    const data={...c,sourceHash:project.sourceHash,packageHash,reviewerLabel:input.reviewerLabel,basisStateAtImport:prior?.data.basisStateAtImport??basisState,basisHash:manifest.basisHash};validateRecord('review-observation',data,project);
    if(prior)demand(canonicalJson(prior.data)===canonicalJson(data),'Duplicate comment ID has different content');
    return {id:`review-observation:${c.commentId}`,kind:'review-observation',expectedVersion:null,requestId:`review-${hashCanonical(data)}`,data};
  });
  // Archive input bodies before observations. Each comment is an exact retryable
  // transaction; interrupted batch imports safely resume without duplicate comments.
  archiveBody(store,packageBytes);archiveBody(store,commentsBytes);
  const results=planned.map(({id,...command})=>store.save(id,command));
  return {comments:results.length,basisState,approval:'NONE',records:results.map(r=>({id:r.id,version:r.version,replayed:r.replayed}))};
}
export function importReviewComments(store,packageFile,commentsFile){return importReviewBodies(store,fs.readFileSync(packageFile),fs.readFileSync(commentsFile));}
export function importReviewExchange(store,input) {
  exact(input,['schema','packageText','comments']);
  demand(input.schema==='drifter-review-exchange/v1'&&typeof input.packageText==='string'&&Buffer.byteLength(input.packageText)<=1024*1024,'Invalid review exchange');
  return importReviewBodies(store,Buffer.from(input.packageText,'utf8'),Buffer.from(canonicalJson(input.comments),'utf8'));
}
