import sharedBeats from '../../local/content/drifter-storyboard-beats.json';
import type { CellRole, Project } from './types';

export interface DrifterStoryboardBeat {
  id: string; label: string; roleSuggestion: CellRole; direction: string; sourceParagraphIds: string[];
}
// Authored, untimed proposals from outputs/drifter-phone-previz-2026-09-13/scene-data.json.
// Retained exact paragraph text/type guards keep these notes tied to that source.
// This is a read-only fixture, not saved cells, reviewed coverage or choreography.
const { sourceHash, expectedPrologue } = sharedBeats;
type SourceFacts = { heading: string; shotIds: string[]; paragraphs: string[][] };
const expectedScenes: Record<string, SourceFacts> = sharedBeats.expectedScenes;
const beats = sharedBeats.beats as Record<string, DrifterStoryboardBeat[]>;

function exactParagraphs(actual: { id: string; type: string; text: string }[], expected: string[][]): boolean {
  return actual.length === expected.length && actual.every((paragraph, index) => {
    const [id, type, text] = expected[index];
    return paragraph.id === id && paragraph.type === type && paragraph.text === text;
  });
}

/** Cross-scene appearance citations may be displayed, but must not be blindly saved
 * into scene-scoped cell actionRefs. No source or storyboard record is written. */
export function getDrifterStoryboardBeats(project: Project, sceneId: string, shotId: string): DrifterStoryboardBeat[] {
  if (project.sourceHash !== sourceHash || project.scenes.length !== Object.keys(expectedScenes).length ||
      !exactParagraphs(project.prologue ?? [], expectedPrologue)) return [];
  const sceneIds = Object.keys(expectedScenes);
  if (!project.scenes.every((scene, index) => {
    const expected = expectedScenes[scene.id];
    return expected && scene.id === sceneIds[index] && scene.heading === expected.heading &&
      exactParagraphs(scene.paragraphs, expected.paragraphs) && scene.shots.length === expected.shotIds.length &&
      scene.shots.every((shot, position) => shot.id === expected.shotIds[position]);
  })) return [];
  if (!project.scenes.some(scene => scene.id === sceneId && scene.shots.some(shot => shot.id === shotId))) return [];
  return (beats[shotId] ?? []).map(beat => ({ ...beat, sourceParagraphIds: [...beat.sourceParagraphIds] }));
}
