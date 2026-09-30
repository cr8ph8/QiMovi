import { useEffect, useRef, useState } from 'react';
import { MAX_OPENCREATOR_SRT_BYTES, OpenCreatorRequestError, openCreatorApi, openCreatorErrorMessage, validateOpenCreatorRequest, type OpenCreatorApi, type OpenCreatorCatalog, type OpenCreatorFormat, type OpenCreatorJob, type OpenCreatorRequest, type OpenCreatorScope } from './openCreatorApi';
import { downloadLocalBlob } from './localDownload';
import './opencreator-finishing.css';

type Props = { project: OpenCreatorScope; onLibrary: () => void; api?: OpenCreatorApi };
type Attempt = { request: OpenCreatorRequest; uncertain: boolean; checked: boolean };
const phaseLabels: Record<OpenCreatorJob['phase'], string> = { RUNNING: 'Rendering', COMPLETED: 'Completed', FAILED: 'Failed', CANCELLED: 'Cancelled', INTERRUPTED: 'Interrupted' };
const runtimeLabels: Record<OpenCreatorCatalog['runtime']['state'], string> = { READY: 'Ready to render locally', NOT_CONFIGURED: 'Local tools need setup', MISSING_DEPENDENCIES: 'Local tools unavailable' };
const reason = (error: unknown) => error instanceof Error ? openCreatorErrorMessage(error.message) : 'The local finishing request could not be confirmed.';
const rejected = (error: unknown) => error instanceof OpenCreatorRequestError && error.status >= 400 && error.status < 500 && ![408, 409, 429].includes(error.status);
const storageKey = (project: OpenCreatorScope) => `qimovi-opencreator-pending/v1:${encodeURIComponent(project.id)}:${project.sourceHash}`;
const MAX_RECOVERY_CHARACTERS = MAX_OPENCREATOR_SRT_BYTES * 6 + 4096;
function savedRequest(project: OpenCreatorScope): OpenCreatorRequest | null {
  try {
    const raw = sessionStorage.getItem(storageKey(project));
    if (raw === null) return null;
    if (raw.length > MAX_RECOVERY_CHARACTERS) throw new Error('Recovery entry too large.');
    return validateOpenCreatorRequest(JSON.parse(raw), project);
  } catch {
    try { sessionStorage.removeItem(storageKey(project)); } catch { /* The panel still opens when storage is unavailable. */ }
    return null;
  }
}
function saveRequest(project: OpenCreatorScope, request: OpenCreatorRequest) {
  try {
    const raw = JSON.stringify(validateOpenCreatorRequest(request, project));
    if (raw.length > MAX_RECOVERY_CHARACTERS) throw new Error('Recovery entry too large.');
    sessionStorage.setItem(storageKey(project), raw);
  } catch { throw new Error('QiMovi could not preserve this request for recovery. Session storage must be available before rendering.'); }
}
function clearRequest(project: OpenCreatorScope, requestId: string) {
  if (savedRequest(project)?.requestId !== requestId) return;
  try { sessionStorage.removeItem(storageKey(project)); } catch { /* A later check can still recover the matching completed request. */ }
}

export default function OpenCreatorFinishing(props: Props) {
  // A project/source change owns a new session. Old reads are aborted and mutation results are discarded.
  return <FinishingSession key={`${props.project.id}:${props.project.sourceHash}`} {...props}/>;
}

