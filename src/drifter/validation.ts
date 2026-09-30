import { validateProductionAttachment, attachedProductionProject, productionAttachmentId } from '../../local/contracts/production-attachment.mjs';
import { validateShotDirection, validateShotDirectionIdentity } from '../../local/contracts/shot-direction.mjs';
import { validateMovieSequence, validateMovieSequenceIdentity } from './movieSequenceModel';
import { validateUsageObservation, validateUsageIdentity } from '../../local/contracts/usage-accounting.mjs';
import { validateStudioOperation, validateStudioOperationIdentity } from '../../local/contracts/studio-operation.mjs';
import { validateStudioMedia, validateStudioMediaIdentity } from '../../local/contracts/studio-media.mjs';
import { validateCreativeProject, projectOwnedContext, CREATIVE_PROJECT_RECORD_KINDS } from '../../local/contracts/creative-project.mjs';
import { validateCreativeScreenplayDraft } from '../../local/contracts/creative-screenplay.mjs';
import { validateWritingProductionPlan } from '../../local/contracts/writing-production.mjs';
import { validateProductionBudget, validateBudgetIdentity } from '../../local/contracts/production-budget.mjs';
import { validateWritingSceneMap } from '../../local/contracts/writing-scene-map.mjs';
import { validateStudioGeneration, validateStudioGenerationIdentity } from '../../local/contracts/studio-generation.mjs';
import { validateStudioReference, validateStudioReferenceIdentity } from '../../local/contracts/studio-reference.mjs';
import { validateAssetMarketProfile, validateAssetMarketProfileIdentity } from '../../local/contracts/asset-market-profile.mjs';
import { validateTokenPreparation, validateTokenPreparationIdentity } from '../../local/contracts/asset-token-preparation.mjs';
import { validateParticipation, validateParticipationIdentity } from '../../local/contracts/project-participation.mjs';
import { validateComicPackage, validateComicPackageIdentity } from '../../local/contracts/comic-package.mjs';
import { validateStoryboardPlanning, validateStoryboardPlanningIdentity } from '../../local/contracts/storyboard-planning.mjs';
import { validateFrameExtraction } from '../../local/contracts/storyboard-frame.mjs';
import { validateProjectDirection, validateProjectDirectionId } from '../../local/contracts/project-direction.mjs';
import { validateModelAssistance } from '../../local/contracts/model-assistance.mjs';
import { UNIVERSE_KINDS, validateUniverseRecord } from '../../local/contracts/universe.mjs';
import { validateNodeWorkflow } from '../../local/contracts/node-workflow.mjs';
import { validateProjectAsset, validateAssetCuration } from '../../local/contracts/project-library.mjs';
import { validateLoreSource } from '../../local/contracts/lore.mjs';
import { validateContextBundle, validateContextBundleId } from '../../local/contracts/context-bundle.mjs';
import { validateCameraObservation, validateCameraOriginRef } from '../../local/contracts/camera-observation.mjs';
import { validateDccReturnOriginRef } from '../../local/contracts/dcc-return-origin.mjs';
import { MEDIA_RECORD_KINDS, validateMediaRecord } from '../../local/contracts/media-takes.mjs';
import { hashCanonical } from './canonical';
import { AUTHORING_KINDS, validateAuthoringRecord, validateScreenplayMetadata } from '../../local/contracts/authoring.mjs';
import { validateProductionHandoff, validateWorkflowRef } from '../../local/contracts/production-handoff.mjs';
import { validateCoverageDraft } from '../../local/contracts/source-coverage.mjs';
import { validateProductionElements } from '../../local/contracts/script-breakdown.mjs';
import { verifySourceRefs } from './sceneWorkbenchModel';
import type { Bootstrap, CreativeBootstrap, Project, WorkspaceBootstrap, WorkspaceProject, WorkspaceRecord } from './types';

