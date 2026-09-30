import crypto from 'node:crypto';
import { hashCanonical } from '../kernel/src/canonical-json.mjs';
import { validateStudioOperation, validateStudioOperationIdentity, studioSettings } from '../contracts/studio-operation.mjs';
import { HIGGSFIELD_RUNTIME } from './higgsfield-runtime.mjs';

// LOCAL contracts, not claims about the CLI's undocumented successful JSON envelopes.
// Qualified CLI: https://github.com/higgsfield-ai/cli/tree/v1.1.24
// `generate cost` can auto-upload paths, just like `generate create`. An execution
// adapter must use separately approved, owned upload UUIDs rather than local paths.
// Public REST request_id/credits/images schemas must not be applied to this CLI.
export const HIGGSFIELD_CLI_RESPONSE_LIMIT = 4 * 1024 * 1024;
const roles = ['image', 'start_image', 'end_image', 'video', 'audio'];
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code, status: 422 }); };
const shape = (value, fields, code) => need(object(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(','), code);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

/** Prepare an immutable, non-executable binding from a server-read saved operation.
 * mediaBindings belong to this selected provider workspace; the caller must resolve
 * uploaded IDs from its owned receipts, never accept an arbitrary client ID as proof.
 * This module deliberately neither reads credentials nor invokes a provider.
 */
export function buildHiggsfieldExecutionBinding(input) {
  shape(input, ['operationRecord', 'project', 'workspaceId', 'cliModelId', 'modelSchemaResponseSha256', 'mediaBindings'], 'HIGGSFIELD_BINDING_FIELDS_INVALID');
  const { operationRecord: record, project, workspaceId, cliModelId, modelSchemaResponseSha256, mediaBindings } = input;
  need(object(record) && record.kind === 'studio-operation' && typeof record.id === 'string' && record.id.startsWith('studio-operation:'), 'HIGGSFIELD_SAVED_OPERATION_REQUIRED');
  validateStudioOperationIdentity(record.id, record.kind);
  need(Number.isSafeInteger(record.version) && record.version > 0 && digest(record.sha256) && record.sha256 === hashCanonical(record.data), 'HIGGSFIELD_SAVED_OPERATION_HASH_MISMATCH');
  need(object(project) && identifier(project.id), 'HIGGSFIELD_PROJECT_REQUIRED');
  const data = validateStudioOperation(record.data, project);
  need(identifier(workspaceId), 'HIGGSFIELD_WORKSPACE_REQUIRED');
  // Explicit mapping: e.g. the saved MCP model nano_banana_pro is NOT the CLI's
  // nano_banana_2. Equality is neither required nor used to infer compatibility.
  need(typeof cliModelId === 'string' && /^[a-z][a-z0-9_]{0,119}$/.test(cliModelId), 'HIGGSFIELD_CLI_MODEL_INVALID');
  need(modelSchemaResponseSha256 === null || digest(modelSchemaResponseSha256), 'HIGGSFIELD_MODEL_SCHEMA_HASH_INVALID');
  need(Array.isArray(mediaBindings) && mediaBindings.length === data.medias.length, 'HIGGSFIELD_MEDIA_BINDING_MISMATCH');
  const boundMedia = mediaBindings.map((media, index) => {
    shape(media, ['role', 'sha256', 'mimeType', 'byteLength', 'uploadId', 'rawUploadResponseSha256'], 'HIGGSFIELD_MEDIA_BINDING_FIELDS_INVALID');
    const saved = data.medias[index];
    need(roles.includes(media.role) && media.role === saved.role && media.sha256 === saved.sha256 && media.mimeType === saved.mimeType, 'HIGGSFIELD_MEDIA_BINDING_MISMATCH');
    need(Number.isSafeInteger(media.byteLength) && media.byteLength > 0 && media.byteLength <= 256 * 1024 * 1024, 'HIGGSFIELD_MEDIA_SIZE_INVALID');
    need(media.uploadId === null && media.rawUploadResponseSha256 === null || uuid(media.uploadId) && digest(media.rawUploadResponseSha256), 'HIGGSFIELD_UPLOAD_BINDING_INVALID');
    return { ...media };
  });
  // Provider fractions remain inside the exact original JSON string; canonical
  // workspace numbers remain integers. No argument list is executable at this gate.
  const settings = studioSettings(data.settingsJson);
  const separateOptions = new Set(['prompt', 'image', 'video', 'audio', 'image-references', 'video-references', 'audio-references', 'start-image', 'end-image', 'json', 'wait', 'wait-timeout', 'wait-interval', 'no-color', 'help', 'version', 'workspace', 'workspace-id', 'token', 'api-key', 'api-key-id', 'api-key-secret', 'auth', 'profile']);
  for (const key of Object.keys(settings)) {
    need(/^[A-Za-z][A-Za-z0-9_-]{0,119}$/.test(key) && !separateOptions.has(key.replaceAll('_', '-').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()), 'HIGGSFIELD_SEPARATE_OPTION_IN_SETTINGS');
  }
  const request = {
    cliModelId, prompt: data.prompt, settingsJson: data.settingsJson,
    media: boundMedia.map(({ role, uploadId }) => ({ role, uploadId })),
  };
  const binding = {
    schemaVersion: 'caniscreenwrite-higgsfield-execution-binding/v1',
    operationRef: { id: record.id, version: record.version, sha256: record.sha256 },
    projectId: project.id, sourceHash: data.sourceHash, target: clone(data.target),
    transport: { kind: 'HIGGSFIELD_OFFICIAL_CLI', version: HIGGSFIELD_RUNTIME.version, binarySha256: HIGGSFIELD_RUNTIME.binarySha256 },
    workspaceId, savedModelId: data.modelId, savedCatalogSha256: data.catalogSha256,
    cliModelId, modelSchemaResponseSha256, request, requestSha256: hashCanonical(request),
    mediaBindings: boundMedia,
  };
  const blockers = ['CLI_RESPONSE_SCHEMAS_UNQUALIFIED', 'QUOTE_AND_OWNER_APPROVAL_REQUIRED'];
  if (modelSchemaResponseSha256 === null) blockers.push('CLI_MODEL_SCHEMA_NOT_OBSERVED');
  if (boundMedia.some(media => media.uploadId === null)) blockers.push('EXPLICIT_MEDIA_UPLOAD_REQUIRED');
  return freeze({ binding, sha256: hashCanonical(binding), executable: false, blockers });
}

/** Rebuild with CURRENT server-owned record, workspace selection and upload receipts.
 * Any changed operation revision, source, provider workspace, transport or media
 * binding invalidates an earlier quote/approval even if the visible prompt matches.
 */
export function assertHiggsfieldExecutionBindingCurrent(expectedSha256, currentInput) {
  need(digest(expectedSha256), 'HIGGSFIELD_BINDING_HASH_INVALID');
  const current = buildHiggsfieldExecutionBinding(currentInput);
  need(current.sha256 === expectedSha256, 'HIGGSFIELD_EXECUTION_BINDING_STALE');
  return current;
}

const decimal = value => typeof value === 'string' && /^(?:0|[1-9]\d{0,11})(?:\.\d{1,9})?$/.test(value);
function creditUnits(value) {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0'));
}

/** Validate an approval REQUEST, not owner identity or a provider price guarantee.
 * observedQuote is a future qualified adapter projection from the exact raw quote.
 * Today captureHiggsfieldCliEvidence never emits that projection, so it cannot pass
 * this gate. Authentication, durable one-attempt claiming and expiry rechecks belong
 * to the service; a request body is not proof that approval was granted or consumed.
 */
export function validateHiggsfieldQuoteApprovalRequest(request, { bindingSha256, observedQuote, nowMs }) {
  shape(request, ['bindingSha256', 'quoteResponseSha256', 'maximumCredits', 'expiresAtMs', 'maximumAttempts', 'automaticRetry'], 'HIGGSFIELD_QUOTE_APPROVAL_FIELDS_INVALID');
  need(digest(bindingSha256) && request.bindingSha256 === bindingSha256, 'HIGGSFIELD_QUOTE_BINDING_STALE');
  shape(observedQuote, ['schemaStatus', 'bindingSha256', 'rawResponseSha256', 'credits', 'observedAtMs'], 'HIGGSFIELD_QUOTE_NOT_QUALIFIED');
  need(observedQuote.schemaStatus === 'QUALIFIED_CLI_QUOTE' && observedQuote.bindingSha256 === bindingSha256 && digest(observedQuote.rawResponseSha256), 'HIGGSFIELD_QUOTE_NOT_QUALIFIED');
  need(request.quoteResponseSha256 === observedQuote.rawResponseSha256, 'HIGGSFIELD_QUOTE_RESPONSE_STALE');
  need(decimal(request.maximumCredits) && decimal(observedQuote.credits), 'HIGGSFIELD_CREDIT_AMOUNT_INVALID');
  need(creditUnits(request.maximumCredits) >= creditUnits(observedQuote.credits), 'HIGGSFIELD_QUOTE_EXCEEDS_CEILING');
  need(Number.isSafeInteger(nowMs) && nowMs >= 0 && Number.isSafeInteger(observedQuote.observedAtMs) && observedQuote.observedAtMs >= 0 && observedQuote.observedAtMs <= nowMs, 'HIGGSFIELD_QUOTE_TIME_INVALID');
  need(Number.isSafeInteger(request.expiresAtMs) && request.expiresAtMs > nowMs, 'HIGGSFIELD_QUOTE_APPROVAL_EXPIRED');
  need(request.maximumAttempts === 1 && request.automaticRetry === false, 'HIGGSFIELD_AUTOMATIC_RETRY_FORBIDDEN');
  return freeze({ status: 'VALID_QUOTE_APPROVAL_REQUEST', request: clone(request), requestSha256: hashCanonical(request), executable: false, ownerApprovalGranted: false });
}

function responseBytes(value) {
  need(Buffer.isBuffer(value) && value.length <= HIGGSFIELD_CLI_RESPONSE_LIMIT, 'HIGGSFIELD_RESPONSE_BYTES_INVALID');
  return Buffer.from(value);
}
function jsonShape(bytes) {
  if (bytes.length === 0) return 'EMPTY';
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return 'INVALID_UTF8'; }
  if (!source.trim()) return 'EMPTY';
  let data;
  try { data = JSON.parse(source); } catch { return 'INVALID_JSON'; }
  return data === null ? 'NULL' : Array.isArray(data) ? 'ARRAY' : typeof data === 'object' ? 'OBJECT' : 'SCALAR';
}

