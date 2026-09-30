import { useState } from 'react';
import type { useWritingDraft } from './useWritingDraft';
import './writingRecovery.css';

export default function WritingRecoveryControls({ draft, disabled = false }: { draft: ReturnType<typeof useWritingDraft>; disabled?: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const copies = draft.recovery.copies.filter(row => row.id !== draft.recovery.activeId);
  async function perform(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Recovery action was not confirmed.'); }
    finally { setBusy(false); }
  }
  return <section className="writing-recovery" aria-label="Recover writing">
    <div className="writing-recovery-heading"><strong>Recover writing</strong><button type="button" disabled={disabled || busy} onClick={() => void perform(draft.recovery.refresh)}>Refresh recovery copies</button></div>
    {draft.dirty && <button type="button" disabled={disabled || busy} onClick={() => void perform(() => draft.recovery.checkpoint())}>Save recovery copy now</button>}
    <p>Recovery copies protect unfinished writing. Save a revision when you are ready to keep your changes in draft history.</p>
    {copies.length === 0 ? <small>No other recovery copies found.</small> : <><p>{draft.dirty ? 'Save your open writing or open a new draft before recovering another copy.' : 'Choose a copy to review. Newer saved revisions stay protected.'}</p><ul>{copies.map(copy => <li key={copy.id}>
      <div><strong>{copy.data.title || 'Untitled screenplay'}</strong><small>{new Date(copy.updatedAt).toLocaleString()} · {copy.baseVersion ? `from v${copy.baseVersion}` : 'new draft'} · {copy.data.body.length.toLocaleString()} characters</small></div>
      <div className="writing-recovery-actions"><button type="button" disabled={disabled || busy || draft.dirty} onClick={() => void perform(() => draft.restore(copy))}>Recover writing</button><button type="button" disabled={disabled || busy} onClick={() => void perform(() => draft.recovery.archive(copy))}>Archive recovery copy</button></div>
    </li>)}</ul><small>Archived copies remain in local storage and backups.</small></>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
