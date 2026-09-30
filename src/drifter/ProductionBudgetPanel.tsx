import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { BUDGET_CATEGORIES, BUDGET_LIMITS, applyBudgetAssetScope, budgetAssetContext, appendBudgetActual, removeDraftBudgetActual, validateBudgetCommitmentTransition, calculateProductionBudget, validateProductionBudget, type BudgetActual, type BudgetLine, type BudgetTotals, type BudgetTarget, type ProductionBudget } from '../../local/contracts/production-budget.mjs';
import { productionBudgetApi, productionBudgetCsv, type ProductionBudgetApi, type ProductionBudgetResponse, type ProductionBudgetSave } from './productionBudgetApi';
import type { WorkspaceProject, WorkspaceRecord } from './types';
import ProductionBudgetPortfolio from './ProductionBudgetPortfolio';
import RetainedBudgetReferencePicker from './RetainedBudgetReferencePicker';
import type { BudgetFocusRequest } from './budgetNavigation';
import { applyBudgetReferenceTemplate, BUDGET_REFERENCE_LIMITS, parseBudgetReferenceTemplate, type BudgetReferenceTemplate } from './budgetReferenceTemplate';
import BudgetCashflow from './BudgetCashflow';
import BudgetScopePicker from './BudgetScopePicker';
import BudgetSharedWork from './BudgetSharedWork';
import BudgetProductionPlan from './BudgetProductionPlan';
import BudgetProductionWorkPanel from './BudgetProductionWorkPanel';
import BudgetAssetScopeEditor, { type AssetScopeEntry } from './BudgetAssetScopeEditor';
import BudgetWorkReviewPanel from './BudgetWorkReviewPanel';
import { summarizeBudgetWork, type BudgetOverlapCandidate } from './budgetWorkReview';
import { appendBudgetRows } from './budgetPlanEntry';
import BudgetPreservationStarter from './BudgetPreservationStarter';
import { appendPreservationBudgetLines } from './preservationBudget';
import './production-budget.css';

type BudgetView = { scope: string; response: ProductionBudgetResponse; baseline: ProductionBudget; budget: ProductionBudget };
type ActualForm = { lineId: string; targetId: string; currency: string; amount: string; kind: BudgetActual['kind']; status: BudgetActual['status']; evidence: string; externalId: string; observationId: string; costDate: string; commitmentApplied: string };
const kinds = ['project', 'scene', 'shot', 'asset', 'macro', 'step', 'generation', 'task', 'world', 'world-need', 'breakdown-element', 'overhead'];
const labels: Record<string, string> = { project: 'Project', scene: 'Scenes', shot: 'Shots', asset: 'Assets', macro: 'Macros', step: 'Macro steps', generation: 'Generations', task: 'Tasks', overhead: 'Departments', world: 'World & characters', 'world-need': 'World production needs', 'breakdown-element': 'Script breakdown elements' };
const decimal = (value: string) => value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
const money = (value: string | null | undefined, currency: string) => value === null || value === undefined ? 'Incomplete' : `${decimal(value)} ${currency}`;
const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const id = (prefix: string) => `${prefix}:${crypto.randomUUID()}`;
const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : 'The budget request could not be confirmed.';
const blankActual = (targetId = '', currency = 'USD'): ActualForm => ({ lineId: '', targetId, currency, amount: '', kind: 'charge', status: 'reported', evidence: '', externalId: '', observationId: '', costDate: '', commitmentApplied: '' });
const newLine = (targetId: string, currency = 'USD'): BudgetLine => ({ id: id('cost'), label: 'New cost', targetId, category: 'other', currency, unit: 'unit', quantity: '1', runs: '1', attempts: '1', rateLow: null, rate: null, rateHigh: null, remainingQuantity: null, committed: '0', basis: '', rateDate: null });
const emptyRate = { rate: '', basis: '', currency: '', quantity: '', runs: '', attempts: '', onlyUnpriced: true };
const PAGE_SIZE = 40;
const lineTargets = (line: BudgetLine) => [line.targetId, ...(line.coveredTargetIds ?? [])];
const emptyRows = { text: '', category: 'development' as BudgetLine['category'], currency: 'USD', basis: '' };
const sameSavedVersion = (before: WorkspaceRecord | null, after: WorkspaceRecord | null) => before === null ? after === null : after !== null && before.id === after.id && before.version === after.version && before.sha256 === after.sha256;

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function Total({ total }: { total: BudgetTotals }) {
  return <tr>
    <th scope="row">{total.currency}</th>
    <td><strong>{money(total.estimate, total.currency)}</strong>{total.estimate === null && <small>{money(total.knownEstimate, total.currency)} known</small>}<small>{money(total.estimateLow, total.currency)} – {money(total.estimateHigh, total.currency)}</small></td>
    <td><strong>{money(total.actual, total.currency)}</strong>{total.actual === null && <small>{money(total.knownActual, total.currency)} known</small>}<small>{money(total.reconciledActual, total.currency)} reconciled</small><small>{money(total.reportedActual, total.currency)} reported</small></td>
    <td>{money(total.committed, total.currency)}</td>
    <td><strong>{money(total.forecast, total.currency)}</strong>{total.forecast === null && <small>{money(total.knownForecast, total.currency)} known</small>}<small>{money(total.estimateToComplete, total.currency)} to complete</small></td>
    <td>{money(total.variance, total.currency)}<small>{total.unknownEstimateCount} unresolved estimates (lines and uncovered work) · {total.unknownActualCount} unknown actuals</small></td>
  </tr>;
}

