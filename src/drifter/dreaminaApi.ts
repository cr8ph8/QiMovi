import { canonicalJson, hashCanonical } from './canonical';
import { WorkspaceError } from './api';
import { validateRecord } from './validation';
import { verifyWorkflowContext, type WorkflowContext } from './workflowApi';
import { validateContextBundlePreview } from './contextBundleApi';
import { verifySourceRefs } from './sceneWorkbenchModel';
import type { CameraObservation, CastingDraft, Character, ContextBundle, ContextBundlePreview, GenerationBrief, ProductionHandoff, Project, Scene, StoryCell, WorkspaceRecord } from './types';

export type SavedBrief = WorkspaceRecord & { briefState: { status: 'CURRENT_BASIS' | 'NEEDS_REVIEW' } };
export interface DreaminaContext {
  sourceHash: string; sceneId: string; basisHash: string; scene: Scene; cells: StoryCell[];
  characters: Character[]; casting: WorkspaceRecord[]; scenePlan: WorkspaceRecord | null; savedBriefs: SavedBrief[];
  accountStatus: 'UNVERIFIED'; sourceStatus: 'PENDING_OWNER_ADMISSION' | 'ADMITTED';
}
export interface DreaminaPreview {
  basisHash: string; briefHash: string; promptText: string; sourceText: string; sourceScope: 'ENTIRE_SCENE_CONTEXT_NOT_CLIP_COVERAGE';
  uploadSheet: { role: string; label: string; sha256: string | null; path: string | null; mimeType: string | null; byteLength: number | null; crop: StoryCell['crop']; status: string; scope?: string; characterId?: string | null; cellId?: string | null; inMs?: number | null; outMs?: number | null; originalUnmodified?: true; measurementRef?: { id: string; sha256: string } | null; measuredDurationMs?: number | null }[];
  requirements: { code: string; message: string }[]; readiness: 'DRAFT_NEEDS_INPUTS'; accountStatus: 'UNVERIFIED';
  workflowContext?: WorkflowContext;
  cameraProofs?: WorkspaceRecord[];
  dccReturns?: DccReturnGenerationEvidence[];
  contextBundle?: { record: WorkspaceRecord; preview: ContextBundlePreview };
  selectedSource?: { scope: 'SELECTED_SOURCE_PASSAGES_NOT_VERIFIED_COVERAGE'; sourceHash: string; sceneId: string; passages: { paragraphId: string; textHash: string; type: string; text: string }[] };
}
export interface DccReturnGenerationEvidence {
  receiptSha256: string; kitFilesSha256: string;
  origin: { projectId: string; sourceHash: string; sceneId: string; shotId: string; target: 'BLENDER' | 'UNITY'; basisSha256: string; exchangeSha256: string; planFileSha256: string; exchangeFileSha256: string };
  cellIds: string[];
  frames: { cellId: string; frameId: string; originReturnRole: 'OPENING' | 'MOMENT' | 'ENDING'; imageHash: string; widthPixels: number; heightPixels: number; frame: number; storyboardRole: StoryCell['role']; actionRefs: string[]; plannedTimestampMs: number | null }[];
  scope: 'INTERNAL_REHEARSAL_CANDIDATE'; rightsStatus: 'UNKNOWN'; approvalGranted: false;
  artifacts: { name: string; sha256: string; byteLength: number; mimeType: string }[];
}
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const string = (value: unknown): value is string => typeof value === 'string';
function requireValue(value: unknown): asserts value { if (!value) throw new Error('Generation preparation did not match this scene. Refresh its saved inputs before continuing.'); }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: unknown, keys: string) => object(value) && Object.keys(value).sort().join(',') === keys;
const safeFile = (value: unknown) => string(value) && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value) && !value.includes('..');
function verifyDccReturns(data: GenerationBrief, context: DreaminaContext, preview: DreaminaPreview, project?: Project) {
  const cells = data.cellIds.map(id => context.cells.find(cell => cell.id === id)).filter((cell): cell is StoryCell => Boolean(cell?.originDccReturnRef));
  if (!cells.length) { requireValue(preview.dccReturns === undefined); return; }
  requireValue(project && project.sourceHash === data.sourceHash && context.sourceHash === data.sourceHash && context.sceneId === data.sceneId);
  const evidence = preview.dccReturns;
  requireValue(Array.isArray(evidence) && evidence.length > 0 && evidence.length <= cells.length
    && new Set(evidence.map(item => item.receiptSha256)).size === evidence.length);
  const expectedGroups = new Map<string, StoryCell[]>();
  for (const cell of cells) {
    const ref = cell.originDccReturnRef!;
    requireValue(!cell.originCameraRef && exactKeys(ref, 'frameId,kitFilesSha256,receiptSha256') && digest(ref.receiptSha256) && digest(ref.kitFilesSha256) && safeFile(ref.frameId));
    if (!expectedGroups.has(ref.receiptSha256)) expectedGroups.set(ref.receiptSha256, []);
    expectedGroups.get(ref.receiptSha256)!.push(cell);
  }
  requireValue(canonicalJson(evidence.map(item => item.receiptSha256)) === canonicalJson([...expectedGroups.keys()]));
  for (const item of evidence) {
    requireValue(exactKeys(item, 'approvalGranted,artifacts,cellIds,frames,kitFilesSha256,origin,receiptSha256,rightsStatus,scope'));
    const selected = expectedGroups.get(item.receiptSha256)!;
    requireValue(digest(item.receiptSha256) && digest(item.kitFilesSha256) && selected.every(cell => cell.originDccReturnRef!.kitFilesSha256 === item.kitFilesSha256)
      && item.scope === 'INTERNAL_REHEARSAL_CANDIDATE' && item.rightsStatus === 'UNKNOWN' && item.approvalGranted === false);
    const origin = item.origin;
    requireValue(exactKeys(origin, 'basisSha256,exchangeFileSha256,exchangeSha256,planFileSha256,projectId,sceneId,shotId,sourceHash,target')
      && origin.projectId === project.id && origin.sourceHash === data.sourceHash && origin.sceneId === data.sceneId && data.shotIds.includes(origin.shotId)
      && ['BLENDER', 'UNITY'].includes(origin.target) && [origin.basisSha256, origin.exchangeSha256, origin.planFileSha256, origin.exchangeFileSha256].every(digest));
    requireValue(Array.isArray(item.cellIds) && canonicalJson(item.cellIds) === canonicalJson(selected.map(cell => cell.id))
      && Array.isArray(item.frames) && item.frames.length === selected.length && new Set(item.frames.map(frame => frame.frameId)).size === item.frames.length);
    requireValue(Array.isArray(item.artifacts) && item.artifacts.length >= 6 && item.artifacts.length <= 24
      && new Set(item.artifacts.map(artifact => artifact.name)).size === item.artifacts.length);
    for (const artifact of item.artifacts) requireValue(exactKeys(artifact, 'byteLength,mimeType,name,sha256') && safeFile(artifact.name) && digest(artifact.sha256)
      && Number.isSafeInteger(artifact.byteLength) && artifact.byteLength > 0 && ['application/json', 'application/octet-stream', 'image/png'].includes(artifact.mimeType));
    requireValue(item.artifacts.reduce((sum, artifact) => sum + artifact.byteLength, 0) <= 64 * 1024 * 1024);
    for (const [name, sha256] of [['stage-return.json', item.receiptSha256], ['kit-files.json', item.kitFilesSha256], ['stage-plan.json', origin.planFileSha256], ['camera-exchange.json', origin.exchangeFileSha256]]) {
      requireValue(item.artifacts.some(artifact => artifact.name === name && artifact.sha256 === sha256 && artifact.mimeType === 'application/json'));
    }
    requireValue(item.artifacts.some(artifact => artifact.name === 'observation.json' && artifact.mimeType === 'application/json')
      && item.artifacts.some(artifact => artifact.name.endsWith(origin.target === 'BLENDER' ? '.blend' : '.unity') && artifact.mimeType === 'application/octet-stream'));
    for (let index = 0; index < selected.length; index++) {
      const cell = selected[index], frame = item.frames[index], ref = cell.originDccReturnRef!;
      const expectedRole = ref.frameId === 'opening' ? 'OPENING' : ref.frameId === 'ending' ? 'ENDING' : 'MOMENT';
      requireValue(exactKeys(frame, 'actionRefs,cellId,frame,frameId,heightPixels,imageHash,originReturnRole,plannedTimestampMs,storyboardRole,widthPixels')
        && frame.cellId === cell.id && frame.frameId === ref.frameId && frame.originReturnRole === expectedRole && cell.shotId === origin.shotId
        && frame.imageHash === cell.imageHash && frame.widthPixels === cell.pixelWidth && frame.heightPixels === cell.pixelHeight && frame.storyboardRole === cell.role
        && Number.isSafeInteger(frame.widthPixels) && frame.widthPixels > 0 && frame.widthPixels <= 8192 && Number.isSafeInteger(frame.heightPixels) && frame.heightPixels > 0 && frame.heightPixels <= 8192
        && Number.isSafeInteger(frame.frame) && frame.frame >= 0 && Number.isSafeInteger(frame.plannedTimestampMs ?? 0) && frame.plannedTimestampMs === (cell.plannedTimestampMs ?? null)
        && Array.isArray(frame.actionRefs) && canonicalJson(frame.actionRefs) === canonicalJson(cell.actionRefs ?? []) && cell.crop == null);
      requireValue(item.artifacts.some(artifact => artifact.sha256 === frame.imageHash && artifact.mimeType === 'image/png'));
      const upload = preview.uploadSheet.filter(row => row.cellId === cell.id);
      requireValue(upload.length === 1 && upload[0].sha256 === frame.imageHash && upload[0].mimeType === 'image/png' && upload[0].crop === null
        && upload[0].role === (cell.id === data.initialFrameCellId ? 'CLIP_OPENING_CANDIDATE' : 'STORYBOARD_MOMENT'));
      if (cell.id === data.initialFrameCellId) requireValue(frame.originReturnRole === 'OPENING' && cell.shotId === data.shotIds[0]);
    }
  }
  requireValue(preview.requirements.some(item => item.code === 'DCC_RETURN_REFERENCE_ONLY'));
}
const mediaRoles = ['SOURCE_VIDEO', 'MOTION_REFERENCE', 'AUDIO_REFERENCE'];
const mediaExtensions: Record<string, string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/flac': 'flac', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' };
function verifyMediaUploads(data: GenerationBrief, preview: DreaminaPreview) {
  const inputs = data.mediaInputs ?? [];
  const mediaRows = preview.uploadSheet.filter(row => mediaRoles.includes(row.role));
  requireValue(Array.isArray(inputs) && inputs.length <= 64 && mediaRows.length === inputs.length);
  // Video/audio originals are appended, in the brief's order, after images.
  requireValue(canonicalJson(preview.uploadSheet.slice(preview.uploadSheet.length - mediaRows.length)) === canonicalJson(mediaRows));
  const mediaKeys = 'byteLength,cellId,characterId,crop,inMs,label,measuredDurationMs,measurementRef,mimeType,originalUnmodified,outMs,path,role,scope,sha256,status';
  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index], row = mediaRows[index];
    requireValue(digest(input.sha256) && mediaRoles.includes(input.role) && (input.inMs === null && input.outMs === null || Number.isSafeInteger(input.inMs) && Number.isSafeInteger(input.outMs) && Number(input.inMs) >= 0 && Number(input.outMs) > Number(input.inMs) && Number(input.outMs) - Number(input.inMs) <= 180000));
    requireValue(Object.keys(row).sort().join(',') === mediaKeys && row.role === input.role && row.sha256 === input.sha256 && row.inMs === input.inMs && row.outMs === input.outMs);
    requireValue(row.label === `${input.role.replace(/_/g, ' ')} · ${input.sha256.slice(0, 12)}` && row.originalUnmodified === true && row.crop === null && row.scope === 'USE_REVIEW_REQUIRED' && row.cellId === null && row.characterId === null);
    requireValue(row.mimeType && mediaExtensions[row.mimeType] && row.mimeType.startsWith(input.role === 'AUDIO_REFERENCE' ? 'audio/' : 'video/') && row.path === `assets/original-${input.sha256}.${mediaExtensions[row.mimeType]}` && Number.isSafeInteger(row.byteLength) && Number(row.byteLength) > 0);
    requireValue(row.status === (input.inMs === null ? 'ORIGINAL_NEEDS_REVIEW' : 'EXCERPT_REQUIRED'));
    if (row.measurementRef === null) requireValue(row.measuredDurationMs === null);
    else requireValue(row.measurementRef && Object.keys(row.measurementRef).sort().join(',') === 'id,sha256' && digest(row.measurementRef.sha256) && row.measurementRef.id === `measured-media-take:${row.measurementRef.sha256}` && Number.isSafeInteger(row.measuredDurationMs) && Number(row.measuredDurationMs) > 0);
    if (row.measuredDurationMs !== null) requireValue(input.inMs === null ? Number(row.measuredDurationMs) <= 180000 : Number(input.outMs) <= Number(row.measuredDurationMs));
    for (const code of ['REFERENCE_USE_REVIEW_REQUIRED', 'MEDIA_INPUT_PREFLIGHT_REQUIRED', ...(input.inMs === null ? [] : ['EXCERPT_REQUIRED']), ...(row.measuredDurationMs === null ? ['MEDIA_DURATION_UNVERIFIED'] : [])]) requireValue(preview.requirements.some(item => item.code === code));
  }
  // An image row cannot smuggle a claim of trimmed or measured media.
  for (const row of preview.uploadSheet.filter(row => !mediaRoles.includes(row.role))) requireValue(!['inMs', 'outMs', 'originalUnmodified', 'measurementRef', 'measuredDurationMs'].some(key => Object.prototype.hasOwnProperty.call(row, key)));
}
async function json(url: string, body?: GenerationBrief) {
  const response = await fetch(url, { credentials: 'same-origin', redirect: 'error', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: canonicalJson(body) } : {}) });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new WorkspaceError(string(value?.error) ? value.error : 'The local preparation request was not confirmed.', response.status);
  return value;
}
export async function getDreaminaContext(project: Project, scene: Scene): Promise<DreaminaContext> {
  const value = await json(`/api/dreamina/context?sceneId=${encodeURIComponent(scene.id)}`);
  requireValue(value?.sourceHash === project.sourceHash && value.sceneId === scene.id && digest(value.basisHash) && value.accountStatus === 'UNVERIFIED' && ['ADMITTED', 'PENDING_OWNER_ADMISSION'].includes(value.sourceStatus));
  requireValue(value.scene?.id === scene.id && canonicalJson(value.scene.paragraphs) === canonicalJson(scene.paragraphs) && canonicalJson(value.scene.shots) === canonicalJson(scene.shots));
  requireValue(Array.isArray(value.cells) && value.cells.every((cell: StoryCell) => string(cell.id) && cell.sceneId === scene.id && scene.shots.some(shot => shot.id === cell.shotId) && ['START', 'MOMENT', 'END'].includes(cell.role) && string(cell.description) && (cell.imageHash == null || digest(cell.imageHash))));
  requireValue(new Set(value.cells.map((cell: StoryCell) => cell.id)).size === value.cells.length);
  requireValue(Array.isArray(value.characters) && value.characters.every((character: Character) => project.characters.some(item => item.id === character.id) && string(character.name) && string(character.description) && (character.referenceImageHash == null || digest(character.referenceImageHash))));
  requireValue(Array.isArray(value.casting) && Array.isArray(value.savedBriefs));
  const currentProject = { ...project, cells: [...project.cells.filter(cell => cell.sceneId !== scene.id), ...value.cells] };
  for (const record of value.casting) { await validateRecord(record, currentProject); requireValue(record.kind === 'casting-draft' && (record.data as { sourceHash: string }).sourceHash === project.sourceHash); }
  if (value.scenePlan !== null) { await validateRecord(value.scenePlan, currentProject); requireValue(value.scenePlan.kind === 'scene-plan' && value.scenePlan.data.sceneId === scene.id && value.scenePlan.data.sourceHash === project.sourceHash); }
  for (const item of value.savedBriefs) {
    const { briefState, ...record } = item;
    // Historical briefs remain readable if a referenced cell changed later.
    await validateRecord(record);
    requireValue(record.kind === 'generation-brief' && record.data.sourceHash === project.sourceHash && record.data.sceneId === scene.id && ['CURRENT_BASIS', 'NEEDS_REVIEW'].includes(briefState?.status));
    if (record.data.sourcePassages) await verifySourceRefs(scene, record.data.sourcePassages);
  }
  return value;
}
export async function previewDreamina(data: GenerationBrief, context: DreaminaContext, project?: Project): Promise<DreaminaPreview> {
  data = structuredClone(data); context = structuredClone(context); project = project && structuredClone(project);
  const value = await json('/api/dreamina/preview', data);
  requireValue(value?.basisHash === data.basisHash && value.basisHash === context.basisHash && value.briefHash === await hashCanonical(data) && string(value.promptText) && value.sourceText === context.scene.paragraphs.map(paragraph => paragraph.text).join('\n\n') && value.sourceScope === 'ENTIRE_SCENE_CONTEXT_NOT_CLIP_COVERAGE');
  requireValue(data.prompt === '' || value.promptText === data.prompt);
  if (data.sourcePassages) {
    await verifySourceRefs(context.scene, data.sourcePassages);
    const expected = { scope: 'SELECTED_SOURCE_PASSAGES_NOT_VERIFIED_COVERAGE', sourceHash: data.sourceHash, sceneId: data.sceneId, passages: data.sourcePassages.map(ref => { const paragraph = context.scene.paragraphs.find(item => item.id === ref.paragraphId)!; return { ...ref, type: paragraph.type, text: paragraph.text }; }) };
    requireValue(canonicalJson(value.selectedSource) === canonicalJson(expected));
  } else requireValue(value.selectedSource === undefined);
  requireValue(value.readiness === 'DRAFT_NEEDS_INPUTS' && value.accountStatus === 'UNVERIFIED' && Array.isArray(value.requirements) && value.requirements.every((item: { code: unknown; message: unknown }) => string(item.code) && string(item.message)));
  requireValue(Array.isArray(value.uploadSheet) && value.uploadSheet.every((item: DreaminaPreview['uploadSheet'][number]) => string(item.role) && string(item.label) && string(item.status) && (item.sha256 === null || digest(item.sha256)) && (item.path === null || (string(item.path) && !item.path.startsWith('/') && !item.path.split('/').includes('..'))) && (item.mimeType === null || string(item.mimeType)) && (item.byteLength === null || (Number.isSafeInteger(item.byteLength) && item.byteLength > 0))));
  verifyMediaUploads(data, value);
  verifyDccReturns(data, context, value, project);
  if (data.handoffRef) {
    requireValue(project && project.sourceHash === data.sourceHash && context.sourceHash === project.sourceHash && context.sceneId === data.sceneId);
    const workflow = await verifyWorkflowContext(value.workflowContext, project, data.sceneId, { handoffRef: data.handoffRef });
    requireValue(workflow.status === 'CURRENT' && workflow.readiness === 'READY_FOR_PLANNING' && data.shotIds.every(id => (workflow.handoff.record!.data as ProductionHandoff).shotIds.includes(id)));
  } else requireValue(value.workflowContext === undefined);
  if (data.contextBundleRef) {
    requireValue(project && project.sourceHash === data.sourceHash && context.sourceHash === data.sourceHash && context.sceneId === data.sceneId && value.contextBundle && Object.keys(value.contextBundle).sort().join(',') === 'preview,record');
    const selected = await validateRecord(value.contextBundle.record, project), bundle = selected.data as ContextBundle;
    requireValue(selected.kind === 'context-bundle' && selected.id === data.contextBundleRef.id && selected.sha256 === data.contextBundleRef.sha256 && bundle.sceneId === data.sceneId && canonicalJson(bundle.shotIds) === canonicalJson(data.shotIds));
    const preview = await validateContextBundlePreview(value.contextBundle.preview, project, bundle);
    for (const entry of preview.compiled.characterSelections) {
      const characterId = (entry.record.data as CastingDraft).characterId;
      requireValue(data.characterIds.includes(characterId));
    }
    const expectedUploads: { role: string; cellId: string | null; characterId: string | null; sha256: string | null }[] = data.cellIds.map(id => {
      const cell = context.cells.find(value => value.id === id); requireValue(cell);
      return { role: id === data.initialFrameCellId ? 'CLIP_OPENING_CANDIDATE' : 'STORYBOARD_MOMENT', cellId: id, characterId: null, sha256: cell.imageHash ?? null };
    });
    for (const characterId of data.characterIds) {
      const character = context.characters.find(value => value.id === characterId); requireValue(character);
      const selected = preview.compiled.characterSelections.find(value => (value.record.data as CastingDraft).characterId === characterId);
      const cast = context.casting.find(value => (value.data as CastingDraft).characterId === characterId)?.data as CastingDraft | undefined;
      const hashes = selected ? selected.referenceHashes : cast ? cast.referenceHashes : character.referenceImageHash ? [character.referenceImageHash] : [];
      for (const sha256 of hashes.length ? hashes : [null]) expectedUploads.push({ role: 'CHARACTER_REFERENCE', cellId: null, characterId, sha256 });
    }
    for (const input of data.mediaInputs ?? []) expectedUploads.push({ role: input.role, cellId: null, characterId: null, sha256: input.sha256 });
    requireValue(canonicalJson(value.uploadSheet.map((item: DreaminaPreview['uploadSheet'][number]) => ({ role: item.role, cellId: item.cellId ?? null, characterId: item.characterId ?? null, sha256: item.sha256 }))) === canonicalJson(expectedUploads));
  } else requireValue(value.contextBundle === undefined);
  const cameraCells = context.cells.filter(cell => data.cellIds.includes(cell.id) && cell.originCameraRef);
  const proofs = value.cameraProofs ?? [];
  requireValue(Array.isArray(proofs) && proofs.length <= data.cellIds.length && new Set(proofs.map((record: WorkspaceRecord) => record.id + ':' + record.sha256)).size === proofs.length);
  if (cameraCells.length || proofs.length) {
    requireValue(project && project.sourceHash === data.sourceHash);
    for (const record of proofs as WorkspaceRecord[]) {
      await validateRecord(record, project);
      requireValue(record.kind === 'camera-observation' && (record.data as CameraObservation).sourceHash === data.sourceHash && (record.data as CameraObservation).sceneId === data.sceneId && cameraCells.some(cell => cell.originCameraRef!.id === record.id && cell.originCameraRef!.sha256 === record.sha256));
      const observation = record.data as CameraObservation;
      if (data.handoffRef && observation.handoffRef) requireValue(canonicalJson(data.handoffRef) === canonicalJson(observation.handoffRef));
    }
    for (const cell of cameraCells) {
      const record = proofs.find((record: WorkspaceRecord) => record.id === cell.originCameraRef!.id && record.sha256 === cell.originCameraRef!.sha256);
      const frame = (record?.data as CameraObservation | undefined)?.frames.find(frame => frame.id === cell.originCameraRef!.frameId);
      requireValue(frame && frame.imageHash === cell.imageHash && frame.shotId === cell.shotId && frame.role === cell.role && frame.width === cell.pixelWidth && frame.height === cell.pixelHeight && canonicalJson(frame.actionRefs) === canonicalJson(cell.actionRefs ?? []));
    }
  }
  return value;
}
export async function downloadDreamina(record: WorkspaceRecord): Promise<Blob> {
  const response = await fetch(`/api/dreamina/export?id=${encodeURIComponent(record.id)}&sha256=${encodeURIComponent(record.sha256)}`, { credentials: 'same-origin', redirect: 'error' });
  if (!response.ok) {
    const value = await response.json().catch(() => null);
    throw new WorkspaceError(string(value?.error) ? value.error : 'The saved brief could not be exported.', response.status);
  }
  requireValue(response.headers.get('Content-Type')?.split(';')[0] === 'application/zip');
  requireValue(response.headers.get('X-Brief-Id') === record.id && response.headers.get('X-Brief-Sha256') === record.sha256 && digest(response.headers.get('X-Package-Sha256')) && digest(response.headers.get('X-Manifest-Sha256')));
  const blob = await response.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  requireValue(bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04);
  const packageHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  requireValue(packageHash === response.headers.get('X-Package-Sha256'));
  return blob;
}
