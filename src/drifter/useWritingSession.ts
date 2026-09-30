import { useEffect, useRef, useState } from 'react';
import { canonicalJson, hashCanonical } from './canonical';
import { finishWritingClock, observedActiveMs, pauseWritingClock, resumeWritingClock, startWritingClock, type SessionClock } from './writingSession';
import type { WorkspaceApi, WorkspaceRecord, WritingSession } from './types';

type Pending = { id: string; requestId: string; data: WritingSession };
type Props = { draftId: string; sourceHash: string; saved: WorkspaceRecord | null; dirty: boolean; words: number; visible: boolean; api: WorkspaceApi; onSaved(record: WorkspaceRecord): void };

export function useWritingSession({ draftId, sourceHash, saved, dirty, words, visible, api, onSaved }: Props) {
  const [clock, setClock] = useState<SessionClock | null>(null);
  const clockRef = useRef<SessionClock | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);
  const scope = `${sourceHash}:${draftId}`, liveScope = useRef(scope); liveScope.current = scope;
  const saving = useRef(false);
  const writeClock = (value: SessionClock | null) => { clockRef.current = value; setClock(value); setElapsed(value ? observedActiveMs(value, performance.now()) : 0); };
  const pause = () => { if (clockRef.current) writeClock(pauseWritingClock(clockRef.current, performance.now())); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!visible && clockRef.current?.activeSince !== null) {
      if (clockRef.current) { writeClock(pauseWritingClock(clockRef.current, performance.now())); setNotice('Session paused when you left the writer. Resume when ready.'); }
    }
  }, [visible]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden && clockRef.current?.activeSince != null) { writeClock(pauseWritingClock(clockRef.current, performance.now())); setNotice('Session paused while the window was hidden. Resume when ready.'); }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, []);
  useEffect(() => {
    if (!clock || clock.activeSince === null) return;
    const timer = window.setInterval(() => { if (clockRef.current) setElapsed(observedActiveMs(clockRef.current, performance.now())); }, 250);
    return () => window.clearInterval(timer);
  }, [clock]);
  const start = () => {
    if (!saved || dirty || clock || pending || busy || saved.id !== draftId) return;
    writeClock(startWritingClock(Date.now(), performance.now(), words)); setError(''); setNotice('Timer running from your explicit Start. This measures elapsed active-session time, not keystrokes.');
  };
  const resume = () => { if (clockRef.current && !pending && !busy) { writeClock(resumeWritingClock(clockRef.current, performance.now())); setNotice('Timer resumed.'); } };
  async function finish() {
    if (saving.current || (!pending && (!saved || dirty || !clockRef.current))) return;
    saving.current = true; setBusy(true); setError('');
    let input = pending;
    try {
      if (!input) {
        const paused = pauseWritingClock(clockRef.current!, performance.now()); writeClock(paused);
        if (saved!.id !== draftId || saved!.kind !== 'screenplay-draft' || await hashCanonical(saved!.data) !== saved!.sha256) throw new Error('Saved draft evidence does not match. Refresh and reopen the draft before recording a session.');
        const data = finishWritingClock(paused, Date.now(), performance.now(), { id: draftId, sha256: saved!.sha256, sourceHash }, words);
        input = { id: `writing-session:${crypto.randomUUID()}`, requestId: crypto.randomUUID(), data };
        setPending(input);
      }
      const record = await api.saveRecord({ ...input, kind: 'writing-session', expectedVersion: null });
      if (record.id !== input.id || record.kind !== 'writing-session' || record.version !== 1 || canonicalJson(record.data) !== canonicalJson(input.data) || record.sha256 !== await hashCanonical(input.data)) throw new Error('The session response did not match. Retry this exact completed session.');
      if (mounted.current && liveScope.current === scope) { setPending(null); writeClock(null); setNotice('Writing session saved locally. The counts are observations of your saved text.'); onSaved(record); }
    } catch (caught) {
      if (mounted.current && liveScope.current === scope) setError(caught instanceof Error ? caught.message : 'Session save was not confirmed. Retry to confirm the same record.');
    } finally { saving.current = false; if (mounted.current && liveScope.current === scope) setBusy(false); }
  }
  const discard = () => { if (busy || pending) return; writeClock(null); setError(''); setNotice('Timer discarded. Your writing is retained.'); };
  return { clock, elapsed, pending, busy, error, notice, start, pause, resume, finish, discard, hasSession: !!clock || !!pending };
}