const kinds = ['movie-sequence', 'project-direction', 'model-assistance', 'asset-curation', 'project-asset', 'node-workflow', 'context-bundle', 'lore-source', 'scene-plan', 'storyboard-cell', 'casting-draft', 'review-observation', 'review-resolution', 'coverage-draft', 'media-take', 'document-draft', 'screenplay-draft', 'generation-brief', 'production-handoff', 'camera-observation', ...AUTHORING_KINDS, ...MEDIA_RECORD_KINDS, ...UNIVERSE_KINDS];
kinds.push('shot-direction', 'production-budget', 'usage-observation', 'studio-operation', 'studio-media', 'studio-generation', 'studio-reference', 'asset-market-profile', 'comic-package', 'storyboard-frame-extraction', 'shot-keyframes', 'comic-draft');
const roles = ['START', 'MOMENT', 'END'];
kinds.push('project-participation', 'asset-token-preparation');
kinds.push('writing-production-plan', 'production-attachment');
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 20000) => typeof value === 'string' && value.length > 0 && value.length <= max;
const note = (value: unknown, max = 20000) => typeof value === 'string' && value.length <= max;
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const unique = (values: unknown[]) => new Set(values).size === values.length;
function check(condition: unknown): asserts condition { if (!condition) throw new Error('The local workspace returned an invalid record. Reload before continuing.'); }
function shape(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  check(object(value) && required.every(key => Object.prototype.hasOwnProperty.call(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key)));
}
function hashes(value: unknown) { return Array.isArray(value) && unique(value) && value.every(digest); }
function strings(value: unknown) { return Array.isArray(value) && unique(value) && value.every(item => text(item, 160)); }

