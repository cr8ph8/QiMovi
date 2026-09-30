import { contextBundleForBrief, exportContextEvidence } from './context-bundles.mjs';
import { getLore } from './lore.mjs';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { dreaminaBasis, dreaminaCharacters, validateDreaminaBrief } from '../contracts/dreamina.mjs';
import { canonical, check, sha256 } from './storage.mjs';
import { resolveUnifiedWorkflow } from './unified-workflow.mjs';
import { validateCameraRecordReferences, verifyStoredCameraObservation } from './camera-proofs.mjs';
import { resolveSourcePassages } from '../contracts/source-passages.mjs';
import { validateMediaRecordReferences } from './media-takes.mjs';
import { dccReturnEvidenceForCells } from './dcc-stage-returns.mjs';
import { formatShotDirection, validateShotDirection, validateShotDirectionIdentity } from '../contracts/shot-direction.mjs';

const extensions = { 'image/png':'png', 'image/jpeg':'jpg', 'image/webp':'webp', 'image/gif':'gif' };
const mediaExtensions = { 'video/mp4':'mp4', 'video/quicktime':'mov', 'video/webm':'webm', 'audio/mpeg':'mp3', 'audio/wav':'wav', 'audio/flac':'flac', 'audio/ogg':'ogg', 'audio/mp4':'m4a' };
const sourceScope = 'ENTIRE_SCENE_CONTEXT_NOT_CLIP_COVERAGE';

// References stay in the existing brief record. A trim is a request, never a
// claim that these original bytes have already been cut or provider-qualified.
function generationMediaInputs(store, data, records) {
  return (data.mediaInputs ?? []).map(input => {
    check(store, 'GENERATION_MEDIA_STORE_REQUIRED', 409);
    const info = store.blobInfo(input.sha256);
    const family = input.role === 'AUDIO_REFERENCE' ? 'audio/' : 'video/';
    check(mediaExtensions[info.mimeType] && info.mimeType.startsWith(family), 'GENERATION_MEDIA_TYPE_MISMATCH', 422);
    const measured = records.find(record => record.kind === 'measured-media-take' && record.data.blob.sha256 === input.sha256);
    if (measured) validateMediaRecordReferences(store, measured.kind, measured.data, { id: measured.id, version: measured.version });
    const measuredDurationMs = measured?.data.measurement.durationMs ?? null;
    if (measuredDurationMs !== null) check(input.inMs === null ? measuredDurationMs <= 180000 : input.outMs <= measuredDurationMs, input.inMs === null ? 'GENERATION_MEDIA_SELECTION_TOO_LONG' : 'GENERATION_MEDIA_TRIM_OUTSIDE_DURATION', 422);
    return { role: input.role, label: `${input.role.replaceAll('_', ' ')} · ${input.sha256.slice(0,12)}`, sha256: input.sha256,
      path: `assets/original-${input.sha256}.${mediaExtensions[info.mimeType]}`, mimeType: info.mimeType, byteLength: info.byteLength,
      crop: null, scope: 'USE_REVIEW_REQUIRED', cellId: null, characterId: null,
      status: input.inMs === null ? 'ORIGINAL_NEEDS_REVIEW' : 'EXCERPT_REQUIRED', inMs: input.inMs, outMs: input.outMs,
      originalUnmodified: true, measurementRef: measured ? { id: measured.id, sha256: measured.sha256 } : null, measuredDurationMs };
  });
}

function snapshot(store, sceneId) {
  const project = store.resolvedProject();
  const records = store.rawList();
  const scene = project.scenes.find(value => value.id === sceneId);
  check(scene, 'UNKNOWN_DREAMINA_SCENE', 404);
  // A corrupted dependency body must not inherit its old recorded hash.
  for (const record of records) check(sha256(canonical(record.data)) === record.sha256, 'DREAMINA_DEPENDENCY_HASH_MISMATCH', 409);
  const characters = dreaminaCharacters(project, scene);
  return { project, records, scene, characters, basisHash: dreaminaBasis(project, records, sceneId),
    cells: project.cells.filter(cell => cell.sceneId === sceneId),
    casting: records.filter(record => record.kind === 'casting-draft' && characters.some(character => character.id === record.data.characterId)),
    scenePlan: records.find(record => record.kind === 'scene-plan' && record.data.sceneId === sceneId) ?? null };
}

