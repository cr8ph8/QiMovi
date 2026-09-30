import { projectOwnedContext } from '../contracts/creative-project.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { check, sha256 } from './storage.mjs';
import { getHiggsfieldTools, higgsfieldRequestJson } from '../providers/higgsfield-tools.mjs';
import { studioSettings } from '../contracts/studio-operation.mjs';
import { studioReferenceDetails } from '../contracts/studio-reference.mjs';
import { mcpToolData, uploadOwnedMedia, mediaUrl } from './higgsfield-mcp-media.mjs';
import { elementIdentity, validateReferenceCreateArguments } from './higgsfield-production-references.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const jobId = value => typeof value === 'string' && value.startsWith('studio-reference:') && uuid(value.slice(17));
const hash = value => sha256(higgsfieldRequestJson(value));
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const errorCode = error => /^(?:HIGGSFIELD_|STUDIO_|STALE_)/.test(error?.code ?? '') ? error.code : 'STUDIO_REFERENCE_UNAVAILABLE';

/** Shared project reference authoring. Uses the workspace's existing history
 * and blob store; creating a provider asset never admits or rewrites a script. */
export function createStudioReferenceService(store, bridge, { now = Date.now, uploadImpl = uploadOwnedMedia } = {}) {
  let busy = false, closing = false, active = null;
  const project = () => store.resolvedProject();
  const scoped = value => ({ projectId: project().id, sourceHash: project().sourceHash, ...value });
  function get(id) {
    check(jobId(id), 'STUDIO_REFERENCE_ID_INVALID', 422);
    const row = store.rawList('studio-reference').find(record => record.id === id);
    check(row, 'STUDIO_REFERENCE_NOT_FOUND', 404); store.validateSavedRecord(row); return row;
  }
  function save(record, phase, details) {
    details.evidenceHashes = [...new Set(details.evidenceHashes)];
    return store.saveStudioReferenceRecord(record.id, { kind: 'studio-reference', expectedVersion: record.version, requestId: crypto.randomUUID(), data: { ...record.data, phase, updatedAtMs: now(), detailsJson: JSON.stringify(details) } });
  }
  function evidence(raw) {
    const bytes = Buffer.from(JSON.stringify(raw)); check(bytes.length <= 4 * 1024 * 1024, 'HIGGSFIELD_RESPONSE_LIMIT', 502);
    const file = path.join(store.directory, 'blobs', `reference-evidence-${crypto.randomUUID()}.tmp`);
    try { fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 }); return store.putBlob(file, 'application/json').sha256; }
    finally { if (fs.existsSync(file)) fs.unlinkSync(file); }
  }
  function operation(ref) {
    check(exact(ref, ['id', 'version', 'sha256']) && Number.isSafeInteger(ref.version) && digest(ref.sha256), 'STUDIO_REFERENCE_OPERATION_INVALID', 422);
    const row = store.rawList('studio-operation').find(record => record.id === ref.id);
    check(row && row.version === ref.version && row.sha256 === ref.sha256, 'STUDIO_REFERENCE_OPERATION_CHANGED', 409);
    store.validateSavedRecord(row); return row;
  }
  function plan(row) {
    const data = row.data, settings = studioSettings(data.settingsJson), catalog = getHiggsfieldTools();
    for (const [key, kind, code] of [['castingRef', 'casting-draft', 'STUDIO_REFERENCE_CASTING_CHANGED'], ['writingRef', 'screenplay-draft', 'STUDIO_REFERENCE_WRITING_CHANGED']]) {
      if (!data[key]) continue;
      const ref = data[key], head = store.rawList(kind).find(record => record.id === ref.id);
      check(head && head.version === ref.version && head.sha256 === ref.sha256, code, 409);
      store.validateSavedRecord(head);
    }
    check(data.taskId === 'show_reference_elements' && data.modelId === '' && data.briefRef === null && settings.action === 'create', 'STUDIO_REFERENCE_CREATION_OPERATION_REQUIRED', 422);
    check(data.catalogSha256 === catalog.snapshot.catalogSha256, 'STUDIO_REFERENCE_CATALOG_CHANGED', 409);
    check(Object.keys(settings).every(key => ['action', 'name', 'category'].includes(key)), 'STUDIO_REFERENCE_SETTINGS_INVALID', 422);
    check(settings.name === undefined || typeof settings.name === 'string' && settings.name.trim().length > 0 && settings.name.length <= 32 && !/[\u0000-\u001f\u007f]/.test(settings.name), 'STUDIO_REFERENCE_NAME_INVALID', 422);
    check(settings.category === undefined || ['auto', 'character', 'environment', 'prop'].includes(settings.category), 'STUDIO_REFERENCE_CATEGORY_INVALID', 422);
    check(data.prompt.length <= 16000, 'STUDIO_REFERENCE_DESCRIPTION_INVALID', 422);
    check(data.medias.length > 0 && data.medias.length <= 8 && data.medias.every(media => media.role === 'image' && extensions[media.mimeType]) && new Set(data.medias.map(media => media.sha256)).size === data.medias.length, 'STUDIO_REFERENCE_IMAGES_REQUIRED', 422);
    for (const media of data.medias) { const blob = store.blob(media.sha256); check(blob.mimeType === media.mimeType && sha256(blob.bytes) === media.sha256, 'STUDIO_REFERENCE_MEDIA_CHANGED', 409); }
    return { params: { ...settings, category: settings.category ?? 'auto', ...(data.prompt ? { description: data.prompt } : {}) }, media: data.medias };
  }
  function session() { return bridge.productionSession(); }
  function capabilities(connected) {
    const actions = { list_workspaces: {}, workspace_select: { workspace_id: 'string' }, media_upload: { filename: 'string', content_type: 'string', method: 'string' }, media_confirm: { media_id: 'string', type: 'string' }, show_reference_elements: { action: 'string', name: 'string', category: 'string', description: 'string', medias: 'array', element_id: 'string' } };
    const selected = [];
    for (const [action, fields] of Object.entries(actions)) {
      const matches = connected.tools.filter(tool => tool.name === action || tool.name === `higgsfield_${action}`), schema = matches[0]?.inputSchema;
      check(matches.length === 1 && schema?.type === 'object' && (schema.required ?? []).every(key => Object.hasOwn(fields, key)) && Object.entries(fields).every(([key, type]) => schema.properties?.[key]?.type === type), 'HIGGSFIELD_REFERENCE_CAPABILITY_UNAVAILABLE', 409);
      if (action === 'show_reference_elements') {
        check(!schema.properties.action.enum || ['list', 'get', 'create'].every(mode => schema.properties.action.enum.includes(mode)), 'HIGGSFIELD_REFERENCE_CAPABILITY_UNAVAILABLE', 409);
        const media = schema.properties.medias.items;
        check(media?.type === 'object' && ['id', 'type', 'url'].every(key => media.properties?.[key]?.type === 'string'), 'HIGGSFIELD_REFERENCE_CAPABILITY_UNAVAILABLE', 409);
      }
      selected.push({ action, schema });
    }
    check(typeof bridge.referenceCreateCall === 'function', 'HIGGSFIELD_REFERENCE_CAPABILITY_UNAVAILABLE', 409);
    return hash(selected);
  }
  async function call(action, args, connectionId) {
    check(!closing, 'STUDIO_REFERENCE_CLOSING', 409); return bridge.productionCall(action, args, connectionId);
  }
  async function workspaces(connectionId) {
    const data = mcpToolData(await call('list_workspaces', {}, connectionId));
    check(Array.isArray(data.workspaces) && data.workspaces.length <= 200 && data.workspaces.every(row => uuid(row.id) && typeof row.is_selected === 'boolean' && (row.name === null || typeof row.name === 'string' && row.name.length <= 500)) && new Set(data.workspaces.map(row => row.id)).size === data.workspaces.length, 'HIGGSFIELD_WORKSPACES_INVALID', 502);
    return data.workspaces;
  }
  async function requireWorkspace(details) {
    const selected = (await workspaces(details.connectionId)).filter(row => row.is_selected);
    check(selected.length === 1 && selected[0].id === details.workspaceId, 'HIGGSFIELD_WORKSPACE_CHANGED', 409); return selected[0];
  }
  function current(record, details) {
    check(!closing, 'STUDIO_REFERENCE_CLOSING', 409);
    const op = operation(record.data.operationRef);
    check(hash(plan(op)) === details.planSha256, 'STUDIO_REFERENCE_CONTEXT_CHANGED', 409);
    const connected = session(); check(connected.connectionId === details.connectionId, 'HIGGSFIELD_CONNECTION_CHANGED', 409);
    check(capabilities(connected) === details.capabilitiesSha256, 'HIGGSFIELD_REFERENCE_CAPABILITY_CHANGED', 409);
    return op;
  }
  async function exclusive(work) {
    check(!busy && !closing, 'STUDIO_REFERENCE_BUSY', 409); busy = true;
    const controller = new AbortController(); let done;
    active = { controller, done: new Promise(resolve => { done = resolve; }) };
    try { return await work(controller.signal); } finally { active = null; busy = false; done(); }
  }
  // Interrupted writes can be inspected after restart, but never auto-reissued.
  for (const row of store.rawList('studio-reference')) {
    if (row.data.phase === 'PREPARING') save(row, 'PREPARATION_FAILED', { ...studioReferenceDetails(row.data.detailsJson), error: 'STUDIO_REFERENCE_PREPARATION_INTERRUPTED' });
    if (row.data.phase === 'CREATING') save(row, 'CREATION_UNKNOWN', { ...studioReferenceDetails(row.data.detailsJson), error: 'STUDIO_REFERENCE_RESTART_DURING_CREATION' });
  }
  return {
    list: () => scoped({ records: store.rawList('studio-reference').map(row => { store.validateSavedRecord(row); return row; }) }),
    workspaces: () => exclusive(async () => scoped({ workspaces: await workspaces(session().connectionId) })),
    prepare: input => exclusive(async signal => {
      check(exact(input, ['jobId', 'operationRef', 'workspaceId', 'referenceUseConfirmed']) && jobId(input.jobId) && uuid(input.workspaceId) && input.referenceUseConfirmed === true, 'STUDIO_REFERENCE_PREPARE_INVALID', 422);
      const prepareInputSha256 = hash(input), prior = store.rawList('studio-reference').find(row => row.id === input.jobId);
      if (prior) { store.validateSavedRecord(prior); check(studioReferenceDetails(prior.data.detailsJson).prepareInputSha256 === prepareInputSha256, 'STUDIO_REFERENCE_RETRY_CHANGED', 409); return prior; }
      const op = operation(input.operationRef), prepared = plan(op), connected = session(), capabilitiesSha256 = capabilities(connected), p = projectOwnedContext(project(), 'studio-operation', op.data);
      const details = { title: op.data.title, prepareInputSha256, planSha256: hash(prepared), capabilitiesSha256, workspaceId: input.workspaceId, workspaceName: null, connectionId: connected.connectionId, params: prepared.params, media: prepared.media, referenceUseConfirmed: true, uploads: [], element: null, costStatus: 'NOT_PROVIDED_BY_TOOL', evidenceHashes: [], error: null };
      const createdAtMs = now();
      let record = store.saveStudioReferenceRecord(input.jobId, { kind: 'studio-reference', expectedVersion: null, requestId: crypto.randomUUID(), data: { schemaVersion: 1, projectId: p.id, sourceHash: p.sourceHash, operationRef: input.operationRef, provider: 'HIGGSFIELD_MCP', phase: 'PREPARING', createdAtMs, updatedAtMs: createdAtMs, detailsJson: JSON.stringify(details) } });
      try {
        const chosen = (await workspaces(details.connectionId)).find(row => row.id === details.workspaceId);
        check(chosen, 'HIGGSFIELD_WORKSPACE_NOT_AVAILABLE', 409);
        if (!chosen.is_selected) mcpToolData(await call('workspace_select', { workspace_id: chosen.id }, details.connectionId));
        details.workspaceName = (await requireWorkspace(details)).name; record = save(record, 'PREPARING', details);
        for (const media of details.media) {
          current(record, details); await requireWorkspace(details);
          const blob = store.blob(media.sha256);
          const uploaded = await uploadImpl({ blob: { bytes: blob.bytes, sha256: media.sha256, mimeType: media.mimeType }, filename: `reference-${media.sha256.slice(0, 16)}.${extensions[media.mimeType]}`, signal, includeBackendUrl: true,
            callTool: async (action, args) => { current(record, details); await requireWorkspace(details); return call(action, args, details.connectionId); },
            onAllocated: async allocation => { details.uploads.push(allocation); record = save(record, 'PREPARING', details); } });
          check(uploaded.sha256 === media.sha256 && uploaded.mimeType === media.mimeType && uploaded.status === 'uploaded' && uuid(uploaded.mediaId), 'HIGGSFIELD_UPLOAD_RECEIPT_INVALID', 502);
          mediaUrl(uploaded.mediaUrl);
          check(details.uploads.some(row => row.mediaId === uploaded.mediaId && row.sha256 === uploaded.sha256), 'HIGGSFIELD_UPLOAD_RECEIPT_INVALID', 502);
          details.uploads = details.uploads.map(row => row.mediaId === uploaded.mediaId ? uploaded : row); record = save(record, 'PREPARING', details);
        }
        details.params.medias = details.uploads.map(row => ({ id: row.mediaId, type: 'media_input', url: row.mediaUrl }));
        validateReferenceCreateArguments(details.params); current(record, details); await requireWorkspace(details);
        details.requestSha256 = hash(details.params); return save(record, 'PREPARED', details);
      } catch (error) { details.error = errorCode(error); return save(record, 'PREPARATION_FAILED', details); }
    }),
    create: input => exclusive(async () => {
      check(exact(input, ['jobId', 'expectedVersion', 'creationAuthorized']) && Number.isSafeInteger(input.expectedVersion) && input.creationAuthorized === true, 'STUDIO_REFERENCE_APPROVAL_INVALID', 422);
      let record = get(input.jobId); const details = studioReferenceDetails(record.data.detailsJson);
      if (['CREATING', 'CREATED', 'CREATION_UNKNOWN', 'FAILED'].includes(record.data.phase)) return record;
      check(record.data.phase === 'PREPARED', 'STUDIO_REFERENCE_NOT_PREPARED', 409);
      if (input.expectedVersion !== record.version) return record;
      try {
        current(record, details); await requireWorkspace(details); current(record, details);
        validateReferenceCreateArguments(details.params); check(hash(details.params) === details.requestSha256, 'STUDIO_REFERENCE_REQUEST_CHANGED', 409);
        details.approval = { authorizedAtMs: now(), requestSha256: details.requestSha256, maximumAttempts: 1 }; details.error = null;
      } catch (error) { details.error = errorCode(error); return save(record, 'PREPARATION_FAILED', details); }
      record = save(record, 'CREATING', details);
      try {
        const raw = await bridge.referenceCreateCall(details.params, details.connectionId);
        // Retain the exact ID as soon as it is present, even if the rest of the
        // provider response cannot yet qualify. Refresh never searches by name.
        let response;
        try { response = mcpToolData(raw); if (uuid(response.element?.id)) details.providerElementId = response.element.id.toLowerCase(); }
        finally { details.evidenceHashes.push(evidence(raw)); }
        check(object(response.element) && uuid(response.element.id), 'HIGGSFIELD_REFERENCE_CREATE_RESULT_INVALID', 502);
        details.element = elementIdentity(response.element, details.providerElementId, { requireCompleted: false });
        return save(record, 'CREATED', details);
      } catch (error) {
        details.error = errorCode(error);
        return save(record, error.requestMayHaveBeenSent === false ? 'FAILED' : 'CREATION_UNKNOWN', details);
      }
    }),
    refresh: input => exclusive(async () => {
      check(exact(input, ['jobId']), 'STUDIO_REFERENCE_REFRESH_INVALID', 422);
      const record = get(input.jobId), details = studioReferenceDetails(record.data.detailsJson), id = details.element?.id ?? details.providerElementId;
      check(['CREATED', 'CREATION_UNKNOWN'].includes(record.data.phase) && uuid(id), 'STUDIO_REFERENCE_EXACT_ID_REQUIRED', 409);
      try {
        // Readback can use a fresh sign-in after restart, in the same selected
        // workspace. The original creation connection and approval stay intact.
        const observationConnectionId = session().connectionId, observationScope = { ...details, connectionId: observationConnectionId };
        await requireWorkspace(observationScope);
        const raw = await call('show_reference_elements', { action: 'get', element_id: id }, observationConnectionId);
        details.evidenceHashes.push(evidence(raw)); const data = mcpToolData(raw);
        check(Array.isArray(data.items) && data.items.length === 1 && !Object.hasOwn(data, 'element'), 'HIGGSFIELD_ELEMENT_RESPONSE_INVALID', 502);
        const element = elementIdentity(data.items[0], id, { requireCompleted: false }); await requireWorkspace(observationScope);
        details.element = element; details.lastObservationConnectionId = observationConnectionId; details.error = null; return save(record, 'CREATED', details);
      } catch (error) { details.error = errorCode(error); return save(record, record.data.phase, details); }
    }),
    async close() { closing = true; if (active) { const pending = active; pending.controller.abort(); await pending.done; } },
  };
}
