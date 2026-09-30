import type { SceneIndexEntry } from './screenplay-index.mjs';
export const WRITING_SCENE_LIMIT: number;
export const WRITING_SCENE_CANDIDATE_LIMIT: number;
export interface WritingSceneCandidate { id: string; sha256: string }
export type WritingSceneChoice = { kind: 'NEW' } | { kind: 'OWNER'; previousId: string };
export type WritingSceneChoices = Record<number, WritingSceneChoice>;
export interface WritingSceneMapEntry {
  id: string; start: number; end: number; match: 'EXACT' | 'OWNER' | 'NEW' | 'UNRESOLVED';
  previousId: string | null; candidates: WritingSceneCandidate[];
}
export interface WritingSceneMap { schemaVersion: 1; predecessorSha256: string | null; scenes: WritingSceneMapEntry[] }
export interface WritingSceneData { body: string; sceneMap?: WritingSceneMap }
export interface WritingSceneIdentity { id: string; heading: string; index: number; start: number; end: number; text: string; candidates: WritingSceneCandidate[] }
export interface WritingSceneComparison {
  sceneIndex: number; id: string; status: 'UNCHANGED' | 'MOVED' | 'EDITED' | 'NEW' | 'NEEDS_REVIEW'; previousId: string | null; candidates: WritingSceneCandidate[];
}
export interface WritingSceneMapProposal {
  map: WritingSceneMap | null; comparisons: WritingSceneComparison[];
  removed: Array<{ id: string; heading: string; index: number }>;
  error?: string;
}
export function validateWritingSceneMap(value: unknown, body: string): WritingSceneMap;
export function listWritingSceneIdentities(data: WritingSceneData | null, sha256: string | null): WritingSceneIdentity[];
export function proposeWritingSceneMap(body: string, baselineData?: WritingSceneData | null, baselineSha256?: string | null, choices?: WritingSceneChoices, createId?: (scene: SceneIndexEntry, index: number) => string): WritingSceneMapProposal;
export function validateWritingSceneTransition<T extends WritingSceneData>(data: T, previousRecord?: { data: WritingSceneData; sha256: string } | null): T;
