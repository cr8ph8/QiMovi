import { validateUsageObservation } from './usage-accounting.mjs';
import { validateProductionBudget } from './production-budget.mjs';
import { validateProjectDirection } from './project-direction.mjs';
import { validateShotDirection } from './shot-direction.mjs';
import { validateModelAssistance } from './model-assistance.mjs';
import { UNIVERSE_KINDS, validateUniverseRecord } from './universe.mjs';
import { validateContextBundle } from './context-bundle.mjs';
import { validateCoverageDraft } from './source-coverage.mjs';
import { validateLoreSource } from './lore.mjs';
import { createHash } from 'node:crypto';
import { hashCanonical } from '../kernel/src/canonical-json.mjs';
import { validateDreaminaBrief } from './dreamina.mjs';
import { AUTHORING_KINDS, CREATIVE_AUTHORING_KINDS, validateAuthoringRecord, validateScreenplayMetadata } from './authoring.mjs';
import { validateProductionHandoff } from './production-handoff.mjs';
import { validateCameraObservation, validateCameraOriginRef } from './camera-observation.mjs';
import { MEDIA_RECORD_KINDS, validateMediaRecord } from './media-takes.mjs';
import { validateNodeWorkflow } from './node-workflow.mjs';
import { validateProjectAsset, validateAssetCuration } from './project-library.mjs';
import { validateMovieSequence } from './movie-sequence.mjs';
import { validateStudioOperation } from './studio-operation.mjs';
import { validateStudioMedia } from './studio-media.mjs';
import { validateDccReturnOriginRef } from './dcc-return-origin.mjs';
import { validateCreativeProject, isCreativeProject, projectOwnedContext } from './creative-project.mjs';
import { validateCreativeScreenplayDraft } from './creative-screenplay.mjs';
import { validateProductionAttachment } from './production-attachment.mjs';
import { validateWritingProductionPlan } from './writing-production.mjs';
import { validateWritingSceneMap } from './writing-scene-map.mjs';
import { validateStudioGeneration } from './studio-generation.mjs';
import { validateStudioReference } from './studio-reference.mjs';
import { validateAssetMarketProfile } from './asset-market-profile.mjs';
import { validateParticipation } from './project-participation.mjs';
import { validateTokenPreparation } from './asset-token-preparation.mjs';
import { validateComicPackage } from './comic-package.mjs';
import { STORYBOARD_PLANNING_KINDS, validateStoryboardPlanning } from './storyboard-planning.mjs';
import { validateFrameExtraction } from './storyboard-frame.mjs';
export const PROFILE = 'drifter-hybrid-film/v1';
export const MAX_SEGMENT_MS = 180000;
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw Object.assign(new Error(message), { status: 422, code: 'INVALID_DRIFTER_RECORD' }); };
const object = x => x && typeof x === 'object' && !Array.isArray(x);
const assert = (v, message) => { if (!v) fail(message); };
const keys = (x, allowed, required = []) => {
  assert(object(x), 'Expected object');
  assert(Object.keys(x).every(k => allowed.includes(k)), 'Unknown field or authority assertion');
  assert(required.every(k => Object.hasOwn(x,k)), 'Missing required field');
};
const text = (x,max=4000) => typeof x === 'string' && x.length > 0 && x.length <= max;
const digest = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const unique = xs => new Set(xs).size === xs.length;
const bounded = x => Number.isInteger(x) && x > 0 && x <= MAX_SEGMENT_MS;
const roles = ['START','MOMENT','END'];