function validateData(kind: string, value: unknown, workspace?: WorkspaceProject) {
  if (kind === 'asset-token-preparation') { validateTokenPreparation(value, workspace); return; }
  if (kind === 'project-participation') { validateParticipation(value, workspace); return; }
  if (kind === 'production-attachment') { validateProductionAttachment(value, workspace); return; }
  if (kind === 'writing-production-plan') { validateWritingProductionPlan(value, workspace); return; }
  if (kind === 'production-budget') { validateProductionBudget(value, workspace); return; }
  if (kind === 'project-direction') { validateProjectDirection(value, workspace); return; }
  if (kind === 'usage-observation') { validateUsageObservation(value, workspace); return; }
  if (kind === 'storyboard-frame-extraction') { validateFrameExtraction(value, workspace); return; }
  if (kind === 'comic-package') { validateComicPackage(value, workspace); return; }
  if (kind === 'asset-market-profile') { validateAssetMarketProfile(value, workspace); return; }
  if (kind === 'studio-reference') { validateStudioReference(value, workspace); return; }
  if (kind === 'studio-generation') { validateStudioGeneration(value, workspace); return; }
  if (kind === 'studio-operation') { validateStudioOperation(value, workspace); return; }
  if (kind === 'studio-media') { validateStudioMedia(value, workspace); return; }
  if (kind === 'screenplay-draft' && object(value) && value.sourceHash === null) { validateCreativeScreenplayDraft(value, workspace); return; }
  if (AUTHORING_KINDS.includes(kind) && object(value) && value.sourceHash === null) { validateAuthoringRecord(kind, value, workspace); return; }
  if (kind === 'project-asset') { validateProjectAsset(value, workspace); return; }
  if (kind === 'asset-curation') { validateAssetCuration(value, workspace); return; }
  if (UNIVERSE_KINDS.includes(kind)) { validateUniverseRecord(kind, value, workspace); return; }
  if (workspace?.sourceHash === null) check(false);
  const project = workspace as Project | undefined;
  // Saved visual plans remain readable when a referenced frame changes. Only
  // new writes require current references; the UI exposes stale planning bases.
  if (kind === 'shot-keyframes') { validateStoryboardPlanning(kind, value, project, { references: false }); return; }
  if (kind === 'comic-draft') { validateStoryboardPlanning(kind, value, project, { references: false }); return; }
  check(object(value) && digest(value.sourceHash));
  if (UNIVERSE_KINDS.includes(kind)) {
    validateUniverseRecord(kind, value, project);
  } else if (kind === 'model-assistance') {
    validateModelAssistance(value, project);
  } else if (MEDIA_RECORD_KINDS.includes(kind)) {
    validateMediaRecord(kind, value, project);
  } else if (kind === 'project-asset') {
    validateProjectAsset(value, project);
  } else if (kind === 'asset-curation') {
    validateAssetCuration(value, project);
  } else if (kind === 'node-workflow') {
    validateNodeWorkflow(value, project);
  } else if (kind === 'context-bundle') {
    validateContextBundle(value, project);
  } else if (kind === 'lore-source') {
    validateLoreSource(value,project);
  } else if (kind === 'camera-observation') {
    validateCameraObservation(value, project);
  } else if (kind === 'production-handoff') {
    validateProductionHandoff(value, project);
  } else if (AUTHORING_KINDS.includes(kind)) {
    validateAuthoringRecord(kind, value, project);
  } else if (kind === 'screenplay-draft') {
    shape(value, ['sourceHash', 'title', 'format', 'body'], ['sceneId', 'genre', 'projectFormat', 'targetPages', 'inputRefs', 'sceneMap']);
    check(text(value.title, 200) && String(value.title).trim().length > 0 && !/[\r\n\0]/.test(String(value.title)) && value.format === 'FOUNTAIN' && note(value.body, 200000));
    check(value.sceneId === undefined || text(value.sceneId, 160));
    if (project) check(value.sourceHash === project.sourceHash && (value.sceneId === undefined || project.scenes.some(scene => scene.id === value.sceneId)));
    validateScreenplayMetadata(value);
    if (Object.prototype.hasOwnProperty.call(value, 'sceneMap')) validateWritingSceneMap(value.sceneMap, String(value.body));
  } else if (kind === 'shot-direction') {
    validateShotDirection(value, project);
  } else if (kind === 'scene-plan') {
    shape(value, ['sceneId', 'sourceHash', 'notes', 'cellOverrides', 'timingObservations', 'segments'], ['cellBasisHash']);
    check(value.cellBasisHash === undefined || digest(value.cellBasisHash));
    check(text(value.sceneId, 160) && note(value.notes));
    const scene = project?.scenes.find(item => item.id === value.sceneId);
    if (project) check(scene);
    check(Array.isArray(value.cellOverrides) && value.cellOverrides.length <= 400);
    const cellIds: unknown[] = [];
    for (const cell of value.cellOverrides) {
      shape(cell, ['cellId', 'role', 'note']);
      check(text(cell.cellId, 160) && roles.includes(String(cell.role)) && note(cell.note, 4000));
      if (project) {
        const base = project.cells.find(item => item.id === cell.cellId && item.sceneId === value.sceneId);
        check(base && (cell.role !== 'START' || base.shotId === scene?.shots[0]?.id));
      }
      cellIds.push(cell.cellId);
    }
    check(unique(cellIds));
    check(Array.isArray(value.timingObservations) && value.timingObservations.length <= 1000);
    for (const timing of value.timingObservations) {
      shape(timing, ['durationMs', 'note', 'recordedAt']);
      check(integer(timing.durationMs, 1, 86400000) && note(timing.note, 4000) && typeof timing.recordedAt === 'string' && Number.isFinite(Date.parse(timing.recordedAt)));
    }
    check(Array.isArray(value.segments) && value.segments.length <= 100);
    const segmentIds: unknown[] = [];
    for (const segment of value.segments) {
      shape(segment, ['id', 'durationMs', 'cellIds', 'method']);
      check(text(segment.id, 120) && integer(segment.durationMs, 1, 180000) && strings(segment.cellIds) && (segment.cellIds as unknown[]).length > 0 && ['SUPPLIED', 'FILMED', 'AI', 'HYBRID'].includes(String(segment.method)));
      if (project && scene) {
        let previous = -1;
        for (const id of segment.cellIds as string[]) {
          const base = project.cells.find(item => item.id === id && item.sceneId === scene.id);
          const index = scene.shots.findIndex(shot => shot.id === base?.shotId);
          check(index >= 0 && index >= previous); previous = index;
        }
      }
      segmentIds.push(segment.id);
    }
    check(unique(segmentIds));
  } else if (kind === 'storyboard-cell') {
    shape(value, ['sourceHash', 'cellId', 'sceneId', 'shotId', 'role', 'imageHash', 'crop', 'description', 'actionRefs', 'plannedTimestampMs', 'review'], ['pixelWidth', 'pixelHeight', 'originCameraRef', 'originDccReturnRef']);
    if (value.originCameraRef) validateCameraOriginRef(value.originCameraRef);
    if (Object.prototype.hasOwnProperty.call(value,'originDccReturnRef')) validateDccReturnOriginRef(value.originDccReturnRef);
    check(!(value.originCameraRef && value.originDccReturnRef));
    check(typeof value.cellId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value.cellId) && text(value.sceneId, 160) && text(value.shotId, 160) && roles.includes(String(value.role)) && value.review === 'PENDING');
    check((value.imageHash === null || digest(value.imageHash)) && text(value.description, 8000) && strings(value.actionRefs) && (value.actionRefs as string[]).length <= 1000 && (value.plannedTimestampMs === null || integer(value.plannedTimestampMs, 0, 86400000)));
    const pixels = value.pixelWidth !== undefined || value.pixelHeight !== undefined;
    check(!pixels || (value.imageHash !== null && integer(value.pixelWidth, 1, 100000) && integer(value.pixelHeight, 1, 100000)));
    if (value.crop !== null) {
      shape(value.crop, ['x', 'y', 'width', 'height']);
      check(value.imageHash !== null && pixels && integer(value.crop.x, 0) && integer(value.crop.y, 0) && integer(value.crop.width) && integer(value.crop.height) && Number(value.crop.x) + Number(value.crop.width) <= Number(value.pixelWidth) && Number(value.crop.y) + Number(value.crop.height) <= Number(value.pixelHeight));
    }
    if (project) {
      const scene = project.scenes.find(item => item.id === value.sceneId);
      check(scene && scene.shots.some(shot => shot.id === value.shotId) && (value.role !== 'START' || value.shotId === scene.shots[0]?.id));
      check((value.actionRefs as string[]).every(id => [...scene.paragraphs, ...(project.prologue ?? [])].some(paragraph => paragraph.id === id)));
    }
  } else if (kind === 'casting-draft') {
    shape(value, ['sourceHash', 'characterId', 'performer', 'referenceHashes', 'useScope', 'evidenceHashes', 'notes']);
    check(text(value.characterId, 160) && text(value.performer, 300) && hashes(value.referenceHashes) && hashes(value.evidenceHashes) && note(value.notes, 8000) && ['INTERNAL_STORYBOARD_REFERENCE_ONLY', 'FILM_USE_REQUESTED'].includes(String(value.useScope)));
    if (project) check(project.characters.some(item => item.id === value.characterId));
  } else if (kind === 'review-observation') {
    shape(value, ['sourceHash', 'packageHash', 'commentId', 'reviewerLabel', 'note', 'observedAt'], ['sceneId', 'cellId', 'basisState', 'basisStateAtImport', 'basisHash', 'targetRecordId', 'targetRecordHash']);
    check(digest(value.packageHash) && text(value.commentId, 120) && text(value.reviewerLabel, 160) && text(value.note, 10000) && typeof value.observedAt === 'string' && Number.isFinite(Date.parse(value.observedAt)));
    check(value.basisState === undefined || ['CURRENT', 'HISTORICAL'].includes(String(value.basisState)));
    check(value.basisStateAtImport === undefined || ['CURRENT', 'HISTORICAL'].includes(String(value.basisStateAtImport)));
    check(value.basisHash === undefined || digest(value.basisHash));
    if (value.sceneId !== undefined) check(text(value.sceneId, 160) && (!project || project.scenes.some(item => item.id === value.sceneId)));
    if (value.cellId !== undefined) check(text(value.cellId, 160) && (!project || project.cells.some(item => item.id === value.cellId && (!value.sceneId || item.sceneId === value.sceneId))));
    if (value.targetRecordId !== undefined || value.targetRecordHash !== undefined) check(typeof value.targetRecordId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.targetRecordId) && digest(value.targetRecordHash));
  } else if (kind === 'review-resolution') {
    shape(value, ['sourceHash', 'commentId', 'disposition', 'note', 'basisHash']);
    check(text(value.commentId, 120) && digest(value.basisHash) && text(value.note, 4000) && ['ACKNOWLEDGED', 'ACTION_PLANNED', 'DECLINED_WITH_REASON'].includes(String(value.disposition)));
  } else if (kind === 'coverage-draft') {
    shape(value, ['sourceHash', 'paragraphId', 'shotIds', 'takeIds', 'note'], ['disposition', 'rationale', 'productionElements']);
    check(text(value.paragraphId, 160) && strings(value.shotIds) && strings(value.takeIds) && typeof value.note === 'string');
    if (value.disposition !== undefined) check(['PROPOSED', 'NEEDS_SHOT', 'MAPPED', 'NOT_APPLICABLE'].includes(String(value.disposition)));
    if (value.rationale !== undefined) check(note(value.rationale, 4000));
    if (value.productionElements !== undefined) validateProductionElements(value.productionElements);
    if (project) validateCoverageDraft(value, project);
  } else if (kind === 'media-take') {
    shape(value, ['sourceHash', 'assetHash', 'origin', 'segmentId', 'segmentHash', 'provenanceHash', 'notes', 'status']);
    check(digest(value.assetHash) && digest(value.segmentHash) && digest(value.provenanceHash) && text(value.segmentId, 120) && ['IMPORTED', 'GENERATED'].includes(String(value.origin)) && value.status === 'AWAITING_MEASUREMENT_AND_OWNER_SELECT');
  } else if (kind === 'movie-sequence') {
    validateMovieSequence(value, project);
  } else if (kind === 'generation-brief') {
    shape(value, ['schemaVersion', 'sourceHash', 'sceneId', 'title', 'shotIds', 'cellIds', 'initialFrameCellId', 'characterIds', 'prompt', 'settings', 'basisHash', 'status'], ['handoffRef', 'contextBundleRef', 'sourcePassages', 'mediaInputs']);
    if (value.sourcePassages !== undefined) {
      check(Array.isArray(value.sourcePassages) && value.sourcePassages.length > 0 && value.sourcePassages.length <= 80);
      for (const ref of value.sourcePassages) { shape(ref, ['paragraphId', 'textHash']); check(text(ref.paragraphId, 160) && digest(ref.textHash)); }
      check(new Set(value.sourcePassages.map(ref => ref.paragraphId)).size === value.sourcePassages.length);
      if (project) {
        const paragraphs = project.scenes.find(item => item.id === value.sceneId)?.paragraphs ?? [];
        let previous = -1;
        for (const ref of value.sourcePassages) { const position = paragraphs.findIndex(item => item.id === ref.paragraphId); check(position > previous); previous = position; }
      }
    }
    if (Object.prototype.hasOwnProperty.call(value, 'handoffRef')) { validateWorkflowRef(value.handoffRef); check((value.handoffRef as {id:string}).id === 'production-handoff:' + value.sceneId); }
    if (Object.prototype.hasOwnProperty.call(value, 'contextBundleRef')) { validateWorkflowRef(value.contextBundleRef); validateContextBundleId((value.contextBundleRef as {id:string}).id); }
    check(value.schemaVersion === 1 && text(value.sceneId, 160) && text(value.title, 200) && String(value.title).trim().length > 0 && strings(value.shotIds) && (value.shotIds as string[]).length > 0 && (value.shotIds as string[]).length <= 10 && strings(value.cellIds) && (value.cellIds as string[]).length <= 400 && strings(value.characterIds) && (value.characterIds as string[]).length <= 100 && (value.initialFrameCellId === null || text(value.initialFrameCellId, 160)) && note(value.prompt, 40000) && digest(value.basisHash) && value.status === 'DRAFT');
    if (Object.prototype.hasOwnProperty.call(value, 'mediaInputs')) {
      check(Array.isArray(value.mediaInputs) && value.mediaInputs.length <= 64);
      for (const input of value.mediaInputs) {
        shape(input, ['sha256', 'role', 'inMs', 'outMs']);
        check(digest(input.sha256) && typeof input.role === 'string' && ['SOURCE_VIDEO','MOTION_REFERENCE','AUDIO_REFERENCE'].includes(input.role));
        check(input.inMs === null && input.outMs === null || integer(input.inMs, 0) && integer(input.outMs, Number(input.inMs) + 1) && Number(input.outMs) - Number(input.inMs) <= 180000);
      }
      check(new Set(value.mediaInputs.map(input => `${input.role}:${input.sha256}:${input.inMs}:${input.outMs}`)).size === value.mediaInputs.length);
    }
    shape(value.settings, ['model', 'mode', 'durationMs', 'aspectRatio', 'resolution'], ['route']);
    check(!Object.prototype.hasOwnProperty.call(value.settings, 'route') || typeof value.settings.route === 'string' && ['UNSELECTED','DREAMINA','HIGGSFIELD','COMFYUI','OTHER'].includes(value.settings.route));
    check(note(value.settings.model, 120) && typeof value.settings.mode === 'string' && ['UNCONFIRMED', 'STANDARD', 'LONG_VIDEO', 'CLIP'].includes(value.settings.mode) && (value.settings.durationMs === null || integer(value.settings.durationMs, 1, value.settings.mode === 'STANDARD' ? 30000 : 180000)) && note(value.settings.aspectRatio, 120) && note(value.settings.resolution, 120));
    check(['model', 'aspectRatio', 'resolution'].every(key => !/[\r\n\0]/.test(String(value.settings[key]))));
    check(value.initialFrameCellId === null || value.cellIds[0] === value.initialFrameCellId);
    if (project) {
      check(value.sourceHash === project.sourceHash);
      const scene = project.scenes.find(item => item.id === value.sceneId);
      check(scene);
      let previous = -1;
      for (const id of value.shotIds as string[]) { const index = scene.shots.findIndex(shot => shot.id === id); check(index > previous); previous = index; }
      check((value.cellIds as string[]).every(id => project.cells.some(cell => cell.id === id && cell.sceneId === scene.id && (value.shotIds as string[]).includes(cell.shotId))));
      check((value.characterIds as string[]).every(id => project.characters.some(character => character.id === id)));
      if (value.initialFrameCellId !== null) check((value.cellIds as string[]).includes(String(value.initialFrameCellId)) && project.cells.some(cell => cell.id === value.initialFrameCellId && cell.shotId === value.shotIds[0]));
    }
  } else if (kind === 'document-draft') {
    shape(value, ['sourceHash', 'typeId', 'dependencyHashes', 'body', 'status']);
    check(text(value.typeId, 150) && Array.isArray(value.dependencyHashes) && value.dependencyHashes.every(digest) && note(value.body, 100000) && value.status === 'DRAFT');
  }
}

