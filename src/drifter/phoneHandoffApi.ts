import type { WorkspaceProject, WorkspaceRecord } from './types';
import { validateRecord } from './validation';

export const PHONE_REVIEW_MAX_BYTES = 2 * 1024 * 1024;
export type PhoneChange = {
  id: string; kind: string; label: string;
  status: 'READY' | 'CONFLICT' | 'REVIEW_ONLY' | 'UNCHANGED';
  reason: string; recordId: string | null; expectedVersion: number | null;
  before: Record<string, unknown>; after: Record<string, unknown>;
};
export type PhoneReviewPreview = {
  schemaVersion: 'qimovi-phone-review-preview/v1'; projectId: string; sourceHash: string | null;
  previewSha256: string; changes: PhoneChange[]; warnings: string[];
};
export type PhoneSlatePackage = {
  schemaVersion: 'qimovi-phone-production/v1'; exportedAt: string;
  projects: { id: string; title: string; [key: string]: unknown }[];
  [key: string]: unknown;
};
export type PhoneApplyInput = {
  reviewPackage: unknown; changeId: string; previewSha256: string;
  expectedVersion: number | null; requestId: string;
};
export type PhoneApplyResult = {
  status: 'APPLIED'; changeId: string; previewSha256: string; record: WorkspaceRecord; replayed: boolean;
};
export interface PhoneHandoffApi {
  export(signal?: AbortSignal): Promise<PhoneSlatePackage>;
  preview(reviewPackage: unknown, signal?: AbortSignal): Promise<PhoneReviewPreview>;
  apply(input: PhoneApplyInput, signal?: AbortSignal, project?: WorkspaceProject): Promise<PhoneApplyResult>;
}

const errorMessages: Record<string, string> = {
  PHONE_PROJECT_MISMATCH: 'This review belongs to a different film. Open its desktop project before importing.',
  PHONE_SOURCE_STALE: 'The film’s source changed after this phone slate was exported. Export a new slate and reconcile your phone changes.',
  PHONE_PREVIEW_STALE: 'Saved work changed after this preview. Refresh the review before applying a change.',
  PHONE_CHANGE_NOT_APPLICABLE: 'This change is no longer ready to apply. Refresh the review to see its current status.',
  PHONE_BASELINE_CONTENT_MISMATCH: 'The review’s desktop baseline could not be verified. Export a new phone slate from this film.',
  PHONE_BASELINE_ID_MISMATCH: 'The review’s desktop baseline does not match this film. Export a new phone slate.',
};

async function request(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/phone/${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'error', signal,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof result?.error === 'string' ? result.error : '';
    throw new Error(errorMessages[detail] ?? (detail || 'The phone handoff could not be confirmed. Reconnect to the local workspace and try again.'));
  }
  if (!result || typeof result !== 'object') throw new Error('The local workspace returned an unreadable phone handoff.');
  return result;
}

export const phoneHandoffApi: PhoneHandoffApi = {
  async export(signal) {
    const result = await request('export', undefined, signal) as PhoneSlatePackage;
    if (result.schemaVersion !== 'qimovi-phone-production/v1' || !Array.isArray(result.projects)) throw new Error('The local workspace returned an unsupported phone slate.');
    return result;
  },
  async preview(reviewPackage, signal) {
    const result = await request('preview', reviewPackage, signal) as PhoneReviewPreview;
    if (result.schemaVersion !== 'qimovi-phone-review-preview/v1' || !Array.isArray(result.changes) || !Array.isArray(result.warnings) || typeof result.previewSha256 !== 'string') throw new Error('The local workspace returned an unreadable review preview.');
    return result;
  },
  async apply(input, signal, project) {
    const result = await request('apply', input, signal) as PhoneApplyResult;
    if (result.status !== 'APPLIED' || result.changeId !== input.changeId || result.previewSha256 !== input.previewSha256 || !result.record || result.record.id !== input.changeId || result.record.version !== (input.expectedVersion ?? 0) + 1 || !['project-direction', 'shot-direction'].includes(result.record.kind)) throw new Error('The save response could not be verified. Refresh the review before trying again.');
    const record = await validateRecord(result.record, project);
    return { ...result, record };
  },
};
