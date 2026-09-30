import { useEffect, useRef, useState } from 'react';
import { usageAccountingApi, type UsageAccountingApi, type UsagePreview, type UsageSummary } from './usageAccountingApi';
import type { WorkspaceProject, WorkspaceRecord } from './types';
import './usage-accounting.css';

const number = (value: number | null) => value === null ? 'Unknown' : value.toLocaleString();
const decimal = (value: string) => value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
const usd = (value: string | null) => value === null ? 'Unknown' : `$${decimal(value)} USD`;
const when = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : value;
type Review = { scope: string; filename: string; reportText: string; preview: UsagePreview };

export default function UsageAccountingPanel({ open, project, onSaved, api = usageAccountingApi }: {
  open: boolean; project: WorkspaceProject; onSaved?: (record: WorkspaceRecord) => void; api?: UsageAccountingApi;
}) {
  const [value, setValue] = useState<{ scope: string; summary: UsageSummary } | null>(null);
  const [review, setReview] = useState<Review | null>(null), [busy, setBusy] = useState<'load' | 'preview' | 'save' | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const scope = `${project.id}:${project.sourceHash}`, current = useRef({ scope, open }), serial = useRef(0), fileInput = useRef<HTMLInputElement>(null);
  current.current = { scope, open };
  const alive = (attempt: number, captured: string) => current.current.open && current.current.scope === captured && serial.current === attempt;
  const summary = value?.scope === scope ? value.summary : null;

  useEffect(() => {
    const attempt = ++serial.current, controller = new AbortController();
    setReview(null); setError(''); setNotice(''); setBusy(open ? 'load' : null);
    if (!open) return;
    void api.load(project, controller.signal).then(result => { if (alive(attempt, scope)) setValue({ scope, summary: result }); })
      .catch(reason => { if (alive(attempt, scope) && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Usage could not be read.'); })
      .finally(() => { if (alive(attempt, scope)) setBusy(null); });
    return () => { controller.abort(); ++serial.current; };
  }, [open, scope, api]);

  async function refresh() {
    const captured = scope, attempt = ++serial.current; setBusy('load'); setError('');
    try { const result = await api.load(project); if (alive(attempt, captured)) setValue({ scope: captured, summary: result }); }
    catch (reason) { if (alive(attempt, captured)) setError(reason instanceof Error ? reason.message : 'Usage could not be read.'); }
    finally { if (alive(attempt, captured)) setBusy(null); }
  }
  async function chooseFile(file: File) {
    const captured = scope, attempt = ++serial.current; setBusy('preview'); setError(''); setNotice(''); setReview(null);
    try {
      if (file.size > (summary?.limits.maxReportBytes ?? 2097152)) throw new Error('Choose a Token Steward JSON report no larger than 2 MB.');
      let reportText: string;
      try { reportText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()); }
      catch { throw new Error('Choose a valid UTF-8 JSON report. Its original bytes must be preserved.'); }
      if (!alive(attempt, captured)) return;
      const preview = await api.preview(project, reportText);
      if (alive(attempt, captured)) setReview({ scope: captured, filename: file.name, reportText, preview });
    } catch (reason) { if (alive(attempt, captured)) setError(reason instanceof Error ? reason.message : 'This report could not be previewed.'); }
    finally { if (alive(attempt, captured)) setBusy(null); }
  }
  async function save() {
    if (!review || review.scope !== scope || busy) return;
    const captured = scope, attempt = ++serial.current, chosen = review; setBusy('save'); setError(''); setNotice('');
    try {
      const result = await api.import(project, chosen.reportText, chosen.preview.reportHash);
      if (!alive(attempt, captured)) return;
      setValue({ scope: captured, summary: result.summary }); setReview(null);
      setNotice(result.replayed ? 'This exact report was already saved. No duplicate was added.' : 'Report saved locally as an observation.');
      onSaved?.(result.record);
    } catch (reason) { if (alive(attempt, captured)) setError(`${reason instanceof Error ? reason.message : 'The save could not be confirmed.'} The same report remains ready to retry.`); }
    finally { if (alive(attempt, captured)) setBusy(null); }
  }
  return <section className="usage-accounting" hidden={!open} aria-label="Usage and cost">
    <div className="usage-heading"><div><h3>Usage & cost</h3><p>{project.title} · {project.sourceHash === null ? 'No screenplay' : 'current source'}</p></div><button disabled={Boolean(busy)} onClick={() => void refresh()}>{busy === 'load' ? 'Reading…' : 'Refresh local records'}</button></div>
    <p className="usage-scope">Local records and imported reports. Account monitoring and a shared spending limit are not connected.</p>
    {summary && <>
      <dl className="usage-totals">
        <div><dt>Local model tokens</dt><dd>{number(summary.local.inputTokens)} in · {number(summary.local.outputTokens)} out</dd><small>{number(summary.local.attemptCount)} attempts · compute cost unknown{summary.local.unknownUsageAttempts > 0 ? ` · ${number(summary.local.unknownUsageAttempts)} with missing usage` : ''}</small></div>
        <div><dt>Higgsfield quotes</dt><dd>{summary.generation.quotedAttempts ? `${decimal(summary.generation.quotedCredits)} credits` : 'No recorded quote'}</dd><small>{number(summary.generation.quotedAttempts)} quoted attempts · billing not reconciled{summary.generation.unquotedAttempts > 0 ? ` · ${number(summary.generation.unquotedAttempts)} without a quote` : ''}</small></div>
        <div><dt>Imported API cost</dt><dd>{summary.imported.eventCount ? `${usd(summary.imported.reportedUsd)} reported · ${usd(summary.imported.estimatedUsd)} estimated` : 'No matching events'}</dd><small>{number(summary.imported.eventCount)} matched events · {number(summary.imported.unknownCostEvents)} with unknown cost</small></div>
        <div><dt>Cost per report-accepted task</dt><dd>{summary.imported.costPerObservedAcceptedTaskUsd === null ? 'Unavailable' : usd(summary.imported.costPerObservedAcceptedTaskUsd)}</dd><small>{number(summary.imported.observedAcceptedTasks)} tasks marked accepted in reports. Owner-verified acceptance is unavailable here.</small></div>
      </dl>
      <p className="usage-footnote">Credits, USD and local compute stay separate. Imported amounts are observations; quote totals are not charges. Missing costs are excluded from known totals.</p>
    </>}
    <div className="usage-import">
      <div><h4>Import a Token Steward report</h4><p>Choose its JSON report to review the project match before saving. The exact file is retained locally.</p></div>
      <input ref={fileInput} type="file" tabIndex={-1} accept=".json,application/json" aria-label="Token Steward JSON report" disabled={Boolean(busy)} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void chooseFile(file); }}/>
      <button disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}>{busy === 'preview' ? 'Reading report…' : 'Choose report…'}</button>
    </div>
    {review?.scope === scope && <section className="usage-review" aria-label="Report import preview">
      <h4>{review.filename}</h4><p>Generated {when(review.preview.generatedAt)} · {number(review.preview.byteLength)} bytes</p>
      <p><strong>{number(review.preview.matchedEventCount)} matching events</strong> · {number(review.preview.excludedEventCount)} excluded from this project’s totals</p>
      <p>{usd(review.preview.summary.imported.reportedUsd)} reported · {usd(review.preview.summary.imported.estimatedUsd)} estimated · {number(review.preview.summary.imported.unknownCostEvents)} unknown</p>
      {review.preview.excludedProjects.length > 0 && <p className="usage-note">The retained file also contains {review.preview.excludedProjects.map(row => `${row.project || '(unassigned)'} (${row.eventCount})`).join(', ')}. These events will remain excluded.</p>}
      {review.preview.matchedEventCount === 0 && <p className="usage-note">No event has project ID <code>{project.id}</code>. This report will be kept as evidence without adding this project’s usage.</p>}
      {review.preview.alreadyImported && <p>This exact report is already in the workspace. Saving again will not duplicate it.</p>}
      <details><summary>Exact report and provenance</summary><code className="usage-hash">SHA-256 {review.preview.reportHash}</code><pre>{review.reportText}</pre></details>
      <p>Imported outcomes do not approve creative work or change spending limits.</p>
      <div className="usage-actions"><button className="assistant-primary" disabled={Boolean(busy)} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : review.preview.alreadyImported ? 'Keep existing report' : 'Save observation'}</button><button disabled={Boolean(busy)} onClick={() => setReview(null)}>Cancel</button></div>
    </section>}
    {notice && <p role="status" className="usage-notice">{notice}</p>}{error && <p role="alert" className="error-text">{error}</p>}
    {summary && <>
      <div className="usage-ledger-heading"><h4>Tasks & attempts</h4><small>{number(summary.totalAttempts)} records{summary.totalAttempts > summary.attempts.length ? ` · latest ${summary.attempts.length} shown` : ''}</small></div>
      {summary.attempts.length ? <div className="usage-table-scroll"><table><caption className="usage-sr-only">Current project usage attempts</caption><thead><tr><th scope="col">Task / model</th><th scope="col">Tokens in / out</th><th scope="col">Cost / quote</th><th scope="col">Outcome</th></tr></thead><tbody>{summary.attempts.map((row, index) => <tr key={`${row.origin}:${row.id}:${index}`}>
        <th scope="row"><strong>{row.taskId || 'Unassigned task'}</strong><span>{row.provider} · {row.model || 'Model unrecorded'}</span>{(row.sceneId || row.shotId) && <span>{[row.sceneId, row.shotId].filter(Boolean).join(' · ')}</span>}<small>{when(row.timestamp)}</small><small title={row.recordId || row.id}>{row.origin === 'TOKEN_STEWARD' ? 'Imported observation' : row.origin === 'LOCAL_MODEL' ? 'Saved local request' : 'Saved generation request'}</small></th>
        <td>{number(row.inputTokens)} / {number(row.outputTokens)}</td>
        <td>{row.quotedCredits !== null ? <>{decimal(row.quotedCredits)} credits<small>Quoted · billing unknown</small></> : <>{usd(row.costUsd)}<small>{row.costKind === 'unknown' ? 'Cost not recorded' : row.costKind === 'reported' ? 'Report-observed' : 'Estimated'}</small></>}</td>
        <td>{row.status}{row.observedAccepted !== null && <small>{row.observedAccepted ? 'Report marks accepted' : 'Report does not mark accepted'}</small>}</td>
      </tr>)}</tbody></table></div> : <p className="usage-empty">No saved model requests, generation jobs or matching imported events yet.</p>}
      <details className="usage-evidence"><summary>Sources & exclusions ({summary.imports.length} reports)</summary>
        <p>Only exact project-ID matches count. Imported events are attached to the source selected at import; report project IDs do not establish screenplay revisions. Overlapping events are counted once; contradictory observations must be resolved before importing. Subscription fees, account quotas and report budget settings are not applied to this project.</p>
        {summary.imported.excludedProjects.length > 0 && <p>Excluded: {summary.imported.excludedProjects.map(row => `${row.project || '(unassigned)'} (${row.eventCount})`).join(', ')}.</p>}
        <p>Imported tokens: {number(summary.imported.inputTokens)} in · {number(summary.imported.outputTokens)} out · {number(summary.imported.cachedTokens)} cache reads · {number(summary.imported.cacheWriteTokens)} cache writes · {number(summary.imported.reasoningTokens)} reasoning. Token categories may overlap; they are not added together.</p><p>Cost per accepted task uses closed-task costs divided by report-marked accepted tasks. Open and unassigned tasks are excluded; any missing event cost keeps the metric unavailable.</p>
        {summary.imports.map(row => <div className="usage-source" key={row.id}><a href={`/api/blobs/${row.reportHash}`} download={`token-steward-${row.reportHash.slice(0, 12)}.json`}>Download retained report</a><span>Generated {when(row.generatedAt)} · imported {when(row.importedAt)}</span><span>{number(row.matchedEventCount)} / {number(row.eventCount)} matching events</span><code className="usage-hash">{row.reportHash}</code></div>)}
        <code className="usage-hash">Project {project.id} · source {project.sourceHash ?? 'No screenplay'}</code>
      </details>
    </>}
  </section>;
}
