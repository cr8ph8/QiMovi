import { Fragment, useEffect, useId, useMemo, useState } from 'react';
import { BUDGET_LIMITS, type BudgetLine, type BudgetTarget, type ProductionBudget } from '../../local/contracts/production-budget.mjs';
import { deriveBudgetProductionWork, type BudgetProductionNextStep, type BudgetProductionWorkRow } from './budgetProductionWork';
import './budget-production-work.css';

export interface BudgetProductionWorkPanelProps {
  budget: ProductionBudget;
  targets: BudgetTarget[];
  disabled?: boolean;
  focusedTargetIds?: Set<string> | null;
  selectedLineId?: string | null;
  lockedLineIds?: Set<string>;
  onEditLine(lineId: string): void;
  onCreateCost(targetId: string): void;
  onLinkCost(targetId: string, lineId: string): void;
  onOpenTarget?(target: BudgetTarget): void;
}

const PAGE_SIZE = 30;
const COST_PAGE_SIZE = 20;
const NEXT: Record<BudgetProductionNextStep, { label: string; description: string }> = {
  allocate: { label: 'Allocate a cost', description: 'Link a cost that covers this work, or create a separate cost.' },
  plan: { label: 'Plan the work', description: 'Set the production method, lead and quantity basis in the cost plan.' },
  price: { label: 'Add rate & source', description: 'Enter a rate and its source for each linked cost.' },
  ready: { label: 'Plan & rate entered', description: 'Planning and rate fields are filled. Review the costs before finalizing the budget.' },
};
const KIND: Record<string, string> = { 'world-need': 'World requirement', 'breakdown-element': 'Script requirement', overhead: 'Department cost', shot: 'Shot', task: 'Production task', step: 'Workflow step', asset: 'Asset', generation: 'Generation', 'cost-line': 'Cost line' };
const label = (value: string) => value.replace(/[-_]/g, ' ').replace(/^./, character => character.toUpperCase());
const decimal = (value: string) => value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
const rate = (line: BudgetLine) => line.rate === null ? 'Not priced' : `${decimal(line.rate)} ${line.currency} / ${line.unit}`;
const quantity = (line: BudgetLine) => `${decimal(line.quantity)} ${line.unit}`;
const sourceQuantity = (target?: BudgetTarget) => typeof target?.sourceQuantity === 'number' && Number.isFinite(target.sourceQuantity)
  ? String(target.sourceQuantity) : typeof target?.sourceQuantity === 'string' && target.sourceQuantity.trim() ? target.sourceQuantity : null;
const coverageIds = (line: BudgetLine) => [line.targetId, ...(line.coveredTargetIds ?? [])];
const unique = (values: string[]) => [...new Set(values)];