/** Capture exact owned evidence without a speculative parser. Never forward raw
 * stdout/stderr to the browser: either may contain sensitive account information.
 * Raw buffers are returned separately for the service's private blob store. All
 * successful CLI upload/cost/create/get JSON schemas still need qualification.
 * A process exit, timeout, disconnected response, or local retry identifier does
 * not establish that a launched submission was absent at the provider.
 */
export function captureHiggsfieldCliEvidence(input) {
  shape(input, ['phase', 'bindingSha256', 'stdout', 'stderr', 'exitCode', 'signal', 'timedOut', 'launched'], 'HIGGSFIELD_EVIDENCE_FIELDS_INVALID');
  const { phase, bindingSha256, exitCode, signal, timedOut, launched } = input;
  need(['MODEL_SCHEMA', 'UPLOAD', 'QUOTE', 'SUBMIT', 'STATUS', 'LIST'].includes(phase) && digest(bindingSha256), 'HIGGSFIELD_EVIDENCE_CONTEXT_INVALID');
  need((exitCode === null || Number.isSafeInteger(exitCode) && exitCode >= 0 && exitCode <= 255) && (signal === null || typeof signal === 'string' && /^SIG[A-Z0-9]{1,16}$/.test(signal)) && typeof timedOut === 'boolean' && typeof launched === 'boolean', 'HIGGSFIELD_PROCESS_RESULT_INVALID');
  const stdout = responseBytes(input.stdout), stderr = responseBytes(input.stderr);
  need(launched || stdout.length === 0 && stderr.length === 0 && exitCode === null && signal === null && timedOut === false, 'HIGGSFIELD_PROCESS_NOT_LAUNCHED');
  const receipt = {
    schemaVersion: 'caniscreenwrite-higgsfield-cli-evidence/v1', phase, bindingSha256,
    transport: { kind: 'HIGGSFIELD_OFFICIAL_CLI', version: HIGGSFIELD_RUNTIME.version, binarySha256: HIGGSFIELD_RUNTIME.binarySha256 },
    process: { launched, exitCode, signal, timedOut },
    stdout: { sha256: hash(stdout), byteLength: stdout.length, jsonShape: jsonShape(stdout) },
    stderr: { sha256: hash(stderr), byteLength: stderr.length },
    schemaStatus: 'UNQUALIFIED_CLI_RESPONSE',
    submissionStatus: phase === 'SUBMIT' ? launched ? 'SUBMISSION_UNKNOWN' : 'NOT_SUBMITTED' : 'NOT_A_SUBMISSION',
    providerJobId: null, providerStatus: null, quotedCredits: null,
    artifacts: [], automaticRetryAllowed: false,
  };
  return { receipt: freeze(receipt), sha256: hashCanonical(receipt), raw: { stdout, stderr } };
}
