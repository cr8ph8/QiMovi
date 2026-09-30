import { calculateBudgetCashflow, calculateProductionBudget, productionBudgetProject, validateProductionBudget, type ProductionBudget, type ProductionBudgetReport, type BudgetTarget, type BudgetGap } from '../../local/contracts/production-budget.mjs';
import { validateRecord } from './validation';
import { hashCanonical } from './canonical';
import type { WorkspaceProject, WorkspaceRecord } from './types';

export type { ProductionBudget, ProductionBudgetReport, BudgetTarget } from '../../local/contracts/production-budget.mjs';
export interface ProductionBudgetResponse {
  schemaVersion: 'qimovi-production-budget/v1';
  generatedAt: string;
  budget: ProductionBudget;
  record: WorkspaceRecord | null;
  inventoryHash: string;
  targets: BudgetTarget[];
  report: ProductionBudgetReport;
  coverage?: Record<string, unknown>;
  authority?: string;
  enforcement?: string;
  warnings?: BudgetGap[];
}
export interface ProductionBudgetSave {
  budget: ProductionBudget;
  expectedVersion: number | null;
  requestId: string;
  inventoryHash: string;
}
export interface ProductionBudgetApi {
  load(project: WorkspaceProject, signal?: AbortSignal): Promise<ProductionBudgetResponse>;
  generate(project: WorkspaceProject, budget?: ProductionBudget, signal?: AbortSignal, targetIds?: string[]): Promise<ProductionBudgetResponse>;
  save(project: WorkspaceProject, request: ProductionBudgetSave): Promise<ProductionBudgetResponse>;
}

const messages: Record<string, string> = {
  BUDGET_ASSET_SCOPE_STALE: 'This asset has changed project links. Refresh inventory and review its production use again. Your draft is retained.',
  BUDGET_ASSET_SCOPE_MISSING: 'This asset is no longer available. Refresh inventory and review the saved scope decision. Your draft is retained.',
  BUDGET_PRODUCTION_PLAN_INVALID: 'Review the production method, department lead, quantity basis and notes. Your draft is retained.',
  BUDGET_PRODUCTION_PLAN_DATES_INVALID: 'Enter valid work dates with the end on or after the start. Your draft is retained.',
  BUDGET_COVERED_TARGET_MISSING: 'A new shared-work link is no longer available. Refresh inventory and review the links; your draft is retained.',
  BUDGET_SHARED_TARGETS_LOCKED: 'Save work links before recording the first charge. Once spending is recorded, use a separate cost line for different work.',
  BUDGET_COVERED_TARGETS_INVALID: 'Each shared-work link must be unique and different from the main allocation. Review the links; your draft is retained.',
  BUDGET_COVERED_TARGETS_LIMIT: 'This expense has too many shared-work links. Split distinct work into separate cost lines.',
  BUDGET_TARGET_MISSING: 'Selected work is no longer in the current inventory. Refresh inventory and choose the budget scope again. Your draft is retained.',
  BUDGET_TARGET_IDS_INVALID: 'The selected budget scope could not be verified. Choose the work again; your draft is retained.',
  BUDGET_COMMITMENT_TRANSITION_INVALID: 'Save changes to outstanding commitments before recording a cost against them.',
  BUDGET_PROJECT_MISMATCH: 'The project or screenplay changed. Reopen its budget before continuing.',
  BUDGET_SOURCE_MISMATCH: 'The screenplay changed. Reopen its budget before continuing.',
  BUDGET_INVENTORY_CHANGED: 'Project records changed while this budget was open. Your draft is retained. Refresh inventory to review the changed work, then save again.',
  BUDGET_VERSION_CONFLICT: 'A newer budget was saved elsewhere. Your draft is retained. Export it before cancelling and refreshing to the latest version.',
  VERSION_CONFLICT: 'A newer budget was saved elsewhere. Your draft is retained. Export it before cancelling and refreshing to the latest version.',
  BUDGET_ACTUAL_IMMUTABLE: 'Saved actuals cannot be changed. Add a separate charge or refund with its evidence.',
  BUDGET_ACTUALS_APPEND_ONLY: 'Saved actuals cannot be changed. Add a separate charge or refund with its evidence.',
  BUDGET_SAVE_SUPERSEDED: 'This request was saved earlier, but a newer budget now exists. Your draft is retained. Export it before cancelling and refreshing.',
  BUDGET_ACTUAL_EXTERNAL_ID_DUPLICATE: 'That charge reference is already recorded. Use the existing entry or a unique correction reference.',
  BUDGET_ACTUAL_OBSERVATION_DUPLICATE: 'That observed event is already linked to an actual. It can be reconciled only once.',
};

