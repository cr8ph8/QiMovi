import { useEffect, useRef, useState } from 'react';
import { canonicalJson } from './canonical';
import type { WritingRecovery, WritingRecoveryApi } from './writingRecoveryApi';

export type WritingCheckpoint = Pick<WritingRecovery, 'draftId' | 'data' | 'baseVersion' | 'baseSha256' | 'saveRequestId'>;
type Session = {
  id: string; row: WritingRecovery | null;
  pending: { input: Parameters<WritingRecoveryApi['put']>[1]; fingerprint: string } | null;
  tail: Promise<unknown>;
};
const createSession = (): Session => ({ id: `writing-recovery:${crypto.randomUUID()}`, row: null, pending: null, tail: Promise.resolve() });
const fields = (row: WritingRecovery): WritingCheckpoint => ({ draftId: row.draftId, data: row.data, baseVersion: row.baseVersion, baseSha256: row.baseSha256, saveRequestId: row.saveRequestId });
const message = (error: unknown) => error instanceof Error ? error.message : 'Local recovery was not confirmed.';

/** Checkpoints are working copies. Only the separate save action creates a draft revision. */
export function useWritingRecovery(api: WritingRecoveryApi | undefined, scope: string, snapshot: WritingCheckpoint, dirty: boolean) {
  const [copies, setCopies] = useState<WritingRecovery[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [protectedFingerprint, setProtectedFingerprint] = useState('');
  const session = useRef(createSession());
  const alive = useRef(true);
  const activeScope = useRef(scope); activeScope.current = scope;
  const fingerprint = canonicalJson(snapshot);
  const latest = useRef(snapshot); latest.current = snapshot;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const flushRef = useRef<() => void>(() => {});
  const loadSerial = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function refresh() {
    if (!api) return;
    const serial = ++loadSerial.current;
    try {
      const rows = await api.list();
      if (alive.current && activeScope.current === scope && loadSerial.current === serial) {
        setCopies(rows); setError('');
      }
    } catch (caught) { if (alive.current && activeScope.current === scope && loadSerial.current === serial) setError(message(caught)); }
  }
  useEffect(() => {
    session.current = createSession(); setCopies([]); setProtectedFingerprint(''); setStatus(''); setError('');
    void refresh();
    // A scope owns its transport and working copies; editor changes must not reload this list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, scope]);

  function checkpoint(value: WritingCheckpoint = latest.current): Promise<void> {
    if (!api) return Promise.resolve();
    const target = session.current;
    const frozen = JSON.parse(canonicalJson(value)) as WritingCheckpoint;
    const wanted = canonicalJson(frozen);
    const current = () => alive.current && activeScope.current === scope && session.current === target;
    const task = target.tail.catch(() => {}).then(async () => {
      // Resolve an uncertain write with its original request before sending newer text.
      if (target.pending) {
        target.row = await api.put(target.id, target.pending.input);
        target.pending = null;
      }
      if (!target.row || canonicalJson(fields(target.row)) !== wanted) {
        const input = { ...frozen, expectedVersion: target.row?.version ?? null, requestId: crypto.randomUUID() };
        target.pending = { input, fingerprint: wanted };
        target.row = await api.put(target.id, input);
        target.pending = null;
      }
      if (current()) {
        setProtectedFingerprint(wanted); setError(''); setStatus('Recovery copy saved on this Mac');
        setCopies(previous => [...previous.filter(row => row.id !== target.id), target.row!]);
      }
    }).catch(caught => {
      if (current()) {
        if (caught && typeof caught === 'object' && 'status' in caught && caught.status === 409) {
          // A confirmed CAS rejection is not an uncertain network reply. Another
          // window may have archived this copy: retry on a fresh branch, never
          // keep replaying a permanently rejected request or overwrite that copy.
          session.current = createSession(); setProtectedFingerprint('');
          setError(`${message(caught)}. Retry to start a separate recovery copy; your writing is retained.`);
        } else setError(message(caught));
        setStatus('Recovery not confirmed');
      }
      throw caught;
    });
    target.tail = task;
    return task;
  }
  flushRef.current = () => { if (dirtyRef.current) void checkpoint().catch(() => {}); };
  useEffect(() => () => flushRef.current(), []);
  useEffect(() => {
    if (!api || !dirty) return;
    const timer = window.setTimeout(() => { void checkpoint().catch(() => {}); }, 400);
    return () => window.clearTimeout(timer);
    // Snapshot fingerprint includes the exact text, metadata, base and pending save identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, scope, fingerprint, dirty]);

  /** Preserve the outgoing copy on navigation. It remains available in Recover writing. */
  function leave() {
    if (dirtyRef.current) void checkpoint().catch(() => {});
    session.current = createSession(); setProtectedFingerprint(''); setStatus('');
  }
  function adopt(row: WritingRecovery) {
    leave();
    // Start a separate branch when recovering: another window may still own the original.
    // Retain the original until the owner explicitly archives it.
    session.current = createSession();
    setProtectedFingerprint(''); setStatus(`Recovered copy from ${new Date(row.updatedAt).toLocaleString()}`);
  }
  async function archive(row: WritingRecovery) {
    if (!api) return;
    const result = await api.resolve(row.id, { expectedVersion: row.version, requestId: `resolve:${row.id}:${row.version}` });
    if (alive.current && activeScope.current === scope) setCopies(previous => previous.filter(copy => copy.id !== result.id));
  }
  async function saved() {
    const target = session.current;
    // Retire this branch before awaiting its writes or archive response. A late
    // checkpoint must not reuse the version of a copy that is being resolved.
    // Already queued writes still finish on target; newer writing gets its own copy.
    session.current = createSession(); setProtectedFingerprint(''); setStatus(''); setError('');
    await target.tail.catch(() => {});
    if (target.row && !target.pending) await archive(target.row);
  }
  return {
    copies, error, refresh, checkpoint, leave, adopt, archive, saved, activeId: session.current.id,
    status: !api ? 'Recovery unavailable in this connection' : dirty && protectedFingerprint !== fingerprint ? (error ? 'Recovery not confirmed' : 'Saving recovery copy…') : status || (copies.length ? `${copies.length} recovery ${copies.length === 1 ? 'copy available' : 'copies available'} in draft recovery` : 'Local recovery ready'),
  };
}
