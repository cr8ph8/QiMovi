import fs from 'node:fs';
import { canonical, check, sha256 } from '../server/storage.mjs';
import { dreaminaContext, previewDreamina } from '../server/dreamina.mjs';

const bytes = fs.readFileSync(new URL('./higgsfield-catalog.json', import.meta.url));
const catalog = JSON.parse(bytes.toString('utf8'));
const catalogSha256 = sha256(bytes);
const filmmakingBytes = fs.readFileSync(new URL('./filmmaking-catalog.json', import.meta.url));
const filmmaking = JSON.parse(filmmakingBytes.toString('utf8'));
const actionCatalogSha256 = sha256(filmmakingBytes);
const composerModelIds = filmmaking.composerModelIds;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max, required = false) => typeof value === 'string' && value.length <= max && !value.includes('\0') && (!required || value.trim().length > 0);
const shape = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const roleMap = { image: 'image', image_references: 'image', start_image: 'start_image', end_image: 'end_image', video_references: 'video', audio_references: 'audio', input_video: 'video', input_audio: 'audio', video: 'video', audio: 'audio' };
const family = role => ['image', 'start_image', 'end_image'].includes(role) ? 'image' : role;
const speechModels = new Set(['seed_audio', 'qwen_audio_tts', 'text2speech_v2']);
const sourceVideoModels = new Set(['topaz_video', 'video_upscale', 'video_deflicker', 'video_background_remover', 'sync_so']);
const sourceImageModels = new Set(['topaz_image', 'image_background_remover']);
const limits = { localPlanningMaxSeconds: 180, maxPlannedMedia: 64, maxPromptCharacters: 50000 };
const snapshot = () => ({ catalogSha256, observedAt: catalog.observedAt, status: 'RETAINED_SNAPSHOT_NOT_LIVE', sources: structuredClone(catalog.sources) });

