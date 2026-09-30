import { validateContextBundleId, contextSceneCharacters } from './context-bundle.mjs';
import { hashCanonical } from '../kernel/src/canonical-json.mjs';
import { validateWorkflowRef } from './production-handoff.mjs';
import { createHash } from 'node:crypto';
import { resolveSourcePassages } from './source-passages.mjs';

const reject = message => { throw Object.assign(new Error(message), { code: 'INVALID_DREAMINA_BRIEF', status: 422 }); };
const assert = (value, message) => { if (!value) reject(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, fields) => assert(object(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(','), 'Unknown or missing field; approval assertions are not accepted');
const ids = (value, max) => Array.isArray(value) && value.length <= max && new Set(value).size === value.length && value.every(id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(id));

// Scene shot tokens are existing planning associations, not new source aliases.
export function dreaminaCharacters(project, scene) {
  return contextSceneCharacters(project,scene.id);
}

export function dreaminaBasis(project, records, sceneId) {
  const scene = project.scenes.find(value => value.id === sceneId);
  assert(scene, 'Unknown scene');
  const characters = dreaminaCharacters(project, scene);
  const paragraphIds = new Set(scene.paragraphs.map(value => value.id));
  const dependencies = records.filter(record =>
    (['scene-plan', 'shot-direction'].includes(record.kind) && record.data.sceneId === sceneId) ||
    (record.kind === 'casting-draft' && characters.some(character => character.id === record.data.characterId)) ||
    (record.kind === 'coverage-draft' && paragraphIds.has(record.data.paragraphId)));
  return hashCanonical({ schemaVersion: 1, sourceHash: project.sourceHash, scene,
    cells: project.cells.filter(cell => cell.sceneId === sceneId), characters,
    continuityQuestions: project.continuityQuestions ?? [],
    dependencies: dependencies.map(record => ({ id: record.id, kind: record.kind, version: record.version, sha256: record.sha256 })).sort((a,b) => a.id.localeCompare(b.id, 'en')) });
}

export function validateDreaminaBrief(data, project) {
  exact(data, ['schemaVersion','sourceHash','sceneId','title','shotIds','cellIds','initialFrameCellId','characterIds','prompt','settings','basisHash','status',...(Object.hasOwn(data??{},'handoffRef')?['handoffRef']:[]),...(Object.hasOwn(data??{},'contextBundleRef')?['contextBundleRef']:[]),...(Object.hasOwn(data??{},'sourcePassages')?['sourcePassages']:[]),...(Object.hasOwn(data??{},'mediaInputs')?['mediaInputs']:[])]);
  assert(data.schemaVersion === 1 && data.status === 'DRAFT', 'Preparation cannot assert approval or execution');
  assert(data.sourceHash === project.sourceHash && /^[a-f0-9]{64}$/.test(data.basisHash), 'Wrong source or invalid basis');
  const scene = project.scenes.find(value => value.id === data.sceneId);
  assert(scene && typeof data.title === 'string' && data.title.trim().length > 0 && data.title.length <= 200, 'Invalid scene or title');
  resolveSourcePassages(data, project, text => createHash('sha256').update(text, 'utf8').digest('hex'));
  if(Object.hasOwn(data,'handoffRef')){validateWorkflowRef(data.handoffRef);assert(data.handoffRef.id==='production-handoff:'+data.sceneId,'Handoff must match the selected scene');}
  if(Object.hasOwn(data,'contextBundleRef')){validateWorkflowRef(data.contextBundleRef);validateContextBundleId(data.contextBundleRef.id);}
  assert(ids(data.shotIds, 10) && data.shotIds.length > 0, 'Select at least one shot');
  let previous = -1;
  for (const id of data.shotIds) { const index = scene.shots.findIndex(shot => shot.id === id); assert(index > previous, 'Unknown or reversed shot'); previous = index; }
  assert(ids(data.cellIds, 400) && ids(data.characterIds, 100), 'Invalid cell or character selection');
  const sceneCharacters = dreaminaCharacters(project, scene);
  assert(data.characterIds.every(id => sceneCharacters.some(character => character.id === id)), 'Unknown scene character');
  previous = -1;
  let previousTimestamp = -1;
  const openingTimestamp = project.cells.find(cell => cell.id === data.cellIds[0])?.plannedTimestampMs;
  for (const id of data.cellIds) {
    const cell = project.cells.find(value => value.id === id && value.sceneId === scene.id);
    const index = cell ? data.shotIds.indexOf(cell.shotId) : -1;
    assert(index >= 0 && index >= previous, 'Orphan or reversed cell'); previous = index;
    if (cell.plannedTimestampMs != null) {
      assert(Number.isSafeInteger(cell.plannedTimestampMs) && cell.plannedTimestampMs >= 0 && cell.plannedTimestampMs >= previousTimestamp, 'Impossible or reversed cell timestamp');
      if (data.settings?.durationMs != null && openingTimestamp != null) assert(cell.plannedTimestampMs - openingTimestamp <= data.settings.durationMs, 'Relative cell timestamp exceeds planned clip duration');
      previousTimestamp = cell.plannedTimestampMs;
    }
  }
  assert(data.initialFrameCellId === null || (typeof data.initialFrameCellId === 'string' && data.cellIds[0] === data.initialFrameCellId &&
    project.cells.some(cell => cell.id === data.initialFrameCellId && cell.sceneId === scene.id && cell.shotId === data.shotIds[0])), 'Clip opening must be the first selected cell and map to the first selected shot');
  assert(typeof data.prompt === 'string' && data.prompt.length <= 40000, 'Invalid prompt');
  if (Object.hasOwn(data,'mediaInputs')) {
    assert(Array.isArray(data.mediaInputs) && data.mediaInputs.length <= 64, 'Invalid generation media selection');
    const selections = new Set();
    for (const input of data.mediaInputs) {
      exact(input, ['sha256','role','inMs','outMs']);
      assert(typeof input.sha256 === 'string' && /^[a-f0-9]{64}$/.test(input.sha256) && ['SOURCE_VIDEO','MOTION_REFERENCE','AUDIO_REFERENCE'].includes(input.role), 'Invalid generation media reference');
      assert((input.inMs === null && input.outMs === null) || (Number.isSafeInteger(input.inMs) && Number.isSafeInteger(input.outMs) && input.inMs >= 0 && input.outMs > input.inMs && input.outMs - input.inMs <= 180000), 'Media selection must be untrimmed or a positive excerpt of at most 180 seconds');
      const selection = `${input.role}:${input.sha256}:${input.inMs}:${input.outMs}`;
      assert(!selections.has(selection), 'Duplicate generation media selection'); selections.add(selection);
    }
  }
  exact(data.settings, ['model','mode','durationMs','aspectRatio','resolution',...(Object.hasOwn(data.settings??{},'route')?['route']:[])]);
  assert(['model','aspectRatio','resolution'].every(key => typeof data.settings[key] === 'string' && data.settings[key].length <= 120 && !/[\r\n\0]/.test(data.settings[key])), 'Invalid planned setting');
  assert(['UNCONFIRMED','STANDARD','LONG_VIDEO','CLIP'].includes(data.settings.mode), 'Invalid mode');
  if (Object.hasOwn(data.settings,'route')) assert(['UNSELECTED','DREAMINA','HIGGSFIELD','COMFYUI','OTHER'].includes(data.settings.route), 'Invalid proposed generation route');
  const duration = data.settings.durationMs;
  assert(duration === null || (Number.isSafeInteger(duration) && duration > 0 && duration <= (data.settings.mode === 'STANDARD' ? 30000 : 180000)), 'Planned duration exceeds selected mode or 180-second ceiling');
  return data;
}
