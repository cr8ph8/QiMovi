import type { AuthoringInputRef, Project, Scene, WorkspaceRecord } from './types';

export const MAX_MEDIA_TAKE_BYTES = 256 * 1024 * 1024;
export interface MediaTakeData {
  schemaVersion: 1; sourceHash: string; sceneId: string; shotId: string | null;
  briefRef: AuthoringInputRef | null; originalFilename: string;
  origin: 'IMPORTED_USER_MEDIA' | 'RETAINED_PROVIDER_OUTPUT' | 'RETAINED_PROJECT_ASSET' | 'RETAINED_DCC_MOTION'; providerProvenance: 'UNVERIFIED' | 'HIGGSFIELD_MCP_RECORD' | 'LOCAL_BLENDER_RENDER';
  retainedSource?: AuthoringInputRef;
  blob: { sha256: string; byteLength: number; mimeType: string };
  measurement: { durationMs: number; width: number; height: number; frameRate: string; videoCodec: string;
    audio: { codec: string; channels: number; sampleRate: string }[]; videoFrameCount: number };
  probe: { toolIdentity: 'AVFOUNDATION' | 'FFPROBE'; outputSha256: string }; measuredAt: string;
}
export type TakeDecision = 'PENDING' | 'KEEP_CANDIDATE' | 'REJECT';
export interface TakeReviewData {
  schemaVersion: 1; sourceHash: string; sceneId: string; takeRef: AuthoringInputRef;
  decision: TakeDecision; note: string; actor: 'local-owner'; scope: 'CANDIDATE_PREFERENCE_ONLY'; reviewedAt: string;
}
export type MediaTakeRecord = WorkspaceRecord & { kind: 'measured-media-take'; data: MediaTakeData };
export type TakeReviewRecord = WorkspaceRecord & { kind: 'take-review'; data: TakeReviewData };
export interface MediaTakeEntry { record: MediaTakeRecord; review: TakeReviewRecord | null; mediaUrl: string }
export interface MediaTakeCatalog {
  schemaVersion: 'filmstack-media-takes/v1'; sourceHash: string; sceneId: string;
  maxUploadBytes: number; takes: MediaTakeEntry[]; legacyTakes: WorkspaceRecord[];
}
export interface MediaTakeIntake {
  requestId: string; sourceHash: string; sceneId: string; shotId: string | null;
  briefRef: AuthoringInputRef | null; originalFilename: string;
}
export interface TakeReviewInput {
  requestId: string; expectedVersion: number | null; takeSha256: string; decision: TakeDecision; note: string;
}
export interface RetainedMediaIntake {
  requestId: string; sourceHash: string; sceneId: string; shotId: string | null;
  briefRef: AuthoringInputRef | null; retainedSource: AuthoringInputRef; assetHash: string;
}
export interface MediaTakeApi {
  list(project: Project, scene: Scene, signal?: AbortSignal): Promise<MediaTakeCatalog>;
  importFile(project: Project, scene: Scene, file: File, intake: MediaTakeIntake, signal?: AbortSignal): Promise<MediaTakeEntry>;
  review(project: Project, entry: MediaTakeEntry, input: TakeReviewInput): Promise<TakeReviewRecord>;
  preview(entry: MediaTakeEntry, signal?: AbortSignal): Promise<Blob>;
  measureRetained?(project: Project, scene: Scene, input: RetainedMediaIntake): Promise<MediaTakeEntry>;
}