export function validateRecord(kind, data, project) {
  assert(object(project) && Array.isArray(project.scenes), 'Missing project');
  if (kind === 'production-attachment') return validateProductionAttachment(data, project);
  if (kind === 'asset-curation' && project.creativeOrigin) return validateAssetCuration(data, project);
  if (['universe-continuity-plan', 'universe-production-plan'].includes(kind) && project?.creativeOrigin) return validateUniverseRecord(kind, data, project);
  project = projectOwnedContext(project, kind, data);
  if (kind === 'asset-token-preparation') return validateTokenPreparation(data, project);
  if (kind === 'project-participation') return validateParticipation(data, project);
  if (kind === 'production-budget') return validateProductionBudget(data, project);
  if (kind === 'usage-observation') return validateUsageObservation(data, project);
  if (isCreativeProject(project)) {
    validateCreativeProject(project);
    if (kind === 'project-direction') return validateProjectDirection(data, project);
    if (kind === 'studio-operation') return validateStudioOperation(data, project);
    if (kind === 'studio-media') return validateStudioMedia(data, project);
    if (kind === 'project-asset') return validateProjectAsset(data, project);
    if (kind === 'asset-curation') return validateAssetCuration(data, project);
    if (kind === 'screenplay-draft') return validateCreativeScreenplayDraft(data, project);
    if (kind === 'writing-production-plan') return validateWritingProductionPlan(data, project);
    if (CREATIVE_AUTHORING_KINDS.includes(kind)) return validateAuthoringRecord(kind, data, project);
    if (kind === 'studio-generation') return validateStudioGeneration(data, project);
    if (kind === 'studio-reference') return validateStudioReference(data, project);
    if (kind === 'asset-market-profile') return validateAssetMarketProfile(data, project);
    if (UNIVERSE_KINDS.includes(kind)) return validateUniverseRecord(kind, data, project);
    fail('This record requires a screenplay-linked project');
  }
  assert(object(data) && data.sourceHash === project.sourceHash, 'Wrong or stale frozen source');
  const scenes = project.scenes, cells = project.cells ?? [];
  const scene = scenes.find(s => s.id === data.sceneId);
  if (kind === 'shot-direction') { validateShotDirection(data, project);
  } else if (STORYBOARD_PLANNING_KINDS.includes(kind)) { validateStoryboardPlanning(kind, data, project);
  } else if (kind === 'storyboard-frame-extraction') { validateFrameExtraction(data, project);
  } else if (kind === 'comic-package') { validateComicPackage(data, project);
  } else if (kind === 'asset-market-profile') { validateAssetMarketProfile(data, project);
  } else if (kind === 'studio-reference') { validateStudioReference(data, project);
  } else if (kind === 'studio-generation') { validateStudioGeneration(data, project);
  } else if (kind === 'studio-operation') { validateStudioOperation(data, project);
  } else if (kind === 'project-direction') { validateProjectDirection(data, project);
  } else if (UNIVERSE_KINDS.includes(kind)) {
    validateUniverseRecord(kind, data, project);
  } else if (kind === 'model-assistance') {
    validateModelAssistance(data, project);
  } else if (kind === 'project-asset') {
    validateProjectAsset(data, project);
  } else if (kind === 'asset-curation') {
    validateAssetCuration(data, project);
  } else if (kind === 'node-workflow') {
    validateNodeWorkflow(data, project);
  } else if (kind === 'movie-sequence') {
    validateMovieSequence(data, project);
  } else if (MEDIA_RECORD_KINDS.includes(kind)) {
    validateMediaRecord(kind, data, project);
  } else if (kind === 'context-bundle') {
    validateContextBundle(data,project);
  } else if (kind === 'lore-source') {
    validateLoreSource(data,project);
  } else if (kind === 'camera-observation') {
    validateCameraObservation(data,project);
  } else if (kind === 'production-handoff') {
    validateProductionHandoff(data,project);
  } else if (AUTHORING_KINDS.includes(kind)) {
    validateAuthoringRecord(kind,data,project);
  } else if (kind === 'screenplay-draft') {
    keys(data,['sourceHash','title','format','body','sceneId','genre','projectFormat','targetPages','inputRefs','sceneMap'],['sourceHash','title','format','body']);
    assert(text(data.title,200)&&data.title.trim().length>0&&!/[\r\n\0]/.test(data.title),'Invalid screenplay draft title');
    assert(data.format==='FOUNTAIN'&&typeof data.body==='string'&&data.body.length<=200000,'Invalid Fountain draft body');
    if(Object.hasOwn(data,'sceneId'))assert(text(data.sceneId,160)&&scene,'Unknown screenplay draft scene');
    validateScreenplayMetadata(data);
    if (Object.hasOwn(data, 'sceneMap')) validateWritingSceneMap(data.sceneMap, data.body);
    // A writer's draft is independent workspace text. No source projection or
    // admission authority is derived from its title, formatting, or content.
  } else if (kind === 'generation-brief') {
    validateDreaminaBrief(data, project);
  } else if (kind === 'scene-plan') {
    keys(data,['sceneId','sourceHash','notes','cellOverrides','timingObservations','segments','cellBasisHash'],['sceneId','sourceHash','notes','cellOverrides','timingObservations','segments']);
    assert(scene, 'Orphan scene');
    if((project.cellRevisionSceneIds??[]).includes(data.sceneId)||Object.hasOwn(data,'cellBasisHash'))assert(digest(data.cellBasisHash)&&data.cellBasisHash===project.cellBasisHashes?.[data.sceneId],'Storyboard cell basis is missing or stale; explicit rebase required');
    assert(typeof data.notes==='string' && data.notes.length<=20000,'Invalid notes');
    assert(Array.isArray(data.cellOverrides) && data.cellOverrides.length<=400,'Invalid cells');
    assert(unique(data.cellOverrides.map(c=>c.cellId)), 'Duplicate cell override');
    for (const c of data.cellOverrides) {
      keys(c,['cellId','role','note'],['cellId','role','note']);
      const base=cells.find(x=>x.id===c.cellId && x.sceneId===scene.id);
      assert(base,'Orphan cell'); assert(roles.includes(c.role),'Invalid cell role');
      assert(typeof c.note==='string' && c.note.length<=4000,'Invalid cell note');
      // A later-shot candidate cannot quietly be relabelled as the scene opening.
      if(c.role==='START') assert(base.shotId===scene.shots[0].id,'Starting frame does not map to opening shot');
    }
    assert(Array.isArray(data.timingObservations) && data.timingObservations.length<=1000,'Invalid timing observations');
    for(const t of data.timingObservations) {
      keys(t,['durationMs','note','recordedAt'],['durationMs','note','recordedAt']);
      assert(Number.isInteger(t.durationMs)&&t.durationMs>0&&t.durationMs<=86400000,'Invalid measured rehearsal duration');
      assert(typeof t.note==='string'&&t.note.length<=4000&&Number.isFinite(Date.parse(t.recordedAt)),'Invalid timing metadata');
    }
    assert(Array.isArray(data.segments)&&data.segments.length<=100,'Invalid segments');
    assert(unique(data.segments.map(s=>s.id)),'Duplicate segment');
    for(const s of data.segments) {
      keys(s,['id','durationMs','cellIds','method'],['id','durationMs','cellIds','method']);
      assert(text(s.id,120)&&bounded(s.durationMs),'Segment duration must be 0 < duration <= 180000 ms');
      assert(['SUPPLIED','FILMED','AI','HYBRID'].includes(s.method),'Invalid method');
      assert(Array.isArray(s.cellIds)&&s.cellIds.length>0&&unique(s.cellIds),'Invalid ordered segment cells');
      let previous=-1;
      for(const id of s.cellIds) {
        const c=cells.find(x=>x.id===id&&x.sceneId===scene.id);assert(c,'Orphan segment cell');
        const index=scene.shots.findIndex(x=>x.id===c.shotId);assert(index>=previous,'Action order reversed');previous=index;
        if(c.plannedTimestampMs!=null)assert(Number.isInteger(c.plannedTimestampMs)&&c.plannedTimestampMs>=0&&c.plannedTimestampMs<=s.durationMs,'Impossible planned timestamp');
      }
    }
  } else if (kind === 'storyboard-cell') {
    keys(data,['sourceHash','cellId','sceneId','shotId','role','imageHash','crop','pixelWidth','pixelHeight','description','actionRefs','plannedTimestampMs','review','originCameraRef','originDccReturnRef'],['sourceHash','cellId','sceneId','shotId','role','imageHash','crop','description','actionRefs','plannedTimestampMs','review']);
    if(data.originCameraRef)validateCameraOriginRef(data.originCameraRef);
    if(Object.hasOwn(data,'originDccReturnRef'))validateDccReturnOriginRef(data.originDccReturnRef);
    assert(!(data.originCameraRef && data.originDccReturnRef),'A cell has one original DCC evidence source');
    assert(typeof data.cellId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(data.cellId),'Invalid storyboard cell identity');
    assert(scene&&scene.shots.some(s=>s.id===data.shotId),'Storyboard shot must belong to its scene');
    assert(scene.shots.length<=100,'Scene shot limit exceeded');
    const previous=cells.find(c=>c.id===data.cellId);
    if(previous)assert(previous.sceneId===data.sceneId&&previous.shotId===data.shotId,'Existing storyboard cell cannot move to another source target');
    assert(previous||cells.length<400,'Storyboard cell limit exceeded');
    assert(roles.includes(data.role)&&data.review==='PENDING','Storyboard candidate cannot assert approval');
    if(data.role==='START')assert(data.shotId===scene.shots[0].id,'Starting frame does not map to opening shot');
    assert(data.imageHash===null||digest(data.imageHash),'Invalid storyboard image hash');
    assert(text(data.description,8000),'Invalid storyboard description');
    assert(Array.isArray(data.actionRefs)&&data.actionRefs.length<=1000&&unique(data.actionRefs),'Invalid action references');
    const paragraphs=[...scene.paragraphs,...(project.prologue??[])];
    assert(data.actionRefs.every(id=>paragraphs.some(p=>p.id===id)),'Storyboard action reference is not in this scene or prologue');
    assert(data.plannedTimestampMs===null||(Number.isSafeInteger(data.plannedTimestampMs)&&data.plannedTimestampMs>=0&&data.plannedTimestampMs<=86400000),'Invalid proposed cell timestamp');
    const hasPixels=Object.hasOwn(data,'pixelWidth')||Object.hasOwn(data,'pixelHeight');
    if(hasPixels)assert(data.imageHash!==null&&Number.isInteger(data.pixelWidth)&&Number.isInteger(data.pixelHeight)&&data.pixelWidth>0&&data.pixelHeight>0&&data.pixelWidth<=100000&&data.pixelHeight<=100000,'Invalid declared image dimensions');
    if(data.crop!==null){
      keys(data.crop,['x','y','width','height'],['x','y','width','height']);
      assert(data.imageHash!==null&&hasPixels,'Crop requires an image and declared pixel dimensions');
      const c=data.crop;
      assert([c.x,c.y,c.width,c.height].every(Number.isInteger)&&c.x>=0&&c.y>=0&&c.width>0&&c.height>0&&c.x+c.width<=data.pixelWidth&&c.y+c.height<=data.pixelHeight,'Crop exceeds declared image bounds');
    }
  } else if (kind === 'casting-draft') {
    keys(data,['sourceHash','characterId','performer','referenceHashes','useScope','evidenceHashes','notes'],['sourceHash','characterId','performer','referenceHashes','useScope','evidenceHashes','notes']);
    assert(project.characters.some(x=>x.id===data.characterId),'Unknown character');
    assert(text(data.performer,300),'Invalid performer candidate');
    assert(['INTERNAL_STORYBOARD_REFERENCE_ONLY','FILM_USE_REQUESTED'].includes(data.useScope),'Draft cannot grant film-use authority');
    assert([data.referenceHashes,data.evidenceHashes].every(xs=>Array.isArray(xs)&&xs.every(digest)&&unique(xs)),'Invalid reference/evidence hashes');
    assert(typeof data.notes==='string'&&data.notes.length<=8000,'Invalid notes');
  } else if (kind === 'review-observation') {
    keys(data,['sourceHash','packageHash','commentId','reviewerLabel','note','sceneId','cellId','observedAt','basisStateAtImport','basisHash','targetRecordId','targetRecordHash'],['sourceHash','packageHash','commentId','reviewerLabel','note','observedAt']);
    assert(digest(data.packageHash)&&text(data.commentId,120)&&text(data.reviewerLabel,160)&&text(data.note,10000),'Invalid review comment');
    assert(Number.isFinite(Date.parse(data.observedAt)),'Invalid observation date');
    if(data.basisStateAtImport)assert(['CURRENT','HISTORICAL'].includes(data.basisStateAtImport),'Invalid review basis at import');
    if(data.basisHash)assert(digest(data.basisHash),'Invalid review basis hash');
    if(data.sceneId)assert(scene,'Unknown scene');
    if(data.cellId)assert(cells.some(c=>c.id===data.cellId&&(!scene||c.sceneId===scene.id)),'Unknown review cell');
    if(Object.hasOwn(data,'targetRecordId')||Object.hasOwn(data,'targetRecordHash'))assert(text(data.targetRecordId,160)&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(data.targetRecordId)&&digest(data.targetRecordHash),'Invalid review target record binding');
  } else if (kind === 'review-resolution') {
    keys(data,['sourceHash','commentId','disposition','note','basisHash'],['sourceHash','commentId','disposition','note','basisHash']);
    assert(text(data.commentId,120)&&digest(data.basisHash),'Invalid resolution basis');
    assert(['ACKNOWLEDGED','ACTION_PLANNED','DECLINED_WITH_REASON'].includes(data.disposition)&&text(data.note),'Invalid resolution');
  } else if (kind === 'coverage-draft') {
    validateCoverageDraft(data,project);
  } else if (kind === 'media-take') {
    keys(data,['sourceHash','assetHash','origin','segmentId','segmentHash','provenanceHash','notes','status'],['sourceHash','assetHash','origin','segmentId','segmentHash','provenanceHash','notes','status']);
    assert([data.assetHash,data.segmentHash,data.provenanceHash].every(digest),'Missing media/provenance hash');
    assert(['IMPORTED','GENERATED'].includes(data.origin)&&text(data.segmentId,120),'Invalid take origin');
    assert(data.status==='AWAITING_MEASUREMENT_AND_OWNER_SELECT','Client metadata cannot assert QC or owner selection');
  } else if (kind === 'document-draft') {
    keys(data,['sourceHash','typeId','dependencyHashes','body','status'],['sourceHash','typeId','dependencyHashes','body','status']);
    assert(text(data.typeId,150)&&Array.isArray(data.dependencyHashes)&&data.dependencyHashes.every(digest),'Invalid document dependencies');
    assert(typeof data.body==='string'&&data.body.length<=100000&&data.status==='DRAFT','Document body or status invalid');
  } else fail('Unsupported workspace record kind');
  return data;
}

