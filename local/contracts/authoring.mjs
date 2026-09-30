import { validateLoreRefs } from './lore.mjs';
import { isCreativeProject, validateCreativeProject, projectOwnedContext } from './creative-project.mjs';
// Shared, provider-free authoring shapes used by the local service and client.
// Every item remains a workspace draft or attributed editor observation.
export const AUTHORING_KINDS = Object.freeze(['concept-draft','story-plan-draft','pitch-draft','writing-note','writing-session']);
export const CREATIVE_AUTHORING_KINDS = Object.freeze(['concept-draft','story-plan-draft','pitch-draft','writing-note']);
// Exact saved Bible context may enter authoring through a writing note. These
// remain research leaves, never direct production handoffs or character state.
export const BIBLE_AUTHORING_INPUT_KINDS = Object.freeze(['universe-entity','universe-profile','universe-claim','universe-link']);
export const BIBLE_AUTHORING_INPUT_LIMIT = 32;
export const AUTHORING_FORMATS = Object.freeze(['vertical','micro','short','pilot_30','pilot_60','feature']);
export const AUTHORING_TRADITIONS = Object.freeze(['causal_western','relational_eastern','hybrid']);
export const AUTHORING_STRUCTURES = Object.freeze(['three_act','hero_journey','kishotenketsu','freytag','harmon_circle','hybrid']);
// Authored project-pitch notes, never production approvals or verified business state.
export const PROJECT_PITCH_DETAIL_LIMITS = Object.freeze({
  tagline:1000,format:120,genre:120,runtime:120,creativeVision:20000,audience:20000,positioning:20000,
  team:20000,productionPlan:20000,budgetPlan:20000,financingPlan:20000,distributionPlan:20000,
  ask:20000,contact:2000,ipExpansion:20000,developmentStatus:2000,rightsStatus:2000,
});
export const PROJECT_PITCH_PRESENTATION_LIMITS = Object.freeze({ slides:40, sections:12, title:300, label:120, body:20000, imageCaption:1000, draftBytes:512*1024 });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const assert = (condition, message) => { if (!condition) throw Object.assign(new Error(message), { status:422, code:'INVALID_DRIFTER_RECORD' }); };
const text = (value, max) => typeof value === 'string' && value.length <= max;
const label = (value,max=200) => text(value,max) && value.trim().length>0 && !/[\r\n\0]/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identity = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const integer = (value,min,max) => Number.isSafeInteger(value) && value>=min && value<=max;
const unique = values => new Set(values).size === values.length;
function shape(value,required,optional=[]) {
  assert(object(value) && required.every(key=>Object.hasOwn(value,key)) && Object.keys(value).every(key=>required.includes(key)||optional.includes(key)),'Unknown authoring field, authority assertion, or missing field');
}
function list(value,max,check,message) { assert(Array.isArray(value)&&value.length<=max&&value.every(check),message); }
function tags(value) { list(value,12,tag=>label(tag,40),'Invalid authoring tags'); assert(unique(value),'Duplicate authoring tag'); }
export function validateProjectPitchPresentation(value) {
  shape(value,['theme','accentColor','slides']);
  assert(['cinema','paper','midnight'].includes(value.theme)&&typeof value.accentColor==='string'&&/^#[0-9a-fA-F]{6}$/.test(value.accentColor),'Invalid pitch presentation theme or accent');
  const limits=PROJECT_PITCH_PRESENTATION_LIMITS;
  list(value.slides,limits.slides,slide=>{
    shape(slide,['id','title','sections','layout'],['imageHash','imageCaption','hidden']);
    list(slide.sections,limits.sections,section=>{
      shape(section,['label','body']);
      return text(section.label,limits.label)&&text(section.body,limits.body);
    },'Invalid pitch slide sections');
    if(Object.hasOwn(slide,'imageHash'))assert(digest(slide.imageHash),'Pitch images must reference a retained blob hash');
    if(Object.hasOwn(slide,'imageCaption'))assert(text(slide.imageCaption,limits.imageCaption),'Invalid pitch image caption');
    if(Object.hasOwn(slide,'hidden'))assert(typeof slide.hidden==='boolean','Invalid pitch slide visibility');
    return identity(slide.id)&&text(slide.title,limits.title)&&['text','image-left','background'].includes(slide.layout);
  },'Invalid pitch presentation slides');
  assert(unique(value.slides.map(slide=>slide.id)),'Duplicate pitch slide identity');
  return value;
}
export function validateAuthoringInputRefs(refs) {
  list(refs,100,ref=>{ shape(ref,['id','sha256']); return identity(ref.id)&&digest(ref.sha256); },'Invalid authoring input reference');
  assert(unique(refs.map(ref=>ref.id)),'Duplicate authoring input reference');
}
export function validateScreenplayMetadata(value) {
  if(Object.hasOwn(value,'genre'))assert(text(value.genre,120),'Invalid screenplay genre');
  if(Object.hasOwn(value,'projectFormat'))assert(AUTHORING_FORMATS.includes(value.projectFormat),'Invalid screenplay project format');
  if(Object.hasOwn(value,'targetPages'))assert(integer(value.targetPages,1,1000),'Invalid screenplay target pages');
  if(Object.hasOwn(value,'inputRefs'))validateAuthoringInputRefs(value.inputRefs);
}
export function validateAuthoringRecord(kind,value,project) {
  project = projectOwnedContext(project, kind, value);
  assert(AUTHORING_KINDS.includes(kind),'Unsupported authoring kind');
  assert(object(value),'Invalid authoring record');
  const projectScoped=value.sourceHash===null;
  if(projectScoped) {
    assert(CREATIVE_AUTHORING_KINDS.includes(kind)&&identity(value.projectId),'Invalid project-owned authoring draft');
    if(project) {
      assert(isCreativeProject(project),'Project-owned authoring requires a source-free creative project');
      validateCreativeProject(project);
      assert(value.projectId===project.id,'Authoring draft belongs to another project');
    }
  } else assert(digest(value.sourceHash)&&(!project||value.sourceHash===project.sourceHash),'Wrong or stale frozen source');
  // Preserve each content contract. Project identity belongs only to the
  // explicit source-free envelope, never to a frozen-source record.
  const draftShape=(required,optional=[])=>shape(value,projectScoped?[...required,'projectId']:required,optional);
  if(kind==='concept-draft') {
    draftShape(['sourceHash','title','type','tags','body'],['inputRefs']);
    assert(label(value.title,120)&&label(value.type,50)&&text(value.body,20000),'Invalid concept draft'); tags(value.tags);
    if(Object.hasOwn(value,'inputRefs'))validateAuthoringInputRefs(value.inputRefs);
  } else if(kind==='story-plan-draft') {
    draftShape(['sourceHash','title','logline','theme','genre','tone','actBeats','characterArcs','sceneIndex','openQuestions'],['inputRefs','tradition','structureModel']);
    assert(label(value.title)&&text(value.logline,1000)&&text(value.theme,2000)&&text(value.genre,120)&&text(value.tone,2000),'Invalid story plan draft');
    if(Object.hasOwn(value,'tradition'))assert(AUTHORING_TRADITIONS.includes(value.tradition),'Invalid narrative tradition');
    if(Object.hasOwn(value,'structureModel'))assert(AUTHORING_STRUCTURES.includes(value.structureModel),'Invalid story structure');
    list(value.actBeats,200,beat=>{shape(beat,['id','act','beat','summary']);return identity(beat.id)&&text(beat.act,80)&&label(beat.beat,200)&&text(beat.summary,8000);},'Invalid ordered act beats');
    assert(unique(value.actBeats.map(beat=>beat.id)),'Duplicate act beat identity');
    list(value.characterArcs,100,arc=>{shape(arc,['name','want','need','arc']);return label(arc.name,200)&&text(arc.want,4000)&&text(arc.need,4000)&&text(arc.arc,8000);},'Invalid character arcs');
    assert(unique(value.characterArcs.map(arc=>arc.name)),'Duplicate character arc');
    list(value.sceneIndex,200,scene=>{
      shape(scene,['id','index','slug','purpose'],['description','characters','beatId','estimatedEighths']);
      if(Object.hasOwn(scene,'description'))assert(text(scene.description,8000),'Invalid draft scene description');
      if(Object.hasOwn(scene,'characters')){
        list(scene.characters,50,name=>label(name,200),'Invalid draft scene characters');
        assert(unique(scene.characters),'Duplicate draft scene character');
      }
      if(Object.hasOwn(scene,'beatId'))assert(identity(scene.beatId)&&value.actBeats.some(beat=>beat.id===scene.beatId),'Draft scene beat reference must exist in this story plan');
      if(Object.hasOwn(scene,'estimatedEighths'))assert(integer(scene.estimatedEighths,0,8000),'Draft scene page estimate must be integer eighths between 0 and 8000');
      return identity(scene.id)&&integer(scene.index,1,200)&&label(scene.slug,400)&&text(scene.purpose,8000);
    },'Invalid authoring scene index');
    assert(unique(value.sceneIndex.map(scene=>scene.id))&&value.sceneIndex.every((scene,index)=>scene.index===index+1),'Scene index must preserve unique ordered draft scenes');
    list(value.openQuestions,200,question=>label(question,4000),'Invalid open questions');
    if(Object.hasOwn(value,'inputRefs'))validateAuthoringInputRefs(value.inputRefs);
  } else if(kind==='pitch-draft') {
    const fields=['logline','synopsis','characterSummaries','thematicSummary','worldDescription','toneDescription','comparableReferences'];
    draftShape(['sourceHash','title',...fields],['inputRefs','projectDetails','presentation']);
    assert(label(value.title)&&fields.every(field=>text(value[field],field==='logline'?1000:20000)),'Invalid pitch draft');
    if(Object.hasOwn(value,'projectDetails')) {
      shape(value.projectDetails,[],Object.keys(PROJECT_PITCH_DETAIL_LIMITS));
      assert(Object.entries(value.projectDetails).every(([field,value])=>text(value,PROJECT_PITCH_DETAIL_LIMITS[field])),'Invalid project pitch detail');
    }
    if(Object.hasOwn(value,'presentation')) {
      validateProjectPitchPresentation(value.presentation);
      // Match the downloaded JSON representation so every accepted customized
      // draft can pass the file import byte limit on a later reopen.
      assert(new TextEncoder().encode(JSON.stringify(value,null,2)+'\n').byteLength<=PROJECT_PITCH_PRESENTATION_LIMITS.draftBytes,'Pitch presentation draft exceeds the 512 KiB import and save limit');
    }
    if(Object.hasOwn(value,'inputRefs'))validateAuthoringInputRefs(value.inputRefs);
  } else if(kind==='writing-note') {
    draftShape(['sourceHash','title','body','category','tags'],['inputRefs','loreRefs']);
    if(Object.hasOwn(value,'loreRefs'))validateLoreRefs(value.loreRefs);
    assert(label(value.title)&&text(value.body,100000)&&['CAPTURE','RESEARCH','REVISION'].includes(value.category),'Invalid writing note'); tags(value.tags);
    if(Object.hasOwn(value,'inputRefs'))validateAuthoringInputRefs(value.inputRefs);
  } else {
    shape(value,['sourceHash','draftId','draftSha256','startedAt','endedAt','activeMs','wordsStart','wordsEnd','metricsOrigin']);
    assert(identity(value.draftId)&&value.draftId.startsWith('screenplay-draft:')&&value.draftId.length>'screenplay-draft:'.length&&digest(value.draftSha256),'Invalid writing session draft binding');
    const iso=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
    assert(iso(value.startedAt)&&iso(value.endedAt),'Invalid writing session timestamp');
    const elapsed=Date.parse(value.endedAt)-Date.parse(value.startedAt);
    assert(elapsed>=0&&elapsed<=86400000&&integer(value.activeMs,0,elapsed),'Active writing time must fit the observed session');
    assert(integer(value.wordsStart,0,200000)&&integer(value.wordsEnd,0,200000)&&value.metricsOrigin==='LOCAL_EDITOR_OBSERVATION','Writing statistics are bounded editor observations');
  }
  return value;
}
