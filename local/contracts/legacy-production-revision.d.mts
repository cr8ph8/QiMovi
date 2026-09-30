import type { SavedDraftRef } from './writing-production.mjs';
import type { ProductionRevisionPreview } from './production-revision.mjs';
export interface LegacyProductionMapping { sourceSceneId: string; draftSceneId: string }
export interface LegacyProductionReviewRequest { projectId: string; sourceHash: string; draftRef: SavedDraftRef; mappings: LegacyProductionMapping[] }
export interface LegacyProductionApplyRequest extends LegacyProductionReviewRequest { previewSha256: string; sourceSceneId: string; shotIds: string[]; expectedVersion: number | null; requestId: string; notes: string }
export interface LegacyProductionSourceScene { sceneId: string; ordinal: number; heading: string; text: string; textSha256: string; shotIds: string[]; currentHandoff: { ref: SavedDraftRef; notes: string; shotIds: string[]; authoringRef: { id: string; sha256: string } } | null }
export interface LegacyProductionDraftScene { sceneId: string; ordinal: number; heading: string; start: number; end: number; text: string; textSha256: string; characters: string[]; identityNeedsReview: boolean }
export interface LegacyProductionRevisionPreview extends Pick<ProductionRevisionPreview, 'sceneDeltas' | 'shotDeltas' | 'summary' | 'characterCues' | 'affectedRecords'> {
 schemaVersion: 1; status: 'REVIEW_ONLY'; scope: 'PLANNING_CONTEXT'; projectId: string; sourceHash: string; sourceSnapshotSha256: string;
 draftRef: SavedDraftRef; draftBodySha256: string; mappings: LegacyProductionMapping[]; sourceScenes: LegacyProductionSourceScene[]; draftScenes: LegacyProductionDraftScene[];
 unmappedSourceSceneIds: string[]; unmappedDraftSceneIds: string[]; explanation: string; previewSha256: string;
}
export function validateLegacyProductionRevisionRequest(operation: 'review', input: unknown): LegacyProductionReviewRequest;
export function validateLegacyProductionRevisionRequest(operation: 'apply', input: unknown): LegacyProductionApplyRequest;
export function validateLegacyProductionRevisionPreview(input: unknown): LegacyProductionRevisionPreview;
export function buildLegacyProductionRevisionPreview(project: unknown, draft: unknown, mappings: LegacyProductionMapping[], records: unknown[], hash: (text: string) => string): LegacyProductionRevisionPreview;
export function legacyProductionSourceSnapshot(project: unknown, hash: (text: string) => string): string;
export function buildLegacyProductionHandoff(input: LegacyProductionApplyRequest, hash: (text: string) => string): { sourceHash: string; sceneId: string; authoringRef: {id:string;sha256:string}; shotIds:string[]; purpose:'PLANNING_CONTEXT'; notes:string };

export function legacyProductionPlanningNotes(notes: string): string;
