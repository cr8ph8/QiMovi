// Provider responses are retained proposals. This contract grants no source,
// production, permission, or provider-execution authority.
export const MODEL_ASSISTANCE_LIMITS = Object.freeze({ instructions: 5000, contextRefs: 8, contextText: 24000, unsavedText: 18000, prompt: 40000, outputText: 50000, maxOutputTokens: 2048, responseBytes: 262144, tagsBytes: 1048576, models: 256, timeoutMs: 120000, statusTimeoutMs: 4000, concurrency: 1, history: 200 });
export const MODEL_ASSISTANCE_TERMINAL = Object.freeze(['COMPLETED', 'FAILED', 'CANCELED', 'INTERRUPTED']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value);
const referenceId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function assistanceAssert(condition, code, status = 422) { if (!condition) throw Object.assign(new Error(code), { code, status }); }
export function assistanceText(value, max, nonempty = false) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || nonempty && !value.trim()) return false;
  for (let i = 0; i < value.length; i++) { const c = value.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff) { const n = value.charCodeAt(++i); if (!(n >= 0xdc00 && n <= 0xdfff)) return false; } else if (c >= 0xdc00 && c <= 0xdfff) return false; }
  return true;
}
function shape(value, keys) { assistanceAssert(object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), 'MODEL_ASSISTANCE_FIELDS_INVALID'); }
function ref(value) { shape(value, ['id', 'sha256']); assistanceAssert(referenceId(value.id) && digest(value.sha256), 'MODEL_ASSISTANCE_REFERENCE_INVALID'); }
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export function validateOllamaOrigin(origin) {
  if (origin === null) return null;
  // Require a literal representation: no DNS, credentials, paths, numeric or
  // octal host aliases, URL normalization tricks, or query/fragment routing.
  assistanceAssert(typeof origin === 'string' && /^http:\/\/(?:127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}$/.test(origin), 'MODEL_ORIGIN_MUST_BE_LITERAL_LOOPBACK');
  const url = new URL(origin);
  assistanceAssert(Number(url.port) >= 1 && Number(url.port) <= 65535 && url.origin === origin, 'MODEL_ORIGIN_MUST_BE_LITERAL_LOOPBACK');
  return origin;
}
export function validateModelAssistanceInput(input, project) {
  const l = MODEL_ASSISTANCE_LIMITS;
  shape(input, ['schemaVersion', 'projectId', 'sourceHash', 'sceneId', 'requestId', 'model', 'instructions', 'contextRefs', 'unsavedText', 'creativeRequestRef', 'maxOutputTokens', ...(object(input) && Object.hasOwn(input, 'characterAgentRef') ? ['characterAgentRef'] : []), ...(object(input) && Object.hasOwn(input, 'rehearsalRef') ? ['rehearsalRef'] : []), ...(object(input) && Object.hasOwn(input, 'contextFormat') ? ['contextFormat'] : []), ...(object(input) && Object.hasOwn(input, 'pitchScope') ? ['pitchScope'] : [])]);
  // Opt in to a versioned projection so historical prompts remain reconstructible.
  if (Object.hasOwn(input, 'contextFormat')) assistanceAssert(input.contextFormat === 'PROJECT_CONTEXT_V1' && !Object.hasOwn(input, 'characterAgentRef'), 'MODEL_ASSISTANCE_CONTEXT_FORMAT_INVALID');
  if (Object.hasOwn(input, 'pitchScope')) assistanceAssert(input.contextFormat === 'PROJECT_CONTEXT_V1' && !Object.hasOwn(input, 'characterAgentRef') && ['NARRATIVE_AND_BUSINESS', 'PRESENTATION'].includes(input.pitchScope), 'MODEL_PITCH_SCOPE_INVALID');
  assistanceAssert(input.schemaVersion === 1 && referenceId(input.projectId) && digest(input.sourceHash) && id(input.requestId), 'MODEL_ASSISTANCE_IDENTITY_INVALID');
  assistanceAssert(input.sceneId === null || referenceId(input.sceneId), 'MODEL_ASSISTANCE_SCENE_INVALID');
  assistanceAssert(!project || input.projectId === project.id && input.sourceHash === project.sourceHash && (input.sceneId === null || project.scenes.some(scene => scene.id === input.sceneId)), 'MODEL_ASSISTANCE_PROJECT_CHANGED', 409);
  assistanceAssert(typeof input.model === 'string' && /^qwen[A-Za-z0-9._:/-]{0,119}$/i.test(input.model) && !/cloud/i.test(input.model), 'MODEL_ASSISTANCE_LOCAL_QWEN_REQUIRED');
  assistanceAssert(assistanceText(input.instructions, l.instructions, input.creativeRequestRef === null), 'MODEL_ASSISTANCE_INSTRUCTIONS_INVALID');
  assistanceAssert(Array.isArray(input.contextRefs) && input.contextRefs.length <= l.contextRefs, 'MODEL_ASSISTANCE_CONTEXT_LIMIT');
  input.contextRefs.forEach(ref); assistanceAssert(new Set(input.contextRefs.map(item => item.id)).size === input.contextRefs.length, 'MODEL_ASSISTANCE_DUPLICATE_REFERENCE');
  if (input.creativeRequestRef !== null) ref(input.creativeRequestRef);
  if (input.unsavedText !== null) { shape(input.unsavedText, ['label', 'text', 'explicit']); assistanceAssert(input.unsavedText.explicit === true && assistanceText(input.unsavedText.label, 120, true) && !/[\r\n]/.test(input.unsavedText.label) && assistanceText(input.unsavedText.text, l.unsavedText, true), 'MODEL_ASSISTANCE_UNSAVED_CONSENT_REQUIRED'); }
  if (Object.hasOwn(input, 'characterAgentRef')) {
    ref(input.characterAgentRef);
    assistanceAssert(input.characterAgentRef.id.startsWith('universe-agent:') && input.sceneId === null && input.contextRefs.length === 0 && input.creativeRequestRef === null && input.unsavedText === null, 'MODEL_CHARACTER_CONTEXT_INVALID');
  }
  if (Object.hasOwn(input, 'rehearsalRef')) {
    ref(input.rehearsalRef); assistanceAssert(Object.hasOwn(input, 'characterAgentRef') && input.rehearsalRef.id.startsWith('universe-rehearsal:'), 'MODEL_REHEARSAL_CONTEXT_INVALID');
  }
  assistanceAssert(integer(input.maxOutputTokens, 1, l.maxOutputTokens), 'MODEL_ASSISTANCE_TOKEN_LIMIT');
  return input;
}
export function validateModelAssistance(data, project) {
  const l = MODEL_ASSISTANCE_LIMITS;
  shape(data, ['schemaVersion', 'projectId', 'sourceHash', 'sceneId', 'requestId', 'requestHash', 'input', 'context', 'prompt', 'promptSha256', 'provider', 'status', 'startedAt', 'finishedAt', 'output', 'error', 'authority', 'sourceChanged']);
  validateModelAssistanceInput(data.input, project);
  assistanceAssert(data.schemaVersion === 1 && ['projectId', 'sourceHash', 'sceneId', 'requestId'].every(key => data[key] === data.input[key]) && digest(data.requestHash) && digest(data.promptSha256), 'MODEL_ASSISTANCE_IDENTITY_INVALID');
  assistanceAssert(data.authority === 'PROPOSAL_ONLY' && data.sourceChanged === false, 'MODEL_ASSISTANCE_AUTHORITY_INVALID');
  assistanceAssert(assistanceText(data.prompt, l.prompt, true), 'MODEL_ASSISTANCE_PROMPT_INVALID');
  shape(data.context, ['projectSummary', 'sceneText', 'records']);
  assistanceAssert(assistanceText(data.context.projectSummary, l.contextText, true) && assistanceText(data.context.sceneText, l.contextText) && Array.isArray(data.context.records) && data.context.records.length <= l.contextRefs + 2, 'MODEL_ASSISTANCE_CONTEXT_INVALID');
  for (const entry of data.context.records) { shape(entry, ['ref', 'kind', 'version', 'text']); ref(entry.ref); assistanceAssert(referenceId(entry.kind) && integer(entry.version, 1, 2147483646) && assistanceText(entry.text, l.contextText, true), 'MODEL_ASSISTANCE_CONTEXT_INVALID'); }
  assistanceAssert(new Set(data.context.records.map(item => item.ref.id)).size === data.context.records.length, 'MODEL_ASSISTANCE_DUPLICATE_REFERENCE');
  assistanceAssert(data.context.projectSummary.length + data.context.sceneText.length + data.context.records.reduce((sum, item) => sum + item.text.length, 0) <= l.contextText, 'MODEL_ASSISTANCE_CONTEXT_LIMIT');
  shape(data.provider, ['kind', 'origin', 'model', 'modelDigest']);
  assistanceAssert(data.provider.kind === 'OLLAMA' && data.provider.origin !== null && data.provider.model === data.input.model && digest(data.provider.modelDigest), 'MODEL_ASSISTANCE_PROVIDER_INVALID'); validateOllamaOrigin(data.provider.origin);
  assistanceAssert(['STARTED', ...MODEL_ASSISTANCE_TERMINAL].includes(data.status) && iso(data.startedAt), 'MODEL_ASSISTANCE_STATE_INVALID');
  if (data.status === 'STARTED') assistanceAssert(data.finishedAt === null && data.output === null && data.error === null, 'MODEL_ASSISTANCE_STATE_INVALID');
  else {
    assistanceAssert(iso(data.finishedAt) && Date.parse(data.finishedAt) >= Date.parse(data.startedAt), 'MODEL_ASSISTANCE_STATE_INVALID');
    if (data.status === 'COMPLETED') {
      shape(data.output, ['text', 'sha256', 'model', 'doneReason', 'promptTokens', 'outputTokens']);
      assistanceAssert(data.error === null && assistanceText(data.output.text, l.outputText, true) && digest(data.output.sha256) && data.output.model === data.input.model && assistanceText(data.output.doneReason, 100) && [data.output.promptTokens, data.output.outputTokens].every(value => value === null || integer(value, 0, 1000000)), 'MODEL_ASSISTANCE_OUTPUT_INVALID');
      assistanceAssert(data.output.outputTokens === null || data.output.outputTokens <= data.input.maxOutputTokens, 'MODEL_ASSISTANCE_TOKEN_LIMIT');
    } else { shape(data.error, ['code', 'message']); assistanceAssert(data.output === null && typeof data.error.code === 'string' && /^MODEL_[A-Z_]{1,80}$/.test(data.error.code) && assistanceText(data.error.message, 300, true), 'MODEL_ASSISTANCE_ERROR_INVALID'); }
  }
  return data;
}
