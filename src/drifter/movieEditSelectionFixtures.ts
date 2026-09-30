import { hashCanonical } from './canonical';
import type { Project } from './types';
import type { MediaTakeRecord, TakeReviewRecord, MediaTakeEntry } from './mediaTakeTypes';
import type { ClipEditSelection, MovieClip } from './movieSequenceModel';

/** Synthetic data for focused cut-selection tests, never imported into a workspace. */
export async function editSelectionFixture() {
  const project: Project = { id: 'cut-fixture', title: 'Cut fixture', sourceHash: 'a'.repeat(64), sourceStatus: 'PENDING_OWNER_ADMISSION', characters: [], continuityQuestions: [], cells: [], scenes: [{ id: 'scene-1', index: 1, heading: 'EXT. FIELD - DAY', paragraphs: [], shots: [{ id: 'shot-a', label: '1A', description: 'Arrival', plannedDurationMs: null }, { id: 'shot-b', label: '1B', description: 'Response', plannedDurationMs: null }] }] };
  const data: MediaTakeRecord['data'] = { schemaVersion: 1, sourceHash: project.sourceHash, sceneId: 'scene-1', shotId: 'shot-a', briefRef: null, originalFilename: 'arrival.mp4', origin: 'IMPORTED_USER_MEDIA', providerProvenance: 'UNVERIFIED', blob: { sha256: 'b'.repeat(64), byteLength: 10, mimeType: 'video/mp4' }, measurement: { durationMs: 10000, width: 640, height: 360, frameRate: '24/1', videoCodec: 'h264', audio: [], videoFrameCount: 240 }, probe: { toolIdentity: 'AVFOUNDATION', outputSha256: 'c'.repeat(64) }, measuredAt: '2026-09-18T00:00:00.000Z' };
  const hash = await hashCanonical(data), take: MediaTakeRecord = { id: `measured-media-take:${hash}`, sha256: hash, version: 1, kind: 'measured-media-take', data };
  const reviewData: TakeReviewRecord['data'] = { schemaVersion: 1, sourceHash: project.sourceHash, sceneId: 'scene-1', takeRef: { id: take.id, sha256: take.sha256 }, decision: 'KEEP_CANDIDATE', note: '', actor: 'local-owner', scope: 'CANDIDATE_PREFERENCE_ONLY', reviewedAt: '2026-09-18T00:00:00.000Z' };
  const review: TakeReviewRecord = { id: `take-review:${hash}`, kind: 'take-review', version: 1, sha256: await hashCanonical(reviewData), data: reviewData };
  const clip: MovieClip = { id: 'clip-1', sceneId: 'scene-1', shotId: 'shot-a', sourceRefs: [], note: 'Keep the arrival', plannedDurationMs: 7000 };
  const selection: ClipEditSelection = { takeRef: { id: take.id, sha256: take.sha256 }, reviewRef: { id: review.id, sha256: review.sha256 }, assetHash: data.blob.sha256, inMs: 1000, outMs: 5000 };
  const entry: MediaTakeEntry = { record: take, review, mediaUrl: `/api/blobs/${data.blob.sha256}` };
  return { project, take, review, clip, selection, entry, records: [take, review] };
}
