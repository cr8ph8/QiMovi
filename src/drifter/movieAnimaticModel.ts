import { getDrifterStoryboardBeats } from './drifterStoryboardBeats';
import type { MovieClip } from './movieSequenceModel';
import type { Project } from './types';

export interface AnimaticSpan { clip: MovieClip; index: number; startMs: number; endMs: number }
export interface AnimaticSequence { spans: AnimaticSpan[]; totalMs: number; untimedCount: number; playable: boolean }
export interface MovieTimingProposal {
  clips: MovieClip[];
  changes: { clipId: string; previousMs: null; proposedMs: number; reason: string }[];
  totalMs: number;
}

const maximumMs = 180000;
const validDuration = (value: number | null): value is number => Number.isSafeInteger(value) && value! > 0 && value! <= maximumMs;

/** An incomplete board has no continuous time axis. Never squeeze out its gaps. */
export function buildAnimaticSequence(clips: MovieClip[]): AnimaticSequence {
  const untimedCount = clips.filter(clip => !validDuration(clip.plannedDurationMs)).length;
  if (!clips.length || untimedCount) return { spans: [], totalMs: 0, untimedCount, playable: false };
  let totalMs = 0;
  const spans = clips.map((clip, index) => {
    const startMs = totalMs;
    totalMs += clip.plannedDurationMs!;
    return { clip, index, startMs, endMs: totalMs };
  });
  return { spans, totalMs, untimedCount: 0, playable: true };
}

/** Interior cuts belong to the next clip; the exact end keeps the last frame visible. */
export function clipAtAnimaticTime(model: AnimaticSequence, ms: number): AnimaticSpan | null {
  if (!model.playable || !Number.isFinite(ms) || ms < 0 || ms > model.totalMs) return null;
  if (ms === model.totalMs) return model.spans.at(-1) ?? null;
  return model.spans.find(span => ms >= span.startMs && ms < span.endMs) ?? null;
}

// Public release: no film-specific beat estimates are bundled.
// Source-linked generic timing estimates remain reviewable proposals.
const drifterAllowances: Record<string, [number, string]> = {};

const sameRefs = (left: string[], right: string[]) => left.length === right.length
  && new Set(left).size === left.length && left.every(ref => right.includes(ref));

/** Build reviewable timing proposals only. Caller chooses whether to apply/save.
 * Dialogue shared by several clips is budgeted once, at its first sequence
 * occurrence; source links remain on every clip. This is an editing assumption,
 * not a spoken-line placement, sound track, generation split or coverage approval. */
export function proposeMovieTiming(project: Project, clips: MovieClip[]): MovieTimingProposal {
  const changes: MovieTimingProposal['changes'] = [];
  const seenDialogue = new Set<string>();
  const proposed = clips.map(clip => {
    const scene = project.scenes.find(value => value.id === clip.sceneId);
    const paragraphs = scene?.paragraphs.filter(paragraph => clip.sourceRefs.includes(paragraph.id)) ?? [];
    const dialogue = paragraphs.filter(paragraph => paragraph.type.toLowerCase() === 'dialogue');
    const firstDialogue = dialogue.filter(paragraph => !seenDialogue.has(`${scene!.id}:${paragraph.id}`));
    dialogue.forEach(paragraph => seenDialogue.add(`${scene!.id}:${paragraph.id}`));
    if (clip.plannedDurationMs !== null) return clip;

    const prefix = `drifter-clip:${project.sourceHash}:`;
    const beat = clip.id.startsWith(prefix) ? getDrifterStoryboardBeats(project, clip.sceneId, clip.shotId)
      .find(value => value.id === clip.id.slice(prefix.length)) : undefined;
    const exactBeat = beat && sameRefs(clip.sourceRefs, beat.sourceParagraphIds.filter(ref => scene!.paragraphs.some(paragraph => paragraph.id === ref)));
    const key = exactBeat ? beat.id.replace(/^previz-scene-(\d+)-beat-(\d+)$/, '$1-$2') : '';
    const allowance = drifterAllowances[key];
    const actionCount = paragraphs.filter(paragraph => paragraph.type.toLowerCase() === 'action').length;
    const actionMs = allowance ? allowance[0] * 1000 : Math.max(3000, actionCount * 2000);
    const words = firstDialogue.reduce((count, paragraph) => count + (paragraph.text.trim().match(/\S+/g)?.length ?? 0), 0);
    const estimateMs = Math.ceil((actionMs + words * 400 + firstDialogue.length * 650) / 250) * 250;
    const proposedMs = Math.min(maximumMs, estimateMs);
    const repeated = dialogue.length - firstDialogue.length;
    const reason = [
      allowance ? `Drifter beat estimate: ${allowance[1]} (${allowance[0]} s).`
        : `Generic planning estimate: ${actionMs / 1000} s action/reaction allowance from ${actionCount} linked action paragraph(s); no exact Drifter beat timing applies.`,
      `${words} first-occurrence dialogue words at 150 words/minute, plus 0.65 s per dialogue cue.`,
      repeated ? `${repeated} shared dialogue paragraph(s) already budgeted at an earlier clip; review the cut and dialogue placement.` : '',
      estimateMs > maximumMs ? `The uncapped estimate is ${estimateMs / 1000} s; capped at 180 s. Review a meaningful split before generation.` : '',
      'Estimate only; review pacing and actual performance. Existing timing and screenplay text stay unchanged.',
    ].filter(Boolean).join(' ');
    changes.push({ clipId: clip.id, previousMs: null, proposedMs, reason });
    return { ...clip, plannedDurationMs: proposedMs };
  });
  return { clips: proposed, changes, totalMs: buildAnimaticSequence(proposed).totalMs };
}