// Execution qualification is independent from saving a draft plan.
export function executionHash(segment) {const {revisionHash,...payload}=segment;return hashCanonical(payload);}
export function qualifySegment(segment,{project,cells,casting,admission,approval,prompt,providerLimitMs=MAX_SEGMENT_MS}) {
  assert(bounded(segment.durationMs)&&segment.durationMs<=providerLimitMs,'Duration exceeds segment/provider limit');
  assert(admission?.sourceHash===project.sourceHash&&admission.status==='ADMITTED','Source not admitted');
  assert(digest(segment.revisionHash)&&executionHash(segment)===segment.revisionHash&&approval?.segmentHash===segment.revisionHash&&approval.status==='APPROVED','Missing or stale exact segment approval');
  assert(segment.sourceHash===project.sourceHash,'Execution manifest source mismatch');
  assert(Array.isArray(segment.cellIds)&&segment.cellIds.length>0&&unique(segment.cellIds),'Missing ordered cells');
  const ordered=segment.cellIds.map(id=>{const c=cells.find(x=>x.id===id);assert(c,'Orphan cell');return c;});
  const sourceShots=project.scenes.flatMap(s=>s.shots.map(shot=>({id:shot.id,sceneId:s.id})));
  assert(Array.isArray(segment.shotIds)&&unique(segment.shotIds)&&segment.shotIds.length>0,'Missing unique shot list');
  let sourceIndex=-1;
  for(const id of segment.shotIds){const i=sourceShots.findIndex(s=>s.id===id);assert(i>sourceIndex,'Orphan or reversed source shot order');sourceIndex=i;}
  for(const c of ordered)assert(project.cells.some(base=>base.id===c.id&&base.shotId===c.shotId&&base.sceneId===c.sceneId)&&sourceShots.some(s=>s.id===c.shotId&&s.sceneId===c.sceneId),'Storyboard cell is not bound to frozen project');
  assert(Array.isArray(segment.cellLocks)&&segment.cellLocks.length===ordered.length&&ordered.every(c=>segment.cellLocks.some(lock=>lock.cellId===c.id&&lock.sha256===hashCanonical(c))),'Changed storyboard/reference cells');
  const first=ordered[0];
  assert(first.role==='START'&&first.id===segment.startCellId&&digest(first.imageHash),'Approved starting image required');
  assert(first.review==='APPROVED'&&ordered.every(c=>c.review==='APPROVED'),'Unreviewed cells');
  assert(first.shotId===segment.shotIds?.[0],'Wrong starting frame mapping');
  let previous=-1, timestamp=-1;
  for(const c of ordered){
    const i=segment.shotIds.indexOf(c.shotId);assert(i>=previous&&i>=0,'Action order reversed');previous=i;
    if(c.plannedTimestampMs!=null){assert(Number.isInteger(c.plannedTimestampMs)&&c.plannedTimestampMs>=timestamp&&c.plannedTimestampMs<=segment.durationMs,'Impossible timestamp');timestamp=c.plannedTimestampMs;}
  }
  assert(Array.isArray(segment.castLocks)&&segment.castLocks.every(lock=>casting.some(c=>c.characterId===lock.characterId&&c.revisionHash===lock.revisionHash&&executionHash(c)===c.revisionHash&&c.scope==='FILM_USE'&&digest(c.evidenceHash))),'Casting/reference lock not cleared');
  assert(digest(segment.promptHash)&&typeof prompt==='string'&&hash(prompt)===segment.promptHash,'Missing or changed locked prompt');
  return {status:'TECHNICALLY_ELIGIBLE',sourceHash:project.sourceHash,segmentHash:segment.revisionHash};
}