export default function ProductionBudgetPanel({ project, records = [], open = true, onSaved, onDirtyChange, focusRequest, onOpenTarget, api = productionBudgetApi }: {
  project: WorkspaceProject; records?: WorkspaceRecord[]; open?: boolean; onSaved?: (record: WorkspaceRecord) => void;
  onDirtyChange?: (dirty: boolean) => void; api?: ProductionBudgetApi;
  focusRequest?: BudgetFocusRequest;
  onOpenTarget?: (target: BudgetTarget) => void;
}) {
  const scope = `${project.id}:${project.sourceHash}`;
  const taskId = useId();
  const inspectorRef = useRef<HTMLElement>(null);
  const referenceTools = useRef<HTMLDetailsElement>(null), bulkTools = useRef<HTMLDetailsElement>(null);
  const [value, setValue] = useState<BudgetView | null>(null);
  const [busy, setBusy] = useState<'load' | 'generate' | 'save' | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [scopeOpen, setScopeOpen] = useState(false);
  const [assetScopeEntry, setAssetScopeEntry] = useState<AssetScopeEntry | null>(null);
  const [rowsOpen, setRowsOpen] = useState(false), [rows, setRows] = useState(emptyRows);
  const [newerSaved, setNewerSaved] = useState<ProductionBudgetResponse | null>(null);
  const inventorySeen = useRef(''), wasOpen = useRef(false);
  const inventoryStamp = useMemo(() => JSON.stringify(records.filter(record => record.kind !== 'production-budget').map(record => [record.id, record.version, record.sha256]).sort((left, right) => String(left[0]).localeCompare(String(right[0])))), [records]);
  const [tab, setTab] = useState<'work' | 'lines' | 'coverage' | 'actuals' | 'cashflow'>('work');
  const [workSelection, setWorkSelection] = useState<{ label: string; targetIds?: string[]; lineIds?: string[]; reviewKey?: 'requirementTargetIds' | 'libraryAssetTargetIds' | 'otherWorkTargetIds' } | null>(null);
  const [kind, setKind] = useState(''), [category, setCategory] = useState(''), [search, setSearch] = useState(''), [unpriced, setUnpriced] = useState(false);
  const [selected, setSelected] = useState<string | null>(null), [page, setPage] = useState(0);
  const [bulk, setBulk] = useState(emptyRate), [actual, setActual] = useState<ActualForm>(blankActual());
  const [actualBaseline, setActualBaseline] = useState<ActualForm>(blankActual());
  const [focusTargetId, setFocusTargetId] = useState(''), handledFocus = useRef('');
  const [reference, setReference] = useState<{ template: BudgetReferenceTemplate; filename: string } | null>(null);
  const [referenceCurrency, setReferenceCurrency] = useState(''), [referenceAccounts, setReferenceAccounts] = useState<string[]>([]), [referenceGroupTarget, setReferenceGroupTarget] = useState('');
  const [referenceTargets, setReferenceTargets] = useState<Record<string, string>>({}), [readingReference, setReadingReference] = useState(false);
  const referenceSerial = useRef(0), referenceInput = useRef<HTMLInputElement>(null);
  const clearReference = useCallback(() => { ++referenceSerial.current; setReference(null); setReferenceCurrency(''); setReferenceGroupTarget(''); setReferenceAccounts([]); setReferenceTargets({}); setReadingReference(false); }, []);
  const clearActual = useCallback((targetId = '', currency = 'USD') => { const next = blankActual(targetId, currency); setActual(next); setActualBaseline(next); }, []);
  const serial = useRef(0), currentScope = useRef(scope), valueRef = useRef(value);
  const pendingSave = useRef<{ fingerprint: string; request: ProductionBudgetSave } | null>(null);
  currentScope.current = scope; valueRef.current = value;
  const view = value?.scope === scope ? value : null;
  const dirty = Boolean(view && JSON.stringify(view.budget) !== JSON.stringify(view.baseline));
  const actualPending = JSON.stringify(actual) !== JSON.stringify(actualBaseline);
  const bulkPending = Boolean(bulk.rate || bulk.basis || bulk.currency || bulk.quantity || bulk.runs || bulk.attempts);
  const referencePending = Boolean(reference && (referenceCurrency || referenceGroupTarget || Object.values(referenceTargets).some(Boolean) || referenceAccounts.length !== reference.template.categories.length));
  const rowsPending = Boolean(rows.text || rows.basis);
  const savedAssetDecision = view?.budget.assetScopeDecisions?.find(row => row.targetId === assetScopeEntry?.targetId);
  const assetScopePending = Boolean(assetScopeEntry && (assetScopeEntry.usage !== (savedAssetDecision?.usage ?? 'unreviewed') || (assetScopeEntry.usage !== 'unreviewed' && assetScopeEntry.basis !== (savedAssetDecision?.basis ?? ''))));
  const unsaved = dirty || actualPending || bulkPending || referencePending || rowsPending || assetScopePending;
  const unsavedRef = useRef(unsaved); unsavedRef.current = unsaved;
  const alive = (attempt: number, captured: string) => serial.current === attempt && currentScope.current === captured;
  const targetMap = useMemo(() => new Map(view?.response.targets.map(target => [target.id, target]) ?? []), [view?.response.targets]);
  const focusedTargetMissing = Boolean(view && focusTargetId && !targetMap.has(focusTargetId));
  const focusedTargets = useMemo(() => {
    if (!focusTargetId) return null;
    const children = new Map<string, string[]>();
    for (const target of view?.response.targets ?? []) for (const parent of target.parentIds) { const siblings = children.get(parent) ?? []; siblings.push(target.id); children.set(parent, siblings); }
    const found = new Set<string>([focusTargetId]), queue = [focusTargetId];
    for (let index = 0; index < queue.length; index++) for (const child of children.get(queue[index]) ?? []) if (!found.has(child)) { found.add(child); queue.push(child); }
    return found;
  }, [focusTargetId, view?.response.targets]);
  const calculation = useMemo(() => {
    if (!view) return { report: null, error: '' };
    try { const report = calculateProductionBudget(view.budget, view.response.targets, view.response.report.observations); report.gaps.push(...(view.response.warnings ?? [])); return { report, error: '' }; }
    catch (reason) { return { report: null, error: errorMessage(reason) }; }
  }, [view]);
  const report = calculation.report;
  const effectiveTargets = useMemo(() => {
    if (!view || !report) return view?.response.targets ?? [];
    return applyBudgetAssetScope(view.budget, view.response.targets).targets;
  }, [view, report]);
  const workReview = useMemo(() => view && report ? summarizeBudgetWork(view.budget, effectiveTargets, report) : null, [view, report, effectiveTargets]);
  const scopeAsset = assetScopeEntry ? targetMap.get(assetScopeEntry.targetId) : undefined;
  const scopeEntryStale = Boolean(assetScopeEntry && scopeAsset && budgetAssetContext(scopeAsset) !== assetScopeEntry.contextKey);
  const selectedWorkTargets = useMemo(() => workSelection?.reviewKey && workReview ? new Set(workReview[workSelection.reviewKey]) : workSelection?.targetIds ? new Set(workSelection.targetIds) : null, [workSelection, workReview]);
  const selectedWorkLines = useMemo(() => workSelection?.lineIds ? new Set(workSelection.lineIds) : null, [workSelection]);
  const line = view?.budget.lines.find(row => row.id === selected) ?? null;
  const lineReports = useMemo(() => new Map(report?.lines.map(row => [row.id, row]) ?? []), [report]);
  const filteredLines = view?.budget.lines.filter(row => (!selectedWorkLines || selectedWorkLines.has(row.id)) && (!focusedTargets || lineTargets(row).some(id => focusedTargets.has(id))) && (!kind || lineTargets(row).some(id => targetMap.get(id)?.kind === kind)) && (!category || row.category === category) && (!unpriced || row.rate === null) && `${row.label} ${row.id} ${lineTargets(row).map(id => targetMap.get(id)?.label ?? id).join(' ')}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  const filteredTargets = report?.targets.filter(row => (!selectedWorkTargets || selectedWorkTargets.has(row.id)) && (!focusedTargets || focusedTargets.has(row.id)) && (!kind || row.kind === kind) && (!unpriced || row.coverage !== 'PRICED') && (!category || row.lineIds.some(lineId => view?.budget.lines.find(cost => cost.id === lineId)?.category === category)) && `${row.label} ${row.id}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  const filteredActuals = view?.budget.actuals.filter(row => {
    const cost = view.budget.lines.find(item => item.id === row.lineId), work = cost ? lineTargets(cost) : [row.targetId];
    return (!selectedWorkLines || selectedWorkLines.has(row.lineId)) && (!focusedTargets || work.some(id => focusedTargets.has(id))) && (!kind || work.some(id => targetMap.get(id)?.kind === kind))
      && (!category || cost?.category === category) && `${row.externalId} ${row.evidence} ${work.map(id => targetMap.get(id)?.label ?? id).join(' ')}`.toLowerCase().includes(search.toLowerCase());
  }) ?? [];
  const pageItems = tab === 'lines' ? filteredLines.length : tab === 'coverage' ? filteredTargets.length : filteredActuals.length;
  const needsPricing = view?.budget.lines.filter(row => row.rate === null).length ?? 0;
  const hasFilters = Boolean(kind || category || search || unpriced || workSelection);
  const pendingEntryHint = assetScopePending ? 'Apply the asset scope decision to the draft, or cancel its entry, before saving.' : rowsPending ? 'Add the pasted rows to the draft, or clear them, before saving.' : actualPending ? 'Add the entered actual to the draft, or clear its fields, before saving.' : bulkPending ? 'Apply the entered bulk rate, or clear it, before saving.' : referencePending ? 'Apply the historical reference, or clear it, before saving.' : '';
  const currentPage = Math.min(page, Math.max(0, Math.ceil(pageItems / PAGE_SIZE) - 1));
  const slice = <T,>(rows: T[]) => rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const projectTargetId = view?.response.targets.find(target => target.kind === 'project')?.id ?? '';
  const referenceTargetOptions = view?.response.targets.filter(target => target.id === projectTargetId || (target.kind === 'overhead' && target.id.startsWith('department:') && BUDGET_CATEGORIES.some(category => target.id === `department:${category}`) && target.parentIds.length === 1 && target.parentIds[0] === projectTargetId)) ?? [];
  const referenceReady = Boolean(reference && referenceAccounts.length && /^(?:[A-Z]{3}|HIGGSFIELD_CREDITS)$/.test(referenceCurrency) && referenceAccounts.every(account => referenceTargetOptions.some(target => target.id === referenceTargets[account])));
  const selectedActualLine = view?.budget.lines.find(row => row.id === actual.lineId);
  const actualTargetId = actual.targetId;
  const actualCurrency = actual.currency;
  const actualAllocationMismatch = Boolean(actual.lineId && (!selectedActualLine || selectedActualLine.targetId !== actual.targetId || selectedActualLine.currency !== actual.currency));
  const lineAllocationLocked = Boolean(line && (view?.budget.actuals.some(entry => entry.lineId === line.id) || (actualPending && actual.lineId === line.id)));
  const lineTarget = line ? targetMap.get(line.targetId) : undefined;
  const lockedLineIds = useMemo(() => new Set([...(view?.budget.actuals.map(entry => entry.lineId).filter((id): id is string => Boolean(id)) ?? []), ...(actualPending && actual.lineId ? [actual.lineId] : [])]), [view?.budget.actuals, actualPending, actual.lineId]);
  const observations = view?.response.report.observations.filter(row => row.kind !== 'quote' && row.currency === actualCurrency && !view.budget.actuals.some(entry => entry.observationId === row.id)) ?? [];

  useEffect(() => {
    setAssetScopeEntry(null); setWorkSelection(null); setSelected(null); setError(''); setNotice(''); setKind(''); setCategory(''); setSearch(''); setPage(0); setUnpriced(false); setBulk(emptyRate); clearActual(); setFocusTargetId(''); handledFocus.current = ''; pendingSave.current = null; clearReference(); setRows(emptyRows); setRowsOpen(false); setNewerSaved(null); inventorySeen.current = ''; wasOpen.current = false; setScopeOpen(false);
  }, [scope, clearActual, clearReference]);
  useEffect(() => {
    if (!open || valueRef.current?.scope === scope) return;
    const attempt = ++serial.current, controller = new AbortController(); let active = true;
    setBusy('load'); setError('');
    void api.load(project, controller.signal).then(response => {
      if (!active || !alive(attempt, scope)) return;
      setValue({ scope, response, baseline: response.budget, budget: response.budget });
      inventorySeen.current = `${scope}:${inventoryStamp}`; wasOpen.current = true;
      clearActual(response.targets.find(target => target.kind === 'project')?.id);
    }).catch(reason => { if (active && alive(attempt, scope) && !controller.signal.aborted) setError(errorMessage(reason)); })
      .finally(() => { if (active && alive(attempt, scope)) setBusy(null); });
    return () => { active = false; controller.abort(); };
  }, [open, scope, api, project, clearActual, inventoryStamp]);
  useEffect(() => {
    if (!view || !focusRequest || focusRequest.projectId !== project.id || focusRequest.sourceHash !== project.sourceHash) return;
    const identity = `${scope}:${focusRequest.nonce}`;
    if (handledFocus.current === identity) return;
    handledFocus.current = identity; setWorkSelection(null); setFocusTargetId(focusRequest.targetId ?? ''); setSelected(null); setKind(''); setCategory(''); setSearch(''); setUnpriced(false); setPage(0);
  }, [view, focusRequest, scope, project.id, project.sourceHash]);
  useEffect(() => () => { ++serial.current; ++referenceSerial.current; }, []);
  useEffect(() => { onDirtyChange?.(unsaved); }, [unsaved, onDirtyChange]);
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
  useEffect(() => { setPage(0); }, [tab, kind, category, search, unpriced, workSelection]);
  useEffect(() => {
    if (open && tab === 'lines' && selected) {
      inspectorRef.current?.scrollIntoView?.({ block: 'start' });
      inspectorRef.current?.focus({ preventScroll: true });
    }
  }, [open, tab, selected]);
  useEffect(() => {
    if (!open) { wasOpen.current = false; return; }
    if (!view || busy) return;
    const reopened = !wasOpen.current; wasOpen.current = true;
    const stamp = `${scope}:${inventoryStamp}`;
    if ((inventorySeen.current && inventorySeen.current !== stamp) || (reopened && !unsavedRef.current)) {
      inventorySeen.current = stamp;
      void refresh();
    }
    // Refresh is driven by workspace revisions or reopening, never by a keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope, inventoryStamp, busy, view?.scope]);


  function edit(next: ProductionBudget) {
    if (!view || busy) return;
    pendingSave.current = null; setNotice(''); setError(''); setValue({ ...view, budget: next });
  }
  function reviewAsset(targetId: string) {
    const target = targetMap.get(targetId);
    if (!view || busy || !target || target.kind !== 'asset') return;
    if (assetScopePending) { setError('Apply or cancel the current asset scope entry before reviewing another asset.'); setTab('coverage'); return; }
    const decision = view.budget.assetScopeDecisions?.find(row => row.targetId === targetId);
    setAssetScopeEntry({ targetId, usage: decision?.usage ?? 'unreviewed', basis: decision?.basis ?? '', contextKey: budgetAssetContext(target) });
    setError(''); setTab('coverage');
  }
  function applyAssetScope() {
    if (!view || busy || !assetScopeEntry || !scopeAsset || scopeEntryStale) return;
    if (assetScopeEntry.usage !== 'unreviewed' && !assetScopeEntry.basis.trim()) { setError('Explain the asset scope decision before applying it.'); return; }
    const decisions = (view.budget.assetScopeDecisions ?? []).filter(row => row.targetId !== assetScopeEntry.targetId);
    if (assetScopeEntry.usage !== 'unreviewed') decisions.push({ ...assetScopeEntry, usage: assetScopeEntry.usage });
    edit({ ...view.budget, assetScopeDecisions: decisions }); setAssetScopeEntry(null);
    setNotice('Asset scope added to the budget draft. Save budget to retain this decision. Existing costs are unchanged.');
  }
  function clearFilters() { setWorkSelection(null); setKind(''); setCategory(''); setSearch(''); setUnpriced(false); setPage(0); }
  function chooseTab(next: typeof tab) { setWorkSelection(null); setTab(next); }
  function reviewWork(label: string, targetIds: string[], reviewKey: 'requirementTargetIds' | 'libraryAssetTargetIds' | 'otherWorkTargetIds') {
    clearFilters(); setFocusTargetId(''); setSelected(null); setWorkSelection({ label, targetIds, reviewKey }); setTab('coverage');
  }
  function reviewOverlap(candidate: BudgetOverlapCandidate) {
    clearFilters(); setFocusTargetId(''); setSelected(null); setWorkSelection({ label: `Compare ${candidate.label}`, lineIds: candidate.lineIds, targetIds: candidate.targetIds }); setTab('lines');
  }
  function reviewPricing() { clearFilters(); setFocusTargetId(''); setSelected(view?.budget.lines.find(row => row.rate === null)?.id ?? null); setTab('lines'); setUnpriced(true); }
  function nextUnpriced() {
    const start = filteredLines.findIndex(row => row.id === selected);
    const candidates = [...filteredLines.slice(start + 1), ...filteredLines.slice(0, Math.max(0, start))];
    const next = candidates.find(row => row.rate === null && row.id !== selected);
    if (next) { setSelected(next.id); setPage(Math.floor(filteredLines.findIndex(row => row.id === next.id) / PAGE_SIZE)); }
  }
  function editLine(patch: Partial<BudgetLine>) {
    if (!view || !line || busy) return;
    if (lineAllocationLocked && (patch.targetId !== undefined || patch.currency !== undefined || patch.coveredTargetIds !== undefined)) { setError('This line has an actual or entered charge. Keep its work links and currency; create a separate line for another allocation.'); return; }
    const next = { ...line, ...patch };
    if (patch.targetId !== undefined && next.coveredTargetIds?.includes(next.targetId)) next.coveredTargetIds = next.coveredTargetIds.filter(id => id !== next.targetId);
    edit({ ...view.budget, lines: view.budget.lines.map(row => row.id === line.id ? next : row) });
  }
  function addLine(targetId = (focusTargetId || projectTargetId), nameFromWork = false) {
    if (!view || !targetId || busy) return;
    if (!targetMap.has(targetId)) { setError('Refresh inventory to find this linked target before adding its cost. Your draft is retained.'); return; }
    const allocationCategory = targetMap.get(targetId)?.category;
    const nextCategory: BudgetLine['category'] = BUDGET_CATEGORIES.includes(allocationCategory as BudgetLine['category']) ? allocationCategory as BudgetLine['category'] : BUDGET_CATEGORIES.includes(category as BudgetLine['category']) ? category as BudgetLine['category'] : 'other';
    const added = { ...newLine(targetId, view.budget.lines.find(row => row.currency !== 'HIGGSFIELD_CREDITS')?.currency ?? 'USD'), category: nextCategory, ...(nameFromWork ? { label: targetMap.get(targetId)!.label } : {}) };
    edit({ ...view.budget, lines: [...view.budget.lines, added] }); setSelected(added.id); clearFilters(); setTab('lines');
  }
  function openWorkCost(lineId: string) {
    clearFilters(); setSelected(lineId); setTab('lines');
  }
  function linkWorkCost(targetId: string, lineId: string) {
    if (!view || busy) return;
    const cost = view.budget.lines.find(row => row.id === lineId);
    if (!cost || !targetMap.has(targetId)) { setError('Refresh inventory before linking this work.'); return; }
    if (lockedLineIds.has(lineId)) { setError('This cost has an actual or entered charge. Its work links are locked; create a separate cost for new work.'); return; }
    if (lineTargets(cost).includes(targetId)) { openWorkCost(lineId); return; }
    if ((cost.coveredTargetIds?.length ?? 0) >= BUDGET_LIMITS.coveredTargets) { setError('This cost has reached its shared-work limit. Review its allocation before adding another link.'); return; }
    edit({ ...view.budget, lines: view.budget.lines.map(row => row.id === lineId ? { ...row, coveredTargetIds: [...(row.coveredTargetIds ?? []), targetId] } : row) });
    setNotice(`Linked ${targetMap.get(targetId)!.label} to ${cost.label} in this draft. The expense still counts once. Save budget to retain the link.`);
  }
  function recordLineCost() {
    if (!line || busy) return;
    if (actualPending) { setNotice('Finish or clear your current spending entry before starting another.'); setTab('actuals'); return; }
    const next = { ...blankActual(line.targetId, line.currency), lineId: line.id };
    setActual(next); setActualBaseline(next); clearFilters(); setTab('actuals');
  }
  async function refresh() {
    if (busy) return;
    const captured = scope, attempt = ++serial.current; setBusy('load'); setError(''); setNotice('');
    try {
      const response = await api.load(project);
      if (!alive(attempt, captured)) return;
      const latest = valueRef.current?.scope === captured ? valueRef.current : null;
      inventorySeen.current = `${captured}:${inventoryStamp}`;
      if (latest && !sameSavedVersion(latest.response.record, response.record)) {
        if (unsavedRef.current) {
          setNewerSaved(response);
          throw new Error('A newer budget was saved in another window. Your draft and entered fields are retained. Export your draft, or choose to discard it and load the saved version below.');
        }
        setValue({ scope: captured, response, baseline: response.budget, budget: response.budget });
        setSelected(null); setNewerSaved(null); pendingSave.current = null;
        clearActual(response.targets.find(target => target.kind === 'project')?.id);
        setNotice(`Loaded the current saved budget${response.record ? ` · version ${response.record.version}` : ''}.`);
      } else if (latest) {
        setValue({ ...latest, response }); setNewerSaved(null);
        setNotice('Inventory and observed costs refreshed. Your draft and entered fields are retained; no cost lines were added.');
      } else {
        setValue({ scope: captured, response, baseline: response.budget, budget: response.budget }); setSelected(null); clearActual(response.targets.find(target => target.kind === 'project')?.id);
      }
    } catch (reason) { if (alive(attempt, captured)) setError(errorMessage(reason)); }
    finally { if (alive(attempt, captured)) setBusy(null); }
  }
  async function generate(targetIds: string[]) {
    if (!view || busy) return;
    const captured = scope, attempt = ++serial.current; setBusy('generate'); setError(''); setNotice('');
    try {
      const response = await api.generate(project, view.budget, undefined, targetIds);
      if (!alive(attempt, captured)) return;
      const added = response.budget.lines.length - view.budget.lines.length;
      setValue({ ...view, response: { ...response, record: view.response.record }, budget: response.budget }); pendingSave.current = null; setScopeOpen(false);
      setNotice(added > 0 ? `${added} selected cost lines added to this draft. Review the editable quantities and rates, then save. Other inventory remains visible in Check coverage.` : 'No new cost lines were needed for this selection. Other recorded work remains visible in Check coverage.');
    } catch (reason) { if (alive(attempt, captured)) setError(errorMessage(reason)); }
    finally { if (alive(attempt, captured)) setBusy(null); }
  }
  async function save() {
    if (!view || !dirty || busy) return;
    const captured = scope, attempt = ++serial.current; setError(''); setNotice('');
    try {
      if (assetScopePending) throw new Error('Apply or cancel the asset scope entry before saving.');
      if (rowsPending) throw new Error('Add the pasted rows to the draft or clear them before saving.');
      if (actualPending) throw new Error('Add the entered actual to the draft or clear its fields before saving.');
      if (bulkPending) throw new Error('Apply the entered bulk rate or clear it before saving.');
      if (referencePending || readingReference) throw new Error('Apply or clear the historical reference before saving.');
      validateProductionBudget(view.budget, project);
      validateBudgetCommitmentTransition(view.response.record ? view.baseline : null, view.budget);
      const fingerprint = JSON.stringify({ scope, budget: view.budget, version: view.response.record?.version ?? null, inventoryHash: view.response.inventoryHash });
      if (pendingSave.current?.fingerprint !== fingerprint) pendingSave.current = { fingerprint, request: { budget: view.budget, expectedVersion: view.response.record?.version ?? null, requestId: id('budget-save'), inventoryHash: view.response.inventoryHash } };
      setBusy('save');
      const response = await api.save(project, pendingSave.current.request);
      if (!alive(attempt, captured)) return;
      setValue({ scope: captured, response, baseline: response.budget, budget: response.budget }); pendingSave.current = null;
      setNotice(`Budget saved locally${response.record ? ` · version ${response.record.version}` : ''}.`); if (response.record) onSaved?.(response.record);
    } catch (reason) { if (alive(attempt, captured)) setError(`${errorMessage(reason)} Your draft is retained; retry sends the same save request unless you edit it.`); }
    finally { if (alive(attempt, captured)) setBusy(null); }
  }
  function cancel() {
    if (!view || busy) return;
    setAssetScopeEntry(null); setValue({ ...view, budget: view.baseline }); pendingSave.current = null; setSelected(null); clearActual(projectTargetId); setBulk(emptyRate); clearReference(); setRows(emptyRows); setError(''); setNotice('Unsaved budget changes discarded.');
  }
  function loadNewerSaved() {
    if (!newerSaved || busy) return;
    setAssetScopeEntry(null); setValue({ scope, response: newerSaved, baseline: newerSaved.budget, budget: newerSaved.budget });
    setSelected(null); clearActual(newerSaved.targets.find(target => target.kind === 'project')?.id);
    setBulk(emptyRate); clearReference(); setRows(emptyRows); pendingSave.current = null;
    setNewerSaved(null); setError(''); setNotice('Loaded the newer saved budget. Your unsaved budget draft and entered fields were discarded.');
  }
  function addRows() {
    if (!view || busy) return;
    try {
      const department = `department:${rows.category}`;
      const targetId = focusTargetId || (targetMap.has(department) ? department : projectTargetId);
      if (!targetMap.has(targetId)) throw new Error('Refresh inventory to find the selected allocation.');
      const result = appendBudgetRows(view.budget, { ...rows, targetId }, () => id('cost'));
      edit(result.budget); setSelected(result.added[0].id); setRows({ ...emptyRows, category: rows.category, currency: rows.currency });
      clearFilters(); setTab('lines'); setPage(0); setNotice(`${result.added.length} cost rows added to the draft. Review them and save the budget.`);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function addPreservationCosts(starterIds: string[], currency: string) {
    if (!view || busy) return;
    try {
      if (!targetMap.has(projectTargetId)) throw new Error('Refresh inventory to find this project’s budget allocation.');
      const result = appendPreservationBudgetLines(view.budget, { starterIds, currency, targetId: projectTargetId });
      if (result.added.length) {
        edit(result.budget); setSelected(result.added[0].id); clearFilters(); setFocusTargetId(''); setTab('lines');
      }
      setNotice(result.added.length ? `${result.added.length} unpriced preservation costs added. Confirm quantities and rates, then save the budget.` : 'These preservation costs are already in this budget. Existing edits were kept.');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function applyBulk() {
    if (!view || busy) return;
    try {
      if (bulk.rate.trim() === '' || bulk.basis.trim() === '') throw new Error('Enter a unit rate and its source or assumption before applying it.');
      const ids = new Set(filteredLines.filter(row => !bulk.onlyUnpriced || row.rate === null).map(row => row.id));
      if (!ids.size) throw new Error('No matching lines need this rate. Change the filters or include already priced lines.');
      if (bulk.currency.trim() && view.budget.lines.some(row => ids.has(row.id) && row.currency !== bulk.currency.trim().toUpperCase() && (view.budget.actuals.some(entry => entry.lineId === row.id) || (actualPending && actual.lineId === row.id)))) throw new Error('The bulk currency would change a line with an actual or entered charge. Keep those currencies and use separate cost lines.');
      const next = { ...view.budget, lines: view.budget.lines.map(row => ids.has(row.id) ? { ...row, rateLow: bulk.rate, rate: bulk.rate, rateHigh: bulk.rate, basis: bulk.basis.trim(), ...(bulk.currency.trim() ? { currency: bulk.currency.trim().toUpperCase() } : {}), ...(bulk.quantity.trim() ? { quantity: bulk.quantity.trim() } : {}), ...(bulk.runs.trim() ? { runs: bulk.runs.trim() } : {}), ...(bulk.attempts.trim() ? { attempts: bulk.attempts.trim() } : {}) } : row) };
      validateProductionBudget(next, project); edit(next); setBulk(emptyRate); setNotice(`Rate applied to ${ids.size} matching cost lines in this draft.`);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function addActual() {
    if (!view || busy) return;
    try {
      if (actualAllocationMismatch) throw new Error('The selected cost line changed. Reselect its allocation or clear the entered actual before adding it.');
      if (!actual.externalId.trim() || !actual.evidence.trim()) throw new Error('Enter a unique charge reference and evidence before adding an actual.');
      const entry: BudgetActual = { id: id('actual'), lineId: actual.lineId || null, targetId: actualTargetId, currency: actualCurrency.trim().toUpperCase(), amount: actual.amount.trim(), kind: actual.kind, status: actual.status, evidence: actual.evidence.trim(), externalId: actual.externalId.trim(), recordedAt: new Date().toISOString(), observationId: actual.observationId || null, ...(actual.costDate ? { costDate: actual.costDate } : {}), ...(actual.commitmentApplied.trim() ? { commitmentApplied: actual.commitmentApplied.trim() } : {}) };
      const next = appendBudgetActual(view.budget, entry);
      validateBudgetCommitmentTransition(view.response.record ? view.baseline : null, next);
      validateProductionBudget(next, project); calculateProductionBudget(next, view.response.targets, view.response.report.observations);
      edit(next); clearActual(projectTargetId, actualCurrency); setNotice('Actual added to this draft. Save the budget to retain its evidence and any commitment adjustment.');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function previewReference(template: BudgetReferenceTemplate, filename: string) {
    setReference({ template, filename }); setReferenceAccounts(template.categories.map(group => group.account)); setReferenceCurrency(''); setReferenceGroupTarget(''); setReferenceTargets({}); setError(''); setNotice('');
  }
  async function readReference(file: File) {
    if (!view || busy || referencePending) return;
    const captured = scope, attempt = ++referenceSerial.current;
    setReadingReference(true); setError(''); setNotice('');
    try {
      if (file.size > BUDGET_REFERENCE_LIMITS.fileBytes) throw new Error('Reference templates must be no larger than 2 MB.');
      const template = parseBudgetReferenceTemplate(await file.text());
      if (referenceSerial.current !== attempt || currentScope.current !== captured) return;
      previewReference(template, file.name);
    } catch (reason) { if (referenceSerial.current === attempt && currentScope.current === captured) setError(errorMessage(reason)); }
    finally { if (referenceSerial.current === attempt && currentScope.current === captured) setReadingReference(false); }
  }
  function applyReference() {
    if (!view || !reference || busy || readingReference || !referenceReady) return;
    try {
      const result = applyBudgetReferenceTemplate(view.budget, reference.template, { currency: referenceCurrency, targets: view.response.targets, targetByCategory: referenceTargets, categoryAccounts: referenceAccounts });
      if (result.addedLineIds.length) { edit(result.budget); setSelected(result.addedLineIds[0]); clearFilters(); setTab('lines'); setFocusTargetId(''); }
      clearReference(); setError(''); setNotice(`${result.addedLineIds.length} unpriced reference lines added to this draft; ${result.skippedLineIds.length} existing lines skipped. Review quantities and rates, then save the budget.`);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function exportBudget(format: 'json' | 'csv') {
    if (!view) return;
    try {
      const currentReport = calculateProductionBudget(view.budget, view.response.targets, view.response.report.observations);
      currentReport.gaps.push(...(view.response.warnings ?? []));
      const filename = `production-budget-${project.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      if (format === 'csv') download(`${filename}.csv`, productionBudgetCsv(view.budget, currentReport), 'text/csv;charset=utf-8');
      else download(`${filename}.json`, JSON.stringify({ ...view.response, budget: view.budget, report: currentReport, draft: dirty, generatedAt: new Date().toISOString(), snapshotGeneratedAt: view.response.generatedAt }, null, 2), 'application/json');
    } catch (reason) { setError(errorMessage(reason)); }
  }

  return <section className="production-budget" hidden={!open} aria-label="Production budget" aria-busy={Boolean(busy)}>
    <div className="budget-heading"><div><span className="budget-eyebrow">Planning & cost analysis</span><h3>Budget & production planning</h3><p>{project.title} · {project.sourceHash === null ? 'Project without a screenplay' : 'Current screenplay source'}</p></div><details className="budget-tools"><summary>Budget tools & exports</summary><div className="budget-actions"><button disabled={Boolean(busy)} onClick={() => void refresh()}>{busy === 'load' ? 'Reading…' : 'Refresh inventory'}</button><button disabled={!view || Boolean(busy) || readingReference} onClick={() => { setScopeOpen(true); chooseTab('lines'); }}>{busy === 'generate' ? 'Generating…' : 'Generate missing lines'}</button><button disabled={!view || Boolean(busy)} onClick={() => exportBudget('json')}>Export JSON</button><button disabled={!view || Boolean(busy)} onClick={() => exportBudget('csv')}>Export CSV</button></div><p>Generate unpriced lines from saved project work. Exports include the current draft; entered forms must first be added to it.</p></details></div>
    <p className="budget-scope">Turn story requirements into department work, a sourced estimate and actual costs. Currencies and provider credits stay separate; saving does not authorize spending.</p>
    {focusTargetId && <div className="budget-focus" role="status"><div><strong>{focusedTargetMissing ? 'Linked budget target needs review' : `Budget for ${targetMap.get(focusTargetId)?.label ?? 'linked work'}`}</strong><span>{focusedTargetMissing ? 'This target is not in the loaded inventory. Refresh to check its saved requirements; your draft and entered fields are retained.' : 'Lists include this target and its descendants. The summary remains the whole project.'}</span></div>{focusedTargetMissing && <button type="button" disabled={Boolean(busy)} onClick={() => void refresh()}>Refresh linked budget inventory</button>}<button type="button" onClick={() => setFocusTargetId('')}>Clear budget focus</button></div>}
    {error && <p role="alert" className="budget-error">{error}</p>}{notice && <p role="status" className="budget-notice">{notice}</p>}
    {newerSaved && <div className="budget-conflict"><p>Saved version {newerSaved.record?.version ?? 'new'} is available. Use Export JSON in Budget tools & exports to keep a copy of this draft before replacing it.</p><button type="button" disabled={Boolean(busy)} onClick={loadNewerSaved}>Discard my budget draft and load saved version</button></div>}
    {!view && !busy && <button onClick={() => void refresh()}>Retry loading budget</button>}
    {view && <>
      <div className="budget-toolbar"><div><strong>{unsaved ? 'Unsaved changes' : view.response.record ? 'Budget saved locally' : 'No budget saved yet'}</strong><span>{view.budget.lines.length} cost lines · {view.response.targets.length} linked work items</span></div><div className="budget-actions"><button className={dirty ? 'budget-primary' : undefined} disabled={!dirty || Boolean(busy) || readingReference} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : 'Save budget'}</button><button disabled={!unsaved || Boolean(busy)} onClick={cancel}>Cancel draft changes</button></div></div>
      {pendingEntryHint && <div className="budget-pending" role="group" aria-label="Unfinished budget entries"><p>{pendingEntryHint}</p><div className="budget-actions">{assetScopePending && <button type="button" onClick={() => chooseTab('coverage')}>Continue asset scope entry</button>}{rowsPending && <button type="button" onClick={() => { setTab('lines'); setRowsOpen(true); }}>Continue pasted rows</button>}{bulkPending && <button type="button" onClick={() => { setTab('lines'); if (bulkTools.current) bulkTools.current.open = true; }}>Continue bulk rate</button>}{actualPending && <button type="button" onClick={() => chooseTab('actuals')}>Continue spending entry</button>}{referencePending && <button type="button" onClick={() => { setTab('lines'); if (referenceTools.current) referenceTools.current.open = true; }}>Continue historical reference</button>}</div></div>}
      {report ? <>
        <div className="budget-total-brief" role="group" aria-label="Current project estimate">{report.totals.map(total => <div key={total.currency}><span>Estimate · {total.currency}</span><strong>{money(total.estimate, total.currency)}</strong>{total.estimate === null && <small>{money(total.knownEstimate, total.currency)} known</small>}<small>{view.budget.lines.filter(row => row.currency === total.currency && row.rate === null).length} cost lines need rates · {total.unknownActualCount} unknown actuals</small></div>)}{report.gaps.length > 0 && <button type="button" onClick={() => chooseTab('coverage')}>Review production cost coverage</button>}</div>
        <details className="budget-totals-detail"><summary>Totals, ranges & forecast</summary>
        {report.totals.length > 0 ? <div className="budget-table-scroll budget-summary"><table><caption className="budget-sr-only">Budget totals by currency</caption><thead><tr><th scope="col">Currency</th><th scope="col">Estimate · low to high</th><th scope="col">Actual cost</th><th scope="col">Outstanding</th><th scope="col">Forecast</th><th scope="col">Forecast − estimate</th></tr></thead><tbody>{report.totals.map(total => <Total key={total.currency} total={total}/>)}</tbody></table></div> : <p className="budget-empty">Generate cost lines from project records, then supply rates to build the estimate.</p>}
        <p className="budget-footnote">Missing prices stay unknown. Known subtotals exclude missing amounts. Forecast = actuals + outstanding commitments + remaining cost. Positive variance is above the estimate.</p>

        </details>
      </> : <p className="budget-note">Complete the edited fields to update totals: {calculation.error}</p>}
      <nav className="budget-nav" aria-label="Budget tasks"><button type="button" aria-pressed={tab === 'work'} aria-controls={`${taskId}-work`} onClick={() => chooseTab('work')}>Plan production</button><button type="button" aria-pressed={tab === 'lines'} aria-controls={`${taskId}-lines`} onClick={() => chooseTab('lines')}>Plan costs <span>{view.budget.lines.length}</span></button><button type="button" aria-pressed={tab === 'coverage'} aria-controls={`${taskId}-coverage`} onClick={() => chooseTab('coverage')}>Check coverage <span>{view.response.targets.length}</span></button><button type="button" aria-pressed={tab === 'actuals'} aria-controls={`${taskId}-actuals`} onClick={() => chooseTab('actuals')}>Record spending <span>{view.budget.actuals.length}</span></button><button type="button" aria-pressed={tab === 'cashflow'} aria-controls={`${taskId}-cashflow`} onClick={() => chooseTab('cashflow')}>Cash flow</button></nav>
      <section className="budget-task-context" aria-label="Budget next steps">
        {tab === 'work' && <><h4>What needs to be made?</h4><p>Start with the script breakdown and story world. Link each requirement to a cost, name the responsible lead, then explain the quantity and rate.</p></>}
        {tab === 'lines' && <><h4>{view.budget.lines.length ? 'Build the cost of the work' : 'Start with your project'}</h4><p>List each department’s work, then enter quantities and a current rate with its source. Rates stay blank until supplied.</p>{needsPricing > 0 && <button type="button" disabled={Boolean(busy)} onClick={reviewPricing}>Review all unpriced lines</button>}{!view.budget.lines.length && <button type="button" className="budget-primary" disabled={Boolean(busy) || readingReference} onClick={() => { setScopeOpen(true); chooseTab('lines'); }}>Create lines from project work</button>}<details><summary>What goes into an estimate?</summary><p>A cost line describes work and its unit: for example, crew days or equipment rental days. Here, the estimate multiplies quantity × runs × attempts × rate. Keep runs and attempts at 1 when the quantity already covers the whole job. A quoted rate or stated assumption explains the price; an unknown price stays incomplete.</p></details></>}
        {tab === 'coverage' && <><h4>Check for work missing from the plan</h4><p>Match costs to the scenes, shots, assets and departments recorded in this project. Add manual lines for work that is not in those records.</p><details><summary>What does budget coverage tell me?</summary><p>Coverage asks whether recorded work has cost lines and prices. Shared costs count once in project totals, so do not add shot or asset subtotals together. Priced records alone do not establish that the whole production is budgeted or approved.</p></details></>}
        {tab === 'actuals' && <><h4>Record costs with their evidence</h4><p>Enter a charge or refund, connect it to the work, and retain its invoice, receipt or statement reference.</p><details><summary>Actual cost, commitment or quote?</summary><p>An actual is a cost incurred. A commitment is work committed but not yet recorded as actual cost. A quote supplies pricing context. Link an imported event when it represents the same charge to avoid counting it twice; recording a cost does not establish payment.</p></details></>}
        {tab === 'cashflow' && <><h4>Review when costs are expected</h4><p>Compare expected dates for outstanding commitments with dates from incurred-cost evidence. Add or correct dates by opening the cost line.</p><details><summary>How should I read this schedule?</summary><p>Expected commitment dates are planning information. Incurred dates come from the evidence, and missing dates stay undated. This schedule does not track financing, bank balances or whether an invoice has been paid.</p></details></>}
      </section>
      <div hidden={tab === 'cashflow' || tab === 'work'}><div className="budget-filters"><label>Find<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={tab === 'actuals' ? 'Reference or evidence' : 'Name or target ID'}/></label><label>Target type<select value={kind} onChange={event => setKind(event.target.value)}><option value="">All targets</option>{kinds.map(item => <option key={item} value={item}>{labels[item]}</option>)}</select></label><label>Cost category<select value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{BUDGET_CATEGORIES.map(item => <option key={item} value={item}>{label(item)}</option>)}</select></label>{tab !== 'actuals' && <label className="budget-checkbox"><input type="checkbox" checked={unpriced} onChange={event => setUnpriced(event.target.checked)}/>Needs pricing</label>}</div>
      <div className="budget-results"><span>{workSelection && <strong>{workSelection.label} · </strong>}{pageItems} {tab === 'lines' ? 'cost lines' : tab === 'coverage' ? 'inventory targets' : 'ledger entries'}{focusTargetId ? ' in this focus' : ' across the project'}{hasFilters ? ' match your filters' : ''}</span>{hasFilters && <button type="button" onClick={clearFilters}>Clear filters</button>}</div></div>
      <div id={`${taskId}-cashflow`} hidden={tab !== 'cashflow'}><BudgetCashflow budget={view.budget} observations={view.response.report.observations} onEditLine={lineId => { clearFilters(); setFocusTargetId(''); setSelected(lineId); setTab('lines'); }}/></div>
      <div id={`${taskId}-work`} hidden={tab !== 'work'}><BudgetProductionWorkPanel key={scope} budget={view.budget} targets={effectiveTargets} disabled={Boolean(busy)} focusedTargetIds={focusedTargets} selectedLineId={selected} lockedLineIds={lockedLineIds} onEditLine={openWorkCost} onCreateCost={targetId => addLine(targetId, true)} onLinkCost={linkWorkCost} onOpenTarget={onOpenTarget}/></div>
      <section id={`${taskId}-lines`} hidden={tab !== 'lines'} aria-label="Plan costs">
        <BudgetPreservationStarter key={scope} lines={view.budget.lines} disabled={Boolean(busy) || !projectTargetId} onAdd={addPreservationCosts}/>
        {scopeOpen && <BudgetScopePicker key={scope} targets={effectiveTargets} lines={view.budget.lines} disabled={Boolean(busy)} onGenerate={targetIds => void generate(targetIds)} onCancel={() => setScopeOpen(false)}/>}
        <details className="budget-reference-tools" ref={referenceTools}><summary>Reuse a historical budget structure</summary>
      <div className="budget-reference-launch"><div><strong>Historical budget references</strong><p>Reuse an account structure, then price it for this project.</p></div><button type="button" disabled={Boolean(busy) || readingReference || referencePending} onClick={() => referenceInput.current?.click()}>{readingReference ? 'Reading reference…' : 'Open historical reference'}</button><input ref={referenceInput} hidden type="file" accept=".json,application/json" aria-label="Historical reference JSON" disabled={Boolean(busy) || readingReference || referencePending} onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) void readReference(file); }}/></div>
      <RetainedBudgetReferencePicker project={project} records={records} disabled={Boolean(busy) || readingReference || referencePending} onLoaded={template => previewReference(template, 'Retained Library reference')}/>
      {readingReference && <button type="button" onClick={clearReference}>Cancel reference read</button>}
      {reference && <section className="budget-reference" aria-label="Historical reference preview"><div className="budget-section-heading"><div><span className="budget-eyebrow">Historical reference · preview</span><h4>{reference.template.name}</h4></div><button type="button" disabled={Boolean(busy)} onClick={clearReference}>Clear historical reference</button></div><p>{reference.template.sourceProject} · observed {reference.template.observedOn} · {reference.filename}</p><p className="budget-footnote">Source SHA-256: {reference.template.sourceSha256}. This reference is unapproved and its original currency is unknown. Current quantities, rates and actuals will not be copied.</p>
        <fieldset disabled={Boolean(busy) || readingReference}><div className="budget-reference-setup"><label>Current reference currency<input value={referenceCurrency} onChange={event => setReferenceCurrency(event.target.value.trim().toUpperCase())} placeholder="Choose USD, CAD, EUR…"/></label><label>Assign selected groups to<select value={referenceGroupTarget} onChange={event => setReferenceGroupTarget(event.target.value)}><option value="">Choose project or department</option>{referenceTargetOptions.map(target => <option value={target.id} key={target.id}>{target.label} · {target.kind}</option>)}</select></label><button type="button" disabled={!referenceGroupTarget || !referenceAccounts.length} onClick={() => setReferenceTargets(current => ({ ...current, ...Object.fromEntries(referenceAccounts.map(account => [account, referenceGroupTarget])) }))}>Assign selected groups</button></div>
          <div className="budget-table-scroll budget-reference-groups"><table><caption className="budget-sr-only">Reference account mapping</caption><thead><tr><th scope="col">Include</th><th scope="col">Historical account / rows</th><th scope="col">Current allocation</th></tr></thead><tbody>{reference.template.categories.map(group => { const rows = reference.template.lineItems.filter(row => row.categoryAccount === group.account); const included = referenceAccounts.includes(group.account); return <tr key={group.account}><td><input type="checkbox" aria-label={`Include reference group ${group.account}`} checked={included} onChange={event => setReferenceAccounts(current => event.target.checked ? [...current, group.account] : current.filter(account => account !== group.account))}/></td><th scope="row"><strong>{group.account} · {group.label}</strong><small>{rows.length} unpriced rows · source page {group.sourcePage}</small><details><summary>Review {rows.length} source rows</summary><ul>{rows.map(row => <li key={row.id}>{row.account ?? 'Unassigned'} · {row.description}</li>)}</ul></details></th><td><label><span className="budget-sr-only">{`Allocate reference group ${group.account}`}</span><select value={referenceTargets[group.account] ?? ''} disabled={!included} onChange={event => setReferenceTargets(current => ({ ...current, [group.account]: event.target.value }))}><option value="">Choose project or department</option>{referenceTargetOptions.map(target => <option value={target.id} key={target.id}>{target.label} · {target.kind}</option>)}</select></label></td></tr>; })}</tbody></table></div>
          <div className="budget-reference-notes"><div><strong>Reference rules</strong><ul>{reference.template.rules.map((rule, index) => <li key={index}>{rule}</li>)}</ul></div><div><strong>Questions to resolve</strong><ul>{reference.template.assumptionsToResolve.map((note, index) => <li key={index}>{note}</li>)}</ul></div></div>
          <div className="budget-actions"><button type="button" className="budget-primary" disabled={!referenceReady} onClick={applyReference}>Add unpriced lines to draft</button><span className="budget-footnote">Choose the current currency and allocation for each included group. Applying keeps existing costs and actuals; Save budget retains the draft.</span></div>
        </fieldset></section>}
        </details>
        <div className="budget-section-heading"><h4>Cost lines</h4><div className="budget-actions"><button type="button" aria-expanded={rowsOpen} onClick={() => setRowsOpen(!rowsOpen)}>Paste budget rows</button><button disabled={Boolean(busy) || !projectTargetId || focusedTargetMissing} onClick={() => addLine()}>Add cost line</button></div></div>
        {(rowsOpen || rowsPending) && <section className="budget-row-entry" aria-label="Paste budget rows"><h4>Build a department budget</h4><p>Paste spreadsheet rows with four columns: Description, Quantity, Unit, Rate. Separate columns with tabs and costs with new lines. A description alone starts an unpriced line with 1 item; runs and attempts start at 1.</p><fieldset disabled={Boolean(busy)}><div className="budget-field-grid"><label>Department for pasted rows<select value={rows.category} onChange={event => setRows({ ...rows, category: event.target.value as BudgetLine['category'] })}>{BUDGET_CATEGORIES.map(item => <option key={item} value={item}>{label(item)}</option>)}</select></label><label>Currency for pasted rows<input value={rows.currency} onChange={event => setRows({ ...rows, currency: event.target.value.toUpperCase() })}/></label><label className="budget-wide">Rate basis for pasted rows<input value={rows.basis} onChange={event => setRows({ ...rows, basis: event.target.value })} placeholder="Required when a row includes a rate"/></label><label className="budget-wide">Budget rows<textarea value={rows.text} onChange={event => setRows({ ...rows, text: event.target.value })} rows={5} placeholder={'Screenplay revisions\t2\tdays\t\nCasting sessions\t3\tsessions\t'}/></label></div><p>{focusTargetId ? `Allocation: ${targetMap.get(focusTargetId)?.label ?? 'Refresh the linked target'}.` : 'Rows are allocated to the selected department. Existing costs and actuals are retained.'}</p><div className="budget-actions"><button type="button" className="budget-primary" disabled={!rows.text.trim() || focusedTargetMissing} onClick={addRows}>Add pasted rows to draft</button><button type="button" onClick={() => setRows(emptyRows)}>Clear pasted rows</button></div></fieldset></section>}
        <details className="budget-bulk" ref={bulkTools}><summary>Apply a rate to matching lines</summary><p>A rate applies once per line’s unit. Filter to matching work before applying it.</p><fieldset disabled={Boolean(busy)}><div className="budget-field-grid"><label>Bulk unit rate<input inputMode="decimal" value={bulk.rate} onChange={event => setBulk({ ...bulk, rate: event.target.value })} placeholder="Unknown until supplied"/></label><label>Bulk currency<input value={bulk.currency} onChange={event => setBulk({ ...bulk, currency: event.target.value })} placeholder="Keep each line’s currency"/></label><label>Bulk quantity<input inputMode="decimal" value={bulk.quantity} onChange={event => setBulk({ ...bulk, quantity: event.target.value })} placeholder="Keep current"/></label><label>Bulk runs<input inputMode="decimal" value={bulk.runs} onChange={event => setBulk({ ...bulk, runs: event.target.value })} placeholder="Keep current"/></label><label>Bulk attempts per run<input inputMode="decimal" value={bulk.attempts} onChange={event => setBulk({ ...bulk, attempts: event.target.value })} placeholder="Keep current"/></label><label className="budget-wide">Bulk rate basis<input value={bulk.basis} onChange={event => setBulk({ ...bulk, basis: event.target.value })} placeholder="Quote, rate card, or clearly stated assumption"/></label></div><div className="budget-actions"><label className="budget-checkbox"><input type="checkbox" checked={bulk.onlyUnpriced} onChange={event => setBulk({ ...bulk, onlyUnpriced: event.target.checked })}/>Only unpriced lines</label><button disabled={Boolean(busy) || filteredLines.length === 0} onClick={applyBulk}>Apply rate to {filteredLines.filter(row => !bulk.onlyUnpriced || row.rate === null).length} lines</button><button type="button" disabled={Boolean(busy) || !bulkPending} onClick={() => setBulk(emptyRate)}>Clear entered bulk rate</button></div></fieldset></details>
        <div className={`budget-workspace${line ? ' has-inspector' : ''}`}><div className="budget-table-scroll"><table><caption className="budget-sr-only">Project cost lines</caption><thead><tr><th scope="col">Cost / target</th><th scope="col">Units × runs × attempts</th><th scope="col">Estimate</th><th scope="col">Actual / forecast</th><th scope="col">Edit</th></tr></thead><tbody>{slice(filteredLines).map(row => { const computed = lineReports.get(row.id); return <tr key={row.id} className={selected === row.id ? 'budget-selected' : ''}><th scope="row"><strong>{row.label}</strong><small>{targetMap.get(row.targetId)?.label ?? row.targetId}</small><small>{label(row.category)} · {targetMap.get(row.targetId)?.kind ?? 'unlinked'}{Boolean(row.coveredTargetIds?.length) && ` · Shared across ${1 + row.coveredTargetIds!.length} requirements`}</small></th><td>{row.quantity} × {row.runs} × {row.attempts}<small>{row.unit} · {row.rate === null ? 'Rate needed' : `${money(row.rate, row.currency)} each`}</small></td><td>{money(computed?.estimate, row.currency)}</td><td>{money(computed?.actual, row.currency)}<small>Forecast {money(computed?.forecast, row.currency)}</small></td><td><button aria-label={`Edit ${row.label}`} aria-pressed={selected === row.id} onClick={() => setSelected(row.id)}>Edit</button></td></tr>; })}</tbody></table>{filteredLines.length === 0 && <p className="budget-empty">{view.budget.lines.length === 0 ? 'No cost lines yet. Create lines from project work above, or add a cost manually.' : 'No cost lines match this view. Clear the filters or budget focus to see existing work.'}</p>}</div>
          {line && <aside className="budget-inspector" aria-label="Cost line editor" ref={inspectorRef} tabIndex={-1}><div className="budget-section-heading"><h4>Edit cost line</h4><button type="button" onClick={() => chooseTab('work')}>Back to production plan</button><button type="button" disabled={Boolean(busy)} onClick={recordLineCost}>Record a cost</button><button type="button" disabled={Boolean(busy) || !filteredLines.some(row => row.rate === null && row.id !== selected)} onClick={nextUnpriced}>Next unpriced line</button><button aria-label="Close cost line editor" onClick={() => setSelected(null)}>Close</button></div>{lineTarget && onOpenTarget && <button type="button" disabled={Boolean(busy)} onClick={() => onOpenTarget(lineTarget)}>Open linked work</button>}{lineAllocationLocked && <p className="budget-footnote">Work links and currency are locked because an actual or entered charge uses this line. Add a separate line for a different allocation.</p>}<p className="budget-footnote">Confirm the work covered by this line, its quantity and unit before pricing. Check related shots, assets and breakdown entries so a shared expense is allocated once.</p>{lineTarget && <details className="budget-line-source"><summary>Linked work &amp; planning assumptions</summary><p>{lineTarget.label} · {labels[lineTarget.kind] ?? lineTarget.kind}</p>{typeof lineTarget.description === 'string' && <p>{lineTarget.description}</p>}{lineTarget.sourceQuantity !== undefined && <p>Source breakdown quantity: {String(lineTarget.sourceQuantity)}. Confirm how it translates to paid units.</p>}<p>{line.basis || 'No pricing basis recorded. Generated units and quantities are editable planning defaults.'}</p></details>}<fieldset disabled={Boolean(busy)}><div className="budget-field-grid"><label className="budget-wide">Cost label<input value={line.label} onChange={event => editLine({ label: event.target.value })}/></label><label className="budget-wide">Cost target<select disabled={lineAllocationLocked} value={line.targetId} onChange={event => editLine({ targetId: event.target.value })}>{view.response.targets.map(target => <option key={target.id} value={target.id}>{target.label} · {target.kind}</option>)}</select></label><label>Category<select value={line.category} onChange={event => editLine({ category: event.target.value as BudgetLine['category'] })}>{BUDGET_CATEGORIES.map(item => <option key={item} value={item}>{label(item)}</option>)}</select></label></div></fieldset><BudgetProductionPlan line={line} disabled={Boolean(busy)} onChange={productionPlan => editLine({ productionPlan })}/><h5>Quantity & estimate</h5><fieldset disabled={Boolean(busy)}><div className="budget-field-grid"><label>Currency / credits<input disabled={lineAllocationLocked} value={line.currency} onChange={event => editLine({ currency: event.target.value.toUpperCase() })}/></label><label>Quantity<input inputMode="decimal" value={line.quantity} onChange={event => editLine({ quantity: event.target.value })}/></label><label>Unit<input value={line.unit} onChange={event => editLine({ unit: event.target.value })}/></label><label>Runs<input inputMode="decimal" value={line.runs} onChange={event => editLine({ runs: event.target.value })}/></label><label>Attempts per run<input inputMode="decimal" value={line.attempts} onChange={event => editLine({ attempts: event.target.value })}/></label><label>Low unit rate<input inputMode="decimal" value={line.rateLow ?? ''} onChange={event => editLine({ rateLow: event.target.value === '' ? null : event.target.value })} placeholder="Unknown"/></label><label>Base unit rate<input inputMode="decimal" value={line.rate ?? ''} onChange={event => editLine({ rate: event.target.value === '' ? null : event.target.value })} placeholder="Unknown"/></label><label>High unit rate<input inputMode="decimal" value={line.rateHigh ?? ''} onChange={event => editLine({ rateHigh: event.target.value === '' ? null : event.target.value })} placeholder="Unknown"/></label><label>Rate date<input type="date" value={line.rateDate ?? ''} onChange={event => editLine({ rateDate: event.target.value || null })}/></label><label className="budget-wide">Rate basis<textarea value={line.basis} onChange={event => editLine({ basis: event.target.value })} placeholder="Required for every supplied rate, including zero" rows={2}/></label><label>Outstanding commitment<input inputMode="decimal" value={line.committed} onChange={event => editLine({ committed: event.target.value })}/></label><label className="budget-wide">Vendor / payee<input value={line.paymentPlan?.vendor ?? ''} onChange={event => editLine({ paymentPlan: { vendor: event.target.value, expectedDate: line.paymentPlan?.expectedDate ?? null, basis: line.paymentPlan?.basis ?? '' } })} placeholder="Not supplied"/></label><label>Expected payment date<input type="date" value={line.paymentPlan?.expectedDate ?? ''} onChange={event => editLine({ paymentPlan: { vendor: line.paymentPlan?.vendor ?? '', expectedDate: event.target.value || null, basis: line.paymentPlan?.basis ?? '' } })}/></label><label className="budget-wide">Payment planning basis<textarea aria-label="Payment planning basis" value={line.paymentPlan?.basis ?? ''} onChange={event => editLine({ paymentPlan: { vendor: line.paymentPlan?.vendor ?? '', expectedDate: line.paymentPlan?.expectedDate ?? null, basis: event.target.value } })} rows={2} placeholder="Agreed terms or an explicit planning assumption"/><small>Applies only to the outstanding commitment. An expected date does not record a payment.</small></label><label>Remaining units<input inputMode="decimal" value={line.remainingQuantity ?? ''} onChange={event => editLine({ remainingQuantity: event.target.value === '' ? null : event.target.value })} placeholder="Calculate from estimate"/></label></div><p className="budget-footnote">Estimate = quantity × runs × attempts × rate. Remaining units include remaining runs and attempts, excluding work already covered by commitments. Leave blank to derive the remaining cost from the estimate.</p>{!view.budget.actuals.some(entry => entry.lineId === line.id) && <button className="budget-remove" disabled={Boolean(busy) || lineAllocationLocked} onClick={() => { edit({ ...view.budget, lines: view.budget.lines.filter(row => row.id !== line.id) }); setSelected(null); }}>Remove cost line</button>}</fieldset><BudgetSharedWork key={line.id} line={line} lines={view.budget.lines} targets={view.response.targets} disabled={Boolean(busy) || lineAllocationLocked} onChange={coveredTargetIds => editLine({ coveredTargetIds })}/></aside>}
        </div>
      </section>
      <section id={`${taskId}-coverage`} hidden={tab !== 'coverage'} aria-label="Check coverage">{workReview && <BudgetWorkReviewPanel key={scope} review={workReview} disabled={Boolean(busy)} onPricing={reviewPricing} onWork={reviewWork} onOverlap={reviewOverlap}/>} {report && report.gaps.length > 0 && <details className="budget-gaps"><summary>{report.gaps.length} coverage and cost issues need attention</summary><ul>{report.gaps.slice(0, 100).map((gap, index) => <li key={`${gap.code}:${gap.targetId}:${gap.lineId}:${index}`}><strong>{targetMap.get(gap.targetId ?? '')?.label ?? view.budget.lines.find(row => row.id === gap.lineId)?.label ?? gap.code}</strong><span>{gap.message}</span></li>)}</ul>{report.gaps.length > 100 && <p>{report.gaps.length - 100} additional issues are included in the exports.</p>}</details>}
<div className="budget-section-heading"><h4>Coverage of recorded work</h4><span>Shared costs count once in project totals.</span></div><div className="budget-table-scroll"><table><caption className="budget-sr-only">Inventory budget coverage</caption><thead><tr><th scope="col">Inventory target</th><th scope="col">Coverage</th><th scope="col">Estimate / per run</th><th scope="col">Actual / forecast</th><th scope="col">Action</th></tr></thead><tbody>{slice(filteredTargets).map(target => <tr key={target.id}><th scope="row"><strong>{target.label}</strong><small>{target.kind} · {target.lineIds.length} cost lines</small></th><td><span className={`budget-coverage budget-${target.coverage.toLowerCase()}`}>{target.budgetUsage === 'reference-only' ? 'Reference only' : target.budgetUsage === 'needs-review' ? 'Use changed · review again' : target.kind === 'asset' && !target.lineIds.length ? (target.budgetUsage === 'production' ? 'Production use · needs allocation' : 'Review production use') : target.coverage === 'PRICED' ? 'Priced' : target.coverage === 'PARTIAL' ? 'Partly priced' : 'Needs pricing'}</span></td><td>{target.totals.length ? target.totals.map(total => <div key={total.currency}>{money(total.estimate, total.currency)}{target.kind === 'macro' && <small>{money(total.perRunEstimate, total.currency)} per run</small>}</div>) : 'No estimate'}</td><td>{target.totals.map(total => <div key={total.currency}>{money(total.actual, total.currency)}<small>Forecast {money(total.forecast, total.currency)}</small></div>)}</td><td>{target.kind === 'asset' && <button type="button" disabled={Boolean(busy)} aria-label={`Review production use for ${target.label}`} onClick={() => reviewAsset(target.id)}>Review use</button>}<button disabled={Boolean(busy)} onClick={() => addLine(target.id)}>Add cost</button>{onOpenTarget && targetMap.has(target.id) && <button type="button" disabled={Boolean(busy)} aria-label={`Open linked work for ${target.label}`} onClick={() => onOpenTarget(targetMap.get(target.id)!)}>Open linked work</button>}</td></tr>)}</tbody></table>{filteredTargets.length === 0 && <p className="budget-empty">No inventory targets match these filters.</p>}</div>{assetScopeEntry && <BudgetAssetScopeEditor target={scopeAsset} entry={assetScopeEntry} disabled={Boolean(busy)} stale={scopeEntryStale} onChange={setAssetScopeEntry} onApply={applyAssetScope} onCancel={() => setAssetScopeEntry(null)}/>}</section>
      <section id={`${taskId}-actuals`} hidden={tab !== 'actuals'} aria-label="Record spending">
        <div className="budget-section-heading"><h4>Actual cost ledger</h4><span>Saved entries retain their evidence. Record corrections as separate charges or refunds.</span></div>
        {actualAllocationMismatch && <p role="alert" className="budget-error">The entered charge keeps its original target and currency. Reselect the changed cost line before adding it.</p>}<form className="budget-actual-form" onSubmit={event => { event.preventDefault(); addActual(); }}><fieldset disabled={Boolean(busy)}><legend>Add an actual</legend><div className="budget-field-grid"><label className="budget-wide">Link to cost line<select value={actual.lineId} onChange={event => { const chosen = view.budget.lines.find(row => row.id === event.target.value); setActual({ ...actual, lineId: event.target.value, targetId: chosen?.targetId ?? projectTargetId, currency: chosen?.currency ?? actual.currency, observationId: '', commitmentApplied: '' }); }}><option value="">Directly to a target</option>{view.budget.lines.map(row => <option key={row.id} value={row.id}>{row.label} · {row.currency}</option>)}</select></label><label className="budget-wide">Actual target<select disabled={Boolean(selectedActualLine)} value={actualTargetId} onChange={event => setActual({ ...actual, targetId: event.target.value, observationId: '' })}>{view.response.targets.map(target => <option key={target.id} value={target.id}>{target.label} · {target.kind}</option>)}</select></label><label>Amount<input inputMode="decimal" required value={actual.amount} onChange={event => setActual({ ...actual, amount: event.target.value })}/></label><label>Actual currency<input required disabled={Boolean(selectedActualLine)} value={actualCurrency} onChange={event => setActual({ ...actual, currency: event.target.value.toUpperCase(), observationId: '' })}/></label><label>Entry type<select value={actual.kind} onChange={event => setActual({ ...actual, kind: event.target.value as ActualForm['kind'], observationId: '', commitmentApplied: '' })}><option value="charge">Charge</option><option value="refund">Refund</option></select></label><label>Evidence status<select value={actual.status} onChange={event => setActual({ ...actual, status: event.target.value as ActualForm['status'] })}><option value="reported">Reported</option><option value="reconciled">Reconciled against invoice / statement</option></select></label><label>Incurred cost date<input aria-label="Incurred cost date" type="date" value={actual.costDate} onChange={event => setActual({ ...actual, costDate: event.target.value })}/><small>From the cost evidence. Leave blank if unknown.</small></label>{selectedActualLine && actual.kind === 'charge' && <label>Amount covered by commitment<input aria-label="Amount covered by commitment" inputMode="decimal" value={actual.commitmentApplied} onChange={event => setActual({ ...actual, commitmentApplied: event.target.value })} placeholder="0"/><small>Outstanding: {money(selectedActualLine.committed, selectedActualLine.currency)}. Enter the portion already included there to remove it once. Save commitment or quote changes before using this.</small></label>}<label className="budget-wide">Charge or correction reference<input required value={actual.externalId} onChange={event => setActual({ ...actual, externalId: event.target.value })} placeholder="Unique invoice, transaction, or refund reference"/></label><label className="budget-wide">Evidence<textarea required value={actual.evidence} rows={2} onChange={event => setActual({ ...actual, evidence: event.target.value })} placeholder="Invoice, receipt, statement, or recorded source"/></label><label className="budget-wide">Reconcile observed event<select aria-label="Reconcile observed event" disabled={actual.kind === 'refund'} value={actual.observationId} onChange={event => { const chosen = observations.find(row => row.id === event.target.value); setActual({ ...actual, observationId: event.target.value, amount: actual.amount || chosen?.amount || '' }); }}><option value="">Separate charge; no imported event replaced</option>{observations.map(row => <option key={row.id} value={row.id}>{row.label} · {targetMap.get(row.targetId)?.label ?? row.targetId} · {row.kind} · {money(row.amount, row.currency)}</option>)}</select><small>Link the same event to avoid counting its reported charge twice. Its target can be reassigned here. Refunds remain separate corrections.</small></label></div><div className="budget-actions"><button type="submit" className="budget-primary" disabled={actualAllocationMismatch}>Add actual to draft</button><button type="button" disabled={!actualPending || Boolean(busy)} onClick={() => clearActual(projectTargetId)}>Clear entered actual</button></div></fieldset></form>
        <div className="budget-table-scroll"><table><caption className="budget-sr-only">Actual costs and evidence</caption><thead><tr><th scope="col">Reference / target</th><th scope="col">Amount</th><th scope="col">Evidence</th><th scope="col">State</th></tr></thead><tbody>{slice(filteredActuals).map(entry => <tr key={entry.id}><th scope="row"><strong>{entry.externalId}</strong><small>{targetMap.get(entry.targetId)?.label ?? entry.targetId}</small><small>Entered {entry.recordedAt}</small><small>Incurred {entry.costDate ?? 'date unknown'}</small></th><td>{entry.kind === 'refund' ? '−' : ''}{money(entry.amount, entry.currency)}<small>{label(entry.kind)}</small></td><td className="budget-evidence-cell">{entry.evidence}{entry.observationId && <small>Reconciles {entry.observationId}</small>}{entry.commitmentApplied && <small>Replaced {money(entry.commitmentApplied, entry.currency)} of outstanding commitment</small>}</td><td>{label(entry.status)}{!view.baseline.actuals.some(saved => saved.id === entry.id) ? <><small>Unsaved</small><button disabled={Boolean(busy)} onClick={() => { try { edit(removeDraftBudgetActual(view.budget, entry.id)); } catch (reason) { setError(errorMessage(reason)); } }}>Remove unsaved actual</button></> : <small>Saved evidence</small>}</td></tr>)}</tbody></table>{filteredActuals.length === 0 && <p className="budget-empty">No manual actuals match these filters. Imported cost observations appear below.</p>}</div>
        {view.response.report.observations.length > 0 && <details className="budget-observations"><summary>Connected cost observations ({view.response.report.observations.length})</summary><p>Reported charges contribute to actuals until replaced by a linked ledger entry. Quotes and estimates remain observations. Showing up to 200 events; totals and exports include every retained event.</p><div className="budget-table-scroll"><table><caption className="budget-sr-only">Connected generation and usage costs</caption><thead><tr><th scope="col">Event</th><th scope="col">Amount</th><th scope="col">Classification</th></tr></thead><tbody>{view.response.report.observations.slice(0, 200).map(row => <tr key={row.id}><th scope="row">{row.label}<small>{targetMap.get(row.targetId)?.label ?? row.targetId}</small></th><td>{money(row.amount, row.currency)}</td><td>{label(row.kind)}{view.budget.actuals.some(entry => entry.observationId === row.id) && <small>Linked to ledger</small>}</td></tr>)}</tbody></table></div></details>}
      </section>
      {tab !== 'cashflow' && tab !== 'work' && pageItems > PAGE_SIZE && <div className="budget-pagination"><span>{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, pageItems)} of {pageItems}</span><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><button disabled={(currentPage + 1) * PAGE_SIZE >= pageItems} onClick={() => setPage(currentPage + 1)}>Next</button></div>}
      <details className="budget-method"><summary>Calculation and source details</summary><p className="budget-method-note">Project totals count each cost once. Shot, asset and macro views can share costs; do not add their subtotals together. Macro per-run estimates describe the planned steps and attempt allowance, not verified execution counts.</p><p>A budget is a draft plan. A rate needs a quote, rate card or explicit assumption. Zero is allowed only with a basis. Add project lines for development, crew, equipment, travel, storage, subscriptions, insurance, tax, contingency and any other costs outside the connected inventory.</p><p>Outstanding commitments cover work committed but not yet recorded as actual cost. Exclude invoices already included in actuals, even if unpaid. Without explicit remaining units, remaining cost is the estimate less actuals and commitments, floored at zero. Explicit remaining units are multiplied by the base rate once and added to actuals and commitments.</p><p>Inventory coverage reflects the records in this project. Unrecorded work must be added as manual lines. A generation quote records pricing context; it does not establish a paid charge. Imported actuals remain reported until reconciled with evidence.</p><p>{view.response.record ? `saved v${view.response.record.version}` : 'No budget saved yet'}</p><code>Project {project.id} · source {project.sourceHash ?? 'none'}<br/>Inventory {view.response.inventoryHash}</code></details>
      <details className="budget-portfolio-tools"><summary>Compare exported project budgets</summary><ProductionBudgetPortfolio/></details>
    </>}
  </section>;
}