function FinishingSession({ project, onLibrary, api = openCreatorApi }: Props) {
  const [recovered] = useState(() => savedRequest(project));
  const [catalog, setCatalog] = useState<OpenCreatorCatalog | null>(null), [jobs, setJobs] = useState<OpenCreatorJob[]>([]);
  const [selectedId, setSelectedId] = useState(recovered?.assetRef.id ?? ''), [format, setFormat] = useState<OpenCreatorFormat>(recovered?.format ?? 'horizontal');
  const [subtitles, setSubtitles] = useState(recovered?.subtitles ?? ''), [reviewed, setReviewed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [attempt, setAttempt] = useState<Attempt | null>(() => recovered ? { request: recovered, uncertain: true, checked: false } : null), [needsCheck, setNeedsCheck] = useState<string[]>([]);
  const alive = useRef(true), busyRef = useRef(false), reads = useRef<AbortController | null>(null), fileRead = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; reads.current?.abort(); fileRead.current += 1; }; }, []);
  const selectedVideo = catalog?.videos.find(video => video.recordRef.id === selectedId);
  const subtitleBytes = new TextEncoder().encode(subtitles).byteLength;
  const validSubtitles = subtitles.trim().length > 0 && subtitleBytes <= MAX_OPENCREATOR_SRT_BYTES;
  const uncertain = attempt?.uncertain === true;
  const canRender = catalog?.runtime.state === 'READY' && !!selectedVideo && validSubtitles && reviewed && !busy && !uncertain;

  function begin(read = false) {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setError('');
    if (read) { reads.current?.abort(); reads.current = new AbortController(); }
    return true;
  }
  function finish() { if (alive.current) { busyRef.current = false; setBusy(false); } }
  function keepJob(job: OpenCreatorJob) { setJobs(previous => [job, ...previous.filter(item => item.id !== job.id)]); }
  async function checkTools() {
    if (!begin(true)) return;
    setCatalog(null); setReviewed(false);
    try {
      const result = await api.load(project, reads.current!.signal);
      if (!alive.current) return;
      setCatalog(result); setJobs(result.jobs); setNeedsCheck([]);
      if (attempt?.uncertain) {
        const matched = result.jobs.find(job => job.requestId === attempt.request.requestId && job.format === attempt.request.format);
        if (matched) clearRequest(project, attempt.request.requestId);
        setAttempt({ ...attempt, uncertain: !matched, checked: true });
      }
      setSelectedId(previous => result.videos.some(video => video.recordRef.id === previous) ? previous : '');
    } catch (caught) { if (alive.current) setError(reason(caught)); }
    finally { finish(); }
  }
  async function renderVideo(retry = false) {
    if (retry ? !attempt?.uncertain || !attempt.checked || busy : !canRender) return;
    if (!begin()) return;
    fileRead.current += 1;
    let next = attempt;
    if (!retry) {
      const input = { projectId: project.id, sourceHash: project.sourceHash, assetRef: { ...selectedVideo!.recordRef }, format, subtitles };
      next = { request: { ...input, requestId: crypto.randomUUID() }, uncertain: false, checked: false };
    }
    setAttempt(next);
    let submitted = false;
    try {
      saveRequest(project, next!.request);
      submitted = true;
      const job = await api.create(project, next!.request);
      if (!alive.current) return;
      clearRequest(project, next!.request.requestId);
      keepJob(job); setAttempt({ ...next!, uncertain: false, checked: false });
    } catch (caught) {
      if (!alive.current) return;
      setError(reason(caught));
      if (submitted && rejected(caught)) clearRequest(project, next!.request.requestId);
      setAttempt({ ...next!, uncertain: submitted ? !rejected(caught) : retry, checked: false });
    } finally { finish(); }
  }
  async function jobAction(job: OpenCreatorJob, action: 'check' | 'cancel' | 'retain' | 'video' | 'receipt') {
    if (!begin(['check', 'video', 'receipt'].includes(action))) return;
    try {
      if (action === 'video' || action === 'receipt') {
        const blob = await api[action](project, job, reads.current!.signal);
        if (!alive.current) return;
        downloadLocalBlob(blob, action === 'video' ? job.output!.filename : `${job.id}-receipt.json`);
      } else {
        const result = action === 'check' ? await api.job(project, job.id, reads.current!.signal) : await api[action](project, job.id);
        if (!alive.current) return;
        keepJob(result); setNeedsCheck(previous => previous.filter(id => id !== job.id));
      }
    } catch (caught) {
      if (!alive.current) return;
      if (action === 'cancel' || action === 'retain') {
        setNeedsCheck(previous => [...new Set([...previous, job.id])]);
        setError(`${reason(caught)} The change may have finished locally. Check result before trying again.`);
      } else setError(reason(caught));
    } finally { finish(); }
  }
  async function loadSrt(file: File | undefined) {
    if (!file || busyRef.current || uncertain) return;
    setError(''); setReviewed(false);
    const generation = ++fileRead.current;
    if (!/\.srt$/i.test(file.name) || file.size > MAX_OPENCREATOR_SRT_BYTES) { setError('Choose an SRT file of 256 KiB or less.'); return; }
    try {
      const text = await file.text();
      if (!alive.current || generation !== fileRead.current) return;
      if (new TextEncoder().encode(text).byteLength > MAX_OPENCREATOR_SRT_BYTES) throw new Error('Reviewed SRT must be 256 KiB or less.');
      setSubtitles(text); setReviewed(false);
    } catch (caught) { if (alive.current && generation === fileRead.current) setError(reason(caught)); }
  }

  return <section className="opencreator-finishing" aria-label="OpenCreator local finishing">
    <header className="opencreator-heading"><div><h3>OpenCreator local finishing</h3><p>Burn reviewed subtitles into a retained MP4. Keep its framing or make a vertical version.</p></div>
      <span className="opencreator-state" data-ready={catalog?.runtime.state === 'READY'}>{catalog ? runtimeLabels[catalog.runtime.state] : 'Tools not checked'}</span></header>
    <p className="opencreator-muted">These render stages use 0 model/API calls. Local compute cost is not measured.</p>
    <div className="opencreator-actions"><button type="button" className="secondary" disabled={busy} onClick={() => void checkTools()}>Check local tools</button><button type="button" className="secondary" onClick={onLibrary}>Open Library</button></div>
    {catalog && <p role="status">{catalog.runtime.message}</p>}
    {catalog && catalog.videos.length === 0 && <p>No retained MP4s are available {project.sourceHash === null ? 'in this project' : 'for this screenplay revision'}. Add a video in the Library, then check local tools.</p>}
    <fieldset className="opencreator-form" disabled={busy || uncertain}>
      <legend>Prepare a local render</legend>
      <div className="opencreator-inputs"><label>Retained MP4<select value={selectedId} onChange={event => { setSelectedId(event.target.value); setReviewed(false); }} disabled={!catalog?.videos.length}>
        <option value="">Choose a retained video</option>{catalog?.videos.map(video => <option key={video.recordRef.id} value={video.recordRef.id}>{video.title || video.originalFilename} · {(video.byteLength / (1024 * 1024)).toFixed(1)} MiB</option>)}</select></label>
        <label>Output format<select value={format} onChange={event => setFormat(event.target.value as OpenCreatorFormat)}><option value="horizontal">Keep source framing</option><option value="vertical">Vertical</option></select></label></div>
      <label>Load SRT file<input type="file" accept=".srt,application/x-subrip" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void loadSrt(file); }}/></label>
      <label>Reviewed subtitles (SRT)<textarea value={subtitles} rows={5} spellCheck={false} placeholder={'1\n00:00:00,000 --> 00:00:02,000\nYour reviewed subtitle'} onChange={event => { fileRead.current += 1; setSubtitles(event.target.value); setReviewed(false); }}/></label>
      <p className="opencreator-muted">SRT limit: 256 KiB. Video limit: 256 MiB and 30 minutes. Review subtitle timing and the vertical framing in the finished video.</p>
      {subtitleBytes > MAX_OPENCREATOR_SRT_BYTES && <p role="alert">Reviewed SRT must be 256 KiB or less.</p>}
      <label className="opencreator-review"><input type="checkbox" checked={reviewed} disabled={!validSubtitles || !selectedVideo} onChange={event => setReviewed(event.target.checked)}/>I reviewed these subtitles for the selected video</label>
      <div><button type="button" className="primary" disabled={!canRender} onClick={() => void renderVideo()}>Render locally</button></div>
    </fieldset>
    {uncertain && <div className="opencreator-uncertain" role="status"><p>The render request was not confirmed. It may already be running locally. Check local tools and review the job list before retrying the same request.</p><button type="button" className="secondary" disabled={busy || !attempt.checked} onClick={() => void renderVideo(true)}>Retry same request</button><small>The retry keeps the original request ID so the local service can return the same job.</small></div>}
    {busy && <p role="status">Waiting for local tools…</p>}
    {error && <p role="alert">{error}</p>}
    {jobs.length > 0 && <div className="opencreator-jobs"><h4>Local renders</h4><p className="opencreator-muted">State updates when you check. Jobs continue locally when you leave this panel.</p>
      {jobs.map(job => <article className="opencreator-job" key={job.id} aria-label={`Local render ${job.id}`}><div className="opencreator-job-heading"><strong>{phaseLabels[job.phase]} · {job.format === 'vertical' ? 'Vertical' : 'Source framing'}</strong><time dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleString()}</time></div>
        {job.error && <p>{openCreatorErrorMessage(job.error)}</p>}
        {job.phase === 'COMPLETED' && <p>{job.retainedAssetId ? 'Kept in Library · reference pending review.' : 'Rendered MP4 ready to review. Keeping it in the Library adds a reference pending review.'}</p>}
        {needsCheck.includes(job.id) && <p>Check result to confirm the last change.</p>}
        <div className="opencreator-actions"><button type="button" className="secondary" disabled={busy} onClick={() => void jobAction(job, 'check')}>Check result</button>
          {job.phase === 'RUNNING' && <button type="button" className="secondary" disabled={busy || needsCheck.includes(job.id)} onClick={() => void jobAction(job, 'cancel')}>Cancel render</button>}
          {job.phase === 'COMPLETED' && <><button type="button" className="secondary" disabled={busy} onClick={() => void jobAction(job, 'video')}>Download MP4</button><button type="button" className="secondary" disabled={busy} onClick={() => void jobAction(job, 'receipt')}>Download receipt</button>{!job.retainedAssetId && <button type="button" className="secondary" disabled={busy || needsCheck.includes(job.id)} onClick={() => void jobAction(job, 'retain')}>Keep in Library</button>}</>}
        </div></article>)}
    </div>}
  </section>;
}
