import { useEffect, useRef, useState } from 'react';
import { canonicalJson } from './canonical';
import { mediaTakeApi } from './mediaTakeApi';
import { MAX_MEDIA_TAKE_BYTES, type MediaTakeApi, type MediaTakeCatalog, type TakeDecision, type TakeReviewRecord } from './mediaTakeTypes';
import type { GenerationBrief, Project, Scene, WorkspaceRecord } from './types';
import type { NodeRecordRequest } from './nodeWorkflowModel';
import { verifyNodeRequestedRecord } from './nodeRecordRequests';
import './media-takes.css';

type PendingImport = { file: File; shotId: string; briefKey: string; requestId: string };
type NoteEdit = { note: string; baseline: TakeReviewRecord | null };
export type MediaTakeShotRequest = { nonce: string; projectId: string; sourceHash: string; sceneId: string; shotId: string };
const message = (error: unknown) => error instanceof Error ? error.message : 'The local workspace did not confirm this action.';
const briefKey = (record: WorkspaceRecord) => `${record.id}@${record.sha256}`;
const seconds = (ms: number) => `${(ms / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })} s`;
const fps = (rate: string) => { const [numerator, denominator] = rate.split('/').map(Number); return (numerator / denominator).toLocaleString(undefined, { maximumFractionDigits: 3 }); };
const size = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
const sameReview = (left: TakeReviewRecord | null, right: TakeReviewRecord | null) => left === null || right === null ? left === right : left.id === right.id && left.sha256 === right.sha256 && left.version === right.version;
function visibleFocusTarget(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected || element === document.body || element.matches(':disabled') || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = window.getComputedStyle(ancestor);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}
const decisionLabel = (decision?: TakeDecision) => decision === 'KEEP_CANDIDATE' ? 'Kept candidate' : decision === 'REJECT' ? 'Set aside' : 'Awaiting review';

