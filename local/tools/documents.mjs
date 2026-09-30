import { readFileSync } from 'node:fs';
import { computeArtifactImpactReport } from '../kernel/src/dependency-graph.mjs';
import { hashCanonical } from '../kernel/src/canonical-json.mjs';
import { PRODUCTION_ELEMENT_CATEGORIES } from '../contracts/script-breakdown.mjs';
import { readPageElement } from '../contracts/screenplay-elements.mjs';
import { oneLiner, productionSchedule, postProductionSchedule } from './document-schedules.mjs';
const graph=JSON.parse(readFileSync(new URL('../kernel/registry/dependency-graph.v1.json',import.meta.url)));
const registry=JSON.parse(readFileSync(new URL('../kernel/registry/artifact-registry.v1.json',import.meta.url)));

export function impactPreview({sourceHash,changedFacts}) {
  if(!Array.isArray(changedFacts)||!changedFacts.length) return null;
  const known=new Set(graph.rules.filter(r=>r.from.kind==='FACT').map(r=>r.from.key));
  if(changedFacts.some(x=>!known.has(x)))throw new Error('Unknown dependency fact; explicit mapping required');
  return computeArtifactImpactReport({stateEnvelope:{state:{facts:{},artifact_instances:{}},state_hash:sourceHash},graph,
    operations:changedFacts.map(key=>({kind:'UPSERT_FACT',target:key,payload:{value:{proposal:true,sourceHash}}}))});
}

export const supportedDraftTypes=['SCRIPT_BREAKDOWN','ONE_LINER','SHOT_LIST','STORYBOARDS','PRODUCTION_SCHEDULE','POST_PRODUCTION_SCHEDULE'];
export const hasProductionElements = record => record.kind === 'coverage-draft' && Array.isArray(record.data?.productionElements) && record.data.productionElements.length > 0;
function documentInputs(typeId, records) {
  if (typeId === 'SCRIPT_BREAKDOWN' || typeId === 'ONE_LINER') return records.filter(hasProductionElements);
  if (typeId === 'PRODUCTION_SCHEDULE') return records.filter(record => hasProductionElements(record) || ['scene-plan', 'project-direction'].includes(record.kind));
  if (typeId === 'POST_PRODUCTION_SCHEDULE') return records.filter(record => ['project-direction', 'measured-media-take', 'take-review', 'movie-sequence'].includes(record.kind));
  const kinds = typeId === 'STORYBOARDS' ? ['scene-plan', 'storyboard-cell', 'casting-draft'] : ['scene-plan'];
  return records.filter(record => kinds.includes(record.kind));
}
export function documentDependencies(typeId,records=[]) {
  return documentInputs(typeId, records).map(record => record.sha256).sort();
}

function scriptBreakdown(project, records) {
  const byParagraph = new Map(records.filter(hasProductionElements).map(record => [record.data.paragraphId, record]));
  const sections = [...(project.prologue?.length ? [{ heading: 'Before scene one', paragraphs: project.prologue }] : []), ...project.scenes.map(scene => ({ heading: `${scene.index}. ${scene.heading}`, paragraphs: scene.paragraphs }))];
  const lines = ['## Saved production breakdown', 'Authored planning elements; quantities may be unknown. Character cues below are source observations, not saved casting or production facts.', ''];
  for (const section of sections) {
    lines.push(`### ${section.heading}`);
    const entries = section.paragraphs.flatMap(paragraph => {
      const record = byParagraph.get(paragraph.id);
      return (record?.data.productionElements ?? []).map(element => ({ element, paragraph, record }));
    });
    if (!entries.length) lines.push('No saved production elements.');
    for (const category of PRODUCTION_ELEMENT_CATEGORIES) {
      const grouped = entries.filter(entry => entry.element.category === category);
      if (!grouped.length) continue;
      lines.push(`#### ${category.replaceAll('_', ' ')}`);
      for (const { element, paragraph, record } of grouped) lines.push(
        `Element ${element.id}: ${element.name}`, `Quantity: ${element.quantity ?? 'Unknown'}`,
        `Source paragraph: ${paragraph.id} [${paragraph.type}] — see full source appendix`,
        `Saved planning record: ${record.id} · v${record.version} · ${record.sha256}`,
        `Notes: ${element.notes}`, '',
      );
    }
    const cues = section.paragraphs.map(paragraph => ({ paragraph, reading: readPageElement(paragraph.text, paragraph.type) })).filter(({ reading }) => reading.kind === 'character' && reading.characterName);
    if (cues.length) {
      lines.push('#### Character cue observations — review before adding production elements');
      for (const { paragraph, reading } of cues) lines.push(`Observed cue ${paragraph.id}: ${reading.characterName} — exact cue retained in the source appendix`);
    }
    lines.push('');
  }
  lines.push('## Full source appendix — unchanged paragraph text');
  for (const section of sections) lines.push(`### ${section.heading}`, ...section.paragraphs.map(paragraph => `${paragraph.id} [${paragraph.type}] ${paragraph.text}`));
  return lines;
}

