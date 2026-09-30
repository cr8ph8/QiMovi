import fs from 'node:fs';
import path from 'node:path';
import { dreaminaContext, previewDreamina } from '../server/dreamina.mjs';
import { canonical, check, sha256 } from '../server/storage.mjs';

const MODEL = 'seedance_2_5';
const MODE = 'omni_reference';
const SHA = /^[a-f0-9]{64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const finiteCredit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const supported = model => ({ model: MODEL, mode: MODE, duration: { min: 4, max: 30, integer: true },
  resolutions: ['480p', '720p', '1080p'].filter(value => model?.parameters?.find(p => p.name === 'resolution')?.options?.includes(value)),
  aspectRatios: (model?.aspect_ratios ?? []).filter(value => ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].includes(value)),
  bitrateModes: ['standard', 'high'].filter(value => model?.parameters?.find(p => p.name === 'bitrate_mode')?.options?.includes(value)),
  count: 1, maxReferences: null });

// This is a cached observation imported by the local owner tooling. Reading it
// does not connect this Node service to the host's MCP session or attest freshness.
function readObservation(store) {
  const filename = path.join(store.directory, 'providers', 'higgsfield-observation.json');
  let bytes;
  try {
    const stat = fs.lstatSync(filename);
    check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024 * 1024, 'INVALID_HIGGSFIELD_OBSERVATION', 409);
    bytes = fs.readFileSync(filename);
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  let data;
  try { data = JSON.parse(bytes.toString('utf8')); } catch { check(false, 'INVALID_HIGGSFIELD_OBSERVATION', 409); }
  check(data.schemaVersion === 1 && data.provider === 'HIGGSFIELD' && data.transport === 'CODEX_MCP' &&
    typeof data.observedAt === 'string' && Number.isFinite(Date.parse(data.observedAt)) &&
    data.model?.id === MODEL && Array.isArray(data.model.parameters) && Array.isArray(data.model.aspect_ratios) &&
    typeof data.account?.workspaceId === 'string' && /^[0-9a-f-]{36}$/i.test(data.account.workspaceId) &&
    finiteCredit(data.account.credits) && typeof data.account.plan === 'string' && typeof data.account.unlimAvailable === 'boolean' &&
    Array.isArray(data.estimates) && data.toolContract?.estimateTool === 'higgsfield_estimate_video_cost' &&
    data.toolContract?.generationTool === 'higgsfield_generate_video' &&
    ['start_image', 'image'].every(role => data.toolContract.canonicalMediaRoles?.includes(role)), 'INVALID_HIGGSFIELD_OBSERVATION', 409);
  const duration = data.model.parameters.find(p => p.name === 'duration');
  check(duration?.min === 4 && duration?.max === 30 && data.model.parameters.find(p => p.name === 'mode')?.options?.includes(MODE) &&
    data.model.parameters.find(p => p.name === 'generate_audio')?.type === 'bool' &&
    ['start_image', 'image_references'].every(role => data.model.medias?.some(media => media.roles?.includes(role))), 'HIGGSFIELD_CATALOG_CHANGED', 409);
  return { data, digest: sha256(bytes) };
}

function contextFrom(observed) {
  if (!observed) return { schemaVersion: 1, provider: 'HIGGSFIELD',
    observation: { status: 'NOT_OBSERVED', observedAt: null, snapshotSha256: null, workspaceId: null },
    account: null, supported: supported(null), localPlanningMaxSeconds: 180, estimates: [] };
  const { data, digest } = observed;
  const observation = { status: 'OBSERVED_SNAPSHOT_NOT_LIVE', observedAt: data.observedAt,
    snapshotSha256: digest, workspaceId: data.account.workspaceId };
  return { schemaVersion: 1, provider: 'HIGGSFIELD', observation,
    account: { credits: data.account.credits, plan: data.account.plan, unlimAvailable: data.account.unlimAvailable },
    supported: supported(data.model), localPlanningMaxSeconds: 180,
    estimates: data.estimates.filter(quote => object(quote.params) && object(quote.cost) && finiteCredit(quote.cost.credits) &&
      quote.workspaceId === data.account.workspaceId && object(quote.adjustments) && Object.keys(quote.adjustments).length === 0 &&
      quote.scope === 'PARAMETERS_ONLY_NO_MEDIA' && typeof quote.observedAt === 'string' && Number.isFinite(Date.parse(quote.observedAt)))
      .map(quote => ({ observedAt: quote.observedAt, params: quote.params, cost: quote.cost, scope: quote.scope,
        workspaceId: data.account.workspaceId, snapshotSha256: digest })) };
}

export function getHiggsfieldContext(store) { return contextFrom(readObservation(store)); }

