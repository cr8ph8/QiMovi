import { useEffect, useRef, useState, type FormEvent } from 'react';
import QiMoviBrand from './QiMoviBrand';
import { desktopSessionBridge } from './desktopSession';
import './session-recovery.css';

export default function SessionRecovery({ loading, error, token, onToken, onSubmit, onRetry }: {
  loading: boolean;
  error: string | null;
  token: string;
  onToken(value: string): void;
  onSubmit(event: FormEvent): void;
  onRetry(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const restoreButton = useRef<HTMLButtonElement>(null);
  const restoring = useRef(false), mounted = useRef(true);
  const [nativeBusy, setNativeBusy] = useState(false);
  const [nativeError, setNativeError] = useState('');
  const bridge = desktopSessionBridge();
  const busy = loading || nativeBusy;
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement;
    (restoreButton.current ?? input.current)?.focus();
    return () => { mounted.current = false; if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const restore = async () => {
    if (!bridge || restoring.current || loading) return;
    restoring.current = true; setNativeBusy(true); setNativeError('');
    try {
      if (await bridge.postMessage({ action: 'restore' }) !== true) throw new Error('Restoration was not confirmed.');
      if (mounted.current) onRetry();
    } catch {
      if (mounted.current) setNativeError('Access could not be restored. Keep this window open and check the desktop connection before trying again.');
    } finally { restoring.current = false; if (mounted.current) setNativeBusy(false); }
  };
  const detail = nativeError || (error === 'OWNER_SESSION_REQUIRED' ? '' : error);

  return <main className="session-recovery" role="dialog" aria-modal="true" aria-labelledby="session-recovery-title"
    onKeyDown={event => {
      // Mounted draft panels have document-level shortcuts. Recovery owns keyboard
      // focus until the ordinary local session check succeeds.
      event.stopPropagation();
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)')];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <section><QiMoviBrand/><span className="eyebrow">LOCAL STUDIO · CONNECTION</span><h1 id="session-recovery-title">Restore your local session</h1>
      <p>Local access needs to be renewed. Your open drafts are still in this window.</p>
      <p className="session-recovery-note">Keep this window open. Restore access, then save your work to continue.</p>
      {bridge ? <div className="session-recovery-actions"><button ref={restoreButton} className="primary" disabled={busy} onClick={() => void restore()}>{nativeBusy ? 'Restoring access…' : 'Restore access'}</button><button disabled={busy} onClick={onRetry}>Retry local connection</button></div> : <form onSubmit={onSubmit}>
        <label htmlFor="recovery-session-token">Local owner session</label>
        <input ref={input} id="recovery-session-token" type="password" value={token} autoComplete="off" onChange={event => onToken(event.target.value)} placeholder="Enter the local session token"/>
        <div className="session-recovery-actions"><button className="primary" disabled={busy || !token}>Restore workspace</button><button type="button" disabled={busy} onClick={onRetry}>Retry local connection</button></div>
      </form>}
      {busy && <p role="status">Checking the local session…</p>}
      {detail && <p role="alert" className="session-recovery-error">{detail}</p>}
      <small>Access only. Your edits stay unsaved until you save them; production approvals stay as they are.</small>
    </section>
  </main>;
}
