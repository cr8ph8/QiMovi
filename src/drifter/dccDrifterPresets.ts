import type { DccPrevizOptions } from './DccApi';

export type DrifterPrevizConflict = { shotId: string; sourceParagraphIds: string[]; description: string };
export type DrifterPrevizPreset = {
  sourceHash: string; sceneId: string; layout: DccPrevizOptions['layout']; subjectCount: number;
  blockingNotes: string; lookNotes: string; conflicts: DrifterPrevizConflict[];
  status: 'AUTHORED_DRAFT_FOR_REVIEW';
};

// Private production presets are intentionally excluded from the public source release.
// Imported or authored project planning remains available through the general DCC tools.
export function getDrifterPrevizPreset(_expectedSourceHash: string, _sceneId: string): DrifterPrevizPreset | null {
  return null;
}