function linkedWorkflow(store,data) {
  if(!Object.hasOwn(data,'handoffRef'))return null;
  check(store,'DREAMINA_WORKFLOW_STORE_REQUIRED',409);
  const workflow=resolveUnifiedWorkflow(store,{sceneId:data.sceneId,handoffRef:data.handoffRef});
  check(workflow.status==='CURRENT'&&workflow.readiness==='READY_FOR_PLANNING','STALE_DREAMINA_HANDOFF',409);
  check(data.shotIds.every(id=>workflow.handoff.record.data.shotIds.includes(id)),'DREAMINA_SHOTS_OUTSIDE_HANDOFF',409);
  return workflow;
}
function selectedCameraProofs(store,data,project) {
  const proofs=[];
  for(const cell of project.cells.filter(cell=>data.cellIds.includes(cell.id)&&cell.originCameraRef)) {
    check(store,'DREAMINA_CAMERA_STORE_REQUIRED',409);
    validateCameraRecordReferences(store,'storyboard-cell',{...cell,sourceHash:project.sourceHash});
    const record=store.history(cell.originCameraRef.id).find(record=>record.sha256===cell.originCameraRef.sha256);
    verifyStoredCameraObservation(store,record.data);
    if(record.data.handoffRef) {
      const cameraWorkflow=resolveUnifiedWorkflow(store,{sceneId:data.sceneId,handoffRef:record.data.handoffRef});
      check(cameraWorkflow.readiness==='READY_FOR_PLANNING','STALE_DREAMINA_CAMERA_HANDOFF',409);
      if(data.handoffRef)check(canonical(data.handoffRef)===canonical(record.data.handoffRef),'DREAMINA_CAMERA_HANDOFF_MISMATCH',409);
    }
    if(!proofs.some(value=>value.id===record.id&&value.sha256===record.sha256))proofs.push(record);
  }
  return proofs;
}
function selectedDccReturns(store, data, project) {
  if (!project.cells.some(cell => data.cellIds.includes(cell.id) && cell.originDccReturnRef)) return [];
  check(store, 'DREAMINA_DCC_RETURN_STORE_REQUIRED', 409);
  return dccReturnEvidenceForCells(store, data.cellIds, { initialFrameCellId: data.initialFrameCellId });
}
function writingIntent(workflow) {
  if(!workflow)return '';
  const record=workflow.authoring.record,data=record.data;
  const intent=[`Saved ${record.kind}: ${data.title}`,`Exact writing reference: ${record.id} / ${record.sha256}`,`Handoff intent: ${workflow.handoff.record.data.notes}`,
    ...['body','logline','theme','synopsis'].filter(key=>typeof data[key]==='string'&&data[key].length).map(key=>`${key}: ${data[key]}`)].join('\n\n');
  const characters=Array.from(intent),projection=characters.slice(0,6000).join('');
  return ['WRITING INTENT — planning context, not dialogue','Use this saved intent to inform only the selected clip. It may cover additional shots: do not add unselected beats or dialogue from it. The exact screenplay context below remains the dialogue and action source.',projection,
    characters.length>6000?'[Planning projection truncated at 6,000 characters. Full exact writing and lineage are retained in workflow-context.json.]':'Full exact writing and lineage are retained in workflow-context.json.'].join('\n\n');
}

export function validateDreaminaDependencies(data, project, records, store) {
  for (const record of records) check(sha256(canonical(record.data)) === record.sha256, 'DREAMINA_DEPENDENCY_HASH_MISMATCH', 409);
  check(data.basisHash === dreaminaBasis(project, records, data.sceneId), 'STALE_DREAMINA_BASIS', 409);
  linkedWorkflow(store,data);
  selectedCameraProofs(store,data,project);
  contextBundleForBrief(store,data);
  // Validate shape before dereferencing optional media; no defaults are written.
  validateDreaminaBrief(data, project);
  selectedDccReturns(store, data, project);
  generationMediaInputs(store, data, records);
}

