import { projectOwnedContext } from './creative-project.mjs';
import { validateStudioOperation } from './studio-operation.mjs';

export const STUDIO_GENERATION_PHASES = Object.freeze(['PREPARING', 'PREPARED', 'PREPARATION_FAILED', 'SUBMITTING', 'SUBMISSION_UNKNOWN', 'SUBMITTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'RETAINED']);
const transitions = {
  PREPARING: ['PREPARED', 'PREPARATION_FAILED', 'CANCELLED'],
  PREPARED: ['PREPARING', 'SUBMITTING', 'PREPARATION_FAILED', 'CANCELLED'],
  PREPARATION_FAILED: [], SUBMITTING: ['SUBMISSION_UNKNOWN', 'SUBMITTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  SUBMISSION_UNKNOWN: ['SUBMITTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  SUBMITTED: ['PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'], PROCESSING: ['COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: ['RETAINED'], FAILED: [], CANCELLED: [], RETAINED: [],
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (value, code, status = 422) => { if (!value) throw Object.assign(new Error(code), { code, status }); };
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const text = (value, max) => typeof value === 'string' && value.length <= max && value.isWellFormed() && !value.includes('\0');
const fields = (value, keys, code) => need(object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','), code);
const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;

/** Provider fractions remain inside an exact bounded JSON string. */
export function studioGenerationDetails(source) {
  need(text(source, 1024 * 1024) && new TextEncoder().encode(source).byteLength <= 1024 * 1024, 'STUDIO_GENERATION_DETAILS_INVALID');
  let value; try { value = JSON.parse(source); } catch { need(false, 'STUDIO_GENERATION_DETAILS_INVALID'); }
  need(object(value), 'STUDIO_GENERATION_DETAILS_INVALID'); let count = 0;
  function visit(item, depth) {
    need(++count <= 100000 && depth <= 32, 'STUDIO_GENERATION_DETAILS_LIMIT');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number') { need(Number.isFinite(item), 'STUDIO_GENERATION_DETAILS_INVALID'); return; }
    if (typeof item === 'string') { need(text(item, 1024 * 1024), 'STUDIO_GENERATION_DETAILS_INVALID'); return; }
    if (Array.isArray(item)) { item.forEach(child => visit(child, depth + 1)); return; }
    need(object(item), 'STUDIO_GENERATION_DETAILS_INVALID');
    for (const [key, child] of Object.entries(item)) { need(text(key, 240) && !['__proto__', 'prototype', 'constructor'].includes(key), 'STUDIO_GENERATION_DETAILS_INVALID'); visit(child, depth + 1); }
  }
  visit(value, 0);
  if (Object.prototype.hasOwnProperty.call(value, 'evidenceHashes')) need(Array.isArray(value.evidenceHashes) && value.evidenceHashes.length <= 1000 && value.evidenceHashes.every(digest) && new Set(value.evidenceHashes).size === value.evidenceHashes.length, 'STUDIO_GENERATION_EVIDENCE_INVALID');
  if (Object.prototype.hasOwnProperty.call(value, 'outputs')) {
    need(Array.isArray(value.outputs) && value.outputs.length <= 1000, 'STUDIO_GENERATION_OUTPUTS_INVALID');
    const seen = new Set();
    for (const output of value.outputs) {
      fields(output, ['jobId', 'sha256', 'mimeType', 'byteLength', 'filename', 'status'], 'STUDIO_GENERATION_OUTPUTS_INVALID');
      need(id(output.jobId) && digest(output.sha256) && Number.isSafeInteger(output.byteLength) && output.byteLength > 0 && output.byteLength <= 256 * 1024 * 1024, 'STUDIO_GENERATION_OUTPUTS_INVALID');
      need(text(output.mimeType, 160) && /^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/.test(output.mimeType) && text(output.filename, 255) && output.filename.trim() && !/[\x00-\x1f\x7f/\\]/.test(output.filename) && !['.', '..'].includes(output.filename) && output.status === 'UNREVIEWED', 'STUDIO_GENERATION_OUTPUTS_INVALID');
      const key = `${output.jobId}:${output.sha256}`; need(!seen.has(key), 'STUDIO_GENERATION_OUTPUTS_INVALID'); seen.add(key);
    }
  }
  return value;
}

export function validateStudioGenerationIdentity(recordId, kind) {
  if (kind !== 'studio-generation' && !recordId?.startsWith('studio-generation:')) return;
  need(kind === 'studio-generation' && typeof recordId === 'string' && /^studio-generation:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(recordId), 'STUDIO_GENERATION_IDENTITY_INVALID');
}

export function validateStudioGeneration(data, project) {
  project = projectOwnedContext(project, 'studio-generation', data);
  fields(data, ['schemaVersion', 'projectId', 'sourceHash', 'operationRef', 'provider', 'phase', 'createdAtMs', 'updatedAtMs', 'detailsJson'], 'STUDIO_GENERATION_FIELDS_INVALID');
  need(data.schemaVersion === 1 && id(data.projectId) && (data.sourceHash === null || digest(data.sourceHash)) && data.provider === 'HIGGSFIELD_MCP' && STUDIO_GENERATION_PHASES.includes(data.phase), 'STUDIO_GENERATION_SCOPE_INVALID');
  if (project) need(project.id === data.projectId && project.sourceHash === data.sourceHash && (data.sourceHash !== null || project.profile === 'caniscreenwrite-creative/v1'), 'STUDIO_GENERATION_PROJECT_MISMATCH');
  fields(data.operationRef, ['id', 'version', 'sha256'], 'STUDIO_GENERATION_OPERATION_INVALID');
  need(id(data.operationRef.id) && data.operationRef.id.startsWith('studio-operation:') && data.operationRef.id.length > 'studio-operation:'.length && Number.isSafeInteger(data.operationRef.version) && data.operationRef.version > 0 && data.operationRef.version < 2147483647 && digest(data.operationRef.sha256), 'STUDIO_GENERATION_OPERATION_INVALID');
  need(timestamp(data.createdAtMs) && timestamp(data.updatedAtMs) && data.updatedAtMs >= data.createdAtMs, 'STUDIO_GENERATION_TIMESTAMP_INVALID');
  studioGenerationDetails(data.detailsJson); return data;
}

export function validateStudioGenerationTransition(previous, next) {
  validateStudioGeneration(next);
  if (!previous) { need(next.phase === 'PREPARING' && next.updatedAtMs === next.createdAtMs, 'STUDIO_GENERATION_INITIAL_PHASE_INVALID', 409); return next; }
  validateStudioGeneration(previous);
  need(['schemaVersion', 'projectId', 'sourceHash', 'provider', 'createdAtMs'].every(key => previous[key] === next[key]) && ['id', 'version', 'sha256'].every(key => previous.operationRef[key] === next.operationRef[key]), 'STUDIO_GENERATION_IDENTITY_CHANGED', 409);
  need(next.updatedAtMs >= previous.updatedAtMs, 'STUDIO_GENERATION_TIME_REVERSED', 409);
  need(previous.phase === next.phase || transitions[previous.phase].includes(next.phase), 'STUDIO_GENERATION_PHASE_INVALID', 409);
  return next;
}

/** References resolve from owned history/blobs; status text alone grants no authority. */
export function validateStudioGenerationReferences(data, lookupOperation, lookupBlob) {
  const record = lookupOperation(data.operationRef);
  need(record?.kind === 'studio-operation' && record.id === data.operationRef.id && record.version === data.operationRef.version && record.sha256 === data.operationRef.sha256, 'STUDIO_GENERATION_OPERATION_MISSING_OR_CHANGED', 409);
  validateStudioOperation(record.data);
  need(record.data.sourceHash === data.sourceHash && (data.sourceHash !== null || record.data.projectId === data.projectId), 'STUDIO_GENERATION_OPERATION_SCOPE_MISMATCH', 409);
  const details = studioGenerationDetails(data.detailsJson);
  if (lookupBlob) {
    for (const hash of details.evidenceHashes ?? []) need(lookupBlob(hash), 'STUDIO_GENERATION_EVIDENCE_MISSING', 409);
    for (const output of details.outputs ?? []) { const blob = lookupBlob(output.sha256); need(blob && blob.mimeType === output.mimeType && blob.byteLength === output.byteLength, 'STUDIO_GENERATION_OUTPUT_MISSING_OR_CHANGED', 409); }
  }
  return data;
}
