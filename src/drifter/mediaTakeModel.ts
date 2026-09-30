import { validateMediaRecord } from '../../local/contracts/media-takes.mjs';
import type { MediaTakeEntry, MediaTakeRecord, TakeReviewRecord } from './mediaTakeTypes';
import type { Project, WorkspaceRecord } from './types';

/** Read-only shot projection; scene references are distinct from exact-shot takes. */
export function shotMediaTakes(project: Project, records: readonly WorkspaceRecord[], sceneId: string, shotId: string): MediaTakeEntry[] {
  const heads = new Map<string, WorkspaceRecord>();
  for (const record of records) if (!heads.has(record.id) || heads.get(record.id)!.version < record.version) heads.set(record.id, record);
  const result: MediaTakeEntry[] = [];
  for (const record of heads.values()) {
    if (record.kind !== 'measured-media-take') continue;
    const take = record as MediaTakeRecord;
    if (take.data.sourceHash !== project.sourceHash || take.data.sceneId !== sceneId || take.data.shotId !== shotId) continue;
    try { validateMediaRecord(take.kind, take.data, project); } catch { continue; }
    const review = heads.get(`take-review:${record.sha256}`) as TakeReviewRecord | undefined;
    if (review) {
      try { validateMediaRecord(review.kind, review.data, project); } catch { continue; }
      if (review.kind !== 'take-review' || review.data.takeRef.id !== take.id || review.data.takeRef.sha256 !== take.sha256 || review.data.sceneId !== take.data.sceneId) continue;
    }
    result.push({ record: take, review: review ?? null, mediaUrl: `/api/blobs/${take.data.blob.sha256}` });
  }
  return result;
}