export function dreaminaContext(store, sceneId, sourceStatus = 'PENDING_OWNER_ADMISSION') {
  const context = snapshot(store, sceneId);
  return { sourceHash: context.project.sourceHash, sceneId, basisHash: context.basisHash, scene: context.scene,
    cells: context.cells, characters: context.characters, casting: context.casting, scenePlan: context.scenePlan,
    sourceStatus, accountStatus: 'UNVERIFIED',
    savedBriefs: context.records.filter(record => record.kind === 'generation-brief' && record.data.sceneId === sceneId).map(record => ({ ...record,
      briefState: { status: record.data.basisHash === context.basisHash && (()=>{try{linkedWorkflow(store,record.data);selectedCameraProofs(store,record.data,context.project);selectedDccReturns(store,record.data,context.project);contextBundleForBrief(store,record.data);generationMediaInputs(store,record.data,context.records);return true;}catch{return false;}})() ? 'CURRENT_BASIS' : 'NEEDS_REVIEW' } })) };
}

function prepare(store, data, sourceStatus) {
  const context = snapshot(store, data?.sceneId);
  check(data.basisHash === context.basisHash, 'STALE_DREAMINA_BASIS', 409);
  validateDreaminaBrief(data, context.project);
  const workflowContext=linkedWorkflow(store,data);
  const contextBundle=contextBundleForBrief(store,data);
  const mediaInputs=generationMediaInputs(store,data,context.records);
  const selectedSource=resolveSourcePassages(data,context.project,sha256);
  const dccReturns = selectedDccReturns(store, data, context.project);
  const requirements = [];
  const need = (code, message) => requirements.push({ code, message });
  if (dccReturns.length) need('DCC_RETURN_REFERENCE_ONLY', 'Selected DCC renders are internal storyboard candidates. Their exact return and frame roles are retained; source admission, creative review, permitted use and generation approval remain separate.');
  if (sourceStatus !== 'ADMITTED') need('SOURCE_ADMISSION_REQUIRED', 'Review and admit the exact retained screenplay before production.');
  need('ACCOUNT_SETTINGS_UNVERIFIED', 'Choose a generation route and confirm its actual model, input roles, duration and controls; saved settings are proposed only. No provider connection is established by this package.');
  need('OWNER_EXECUTION_APPROVAL_REQUIRED', 'This package is a draft. Film-use references, creative inputs and spending must be approved before any provider upload or generation.');
  need('CLIP_COVERAGE_REVIEW_REQUIRED', 'The source excerpt is complete scene context. It does not establish that the selected shots cover its dialogue and actions. Compare proposed shot directions against that source.');
  if (data.settings.durationMs === null) need('DURATION_REQUIRED', 'Set a planned clip duration after reviewing the selected action and dialogue.');
  if (!data.settings.model || !data.settings.aspectRatio || !data.settings.resolution) need('SETTINGS_INCOMPLETE', 'Select proposed model, aspect ratio and resolution.');
  if (!data.initialFrameCellId) need('CLIP_OPENING_REQUIRED', 'Review whether the selected generation route requires a starting image. If it does, choose or import the first selected shot opening; a source video or later dramatic moment cannot silently substitute.');
  if (!data.cellIds.length) need('STORYBOARD_PLAN_REQUIRED', 'Choose an ordered storyboard plan for this clip.');
  const uploadSheet = [];
  const cameraProofs=selectedCameraProofs(store,data,context.project);
  function addAsset({ role, label, hash, crop = null, scope = 'UNRESOLVED', cellId = null, characterId = null }) {
    const item = { role, label, sha256: hash ?? null, path: null, mimeType: null, byteLength: null, crop, scope, cellId, characterId,
      status: hash ? 'ORIGINAL_NEEDS_REVIEW' : 'MISSING' };
    if (!hash) need('REFERENCE_MISSING', `${label}: supply an owned image and review its permitted use.`);
    else {
      try {
        const info = store.blobInfo(hash);
        check(extensions[info.mimeType], 'DREAMINA_IMAGE_TYPE_REQUIRED');
        item.path = `assets/original-${hash}.${extensions[info.mimeType]}`; item.mimeType = info.mimeType; item.byteLength = info.byteLength;
        if (crop) { item.status = 'CROP_REQUIRED'; need('CROP_REQUIRED', `${label}: original image is included with crop coordinates; crop and inspect it before any permitted upload.`); }
      } catch (error) {
        if (error.code !== 'BLOB_NOT_FOUND') throw error;
        item.status = 'MISSING_BLOB'; need('REFERENCE_BLOB_MISSING', `${label}: referenced image is not present in owned storage.`);
      }
      need('REFERENCE_USE_REVIEW_REQUIRED', `${label}: scope is ${scope}; film-use approval is not established by this draft.`);
    }
    uploadSheet.push(item);
  }
  for (const cellId of data.cellIds) {
    const cell = context.cells.find(value => value.id === cellId);
    addAsset({ role: cellId === data.initialFrameCellId ? 'CLIP_OPENING_CANDIDATE' : 'STORYBOARD_MOMENT', label: `${cell.id} · ${cell.description}`, hash: cell.imageHash, crop: cell.crop ?? null, scope: cell.scope ?? 'UNRESOLVED', cellId });
  }
  for (const characterId of data.characterIds) {
    const character = context.characters.find(value => value.id === characterId);
    const casting = context.casting.find(record => record.data.characterId === characterId);
    const selectedCasting=contextBundle?.preview.compiled.characterSelections.find(selection=>selection.record.data.characterId===characterId);
    const hashes = selectedCasting ? selectedCasting.referenceHashes : casting ? casting.data.referenceHashes : character.referenceImageHash ? [character.referenceImageHash] : [];
    if (!hashes.length) addAsset({ role: 'CHARACTER_REFERENCE', label: character.name, hash: null, characterId });
    for (const hash of hashes) addAsset({ role: 'CHARACTER_REFERENCE', label: character.name, hash, scope: casting?.data.useScope ?? character.useScope, characterId });
  }
  for (const input of mediaInputs) {
    uploadSheet.push(input);
    need('REFERENCE_USE_REVIEW_REQUIRED', `${input.label}: review permitted use of this original video or audio; including it creates no licence or approval.`);
    if (input.inMs !== null) need('EXCERPT_REQUIRED', `${input.label}: requested range ${input.inMs}–${input.outMs} ms is a planned excerpt. Exported bytes are the full original; materialize, hash and inspect the excerpt before any permitted upload.`);
    if (input.measuredDurationMs === null) need('MEDIA_DURATION_UNVERIFIED', `${input.label}: actual runtime and trim endpoints are unverified. Measure the original and confirm the selected media is at most 180 seconds, or a shorter provider limit.`);
    need('MEDIA_INPUT_PREFLIGHT_REQUIRED', `${input.label}: confirm the selected provider accepts this role, container, codec, dimensions and size. A local asset hash is not a provider media ID.`);
  }
  for (const question of context.project.continuityQuestions ?? []) need('CONTINUITY_REVIEW_REQUIRED', typeof question === 'string' ? question : canonical(question));
  const sourceText = context.scene.paragraphs.map(paragraph => paragraph.text).join('\n\n');
  const shots = data.shotIds.map(id => context.scene.shots.find(shot => shot.id === id));
  const shotDirections = shots.flatMap(shot => context.records.filter(record => record.kind === 'shot-direction' && record.data.sceneId === data.sceneId && record.data.shotId === shot.id).map(record => {
    validateShotDirectionIdentity(record.id, record.kind, record.data);
    validateShotDirection(record.data, context.project);
    return { recordRef: { id: record.id, version: record.version, sha256: record.sha256 }, direction: record.data,
      text: formatShotDirection(record.data), authority: 'ARTISTIC_PLANNING_ONLY', executable: false };
  }));
  const generatedPrompt = [
    'GENERATION PREPARATION — DRAFT CLIP DIRECTIONS', data.title,
    `SELECTED CLIP DIRECTIONS — ${shots.map(shot=>`${shot.label} (${shot.id})`).join(', ')}${data.settings.durationMs===null?'':` · planned duration ${data.settings.durationMs/1000} seconds`}.`,
    'Include only the selected shot and cell directions in this clip. Broader writing, rehearsal and screenplay context below may include later scene events; do not add those unselected actions, dialogue or shots, or extend this clip to cover them.',
    'Preserve the screenplay wording and action order. The shot descriptions below are a proposed visual plan and require source comparison; resolve contradictions before generation.',
    `Opening candidate: ${data.initialFrameCellId ?? 'MISSING — prepare the first selected shot opening'}.`,
    ...shots.map((shot, index) => `${index + 1}. ${shot.label}: ${shot.description}`),
    ...shotDirections.map(value => `SAVED ARTISTIC DIRECTION — ${value.direction.shotId}\nExact record: ${value.recordRef.id} / v${value.recordRef.version} / ${value.recordRef.sha256}\nPlanning choices only; these do not execute camera settings or grant production approval.\n${value.text}`),
    data.cellIds.length ? `Storyboard order: ${data.cellIds.join(' → ')}. Highlighted moments are intended checkpoints, not guaranteed model outcomes.` : 'Storyboard plan is missing.',
    ...data.cellIds.map(id => {
      const cell = context.cells.find(value => value.id === id);
      const override = context.scenePlan?.data.cellOverrides?.find(value => value.cellId === id);
      return `Planned cell ${id} (${override?.role ?? cell.role}): ${cell.description}${override?.note ? `\nRehearsal cell direction: ${override.note}` : ''}`;
    }),
    uploadSheet.some(item => item.crop) ? 'Reference crops are instructions only. Original images must be cropped and reviewed before upload.' : '',
    ...mediaInputs.map(input => `Planned ${input.role}: ${input.sha256}${input.inMs === null ? ' · whole original, runtime requires verification' : ` · requested excerpt ${input.inMs}–${input.outMs} ms; full original bytes retained`}. Confirm the eventual model supports this input role; do not assume it replaces a required starting image.`),
    contextBundle ? contextBundle.preview.contextText : writingIntent(workflowContext),
    context.scenePlan?.data.notes ? [
      'SCENE-WIDE REHEARSAL CONTEXT — reference only, outside this clip’s execution instructions',
      'These unchanged notes cover the whole scene and have no shot-level mapping. They may mention later events or other shots. Do not perform those events in this clip. The selected shot/cell directions above define its scope; review any conflict before generation.',
      'BEGIN UNCHANGED SCENE-WIDE NOTES', context.scenePlan.data.notes, 'END SCENE-WIDE NOTES',
    ].join('\n\n') : '',
    'EXACT SCENE SOURCE CONTEXT — full scene, not a clip coverage claim:', sourceText,
  ].filter(Boolean).join('\n\n');
  return { context, basisHash: context.basisHash, briefHash: sha256(canonical(data)), promptText: data.prompt.length ? data.prompt : generatedPrompt,
    promptOrigin: data.prompt.length ? 'OWNER_DRAFT_TEXT' : 'DETERMINISTIC_STARTER_DRAFT', sourceText, sourceScope, ...(shotDirections.length ? { shotDirections } : {}),
    uploadSheet, requirements, readiness: 'DRAFT_NEEDS_INPUTS', accountStatus: 'UNVERIFIED',...(selectedSource?{selectedSource}:{}),...(workflowContext?{workflowContext}:{}),...(contextBundle?{contextBundle}:{}),...(cameraProofs.length?{cameraProofs}:{}),...(dccReturns.length?{dccReturns}:{}) };
}

