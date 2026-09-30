import type { HiggsfieldPlannedMedia } from './higgsfieldToolsApi';
import type { WorkspaceProject, WorkspaceRecord } from './types';
import { validateRecord } from './validation';
import { WorkspaceError } from './api';

export type StudioOperationTarget = { kind: 'PROJECT' } | { kind: 'SCENE'; sceneId: string } | { kind: 'SHOT'; sceneId: string; shotId: string } | { kind: 'CELL'; sceneId: string; shotId: string; cellId: string };
/** Exact writing origin; it does not admit a production screenplay or lock the provider prompt. */
export interface StudioWritingRef { id: string; version: number; sha256: string; sceneId: string }
/** Candidate casting provenance only. A link does not grant likeness or film-use rights. */
export interface StudioCastingRef { id: string; version: number; sha256: string; characterId: string }
interface StudioOperationFields {
  title: string; taskId: string; modelId: string;
  prompt: string; settingsJson: string; medias: HiggsfieldPlannedMedia[];
  target: StudioOperationTarget; briefRef: { id: string; sha256: string } | null;
  catalogSha256: string; status: 'DRAFT';
  writingRef?: StudioWritingRef;
  castingRef?: StudioCastingRef;
}
export type StudioOperation = StudioOperationFields & (
  { schemaVersion: 1; sourceHash: string } |
  { schemaVersion: 2; projectId: string; sourceHash: null; target: {kind:'PROJECT'}; briefRef: null }
);
export type StudioOperationRecord = WorkspaceRecord & { kind: 'studio-operation'; data: StudioOperation };

export async function loadStudioOperations(project: WorkspaceProject, signal?: AbortSignal): Promise<StudioOperationRecord[]> {
  const response = await fetch('/api/records?kind=studio-operation', { credentials: 'same-origin', redirect: 'error', signal });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new WorkspaceError('Saved filmmaking tasks could not be read.', response.status);
  if (!Array.isArray(value) || value.length > 10000) throw new Error('The saved task list is invalid.');
  const records = await Promise.all(value.map(row => validateRecord(row, project)));
  if (records.some(row => row.kind !== 'studio-operation') || new Set(records.map(row => row.id)).size !== records.length) throw new Error('The saved task list is invalid.');
  return records as StudioOperationRecord[];
}
