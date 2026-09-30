import { validateRecord } from './validation';
import type { WorkspaceProject, WorkspaceRecord } from './types';

export interface UsageAttempt {
  id: string; origin: 'TOKEN_STEWARD' | 'LOCAL_MODEL' | 'HIGGSFIELD'; provider: string; model: string;
  taskId: string | null; sceneId: string | null; shotId: string | null; status: string; timestamp: string;
  inputTokens: number | null; outputTokens: number | null; costUsd: string | null;
  costKind: 'reported' | 'estimated' | 'unknown'; quotedCredits: string | null;
  observedAccepted: boolean | null; recordId: string | null;
}
export interface UsageSummary {
  schemaVersion: 1; projectId: string; sourceHash: string | null; authority: 'OBSERVATION_ONLY'; enforcement: 'NOT_CONNECTED';
  imports: { id: string; sha256: string; reportHash: string; byteLength: number; generatedAt: string; importedAt: string; eventCount: number; matchedEventCount: number }[];
  imported: {
    eventCount: number; excludedEventCount: number; excludedProjects: { project: string; eventCount: number }[];
    reportedUsd: string; estimatedUsd: string; unknownCostEvents: number;
    inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null; cacheWriteTokens: number | null; reasoningTokens: number | null;
    observedAcceptedTasks: number; observedClosedTasks: number; costPerObservedAcceptedTaskUsd: string | null;
  };
  local: { attemptCount: number; inputTokens: number | null; outputTokens: number | null; unknownUsageAttempts: number; costUsd: null };
  generation: { attemptCount: number; quotedCredits: string; quotedAttempts: number; unquotedAttempts: number; costUsd: null };
  attempts: UsageAttempt[]; totalAttempts: number; limits: { maxReportBytes: number; maxEvents: number };
}
export interface UsagePreview {
  reportHash: string; byteLength: number; generatedAt: string; eventCount: number; matchedEventCount: number; excludedEventCount: number;
  excludedProjects: { project: string; eventCount: number }[]; alreadyImported: boolean; summary: UsageSummary;
}
export interface UsageAccountingApi {
  load(project: WorkspaceProject, signal?: AbortSignal): Promise<UsageSummary>;
  preview(project: WorkspaceProject, reportText: string, signal?: AbortSignal): Promise<UsagePreview>;
  import(project: WorkspaceProject, reportText: string, expectedReportHash: string): Promise<{ replayed: boolean; record: WorkspaceRecord; summary: UsageSummary }>;
}
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const tokens = (value: unknown) => value === null || count(value);
const decimal = (value: unknown) => typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value);
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const nullableText = (value: unknown) => value === null || typeof value === 'string';
const messages: Record<string, string> = {
  USAGE_PROJECT_MISMATCH: 'The project or screenplay changed. Reopen usage and preview the report again.',
  USAGE_REPORT_FORMAT_INVALID: 'Choose a version 2 Token Steward JSON report from the reviewed exporter.',
  USAGE_REPORT_JSON_INVALID: 'This file is not valid JSON. Choose the exported Token Steward report.',
  USAGE_REPORT_TOO_LARGE: 'The report exceeds 2 MB. Export a smaller reporting period.',
  USAGE_REPORT_EVENT_LIMIT: 'The report exceeds 5,000 events. Export a smaller reporting period.',
  USAGE_EVENT_IDENTITY_CONFLICT: 'An event disagrees with an existing observation. Resolve the report conflict before importing; saved evidence stays unchanged.',
  USAGE_TASK_OUTCOME_CONFLICT: 'The report gives contradictory outcomes for the same task attempt. Resolve them before importing.',
  USAGE_PREVIEW_CHANGED: 'The report changed after preview. Choose the file again before saving.',
  USAGE_IMPORT_LIMIT: 'This workspace has reached its report import limit. Existing reports remain available.',
  USAGE_WORKSPACE_EVENT_LIMIT: 'This import would exceed the workspace event limit. Existing observations remain unchanged.',
  USAGE_EVENT_TOKEN_SUBSETS_INVALID: 'A token breakdown is inconsistent. Correct the exported report before importing.',
  USAGE_EVENT_COST_KIND_INVALID: 'A cost is missing its reported, estimated or unknown classification. Correct the exported report before importing.',
};
function check(value: unknown, message = 'The local usage report could not be verified.'): asserts value { if (!value) throw new Error(message); }
function summary(value: UsageSummary, project: WorkspaceProject) {
  check(value?.schemaVersion === 1 && value.projectId === project.id && value.sourceHash === project.sourceHash, 'The usage report belongs to a different project or source.');
  check(value.authority === 'OBSERVATION_ONLY' && value.enforcement === 'NOT_CONNECTED');
  check(Array.isArray(value.imports) && value.imports.every(row => typeof row.id === 'string' && digest(row.sha256) && digest(row.reportHash) && count(row.byteLength) && count(row.eventCount) && count(row.matchedEventCount) && typeof row.generatedAt === 'string' && typeof row.importedAt === 'string'));
  const imported = value.imported, local = value.local, generation = value.generation;
  check(imported && local && generation && count(imported.eventCount) && count(imported.excludedEventCount) && count(imported.unknownCostEvents) && decimal(imported.reportedUsd) && decimal(imported.estimatedUsd));
  check(Array.isArray(imported.excludedProjects) && imported.excludedProjects.every(row => typeof row.project === 'string' && count(row.eventCount)));
  check(['inputTokens', 'outputTokens', 'cachedTokens', 'cacheWriteTokens', 'reasoningTokens'].every(key => tokens(imported[key])) && count(imported.observedAcceptedTasks) && count(imported.observedClosedTasks) && (imported.costPerObservedAcceptedTaskUsd === null || decimal(imported.costPerObservedAcceptedTaskUsd)));
  check(count(local.attemptCount) && tokens(local.inputTokens) && tokens(local.outputTokens) && count(local.unknownUsageAttempts) && local.costUsd === null);
  check(count(generation.attemptCount) && decimal(generation.quotedCredits) && count(generation.quotedAttempts) && count(generation.unquotedAttempts) && generation.costUsd === null);
  check(count(value.totalAttempts) && count(value.limits?.maxReportBytes) && count(value.limits?.maxEvents));
  check(Array.isArray(value.attempts) && value.attempts.length <= 200 && value.attempts.length <= value.totalAttempts && value.attempts.every(row =>
    typeof row.id === 'string' && ['TOKEN_STEWARD', 'LOCAL_MODEL', 'HIGGSFIELD'].includes(row.origin) && typeof row.provider === 'string' && typeof row.model === 'string' &&
    [row.taskId, row.sceneId, row.shotId, row.recordId].every(nullableText) && typeof row.status === 'string' && typeof row.timestamp === 'string' && tokens(row.inputTokens) && tokens(row.outputTokens) &&
    (row.costUsd === null || decimal(row.costUsd)) && ['reported', 'estimated', 'unknown'].includes(row.costKind) && (row.quotedCredits === null || decimal(row.quotedCredits)) && (row.observedAccepted === null || typeof row.observedAccepted === 'boolean')));
  return value;
}
async function json(route: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(`/api/usage-accounting${route}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'error', signal, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) { const code = String(data?.error?.code ?? data?.error ?? 'USAGE_REQUEST_UNCONFIRMED'); throw new Error(messages[code] ?? data?.error?.message ?? (code.startsWith('USAGE_EVENT_') ? 'An event is incomplete or invalid. Correct the exported report before importing.' : `Usage accounting could not be confirmed (${code}).`)); }
  return data;
}
const scope = (project: WorkspaceProject) => ({ projectId: project.id, sourceHash: project.sourceHash });
const hashText = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');
export const usageAccountingApi: UsageAccountingApi = {
  async load(project, signal) { return summary(await json(`?${new URLSearchParams({ projectId: project.id, sourceHash: String(project.sourceHash) })}`, undefined, signal), project); },
  async preview(project, reportText, signal) {
    const result = await json('/preview', { ...scope(project), reportText }, signal) as UsagePreview;
    check(result && result.reportHash === await hashText(reportText) && result.byteLength === new TextEncoder().encode(reportText).byteLength && typeof result.generatedAt === 'string' && typeof result.alreadyImported === 'boolean' && [result.eventCount, result.matchedEventCount, result.excludedEventCount].every(count));
    check(result.eventCount === result.matchedEventCount + result.excludedEventCount && Array.isArray(result.excludedProjects) && result.excludedProjects.every(row => typeof row.project === 'string' && count(row.eventCount)));
    summary(result.summary, project);
    return result;
  },
  async import(project, reportText, expectedReportHash) {
    check(expectedReportHash === await hashText(reportText), 'The selected report changed. Preview it again before saving.');
    const result = await json('/import', { ...scope(project), reportText, expectedReportHash });
    check(typeof result?.replayed === 'boolean');
    const record = await validateRecord(result.record, project);
    check(record.kind === 'usage-observation' && (record.data as { reportHash: string }).reportHash === expectedReportHash);
    return { replayed: result.replayed, record, summary: summary(result.summary, project) };
  },
};
