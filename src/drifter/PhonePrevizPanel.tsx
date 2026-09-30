import { useEffect, useRef, useState } from 'react';
import type { Project, Scene } from './types';
import { canonicalPhonePreviz } from '../../local/contracts/phone-previz.mjs';
import './phone-previz.css';

type Summary = { kind: 'ROTATION' | 'CLAPPER'; artifactId: string; label: string; recordedAt: string; durationSeconds?: number; sampleCount?: number; clapperCount?: number; takeNumber?: number; roll?: string; camera?: string; soundMode?: string; slatePosition?: string; purpose?: string; frameRate?: { numerator: number; denominator: number }; notes?: string; recordingId?: string | null; recordingTimeSeconds?: number | null };
type Binding = { projectId: string; sourceHash: string; sceneId: string; shotId: string; shotSourceHash: string };
type Preview = Binding & { schemaVersion: 'qimovi-phone-previz-preview/v1'; artifactSha256: string; status: 'READY' | 'MISMATCH'; reason: string; summary: Summary; warnings: string[]; previewSha256: string };
type Receipt = Binding & { schemaVersion: 'qimovi-phone-previz-receipt/v1'; id: string; sha256: string; artifactSha256: string; summary: Summary; retainedAt: string; approvalGranted: false; desktopPlaybackReady: false; finalMedia: false };
const limit = 2 * 1024 * 1024;
async function hashCanonical(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalPhonePreviz(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const messages: Record<string, string> = {
  PHONE_PREVIZ_BINDING_MISMATCH: 'This file does not match the selected shot. Switch to its film and shot, then preview it again.',
  PHONE_PREVIZ_PREVIEW_STALE: 'The shot changed after this preview. Choose the file again to review its current match.',
  PHONE_PREVIZ_SHOT_UNAVAILABLE: 'Choose a shot from the attached production screenplay first.',
  PHONE_PREVIZ_QUATERNION_INVALID: 'The movement contains invalid orientation samples. The file was not retained.',
  PHONE_PREVIZ_SAMPLE_ORDER_INVALID: 'The movement timestamps are out of order. The file was not retained.',
  PHONE_PREVIZ_STORAGE_LIMIT: 'The phone rehearsal archive needs attention before more files can be retained.',
};
async function request(url: string, body: unknown, signal: AbortSignal) {
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'error', signal,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(messages[value?.error] ?? value?.error ?? 'The local workspace could not confirm this operation.');
  if (!value || typeof value !== 'object') throw new Error('The local workspace returned an unreadable phone reference.');
  return value;
}
function Describe({ value }: { value: Summary }) {
  return value.kind === 'ROTATION' ? <p>{Number(value.durationSeconds).toFixed(2)} seconds · {value.sampleCount} orientation samples · {value.clapperCount ?? 0} slate marks</p>
    : <><p>Take {value.takeNumber} · {value.soundMode} · {value.slatePosition === 'HEAD' ? 'Head slate' : 'Tail slate'} · {value.purpose === 'PREVIZ' ? 'Previsualization' : 'Production'}</p>
      <p>Roll {value.roll || '—'} · Camera {value.camera || '—'} · {value.frameRate?.numerator}/{value.frameRate?.denominator} fps</p>
      {value.notes && <p className="phone-previz-notes">{value.notes}</p>}
      {value.recordingId && <p>Phone rehearsal mark at {value.recordingTimeSeconds?.toFixed(2)} seconds. Linked file must be retained separately.</p>}</>;
}

/** A phone orientation file is a source-bound planning reference, not a DCC camera or accepted take. */
export default function PhonePrevizPanel({ project, scene, selectedShotId, open, disabled = false }: {
  project: Project; scene: Scene; selectedShotId: string; open: boolean; disabled?: boolean;
}) {
  const [receipts, setReceipts] = useState<Receipt[]>([]), [preview, setPreview] = useState<Preview | null>(null), [artifact, setArtifact] = useState<unknown>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const epoch = useRef(0), operation = useRef<AbortController | null>(null), input = useRef<HTMLInputElement>(null);
  const scope = `${project.id}:${project.sourceHash}:${scene.id}:${selectedShotId}:${open}:${disabled}`;
  const currentScope = useRef(scope); currentScope.current = scope;
  const enabled = open && !disabled && digest(project.sourceHash) && scene.shots.some(shot => shot.id === selectedShotId);
  function matches(value: Binding) {
    return value?.projectId === project.id && value.sourceHash === project.sourceHash && value.sceneId === scene.id && value.shotId === selectedShotId && digest(value.shotSourceHash);
  }
  async function verifyReceipt(value: Receipt) {
    const { sha256, ...body } = value;
    if (value.schemaVersion !== 'qimovi-phone-previz-receipt/v1' || !matches(value) || value.approvalGranted !== false || value.desktopPlaybackReady !== false || value.finalMedia !== false || !digest(value.id) || !digest(value.artifactSha256) || await hashCanonical(body) !== sha256) throw new Error('The retained phone reference could not be verified.');
    return value;
  }
  async function load(signal: AbortSignal) {
    const result = await request(`/api/phone-previz?sceneId=${encodeURIComponent(scene.id)}&shotId=${encodeURIComponent(selectedShotId)}`, undefined, signal);
    if (result.schemaVersion !== 'qimovi-phone-previz-list/v1' || !matches(result) || !Array.isArray(result.receipts) || result.receipts.length > 200) throw new Error('The phone archive returned a different shot.');
    return Promise.all(result.receipts.map(verifyReceipt));
  }
  useEffect(() => {
    const generation = ++epoch.current, controller = new AbortController(); operation.current?.abort(); operation.current = controller;
    setPreview(null); setArtifact(null); setReceipts([]); setError(''); setNotice(''); setBusy(false); setLoading(enabled);
    if (input.current) input.current.value = '';
    if (enabled) void load(controller.signal).then(values => { if (generation === epoch.current && scope === currentScope.current) setReceipts(values); })
      .catch(reason => { if (!controller.signal.aborted && generation === epoch.current && scope === currentScope.current) setError(reason.message); })
      .finally(() => { if (generation === epoch.current && scope === currentScope.current) setLoading(false); });
    return () => { controller.abort(); ++epoch.current; };
  // The serialized scope explicitly covers every identity and visibility dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  async function choose(file?: File) {
    if (!file || !enabled || busy) return;
    operation.current?.abort(); const controller = new AbortController(); operation.current = controller; const generation = ++epoch.current, capturedScope = scope;
    const active = () => generation === epoch.current && capturedScope === currentScope.current && !controller.signal.aborted;
    setPreview(null); setArtifact(null); setError(''); setNotice(''); setBusy(true); setLoading(false);
    try {
      if (!file.size || file.size > limit) throw new Error('Choose a QiMovi phone movement or clapper JSON file, up to 2 MB.');
      const value = JSON.parse(await file.text()); if (!active()) return;
      const result = await request('/api/phone-previz/preview', { sceneId: scene.id, shotId: selectedShotId, artifact: value }, controller.signal) as Preview;
      const { previewSha256, ...body } = result;
      if (result.schemaVersion !== 'qimovi-phone-previz-preview/v1' || !matches(result) || !['READY', 'MISMATCH'].includes(result.status) || !Array.isArray(result.warnings) || result.artifactSha256 !== await hashCanonical(value) || previewSha256 !== await hashCanonical(body)) throw new Error('The preview could not be verified for this file and shot.');
      if (active()) { setArtifact(value); setPreview(result); }
    } catch (reason) { if (active()) setError(reason instanceof SyntaxError ? 'This file is not valid JSON. Export the movement or clapper from QiMovi on iPhone.' : (reason as Error).message); }
    finally { if (active()) setBusy(false); }
  }
  async function retain() {
    if (!enabled || busy || !preview || preview.status !== 'READY' || !artifact) return;
    operation.current?.abort(); const controller = new AbortController(); operation.current = controller; const generation = ++epoch.current, capturedScope = scope;
    const active = () => generation === epoch.current && capturedScope === currentScope.current && !controller.signal.aborted;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request('/api/phone-previz/retain', { sceneId: scene.id, shotId: selectedShotId, artifact, previewSha256: preview.previewSha256 }, controller.signal);
      const receipt = await verifyReceipt(result.receipt);
      if (result.status !== 'RETAINED' || receipt.artifactSha256 !== preview.artifactSha256 || receipt.shotSourceHash !== preview.shotSourceHash) throw new Error('Retention could not be confirmed for this exact phone file. Refresh the archive before retrying.');
      if (active()) { setReceipts(previous => [receipt, ...previous.filter(item => item.id !== receipt.id)]); setPreview(null); setArtifact(null); setNotice(result.replayed ? 'This exact file is already retained for this shot.' : 'Phone reference retained for this shot.'); if (input.current) input.current.value = ''; }
    } catch (reason) { if (active()) setError((reason as Error).message); }
    finally { if (active()) setBusy(false); }
  }
  return <section className="phone-previz" aria-label="Phone rehearsal and clapper returns">
    <div className="phone-previz-heading"><div><h3>Phone rehearsals & clapper</h3><p>Bring an iPhone camera movement or slate mark back to this shot.</p></div>
      <label className={`phone-previz-import ${!enabled || busy ? 'is-disabled' : ''}`}>Preview phone file<input ref={input} type="file" accept="application/json,.json" disabled={!enabled || busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void choose(file); }} /></label></div>
    <p className="phone-previz-context">Selected shot: {scene.shots.find(shot => shot.id === selectedShotId)?.label ?? 'Choose a shot'}. Phone rotation is an orientation reference; retained files do not move a Blender or Unity camera.</p>
    {!enabled && <p>Select an available shot to review its phone returns.</p>}
    {error && <p role="alert" className="phone-previz-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {busy && <p role="status">{preview ? 'Retaining reviewed reference…' : 'Checking phone file…'}</p>}
    {preview && <div className="phone-previz-review"><strong>{preview.summary.kind === 'ROTATION' ? 'Movement rehearsal' : 'Clapper mark'} · {preview.summary.label}</strong>
      <Describe value={preview.summary} /><p className={preview.status === 'MISMATCH' ? 'phone-previz-error' : ''}>{preview.reason}</p>
      <ul>{preview.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
      <button type="button" disabled={!enabled || busy || preview.status !== 'READY'} onClick={() => void retain()}>Retain reviewed reference</button></div>}
    <h4>Retained for this shot</h4>
    {loading ? <p role="status">Loading retained references…</p> : receipts.length ? <ul className="phone-previz-receipts">{receipts.map(receipt => <li key={receipt.id}><strong>{receipt.summary.kind === 'ROTATION' ? 'Movement rehearsal' : `Clapper · Take ${receipt.summary.takeNumber}`}</strong><Describe value={receipt.summary} /><small>Recorded {new Date(receipt.summary.recordedAt).toLocaleString()} · Retained planning reference</small></li>)}</ul> : <p>No retained phone references for the current shot revision.</p>}
  </section>;
}