export async function validateRecord(value: unknown, project?: WorkspaceProject): Promise<WorkspaceRecord> {
  shape(value, ['id', 'kind', 'version', 'sha256', 'data'], ['replayed', 'reviewState']);
  if (value.reviewState !== undefined) {
    shape(value.reviewState, ['status', 'changedCellIds', 'reason']);
    check(['scene-plan', 'shot-keyframes'].includes(String(value.kind)) && ['NEEDS_REVIEW', 'CURRENT_CELL_BASIS'].includes(String(value.reviewState.status)) && strings(value.reviewState.changedCellIds) && text(value.reviewState.reason, 160));
  }
  check(typeof value.id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value.id) && kinds.includes(String(value.kind)) && integer(value.version) && digest(value.sha256) && (value.replayed === undefined || typeof value.replayed === 'boolean'));
  validateData(String(value.kind), value.data, ['asset-curation', 'universe-continuity-plan', 'universe-production-plan'].includes(String(value.kind)) ? project : projectOwnedContext(project, String(value.kind), value.data));
  if (value.kind === 'production-attachment') check(value.id === productionAttachmentId((value.data as {projectId:string}).projectId) && value.version === 1);
  if (value.kind === 'writing-production-plan') {
    const plan = value.data as import('./writingProductionApi').WritingProductionPlan;
    check(value.id === `writing-production-plan:${await hashCanonical({ projectId: plan.projectId, draftRef: plan.source.draftRef })}`);
  }
  validateShotDirectionIdentity(String(value.id), String(value.kind), value.data);
  validateUsageIdentity(value.id, value.kind, value.data, value.version);
  validateBudgetIdentity(String(value.id), String(value.kind), value.data);
  validateMovieSequenceIdentity(value.id, value.kind);
  validateStudioOperationIdentity(value.id, value.kind);
  validateStudioMediaIdentity(value.id, value.kind, value.data);
  validateStudioGenerationIdentity(value.id, value.kind);
  validateStudioReferenceIdentity(value.id, value.kind);
  validateAssetMarketProfileIdentity(value.id, value.kind, value.data);
  validateParticipationIdentity(String(value.id), String(value.kind), value.data);
  validateTokenPreparationIdentity(String(value.id), String(value.kind), value.data, Number(value.version));
  validateComicPackageIdentity(value.id, value.kind, value.data);
  validateStoryboardPlanningIdentity(String(value.id), String(value.kind), value.data);
  if (value.kind === 'comic-package') check(value.version === 1);
  if (value.kind === 'storyboard-frame-extraction') check(value.version === 1 && value.id === `storyboard-frame-extraction:${value.sha256}`);
  if (value.kind === 'studio-media') check(value.version === 1);
  if (value.kind === 'project-direction' || String(value.id).startsWith('project-direction:')) { check(value.kind === 'project-direction'); if (project) validateProjectDirectionId(value.id, project); }
  if (value.kind === 'generation-brief' && project && (value.data as import('./types').GenerationBrief).sourcePassages) {
    const brief = value.data as import('./types').GenerationBrief;
    await verifySourceRefs((project as Project).scenes.find(scene => scene.id === brief.sceneId)!, brief.sourcePassages!);
  }
  if(value.kind==='lore-source') { const data=value.data as {originalFilename:string;original:{sha256:string}}; check(value.version===1&&value.id==='lore-source:'+await hashCanonical({originalFilename:data.originalFilename,originalSha256:data.original.sha256})); }
  if(value.kind==='model-assistance') { const data = value.data as {requestId:string;status:string}; check(value.id === `model-assistance:${data.requestId}` && value.version === (data.status === 'STARTED' ? 1 : 2)); }
  if (UNIVERSE_KINDS.includes(String(value.kind))) {
    if (value.kind === 'universe-continuity-plan') check(value.id === `universe-continuity-plan:${(value.data as { sourceHash: string | null; projectId?: string }).sourceHash ?? (value.data as { projectId: string }).projectId}`);
    check(String(value.id).startsWith(`${value.kind}:`) && String(value.id).length > String(value.kind).length + 1);
    if (value.kind === 'universe-entity' || value.kind === 'universe-artwork' || value.kind === 'universe-agent' || value.kind === 'universe-profile' || value.kind === 'universe-production-plan') check(value.id === `${value.kind}:${(value.data as { entityId: string }).entityId}`);
  }
  if(value.kind==='project-asset')check(value.version===1&&value.id===`project-asset:${(value.data as {asset:{sha256:string}}).asset.sha256}`);
  if(value.kind==='asset-curation')check(value.id===`asset-curation:${(value.data as import('./projectLibraryModel').AssetCuration).assetRef.id.slice('project-asset:'.length)}`);
  if(value.kind==='camera-observation')check(value.id===`camera-observation:${value.sha256}`);
  if(value.kind==='measured-media-take')check(value.version===1&&value.id===`measured-media-take:${value.sha256}`);
  if(value.kind==='take-review')check(value.id===`take-review:${(value.data as {takeRef:{sha256:string}}).takeRef.sha256}`);
  if (value.kind === 'context-bundle') validateContextBundleId(value.id);
  if (value.kind === 'screenplay-draft' || AUTHORING_KINDS.includes(String(value.kind))) check(String(value.id).startsWith(`${value.kind}:`) && String(value.id).length > String(value.kind).length + 1);
  const identityField = { 'node-workflow': 'sceneId', 'scene-plan': 'sceneId', 'production-handoff':'sceneId', 'storyboard-cell': 'cellId', 'casting-draft': 'characterId', 'coverage-draft': 'paragraphId', 'review-observation': 'commentId', 'review-resolution': 'commentId' }[String(value.kind)];
  if (identityField) check(value.id === `${value.kind}:${(value.data as Record<string, unknown>)[identityField]}`);
  if (await hashCanonical(value.data) !== value.sha256) throw new Error('The local workspace record hash does not match its contents. Reload before continuing.');
  return value as unknown as WorkspaceRecord;
}

