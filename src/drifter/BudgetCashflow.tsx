import { useMemo, useState } from 'react';
import { calculateBudgetCashflow, type BudgetObservation, type ProductionBudget } from '../../local/contracts/production-budget.mjs';

const amount = (value: string | null, currency: string) => value === null ? 'Unknown' : `${value} ${currency}`;
const monthLabel = (value: string | null) => value === null ? 'Undated' : new Date(`${value}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const PAGE = 24;

export default function BudgetCashflow({ budget, observations, onEditLine }: {
  budget: ProductionBudget; observations: BudgetObservation[]; onEditLine: (id: string) => void;
}) {
  const [currency, setCurrency] = useState(''), [page, setPage] = useState(0), [entriesPage, setEntriesPage] = useState(0);
  const result = useMemo(() => {
    try { return { report: calculateBudgetCashflow(budget, observations), error: '' }; }
    catch (error) { return { report: null, error: error instanceof Error ? error.message : 'Complete the edited fields to review cash flow.' }; }
  }, [budget, observations]);
  if (!result.report) return <p className="budget-note">Complete the edited fields to review cash flow: {result.error}</p>;
  const { currencies, entries } = result.report;
  const effectiveCurrency = currencies.some(group => group.currency === currency) ? currency : '';
  const rows = currencies.filter(group => !effectiveCurrency || group.currency === effectiveCurrency).flatMap(group => group.months.map(month => ({ ...month, currency: group.currency })));
  const visibleEntries = entries.filter(entry => !effectiveCurrency || entry.currency === effectiveCurrency);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / PAGE) - 1));
  const currentEntriesPage = Math.min(entriesPage, Math.max(0, Math.ceil(visibleEntries.length / PAGE) - 1));
  const undated = visibleEntries.filter(entry => entry.date === null).length;
  return <section className="budget-cashflow" aria-label="Project cash flow planning">
    <div className="budget-section-heading"><div><h4>Cash flow planning</h4><p className="budget-footnote">Whole project · expected commitments and incurred costs are separate. Actual payment status and financing are not tracked here.</p></div><label>Cash flow currency<select value={effectiveCurrency} onChange={event => { setCurrency(event.target.value); setPage(0); setEntriesPage(0); }}><option value="">All currencies separately</option>{currencies.map(group => <option key={group.currency}>{group.currency}</option>)}</select></label></div>
    <p className="budget-method-note">Expected dates come from each cost line’s payment plan. Incurred dates come from cost evidence; entry timestamps never supply them. {undated} entries are undated. Uncommitted estimates have no payment schedule.</p>
    {rows.length ? <><div className="budget-table-scroll"><table><caption className="budget-sr-only">Monthly expected commitments and incurred costs</caption><thead><tr><th>Period</th><th>Currency / credits</th><th>Expected outstanding</th><th>Incurred cost</th></tr></thead><tbody>{rows.slice(currentPage * PAGE, (currentPage + 1) * PAGE).map(row => <tr key={`${row.currency}:${row.month}`}><th scope="row">{monthLabel(row.month)}</th><td>{row.currency}</td><td>{row.commitmentCount ? amount(row.expectedCommitments, row.currency) : '—'}<small>{row.commitmentCount} outstanding commitments</small></td><td>{row.costCount ? amount(row.incurredCosts, row.currency) : '—'}{row.unknownIncurredCount > 0 && <small>{amount(row.knownIncurredCosts, row.currency)} known · {row.unknownIncurredCount} unknown</small>}<small>{row.costCount} cost entries · payment status unknown</small></td></tr>)}</tbody></table></div>{rows.length > PAGE && <div className="budget-pagination"><span>Periods {currentPage * PAGE + 1}–{Math.min((currentPage + 1) * PAGE, rows.length)} of {rows.length}</span><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous periods</button><button disabled={(currentPage + 1) * PAGE >= rows.length} onClick={() => setPage(currentPage + 1)}>Next periods</button></div>}</> : <p className="budget-empty">No outstanding commitments or actual costs yet. Open a cost line to add its vendor, outstanding amount and expected payment date.</p>}
    {visibleEntries.length > 0 && <><div className="budget-section-heading"><h4>Schedule and cost evidence</h4><span>Every entry counted once; no currency conversion</span></div><div className="budget-table-scroll"><table><caption className="budget-sr-only">Cash flow entries</caption><thead><tr><th>Date / classification</th><th>Work / vendor</th><th>Amount</th><th>Basis or evidence</th></tr></thead><tbody>{visibleEntries.slice(currentEntriesPage * PAGE, (currentEntriesPage + 1) * PAGE).map(entry => <tr key={entry.id}><th scope="row">{entry.date ?? 'Undated'}<small>{entry.kind === 'commitment' ? 'Expected outstanding' : 'Incurred cost · payment unknown'}</small></th><td><strong>{entry.label}</strong>{entry.kind === 'commitment' && <small>{entry.vendor || 'Vendor not supplied'}</small>}{entry.lineId && <button onClick={() => onEditLine(entry.lineId!)}>Open cost line</button>}</td><td>{amount(entry.amount, entry.currency)}</td><td className="budget-evidence-cell">{entry.evidence || 'Planning basis not supplied'}</td></tr>)}</tbody></table></div>{visibleEntries.length > PAGE && <div className="budget-pagination"><span>Entries {currentEntriesPage * PAGE + 1}–{Math.min((currentEntriesPage + 1) * PAGE, visibleEntries.length)} of {visibleEntries.length}</span><button disabled={currentEntriesPage === 0} onClick={() => setEntriesPage(currentEntriesPage - 1)}>Previous cash flow entries</button><button disabled={(currentEntriesPage + 1) * PAGE >= visibleEntries.length} onClick={() => setEntriesPage(currentEntriesPage + 1)}>Next cash flow entries</button></div>}</>}
  </section>;
}
