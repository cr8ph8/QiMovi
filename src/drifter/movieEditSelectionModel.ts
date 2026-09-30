import { shotMediaTakes } from './mediaTakeModel';
import { validateClipEditSelection, type ClipEditSelection, type MovieClip } from './movieSequenceModel';
import type { MediaTakeEntry } from './mediaTakeTypes';
import type { Project, WorkspaceRecord } from './types';

export interface ClipEditResolution {
  state: 'NONE' | 'READY' | 'NEEDS_REVIEW'; entry: MediaTakeEntry | null;
  reason: string; selection: ClipEditSelection | null;
}

/** A kept candidate is eligible; only an explicit, exact selection becomes a cut. */
export function resolveClipEditSelection(clip: MovieClip, project: Project, records: readonly WorkspaceRecord[]): ClipEditResolution {
  if (!clip.editSelection) return { state: 'NONE', entry: null, selection: null, reason: 'Choose a take and range for this clip.' };
  const selection = clip.editSelection;
  const invalid = (reason: string): ClipEditResolution => ({ state: 'NEEDS_REVIEW', entry: null, selection, reason });
  try { validateClipEditSelection(selection); } catch (error) { return invalid(error instanceof Error ? error.message : 'Review the saved take range.'); }
  // A conflicting head cannot establish the current owner preference.
  for (const id of [selection.takeRef.id, selection.reviewRef.id]) {
    const matching = records.filter(row => row.id === id), version = Math.max(...matching.map(row => row.version));
    if (new Set(matching.filter(row => row.version === version).map(row => row.sha256)).size > 1) return invalid('Conflicting take records are loaded. Refresh before selecting footage.');
  }
  const entry = shotMediaTakes(project, records, clip.sceneId, clip.shotId).find(row => row.record.id === selection.takeRef.id);
  if (!entry || entry.record.sha256 !== selection.takeRef.sha256 || entry.record.data.blob.sha256 !== selection.assetHash) return invalid('The selected take is unavailable or no longer matches this shot. Choose it again from reviewed takes.');
  if (!entry.review || entry.review.id !== selection.reviewRef.id || entry.review.sha256 !== selection.reviewRef.sha256 || entry.review.data.decision !== 'KEEP_CANDIDATE') return invalid('The take review changed. Review and reselect this cut before preview or export.');
  if (selection.outMs > entry.record.data.measurement.durationMs) return invalid('The out point exceeds the measured video duration.');
  return { state: 'READY', entry, selection, reason: 'Exact reviewed take and range selected. Save the movie sequence to retain this cut.' };
}

export function parseEditSeconds(text: string): number | null {
  if (!/^\d+(?:\.\d{1,3})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.'), ms = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  return Number.isSafeInteger(ms) && ms >= 0 ? ms : null;
}
