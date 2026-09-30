import type { SavedDraftRef, WritingProductionShot } from './writing-production.mjs';

export type ProductionRevisionDeltaStatus = 'added' | 'removed' | 'changed' | 'unchanged';
export interface ProductionRevisionCounts { added: number; removed: number; changed: number; unchanged: number; reordered: number }
export interface ProductionRevisionSceneSnapshot { ordinal: number; heading: string; textSha256: string; notes: string; characters: string[]; shotIds: string[] }
export interface ProductionSceneDelta { sceneId: string; status: ProductionRevisionDeltaStatus; reordered: boolean; changes: string[]; before: ProductionRevisionSceneSnapshot | null; after: ProductionRevisionSceneSnapshot | null }
export interface ProductionShotDelta { shotId: string; sceneId: string; status: ProductionRevisionDeltaStatus; reordered: boolean; changes: string[]; before: (WritingProductionShot & { ordinal: number; plannedDurationMs?: number | null }) | null; after: (WritingProductionShot & { ordinal: number; plannedDurationMs?: number | null }) | null }
export interface ProductionAffectedRecord { ref: SavedDraftRef; kind: string; reasons: string[] }
export interface ProductionRevisionPreview {
  schemaVersion: 1; status: 'REVIEW_ONLY'; scope: 'REVIEW_ONLY'; projectId: string;
  attachmentRef: SavedDraftRef; baselinePlanRef: SavedDraftRef; baselineDraftRef: SavedDraftRef; candidatePlanRef: SavedDraftRef; candidateDraftRef: SavedDraftRef;
  baselineSourceHash: string; candidateSourceHash: string; sourceChanged: boolean; metadataChanged: boolean;
  sceneDeltas: ProductionSceneDelta[]; shotDeltas: ProductionShotDelta[];
  characterCues: { added: string[]; removed: string[]; unchanged: string[] };
  affectedRecords: ProductionAffectedRecord[];
  summary: { scenes: ProductionRevisionCounts; shots: ProductionRevisionCounts; characterCuesAdded: number; characterCuesRemoved: number; affectedRecords: number };
  unplannedSceneIds: string[]; coverageReuseSceneIds: string[]; explanation: string; previewSha256: string;
}
export function validateProductionRevisionRequest(input: unknown): { projectId: string; planRef: SavedDraftRef };
export function validateProductionRevisionPreview(value: unknown): ProductionRevisionPreview;
/** Pure review. Records and both sources remain unchanged; freshness is enforced by the service. */
export function buildProductionRevisionPreview(base: unknown, attachment: unknown, baselinePlan: unknown, candidateDraft: unknown, candidatePlan: unknown, records: unknown[], hash: (text: string) => string, draftHistory?: unknown[]): ProductionRevisionPreview;
