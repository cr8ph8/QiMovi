import { shotMediaTakes } from './mediaTakeModel';
import { resolveClipEditSelection, type ClipEditResolution } from './movieEditSelectionModel';
import type { MovieClip } from './movieSequenceModel';
import { readShotDirection, type ShotDirectionRecord } from './shotDirectionModel';
import { deriveStoryboardSequence, type StoryboardSequenceShot } from './storyboardSequenceModel';
import { deriveShotWork } from './storyboardWorkModel';
import type { Project, Scene, WorkspaceRecord } from './types';

export interface SceneCoverageRow {
  shot: StoryboardSequenceShot;
  direction: ShotDirectionRecord | undefined;
  sourceLinkCount: number;
  takeCount: number;
  keptCount: number;
  clips: { clip: MovieClip; index: number; resolution: ClipEditResolution }[];
  nextShot?: StoryboardSequenceShot;
}

/** One current head per ID. A disputed head cannot expose an older version. */
function unambiguousHeads(records: readonly WorkspaceRecord[]): WorkspaceRecord[] {
  const heads = new Map<string, WorkspaceRecord>();
  const disputed = new Set<string>();
  for (const record of records) {
    if (!Number.isSafeInteger(record.version) || record.version < 1) continue;
    const previous = heads.get(record.id);
    if (!previous || record.version > previous.version) {
      heads.set(record.id, record); disputed.delete(record.id);
    } else if (record.version === previous.version && (record.sha256 !== previous.sha256 || record.kind !== previous.kind)) {
      disputed.add(record.id);
    }
  }
  return [...heads.values()].filter(record => !disputed.has(record.id));
}

/** Presence and owner preferences only. This view neither approves coverage nor
 * makes a kept candidate into an editorial selection or qualified final take. */
export function deriveSceneCoverage(project: Project, records: readonly WorkspaceRecord[], clips: readonly MovieClip[], sceneId: string): { scene: Scene; rows: SceneCoverageRow[] } | null {
  const current = unambiguousHeads(records);
  const sequence = deriveStoryboardSequence(project, current);
  const scene = sequence.scenes.find(row => row.scene.id === sceneId);
  if (!scene) return null;
  return {
    scene: scene.scene,
    rows: scene.shots.map(shot => {
      const takes = shotMediaTakes(project, current, sceneId, shot.id);
      return {
        shot,
        direction: readShotDirection(project, current, sceneId, shot.id),
        sourceLinkCount: deriveShotWork(project, current, sceneId, shot.id)?.linkedSourceCount ?? 0,
        takeCount: takes.length,
        keptCount: takes.filter(take => take.review?.data.decision === 'KEEP_CANDIDATE').length,
        clips: clips.flatMap((clip, index) => clip.sceneId === sceneId && clip.shotId === shot.id
          ? [{ clip, index, resolution: resolveClipEditSelection(clip, project, current) }] : []),
        nextShot: sequence.shots[shot.position + 1],
      };
    }),
  };
}
