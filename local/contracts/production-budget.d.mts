/** Nonnegative base-10 input with at most nine fractional digits; computed amounts may be signed. */
export type BudgetDecimal = string;
export type BudgetCurrency = string;
export type BudgetCategory = 'development' | 'preproduction' | 'cast' | 'crew' | 'locations' | 'art' | 'assets' | 'equipment' | 'generation' | 'post' | 'audio' | 'delivery' | 'marketing' | 'legal' | 'insurance' | 'travel' | 'storage' | 'compute' | 'subscriptions' | 'overhead' | 'tax' | 'contingency' | 'other';
export const BUDGET_CATEGORIES: readonly BudgetCategory[];
/** At most 10,000 lines; storage additionally enforces its persisted-record byte limit. */
export const BUDGET_LIMITS: Readonly<{ lines: number; actuals: number; targets: number; observations: number; parents: number; coveredTargets: number; rollupReferences: number; decimalPlaces: 9; inputIntegerDigits: number; outputIntegerDigits: number }>;
export function productionBudgetProject<T extends BudgetProject>(project: T): BudgetProject;
export interface BudgetProject { id: string; sourceHash: string | null; title?: string; name?: string }
/** Authored production planning only. Dates are tentative work dates, never payment dates or production authority. */
export interface BudgetProductionPlan {
  method: 'undecided' | 'live-action' | 'virtual' | 'generated' | 'hybrid';
  departmentOwner: string;
  startDate: string | null; endDate: string | null;
  /** Describes the quantity assumption without changing the numeric quantity used for costing. */
  quantityBasis: string;
  notes: string;
}
export interface BudgetLine {
  id: string; label: string; targetId: string; category: BudgetCategory; currency: BudgetCurrency; unit: string;
  /** Additional work covered by this one cost. Views share it; project totals count it once. Actuals retain the primary targetId. */
  coveredTargetIds?: string[];
  quantity: BudgetDecimal; runs: BudgetDecimal; attempts: BudgetDecimal;
  rateLow: BudgetDecimal | null; rate: BudgetDecimal | null; rateHigh: BudgetDecimal | null;
  /** Already includes remaining runs and attempts; multiplied by rate once. */
  remainingQuantity: BudgetDecimal | null;
  /** Outstanding commitments not yet recorded as actual cost; exclude recorded unpaid invoices. */
  committed: BudgetDecimal;
  basis: string; rateDate: string | null;
  /** Authored expectation for the outstanding commitment only; no payment is implied. */
  paymentPlan?: { vendor: string; expectedDate: string | null; basis: string };
  productionPlan?: BudgetProductionPlan;
}
export interface BudgetActual {
  id: string; lineId: string | null; targetId: string; currency: BudgetCurrency; amount: BudgetDecimal;
  kind: 'charge' | 'refund'; status: 'reported' | 'reconciled'; evidence: string;
  externalId: string; recordedAt: string;
  /** Replaces one incurred observation; charge entries only. Quotes and refunds cannot replace a charge. */
  observationId: string | null;
  /** Evidenced incurred date. recordedAt remains the ledger-entry timestamp. */
  costDate?: string | null;
  /** Part of this charge explicitly removed from the outstanding commitment when entered. */
  commitmentApplied?: BudgetDecimal;
}
export interface BudgetAssetScopeDecision {
  targetId: string; usage: 'production' | 'reference-only';
  /** Required authored reason, at most 2,000 characters. */
  basis: string;
  /** Exact budgetAssetContext value at review, at most 512,000 characters. */
  contextKey: string;
}
export type BudgetAssetUsage = BudgetAssetScopeDecision['usage'] | 'unreviewed' | 'needs-review';
export interface ProductionBudget {
  schemaVersion: 1; projectId: string; sourceHash: string | null; status: 'DRAFT'; title: string;
  lines: BudgetLine[]; actuals: BudgetActual[];
  /** Omitted legacy decisions mean not reviewed; nothing is excluded automatically. */
  assetScopeDecisions?: BudgetAssetScopeDecision[];
}
export interface BudgetTarget {
  id: string; kind: string; label: string; parentIds: string[];
  /** False for a grouping view that creates no cost requirement of its own. */
  costRequired?: boolean;
  /** Effective review state only; raw inventory may omit this field. */
  budgetUsage?: BudgetAssetUsage;
  budgetScopeBasis?: string;
  [key: string]: unknown;
}
export interface BudgetObservation {
  id: string; targetId: string; currency: BudgetCurrency; amount: BudgetDecimal | null;
  kind: 'reported' | 'estimated' | 'quote' | 'unknown'; label: string;
}
export interface BudgetTotals {
  currency: BudgetCurrency;
  estimateLow: BudgetDecimal | null; estimate: BudgetDecimal | null; estimateHigh: BudgetDecimal | null;
  reportedActual: BudgetDecimal | null; reconciledActual: BudgetDecimal; actual: BudgetDecimal | null;
  committed: BudgetDecimal; estimateToComplete: BudgetDecimal | null;
  forecast: BudgetDecimal | null; variance: BudgetDecimal | null;
  knownEstimate: BudgetDecimal; knownActual: BudgetDecimal; knownForecast: BudgetDecimal;
  unknownEstimateCount: number; unknownActualCount: number;
  /** Present on macro target rollups; excludes the runs multiplier. */
  perRunEstimate?: BudgetDecimal | null;
}
export interface CalculatedBudgetLine extends BudgetLine {
  estimateLow: BudgetDecimal | null; estimate: BudgetDecimal | null; estimateHigh: BudgetDecimal | null;
  reportedActual: BudgetDecimal | null; reconciledActual: BudgetDecimal; actual: BudgetDecimal | null;
  estimateToComplete: BudgetDecimal | null; forecast: BudgetDecimal | null; variance: BudgetDecimal | null;
}
export interface CalculatedBudgetTarget {
  id: string; kind: string; label: string; parentIds: string[];
  coverage: 'UNPRICED' | 'PARTIAL' | 'PRICED'; lineIds: string[]; totals: BudgetTotals[];
  budgetUsage?: BudgetAssetUsage; budgetScopeBasis?: string;
}
export interface BudgetGap { code: string; targetId?: string; lineId?: string; message: string }
export interface ProductionBudgetReport {
  schemaVersion: 1; projectId: string; sourceHash: string | null;
  totals: BudgetTotals[]; lines: CalculatedBudgetLine[]; targets: CalculatedBudgetTarget[];
  gaps: BudgetGap[]; observations: BudgetObservation[];
}
export function validateProductionBudget(data: unknown, project?: BudgetProject): ProductionBudget;
/** The canonical record id is production-budget:<projectId>. Unrelated kinds and ids are ignored. */
export function validateBudgetIdentity(id: string, kind: string, data: unknown): void;
export function emptyProductionBudget(project: BudgetProject): ProductionBudget;
/** Stable asset identity, parents and source refs; never includes the derived costRequired flag. */
export function budgetAssetContext(target: BudgetTarget): string;
/** Keeps undecided targets unchanged; never edits the supplied targets or budget. */
export function applyBudgetAssetScope(data: ProductionBudget, targets: BudgetTarget[]): { targets: BudgetTarget[]; gaps: BudgetGap[] };
export function calculateProductionBudget(data: ProductionBudget, targets: BudgetTarget[], observations?: BudgetObservation[]): ProductionBudgetReport;
export interface BudgetCashflowEntry {
  id: string; kind: 'commitment' | 'actual' | 'observation'; label: string; targetId: string; lineId: string | null;
  date: string | null; currency: string; amount: BudgetDecimal | null; vendor: string; evidence: string;
}
export interface BudgetCashflowMonth {
  month: string | null; expectedCommitments: BudgetDecimal; incurredCosts: BudgetDecimal | null;
  knownIncurredCosts: BudgetDecimal; unknownIncurredCount: number; commitmentCount: number; costCount: number;
}
export interface BudgetCashflowReport {
  currencies: { currency: string; months: BudgetCashflowMonth[] }[];
  entries: BudgetCashflowEntry[];
}
export function calculateBudgetCashflow(data: ProductionBudget, observations?: BudgetObservation[]): BudgetCashflowReport;
/** Atomically appends a charge and removes its explicitly attributed commitment portion. */
export function appendBudgetActual(data: ProductionBudget, actual: BudgetActual): ProductionBudget;
/** Newly attributed charges must reduce a previously saved commitment exactly. */
export function validateBudgetCommitmentTransition(previous: ProductionBudget | null, next: ProductionBudget): void;
/** For unsaved draft entries only. Callers enforce the saved ledger boundary. */
export function removeDraftBudgetActual(data: ProductionBudget, actualId: string): ProductionBudget;
