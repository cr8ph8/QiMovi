import { canonicalJson } from '../kernel/src/canonical-json-core.mjs';
import { buildScreenplayIndex } from './screenplay-index.mjs';
import { listWritingSceneIdentities, validateWritingSceneMap } from './writing-scene-map.mjs';
import { validateWritingProductionDraftRef } from './writing-production.mjs';

const need = (condition, code, status = 422) => { if (!condition) throw Object.assign(new Error(code), { code, status }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = (value, limit) => typeof value === 'string' && value.length <= limit && value.isWellFormed() && !value.includes('\0');
const strings = (value, limit = 500) => Array.isArray(value) && value.length <= limit && value.every(id) && new Set(value).size === value.length;
const ref = ({ id, version, sha256 }) => ({ id, version, sha256 });
const saved = value => exact(value, ['id','version','sha256']) && id(value.id) && Number.isSafeInteger(value.version) && value.version > 0 && digest(value.sha256);
const same = (left, right) => canonicalJson(left) === canonicalJson(right);
const counts = rows => rows.reduce((out, row) => { out[row.status]++; if (row.reordered) out.reordered++; return out; }, { added:0, removed:0, changed:0, unchanged:0, reordered:0 });
const requestKeys = ['projectId','sourceHash','draftRef','mappings'];
function mappingsShape(mappings) {
  need(Array.isArray(mappings) && mappings.length <= 500 && mappings.every(row => exact(row,['sourceSceneId','draftSceneId']) && id(row.sourceSceneId) && id(row.draftSceneId)) && new Set(mappings.map(row => row.sourceSceneId)).size === mappings.length && new Set(mappings.map(row => row.draftSceneId)).size === mappings.length, 'LEGACY_REVISION_MAPPING_INVALID');
}
export function validateLegacyProductionRevisionRequest(operation, input) {
  need(['review','apply'].includes(operation) && exact(input, operation === 'review' ? requestKeys : [...requestKeys,'previewSha256','sourceSceneId','shotIds','expectedVersion','requestId','notes']), 'LEGACY_REVISION_REQUEST_INVALID');
  need(id(input.projectId) && digest(input.sourceHash), 'LEGACY_REVISION_SOURCE_INVALID'); validateWritingProductionDraftRef(input.draftRef); mappingsShape(input.mappings);
  if (operation === 'apply') {
    need(digest(input.previewSha256) && id(input.sourceSceneId) && input.mappings.some(row => row.sourceSceneId === input.sourceSceneId), 'LEGACY_REVISION_REVIEW_REQUIRED');
    need(strings(input.shotIds,10) && input.shotIds.length > 0, 'LEGACY_REVISION_SHOTS_INVALID');
    need(input.expectedVersion === null || Number.isSafeInteger(input.expectedVersion) && input.expectedVersion > 0 && input.expectedVersion < 2147483647, 'LEGACY_REVISION_VERSION_INVALID');
    need(id(input.requestId) && input.requestId.length <= 96 && text(input.notes,18000), 'LEGACY_REVISION_SAVE_INVALID');
  }
  return input;
}
export function legacyProductionSourceSnapshot(project, hash) {
  return hash(canonicalJson({ projectId:project.id, sourceHash:project.sourceHash, scenes:project.scenes, prologue:project.prologue ?? [] }));
}
function sourceProject(project) {
  need(object(project) && id(project.id) && digest(project.sourceHash) && !project.creativeOrigin && !project.productionAttachmentRef && Array.isArray(project.scenes) && project.scenes.length <= 500, 'LEGACY_REVISION_IMPORTED_PROJECT_REQUIRED',409);
  const seen = new Set(), shots = new Set();
  for (const scene of project.scenes) {
    need(id(scene.id) && !seen.has(scene.id) && Number.isSafeInteger(scene.index) && scene.index > 0 && text(scene.heading,1000) && Array.isArray(scene.paragraphs) && Array.isArray(scene.shots) && scene.shots.length <= 100, 'LEGACY_REVISION_PRODUCTION_INVALID',409); seen.add(scene.id);
    for (const paragraph of scene.paragraphs) need(id(paragraph.id) && text(paragraph.type,100) && text(paragraph.text,200000), 'LEGACY_REVISION_PARAGRAPH_INVALID',409);
    for (const shot of scene.shots) { need(id(shot.id) && !shots.has(shot.id) && text(shot.label,200) && text(shot.description,10000) && (shot.plannedDurationMs === null || Number.isSafeInteger(shot.plannedDurationMs) && shot.plannedDurationMs > 0), 'LEGACY_REVISION_SHOT_INVALID',409); shots.add(shot.id); }
  }
}
function recordValid(record, hash) { return record && saved(ref(record)) && id(record.kind) && object(record.data) && hash(canonicalJson(record.data)) === record.sha256; }
const paragraphText = scene => scene.paragraphs.map(row => row.text).join('\n\n');
const sourceCues = scene => [...new Set(scene.paragraphs.filter(row => row.type.trim().toLowerCase().replace(/[ _-]+/g,' ') === 'character').map(row => row.text.trim()))];
function relatedRecords(records, project, changedSceneIds, hash) {
  const scenes = project.scenes.filter(scene => changedSceneIds.has(scene.id)), shotIds = new Set(scenes.flatMap(scene => scene.shots.map(shot => shot.id))), paragraphIds = new Set(scenes.flatMap(scene => scene.paragraphs.map(row => row.id)));
  const targets = new Set([...scenes.map(scene => `scene:${scene.id}`), ...scenes.flatMap(scene => scene.shots.map(shot => `shot:${scene.id}:${shot.id}`))]);
  const rows = [];
  for (const record of records) {
    need(recordValid(record,hash), 'LEGACY_REVISION_RECORD_INVALID',409);
    if (['screenplay-draft','writing-session'].includes(record.kind) || record.data.projectId && record.data.projectId !== project.id) continue;
    const reasons = new Set();
    if (changedSceneIds.size && record.data.sourceHash === project.sourceHash) reasons.add('BOUND_SOURCE_SCOPE');
    const visit = (value,depth=0) => {
      need(depth <= 40,'LEGACY_REVISION_RECORD_DEPTH',409);
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(item=>visit(item,depth+1)); return; }
      for (const [key,item] of Object.entries(value)) {
        const values = Array.isArray(item) ? item : [item];
        if (['sceneId','sceneIds'].includes(key) && values.some(value=>changedSceneIds.has(value))) reasons.add('EXPLICIT_SCENE_ID');
        if (['shotId','shotIds'].includes(key) && values.some(value=>shotIds.has(value))) reasons.add('EXPLICIT_SHOT_ID');
        if (['paragraphId','paragraphIds','actionRefs'].includes(key) && values.some(value=>paragraphIds.has(value))) reasons.add('EXACT_PARAGRAPH_BINDING');
        if (['targetId','coveredTargetIds'].includes(key) && values.some(value=>targets.has(value))) reasons.add('EXPLICIT_BUDGET_TARGET');
        visit(item,depth+1);
      }
    }; visit(record.data);
    if (reasons.size) rows.push({ref:ref(record),kind:record.kind,reasons:[...reasons].sort()});
  }
  return rows.sort((a,b)=>a.ref.id < b.ref.id ? -1 : a.ref.id > b.ref.id ? 1 : 0);
}
/** Imported screenplay review. Correspondence is an explicit owner selection,
 * never inferred from heading, scene number, Fountain provenance notes or assets. */
export function buildLegacyProductionRevisionPreview(project,draft,mappings,records,hash) {
  sourceProject(project); mappingsShape(mappings);
  need(recordValid(draft,hash) && draft.kind === 'screenplay-draft' && draft.id.startsWith('screenplay-draft:') && draft.data.sourceHash === project.sourceHash && draft.data.format === 'FOUNTAIN' && text(draft.data.body,200000), 'LEGACY_REVISION_DRAFT_INVALID',409);
  if (draft.data.sceneMap) validateWritingSceneMap(draft.data.sceneMap,draft.data.body);
  const index = buildScreenplayIndex(draft.data.body), identities = listWritingSceneIdentities(draft.data,draft.sha256);
  need(index.scenes.length > 0 && index.scenes.length <= 500,'LEGACY_REVISION_DRAFT_SCENES_REQUIRED');
  const draftScenes = index.scenes.map((scene,offset)=>({sceneId:identities[offset].id,ordinal:offset+1,heading:scene.heading,start:scene.start,end:scene.end,text:scene.text,textSha256:hash(scene.text),characters:scene.characters,identityNeedsReview:identities[offset].candidates.length > 0}));
  const sourceScenes = project.scenes.map(scene=>{
    const handoff = records.find(record=>record.id === `production-handoff:${scene.id}` && record.kind === 'production-handoff');
    if (handoff) need(recordValid(handoff,hash) && handoff.data.sourceHash === project.sourceHash && handoff.data.sceneId === scene.id,'LEGACY_REVISION_HANDOFF_INVALID',409);
    const value = paragraphText(scene);
    return {sceneId:scene.id,ordinal:scene.index,heading:scene.heading,text:value,textSha256:hash(value),shotIds:scene.shots.map(shot=>shot.id),currentHandoff:handoff?{ref:ref(handoff),notes:handoff.data.notes,shotIds:handoff.data.shotIds,authoringRef:handoff.data.authoringRef}:null};
  });
  const bySource = new Map(sourceScenes.map(scene=>[scene.sceneId,scene])), byDraft = new Map(draftScenes.map(scene=>[scene.sceneId,scene]));
  for (const mapping of mappings) need(bySource.has(mapping.sourceSceneId) && byDraft.has(mapping.draftSceneId) && !byDraft.get(mapping.draftSceneId).identityNeedsReview,'LEGACY_REVISION_MAPPING_UNRESOLVED',409);
  const ordered = [...mappings].sort((a,b)=>bySource.get(a.sourceSceneId).ordinal-bySource.get(b.sourceSceneId).ordinal);
  const candidateOrder = [...ordered].sort((a,b)=>byDraft.get(a.draftSceneId).ordinal-byDraft.get(b.draftSceneId).ordinal).map(row=>row.sourceSceneId);
  const sceneDeltas = [], shotDeltas = [];
  for (const [offset,mapping] of ordered.entries()) {
    const source = bySource.get(mapping.sourceSceneId), candidate = byDraft.get(mapping.draftSceneId), scene = project.scenes.find(scene=>scene.id===source.sceneId);
    const before = {ordinal:source.ordinal,heading:source.heading,textSha256:source.textSha256,notes:'',characters:sourceCues(scene),shotIds:source.shotIds};
    const after = {ordinal:candidate.ordinal,heading:candidate.heading,textSha256:candidate.textSha256,notes:'',characters:candidate.characters,shotIds:source.shotIds};
    const changes = ['heading','textSha256','characters'].filter(key=>!same(before[key],after[key]));
    sceneDeltas.push({sceneId:source.sceneId,status:changes.length?'changed':'unchanged',reordered:candidateOrder[offset]!==source.sceneId,changes,before,after});
    scene.shots.forEach((shot,shotIndex)=>{const snapshot={id:shot.id,title:shot.label,description:shot.description,shotType:'',cameraMovement:'',durationSeconds:shot.plannedDurationMs!==null&&shot.plannedDurationMs%1000===0?shot.plannedDurationMs/1000:null,plannedDurationMs:shot.plannedDurationMs,ordinal:shotIndex+1};shotDeltas.push({shotId:shot.id,sceneId:source.sceneId,status:'unchanged',reordered:false,changes:[],before:snapshot,after:{...snapshot}});});
  }
  const beforeCues = [...new Set(sceneDeltas.flatMap(row=>row.before.characters))], afterCues = [...new Set(sceneDeltas.flatMap(row=>row.after.characters))];
  const characterCues = {added:afterCues.filter(name=>!beforeCues.includes(name)),removed:beforeCues.filter(name=>!afterCues.includes(name)),unchanged:beforeCues.filter(name=>afterCues.includes(name))};
  const affectedRecords = relatedRecords(records,project,new Set(sceneDeltas.filter(row=>row.status==='changed'||row.reordered).map(row=>row.sceneId)),hash);
  const preview = {schemaVersion:1,status:'REVIEW_ONLY',scope:'PLANNING_CONTEXT',projectId:project.id,sourceHash:project.sourceHash,sourceSnapshotSha256:legacyProductionSourceSnapshot(project,hash),draftRef:ref(draft),draftBodySha256:hash(draft.data.body),mappings:ordered,sourceScenes,draftScenes,sceneDeltas,shotDeltas,characterCues,affectedRecords,summary:{scenes:counts(sceneDeltas),shots:counts(shotDeltas),characterCuesAdded:characterCues.added.length,characterCuesRemoved:characterCues.removed.length,affectedRecords:affectedRecords.length},unmappedSourceSceneIds:sourceScenes.filter(scene=>!ordered.some(row=>row.sourceSceneId===scene.sceneId)).map(scene=>scene.sceneId),unmappedDraftSceneIds:draftScenes.filter(scene=>!ordered.some(row=>row.draftSceneId===scene.sceneId)).map(scene=>scene.sceneId),explanation:'Only explicitly mapped scenes are compared. Unmapped scenes remain unreviewed, never deleted. Retained paragraph text is compared with exact Fountain text, so formatting and conversion can appear as changes. Shots, media and costs remain in production. Applying a review saves this exact draft as planning context for selected existing shots; it does not replace the production screenplay or approve production.'};
  return validateLegacyProductionRevisionPreview({...preview,previewSha256:hash(canonicalJson(preview))});
}
export function validateLegacyProductionRevisionPreview(value) {
  const fail = condition=>need(condition,'LEGACY_REVISION_PREVIEW_INVALID');
  fail(exact(value,['schemaVersion','status','scope','projectId','sourceHash','sourceSnapshotSha256','draftRef','draftBodySha256','mappings','sourceScenes','draftScenes','sceneDeltas','shotDeltas','characterCues','affectedRecords','summary','unmappedSourceSceneIds','unmappedDraftSceneIds','explanation','previewSha256']));
  fail(value.schemaVersion===1 && value.status==='REVIEW_ONLY' && value.scope==='PLANNING_CONTEXT' && id(value.projectId) && ['sourceHash','sourceSnapshotSha256','draftBodySha256','previewSha256'].every(key=>digest(value[key])) && saved(value.draftRef)); mappingsShape(value.mappings);
  fail(Array.isArray(value.sourceScenes)&&value.sourceScenes.length<=500&&Array.isArray(value.draftScenes)&&value.draftScenes.length>0&&value.draftScenes.length<=500);
  for (const scene of value.sourceScenes) {
    fail(exact(scene,['sceneId','ordinal','heading','text','textSha256','shotIds','currentHandoff'])&&id(scene.sceneId)&&Number.isSafeInteger(scene.ordinal)&&scene.ordinal>0&&text(scene.heading,1000)&&text(scene.text,200000)&&digest(scene.textSha256)&&strings(scene.shotIds,100));
    const handoff=scene.currentHandoff; fail(handoff===null||exact(handoff,['ref','notes','shotIds','authoringRef'])&&saved(handoff.ref)&&handoff.ref.id===`production-handoff:${scene.sceneId}`&&text(handoff.notes,20000)&&strings(handoff.shotIds,10)&&exact(handoff.authoringRef,['id','sha256'])&&id(handoff.authoringRef.id)&&digest(handoff.authoringRef.sha256));
  }
  for(const scene of value.draftScenes) fail(exact(scene,['sceneId','ordinal','heading','start','end','text','textSha256','characters','identityNeedsReview'])&&id(scene.sceneId)&&Number.isSafeInteger(scene.ordinal)&&scene.ordinal>0&&text(scene.heading,1000)&&Number.isSafeInteger(scene.start)&&scene.start>=0&&Number.isSafeInteger(scene.end)&&scene.end>scene.start&&scene.end-scene.start===scene.text.length&&text(scene.text,200000)&&digest(scene.textSha256)&&Array.isArray(scene.characters)&&scene.characters.every(name=>text(name,200))&&typeof scene.identityNeedsReview==='boolean');
  fail(new Set(value.sourceScenes.map(scene=>scene.sceneId)).size===value.sourceScenes.length&&new Set(value.draftScenes.map(scene=>scene.sceneId)).size===value.draftScenes.length);
  fail(value.mappings.every(row=>value.sourceScenes.some(scene=>scene.sceneId===row.sourceSceneId)&&value.draftScenes.some(scene=>scene.sceneId===row.draftSceneId&&!scene.identityNeedsReview)));
  fail(Array.isArray(value.sceneDeltas)&&value.sceneDeltas.length===value.mappings.length&&Array.isArray(value.shotDeltas)&&value.shotDeltas.length<=50000);
  const cueList = cues => Array.isArray(cues) && cues.length <= 500 && cues.every(name=>text(name,200)) && new Set(cues).size === cues.length;
  const sceneSnapshot = row => exact(row,['ordinal','heading','textSha256','notes','characters','shotIds']) && Number.isSafeInteger(row.ordinal) && row.ordinal > 0 && text(row.heading,1000) && digest(row.textSha256) && row.notes === '' && cueList(row.characters) && strings(row.shotIds,100);
  const shotSnapshot = row => exact(row,['id','title','description','shotType','cameraMovement','durationSeconds','plannedDurationMs','ordinal']) && id(row.id) && text(row.title,200) && text(row.description,10000) && row.shotType === '' && row.cameraMovement === '' && Number.isSafeInteger(row.ordinal) && row.ordinal > 0 && (row.plannedDurationMs === null || Number.isSafeInteger(row.plannedDurationMs) && row.plannedDurationMs > 0) && row.durationSeconds === (row.plannedDurationMs !== null && row.plannedDurationMs % 1000 === 0 ? row.plannedDurationMs / 1000 : null);
  fail(new Set(value.sceneDeltas.map(row=>row.sceneId)).size===value.sceneDeltas.length && new Set(value.shotDeltas.map(row=>row.shotId)).size===value.shotDeltas.length);
  for (const row of value.sceneDeltas) {
    fail(exact(row,['sceneId','status','reordered','changes','before','after']) && ['changed','unchanged'].includes(row.status) && typeof row.reordered==='boolean' && Array.isArray(row.changes) && row.changes.every(key=>['heading','textSha256','characters'].includes(key)) && sceneSnapshot(row.before) && sceneSnapshot(row.after) && row.status===(row.changes.length?'changed':'unchanged'));
    const mapping=value.mappings.find(mapping=>mapping.sourceSceneId===row.sceneId),source=value.sourceScenes.find(scene=>scene.sceneId===row.sceneId),draft=value.draftScenes.find(scene=>scene.sceneId===mapping?.draftSceneId);
    fail(source && draft && row.before.ordinal===source.ordinal && row.before.heading===source.heading && row.before.textSha256===source.textSha256 && same(row.before.shotIds,source.shotIds) && row.after.ordinal===draft.ordinal && row.after.heading===draft.heading && row.after.textSha256===draft.textSha256 && same(row.after.characters,draft.characters) && same(row.after.shotIds,source.shotIds));
    fail(same(row.changes,['heading','textSha256','characters'].filter(key=>!same(row.before[key],row.after[key]))));
  }
  for (const row of value.shotDeltas) {
    fail(exact(row,['shotId','sceneId','status','reordered','changes','before','after']) && id(row.shotId) && row.status==='unchanged' && row.reordered===false && Array.isArray(row.changes) && row.changes.length===0 && shotSnapshot(row.before) && same(row.before,row.after) && row.before.id===row.shotId);
    const scene=value.sceneDeltas.find(scene=>scene.sceneId===row.sceneId);fail(scene && scene.before.shotIds[row.before.ordinal-1]===row.shotId);
  }
  fail(value.sceneDeltas.every(scene=>same(scene.before.shotIds,value.shotDeltas.filter(row=>row.sceneId===scene.sceneId).map(row=>row.shotId))));
  fail(exact(value.characterCues,['added','removed','unchanged'])&&Object.values(value.characterCues).every(cues=>Array.isArray(cues)&&cues.every(name=>text(name,200))));
  fail(Array.isArray(value.affectedRecords)&&value.affectedRecords.length<=50000&&value.affectedRecords.every(row=>exact(row,['ref','kind','reasons'])&&saved(row.ref)&&id(row.kind)&&Array.isArray(row.reasons)&&row.reasons.every(reason=>['BOUND_SOURCE_SCOPE','EXPLICIT_SCENE_ID','EXPLICIT_SHOT_ID','EXACT_PARAGRAPH_BINDING','EXPLICIT_BUDGET_TARGET'].includes(reason))));
  fail(exact(value.summary,['scenes','shots','characterCuesAdded','characterCuesRemoved','affectedRecords'])&&same(value.summary.scenes,counts(value.sceneDeltas))&&same(value.summary.shots,counts(value.shotDeltas))&&value.summary.characterCuesAdded===value.characterCues.added.length&&value.summary.characterCuesRemoved===value.characterCues.removed.length&&value.summary.affectedRecords===value.affectedRecords.length);
  fail(strings(value.unmappedSourceSceneIds)&&strings(value.unmappedDraftSceneIds)&&same(value.unmappedSourceSceneIds,value.sourceScenes.filter(scene=>!value.mappings.some(row=>row.sourceSceneId===scene.sceneId)).map(scene=>scene.sceneId))&&same(value.unmappedDraftSceneIds,value.draftScenes.filter(scene=>!value.mappings.some(row=>row.draftSceneId===scene.sceneId)).map(scene=>scene.sceneId))&&text(value.explanation,2000));
  return value;
}

/** Deterministic planning payload. The review mapping is recorded for people;
 * this note is never parsed to confer scene identity or replace source state. */
export function buildLegacyProductionHandoff(input,hash) {
  validateLegacyProductionRevisionRequest('apply',input);
  const mapping=input.mappings.find(row=>row.sourceSceneId===input.sourceSceneId);
  const receipt = ['QiMovi reviewed planning context',`Project: ${input.projectId}`,`Retained source: ${input.sourceHash}`,`Production scene: ${input.sourceSceneId}`,`Writing scene: ${mapping.draftSceneId}`,`Saved draft: ${input.draftRef.id} v${input.draftRef.version} (${input.draftRef.sha256})`,`Review: ${input.previewSha256}`,`Request binding: ${hash(canonicalJson(input))}`,'This selects saved writing as planning context. Retained production, media and costs are unchanged.'].join('\n');
  return {sourceHash:input.sourceHash,sceneId:input.sourceSceneId,authoringRef:{id:input.draftRef.id,sha256:input.draftRef.sha256},shotIds:[...input.shotIds],purpose:'PLANNING_CONTEXT',notes:input.notes ? `${input.notes}\n\n${receipt}` : receipt};
}


/** UI-only receipt removal. The complete exact generated suffix must match;
 * arbitrary screenplay/provenance text is never interpreted as authority. */
export function legacyProductionPlanningNotes(notes) {
  if (typeof notes !== 'string') return '';
  const identifier='[A-Za-z0-9][A-Za-z0-9._:-]{0,159}', digest='[a-f0-9]{64}';
  const receipt=new RegExp('(?:^|\\n\\n)QiMovi reviewed planning context\\nProject: '+identifier+'\\nRetained source: '+digest+'\\nProduction scene: '+identifier+'\\nWriting scene: '+identifier+'\\nSaved draft: screenplay-draft:'+identifier+' v[1-9][0-9]* \\(('+digest+')\\)\\nReview: '+digest+'\\nRequest binding: '+digest+'\\nThis selects saved writing as planning context\\. Retained production, media and costs are unchanged\\.$');
  return notes.replace(receipt,'');
}