export default function BudgetProductionWorkPanel({ budget, targets, disabled = false, focusedTargetIds = null, selectedLineId = null, lockedLineIds, onEditLine, onCreateCost, onLinkCost, onOpenTarget }: BudgetProductionWorkPanelProps) {
  const detailId = useId();
  const [scene, setScene] = useState(''), [department, setDepartment] = useState(''), [nextStep, setNextStep] = useState(''), [search, setSearch] = useState('');
  const [page, setPage] = useState(0), [selected, setSelected] = useState<string | null>(null);
  const [linkSearch, setLinkSearch] = useState(''), [linkLineId, setLinkLineId] = useState(''), [linkPage, setLinkPage] = useState(0), [costPage, setCostPage] = useState(0);
  const targetById = useMemo(() => new Map(targets.map(target => [target.id, target])), [targets]);
  const lineById = useMemo(() => new Map(budget.lines.map(line => [line.id, line])), [budget.lines]);
  const rows = useMemo(() => deriveBudgetProductionWork(budget, targets), [budget, targets]);
  const linesFor = (row: BudgetProductionWorkRow) => row.lineIds.map(id => lineById.get(id)).filter((line): line is BudgetLine => Boolean(line));
  const scopedRows = rows.filter(row => !focusedTargetIds || focusedTargetIds.has(row.targetId)
    || row.id.startsWith('line:') && linesFor(row).some(line => coverageIds(line).some(id => focusedTargetIds.has(id))));
  const linkedRowId = selectedLineId ? scopedRows.find(row => row.lineIds.includes(selectedLineId))?.id : undefined;
  useEffect(() => {
    if (!selectedLineId || !linkedRowId) return;
    setSelected(previous => previous && rows.some(row => row.id === previous && row.lineIds.includes(selectedLineId)) ? previous : linkedRowId);
  }, [selectedLineId, linkedRowId, rows]);
  useEffect(() => { setLinkSearch(''); setLinkLineId(''); setLinkPage(0); setCostPage(0); }, [selected]);

  const filtered = scopedRows.filter(row => {
    const lines = linesFor(row), target = targetById.get(row.targetId);
    return (!scene || (scene === 'project-and-shared' ? !row.sceneIds.length || row.shared || row.sceneIds.length > 1 : row.sceneIds.includes(scene)))
      && (!department || row.category === department || lines.some(line => line.category === department))
      && (!nextStep || row.nextStep === nextStep)
      && `${row.label} ${KIND[row.kind] ?? row.kind} ${target?.description ?? ''} ${lines.map(line => `${line.label} ${line.category} ${line.productionPlan?.departmentOwner ?? ''}`).join(' ')} ${row.sceneIds.map(id => targetById.get(id)?.label ?? id).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase());
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), currentPage = Math.min(page, pageCount - 1);
  const shown = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const departments = unique(scopedRows.flatMap(row => [row.category, ...linesFor(row).map(line => line.category)])).sort();
  const scenes = targets.filter(target => target.kind === 'scene');
  const projectTarget = targets.find(target => target.kind === 'project');
  const hasFilters = Boolean(scene || department || nextStep || search);
  const selectedRow = shown.find(row => row.id === selected);
  const selectedTarget = selectedRow ? targetById.get(selectedRow.targetId) : undefined;
  const selectedCosts = selectedRow ? linesFor(selectedRow) : [];
  const costPageCount = Math.max(1, Math.ceil(selectedCosts.length / COST_PAGE_SIZE)), currentCostPage = Math.min(costPage, costPageCount - 1);
  const candidates = selectedRow ? budget.lines.filter(line => !coverageIds(line).includes(selectedRow.targetId)
    && `${line.label} ${line.category} ${line.productionPlan?.departmentOwner ?? ''} ${targetById.get(line.targetId)?.label ?? line.targetId}`.toLowerCase().includes(linkSearch.trim().toLowerCase())) : [];
  const linkPageCount = Math.max(1, Math.ceil(candidates.length / COST_PAGE_SIZE)), currentLinkPage = Math.min(linkPage, linkPageCount - 1);
  const linkChoices = candidates.slice(currentLinkPage * COST_PAGE_SIZE, (currentLinkPage + 1) * COST_PAGE_SIZE);
  const selectedLink = candidates.find(line => line.id === linkLineId);
  const linkLocked = (line: BudgetLine) => Boolean(lockedLineIds?.has(line.id)) || (line.coveredTargetIds?.length ?? 0) >= BUDGET_LIMITS.coveredTargets;
  const canLink = !disabled && Boolean(selectedTarget && selectedLink && !linkLocked(selectedLink));

  function review(row: BudgetProductionWorkRow) { setSelected(value => value === row.id ? null : row.id); }
  function clearFilters() { setScene(''); setDepartment(''); setNextStep(''); setSearch(''); setPage(0); }
  function linkCost() {
    if (!canLink || !selectedRow || !selectedLink) return;
    onLinkCost(selectedRow.targetId, selectedLink.id);
    setLinkLineId('');
  }
  function context(row: BudgetProductionWorkRow) {
    if (!row.sceneIds.length) return 'Project work';
    const names = row.sceneIds.slice(0, 2).map(id => targetById.get(id)?.label ?? id);
    return `${names.join(' · ')}${row.sceneIds.length > 2 ? ` · +${row.sceneIds.length - 2} scenes` : ''}`;
  }

  return <section className="budget-production-work" aria-label="Production work plan">
    <div className="budget-production-work-heading"><h4>Plan production work</h4><p>Review requirements, link the costs that cover them, then plan quantities and rates.</p></div>
    <div className="budget-production-work-filters">
      <label>Scene<select aria-label="Production work scene" value={scene} onChange={event => { setScene(event.target.value); setPage(0); }}><option value="">All scenes & project</option><option value="project-and-shared">Project & shared work</option>{scenes.map(target => <option key={target.id} value={target.id}>{target.label}</option>)}</select></label>
      <label>Department<select aria-label="Production work department" value={department} onChange={event => { setDepartment(event.target.value); setPage(0); }}><option value="">All departments</option>{departments.map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
      <label>Next decision<select aria-label="Production work next decision" value={nextStep} onChange={event => { setNextStep(event.target.value); setPage(0); }}><option value="">All decisions</option>{Object.entries(NEXT).map(([value, step]) => <option key={value} value={value}>{step.label}</option>)}</select></label>
      <label>Find work<input type="search" aria-label="Find production work" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} placeholder="Work, scene or lead…"/></label>
    </div>
    <div className="budget-production-work-results"><p role="status">{filtered.length} work item{filtered.length === 1 ? '' : 's'}{focusedTargetIds ? ' in this focus' : ''}{hasFilters ? ' match your filters' : ''}</p>{hasFilters && <button type="button" onClick={clearFilters}>Clear work filters</button>}</div>
    {filtered.length === 0 ? <div className="budget-production-work-empty"><strong>{hasFilters ? 'No work matches these filters.' : focusedTargetIds ? 'No production work is linked to this focus yet.' : 'No production work to plan yet.'}</strong><p>{hasFilters ? 'Change a filter or clear the search to see more work.' : 'Saved script requirements, world production needs and authored cost lines appear here.'}</p>{!hasFilters && (projectTarget ? <button type="button" disabled={disabled} onClick={() => onCreateCost(projectTarget.id)}>Add project cost</button> : <p>Open Plan costs to enter production work in the cost sheet.</p>)}</div> : <>
      <div className="budget-table-scroll budget-production-work-table"><table><caption className="budget-sr-only">Production work, allocation and next planning decision. Shared costs remain separate ledger entries.</caption><thead><tr><th scope="col">Work</th><th scope="col">Department & lead</th><th scope="col">Quantity</th><th scope="col">Rate</th><th scope="col">Next decision</th></tr></thead><tbody>{shown.map(row => {
        const lines = linesFor(row), target = targetById.get(row.targetId), sourceCount = sourceQuantity(target), owners = unique(lines.map(line => line.productionPlan?.departmentOwner.trim() ?? '').filter(Boolean));
        const categories = unique(lines.length ? lines.map(line => line.category) : [row.category]);
        const expanded = selected === row.id;
        return <Fragment key={row.id}><tr className={expanded ? 'budget-work-selected' : undefined}>
          <th scope="row"><strong>{row.label}</strong><small>{KIND[row.kind] ?? label(row.kind)} · {context(row)}</small>{row.shared && <span className="budget-work-shared">Shares an existing cost</span>}</th>
          <td><span>{categories.slice(0, 2).map(label).join(' · ')}{categories.length > 2 ? ` +${categories.length - 2}` : ''}</span><small>{owners.slice(0, 2).join(' · ') || 'Lead unassigned'}{owners.length > 2 ? ` · +${owners.length - 2} leads` : ''}{owners.length > 0 && row.unassignedOwner ? ' · lead still needed' : ''}</small></td>
          <td>{lines.length === 1 ? <>{quantity(lines[0])}{(lines[0].runs !== '1' || lines[0].attempts !== '1') && <small>{decimal(lines[0].runs)} runs · {decimal(lines[0].attempts)} attempts</small>}</> : lines.length ? `${lines.length} separate cost quantities` : 'Not planned'}{sourceCount !== null && <small>Breakdown quantity: {sourceCount}</small>}</td>
          <td>{lines.length === 1 ? <>{rate(lines[0])}{lines[0].rate !== null && !lines[0].basis.trim() && <small>Rate source needed</small>}</> : lines.length ? <>{lines.length} separate rates<small>{row.unpriced ? 'Some pricing is incomplete' : 'Rate sources recorded'}</small></> : 'Not priced'}</td>
          <td><span className="budget-work-next">{NEXT[row.nextStep].label}</span><button type="button" aria-label={`${expanded ? 'Close' : 'Review'} ${row.label}`} aria-expanded={expanded} aria-controls={expanded ? detailId : undefined} onClick={() => review(row)}>{expanded ? 'Close details' : 'Review work'}</button></td>
        </tr>{expanded && <tr className="budget-work-detail-row"><td colSpan={5}><section id={detailId} className="budget-work-detail" aria-label={`Work details: ${row.label}`}>
          <div className="budget-work-detail-heading"><div><h5>{row.label}</h5><p>{NEXT[row.nextStep].description}</p></div>{target && onOpenTarget && <button type="button" disabled={disabled} onClick={() => onOpenTarget(target)}>Open source</button>}</div>
          {(typeof target?.description === 'string' && target.description.trim() || sourceCount !== null) && <div className="budget-work-source">{typeof target?.description === 'string' && target.description.trim() && <p>{target.description}</p>}{sourceCount !== null && <p><strong>Breakdown quantity: {sourceCount}.</strong> Set the cost quantity and its basis in the cost plan.</p>}</div>}
          {!target && <p className="budget-work-note">The original work target is unavailable. Existing costs remain available to review.</p>}
          <div className="budget-work-detail-columns"><div><h6>Linked costs · {selectedCosts.length}</h6>{selectedCosts.length ? <ul className="budget-work-linked-costs">{selectedCosts.slice(currentCostPage * COST_PAGE_SIZE, (currentCostPage + 1) * COST_PAGE_SIZE).map(line => <li key={line.id} className={line.id === selectedLineId ? 'budget-work-current-cost' : undefined}>
            <div><strong>{line.label}</strong><span>{label(line.category)} · {line.productionPlan?.departmentOwner.trim() || 'Lead unassigned'}</span><span>{quantity(line)} · {rate(line)}</span>{(line.runs !== '1' || line.attempts !== '1') && <span>{decimal(line.runs)} runs · {decimal(line.attempts)} attempts</span>}{line.productionPlan?.quantityBasis && <span>{line.productionPlan.quantityBasis}</span>}{line.coveredTargetIds?.length ? <small>Shared across {unique(coverageIds(line)).length} work items</small> : null}{lockedLineIds?.has(line.id) && <small>Allocation locked by recorded actuals</small>}</div><button type="button" disabled={disabled} onClick={() => onEditLine(line.id)}>Edit cost</button>
          </li>)}</ul> : <p className="budget-work-note">No cost is allocated to this work.</p>}
          {costPageCount > 1 && <div className="budget-work-cost-pagination"><span>Costs {currentCostPage * COST_PAGE_SIZE + 1}–{Math.min((currentCostPage + 1) * COST_PAGE_SIZE, selectedCosts.length)} of {selectedCosts.length}</span><button type="button" disabled={currentCostPage === 0} onClick={() => setCostPage(currentCostPage - 1)}>Previous linked costs</button><button type="button" disabled={currentCostPage + 1 === costPageCount} onClick={() => setCostPage(currentCostPage + 1)}>Next linked costs</button></div>}
          </div><div className="budget-work-allocation"><h6>Allocate work</h6><p>Use an existing cost when it covers this work. Create a separate cost for an additional expense.</p>
            <label>Find an existing cost<input type="search" value={linkSearch} disabled={disabled || !target} onChange={event => { setLinkSearch(event.target.value); setLinkPage(0); setLinkLineId(''); }} placeholder="Cost name, department or lead…"/></label>
            <label>Existing cost<select aria-label={`Existing cost for ${row.label}`} value={linkChoices.some(line => line.id === linkLineId) ? linkLineId : ''} disabled={disabled || !target || !linkChoices.length} onChange={event => setLinkLineId(event.target.value)}><option value="">{linkChoices.length ? 'Choose an existing cost' : 'No matching costs available'}</option>{linkChoices.map(line => <option key={line.id} value={line.id} disabled={linkLocked(line)}>{line.label} · {label(line.category)}{lockedLineIds?.has(line.id) ? ' · allocation locked' : linkLocked(line) ? ' · link limit reached' : ''}</option>)}</select></label>
            {linkPageCount > 1 && <div className="budget-work-cost-pagination"><span>{currentLinkPage * COST_PAGE_SIZE + 1}–{Math.min((currentLinkPage + 1) * COST_PAGE_SIZE, candidates.length)} of {candidates.length} costs</span><button type="button" disabled={currentLinkPage === 0} onClick={() => { setLinkPage(currentLinkPage - 1); setLinkLineId(''); }}>Previous costs</button><button type="button" disabled={currentLinkPage + 1 === linkPageCount} onClick={() => { setLinkPage(currentLinkPage + 1); setLinkLineId(''); }}>Next costs</button></div>}
            <div className="budget-work-allocation-actions"><button type="button" disabled={!canLink} onClick={linkCost}>Link existing cost</button><button type="button" disabled={disabled || !target} onClick={() => onCreateCost(row.targetId)}>Create separate cost</button></div>
            <p className="budget-work-note">A shared cost counts once in the project ledger. Work views are not added together.</p>
          </div></div>
        </section></td></tr>}</Fragment>;
      })}</tbody></table></div>
      <nav className="budget-work-pagination" aria-label="Production work pages"><span>{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length} work items</span><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous work</button><button type="button" disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>Next work</button></nav>
    </>}
  </section>;
}
