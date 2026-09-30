import { useEffect, useRef, useState } from 'react';
import { canonicalJson } from './canonical';
import { verifyReviewExchange, type Exchange, type Manifest } from './workbenchValidation';
import type { Project, ReviewResolution, WorkspaceApi, WorkspaceRecord } from './types';
import { downloadLocalBlob } from './localDownload';
import './writing-handoff.css';

async function request(path: string, body?: unknown) {
  const response = await fetch(path, { credentials: 'same-origin', redirect: 'error', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const value = await response.json(); if (!response.ok) throw new Error(value?.error ?? 'The local reviewer exchange was not confirmed.'); return value;
}

type Props = { project: Project; records: WorkspaceRecord[]; api: WorkspaceApi; open: boolean; onSaved: (record: WorkspaceRecord) => void; onRefresh: () => Promise<void>; onOpenWriting?: () => void; onOpenWorld?: () => void; onOpenDraft?: (record: WorkspaceRecord) => void };
export default function LocalReviewExchange(props: Props) { return <ReviewExchangeScope key={`${props.project.id}:${props.project.sourceHash}`} {...props}/>; }
function ReviewExchangeScope({ project, records, api, open, onSaved, onRefresh, onOpenWriting, onOpenWorld, onOpenDraft }: Props) {
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [comment, setComment] = useState('');
  const [target, setTarget] = useState('');
  const [changed, setChanged] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const attempts = useRef<Record<string, { fingerprint: string; requestId: string }>>({});
  const alive = useRef(true);
  const observations = records.filter(record => record.kind === 'review-observation');
  const writingDrafts = records.filter(record => record.kind === 'screenplay-draft');
  const worldEntries = records.filter(record => ['universe-entity', 'universe-claim', 'universe-link'].includes(record.kind));
  const dirty = changed || Boolean(comment.trim()) || Object.values(notes).some(value => value.length > 0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function refreshWriting() {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const boot = await api.bootstrap();
      if (boot.project.id !== project.id || boot.project.sourceHash !== project.sourceHash) throw new Error('The active film or production source changed. Reopen Collaborate before refreshing.');
      if (alive.current) {
        boot.records.forEach(record => onSaved(record));
        setNotice('Saved records refreshed from this film. Open editor and review drafts remain in place.');
      }
    } catch (caught) { if (alive.current) setError(caught instanceof Error ? caught.message : 'Saved writing could not be refreshed.'); }
    finally { if (alive.current) setBusy(false); }
  }
  async function prepare() {
    if (busy) return;
    if (changed || comment.trim()) { setError('Import or discard the edited exchange before preparing another package.'); return; }
    setBusy(true); setError('');
    try { const checked = await verifyReviewExchange(await request('/api/reviews/export'), project); if (alive.current) { setExchange(checked.exchange); setManifest(checked.manifest); setNotice('Reviewer exchange prepared from exact saved records.'); } }
    catch (caught) { if (alive.current) setError(caught instanceof Error ? caught.message : 'Review export failed.'); }
    finally { if (alive.current) setBusy(false); }
  }
  async function read(file: File) {
    if (busy) return;
    if (changed || comment.trim()) { setError('Import or discard the edited exchange before opening another file.'); return; }
    setBusy(true); setError('');
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Choose a reviewer exchange up to 2 MiB.');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      const checked = await verifyReviewExchange(JSON.parse(text), project);
      if (alive.current) { setExchange(checked.exchange); setManifest(checked.manifest); setChanged(false); setNotice('Review file verified locally. Comments have not been imported yet.'); }
    } catch (caught) { if (alive.current) setError(caught instanceof Error ? caught.message : 'Could not read reviewer exchange.'); }
    finally { if (alive.current) setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  function downloadExchange() {
    if (!exchange) return;
    try {
      downloadLocalBlob(new Blob([JSON.stringify(exchange, null, 2)], { type: 'application/json' }), 'caniscreenwrite-review-exchange.json');
      setNotice('Reviewer exchange prepared for download. Edits remain marked unsaved until imported or explicitly discarded.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Reviewer exchange download could not start.'); }
  }
  async function importComments() {
    if (!exchange || busy || !exchange.comments.comments.length || !exchange.comments.reviewerLabel.trim()) return;
    const captured = structuredClone(exchange); setBusy(true); setError('');
    try {
      const result = await request('/api/reviews/import', captured);
      if (result.approval !== 'NONE' || result.comments !== captured.comments.comments.length || !['CURRENT', 'HISTORICAL'].includes(result.basisState) || !Array.isArray(result.records)) throw new Error('Import response did not confirm this comment batch.');
      const boot = await api.bootstrap();
      if (boot.project.id !== project.id || boot.project.sourceHash !== project.sourceHash) throw new Error('Review readback came from a different workspace.');
      const confirmed: WorkspaceRecord[] = [];
      for (const item of captured.comments.comments) {
        const record = boot.records.find(record => record.id === `review-observation:${item.commentId}` && record.kind === 'review-observation');
        const data = record?.data as Record<string, unknown> | undefined;
        if (!record || !data || data.packageHash !== captured.comments.packageHash || data.reviewerLabel !== captured.comments.reviewerLabel || Object.entries(item).some(([key, value]) => data[key] !== value) || !result.records.some((receipt: { id: string; version: number }) => receipt.id === record.id && receipt.version === record.version)) throw new Error('One or more imported comments could not be verified by readback. Exact retry is available.');
        confirmed.push(record);
      }
      if (alive.current) { confirmed.forEach(onSaved); setChanged(false); setNotice(`${confirmed.length} attributed comment${confirmed.length === 1 ? '' : 's'} imported and verified. ${result.basisState === 'HISTORICAL' ? 'The reviewed package is historical.' : 'The reviewed package matches current records.'}`); await onRefresh(); }
    } catch (caught) { if (alive.current) setError(caught instanceof Error ? caught.message : 'Review import not confirmed.'); }
    finally { if (alive.current) setBusy(false); }
  }
  async function resolve(observation: WorkspaceRecord, disposition: ReviewResolution['disposition']) {
    const data = observation.data as { commentId: string; basisHash?: string };
    const note = notes[observation.id]?.trim(); if (!note || busy) return;
    const id = `review-resolution:${data.commentId}`, previous = records.find(record => record.id === id);
    const body: ReviewResolution = { sourceHash: project.sourceHash, commentId: data.commentId, disposition, note, basisHash: data.basisHash ?? observation.sha256 };
    const fingerprint = canonicalJson({ body, version: previous?.version ?? null });
    if (attempts.current[id]?.fingerprint !== fingerprint) attempts.current[id] = { fingerprint, requestId: crypto.randomUUID() };
    setBusy(true); setError('');
    try {
      const record = await api.saveRecord({ id, kind: 'review-resolution', expectedVersion: previous?.version ?? null, requestId: attempts.current[id].requestId, data: body });
      if (record.id !== id || record.kind !== 'review-resolution' || record.version !== (previous?.version ?? 0) + 1 || canonicalJson(record.data) !== canonicalJson(body)) throw new Error('Resolution response did not match the owner note.');
      if (alive.current) { onSaved(record); setNotes(current => ({ ...current, [observation.id]: '' })); setNotice('Owner resolution saved. The original reviewer observation remains unchanged.'); }
    } catch (caught) { if (alive.current) setError(caught instanceof Error ? caught.message : 'Resolution not saved.'); }
    finally { if (alive.current) setBusy(false); }
  }
  return <section hidden={!open} className="canis-reviews" data-unsaved={dirty ? 'true' : 'false'}>
    <section className="writing-handoff" aria-label="Writing and production handoff">
      <header className="writing-handoff-heading"><div><span className="writing-handoff-eyebrow">One film · connected writing</span><h2>Writing, worlds & production</h2><p>Develop the screenplay and story world with QiScreenwrite / CanIScreenwrite. Bring reviewed work into QiMovi to plan and make the film.</p></div><span className="writing-handoff-location">QiMovi · this Mac</span></header>
      <div className="writing-handoff-identity"><div><small>Current film</small><strong>{project.title}</strong><code>{project.id}</code></div><div><small>Production screenplay</small><strong>{project.productionDraftRef ? `Attached draft v${project.productionDraftRef.version}` : 'Retained source'}</strong><code aria-label="Production source SHA-256">{project.sourceHash}</code></div><div className="writing-handoff-counts"><span><b>{writingDrafts.length}</b> saved screenplay drafts</span><span><b>{worldEntries.length}</b> world records</span><small>Stored in this film; writer connection status is checked in the writer.</small></div></div>
      <div className="writing-handoff-routes">
        <article><span className="writing-handoff-step">01 · Writer → QiMovi</span><h3>Bring in saved writing</h3><p>In the local QiCanIScreenwrite app, open <strong>QiMovi / FilmStack</strong>, choose <strong>Find open QiMovi project</strong>, and confirm this film. Push a saved screenplay revision or preview a Universe transfer.</p><p className="writing-handoff-next">After transferring, refresh the saved records here.</p><button className="secondary" type="button" disabled={busy} onClick={() => void refreshWriting()}>{busy ? 'Please wait…' : 'Refresh saved writing'}</button></article>
        <article><span className="writing-handoff-step">02 · QiMovi → production</span><h3>Review, then plan the film</h3><p>Review the received draft and world entries. Writing revisions stay separate from the production screenplay until you update the production source.</p><div className="writing-handoff-actions"><button className="secondary" type="button" disabled={busy || !onOpenWriting} onClick={onOpenWriting}>Open writing</button><button className="secondary" type="button" disabled={busy || !onOpenWorld} onClick={onOpenWorld}>Review world & story bible</button></div></article>
        <article><span className="writing-handoff-step">03 · QiMovi → writer / reviewers</span><h3>Carry revisions back</h3><p>Use the local writer’s connected QiMovi panel to pull a newer screenplay revision or review returning world changes. Use the reviewer exchange below for attributed comments on exact saved revisions.</p><p className="writing-handoff-next">Transfers are explicit. An open app does not mean both copies match.</p></article>
      </div>
      <aside className="writing-handoff-hosted"><strong>QiScreenwrite / CanIScreenwrite.com · hosted writing</strong><p>The website has its own account and workspace. This local panel does not check its sign-in, publish to it, or synchronize it. Keep hosted work and this film linked through deliberate, reviewed transfers.</p></aside>
      {writingDrafts.length > 0 && <div className="writing-handoff-drafts"><h3>Saved screenplays in this film</h3><ul>{writingDrafts.map(record => <li key={record.id}><button type="button" disabled={busy || !onOpenDraft} onClick={() => onOpenDraft?.(record)}><span>{String((record.data as { title?: string }).title || 'Untitled screenplay')}</span><small>Saved v{record.version}</small></button></li>)}</ul></div>}
    </section>
    <div className="writing-review-heading"><h2>Reviewer exchange</h2><p>Share a private review package and keep comments tied to exact revisions. This file carries review comments; it does not replace a screenplay.</p></div><div className="canis-next"><button className="primary" disabled={busy} onClick={() => void prepare()}>Prepare reviewer exchange</button><button className="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>Open reviewer exchange file</button><input className="screenwriting-file" ref={fileInput} type="file" accept=".json,application/json" aria-label="Reviewer exchange file" onChange={event => { const file = event.target.files?.[0]; if (file) void read(file); }}/></div>{error && <p role="alert" className="error-bar">{error}</p>}{notice && <p role="status" className="canis-notice">{notice}</p>}{exchange && <div className="canis-exchange-editor"><p>{manifest?.records.length} saved records · exact source reading text included</p><p className="scope-note">Image hashes are included. Media bytes stay in owned storage; use the full local package exporter when reviewers need image files. Returned names label observations, not verified identities.</p><fieldset className="canis-form" disabled={busy}><label>Reviewer label<input aria-label="Reviewer label" maxLength={160} value={exchange.comments.reviewerLabel} onChange={event => { setExchange({ ...exchange, comments: { ...exchange.comments, reviewerLabel: event.target.value } }); setChanged(true); }}/></label><label>Comment target<select aria-label="Review comment target" value={target} onChange={event => setTarget(event.target.value)}><option value="">Whole package</option>{manifest?.records.filter(record => ['screenplay-draft', 'story-plan-draft', 'pitch-draft', 'concept-draft', 'generation-brief'].includes(record.kind)).map(record => <option key={record.id} value={record.id}>{String((record.data as { title?: string }).title ?? record.id)} · v{record.version}</option>)}</select></label><label>Review comment<textarea aria-label="Review comment" rows={4} maxLength={10000} value={comment} onChange={event => setComment(event.target.value)}/></label><button type="button" className="secondary" disabled={!comment.trim()} onClick={() => { const record = manifest?.records.find(record => record.id === target); setExchange({ ...exchange, comments: { ...exchange.comments, comments: [...exchange.comments.comments, { commentId: crypto.randomUUID(), note: comment, observedAt: new Date().toISOString(), ...(record ? { targetRecordId: record.id, targetRecordHash: record.sha256 } : {}) }] } }); setComment(''); setChanged(true); }}>Add comment to exchange</button></fieldset><ol className="canis-review-comment-list">{exchange.comments.comments.map(item => <li key={item.commentId}>{item.note}</li>)}</ol><div className="canis-next"><button className="secondary" disabled={busy} onClick={downloadExchange}>Download reviewer exchange</button><button className="secondary" disabled={busy || (!changed && !comment.trim())} onClick={() => { setExchange(null); setManifest(null); setChanged(false); setComment(''); setTarget(''); setNotice('Exchange edits discarded. Imported observations remain saved.'); }}>Discard exchange edits</button><button className="primary" disabled={busy || !exchange.comments.comments.length || !exchange.comments.reviewerLabel.trim()} onClick={() => void importComments()}>Import reviewer comments</button></div></div>}<h2 className="canis-review-heading">Imported observations</h2>{!observations.length && <p className="canis-empty">No reviewer comments imported yet.</p>}{observations.map(observation => { const data = observation.data as { commentId: string; reviewerLabel: string; note: string; targetRecordId?: string }; const resolution = records.find(record => record.id === `review-resolution:${data.commentId}`)?.data as ReviewResolution | undefined; return <article className="canis-review-observation" key={observation.id}><small>{data.reviewerLabel} · attributed observation</small><p>{data.note}</p>{resolution && <p className="scope-note">Owner resolution: {resolution.disposition.toLowerCase().replace(/_/g, ' ')} — {resolution.note}</p>}<label>Owner resolution note<textarea aria-label={`Resolution for ${data.commentId}`} rows={2} disabled={busy} value={notes[observation.id] ?? ''} onChange={event => setNotes(previous => ({ ...previous, [observation.id]: event.target.value }))}/></label><div className="canis-next">{(['ACKNOWLEDGED', 'ACTION_PLANNED', 'DECLINED_WITH_REASON'] as const).map(disposition => <button key={disposition} disabled={busy || !notes[observation.id]?.trim()} onClick={() => void resolve(observation, disposition)}>{disposition === 'ACKNOWLEDGED' ? 'Acknowledge' : disposition === 'ACTION_PLANNED' ? 'Plan action' : 'Decline with reason'}</button>)}</div></article>})}</section>;
}