export async function validateBootstrap(value: unknown): Promise<Bootstrap> {
  shape(value, ['project', 'records'], ['canonical']);
  const project = value.project;
  check(object(project) && text(project.id, 160) && text(project.title) && digest(project.sourceHash) && ['ADMITTED', 'PENDING_OWNER_ADMISSION'].includes(String(project.sourceStatus)));
  check(Array.isArray(project.scenes) && project.scenes.length > 0 && Array.isArray(project.cells) && Array.isArray(project.characters) && Array.isArray(project.continuityQuestions));
  const paragraphs = (items: unknown) => Array.isArray(items) && items.every(item => object(item) && text(item.id, 160) && text(item.type, 160) && typeof item.text === 'string');
  check(project.prologue === undefined || paragraphs(project.prologue));
  const sceneIds: string[] = [], shotIds: string[] = [], cellIds: string[] = [];
  for (const scene of project.scenes) {
    check(object(scene) && text(scene.id, 160) && integer(scene.index) && text(scene.heading) && Array.isArray(scene.shots) && paragraphs(scene.paragraphs));
    sceneIds.push(String(scene.id));
    for (const shot of scene.shots) {
      check(object(shot) && text(shot.id, 160) && text(shot.label, 160) && typeof shot.description === 'string' && (shot.plannedDurationMs === null || integer(shot.plannedDurationMs, 0)));
      shotIds.push(String(shot.id));
    }
  }
  for (const cell of project.cells) {
    check(object(cell) && text(cell.id, 160) && sceneIds.includes(String(cell.sceneId)) && shotIds.includes(String(cell.shotId)) && roles.includes(String(cell.role)) && typeof cell.description === 'string' && ['PENDING', 'MISSING'].includes(String(cell.review)));
    check(cell.imageHash == null || digest(cell.imageHash));
    if (Object.prototype.hasOwnProperty.call(cell,'originDccReturnRef')) validateDccReturnOriginRef(cell.originDccReturnRef);
    check(!(cell.originCameraRef && cell.originDccReturnRef));
    for (const key of ['pixelWidth', 'pixelHeight']) check(cell[key] === undefined || integer(cell[key]));
    if (cell.crop != null) check(object(cell.crop) && integer(cell.crop.x, 0) && integer(cell.crop.y, 0) && integer(cell.crop.width) && integer(cell.crop.height));
    cellIds.push(String(cell.id));
  }
  check(unique(sceneIds) && unique(shotIds) && unique(cellIds));
  if (project.cellBasisHashes !== undefined) {
    check(object(project.cellBasisHashes) && Object.keys(project.cellBasisHashes).length === sceneIds.length);
    for (const id of sceneIds) check(digest(project.cellBasisHashes[id]) && await hashCanonical(project.cells.filter(cell => (cell as Record<string, unknown>).sceneId === id)) === project.cellBasisHashes[id]);
  }
  check(project.cellRevisionSceneIds === undefined || (strings(project.cellRevisionSceneIds) && (project.cellRevisionSceneIds as string[]).every(id => sceneIds.includes(id))));
  for (const character of project.characters) check(object(character) && text(character.id, 160) && text(character.name, 300) && typeof character.description === 'string' && (character.referenceImageHash == null || digest(character.referenceImageHash)) && (character.useScope === undefined || typeof character.useScope === 'string'));
  check(project.continuityQuestions.every(item => typeof item === 'string' || object(item)));
  if (value.canonical !== undefined) {
    shape(value.canonical, ['version', 'stateHash', 'sourceStatus', 'sourceRevision']);
    check(integer(value.canonical.version, 0) && digest(value.canonical.stateHash) && ['ADMITTED', 'PENDING_OWNER_ADMISSION'].includes(String(value.canonical.sourceStatus)) && (value.canonical.sourceRevision === null || object(value.canonical.sourceRevision)));
  }
  check(Array.isArray(value.records) && value.records.length <= 10000);
  const records = await Promise.all(value.records.map(record => validateRecord(record, project as unknown as Project)));
  check(unique(records.map(record => record.id)));
  if (project.creativeOrigin !== undefined || project.productionAttachmentRef !== undefined || project.productionDraftRef !== undefined || project.productionPlanRef !== undefined) {
    check(object(project.creativeOrigin) && object(project.productionAttachmentRef));
    const attachment = records.find(record => record.id === (project.productionAttachmentRef as Record<string, unknown>).id);
    check(attachment && attachment.kind === 'production-attachment' && attachment.sha256 === project.productionAttachmentRef.sha256 && attachment.version === project.productionAttachmentRef.version);
    const expected = attachedProductionProject(project.creativeOrigin, attachment) as Project;
    for (const key of ['id', 'title', 'sourceHash', 'sourceStatus', 'scenes', 'characters', 'prologue', 'continuityQuestions', 'productionDraftRef', 'productionPlanRef']) check(JSON.stringify(project[key]) === JSON.stringify(expected[key]));
  }
  return { ...value, records } as unknown as Bootstrap;
}

/** Source-free workspaces have an explicit profile, never an invented source hash. */
export async function validateWorkspaceBootstrap(value: unknown): Promise<WorkspaceBootstrap> {
  if (!object(value) || !object(value.project) || value.project.profile !== 'caniscreenwrite-creative/v1') return validateBootstrap(value);
  shape(value, ['project', 'records', 'canonical']);
  validateCreativeProject(value.project);
  shape(value.canonical, ['version', 'stateHash', 'sourceStatus', 'sourceRevision']);
  check(integer(value.canonical.version, 0) && digest(value.canonical.stateHash) && value.canonical.sourceStatus === 'NO_SCREENPLAY' && value.canonical.sourceRevision === null);
  check(Array.isArray(value.records) && value.records.length <= 10000);
  const project = value.project as unknown as CreativeBootstrap['project'];
  const records = await Promise.all(value.records.map(record => validateRecord(record, project)));
  check(records.every(record => CREATIVE_PROJECT_RECORD_KINDS.includes(record.kind)) && unique(records.map(record => record.id)));
  return { project, records, canonical: value.canonical as unknown as CreativeBootstrap['canonical'] };
}