async function json(route: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/production-budget${route}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'error', signal,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    const code = String(data?.error?.code ?? data?.error ?? 'BUDGET_REQUEST_UNCONFIRMED');
    throw new Error(messages[code] ?? data?.error?.message ?? `The budget request could not be confirmed (${code}).`);
  }
  return data;
}
function check(value: unknown, message = 'The local budget response could not be verified. Refresh before continuing.'): asserts value {
  if (!value) throw new Error(message);
}
async function verify(value: unknown, project: WorkspaceProject): Promise<ProductionBudgetResponse> {
  const data = value as ProductionBudgetResponse;
  check(data?.schemaVersion === 'qimovi-production-budget/v1' && typeof data.generatedAt === 'string' && Number.isFinite(Date.parse(data.generatedAt)));
  const owner = productionBudgetProject(project);
  check(data?.budget?.projectId === owner.id && data.budget.sourceHash === owner.sourceHash, 'The budget belongs to a different project or source.');
  const budget = validateProductionBudget(data.budget, project);
  check(typeof data.inventoryHash === 'string' && /^[a-f0-9]{64}$/.test(data.inventoryHash));
  check(Array.isArray(data.targets) && data.targets.every(target => target && typeof target.id === 'string' && typeof target.kind === 'string' && typeof target.label === 'string' && Array.isArray(target.parentIds) && target.parentIds.every(id => typeof id === 'string')));
  check(data.report?.projectId === project.id && data.report.sourceHash === owner.sourceHash && Array.isArray(data.report.observations));
  const report = calculateProductionBudget(budget, data.targets, data.report.observations);
  const warnings = data.warnings ?? [];
  check(Array.isArray(warnings) && warnings.every(gap => gap && typeof gap.code === 'string' && typeof gap.message === 'string'));
  report.gaps.push(...warnings);
  const record = data.record === null ? null : await validateRecord(data.record, project);
  check(record === null || (record.kind === 'production-budget' && record.id === `production-budget:${project.id}`));
  return { ...data, budget, record, report };
}
const scope = (project: WorkspaceProject) => { const owner = productionBudgetProject(project); return { projectId: owner.id, sourceHash: owner.sourceHash }; };
export const productionBudgetApi: ProductionBudgetApi = {
  async load(project, signal) {
    return verify(await json(`?${new URLSearchParams({ projectId: project.id, sourceHash: String(scope(project).sourceHash) })}`, undefined, signal), project);
  },
  async generate(project, budget, signal, targetIds) {
    if (budget) validateProductionBudget(budget, project);
    return verify(await json('/generate', { ...scope(project), ...(budget ? { budget } : {}), ...(targetIds !== undefined ? { targetIds } : {}) }, signal), project);
  },
  async save(project, request) {
    validateProductionBudget(request.budget, project);
    const result = await verify(await json('/save', { ...scope(project), ...request }), project);
    check(result.record !== null, 'The budget save returned no receipt. Keep this draft and retry the save.');
    check(result.record.sha256 === await hashCanonical(request.budget) && await hashCanonical(result.budget) === result.record.sha256, 'The saved receipt differs from this draft. Keep the draft and retry the save.');
    return result;
  },
};

/** Keep user-authored text inert when the CSV is opened by spreadsheet software. */
export function budgetCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  let start = 0;
  while (start < raw.length && (raw.charCodeAt(start) <= 32 || /\s/u.test(raw[start]))) start += 1;
  const inert = raw[start] && '=+-@'.includes(raw[start]) ? `'${raw}` : raw;
  return `"${inert.replace(/"/g, '""')}"`;
}