// Provider settings permit finite fractions. This serializer is deliberately
// separate from the integer-only canonical workspace/source record contract.
export function higgsfieldRequestJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { check(Number.isFinite(value), 'HIGGSFIELD_PARAMETER_TYPE', 422); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(higgsfieldRequestJson).join(',')}]`;
  check(object(value), 'HIGGSFIELD_COMPOSE_INPUT_INVALID', 422);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${higgsfieldRequestJson(value[key])}`).join(',')}}`;
}

/** Bundled read-only evidence, not discovery through the desktop's own transport. */
export function getHiggsfieldTools() {
  return { snapshot: snapshot(), models: structuredClone(catalog.models), composerModelIds: [...composerModelIds],
    tools: structuredClone(catalog.tools), groups: structuredClone(catalog.groups), missingTools: [...new Set([...catalog.missingTools,
      'mcp__codex_apps__higgsfield_scene_builder_3d_query_python', 'mcp__codex_apps__higgsfield_scene_builder_3d_show_scene'])],
    actionCatalogSha256, actions: structuredClone(filmmaking.actions), modelPresets: structuredClone(filmmaking.modelPresets),
    marketingFormats: structuredClone(filmmaking.marketingFormats), marketingStyles: structuredClone(filmmaking.marketingStyles),
    limits: { ...limits }, readiness: 'PREPARATION_ONLY', executable: false };
}

function parameterValue(parameter, value) {
  if (value === null) { check(parameter.nullable === true, 'HIGGSFIELD_PARAMETER_NULL_NOT_ALLOWED', 422); return; }
  const valid = parameter.type === 'string' ? text(value, 2000) : parameter.type === 'bool' ? typeof value === 'boolean' :
    parameter.type === 'number' ? typeof value === 'number' && Number.isFinite(value) : parameter.type === 'string_array' ? Array.isArray(value) && value.length <= 64 && value.every(item => text(item, 2000)) : false;
  check(valid, 'HIGGSFIELD_PARAMETER_TYPE', 422);
  if (parameter.options) check(parameter.options.includes(value), 'HIGGSFIELD_PARAMETER_ENUM', 422);
  const measure = parameter.type === 'string_array' ? value.length : value;
  if (parameter.min !== undefined) check(measure >= parameter.min, 'HIGGSFIELD_PARAMETER_RANGE', 422);
  if (parameter.max !== undefined) check(measure <= parameter.max, 'HIGGSFIELD_PARAMETER_RANGE', 422);
  if (parameter.pattern) check(new RegExp(parameter.pattern).test(value), 'HIGGSFIELD_PARAMETER_FORMAT', 422);
  if (parameter.format) check(parameter.format === 'hex_color' && /^#[A-Fa-f0-9]{6}$/.test(value), 'HIGGSFIELD_PARAMETER_FORMAT', 422);
  if (parameter.type === 'string_array') for (const item of value) {
    if (parameter.item_pattern) check(new RegExp(parameter.item_pattern).test(item), 'HIGGSFIELD_PARAMETER_FORMAT', 422);
    if (parameter.item_format) check(parameter.item_format === 'hex_color' && /^#[A-Fa-f0-9]{6}$/.test(item), 'HIGGSFIELD_PARAMETER_FORMAT', 422);
  }
}

function settingsFor(model, settings) {
  check(object(settings), 'HIGGSFIELD_SETTINGS_REQUIRED', 422);
  const definitions = new Map(model.parameters.map(parameter => [parameter.name, parameter]));
  if (model.output_type !== 'audio') {
    if (model.aspect_ratios.length) definitions.set('aspect_ratio', { name: 'aspect_ratio', type: 'string', options: model.aspect_ratios });
    definitions.set('count', { name: 'count', type: 'number', min: 1, max: 4, default: 1 });
  }
  if (model.duration_range) definitions.set('duration', { name: 'duration', type: 'number', min: model.duration_range.min, max: model.duration_range.max });
  for (const [name, value] of Object.entries(settings)) {
    check(definitions.has(name), 'HIGGSFIELD_UNKNOWN_PARAMETER', 422);
    parameterValue(definitions.get(name), value);
    if (['duration', 'count', 'batch_size', 'sample_rate', 'seed', 'output_width', 'output_height', 'width', 'height'].includes(name)) check(Number.isSafeInteger(value), 'HIGGSFIELD_WHOLE_NUMBER_REQUIRED', 422);
    if (name === 'duration') check(value > 0 && value <= limits.localPlanningMaxSeconds, 'HIGGSFIELD_DURATION_LIMIT', 422);
    if (['width', 'height', 'output_width', 'output_height'].includes(name)) check(value > 0, 'HIGGSFIELD_PARAMETER_RANGE', 422);
  }
  const mode = settings.mode ?? definitions.get('mode')?.default;
  if (model.id === 'seedance_2_5') {
    check(mode === 'video_extension' ? ['forward', 'backward'].includes(settings.extension_mode) : !Object.hasOwn(settings, 'extension_mode'), 'HIGGSFIELD_EXTENSION_MODE_CONFLICT', 422);
    check(mode !== 'video_edit' || !Object.hasOwn(settings, 'duration'), 'HIGGSFIELD_DURATION_IGNORED_IN_MODE', 422);
    check(!['video_edit', 'video_extension'].includes(mode) || !Object.hasOwn(settings, 'aspect_ratio'), 'HIGGSFIELD_ASPECT_IGNORED_IN_MODE', 422);
  }
  if (speechModels.has(model.id)) check(['preset', 'element'].includes(settings.voice_type) && text(settings.voice_id, 200, true), 'HIGGSFIELD_SELECTED_VOICE_PAIR_REQUIRED', 422);
  if (['minimax_h3', 'minimax_h3_max'].includes(model.id)) check((settings.count ?? 1) === 1 && (settings.batch_size ?? 1) === 1, 'HIGGSFIELD_BATCH_INTERACTION_UNQUALIFIED', 422);
  check(settings.is_inpaint !== true, 'HIGGSFIELD_MASK_ROUTE_UNQUALIFIED', 422);
  if (model.id === 'cinematic_studio_video_v2') {
    check(settings.multi_shots !== true, 'HIGGSFIELD_MULTISHOT_SCHEMA_UNQUALIFIED', 422);
    check(settings.speedramp !== 'custom', 'HIGGSFIELD_CUSTOM_SPEEDRAMP_UNQUALIFIED', 422);
  }
  if (model.id === 'seedance_2_0') check(mode !== 'fast' || !['1080p', '4k'].includes(settings.resolution), 'HIGGSFIELD_RESOLUTION_MODE_CONFLICT', 422);
  // Editorial source runtime is measured from the actual uploaded media; it is
  // not a freely entered planned duration in this local request composer.
  if (sourceVideoModels.has(model.id)) check(!Object.hasOwn(settings, 'duration'), 'HIGGSFIELD_SOURCE_DURATION_REQUIRED', 422);
  if (model.id === 'sync_so') check(Object.hasOwn(settings, 'sync_mode'), 'HIGGSFIELD_SYNC_MODE_SELECTION_REQUIRED', 422);
  if (model.id === 'topaz_video') check(!Object.hasOwn(settings, 'enhancement') && !Object.hasOwn(settings, 'frame_interpolation'), 'HIGGSFIELD_UNSTRUCTURED_TRANSFORM_UNQUALIFIED', 422);
  if (model.id === 'ms_image') check(filmmaking.marketingStyles.some(style => style.id === settings.style_id), 'HIGGSFIELD_MARKETING_STYLE_SELECTION_REQUIRED', 422);
  if (model.id === 'marketing_studio_video') {
    const format = filmmaking.marketingFormats.find(item => item.slug === settings.mode);
    check(format, 'HIGGSFIELD_MARKETING_FORMAT_SELECTION_REQUIRED', 422);
    if (settings.duration !== undefined) check(settings.duration >= format.minDurationSeconds && settings.duration <= format.maxDurationSeconds, 'HIGGSFIELD_MARKETING_FORMAT_DURATION', 422);
    if (settings.hook_id || settings.setting_id) check(['ugc', 'ugc_how_to', 'ugc_unboxing', 'ugc_virtual_try_on'].includes(settings.mode), 'HIGGSFIELD_MARKETING_SETUP_MODE_CONFLICT', 422);
    check(Object.hasOwn(settings, 'width') === Object.hasOwn(settings, 'height'), 'HIGGSFIELD_OUTPUT_DIMENSIONS_REQUIRED', 422);
  }
  for (const [name, value] of Object.entries(settings)) if (['style_id', 'brand_kit_id', 'folder_id', 'hook_id', 'setting_id', 'preset_id'].includes(name) && value !== null) check(text(value, 200, true), 'HIGGSFIELD_PROVIDER_SELECTION_INVALID', 422);
  for (const name of ['product_ids', 'avatar_ids', 'assets']) if (settings[name]) check(settings[name].every(id => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) && new Set(settings[name]).size === settings[name].length, 'HIGGSFIELD_PROVIDER_SELECTION_INVALID', 422);
  const compiled = {};
  for (const [name, definition] of definitions) {
    if (model.id === 'seedance_2_5' && mode === 'video_edit' && name === 'duration') continue;
    if (Object.hasOwn(settings, name)) compiled[name] = settings[name];
    else if (Object.hasOwn(definition, 'default')) compiled[name] = definition.default;
    else check(definition.required !== 'required', 'HIGGSFIELD_PARAMETER_REQUIRED', 422);
  }
  return compiled;
}

function ownedMedia(store, media, supportedRoles) {
  check(shape(media, ['role', 'sha256', 'label', 'mimeType']) && digest(media.sha256) && text(media.label, 500, true) &&
    ['image', 'start_image', 'end_image', 'video', 'audio'].includes(media.role) && text(media.mimeType, 100, true), 'HIGGSFIELD_LOCAL_MEDIA_INVALID', 422);
  check(supportedRoles.has(media.role), 'HIGGSFIELD_UNSUPPORTED_MEDIA_ROLE', 422);
  check(media.mimeType.startsWith(`${family(media.role)}/`), 'HIGGSFIELD_MEDIA_TYPE_MISMATCH', 422);
  const info = store.blobInfo(media.sha256);
  check(info.mimeType === media.mimeType, 'HIGGSFIELD_MEDIA_TYPE_MISMATCH', 422);
  return { ...media, byteLength: info.byteLength, status: 'UPLOAD_BINDING_REQUIRED', scope: 'USE_REVIEW_REQUIRED', crop: null };
}

function selectedBrief(store, input, sourceStatus) {
  if (!Object.hasOwn(input, 'brief')) return null;
  check(shape(input.brief, ['id', 'sha256']) && text(input.brief.id, 160, true) && input.brief.id.startsWith('generation-brief:') && digest(input.brief.sha256), 'HIGGSFIELD_BRIEF_REFERENCE_INVALID', 422);
  const record = store.rawList('generation-brief').find(item => item.id === input.brief.id);
  check(record && record.kind === 'generation-brief', 'HIGGSFIELD_BRIEF_NOT_FOUND', 404);
  check(record.sha256 === input.brief.sha256 && sha256(canonical(record.data)) === input.brief.sha256, 'HIGGSFIELD_REVISION_CONFLICT', 409);
  check(input.prompt === record.data.prompt, 'HIGGSFIELD_SAVED_PROMPT_CHANGED', 409);
  const context = dreaminaContext(store, record.data.sceneId, sourceStatus);
  check(record.data.basisHash === context.basisHash, 'STALE_DREAMINA_BASIS', 409);
  const prepared = previewDreamina(store, record.data, sourceStatus);
  return { record, prepared, context, binding: { id: record.id, sha256: record.sha256, version: record.version,
    sourceHash: record.data.sourceHash, sceneId: record.data.sceneId, basisHash: record.data.basisHash, promptSha256: sha256(record.data.prompt) } };
}

/** Creates no upload, account call, provider job, record revision or approval. */
export function composeHiggsfieldRequest(store, input, sourceStatus = 'PENDING_OWNER_ADMISSION') {
  check(shape(input, ['catalogSha256', 'modelId', 'prompt', 'settings', 'medias', ...(Object.hasOwn(input ?? {}, 'brief') ? ['brief'] : []), ...(Object.hasOwn(input ?? {}, 'taskId') ? ['taskId'] : [])]), 'HIGGSFIELD_COMPOSE_INPUT_INVALID', 422);
  check(input.catalogSha256 === catalogSha256, 'HIGGSFIELD_CATALOG_CHANGED', 409);
  check(composerModelIds.includes(input.modelId), 'HIGGSFIELD_MODEL_DISCOVERY_ONLY', 422);
  const model = catalog.models.find(item => item.id === input.modelId);
  check(model && text(input.prompt, limits.maxPromptCharacters), 'HIGGSFIELD_PROMPT_INVALID', 422);
  const explicitTask = Object.hasOwn(input, 'taskId');
  if (explicitTask) check(input.taskId === `generate_${model.output_type}`, 'HIGGSFIELD_TASK_MODEL_MISMATCH', 422);
  const frameCreation = explicitTask && input.taskId === 'generate_image';
  check(Array.isArray(input.medias) && input.medias.length <= limits.maxPlannedMedia, 'HIGGSFIELD_LOCAL_MEDIA_LIMIT', 422);
  const settings = settingsFor(model, input.settings), selected = selectedBrief(store, input, sourceStatus);
  const supportedRoles = new Set(model.medias.flatMap(item => item.roles ?? []).map(role => roleMap[role]).filter(Boolean));
  const mediaRequirements = input.medias.map(media => ownedMedia(store, media, supportedRoles));
  check(new Set(mediaRequirements.map(media => `${media.role}:${media.sha256}`)).size === mediaRequirements.length, 'HIGGSFIELD_DUPLICATE_MEDIA', 422);
  const skippedFrameLabels = new Set();
  if (selected) for (const item of selected.prepared.uploadSheet) {
    // Frame creation produces the missing storyboard illustration. An absent
    // illustration is not itself an input requirement; cast inputs still are.
    if (frameCreation && ['CLIP_OPENING_CANDIDATE', 'STORYBOARD_MOMENT'].includes(item.role) && !item.sha256) { skippedFrameLabels.add(item.label); continue; }
    const role = item.role === 'CLIP_OPENING_CANDIDATE' ? frameCreation ? 'image' : 'start_image' : ['SOURCE_VIDEO', 'MOTION_REFERENCE'].includes(item.role) ? 'video' : item.role === 'AUDIO_REFERENCE' ? 'audio' : 'image';
    mediaRequirements.push({ role, sha256: item.sha256, label: item.label, mimeType: item.mimeType, byteLength: item.byteLength,
      status: !supportedRoles.has(role) ? 'UNSUPPORTED_PROVIDER_ROLE' : item.status === 'ORIGINAL_NEEDS_REVIEW' ? 'UPLOAD_BINDING_REQUIRED' : item.status,
      sourceRole: item.role, crop: item.crop, scope: item.scope, cellId: item.cellId, characterId: item.characterId,
      ...(frameCreation && item.role === 'CLIP_OPENING_CANDIDATE' ? { rolePurpose: 'REFERENCE_FOR_NEW_STILL_NOT_VIDEO_OPENING' } : {}),
      ...(Object.hasOwn(item, 'originalUnmodified') ? { inMs: item.inMs, outMs: item.outMs, originalUnmodified: true, measurementRef: item.measurementRef, measuredDurationMs: item.measuredDurationMs } : {}) });
  }
  check(mediaRequirements.length <= limits.maxPlannedMedia, 'HIGGSFIELD_LOCAL_MEDIA_LIMIT', 422);
  for (const group of model.medias) {
    const roles = new Set((group.roles ?? []).map(role => roleMap[role]).filter(Boolean));
    const count = mediaRequirements.filter(item => roles.has(item.role)).length;
    if (group.required === true) check(count > 0, 'HIGGSFIELD_REFERENCE_MEDIA_REQUIRED', 422);
    if (Number.isSafeInteger(group.max)) check(count <= group.max, 'HIGGSFIELD_MODEL_MEDIA_LIMIT', 422);
  }
  for (const role of ['start_image', 'end_image']) check(mediaRequirements.filter(item => item.role === role).length <= 1, 'HIGGSFIELD_KEYFRAME_COUNT', 422);
  const videos = mediaRequirements.filter(item => item.role === 'video'), images = mediaRequirements.filter(item => item.role === 'image');
  if (model.id === 'seedance_2_5') {
    if (settings.mode === 't2v') check(mediaRequirements.length === 0, 'HIGGSFIELD_MODE_MEDIA_CONFLICT', 422);
    if (settings.mode === 'omni_reference') check(mediaRequirements.length > 0, 'HIGGSFIELD_REFERENCE_MEDIA_REQUIRED', 422);
    if (['video_edit', 'video_extension'].includes(settings.mode)) check(videos.length === 1 && mediaRequirements.length === 1, 'HIGGSFIELD_SINGLE_SOURCE_VIDEO_REQUIRED', 422);
  }
  if (['hf_mult_motion_control', 'hf_mult_replace_object'].includes(model.id)) check(videos.length === 1 && images.length >= 1, 'HIGGSFIELD_GENJUTSU_MEDIA_REQUIRED', 422);
  if (model.id === 'seed_audio') check(images.length <= 1, 'HIGGSFIELD_AUDIO_IMAGE_COUNT', 422);
  if (sourceImageModels.has(model.id)) check(images.length === 1 && mediaRequirements.length === 1, 'HIGGSFIELD_SINGLE_SOURCE_IMAGE_REQUIRED', 422);
  if (sourceVideoModels.has(model.id)) {
    const audios = mediaRequirements.filter(item => item.role === 'audio');
    check(videos.length === 1 && (model.id === 'sync_so' ? audios.length === 1 && mediaRequirements.length === 2 : mediaRequirements.length === 1), 'HIGGSFIELD_EDITORIAL_SOURCE_MEDIA_REQUIRED', 422);
  }
  const checks = [], add = (code, status, message) => checks.push({ code, status, message });
  add('CATALOG_BINDING', 'PASS', 'Parameters are bound to the exact retained model catalog. This does not attest a live provider connection.');
  add('PROMPT_TEXT', input.prompt.trim() ? 'PASS' : 'BLOCKED', input.prompt.trim() ? 'The prompt text is retained unchanged in this preparation.' : 'Supply or save the exact reviewed prompt before generation.');
  const elements = [...input.prompt.matchAll(/<<<([^<>]*)>>>/g)].map(match => match[1]);
  if (elements.length || input.prompt.includes('<<<') || input.prompt.includes('>>>')) {
    const compatible = ['nano_banana_pro', 'nano_banana_2', 'gpt_image_2', 'seedream_v4_5', 'seedream_v5_lite', 'cinematic_studio_2_5', 'kling3_0', 'cinematic_studio_3_0', 'cinematic_studio_video_v2', 'seedance_2_0'].includes(model.id);
    const remainder = input.prompt.replace(/<<<([^<>]*)>>>/g, '');
    const validIds = elements.length > 0 && !remainder.includes('<<<') && !remainder.includes('>>>') && elements.every(id => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id));
    add('REFERENCE_ELEMENTS', 'BLOCKED', !compatible ? 'This model is not in the observed Element support list. Preserve the prompt and choose a supported model or revise references explicitly.' : !validIds ? 'Element markers need exact provider UUIDs, not character names. No Element lookup was performed.' : 'Verify every Element is completed in the intended provider workspace and its use is permitted. Markers alone do not establish identity or approval.');
    if (model.id === 'kling3_0') add('ELEMENT_OPENING', mediaRequirements.some(item => item.role === 'start_image' && item.status === 'UPLOAD_BINDING_REQUIRED') ? 'PASS' : 'BLOCKED', 'Kling 3.0 Element use also requires an explicit starting image.');
  }
  if (explicitTask && !selected) add('SOURCE_SCOPE', 'PASS', 'This independent creative task has no linked screenplay. It does not require admission of an unrelated source or create source approval.');
  else add('SOURCE_ADMISSION', sourceStatus === 'ADMITTED' ? 'PASS' : 'BLOCKED', 'Canonical source admission remains separate from this request preparation.');
  if (selected) {
    add('SAVED_BRIEF', 'PASS', 'The exact saved brief, prompt and current dependencies match.');
    const opening = mediaRequirements.find(item => item.sourceRole === 'CLIP_OPENING_CANDIDATE');
    const sourceDriven = sourceVideoModels.has(model.id) || ['hf_mult_motion_control', 'hf_mult_replace_object'].includes(model.id) || model.id === 'seedance_2_5' && ['t2v', 'video_edit', 'video_extension'].includes(settings.mode);
    const needsOpening = !explicitTask || model.output_type === 'video' && !sourceDriven && Boolean(selected.record.data.initialFrameCellId);
    if (needsOpening) add('CLIP_OPENING', opening?.sha256 && opening.status === 'UPLOAD_BINDING_REQUIRED' ? 'PASS' : 'BLOCKED', 'The actual first selected-shot opening must be present and uncropped; a later moment cannot silently substitute. Unsupported start-image roles remain blocked.');
    else add('OPENING_SCOPE', 'PASS', frameCreation ? 'This task creates a still; an existing video opening is not required. Retained illustrations are explicitly treated as image references.' : 'This model/task does not require an opening image. Any selected references still require valid provider roles.');
    const excluded = new Set(['ACCOUNT_SETTINGS_UNVERIFIED', 'SETTINGS_INCOMPLETE', 'DURATION_REQUIRED']);
    if (!needsOpening) excluded.add('CLIP_OPENING_REQUIRED');
    if (frameCreation || model.output_type === 'audio' || sourceDriven) { excluded.add('STORYBOARD_PLAN_REQUIRED'); excluded.add('CLIP_COVERAGE_REVIEW_REQUIRED'); }
    for (const requirement of selected.prepared.requirements.filter(item => !excluded.has(item.code) && ![...skippedFrameLabels].some(label => item.message.startsWith(`${label}:`)))) add(`BRIEF_${requirement.code}`, 'BLOCKED', requirement.message);
    const cells = selected.record.data.cellIds.map(id => selected.context.cells.find(cell => cell.id === id));
    const start = cells[0]?.plannedTimestampMs;
    const fits = settings.duration === undefined || start == null || cells.every(cell => cell.plannedTimestampMs == null || cell.plannedTimestampMs - start <= settings.duration * 1000);
    if (!frameCreation && model.output_type === 'video' && !sourceDriven) add('CELL_TIMING', fits ? 'UNKNOWN' : 'BLOCKED', fits ? 'Cell timestamps and requested duration remain planning estimates; review actual dialogue and action timing.' : 'Selected moments exceed this provider duration. Review a meaningful split before execution.');
  }
  add('LOCAL_MEDIA', mediaRequirements.every(item => item.status === 'UPLOAD_BINDING_REQUIRED') ? 'PASS' : 'BLOCKED', 'Referenced originals must exist with matching hashes and types; crops, requested excerpts and unsupported roles require explicit preparation.');
  add('PROVIDER_UPLOAD_BINDINGS', mediaRequirements.length ? 'BLOCKED' : 'PASS', mediaRequirements.length ? 'Local asset hashes are not provider media UUIDs. The generation controls must upload and confirm the exact inputs before a media-bound quote.' : 'No reference media is planned for this prompt-only request.');
  add('REFERENCE_USE', mediaRequirements.length ? 'BLOCKED' : 'UNKNOWN', 'Casting, licence scope and permission to use references are not established by a hash or prepared prompt.');
  if (model.output_type === 'video') add('MEDIA_LIMITS', 'UNKNOWN', 'Source-video size, codec, runtime and reference-count limits were not fully returned by this catalog; provider-specific preflight is still required.');
  if (speechModels.has(model.id)) add('VOICE_BINDING', 'BLOCKED', 'The voice pair is retained as a planned choice. The generation controls recheck this exact voice in the chosen workspace; permission to use it remains an owner decision.');
  if (['ms_image', 'marketing_studio_video'].includes(model.id)) add('MARKETING_SELECTIONS', 'BLOCKED', 'Format/style is bound to retained discovery; verify selected product, avatar, brand, hook and setting identities in the current workspace. Sample catalog assets are not user assets or creative approval.');
  if (Object.keys(settings).some(name => ['folder_id', 'preset_id'].includes(name))) add('PROVIDER_SELECTIONS', 'BLOCKED', 'Verify these planned provider record identities in the selected workspace; this composer has not looked them up.');
  add('WORKSPACE_BINDING', 'BLOCKED', 'Reconfirm the active MCP workspace in the generation controls. A local preparation has no account or workspace authority.');
  add('COST_PREFLIGHT', 'UNKNOWN', 'No current media-bound cost, balance or allowance has been fetched. A parameter-only estimate would not prove complete reference validity.');
  add('OWNER_EXECUTION_APPROVAL', 'BLOCKED', 'No generation budget, creative approval or paid execution authority is created by this preparation.');
  add('DURABLE_EXECUTION', 'BLOCKED', 'This local plan carries no submission or returned-file receipt. The generation history records attempts, uncertain responses and retained outputs separately; no automatic paid retry is permitted.');
  const params = { model: model.id, prompt: input.prompt, ...settings };
  const estimateParams = { model: model.id, ...settings };
  const requiresSourceCost = sourceVideoModels.has(model.id) || sourceImageModels.has(model.id) || ['hf_mult_motion_control', 'hf_mult_replace_object', 'ms_image', 'marketing_studio_video'].includes(model.id) || model.id === 'seedance_2_5' && settings.mode === 'video_edit';
  const estimateCall = model.output_type === 'audio' || requiresSourceCost ? null : { tool: model.output_type === 'image' ? 'higgsfield_estimate_image_cost' : 'higgsfield_estimate_video_cost', arguments: { params: estimateParams }, scope: 'PARAMETERS_ONLY_NO_MEDIA' };
  return { snapshot: snapshot(), model: structuredClone(model), params, mediaRequirements, checks, estimateCall, generationCall: null,
    generationTool: `mcp__codex_apps__higgsfield_generate_${model.output_type}`,
    requestSha256: sha256(higgsfieldRequestJson(input)), readiness: 'PREPARATION_ONLY', executable: false,
    ...(explicitTask ? { taskId: input.taskId, actionCatalogSha256 } : {}),
    ...(selected ? { briefBinding: selected.binding } : {}) };
}
