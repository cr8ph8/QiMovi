export interface SavedDraftRef { id: string; version: number; sha256: string }
export interface WritingProductionShot { id: string; title: string; description: string; shotType: string; cameraMovement: string; durationSeconds: number | null }
export interface WritingProductionSceneSource { sceneId: string; ordinal: number; heading: string; start: number; end: number; textSha256: string; characters: string[] }
export interface WritingProductionScene extends WritingProductionSceneSource { notes: string; shots: WritingProductionShot[] }
export interface WritingProductionSource { draftRef: SavedDraftRef; title: string; bodySha256: string; sceneCount: number; characters: string[] }
export interface WritingProductionPlan { schemaVersion: 1; projectId: string; sourceHash: null; status: 'PLANNING_ONLY'; source: WritingProductionSource; scenes: WritingProductionScene[] }
export interface WritingProductionPreview { schemaVersion: 1; projectId: string; planId: string; previewSha256: string; source: WritingProductionSource; scenes: WritingProductionSceneSource[]; existingPlanRef: SavedDraftRef | null }
export interface WritingProductionSceneEdit { sceneId: string; notes: string; shots: WritingProductionShot[] }
export const WRITING_PRODUCTION_KIND: 'writing-production-plan';
export function validateWritingProductionDraftRef(ref: unknown): SavedDraftRef;
export function validateWritingProductionRequest(operation: 'preview' | 'handoff' | 'save', input: unknown): unknown;
export function validateWritingProductionEdits(scenes: unknown): WritingProductionSceneEdit[];
export function validateWritingProductionPlan(data: unknown, project: unknown): WritingProductionPlan;
export function writingProductionPlanId(projectId: string, draftRef: SavedDraftRef, hash: (text: string) => string): string;
export function buildWritingProductionBasis(project: unknown, draft: unknown, hash: (text: string) => string): { source: WritingProductionSource; scenes: WritingProductionSceneSource[] };
export function validateWritingProductionRecord(record: unknown, project: unknown, lookupDraft: (ref: SavedDraftRef) => unknown, hash: (text: string) => string): void;