export function productionBudgetCsv(budget: ProductionBudget, report: ProductionBudgetReport): string {
  const headers = ['rowType', 'id', 'lineId', 'targetId', 'coveredTargetIds', 'targetKind', 'label', 'currency', 'category', 'unit', 'quantity', 'runs', 'attempts', 'rateLow', 'rate', 'rateHigh', 'estimateLow', 'estimate', 'estimateHigh', 'actual', 'reportedActual', 'reconciledActual', 'committed', 'remainingQuantity', 'estimateToComplete', 'forecast', 'variance', 'knownEstimate', 'knownActual', 'knownForecast', 'coverage', 'perRunEstimate', 'basis', 'rateDate', 'evidence', 'externalId', 'status', 'observationId', 'observedAmount', 'vendor', 'expectedPaymentDate', 'paymentPlanningBasis', 'productionMethod', 'departmentOwner', 'workStartDate', 'workEndDate', 'quantityBasis', 'productionNotes', 'costDate', 'recordedAt', 'commitmentApplied', 'period', 'expectedCommitments', 'incurredCosts', 'knownIncurredCosts', 'unknownIncurredCount', 'assetUsage', 'scopeContext'];
  const rows: Record<string, unknown>[] = [];
  for (const total of report.totals) rows.push({ rowType: 'project-total', targetId: budget.projectId, label: budget.title, ...total });
  for (const target of report.targets) {
    const common = { rowType: 'target', targetId: target.id, targetKind: target.kind, label: target.label, coverage: target.coverage };
    if (target.totals.length) for (const total of target.totals) rows.push({ ...common, ...total });
    else rows.push(common);
  }
  for (const line of report.lines) rows.push({ rowType: 'cost-line', ...line, coveredTargetIds: JSON.stringify(line.coveredTargetIds ?? []), vendor: line.paymentPlan?.vendor, expectedPaymentDate: line.paymentPlan?.expectedDate, paymentPlanningBasis: line.paymentPlan?.basis, productionMethod: line.productionPlan?.method, departmentOwner: line.productionPlan?.departmentOwner, workStartDate: line.productionPlan?.startDate, workEndDate: line.productionPlan?.endDate, quantityBasis: line.productionPlan?.quantityBasis, productionNotes: line.productionPlan?.notes, targetKind: report.targets.find(target => target.id === line.targetId)?.kind });
  for (const decision of budget.assetScopeDecisions ?? []) rows.push({ rowType: 'asset-scope', targetId: decision.targetId, targetKind: 'asset', assetUsage: decision.usage, basis: decision.basis, scopeContext: decision.contextKey, status: report.targets.find(target => target.id === decision.targetId)?.budgetUsage ?? 'missing' });
  for (const actual of budget.actuals) rows.push({ rowType: actual.kind, ...actual, actual: actual.kind === 'refund' ? `-${actual.amount}` : actual.amount, status: actual.status });
  for (const observation of report.observations) rows.push({ rowType: 'observation', ...observation, actual: observation.kind === 'reported' ? observation.amount : null, estimate: observation.kind === 'estimated' ? observation.amount : null, status: observation.kind, observationId: observation.id, observedAmount: observation.amount });
  for (const group of calculateBudgetCashflow(budget, report.observations).currencies) for (const month of group.months) rows.push({ rowType: 'cashflow-period', currency: group.currency, period: month.month ?? 'undated', ...month });
  for (const gap of report.gaps) rows.push({ rowType: 'gap', targetId: gap.targetId, id: gap.lineId, label: gap.message, status: gap.code });
  const numeric = new Set(['quantity', 'runs', 'attempts', 'rateLow', 'rate', 'rateHigh', 'estimateLow', 'estimate', 'estimateHigh', 'actual', 'reportedActual', 'reconciledActual', 'committed', 'remainingQuantity', 'estimateToComplete', 'forecast', 'variance', 'knownEstimate', 'knownActual', 'knownForecast', 'perRunEstimate', 'observedAmount', 'commitmentApplied', 'expectedCommitments', 'incurredCosts', 'knownIncurredCosts']);
  // Computed, strictly numeric negatives must remain numbers in spreadsheet
  // analyses. Only text cells need formula neutralization.
  const cell = (header: string, value: unknown) => numeric.has(header) && typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value) ? `"${value}"` : budgetCsvCell(value);
  return [headers.map(budgetCsvCell).join(','), ...rows.map(row => headers.map(header => cell(header, row[header])).join(','))].join('\r\n');
}
