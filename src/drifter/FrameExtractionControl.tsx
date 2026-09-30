import { useEffect, useRef, useState } from 'react';
import { canonicalJson } from './canonical';
import { storyboardFrameApi, type FrameExtractionResult } from './storyboardFrameApi';
import type { Project, StoryCell, WorkspaceRecord } from './types';
import './frame-extraction.css';

/** One local extraction action shared by the frame editor and clip inspector. */
export default function FrameExtractionControl({ project, cell, record, disabled = false, onExtracted, onBusy }: {
  project: Project; cell: StoryCell; record?: WorkspaceRecord; disabled?: boolean;
  onExtracted: (result: FrameExtractionResult) => void | Promise<void>;
  onBusy?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const inFlight = useRef(false), alive = useRef(true);
  const basis = canonicalJson({ projectId: project.id, sourceHash: project.sourceHash, cell, record: record ? { id: record.id, version: record.version, sha256: record.sha256 } : null });
  const currentBasis = useRef(basis); currentBasis.current = basis;
  const attempt = useRef<{ basis: string; requestId: string }>();
  const busyCallback = useRef(onBusy); busyCallback.current = onBusy;
  useEffect(() => { alive.current = true; return () => { alive.current = false; busyCallback.current?.(false); }; }, []);
  useEffect(() => { setError(''); }, [basis]);
  if (!cell.imageHash || !cell.crop) return null;
  const protectedOrigin = Boolean(cell.originCameraRef || cell.originDccReturnRef);
  async function extract() {
    if (disabled || inFlight.current || protectedOrigin) return;
    const captured = basis;
    if (attempt.current?.basis !== captured) attempt.current = { basis: captured, requestId: crypto.randomUUID() };
    inFlight.current = true; setBusy(true); setError(''); busyCallback.current?.(true);
    try {
      const result = await storyboardFrameApi.extract(project, cell, record, attempt.current.requestId);
      if (!alive.current || currentBasis.current !== captured) return;
      await onExtracted(result);
    } catch (failure) {
      if (alive.current && currentBasis.current === captured) setError(failure instanceof Error ? failure.message : 'Extraction was not confirmed. Retry this same frame or refresh saved inputs.');
    } finally {
      inFlight.current = false;
      if (alive.current) { setBusy(false); busyCallback.current?.(false); }
    }
  }
  return <div className="frame-extraction" aria-label="Extract storyboard frame">
    <div><strong>Individual frame needed</strong><span>{cell.crop.width} × {cell.crop.height} px from the saved sheet</span></div>
    <button type="button" className="secondary" disabled={disabled || busy || protectedOrigin} onClick={() => void extract()}>{busy ? 'Extracting frame…' : error ? 'Retry frame extraction' : 'Extract frame'}</button>
    <p>{protectedOrigin ? 'This image is bound to a camera return. Prepare a separate source frame in the camera workflow.' : 'Saves this panel as a separate image and updates this candidate. The original and its history stay in your library.'}</p>
    {error && <p className="error-text" role="alert">{error}</p>}
  </div>;
}
