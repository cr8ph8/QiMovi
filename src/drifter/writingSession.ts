import type { WritingSession } from './types';

export interface SessionClock { startedAt: string; startedWall: number; activeSince: number | null; activeMs: number; wordsStart: number }
const maximumMs = 24 * 60 * 60 * 1000;
export function startWritingClock(wall: number, monotonic: number, wordsStart: number): SessionClock {
  return { startedAt: new Date(wall).toISOString(), startedWall: wall, activeSince: monotonic, activeMs: 0, wordsStart };
}
export function observedActiveMs(clock: SessionClock, monotonic: number): number {
  return Math.max(0, Math.floor(clock.activeMs + (clock.activeSince === null ? 0 : Math.max(0, monotonic - clock.activeSince))));
}
export function pauseWritingClock(clock: SessionClock, monotonic: number): SessionClock {
  return { ...clock, activeMs: observedActiveMs(clock, monotonic), activeSince: null };
}
export function resumeWritingClock(clock: SessionClock, monotonic: number): SessionClock {
  return clock.activeSince === null ? { ...clock, activeSince: monotonic } : clock;
}
export function finishWritingClock(clock: SessionClock, wall: number, monotonic: number, draft: { id: string; sha256: string; sourceHash: string }, wordsEnd: number): WritingSession {
  const elapsed = wall - clock.startedWall;
  const activeMs = observedActiveMs(clock, monotonic);
  if (elapsed < 0 || elapsed > maximumMs || activeMs > elapsed + 1000) throw new Error('The system clock changed or the session exceeded 24 hours. Discard this timer and start a new session; the screenplay is retained.');
  return { sourceHash: draft.sourceHash, draftId: draft.id, draftSha256: draft.sha256, startedAt: clock.startedAt, endedAt: new Date(wall).toISOString(), activeMs: Math.min(activeMs, elapsed), wordsStart: clock.wordsStart, wordsEnd, metricsOrigin: 'LOCAL_EDITOR_OBSERVATION' };
}
export function formatWritingTime(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
