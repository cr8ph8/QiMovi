import { calculateProductionBudget, validateProductionBudget, type BudgetDecimal, type BudgetTarget, type BudgetTotals, type ProductionBudget, type ProductionBudgetReport } from '../../local/contracts/production-budget.mjs';
import type { WorkspaceRecord } from './types';

export const BUDGET_PORTFOLIO_LIMITS = Object.freeze({ fileBytes: 8 * 1024 * 1024, projects: 50, totalBytes: 64 * 1024 * 1024 });
export interface ProductionBudgetExport {
  schemaVersion: 'qimovi-production-budget/v1'; generatedAt: string; inventoryHash: string;
  budget: ProductionBudget; record: WorkspaceRecord | null; targets: BudgetTarget[]; report: ProductionBudgetReport;
  snapshotGeneratedAt?: string; draft?: boolean;
}
export interface BudgetReceiptCollision {
  currency: string; externalId: string; projectIds: string[]; actualIds: { projectId: string; actualId: string }[];
}
export interface PortfolioCurrencyTotals extends Omit<BudgetTotals, 'reconciledActual' | 'knownActual' | 'knownForecast'> {
  reconciledActual: BudgetDecimal | null; knownActual: BudgetDecimal | null; knownForecast: BudgetDecimal | null;
  projectCount: number; actualState: 'COMPLETE' | 'PARTIAL' | 'NEEDS_ALLOCATION';
}
export interface BudgetPortfolioReport {
  schemaVersion: 'qimovi-budget-portfolio-report/v1'; scope: 'SELECTED_EXPORTS_ONLY'; projectCount: number;
  projectIds: string[]; totals: PortfolioCurrencyTotals[]; collisions: BudgetReceiptCollision[];
  gapCount: number; unpricedTargets: number; projectsWithoutCurrency: string[];
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const need: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw new Error(message); };
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,9})?(?:Z|([+-])(\d\d):(\d\d))$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const day = new Date(`${match[1]}T00:00:00Z`);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === match[1] && Number(match[2]) < 24 && Number(match[3]) < 60 && Number(match[4]) < 60 && (!match[5] || Number(match[6]) < 24 && Number(match[7]) < 60);
}

/** File totals and gap lists are untrusted. Rebuild them from validated source rows. */
export function validateProductionBudgetExport(value: unknown): ProductionBudgetExport {
  need(object(value) && value.schemaVersion === 'qimovi-production-budget/v1', 'Choose a QiMovi project budget JSON export.');
  need(timestamp(value.generatedAt) && digest(value.inventoryHash), 'The budget export is missing its date or inventory fingerprint.');
  need(Object.prototype.hasOwnProperty.call(value, 'record') && Array.isArray(value.targets) && object(value.report) && Array.isArray(value.report.observations), 'The budget export is incomplete. Export it again from its project.');
  const budget = validateProductionBudget(value.budget);
  need(value.snapshotGeneratedAt === undefined || timestamp(value.snapshotGeneratedAt), 'The inventory snapshot date is invalid.');
  need(value.draft === undefined || typeof value.draft === 'boolean', 'The exported draft marker is invalid.');
  need(value.report.schemaVersion === 1 && value.report.projectId === budget.projectId && value.report.sourceHash === budget.sourceHash, 'The budget report belongs to a different project or source.');
  if (value.record !== null) {
    const record = value.record;
    need(object(record) && record.kind === 'production-budget' && record.id === `production-budget:${budget.projectId}` && Number.isSafeInteger(record.version) && Number(record.version) > 0 && digest(record.sha256), 'The saved budget record is invalid.');
    validateProductionBudget(record.data, { id: budget.projectId, sourceHash: budget.sourceHash });
  }
  const targets = value.targets as BudgetTarget[];
  const report = calculateProductionBudget(budget, targets, value.report.observations as ProductionBudgetReport['observations']);
  return { schemaVersion: 'qimovi-production-budget/v1', generatedAt: value.generatedAt as string, inventoryHash: value.inventoryHash as string, budget, record: value.record as WorkspaceRecord | null, targets, report,
    ...(value.snapshotGeneratedAt === undefined ? {} : { snapshotGeneratedAt: value.snapshotGeneratedAt as string }), ...(value.draft === undefined ? {} : { draft: value.draft as boolean }) };
}

export function parseProductionBudgetExport(text: string): ProductionBudgetExport {
  need(typeof text === 'string' && new TextEncoder().encode(text).byteLength <= BUDGET_PORTFOLIO_LIMITS.fileBytes, 'Each budget export must be no larger than 8 MB.');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('This file is not valid JSON. Choose a project budget export.'); }
  return validateProductionBudgetExport(parsed);
}

/** A project is never silently replaced by a different export or source revision. */
export function addBudgetPortfolioProjects(existing: readonly ProductionBudgetExport[], incoming: readonly ProductionBudgetExport[]): ProductionBudgetExport[] {
  need(existing.length + incoming.length <= BUDGET_PORTFOLIO_LIMITS.projects, 'Load at most 50 project budget exports at once.');
  const projects: ProductionBudgetExport[] = [], seen = new Set<string>();
  for (const candidate of [...existing, ...incoming]) {
    const project = validateProductionBudgetExport(candidate), id = project.budget.projectId;
    need(!seen.has(id), `Project ${id} is already loaded. Remove its existing export before loading a replacement.`);
    seen.add(id); projects.push(project);
  }
  return projects;
}