export function previewHiggsfield(store, input, sourceStatus = 'PENDING_OWNER_ADMISSION') {
  check(exact(input, ['briefId', 'briefSha256', 'settings']) && typeof input.briefId === 'string' &&
    input.briefId.startsWith('generation-brief:') && SHA.test(input.briefSha256 ?? ''), 'INVALID_HIGGSFIELD_PREVIEW', 422);
  const record = store.rawList('generation-brief').find(value => value.id === input.briefId);
  check(record, 'HIGGSFIELD_BRIEF_NOT_FOUND', 404);
  check(record.sha256 === input.briefSha256 && sha256(canonical(record.data)) === input.briefSha256, 'HIGGSFIELD_REVISION_CONFLICT', 409);
  const scene = dreaminaContext(store, record.data.sceneId, sourceStatus);
  check(record.data.basisHash === scene.basisHash, 'STALE_DREAMINA_BASIS', 409);
  const prepared = previewDreamina(store, record.data, sourceStatus);
  const observed = readObservation(store);
  check(observed, 'HIGGSFIELD_OBSERVATION_REQUIRED', 409);
  const context = contextFrom(observed);
  const settings = input.settings;
  check(exact(settings, ['duration', 'resolution', 'aspectRatio', 'generateAudio', 'bitrateMode']) &&
    Number.isSafeInteger(settings.duration) && settings.duration >= 4 && settings.duration <= 30 &&
    typeof settings.generateAudio === 'boolean' && context.supported.resolutions.includes(settings.resolution) &&
    context.supported.aspectRatios.includes(settings.aspectRatio) && context.supported.bitrateModes.includes(settings.bitrateMode),
  'INVALID_HIGGSFIELD_SETTINGS', 422);
  const params = { model: MODEL, mode: MODE, duration: settings.duration, resolution: settings.resolution,
    aspect_ratio: settings.aspectRatio, generate_audio: settings.generateAudio, bitrate_mode: settings.bitrateMode, count: 1 };
  // Quote equality includes every scalar and the imported workspace/snapshot.
  // Costs are never interpolated, extrapolated, or treated as a media-bound quote.
  const quote = observed.data.estimates.find(value => value.scope === 'PARAMETERS_ONLY_NO_MEDIA' && value.workspaceId === context.observation.workspaceId &&
    object(value.params) && canonical(value.params) === canonical(params) && finiteCredit(value.cost?.credits) &&
    object(value.adjustments) && Object.keys(value.adjustments).length === 0 &&
    typeof value.observedAt === 'string' && Number.isFinite(Date.parse(value.observedAt)));
  const estimate = { status: quote ? 'OBSERVED_PARAMETER_QUOTE' : 'NOT_QUOTED', credits: quote?.cost.credits ?? null,
    scope: 'PARAMETERS_ONLY_NO_MEDIA', observedAt: quote?.observedAt ?? null,
    workspaceId: context.observation.workspaceId, snapshotSha256: context.observation.snapshotSha256 };
  const roleAliases = { start_image: 'start_image', end_image: 'end_image', image: 'image', image_references: 'image', video: 'video', video_references: 'video', audio: 'audio', audio_references: 'audio' };
  const observedRoles = new Set(observed.data.model.medias.flatMap(media => media.roles ?? []).map(role => roleAliases[role]).filter(role => observed.data.toolContract.canonicalMediaRoles.includes(role)));
  const requiredMedia = prepared.uploadSheet.map((item, index) => {
    const providerRole = item.role === 'CLIP_OPENING_CANDIDATE' ? 'start_image' : ['SOURCE_VIDEO', 'MOTION_REFERENCE'].includes(item.role) ? 'video' : item.role === 'AUDIO_REFERENCE' ? 'audio' : 'image';
    return { id: `reference-${index + 1}`,
    role: item.role, providerRole,
    sha256: item.sha256, label: item.label, mimeType: item.mimeType, byteLength: item.byteLength,
    status: !observedRoles.has(providerRole) ? 'UNSUPPORTED_PROVIDER_ROLE' : item.status === 'ORIGINAL_NEEDS_REVIEW' ? 'UPLOAD_BINDING_REQUIRED' : item.status,
    crop: item.crop, scope: item.scope, cellId: item.cellId, characterId: item.characterId,
    ...(Object.hasOwn(item, 'originalUnmodified') ? { inMs: item.inMs, outMs: item.outMs, originalUnmodified: true, measurementRef: item.measurementRef, measuredDurationMs: item.measuredDurationMs } : {}) };
  });
  const checks = [];
  const add = (code, status, message) => checks.push({ code, status, message });
  add('SAVED_REVISION', 'PASS', 'The exact saved brief and its scene dependencies match this request.');
  add('SOURCE_ADMISSION', sourceStatus === 'ADMITTED' ? 'PASS' : 'BLOCKED', sourceStatus === 'ADMITTED' ? 'Exact source admission is recorded.' : 'The exact screenplay still needs owner admission before production.');
  add('PROMPT_TEXT', record.data.prompt.trim() ? 'PASS' : 'BLOCKED', record.data.prompt.trim() ? 'The plan preserves the saved prompt byte for byte.' : 'Save a reviewed prompt before preparing a provider request.');
  add('CLIP_OPENING', requiredMedia.some(item => item.providerRole === 'start_image' && item.sha256 && item.status === 'UPLOAD_BINDING_REQUIRED') ? 'PASS' : 'BLOCKED',
    'An owned, uncropped clip-opening candidate must map to the first selected shot; a missing image, unrendered crop or later moment cannot silently replace it.');
  add('LOCAL_REFERENCE_ASSETS', requiredMedia.length && requiredMedia.every(item => item.status === 'UPLOAD_BINDING_REQUIRED') ? 'PASS' : 'BLOCKED',
    'All selected local media must be present with supported input roles; requested crops and video/audio excerpts need preparation before provider upload binding.');
  const cells = record.data.cellIds.map(id => scene.cells.find(cell => cell.id === id));
  const firstTime = cells[0]?.plannedTimestampMs;
  const timelineFits = firstTime == null || cells.every(cell => cell.plannedTimestampMs == null || cell.plannedTimestampMs - firstTime <= settings.duration * 1000);
  add('PROVIDER_DURATION', timelineFits ? 'PASS' : 'BLOCKED', timelineFits ? 'Proposed request is 4–30 whole seconds. The separate local planning ceiling remains 180 seconds.' : 'The selected cells extend beyond this proposed request duration; review a meaningful split.');
  add('PERFORMANCE_TIMING', 'UNKNOWN', cells.every(cell => cell.plannedTimestampMs == null) ?
    'The selected cells have no planned timestamps. Time the action and dialogue before claiming this clip fits the request duration.' :
    'Storyboard timestamps are planning only. A table read and action review must establish whether the exact dialogue and performance fit this request duration.');
  add('REFERENCE_USE', 'BLOCKED', 'Reference use, casting and creative inputs still require recorded owner review. A local asset hash is not permission.');
  add('REFERENCE_UPLOADS', 'BLOCKED', 'Each reference requires a confirmed provider media UUID. No upload binding has been implemented for this request.');
  add('REFERENCE_CAPACITY', 'UNKNOWN', 'The observed catalog does not state a reference-count ceiling. Confirm all selected media in provider preflight.');
  add('PARAMETER_ESTIMATE', quote ? 'PASS' : 'UNKNOWN', quote ? 'An exact parameter-only estimate was observed in this workspace snapshot. Media-bound cost and availability still need refresh.' : 'No exact matching parameter estimate was observed. Do not infer cost from neighboring settings.');
  add('AVAILABLE_CREDITS', context.account.credits === 0 || (quote && context.account.credits < quote.cost.credits) ? 'BLOCKED' : 'UNKNOWN',
    `The observed workspace balance is ${context.account.credits} credits; refresh the active workspace and balance before execution.`);
  add('WORKSPACE_RECONFIRMATION', 'BLOCKED', 'MCP workspace selection belongs to the host session. Reconfirm the observed workspace before estimating or submitting; no workspace override is accepted by this tool.');
  add('OWNER_BUDGET_APPROVAL', 'BLOCKED', 'A test budget and execution approval have not been recorded by this preflight.');
  add('SUBMISSION_RECOVERY', 'BLOCKED', 'Submission, job reconciliation and owned downloads remain unimplemented here. The observed connector exposes no idempotency or cancel control; automatic retries are not permitted.');
  // Keep source/creative problems from the shared preparation contract, replacing
  // Dreamina-account settings requirements with the observed Higgsfield contract.
  const requirements = prepared.requirements.filter(item => !['ACCOUNT_SETTINGS_UNVERIFIED', 'SETTINGS_INCOMPLETE', 'DURATION_REQUIRED'].includes(item.code));
  return { readiness: 'BLOCKED', observation: context.observation, account: context.account,
    ...(prepared.selectedSource ? { selectedSource: prepared.selectedSource } : {}),
    brief: { id: record.id, version: record.version, sha256: record.sha256, basisHash: record.data.basisHash, sourceHash: record.data.sourceHash },
    settings: { ...settings }, requiredMedia, estimate, checks, requirements,
    estimateCall: { tool: 'higgsfield_estimate_video_cost', arguments: { params } },
    generationCall: null,
    generationPlan: { executable: false, params: { ...params, prompt: record.data.prompt }, requiredMedia } };
}