export function previewDreamina(store, data, sourceStatus = 'PENDING_OWNER_ADMISSION') {
  const { context, ...result } = prepare(store, data, sourceStatus); return result;
}

export async function exportDreamina(store, id, digest, sourceStatus = 'PENDING_OWNER_ADMISSION') {
  check(typeof id === 'string' && id.startsWith('generation-brief:') && /^[a-f0-9]{64}$/.test(digest ?? ''), 'INVALID_DREAMINA_EXPORT');
  const record = store.rawList('generation-brief').find(value => value.id === id);
  check(record, 'DREAMINA_BRIEF_NOT_FOUND', 404);
  check(record.sha256 === digest && sha256(canonical(record.data)) === digest, 'DREAMINA_REVISION_CONFLICT', 409);
  const prepared = prepare(store, record.data, sourceStatus);
  const zip = new JSZip(); const files = [];
  const fixedDate = new Date('2000-01-01T00:00:00.000Z');
  let totalBytes = 0;
  function add(filename, value) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    totalBytes += bytes.length; check(totalBytes <= 256 * 1024 * 1024, 'DREAMINA_PACKAGE_TOO_LARGE', 413);
    files.push({ path: filename, bytes: bytes.length, sha256: sha256(bytes) });
    zip.file(filename, bytes, { date: fixedDate, createFolders: false, unixPermissions: 0o600 });
  }
  add('brief.json', canonical(record.data));
  if (prepared.shotDirections?.length) add('shot-directions.json', canonical(prepared.shotDirections));
  add('prompt.txt', prepared.promptText);
  add('source/scene.txt', prepared.sourceText);
  add('source/scene-paragraphs.json', canonical(prepared.context.scene.paragraphs));
  if (prepared.selectedSource) {
    add('source/selected-passages.json', canonical(prepared.selectedSource));
    add('source/selected-passages.txt', prepared.selectedSource.passages.map(paragraph => paragraph.text).join('\n\n'));
  }
  add('storyboard/selected-cells.json',canonical(record.data.cellIds.map(id=>prepared.context.cells.find(cell=>cell.id===id))));
  const sourceBytes = store.blob(record.data.sourceHash).bytes;
  check(sha256(sourceBytes) === record.data.sourceHash, 'DREAMINA_SOURCE_CHANGED_DURING_EXPORT', 409);
  add('source/original.fdx', sourceBytes);
  add('upload-sheet.json', canonical(prepared.uploadSheet));
  if (Object.hasOwn(record.data, 'mediaInputs')) add('media-inputs.json', canonical({ schemaVersion: 1, scope: 'PLANNED_INPUTS_NOT_PROVIDER_UPLOADS',
    sourceHash: record.data.sourceHash, briefRef: { id: record.id, sha256: record.sha256 },
    inputs: prepared.uploadSheet.filter(item => Object.hasOwn(item, 'originalUnmodified')) }));
  add('requirements.json', canonical(prepared.requirements));
  if(prepared.workflowContext)add('workflow-context.json',canonical(prepared.workflowContext));
  if(prepared.contextBundle)exportContextEvidence(store,prepared.contextBundle,add);
  const loreRefs=[...new Map((prepared.workflowContext?.lineage.nodes??[]).flatMap(node=>node.record?.data.loreRefs??[]).map(ref=>[ref.id,ref])).values()];
  for(const ref of loreRefs){
    const lore=getLore(store,ref.id);check(lore.sha256===ref.sha256,'DREAMINA_LORE_REFERENCE_CHANGED',409);
    const folder='research-lore/'+lore.sha256;add(folder+'/record.json',canonical(lore));
    add(folder+'/original.'+(lore.data.documentType==='PDF'?'pdf':lore.data.original.mimeType==='image/png'?'png':'jpg'),store.blob(lore.data.original.sha256).bytes);
    if(lore.data.extraction)add(folder+'/extracted-pages.json',store.blob(lore.data.extraction.sha256).bytes);
    add(folder+'/intake-manifest.json',store.blob(lore.data.intakeManifest.sha256).bytes);
  }
  for(const record of prepared.cameraProofs??[]) {
    const folder='camera-proofs/'+record.sha256;
    add(folder+'/record.json',canonical(record));
    for(const artifact of record.data.artifacts.filter(artifact=>artifact.name.endsWith('.json'))) {
      const bytes=store.blob(artifact.sha256).bytes;
      check(bytes.length===artifact.bytes,'DREAMINA_CAMERA_ARTIFACT_CHANGED',409);
      add(folder+'/'+artifact.name,bytes);
    }
  }
  for (const evidence of prepared.dccReturns ?? []) {
    const folder = `dcc-returns/${evidence.receiptSha256}`;
    add(`${folder}/evidence.json`, canonical(evidence));
    for (const artifact of evidence.artifacts) {
      const info = store.blobInfo(artifact.sha256);
      check(info.byteLength === artifact.byteLength && info.mimeType === artifact.mimeType, 'DREAMINA_DCC_RETURN_ARTIFACT_CHANGED', 409);
      check(totalBytes + info.byteLength <= 256 * 1024 * 1024, 'DREAMINA_PACKAGE_TOO_LARGE', 413);
      const bytes = readFileSync(info.filename);
      check(bytes.length === artifact.byteLength && sha256(bytes) === artifact.sha256, 'DREAMINA_DCC_RETURN_ARTIFACT_CHANGED', 409);
      add(`${folder}/${artifact.name}`, bytes);
    }
  }
  add('README.txt', 'GENERATION PREPARATION — draft\n\nNo provider submission or generation has occurred. Do not upload source or references until permitted use, actual route settings and execution are approved.\n\n1. Compare proposed shot directions with source/scene.txt. It is full scene context, not selected-clip coverage. source/original.fdx retains every original byte.\n2. Resolve requirements.json. Check any required starting image against the first selected shot; a source video or later moment does not silently replace it.\n3. assets/original-* are unmodified owned originals. upload-sheet.json records role, scope and any crop coordinates. CROP_REQUIRED means manually crop and inspect before permitted upload; the exported original is not a prepared cropped opening. EXCERPT_REQUIRED means the requested inMs/outMs range has not been rendered: the complete original video or audio is included, never a claimed finished excerpt. media-inputs.json, when present, binds those inputs and available measurement evidence to this exact brief.\n4. Review prompt.txt and proposed brief.json settings for the chosen model or local workflow. CLIP preparation and media selections are capped at 180 seconds; legacy STANDARD drafts keep their 30-second cap. Actual model, mode, input-role and shorter duration limits still need verification. An unmeasured whole original is not proof of a valid duration. Route selection creates no connection, provider media ID or execution authority.\n5. After an approved generation, retain the returned original media and provider receipt. This package does not assert take provenance, QC or owner selection.\n');
  for (const item of prepared.uploadSheet) {
    if (!item.path || files.some(file => file.path === item.path)) continue;
    const info = store.blobInfo(item.sha256);
    check(totalBytes + info.byteLength <= 256 * 1024 * 1024, 'DREAMINA_PACKAGE_TOO_LARGE', 413);
    const bytes = readFileSync(info.filename);
    check(bytes.length === item.byteLength && sha256(bytes) === item.sha256, Object.hasOwn(item, 'originalUnmodified') ? 'GENERATION_MEDIA_CHANGED_DURING_EXPORT' : 'DREAMINA_IMAGE_CHANGED_DURING_EXPORT', 409);
    add(item.path, bytes);
  }
  const manifest = { schemaVersion: 1, format: 'dreamina-preparation/v1', status: 'DRAFT_NEEDS_INPUTS',
    sourceHash: record.data.sourceHash, sourceScope, accountStatus: 'UNVERIFIED', sourceStatus,
    record: { id: record.id, version: record.version, sha256: record.sha256 }, basisHash: prepared.basisHash,
    promptHash: sha256(prepared.promptText), files: files.sort((a,b) => a.path.localeCompare(b.path, 'en')) };
  // Manifest lists every other file; its own checksum is returned in HTTP headers.
  zip.file('manifest.json', canonical(manifest), { date: fixedDate, createFolders: false, unixPermissions: 0o600 });
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE', platform: 'UNIX' });
  // ZIP construction yields the event loop. Reject a newer record/dependency
  // that arrived while preparing this snapshot rather than returning a stale handoff.
  const head = store.rawList('generation-brief').find(value => value.id === id);
  check(head?.sha256 === digest && head.version === record.version && sha256(canonical(head.data)) === digest, 'DREAMINA_REVISION_CONFLICT', 409);
  check(snapshot(store, record.data.sceneId).basisHash === prepared.basisHash, 'STALE_DREAMINA_BASIS', 409);
  linkedWorkflow(store,record.data);
  generationMediaInputs(store, record.data, store.rawList());
  const finalContext=contextBundleForBrief(store,record.data);
  if(prepared.contextBundle)check(finalContext?.preview.contextHash===prepared.contextBundle.preview.contextHash,'CONTEXT_CHANGED_DURING_EXPORT',409);
  for(const ref of loreRefs)check(getLore(store,ref.id).sha256===ref.sha256,'DREAMINA_LORE_REFERENCE_CHANGED',409);
  for(const proof of prepared.cameraProofs??[]) {
    verifyStoredCameraObservation(store,proof.data);
    if(proof.data.handoffRef)check(resolveUnifiedWorkflow(store,{sceneId:record.data.sceneId,handoffRef:proof.data.handoffRef}).readiness==='READY_FOR_PLANNING','STALE_DREAMINA_CAMERA_HANDOFF',409);
  }
  check(canonical(selectedDccReturns(store, record.data, store.resolvedProject())) === canonical(prepared.dccReturns ?? []), 'DREAMINA_DCC_RETURN_CHANGED_DURING_EXPORT', 409);
  return { bytes, manifest, manifestHash: sha256(canonical(manifest)), sha256: sha256(bytes), filename: `dreamina-${record.data.sceneId}-v${record.version}.zip` };
}