export function proposeSplits(cells, durationMs, limitMs=MAX_SEGMENT_MS) {
  assert(Number.isInteger(durationMs)&&durationMs>0&&bounded(limitMs),'Invalid split timing');
  assert(cells.length>0&&cells.every(c=>Number.isInteger(c.plannedTimestampMs)),'Meaningful timestamped cells required');
  assert(unique(cells.map(c=>c.id)),'Duplicate split cells');
  assert(cells[0].plannedTimestampMs===0,'Starting cell must be at zero');
  for(let i=1;i<cells.length;i++)assert(cells[i].plannedTimestampMs>cells[i-1].plannedTimestampMs&&cells[i].plannedTimestampMs<durationMs,'Unordered split cells');
  const splits=[];let start=0;
  while(start<durationMs){
    const candidates=cells.filter(c=>c.plannedTimestampMs>start&&c.plannedTimestampMs<=start+limitMs);
    const end=durationMs-start<=limitMs?durationMs:candidates.at(-1)?.plannedTimestampMs;
    assert(end>start,'No meaningful split cell within provider limit; owner must add one');
    const selected=cells.filter(c=>c.plannedTimestampMs>=start&&c.plannedTimestampMs<end);
    splits.push({startMs:start,endMs:end,durationMs:end-start,cellIds:selected.map(c=>c.id),cells:selected.map(c=>({...c,sourcePlannedTimestampMs:c.plannedTimestampMs,plannedTimestampMs:c.plannedTimestampMs-start})),status:'PROPOSED_OWNER_REVIEW',startingFrameRequired:true});start=end;
  }
  return splits;
}