export default function MediaTakesPanel({ project, scene, records, open, onClose, onSaved, onDirty, mediaApi = mediaTakeApi, recordRequest, shotRequest }: {
  project: Project; scene: Scene; records: WorkspaceRecord[]; open: boolean;
  onClose(): void; onSaved(record: WorkspaceRecord): void; onDirty?(dirty: boolean): void; mediaApi?: MediaTakeApi; recordRequest?: NodeRecordRequest; shotRequest?: MediaTakeShotRequest;
}) {
  const scope = `${project.id}:${project.sourceHash}:${scene.id}`;
  const [catalogs, setCatalogs] = useState<Record<string, MediaTakeCatalog>>({});
  const [pending, setPending] = useState<Record<string, PendingImport>>({});
  const [notes, setNotes] = useState<Record<string, NoteEdit>>({});
  const [selectedIds, setSelectedIds] = useState<Record<string, string>>({});
  const [importContexts, setImportContexts] = useState<Record<string, { briefKey: string; shotId: string }>>({});
  const [requestedImport, setRequestedImport] = useState<NodeRecordRequest | null>(null);
  const handledRecordRequest = useRef<string>();
  const handledShotRequest = useRef<string>();
  const [requestedShotImport, setRequestedShotImport] = useState<{ key: string; request: MediaTakeShotRequest } | null>(null);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [busy, setBusy] = useState<'import' | 'review' | 'request' | null>(null);
  const [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [preview, setPreview] = useState<{ key: string; url: string } | null>(null), [previewError, setPreviewError] = useState('');
  const [previewRetry, setPreviewRetry] = useState(0);
  const alive = useRef(true), currentScope = useRef(scope), drawer = useRef<HTMLDivElement>(null);
  const currentOpen = useRef(open), currentRequest = useRef(recordRequest), requestSequence = useRef(0);
  currentOpen.current = open; currentRequest.current = recordRequest;
  const refreshController = useRef<AbortController>(), importController = useRef<AbortController>();
  const refreshSequence = useRef(0), reviewAttempts = useRef<Record<string, { fingerprint: string; requestId: string }>>({});
  currentScope.current = scope;
  const catalog = catalogs[scope], draft = pending[scope];
  const shotRequestKey = shotRequest ? JSON.stringify([scope, shotRequest.nonce, shotRequest.projectId, shotRequest.sourceHash, shotRequest.sceneId, shotRequest.shotId]) : '';
  const currentShotRequestKey = useRef(shotRequestKey); currentShotRequestKey.current = shotRequestKey;
  const invalidShotRequest = Boolean(shotRequest && (typeof shotRequest.nonce !== 'string' || !shotRequest.nonce.trim() || shotRequest.projectId !== project.id || shotRequest.sourceHash !== project.sourceHash || shotRequest.sceneId !== scene.id || !scene.shots.some(shot => shot.id === shotRequest.shotId)));
  const pendingShotRequest = Boolean(shotRequest && handledShotRequest.current !== shotRequestKey);
  const requestedTake = !invalidShotRequest && shotRequest ? catalog?.takes.find(item => item.record.data.sourceHash === project.sourceHash && item.record.data.sceneId === scene.id && item.record.data.shotId === shotRequest.shotId) : undefined;
  const shotImportConflict = Boolean(requestedShotImport && requestedShotImport.key === shotRequestKey && draft && draft.shotId !== requestedShotImport.request.shotId);
  const importRequestBlocked = invalidShotRequest || pendingShotRequest || shotImportConflict;
  const maxUploadBytes = catalog?.maxUploadBytes ?? MAX_MEDIA_TAKE_BYTES;
  const selected = invalidShotRequest ? undefined : pendingShotRequest ? requestedTake : selectedIds[scope] === '' ? undefined : catalog?.takes.find(item => item.record.id === selectedIds[scope]) ?? (shotRequest ? undefined : catalog?.takes[0]);
  const selectedKey = selected?.record.sha256;
  const noteEdit = selectedKey ? notes[selectedKey] : undefined;
  const note = noteEdit?.note ?? selected?.review?.data.note ?? '';
  const dirty = Object.keys(pending).length > 0 || Object.keys(notes).length > 0;
  const briefs = records.filter(record => record.kind === 'generation-brief' && (record.data as GenerationBrief).sourceHash === project.sourceHash && (record.data as GenerationBrief).sceneId === scene.id);
  const chosenBrief = briefs.find(record => briefKey(record) === draft?.briefKey);
  const invalidBrief = Boolean(draft?.briefKey && !chosenBrief);
  const briefShotMismatch = Boolean(chosenBrief && draft?.shotId && !(chosenBrief.data as GenerationBrief).shotIds.includes(draft.shotId));
  const noteConflict = Boolean(noteEdit && !sameReview(noteEdit.baseline, selected?.review ?? null));
  const recordsKey = records.filter(record => ['generation-brief', 'measured-media-take', 'take-review'].includes(record.kind)).map(record => `${record.id}:${record.version}:${record.sha256}`).join('|');

  useEffect(() => { alive.current = true; return () => { alive.current = false; refreshController.current?.abort(); importController.current?.abort(); }; }, []);
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (!open) { refreshController.current?.abort(); refreshSequence.current++; return; }
    void refresh();
    // Only persisted identities reopen the catalog; unsaved form edits never trigger a fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope, recordsKey, mediaApi]);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    drawer.current?.focus();
    return () => {
      const target = visibleFocusTarget(previousFocus) ? previousFocus : Array.from(document.querySelectorAll<HTMLButtonElement>('nav[aria-label="Film preparation tools"] button')).find(button => button.textContent?.trim() === 'Takes' && visibleFocusTarget(button));
      target?.focus();
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(drawer.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, video[controls]') ?? []).filter(element => !element.closest('[hidden]'));
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); drawer.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === drawer.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === drawer.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keys); return () => document.removeEventListener('keydown', keys);
  }, [open, busy, onClose]);
  useEffect(() => {
    setPreview(null); setPreviewError('');
    if (!open || !selected) return;
    const controller = new AbortController(); let url: string | undefined;
    const captured = selected;
    void mediaApi.preview(captured, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob); setPreview({ key: captured.record.sha256, url });
    }).catch(caught => { if (!controller.signal.aborted) setPreviewError(message(caught)); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
    // A note change cannot replace the immutable preview bytes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope, selectedKey, mediaApi, previewRetry]);

  async function refresh() {
    refreshController.current?.abort(); const controller = new AbortController(); refreshController.current = controller;
    const sequence = ++refreshSequence.current, captured = scope;
    setLoadState('loading'); setError('');
    try {
      const saved = await mediaApi.list(project, scene, controller.signal);
      if (!alive.current || controller.signal.aborted || refreshSequence.current !== sequence || currentScope.current !== captured) return;
      setCatalogs(previous => ({ ...previous, [captured]: saved })); setLoadState('ready');
    } catch (caught) {
      if (!alive.current || controller.signal.aborted || refreshSequence.current !== sequence || currentScope.current !== captured) return;
      setLoadState('error'); setError(`${message(caught)} Your pending clip and note edits are retained.`);
    }
  }
  async function applyNodeRequest(request: NodeRecordRequest, replaceAssociation = false) {
    if (importRequestBlocked) return;
    const captured = scope, capturedShotRequest = shotRequestKey, sequence = ++requestSequence.current;
    const current = () => alive.current && currentScope.current === captured && currentOpen.current && currentRequest.current?.nonce === request.nonce && currentShotRequestKey.current === capturedShotRequest && requestSequence.current === sequence;
    setBusy('request');
    try {
      if (request.intent === 'IMPORT_RETURN') {
        const brief = records.find(item => item.id === request.recordRef.id && item.sha256 === request.recordRef.sha256);
        await verifyNodeRequestedRecord(request, project, scene, brief, 'IMPORT_RETURN', 'generation-brief');
        if (!current()) return;
        const key = briefKey(brief!), shots = (brief!.data as GenerationBrief).shotIds;
        if (shotRequest && !shots.includes(shotRequest.shotId)) throw new Error('The requested saved brief does not include the requested storyboard shot. Your pending file is retained.');
        if (draft && draft.briefKey !== key && !replaceAssociation) { setRequestedImport(request); return; }
        const association = { briefKey: key, shotId: draft?.shotId && shots.includes(draft.shotId) ? draft.shotId : shotRequest?.shotId ?? (shots.length === 1 ? shots[0] : '') };
        setImportContexts(previous => ({ ...previous, [captured]: association }));
        if (draft) setPending(previous => ({ ...previous, [captured]: { ...previous[captured], ...association, requestId: crypto.randomUUID() } }));
        setRequestedImport(null); setNotice(`Return linked to ${(brief!.data as GenerationBrief).title} · v${brief!.version}. Choose the matching MP4; provider origin remains unverified.`);
      } else {
        const take = catalog?.takes.find(item => item.record.id === request.recordRef.id && item.record.sha256 === request.recordRef.sha256);
        await verifyNodeRequestedRecord(request, project, scene, take?.record, 'OPEN_RECORD', 'measured-media-take');
        if (!current()) return;
        if (shotRequest && take!.record.data.shotId !== shotRequest.shotId) throw new Error('The requested saved take does not belong to the requested storyboard shot.');
        setSelectedIds(previous => ({ ...previous, [captured]: take!.record.id }));
        setNotice(`Opened exact saved take: ${take!.record.data.originalFilename}. Existing pending files and note edits are retained.`);
      }
      setError('');
    } catch (caught) { if (current()) { setError(message(caught)); setRequestedImport(null); } }
    finally { if (alive.current && requestSequence.current === sequence) setBusy(null); }
  }
  useEffect(() => {
    if (!open || busy || loadState !== 'ready' || !catalog || !shotRequest || invalidShotRequest || !pendingShotRequest) return;
    handledShotRequest.current = shotRequestKey;
    setSelectedIds(previous => ({ ...previous, [scope]: requestedTake?.record.id ?? '' }));
    const context = importContexts[scope], contextBrief = briefs.find(record => briefKey(record) === context?.briefKey);
    setImportContexts(previous => ({ ...previous, [scope]: { shotId: shotRequest.shotId, briefKey: contextBrief && (contextBrief.data as GenerationBrief).shotIds.includes(shotRequest.shotId) ? briefKey(contextBrief) : '' } }));
    setRequestedShotImport(draft && draft.shotId !== shotRequest.shotId ? { key: shotRequestKey, request: shotRequest } : null);
    setRequestedImport(null); setError('');
    const label = scene.shots.find(shot => shot.id === shotRequest.shotId)!.label;
    setNotice(`${requestedTake ? `Opened retained take for shot ${label}.` : `No retained take for shot ${label}.`} New imports are prepared for this shot. Pending files and review notes are retained.`);
    // Navigation is applied once; typing and catalog refresh must not overwrite a later manual selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope, loadState, busy, catalog, shotRequestKey, invalidShotRequest, pendingShotRequest]);
  useEffect(() => {
    if (!open || busy || importRequestBlocked || loadState !== 'ready' || !recordRequest || handledRecordRequest.current === recordRequest.nonce) return;
    handledRecordRequest.current = recordRequest.nonce;
    void applyNodeRequest(recordRequest);
    // Exact requests run once after catalog refresh; editing cannot replay them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope, loadState, busy, recordRequest, importRequestBlocked]);
  function replacePendingShot() {
    if (busy || invalidShotRequest || pendingShotRequest || !requestedShotImport || requestedShotImport.key !== shotRequestKey) return;
    const shotId = requestedShotImport.request.shotId;
    setPending(previous => previous[scope] ? { ...previous, [scope]: { ...previous[scope], shotId, requestId: crypto.randomUUID() } } : previous);
    setRequestedShotImport(null); setError('');
    setNotice('Pending file associated with the requested shot. Its saved brief and review notes are retained; any brief mismatch must be resolved before import.');
  }
  function patchDraft(patch: Partial<PendingImport>) {
    if (busy || importRequestBlocked) return;
    setPending(previous => previous[scope] ? { ...previous, [scope]: { ...previous[scope], ...patch, requestId: crypto.randomUUID() } } : previous);
    setError(''); setNotice('');
  }
  function chooseFile(file?: File) {
    if (!file || busy || importRequestBlocked) return;
    if (!/\.mp4$/i.test(file.name) || !file.size || file.size > maxUploadBytes) {
      setError(`Choose a nonempty MP4 no larger than ${size(maxUploadBytes)}. Any previously selected clip is retained.`); return;
    }
    setPending(previous => ({ ...previous, [scope]: { file, shotId: previous[scope]?.shotId ?? importContexts[scope]?.shotId ?? '', briefKey: previous[scope]?.briefKey ?? importContexts[scope]?.briefKey ?? '', requestId: crypto.randomUUID() } }));
    setNotice(''); setError('');
  }
  async function importFile() {
    if (!draft || busy || importRequestBlocked || loadState !== 'ready' || invalidBrief || briefShotMismatch) return;
    const captured = scope, attempt = draft;
    const controller = new AbortController(); importController.current = controller;
    setBusy('import'); setError(''); setNotice('');
    try {
      const saved = await mediaApi.importFile(project, scene, attempt.file, { requestId: attempt.requestId, sourceHash: project.sourceHash, sceneId: scene.id, shotId: attempt.shotId || null, briefRef: chosenBrief ? { id: chosenBrief.id, sha256: chosenBrief.sha256 } : null, originalFilename: attempt.file.name }, controller.signal);
      if (!alive.current) return;
      onSaved(saved.record); if (saved.review) onSaved(saved.review);
      setCatalogs(previous => ({ ...previous, [captured]: { ...(previous[captured] ?? { schemaVersion: 'filmstack-media-takes/v1', sourceHash: project.sourceHash, sceneId: scene.id, maxUploadBytes: MAX_MEDIA_TAKE_BYTES, legacyTakes: [] }), takes: [saved, ...(previous[captured]?.takes ?? []).filter(item => item.record.id !== saved.record.id)] } }));
      setSelectedIds(previous => ({ ...previous, [captured]: saved.record.id }));
      setPending(previous => { if (previous[captured]?.requestId !== attempt.requestId) return previous; const next = { ...previous }; delete next[captured]; return next; });
      if (currentScope.current === captured) setNotice('Clip imported and measured. Play it, add a note, then choose whether to keep it as a candidate.');
    } catch (caught) {
      if (alive.current && currentScope.current === captured) setError(`${message(caught)} Your selected file is retained. Retry uses the same attempt and safely checks whether the clip was already saved.`);
    } finally { if (alive.current) setBusy(null); }
  }
  function updateNote(value: string) {
    if (!selected || busy) return;
    const key = selected.record.sha256;
    setNotes(previous => {
      const baseline = previous[key] ? previous[key].baseline : selected.review;
      if (value === (baseline?.data.note ?? '') && sameReview(baseline, selected.review)) { const next = { ...previous }; delete next[key]; return next; }
      return { ...previous, [key]: { note: value, baseline } };
    });
    setNotice(''); setError('');
  }
  async function saveReview(decision: TakeDecision, saveNotes: boolean) {
    if (!selected || busy || loadState !== 'ready' || noteConflict || (!saveNotes && noteEdit)) return;
    const captured = scope, take = selected, edit = noteEdit;
    const baseline = saveNotes && edit ? edit.baseline : take.review;
    const payload = { expectedVersion: baseline?.version ?? null, takeSha256: take.record.sha256, decision, note: saveNotes ? note : take.review?.data.note ?? '' };
    const fingerprint = canonicalJson(payload), key = `${take.record.sha256}:${saveNotes ? 'note' : 'decision'}`;
    if (reviewAttempts.current[key]?.fingerprint !== fingerprint) reviewAttempts.current[key] = { fingerprint, requestId: crypto.randomUUID() };
    setBusy('review'); setError(''); setNotice('');
    try {
      const saved = await mediaApi.review(project, take, { ...payload, requestId: reviewAttempts.current[key].requestId });
      if (!alive.current) return;
      onSaved(saved);
      setCatalogs(previous => previous[captured] ? { ...previous, [captured]: { ...previous[captured], takes: previous[captured].takes.map(item => item.record.id === take.record.id ? { ...item, review: saved } : item) } } : previous);
      if (saveNotes) setNotes(previous => { const next = { ...previous }; delete next[take.record.sha256]; return next; });
      if (currentScope.current === captured) setNotice(saveNotes ? 'Review note saved.' : decision === 'KEEP_CANDIDATE' ? 'Candidate kept for review. Choose its take and range in the movie timeline to use it in a cut.' : decision === 'REJECT' ? 'Take set aside. The imported clip is retained.' : 'Candidate preference cleared. The imported clip remains available.');
    } catch (caught) {
      if (alive.current && currentScope.current === captured) setError(`${message(caught)} Your edits are retained. Refresh saved takes to inspect any newer review.`);
    } finally { if (alive.current) setBusy(null); }
  }

  const currentPreview = preview && preview.key === selectedKey ? preview.url : undefined;
  const selectedData = selected?.record.data;
  const selectedShot = scene.shots.find(shot => shot.id === selectedData?.shotId);
  const linkedBrief = briefs.find(record => record.id === selectedData?.briefRef?.id && record.sha256 === selectedData.briefRef.sha256);
  const plannedDuration = linkedBrief ? (linkedBrief.data as GenerationBrief).settings.durationMs : selectedShot?.plannedDurationMs;
  return <div className="takes-overlay" hidden={!open} data-unsaved={dirty ? 'true' : 'false'}>
    <div className="takes-panel" ref={drawer} role="dialog" aria-modal="true" aria-labelledby="takes-title" tabIndex={-1}>
      <header className="takes-header"><div><span className="eyebrow">SCENE {String(scene.index).padStart(2, '0')} / {project.title}</span><h2 id="takes-title">Takes</h2><p>{scene.heading}</p></div><div><button className="secondary" disabled={Boolean(busy) || loadState === 'loading'} onClick={() => void refresh()}>Refresh saved takes</button><button className="takes-close" aria-label="Close Takes" disabled={Boolean(busy)} onClick={onClose}>×</button></div></header>
      {error && <p className="error-bar" role="alert">{error}</p>}{notice && <p className="takes-notice" role="status">{notice}</p>}
      {invalidShotRequest && <p className="takes-warning" role="alert">The requested storyboard shot is unavailable or belongs to another project, source or scene. Open a current storyboard shot to review its takes or import a clip. Pending files and notes are retained.</p>}
      {!invalidShotRequest && shotImportConflict && requestedShotImport && <div className="takes-warning" role="alert"><p>Your pending MP4 is associated with {scene.shots.find(shot => shot.id === draft?.shotId)?.label ?? 'the scene'}, while the storyboard requested {scene.shots.find(shot => shot.id === requestedShotImport.request.shotId)?.label}. Choose whether to change its shot. The file, saved brief and review notes are retained.</p><button className="secondary" disabled={Boolean(busy) || pendingShotRequest} onClick={() => setRequestedShotImport(null)}>Keep pending shot association</button><button className="secondary" disabled={Boolean(busy) || pendingShotRequest} onClick={replacePendingShot}>Use requested shot for pending file</button></div>}
      {!importRequestBlocked && requestedImport && requestedImport.projectId === project.id && requestedImport.sourceHash === project.sourceHash && requestedImport.sceneId === scene.id && <div className="takes-warning" role="alert"><p>A returned-clip request has a different saved brief. Your pending MP4 and notes are retained.</p><button className="secondary" disabled={Boolean(busy)} onClick={() => setRequestedImport(null)}>Keep pending association</button><button className="secondary" disabled={Boolean(busy)} onClick={() => void applyNodeRequest(requestedImport, true)}>Use requested brief for pending file</button></div>}
      <div className="takes-workspace">
        <aside className="takes-library" aria-label="Scene takes">
          <div className="takes-list-heading"><h3>Scene clips</h3><span>{catalog?.takes.length ?? 0}</span></div>
          {loadState === 'loading' && <p className="takes-muted" role="status">Loading saved takes…</p>}
          {catalog?.takes.map((entry, index) => <button className="takes-item" key={entry.record.id} aria-pressed={entry.record.id === selected?.record.id} disabled={Boolean(busy) || invalidShotRequest || pendingShotRequest} onClick={() => { setSelectedIds(previous => ({ ...previous, [scope]: entry.record.id })); setNotice(''); setError(''); }}><span className="takes-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{entry.record.data.originalFilename}</strong><small>{scene.shots.find(shot => shot.id === entry.record.data.shotId)?.label ?? 'Scene reference'} · {seconds(entry.record.data.measurement.durationMs)}</small><small className="takes-decision">{decisionLabel(entry.review?.data.decision)}{notes[entry.record.sha256] ? ' · Unsaved note' : ''}</small></span></button>)}
          {loadState === 'ready' && !catalog?.takes.length && <p className="takes-empty-list">No measured clips in this scene. Bring a retained Library video into review or import a local clip.</p>}
          <section className="takes-import" aria-label="Import a take"><h3>Bring in a clip</h3><p className="takes-muted">Import a local MP4, up to {size(maxUploadBytes)}.</p>
            <label className="takes-file"><span>{draft ? 'Choose another MP4' : 'Choose an MP4'}</span><input aria-label="Choose an MP4" type="file" accept=".mp4,video/mp4" disabled={Boolean(busy) || importRequestBlocked} onChange={event => { chooseFile(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }}/></label>
            {draft && <><p className="takes-filename"><strong>{draft.file.name}</strong><small>{size(draft.file.size)} · Pending import</small></p><label className="takes-field">Associate with<select aria-label="Associate take with shot" value={draft.shotId} disabled={Boolean(busy) || importRequestBlocked} onChange={event => patchDraft({ shotId: event.target.value })}><option value="">Scene reference · no shot assigned</option>{scene.shots.map(shot => <option key={shot.id} value={shot.id}>{shot.label} · {shot.description}</option>)}</select></label><label className="takes-field">Saved clip brief <span>(optional)</span><select aria-label="Link saved clip brief" value={draft.briefKey} disabled={Boolean(busy) || importRequestBlocked} onChange={event => patchDraft({ briefKey: event.target.value })}><option value="">No saved brief link</option>{invalidBrief && <option value={draft.briefKey}>Previously selected version · changed</option>}{briefs.map(record => <option key={briefKey(record)} value={briefKey(record)}>{(record.data as GenerationBrief).title} · v{record.version}</option>)}</select></label>
            {invalidBrief && <p className="takes-warning">That saved brief changed. Choose its current version or remove the link.</p>}{briefShotMismatch && <p className="takes-warning">This shot is not in the selected brief. Choose a matching shot or remove the brief link.</p>}
            <div className="takes-import-actions"><button className="primary" disabled={Boolean(busy) || importRequestBlocked || loadState !== 'ready' || invalidBrief || briefShotMismatch} onClick={() => void importFile()}>{busy === 'import' ? 'Importing…' : 'Import clip'}</button><button className="secondary" disabled={Boolean(busy)} onClick={() => { setPending(previous => { const next = { ...previous }; delete next[scope]; return next; }); setError(''); }}>Clear file</button></div></>}
            {busy === 'import' && <div className="takes-progress" role="status"><progress aria-label="Importing and measuring clip"/><p>Saving your clip and measuring its video and audio…</p><button className="secondary" onClick={() => importController.current?.abort()}>Cancel import</button></div>}
          </section>
          {Boolean(catalog?.legacyTakes.length) && <details className="takes-legacy"><summary>{catalog?.legacyTakes.length} older take references</summary><p>These retained references have no verified local media measurement and are excluded from the playable take list.</p></details>}
        </aside>
        <main className="takes-review" aria-label="Take preview and review">
          <div className="takes-screen">{selected ? currentPreview ? <video key={currentPreview} src={currentPreview} controls playsInline preload="metadata" aria-label={`Preview ${selected.record.data.originalFilename}`} onError={() => setPreviewError('This clip could not play in this browser. Its saved measurements remain available.')}/> : <div className="takes-screen-message"><span className="takes-play-mark" aria-hidden="true">▷</span><p>{previewError ? 'Preview unavailable' : 'Opening saved clip…'}</p></div> : <div className="takes-screen-message"><span className="takes-play-mark" aria-hidden="true">▷</span><h3>A place to review the scene.</h3><p>Choose an MP4 to bring your first take into the film.</p></div>}</div>
          {previewError && <div className="takes-preview-error" role="alert"><p>{previewError}</p><button className="secondary" onClick={() => setPreviewRetry(value => value + 1)}>Retry preview</button></div>}
          {selected && selectedData && <><div className="takes-clip-heading"><div><span className="eyebrow">{selectedShot?.label ?? 'SCENE REFERENCE'} / {selectedData.origin === 'RETAINED_PROVIDER_OUTPUT' ? 'PROVIDER RETURN' : 'IMPORTED CLIP'}</span><h3>{selectedData.originalFilename}</h3></div><span>{decisionLabel(selected.review?.data.decision)}</span></div>
            <section className="takes-measurement" aria-label="Measured media details"><h4>Measured from this file</h4><dl><div><dt>Duration</dt><dd>{seconds(selectedData.measurement.durationMs)}</dd></div><div><dt>Resolution</dt><dd>{selectedData.measurement.width} × {selectedData.measurement.height}</dd></div><div><dt>Average frame rate</dt><dd>{fps(selectedData.measurement.frameRate)} fps</dd></div><div><dt>Audio</dt><dd>{selectedData.measurement.audio.length ? `${selectedData.measurement.audio.length} ${selectedData.measurement.audio.length === 1 ? 'track' : 'tracks'}` : 'No audio track'}</dd></div></dl></section>
            <div className="takes-plan"><p><span>Planned duration</span><strong>{plannedDuration ? seconds(plannedDuration) : 'Not set'}</strong></p><p><span>Saved brief</span><strong>{linkedBrief ? `${(linkedBrief.data as GenerationBrief).title} · v${linkedBrief.version}` : selectedData.briefRef ? 'Linked version retained · current brief has changed' : 'No brief linked'}</strong></p></div>
            <section className="takes-owner-review" aria-label="Owner review"><label className="takes-field">Review notes<textarea aria-label="Take review notes" rows={4} maxLength={10000} placeholder="Performance, continuity, framing, sound…" value={note} disabled={Boolean(busy)} onChange={event => updateNote(event.target.value)}/></label>
              {noteConflict && <div className="takes-warning"><p>The saved review changed. Your note is retained above. Current saved note: {selected.review?.data.note || 'No note'}</p><button className="secondary" disabled={Boolean(busy)} onClick={() => setNotes(previous => ({ ...previous, [selected.record.sha256]: { note, baseline: selected.review } }))}>Keep my note against this saved version</button></div>}
              <div className="takes-note-actions"><button className="secondary" disabled={Boolean(busy) || !noteEdit || noteConflict || loadState !== 'ready'} onClick={() => void saveReview(selected.review?.data.decision ?? 'PENDING', true)}>Save review notes</button>{noteEdit && <button className="secondary" disabled={Boolean(busy)} onClick={() => setNotes(previous => { const next = { ...previous }; delete next[selected.record.sha256]; return next; })}>Discard note edit</button>}<small>{noteEdit ? 'Unsaved note · retained when this panel closes' : selected.review ? `Saved review · v${selected.review.version}` : 'No owner review saved'}</small></div>
              <div className="takes-selection"><div><h4>{selectedShot ? `Candidate for shot ${selectedShot.label}` : 'Scene reference candidate'}</h4><p>Keeping a candidate records your preference. Choose its take and range in the movie timeline to use it in a cut. Final quality review remains open.</p></div><div><button className="primary" disabled={Boolean(busy) || Boolean(noteEdit) || loadState !== 'ready' || selected.review?.data.decision === 'KEEP_CANDIDATE'} onClick={() => void saveReview('KEEP_CANDIDATE', false)}>{selected.review?.data.decision === 'KEEP_CANDIDATE' ? 'Candidate kept' : 'Keep candidate'}</button><button className="secondary" disabled={Boolean(busy) || Boolean(noteEdit) || loadState !== 'ready'} onClick={() => void saveReview(selected.review?.data.decision === 'REJECT' || selected.review?.data.decision === 'KEEP_CANDIDATE' ? 'PENDING' : 'REJECT', false)}>{selected.review?.data.decision === 'KEEP_CANDIDATE' ? 'Clear preference' : selected.review?.data.decision === 'REJECT' ? 'Return to review' : 'Set aside'}</button></div></div>
            </section>
            <details className="takes-file-details"><summary>File details and source link</summary><dl><dt>File size</dt><dd>{size(selectedData.blob.byteLength)}</dd><dt>Video codec</dt><dd>{selectedData.measurement.videoCodec}</dd><dt>Audio details</dt><dd>{selectedData.measurement.audio.map(audio => `${audio.codec} · ${audio.channels} channels · ${Number(audio.sampleRate).toLocaleString()} Hz`).join('; ') || 'No audio track measured'}</dd><dt>Measured</dt><dd>{new Date(selectedData.measuredAt).toLocaleString()}</dd><dt>File SHA-256</dt><dd className="takes-hash">{selectedData.blob.sha256}</dd><dt>Saved take</dt><dd className="takes-hash">{selected.record.id}</dd><dt>Saved brief version</dt><dd className="takes-hash">{selectedData.briefRef ? `${selectedData.briefRef.id} / ${selectedData.briefRef.sha256}` : 'None'}</dd><dt>Origin</dt><dd>{selectedData.providerProvenance === 'LOCAL_BLENDER_RENDER' ? 'Local Blender motion preview · retained scene and render linked' : selectedData.providerProvenance === 'HIGGSFIELD_MCP_RECORD' ? 'Higgsfield returned media · linked to the retained provider job' : 'User supplied clip · provider origin unverified'}</dd>{selectedData.retainedSource && <><dt>Retained Library source</dt><dd className="takes-hash">{selectedData.retainedSource.id}<br/>{selectedData.retainedSource.sha256}</dd></>}</dl></details>
          </>}
        </main>
      </div>
      <footer className="takes-footer"><span>{dirty ? 'Pending clips and note edits stay here until imported, saved or cleared.' : 'Imported clips and owner notes are saved in this local workspace.'}</span><span>Scene {String(scene.index).padStart(2, '0')}</span></footer>
    </div>
  </div>;
}