// Draft views only. No template can synthesize executed agreements or approvals.
export function compileDocuments({project,records=[],existing=[],selectedTypes,changedFacts=[]}) {
  const impact=changedFacts.length?impactPreview({sourceHash:project.sourceHash,changedFacts}):null;
  const known=new Set(registry.records.map(r=>r.artifact_key));
  if(!selectedTypes.every(t=>known.has(t)))throw new Error('Unknown artifact type');
  const affected=new Set(impact?.impacts.map(x=>x.artifact_key)??selectedTypes);
  const replacements=[],requirements=[];
  for(const typeId of selectedTypes){
    if(!affected.has(typeId))continue;
    const prior=existing.find(x=>x.typeId===typeId);
    const definition=registry.records.find(x=>x.artifact_key===typeId);
    if(!supportedDraftTypes.includes(typeId)||['HYBRID','EXTERNAL_EVIDENCE','TRANSACTIONAL_VIEW','CURATED_PACKAGE'].includes(definition.materialization_mode)){
      requirements.push({typeId,status:'OWNER_INPUT_OR_CURATED_EVIDENCE_REQUIRED',existingHash:prior?.hash??null});continue;
    }
    const dependencies=records.filter(r=>r.kind==='scene-plan');
    let lines=[`# ${registry.records.find(x=>x.artifact_key===typeId).artifact_name}`,`Title: ${project.title}`,
      `Frozen source: ${project.sourceHash}`,`Status: DRAFT — ${project.sourceStatus}`,`No authority is granted by this generated view.`,''];
    if(typeId==='SCRIPT_BREAKDOWN')lines.push(...scriptBreakdown(project,records));
    else if(typeId==='ONE_LINER')lines.push(...oneLiner(project, documentInputs(typeId, records)));
    else if(typeId==='PRODUCTION_SCHEDULE')lines.push(...productionSchedule(project, documentInputs(typeId, records)));
    else if(typeId==='POST_PRODUCTION_SCHEDULE')lines.push(...postProductionSchedule(project, documentInputs(typeId, records)));
    else if(['SHOT_LIST','STORYBOARDS'].includes(typeId)){
      for(const s of project.scenes){
        lines.push(`## ${s.index}. ${s.heading}`);
        if(['SHOT_LIST','STORYBOARDS'].includes(typeId))lines.push(...s.shots.map(shot=>`${shot.label}: ${shot.description} | proposed ${shot.plannedDurationMs} ms | production unassigned`));
        const plan=dependencies.find(r=>r.data.sceneId===s.id);if(plan&&typeId!=='SCRIPT_BREAKDOWN')lines.push(`Saved proposal ${plan.id} revision ${plan.version}: ${plan.data.notes}`);
        if(typeId==='STORYBOARDS') {
          for(const cell of project.cells.filter(c=>c.sceneId===s.id))lines.push(`Cell ${cell.id} | shot ${cell.shotId} | ${cell.role} | image ${cell.imageHash??'MISSING'} | ${cell.description} | source ${(cell.actionRefs??[]).join(', ')} | review ${cell.review}`);
        }
      }
    }else lines.push('Required owner inputs and evidence remain to be supplied.');
    const body=lines.join('\n')+'\n';
    if(body.length>100000){
      requirements.push({typeId,status:'OUTPUT_EXCEEDS_LOCAL_DOCUMENT_LIMIT',existingHash:prior?.hash??null});continue;
    }
    const draft={typeId,sourceHash:project.sourceHash,dependencyHashes:documentDependencies(typeId,records),body,status:'DRAFT'};
    replacements.push({...draft,hash:hashCanonical(draft),supersedesHash:prior?.hash??null,review:'NEEDS_REVIEW'});
  }
  const replacing=new Set(replacements.map(x=>x.typeId));
  return {documents:[...existing.filter(x=>!replacing.has(x.typeId)).map(x=>affected.has(x.typeId)?{...x,review:'NEEDS_REVIEW'}:x),...replacements],impact,
    rebuiltTypes:[...replacing],requirements,sourceHash:project.sourceHash};
}
