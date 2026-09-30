import { useEffect, useMemo, useRef, useState } from 'react';
import { addBudgetPortfolioProjects, BUDGET_PORTFOLIO_LIMITS, calculateBudgetPortfolio, exportBudgetPortfolio, parseProductionBudgetExport, type ProductionBudgetExport } from './budgetPortfolioModel';
import './usage-accounting.css';

type LoadedProject = { filename: string; byteLength: number; snapshot: ProductionBudgetExport };
const amount = (value: string | null) => value === null ? 'Unknown' : value;

export default function ProductionBudgetPortfolio() {
  const [projects, setProjects] = useState<LoadedProject[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [notice, setNotice] = useState(''), fileInput = useRef<HTMLInputElement>(null), serial = useRef(0);
  useEffect(() => () => { ++serial.current; }, []);
  const report = useMemo(() => calculateBudgetPortfolio(projects.map(project => project.snapshot)), [projects]);

  async function chooseFiles(files: File[]) {
    if (!files.length || busy) return;
    const attempt = ++serial.current; setBusy(true); setError(''); setNotice('');
    try {
      if (files.length + projects.length > BUDGET_PORTFOLIO_LIMITS.projects) throw new Error('Load at most 50 project budget exports at once.');
      if (files.some(file => file.size > BUDGET_PORTFOLIO_LIMITS.fileBytes)) throw new Error('Each budget export must be no larger than 8 MB.');
      if (files.reduce((sum, file) => sum + file.size, projects.reduce((sum, project) => sum + project.byteLength, 0)) > BUDGET_PORTFOLIO_LIMITS.totalBytes) throw new Error('This comparison can hold up to 64 MB of project exports. Remove exports before adding more.');
      const added: LoadedProject[] = [];
      for (const file of files) {
        let text: string;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
        catch { throw new Error(`${file.name}: choose a valid UTF-8 JSON export.`); }
        if (serial.current !== attempt) return;
        try { added.push({ filename: file.name, byteLength: file.size, snapshot: parseProductionBudgetExport(text) }); }
        catch (reason) { throw new Error(`${file.name}: ${reason instanceof Error ? reason.message : 'The export could not be verified.'}`); }
      }
      addBudgetPortfolioProjects(projects.map(project => project.snapshot), added.map(project => project.snapshot));
      if (serial.current === attempt) { setProjects([...projects, ...added]); setNotice(`${added.length} project export${added.length === 1 ? '' : 's'} loaded and recalculated.`); }
    } catch (reason) { if (serial.current === attempt) setError(reason instanceof Error ? reason.message : 'These project exports could not be read.'); }
    finally { if (serial.current === attempt) setBusy(false); }
  }
  function download() {
    setError('');
    try {
      const value = exportBudgetPortfolio(projects.map(project => project.snapshot));
      const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `qimovi-budget-comparison-${value.generatedAt.slice(0, 10)}.json`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice('Comparison JSON prepared with project snapshots and recalculated totals.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The comparison could not be exported.'); }
  }
  return <section className="usage-accounting" aria-label="All-project comparison" style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid #454138' }}>
    <div className="usage-heading"><div><h3>All-project comparison</h3><p>{report.projectCount} selected project export{report.projectCount === 1 ? '' : 's'} loaded.</p></div><button disabled={busy || projects.length === 0} onClick={download}>Download comparison JSON</button></div>
    <p className="usage-scope">Choose budget exports from the projects to compare. Each total is recalculated from its exported lines and observations. This view covers the selected snapshots; other workspaces and later changes are not loaded automatically.</p>
    <div className="usage-import"><div><h4>Add project budgets</h4><p>Up to 50 projects · 8 MB per JSON file. Remove a project's existing row to load a replacement export.</p></div>
      <input ref={fileInput} type="file" accept=".json,application/json" multiple disabled={busy} tabIndex={-1} aria-label="Project budget JSON exports" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void chooseFiles(files); }}/>
      <button disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? 'Reading budgets…' : 'Choose budget exports…'}</button>
    </div>
    {notice && <p className="usage-notice" role="status">{notice}</p>}{error && <p className="error-text" role="alert">{error}</p>}
    {projects.length > 0 && <>
      <div className="usage-ledger-heading"><h4>Loaded projects</h4><small>{report.gapCount} accounting gaps · {report.unpricedTargets} targets needing cost review</small></div>
      <div className="usage-table-scroll"><table><caption className="usage-sr-only">Explicitly selected project budget snapshots</caption><thead><tr><th scope="col">Project / export</th><th scope="col">Snapshot date</th><th scope="col">Coverage</th><th scope="col">Actions</th></tr></thead><tbody>{projects.map(project => <tr key={project.snapshot.budget.projectId}>
        <th scope="row"><strong>{project.snapshot.budget.title}</strong><small>{project.snapshot.budget.projectId}</small><small>{project.filename}</small>{project.snapshot.draft && <small>Includes draft edits</small>}<small>{project.snapshot.budget.sourceHash === null ? 'No frozen screenplay' : `Source ${project.snapshot.budget.sourceHash.slice(0, 12)}`}</small></th>
        <td>{new Date(project.snapshot.generatedAt).toLocaleString()}{project.snapshot.snapshotGeneratedAt && <small>Inventory observed {new Date(project.snapshot.snapshotGeneratedAt).toLocaleString()}</small>}</td><td>{project.snapshot.report.gaps.length} gaps<small>{project.snapshot.report.targets.filter(target => target.coverage !== 'PRICED').length} targets needing review</small></td>
        <td><button disabled={busy} aria-label={`Remove ${project.snapshot.budget.title} (${project.snapshot.budget.projectId}) from comparison`} onClick={() => { setProjects(previous => previous.filter(row => row.snapshot.budget.projectId !== project.snapshot.budget.projectId)); setError(''); setNotice('Project export removed from this comparison.'); }}>Remove</button></td>
      </tr>)}</tbody></table></div>
      {report.projectsWithoutCurrency.length > 0 && <p className="usage-note">{report.projectsWithoutCurrency.length} loaded project{report.projectsWithoutCurrency.length === 1 ? ' has' : 's have'} no cost currency recorded. Combined totals remain incomplete: {report.projectsWithoutCurrency.join(', ')}.</p>}
      {report.collisions.length > 0 && <div className="usage-review" role="alert"><h4>Shared receipts need allocation</h4><p>These receipt IDs appear in more than one project. Actual, forecast and variance totals for the affected currencies are withheld until the source project budgets allocate or reconcile the shared charges.</p><ul>{report.collisions.map(collision => <li key={`${collision.currency}:${collision.externalId}`}><strong>{collision.currency} · {collision.externalId}</strong> · {collision.projectIds.join(', ')}</li>)}</ul></div>}
      {report.totals.length > 0 ? <div className="usage-table-scroll"><table><caption className="usage-sr-only">Recalculated totals for the loaded project exports, grouped by currency</caption><thead><tr><th scope="col">Currency / projects</th><th scope="col">Estimate</th><th scope="col">Actual</th><th scope="col">Forecast</th><th scope="col">Variance</th></tr></thead><tbody>{report.totals.map(total => <tr key={total.currency}>
        <th scope="row"><strong>{total.currency}</strong><small>{total.projectCount} contributing projects</small></th>
        <td>{amount(total.estimate)}{total.estimate === null && <small>Known portion {total.knownEstimate}</small>}<small>{total.unknownEstimateCount} unknown estimates</small></td>
        <td>{total.actualState === 'NEEDS_ALLOCATION' ? 'Needs allocation' : amount(total.actual)}{total.actualState !== 'NEEDS_ALLOCATION' && total.actual === null && <small>Known portion {total.knownActual}</small>}<small>{total.unknownActualCount} unknown actuals</small></td>
        <td>{total.actualState === 'NEEDS_ALLOCATION' ? 'Needs allocation' : amount(total.forecast)}{total.actualState !== 'NEEDS_ALLOCATION' && total.forecast === null && <small>Known portion {total.knownForecast}</small>}</td>
        <td>{total.actualState === 'NEEDS_ALLOCATION' ? 'Needs allocation' : amount(total.variance)}</td>
      </tr>)}</tbody></table></div> : <p className="usage-empty">The loaded projects have no currency totals yet. Add cost lines in each project's budget and export again.</p>}
      <p className="usage-footnote">Amounts remain in their recorded currencies or provider credits. Unknown costs stay visible, and no exchange rate or shared-cost allocation is inferred. Imported snapshots are used only in this open comparison; download the JSON to retain the selection.</p>
    </>}
  </section>;
}
