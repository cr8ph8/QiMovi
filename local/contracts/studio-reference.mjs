import { projectOwnedContext } from './creative-project.mjs';
import { validateStudioOperation, studioSettings } from './studio-operation.mjs';

export const STUDIO_REFERENCE_PHASES = Object.freeze(['PREPARING', 'PREPARED', 'CREATING', 'CREATED', 'CREATION_UNKNOWN', 'PREPARATION_FAILED', 'FAILED']);
const transitions = { PREPARING: ['PREPARED', 'PREPARATION_FAILED'], PREPARED: ['CREATING', 'PREPARATION_FAILED'], CREATING: ['CREATED', 'CREATION_UNKNOWN', 'FAILED'], CREATED: [], CREATION_UNKNOWN: ['CREATED', 'FAILED'], PREPARATION_FAILED: [], FAILED: [] };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const need = (value, code, status = 422) => { if (!value) throw Object.assign(new Error(code), { code, status }); };
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const text = (value, max) => typeof value === 'string' && value.length <= max && value.isWellFormed() && !value.includes('\0');
const fields = (value, keys, code) => need(object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','), code);
const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;

/** Exact provider details stay a bounded JSON string; fractions do not change
 * the canonical workspace serializer. Provider creation is not use approval. */
export function studioReferenceDetails(source) {
  need(text(source, 1024 * 1024) && new TextEncoder().encode(source).byteLength <= 1024 * 1024, 'STUDIO_REFERENCE_DETAILS_INVALID');
  let value; try { value = JSON.parse(source); } catch { need(false, 'STUDIO_REFERENCE_DETAILS_INVALID'); }
  need(object(value), 'STUDIO_REFERENCE_DETAILS_INVALID'); let count = 0;
  const visit = (entry, depth) => {
    need(++count <= 100000 && depth <= 32, 'STUDIO_REFERENCE_DETAILS_LIMIT');
    if (entry === null || typeof entry === 'boolean') return;
    if (typeof entry === 'number') { need(Number.isFinite(entry), 'STUDIO_REFERENCE_DETAILS_INVALID'); return; }
    if (typeof entry === 'string') { need(text(entry, 1024 * 1024), 'STUDIO_REFERENCE_DETAILS_INVALID'); return; }
    if (Array.isArray(entry)) { entry.forEach(child => visit(child, depth + 1)); return; }
    need(object(entry), 'STUDIO_REFERENCE_DETAILS_INVALID');
    for (const [key, child] of Object.entries(entry)) { need(text(key, 240) && !['__proto__', 'prototype', 'constructor'].includes(key), 'STUDIO_REFERENCE_DETAILS_INVALID'); visit(child, depth + 1); }
  };
  visit(value, 0);
  if (own(value, 'evidenceHashes')) need(Array.isArray(value.evidenceHashes) && value.evidenceHashes.length <= 1000 && value.evidenceHashes.every(digest) && new Set(value.evidenceHashes).size === value.evidenceHashes.length, 'STUDIO_REFERENCE_EVIDENCE_INVALID');
  return value;
}

export function validateStudioReferenceIdentity(recordId, kind) {
  if (kind !== 'studio-reference' && !recordId?.startsWith('studio-reference:')) return;
  need(kind === 'studio-reference' && typeof recordId === 'string' && /^studio-reference:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(recordId), 'STUDIO_REFERENCE_IDENTITY_INVALID');
}

export function validateStudioReference(data, project) {
  project = projectOwnedContext(project, 'studio-reference', data);
  fields(data, ['schemaVersion', 'projectId', 'sourceHash', 'operationRef', 'provider', 'phase', 'createdAtMs', 'updatedAtMs', 'detailsJson'], 'STUDIO_REFERENCE_FIELDS_INVALID');
  need(data.schemaVersion === 1 && id(data.projectId) && (data.sourceHash === null || digest(data.sourceHash)) && data.provider === 'HIGGSFIELD_MCP' && STUDIO_REFERENCE_PHASES.includes(data.phase), 'STUDIO_REFERENCE_SCOPE_INVALID');
  if (project) need(project.id === data.projectId && project.sourceHash === data.sourceHash && (data.sourceHash !== null || project.profile === 'caniscreenwrite-creative/v1'), 'STUDIO_REFERENCE_PROJECT_MISMATCH');
  fields(data.operationRef, ['id', 'version', 'sha256'], 'STUDIO_REFERENCE_OPERATION_INVALID');
  need(id(data.operationRef.id) && data.operationRef.id.startsWith('studio-operation:') && data.operationRef.id.length > 'studio-operation:'.length && Number.isSafeInteger(data.operationRef.version) && data.operationRef.version > 0 && data.operationRef.version < 2147483647 && digest(data.operationRef.sha256), 'STUDIO_REFERENCE_OPERATION_INVALID');
  need(timestamp(data.createdAtMs) && timestamp(data.updatedAtMs) && data.updatedAtMs >= data.createdAtMs, 'STUDIO_REFERENCE_TIMESTAMP_INVALID');
  studioReferenceDetails(data.detailsJson); return data;
}

export function validateStudioReferenceTransition(previous, next) {
  validateStudioReference(next);
  if (!previous) { need(next.phase === 'PREPARING' && next.updatedAtMs === next.createdAtMs, 'STUDIO_REFERENCE_INITIAL_PHASE_INVALID', 409); return next; }
  validateStudioReference(previous);
  need(['schemaVersion', 'projectId', 'sourceHash', 'provider', 'createdAtMs'].every(key => previous[key] === next[key]) && ['id', 'version', 'sha256'].every(key => previous.operationRef[key] === next.operationRef[key]), 'STUDIO_REFERENCE_IDENTITY_CHANGED', 409);
  need(next.updatedAtMs >= previous.updatedAtMs, 'STUDIO_REFERENCE_TIME_REVERSED', 409);
  need(previous.phase === next.phase || transitions[previous.phase].includes(next.phase), 'STUDIO_REFERENCE_PHASE_INVALID', 409);
  return next;
}

export function validateStudioReferenceReferences(data, lookupOperation, lookupBlob) {
  const record = lookupOperation(data.operationRef);
  need(record?.kind === 'studio-operation' && record.id === data.operationRef.id && record.version === data.operationRef.version && record.sha256 === data.operationRef.sha256, 'STUDIO_REFERENCE_OPERATION_MISSING_OR_CHANGED', 409);
  validateStudioOperation(record.data);
  need(record.data.sourceHash === data.sourceHash && (data.sourceHash !== null || record.data.projectId === data.projectId), 'STUDIO_REFERENCE_OPERATION_SCOPE_MISMATCH', 409);
  need(record.data.taskId === 'show_reference_elements' && studioSettings(record.data.settingsJson).action === 'create', 'STUDIO_REFERENCE_CREATION_OPERATION_REQUIRED', 409);
  if (lookupBlob) {
    for (const media of record.data.medias) { const blob = lookupBlob(media.sha256); need(blob && blob.mimeType === media.mimeType, 'STUDIO_REFERENCE_INPUT_MISSING_OR_CHANGED', 409); }
    for (const hash of studioReferenceDetails(data.detailsJson).evidenceHashes ?? []) need(lookupBlob(hash), 'STUDIO_REFERENCE_EVIDENCE_MISSING', 409);
  }
  return data;
}