const scale = 1000000000n;
function units(value: BudgetDecimal): bigint {
  need(typeof value === 'string' && /^-?\d+(?:\.\d{1,9})?$/.test(value), 'A calculated budget amount is invalid.');
  const negative = value.startsWith('-'), [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const result = BigInt(whole) * scale + BigInt(fraction.padEnd(9, '0'));
  return negative ? -result : result;
}
function decimal(value: bigint): BudgetDecimal {
  const negative = value < 0n, absolute = negative ? -value : value;
  const fraction = String(absolute % scale).padStart(9, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${absolute / scale}${fraction ? `.${fraction}` : ''}`;
}
const sum = (values: readonly (BudgetDecimal | null)[]): BudgetDecimal | null => values.some(value => value === null) ? null : decimal(values.reduce<bigint>((total, value) => total + units(value as BudgetDecimal), 0n));
const sumKnown = (values: readonly BudgetDecimal[]): BudgetDecimal => sum(values) as BudgetDecimal;

export function calculateBudgetPortfolio(input: readonly ProductionBudgetExport[]): BudgetPortfolioReport {
  const projects = addBudgetPortfolioProjects([], input);
  const invoices = new Map<string, { currency: string; externalId: string; actualIds: { projectId: string; actualId: string }[] }>();
  for (const { budget } of projects) for (const actual of budget.actuals) {
    if (!actual.externalId.trim()) continue;
    const externalId = actual.externalId.trim(), key = JSON.stringify([actual.currency, externalId]);
    const group = invoices.get(key) ?? { currency: actual.currency, externalId, actualIds: [] };
    group.actualIds.push({ projectId: budget.projectId, actualId: actual.id }); invoices.set(key, group);
  }
  const collisions: BudgetReceiptCollision[] = [...invoices.values()].flatMap(group => {
    const projectIds = [...new Set(group.actualIds.map(actual => actual.projectId))].sort();
    return projectIds.length > 1 ? [{ ...group, projectIds }] : [];
  }).sort((a, b) => a.currency.localeCompare(b.currency) || a.externalId.localeCompare(b.externalId));
  const collidedCurrencies = new Set(collisions.map(row => row.currency)), groups = new Map<string, BudgetTotals[]>();
  const projectsWithoutCurrency = projects.filter(project => project.report.totals.length === 0).map(project => project.budget.projectId);
  for (const { report } of projects) for (const total of report.totals) {
    const rows = groups.get(total.currency) ?? []; rows.push(total); groups.set(total.currency, rows);
  }
  const totals = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([currency, rows]): PortfolioCurrencyTotals => {
    const collided = collidedCurrencies.has(currency);
    const unassigned = projectsWithoutCurrency.length;
    const unknownActualCount = rows.reduce((value, row) => value + row.unknownActualCount, 0) + unassigned;
    const actual = collided || unassigned ? null : sum(rows.map(row => row.actual));
    return {
      currency, projectCount: rows.length, actualState: collided ? 'NEEDS_ALLOCATION' : actual === null || unknownActualCount > 0 ? 'PARTIAL' : 'COMPLETE',
      estimateLow: unassigned ? null : sum(rows.map(row => row.estimateLow)), estimate: unassigned ? null : sum(rows.map(row => row.estimate)), estimateHigh: unassigned ? null : sum(rows.map(row => row.estimateHigh)),
      reportedActual: collided || unassigned ? null : sum(rows.map(row => row.reportedActual)), reconciledActual: collided ? null : sumKnown(rows.map(row => row.reconciledActual)), actual,
      committed: sumKnown(rows.map(row => row.committed)), estimateToComplete: unassigned ? null : sum(rows.map(row => row.estimateToComplete)),
      forecast: collided || unassigned ? null : sum(rows.map(row => row.forecast)), variance: collided || unassigned ? null : sum(rows.map(row => row.variance)),
      knownEstimate: sumKnown(rows.map(row => row.knownEstimate)), knownActual: collided ? null : sumKnown(rows.map(row => row.knownActual)), knownForecast: collided ? null : sumKnown(rows.map(row => row.knownForecast)),
      unknownEstimateCount: rows.reduce((value, row) => value + row.unknownEstimateCount, 0) + unassigned, unknownActualCount,
    };
  });
  return { schemaVersion: 'qimovi-budget-portfolio-report/v1', scope: 'SELECTED_EXPORTS_ONLY', projectCount: projects.length,
    projectIds: projects.map(project => project.budget.projectId), totals, collisions, projectsWithoutCurrency,
    gapCount: projects.reduce((total, project) => total + project.report.gaps.length, 0),
    unpricedTargets: projects.reduce((total, project) => total + project.report.targets.filter(target => target.coverage !== 'PRICED').length, 0),
  };
}

export function exportBudgetPortfolio(projects: readonly ProductionBudgetExport[], generatedAt = new Date().toISOString()) {
  need(timestamp(generatedAt), 'The comparison export date is invalid.');
  const verified = addBudgetPortfolioProjects([], projects);
  return { schemaVersion: 'qimovi-budget-portfolio/v1' as const, generatedAt, projects: verified, report: calculateBudgetPortfolio(verified) };
}
