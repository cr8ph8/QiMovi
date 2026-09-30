import { validateModelAssistance, validateModelAssistanceInput } from '../../local/contracts/model-assistance.mjs';
import { validateRecord } from './validation';
import { canonicalJson, hashCanonical } from './canonical';
import type { AuthoringInputRef, Project, WorkspaceRecord } from './types';

export interface ModelStatus {
  schema: 'caniscreenwrite-model-status/v1'; provider: 'OLLAMA'; configured: boolean;
  origin: string | null; status: 'UNCONFIGURED' | 'AVAILABLE' | 'UNAVAILABLE'; checkedAt: string | null;
  models: { name: string; digest: string; size: number }[]; error?: { code: string; message: string } | null;
}
export interface AssistanceInput {
  schemaVersion: 1; projectId: string; sourceHash: string; sceneId: string | null; requestId: string;
  model: string; instructions: string; contextRefs: AuthoringInputRef[];
  unsavedText: null | { label: string; text: string; explicit: true };
  creativeRequestRef: AuthoringInputRef | null; maxOutputTokens: number;
  characterAgentRef?: AuthoringInputRef;
  rehearsalRef?: AuthoringInputRef;
  contextFormat?: 'PROJECT_CONTEXT_V1';
  pitchScope?: 'NARRATIVE_AND_BUSINESS' | 'PRESENTATION';
}
export interface AssistanceData {
  schemaVersion: 1; projectId: string; sourceHash: string; sceneId: string | null; requestId: string;
  input: AssistanceInput; status: 'STARTED' | 'COMPLETED' | 'FAILED' | 'CANCELED' | 'INTERRUPTED';
  requestHash: string; prompt: string; promptSha256: string;
  context?: { projectSummary: string; sceneText: string; records: { ref: AuthoringInputRef; kind: string; version: number; text: string }[] };
  startedAt: string; finishedAt: string | null; authority: 'PROPOSAL_ONLY'; sourceChanged: false;
  provider: { kind: 'OLLAMA'; origin: string; model: string; modelDigest: string };
  output: null | { text: string; sha256: string; model: string; doneReason: string; promptTokens: number | null; outputTokens: number | null };
  error: null | { code: string; message: string };
}
export type AssistanceRecord = WorkspaceRecord & { data: AssistanceData };
const messages: Record<string, string> = {
  MODEL_ASSISTANCE_BUSY: 'Another local request is running. Check its result before starting another.',
  MODEL_SERVICE_BUSY: 'Another local request is running. Check its result before starting another.',
  MODEL_ASSISTANCE_PROJECT_CHANGED: 'The selected project or source changed. Choose the current context again.',
  MODEL_ASSISTANCE_CONTEXT_LIMIT: 'This context is too large. Choose a shorter scene or fewer saved references.',
  MODEL_CONTEXT_CHANGED: 'A selected record changed. Refresh the workspace and choose the current revision.',
  MODEL_DOCUMENT_CONTEXT_STALE: 'A selected document has outdated inputs. Rebuild it from the current project inputs, then select its new revision.',
  MODEL_CONTEXT_TOO_LARGE: 'The saved evidence exceeds the context limit. Select fewer or shorter records; no evidence was truncated.',
  MODEL_PROMPT_TOO_LARGE: 'The request is too large. Shorten the question or select less context.',
  MODEL_PITCH_SCOPE_REQUIRES_PITCH: 'Select a saved pitch before choosing which pitch fields to include.',
  MODEL_ORIGIN_MUST_BE_LITERAL_LOOPBACK: 'Use a local address such as http://127.0.0.1:11434.',
};
/** A confirmed context rejection is distinct from a missing execution response. */
export class ModelPreparationError extends Error {}
const preparationErrors = new Set(['MODEL_DOCUMENT_CONTEXT_STALE', 'MODEL_CONTEXT_TOO_LARGE', 'MODEL_PROMPT_TOO_LARGE', 'MODEL_PITCH_SCOPE_REQUIRES_PITCH']);
async function json(route: string, body?: unknown) {
  const response = await fetch(`/api/model-assistance/${route}`, { method: body === undefined ? 'GET' : route === 'config' ? 'PUT' : 'POST', credentials: 'same-origin', redirect: 'error', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) {
    const code = data?.error?.code ?? data?.error ?? 'MODEL_REQUEST_UNCONFIRMED', message = messages[code] ?? String(code);
    if (route === 'run' && response.status >= 400 && response.status < 500 && preparationErrors.has(code)) throw new ModelPreparationError(message);
    throw new Error(message);
  }
  return data;
}
async function record(value: unknown, project: Project) {
  const result = await validateRecord(value, project);
  if (result.kind !== 'model-assistance') throw new Error('Unexpected assistant record.');
  validateModelAssistance(result.data, project);
  const data = result.data as AssistanceData;
  const textHash = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');
  if (data.requestHash !== await hashCanonical(data.input) || data.promptSha256 !== await textHash(data.prompt) || (data.output && data.output.sha256 !== await textHash(data.output.text))) throw new Error('The assistant request or output hash could not be verified.');
  return result as AssistanceRecord;
}
export interface ModelAssistanceApi {
  status(): Promise<ModelStatus>;
  configure(origin: string | null): Promise<unknown>;
  run(input: AssistanceInput, project: Project): Promise<AssistanceRecord>;
  cancel(input: Pick<AssistanceInput, 'projectId' | 'sourceHash' | 'requestId'>): Promise<unknown>;
  history(project: Project): Promise<AssistanceRecord[]>;
}
export const modelAssistanceApi: ModelAssistanceApi = {
  async status() {
    const data = await json('status');
    if (data.schema !== 'caniscreenwrite-model-status/v1' || data.provider !== 'OLLAMA' || !['UNCONFIGURED', 'AVAILABLE', 'UNAVAILABLE'].includes(data.status) || !Array.isArray(data.models) || data.models.some((m: { name: unknown; digest: string; size: unknown }) => typeof m.name !== 'string' || !/^[a-f0-9]{64}$/.test(m.digest) || !Number.isSafeInteger(m.size))) throw new Error('The local model catalog could not be verified.');
    return data;
  },
  configure(origin) { return json('config', { origin }); },
  async run(input, project) {
    const captured = JSON.parse(canonicalJson(input)) as AssistanceInput;
    validateModelAssistanceInput(captured, project);
    const data = await json('run', captured);
    if (data.schema !== 'caniscreenwrite-model-run/v1') throw new Error('The assistant result could not be verified.');
    const result = await record(data.record, project);
    if (result.data.requestId !== captured.requestId || canonicalJson(result.data.input) !== canonicalJson(captured)) throw new Error('The assistant returned a different request.');
    return result;
  },
  cancel(input) { return json('cancel', input); },
  async history(project) {
    const data = await json('history');
    if (data.schema !== 'caniscreenwrite-model-history/v1' || data.projectId !== project.id || data.sourceHash !== project.sourceHash || !Array.isArray(data.records) || data.records.length > 200) throw new Error('The assistant history belongs to a different project.');
    return Promise.all(data.records.map((value: unknown) => record(value, project)));
  },
};
