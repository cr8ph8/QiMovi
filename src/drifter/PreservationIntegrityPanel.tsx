import { useEffect, useMemo, useRef, useState } from 'react';
import type { PreservationCatalog, PreservationCheckManifest, PreservationCheckResult, PreservationInventoryItem } from '../../local/contracts/preservation-integrity.mjs';
import type { WorkspaceProject } from './types';
import { preservationIntegrityApi, type PreservationIntegrityApi } from './preservationIntegrityApi';
import { downloadLocalBlob } from './localDownload';
import { fileSize } from './projectLibraryModel';
import './preservation-integrity.css';

interface Props {
  project: WorkspaceProject;
  open: boolean;
  onOpenBudget?: () => void;
  integrityApi?: PreservationIntegrityApi;
}
const PAGE_SIZE = 25;
const resultLabels: Record<PreservationCheckResult['status'], string> = {
  MATCH: 'MATCH', MISMATCH: 'MISMATCH', MISSING: 'MISSING', UNREADABLE: 'UNREADABLE', CHANGED_DURING_CHECK: 'CHANGED DURING CHECK',
};
const statusLabels = { RUNNING: 'Checking files', INTERRUPTED: 'Interrupted', CANCELLED: 'Stopped', COMPLETED: 'Check finished' };
const message = (error: unknown) => error instanceof Error ? error.message : 'The local integrity service did not respond.';
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : 'Not observed';
const csvCell = (value: unknown) => {
  const text = value == null ? '' : String(value);
  return `"${(/^[\s]*[=+@-]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
};
function csvManifest(job: PreservationCheckManifest) {
  const byHash = new Map(job.results.map(result => [result.sha256, result]));
  const rows: unknown[][] = [['jobId', 'jobStatus', 'scope', 'evidencePath', 'manifestSha256', 'knownFilenames', 'storedCopy', 'expectedSha256', 'expectedBytes', 'result', 'observedAt', 'observedSha256', 'observedBytes', 'reason']];
  for (const item of job.items) {
    const result = byHash.get(item.sha256);
    rows.push([job.jobId, job.status, job.scope, job.evidencePath, job.sha256, item.filenameHints.join(' | '), `blobs/${item.sha256}`, item.sha256, item.byteLength, result?.status ?? 'NOT_CHECKED', result?.checkedAt, result?.observedSha256, result?.observedByteLength, result?.reason]);
  }
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

/** Opening the panel reads saved inventory and receipts; hashing needs an explicit action. */
export default function PreservationIntegrityPanel({ project, open, ...props }: Props) {
  return open ? <IntegrityWorkspace key={`${project.id}:${project.sourceHash}`} projectId={project.id} {...props}/> : null;
}

function IntegrityWorkspace({ projectId, onOpenBudget, integrityApi = preservationIntegrityApi }: Omit<Props, 'project' | 'open'> & { projectId: string }) {
  const [catalog, setCatalog] = useState<PreservationCatalog | null>(null);
  const [job, setJob] = useState<PreservationCheckManifest | null>(null);
  const [jobId, setJobId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState<'selected' | 'all'>('selected');
  const [query, setQuery] = useState(''), [resultFilter, setResultFilter] = useState(''), [page, setPage] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(true), [jobLoading, setJobLoading] = useState(false);
  const [catalogError, setCatalogError] = useState(''), [jobError, setJobError] = useState(''), [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(''), [refresh, setRefresh] = useState(0), [jobRefresh, setJobRefresh] = useState(0);
  const alive = useRef(true), actionController = useRef<AbortController | null>(null), actionBusy = useRef(false), pollingController = useRef<AbortController | null>(null);
  const pendingStart = useRef<{ selection: string; requestId: string } | null>(null);
  const currentJobId = useRef(jobId); currentJobId.current = jobId;
  useEffect(() => { alive.current = true; return () => { alive.current = false; actionController.current?.abort(); }; }, []);

  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setCatalogLoading(true); setCatalogError('');
    void integrityApi.load(projectId, controller.signal).then(value => {
      if (!active) return;
      setCatalog(value);
      setSelected(prior => prior.filter(hash => value.items.some(item => item.sha256 === hash)));
      setJobId(prior => value.jobs.some(item => item.jobId === prior) ? prior : (value.jobs.find(item => item.status === 'RUNNING') ?? value.jobs[0])?.jobId ?? '');
    }).catch(error => { if (active) setCatalogError(message(error)); }).finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [integrityApi, projectId, refresh]);

  useEffect(() => {
    if (!jobId) { setJob(null); return; }
    const controller = new AbortController(); let active = true; let timer: ReturnType<typeof setTimeout> | undefined;
    pollingController.current = controller; setJobLoading(true); setJobError('');
    async function readJob() {
      if (controller.signal.aborted) return;
      try {
        const value = await integrityApi.get(projectId, jobId, controller.signal);
        if (!active || controller.signal.aborted) return;
        setJob(value);
        setCatalog(prior => prior ? { ...prior, jobs: prior.jobs.map(item => item.jobId === value.jobId ? value : item) } : prior); setJobError(''); setJobLoading(false);
        if (value.status === 'RUNNING') timer = setTimeout(() => void readJob(), 1500);
      } catch (error) {
        if (active && !controller.signal.aborted) { setJobError(message(error)); setJobLoading(false); }
      }
    }
    void readJob();
    return () => { active = false; controller.abort(); if (timer) clearTimeout(timer); };
  }, [integrityApi, projectId, jobId, jobRefresh]);

  const viewedJob = job?.jobId === jobId ? job : null;
  const results = useMemo(() => new Map(viewedJob?.results.map(result => [result.sha256, result]) ?? []), [viewedJob]);
  const jobHashes = useMemo(() => new Set(viewedJob?.items.map(item => item.sha256) ?? []), [viewedJob]);
  const items = catalog?.items ?? [];
  const filtered = items.filter(item => `${item.filenameHints.join(' ')} ${item.sha256} ${item.mimeType}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && (!resultFilter || (results.get(item.sha256)?.status ?? 'NOT_CHECKED') === resultFilter));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visiblePage = Math.min(page, pages - 1), visible = filtered.slice(visiblePage * PAGE_SIZE, (visiblePage + 1) * PAGE_SIZE);
  const requestedItems = selectionMode === 'all' ? items : items.filter(item => selected.includes(item.sha256));
  const requestedHashes = requestedItems.map(item => item.sha256).sort();
  const selectionKey = requestedHashes.join(',');
  useEffect(() => { if (pendingStart.current?.selection !== selectionKey) pendingStart.current = null; }, [selectionKey]);
  const requestedBytes = requestedItems.reduce((sum, item) => sum + item.byteLength, 0);
  const activeJob = viewedJob?.status === 'RUNNING' || catalog?.jobs.some(item => item.status === 'RUNNING' && (item.jobId !== viewedJob?.jobId || viewedJob.status === 'RUNNING'));
  const overLimit = Boolean(catalog && (requestedItems.length > catalog.limits.jobItems || requestedBytes > catalog.limits.jobBytes || requestedItems.some(item => item.byteLength > catalog.limits.fileBytes)));
  const canStart = Boolean(catalog && requestedItems.length && !overLimit && !activeJob && !busy && !catalogLoading && !catalogError);

  async function act(action: 'start' | 'cancel' | 'resume') {
    if (actionBusy.current || (action === 'start' && !canStart) || (action !== 'start' && !viewedJob)) return;
    const targetId = viewedJob?.jobId;
    actionBusy.current = true; pollingController.current?.abort(); setBusy(action); setActionError(''); setNotice('');
    const controller = new AbortController(); actionController.current = controller;
    try {
      if (action === 'start' && !pendingStart.current) pendingStart.current = { selection: selectionKey, requestId: crypto.randomUUID() };
      const next = action === 'start'
        ? await integrityApi.start(projectId, requestedHashes, pendingStart.current!.requestId, controller.signal)
        : await integrityApi[action](projectId, targetId!, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      if (action === 'start') pendingStart.current = null;
      setJob(next); setJobId(next.jobId);
      setCatalog(prior => prior ? { ...prior, jobs: [next, ...prior.jobs.filter(item => item.jobId !== next.jobId)] } : prior);
      setNotice(action === 'cancel' ? 'Stop requested. Saved results remain available.' : action === 'resume' ? 'Resuming the unchecked files. Earlier results keep their original observation times.' : 'File check started. You can stop it and resume unchecked files later.');
    } catch (error) { if (alive.current && !controller.signal.aborted) setActionError(message(error)); }
    finally { actionBusy.current = false; if (alive.current) { setBusy(''); setJobRefresh(value => value + 1); } }
  }

  function download(format: 'json' | 'csv') {
    if (!viewedJob) return;
    setActionError(''); setNotice('');
    try {
      const text = format === 'json' ? JSON.stringify(viewedJob, null, 2) : csvManifest(viewedJob);
      downloadLocalBlob(new Blob([text], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' }), `qimovi-integrity-${viewedJob.jobId}.${format}`);
      setNotice('Manifest prepared for local save. It records this check and its observation times.');
    } catch (error) { setActionError(message(error)); }
  }

  async function copyReference() {
    if (!viewedJob) return;
    const targetId = viewedJob.jobId;
    setActionError(''); setNotice('');
    try {
      await navigator.clipboard.writeText(`${viewedJob.evidencePath}\nManifest SHA-256: ${viewedJob.sha256}\n${statusLabels[viewedJob.status]}: ${viewedJob.summary.checked}/${viewedJob.summary.total} files checked. Updated ${viewedJob.updatedAt}. Retained workspace copy only; historical observations.`);
      if (alive.current && currentJobId.current === targetId) setNotice('Evidence reference copied. Paste it into the relevant Production plan evidence field.');
    } catch { if (alive.current && currentJobId.current === targetId) setActionError('The reference could not be copied. Select the reference below and copy it manually.'); }
  }

  return <section className="preservation-integrity" aria-label="File integrity checks">
    <header className="pi-heading"><div><span className="eyebrow">PRESERVATION</span><h3>Check your retained files</h3><p>Compare the files held in this workspace with their registered SHA-256 and size.</p></div><div className="pi-actions">{onOpenBudget && <button onClick={onOpenBudget}>Open film budget</button>}<button disabled={catalogLoading || Boolean(busy)} onClick={() => { setRefresh(value => value + 1); setJobRefresh(value => value + 1); }}>Refresh inventory</button></div></header>
    <p className="pi-scope">This checks one retained workspace copy. Backup copies, archive deposits, restore tests, master roles and custody remain separate evidence.</p>
    {catalogError && <p role="alert" className="pi-error">Inventory could not be refreshed: {catalogError} {catalog && 'The displayed inventory is from the earlier load.'}</p>}
    {actionError && <p role="alert" className="pi-error">{actionError}</p>}
    {notice && <p role="status" className="pi-notice">{notice}</p>}
    <div className="pi-start"><div><strong>{catalogLoading ? 'Reading registered files…' : `${items.length.toLocaleString()} registered files`}</strong>{catalog && <small>{fileSize(items.reduce((sum, item) => sum + item.byteLength, 0))} registered · Up to {catalog.limits.jobItems.toLocaleString()} files / {fileSize(catalog.limits.jobBytes)} per check · {fileSize(catalog.limits.fileBytes)} per file</small>}</div><fieldset disabled={Boolean(busy) || Boolean(activeJob)}><legend>Files to check</legend><label><input type="radio" name="integrity-selection" checked={selectionMode === 'selected'} onChange={() => setSelectionMode('selected')}/>Selected files ({selected.length})</label><label><input type="radio" name="integrity-selection" checked={selectionMode === 'all'} onChange={() => setSelectionMode('all')}/>All registered files ({items.length})</label></fieldset><button className="pi-primary" disabled={!canStart} onClick={() => void act('start')}>{busy === 'start' ? 'Starting…' : 'Check files'}</button></div>
    {overLimit && <p className="pi-warning">This selection exceeds a check limit. Choose a smaller group within the file-count and size limits.</p>}
    {activeJob && viewedJob?.status !== 'RUNNING' && <p className="pi-warning">Another check is running. Open it in Recorded checks to see its progress or stop it.</p>}

    {(catalog?.jobs.length || viewedJob) ? <section className="pi-job" aria-label="Recorded integrity check"><div className="pi-job-heading"><label>Recorded checks<select aria-label="Recorded checks" value={jobId} disabled={Boolean(busy)} onChange={event => { setJobId(event.target.value); setNotice(''); setActionError(''); }}>{catalog?.jobs.map(item => <option key={item.jobId} value={item.jobId}>{date(item.createdAt)} · {statusLabels[item.status]}</option>)}</select></label>{viewedJob && <div className="pi-actions">{viewedJob.status === 'RUNNING' && <button className="pi-stop" disabled={Boolean(busy)} onClick={() => void act('cancel')}>{busy === 'cancel' ? 'Stopping…' : 'Stop check'}</button>}{['CANCELLED', 'INTERRUPTED'].includes(viewedJob.status) && viewedJob.summary.checked < viewedJob.summary.total && <button className="pi-primary" disabled={Boolean(busy) || Boolean(activeJob)} onClick={() => void act('resume')}>{busy === 'resume' ? 'Resuming…' : 'Resume check'}</button>}</div>}</div>
      {jobError && <p role="alert" className="pi-error">Check progress could not be refreshed: {jobError} Displayed results may be outdated. Use Refresh inventory to retry.</p>}
      {jobLoading && <p role="status">Reading saved check…</p>}
      {viewedJob && <><div className="pi-job-status" aria-live="polite"><strong>{statusLabels[viewedJob.status]}</strong><span>{viewedJob.summary.checked} of {viewedJob.summary.total} files checked · Last recorded {date(viewedJob.updatedAt)}</span></div><progress aria-label="Files checked" max={viewedJob.summary.total || 1} value={viewedJob.summary.checked}/><div className="pi-counts"><span>{viewedJob.summary.match} matched</span><span>{viewedJob.summary.mismatch} mismatched</span><span>{viewedJob.summary.missing} missing</span><span>{viewedJob.summary.unreadable} unreadable</span><span>{viewedJob.summary.changedDuringCheck} changed during check</span><span>{viewedJob.summary.total - viewedJob.summary.checked} unchecked</span></div><p className="pi-scope">Results describe the times shown. A recorded MATCH does not establish the file’s current condition or a verified backup. Resume checks only the remaining files.</p><div className="pi-actions"><button onClick={() => download('json')}>Download JSON manifest</button><button onClick={() => download('csv')}>Download CSV manifest</button><button onClick={() => void copyReference()}>Copy evidence reference</button></div><details className="pi-evidence"><summary>Evidence reference for Production plan</summary><p>Paste this reference into Movie desk → Production plan → the relevant preservation requirement’s Evidence field. Review its status separately.</p><code>{viewedJob.evidencePath}</code><small>Manifest SHA-256</small><code>{viewedJob.sha256}</code></details></>}
    </section> : <p className="pi-empty">No saved integrity checks loaded. Select files below, then choose Check files.</p>}

    <div className="pi-filters"><label>Find a file<input type="search" aria-label="Find an integrity file" placeholder="Known filename or SHA-256" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }}/></label><label>Result in this check<select aria-label="Integrity result filter" value={resultFilter} onChange={event => { setResultFilter(event.target.value); setPage(0); }}><option value="">All results</option><option value="NOT_CHECKED">Not checked</option>{Object.entries(resultLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button disabled={!visible.length || Boolean(busy)} onClick={() => setSelected(prior => [...new Set([...prior, ...visible.map(item => item.sha256)])])}>Select this page</button><button disabled={!selected.length || Boolean(busy)} onClick={() => setSelected([])}>Clear selection</button></div>
    <div className="pi-table-scroll"><table><caption>Registered workspace files · results from the selected recorded check</caption><thead><tr><th scope="col">Select</th><th scope="col">Known filename / retained copy</th><th scope="col">Registered size</th><th scope="col">Observed result</th></tr></thead><tbody>{visible.map(item => <InventoryRow key={item.sha256} item={item} result={results.get(item.sha256)} pending={jobHashes.has(item.sha256) && !results.has(item.sha256)} selected={selected.includes(item.sha256)} disabled={Boolean(busy)} onSelect={checked => setSelected(prior => checked ? [...new Set([...prior, item.sha256])] : prior.filter(hash => hash !== item.sha256))}/>)}</tbody></table>{!catalogLoading && !visible.length && <p className="pi-empty">{items.length ? 'No files match these filters.' : 'No registered files are available in this workspace.'}</p>}</div>
    <nav className="pi-pagination" aria-label="Integrity inventory pages"><span>{filtered.length} files · Page {visiblePage + 1} of {pages} · {selected.length} selected</span><button disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>Previous page</button><button disabled={visiblePage + 1 >= pages} onClick={() => setPage(visiblePage + 1)}>Next page</button></nav>
  </section>;
}

function InventoryRow({ item, result, pending, selected, disabled, onSelect }: { item: PreservationInventoryItem; result?: PreservationCheckResult; pending: boolean; selected: boolean; disabled: boolean; onSelect: (checked: boolean) => void }) {
  const name = item.filenameHints[0] ?? 'Filename unknown';
  return <tr><td><input type="checkbox" aria-label={`Select ${name} (${item.sha256.slice(0, 12)})`} checked={selected} disabled={disabled} onChange={event => onSelect(event.target.checked)}/></td><th scope="row"><strong>{name}</strong>{item.filenameHints.length > 1 && <small>Also recorded as: {item.filenameHints.slice(1).join(' · ')}</small>}<details><summary>Retained copy & identity</summary><code>blobs/{item.sha256}</code><small>{item.referenceCount} known references · {item.mimeType}</small></details></th><td>{fileSize(item.byteLength)}</td><td><span className="pi-result" data-result={result?.status ?? 'NOT_CHECKED'}>{result ? resultLabels[result.status] : pending ? 'UNCHECKED IN THIS JOB' : 'NOT CHECKED'}</span><small>{result ? date(result.checkedAt) : 'No observation in this check'}</small>{result?.reason && <small>{result.reason}</small>}{result && result.status !== 'MATCH' && <details><summary>Observed details</summary><small>Observed size: {result.observedByteLength == null ? 'Unknown' : fileSize(result.observedByteLength)}</small><code>{result.observedSha256 ?? 'No completed hash'}</code></details>}</td></tr>;
}
