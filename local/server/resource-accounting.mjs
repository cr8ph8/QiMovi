import { usageView } from '../accounting/resource-view.mjs';
export function resourceSnapshot(journal, store, usageAccounting, productionBudget, brandFinancing) {
  const value = journal.snapshot(), project = store.project(), scope = { projectId: project.id, sourceHash: project.sourceHash };
  const issues = [], read = (name, fn) => { try { return fn(); } catch { issues.push(`${name}_UNAVAILABLE`); return null; } };
  const attempts = read('NATIVE_USAGE', () => usageAccounting.budgetAttempts(scope));
  const budget = read('BUDGET', () => productionBudget.load(scope));
  const financing = read('FINANCING', () => brandFinancing.load());
  const usage = usageView((attempts ?? []).map(a => ({ key: a.origin === 'LOCAL_MODEL' ? `local:${a.taskId}` : `native:${a.id}`, provider: a.provider, model: a.model, origin: a.origin,
    taskId: a.taskId, inputTokens: a.inputTokens, outputTokens: a.outputTokens, status: a.status, timestamp: a.timestamp, cost: a.costUsd, costKind: a.costKind,
    currency: 'USD', quotedCredits: a.quotedCredits, sceneId: a.sceneId, shotId: a.shotId })), value.runs);
  return { ...value, runs: value.runs.slice(-100), entries: value.entries.slice(-100), rates: value.rates.slice(-100), usage, issues,
    production: budget ? { totals: budget.report.totals, gaps: budget.report.gaps.length, targets: budget.targets.length, scope: 'SAVED_PROJECT_BUDGET', enforcement: budget.enforcement } : null,
    financing: financing ? { totals: financing.totals, scope: 'INCOME_NOT_NEGATIVE_EXPENSE', ledgerVersion: financing.version } : null,
    coverage: { ...value.coverage, generationCredits: 'QUOTED_NOT_SETTLED_UNLESS_RECORDED', backgroundJobs: 'NATIVE_RECEIPTS_NOT_HTTP_DURATION',
      discoveryReleasePrototype: 'NOT_INTEGRATED', nativeBudget: 'AUTHORITATIVE_DO_NOT_ADD_USAGE_OR_SUPPLEMENTAL_ENTRIES_AGAIN' } };
}
export function publicResourceContext(value) {
  // No private rates, evidence, filenames, event payloads or job text crosses the writer bridge.
  return { schema: 'qi-resource-context/v1', app: value.app, projectId: value.projectId, scope: 'PROJECT_NOT_DRAFT', readOnly: true,
    production: value.production, financing: value.financing, usageGroups: value.usage.groups, issues: value.issues,
    energy: 'UNMETERED', monetaryBasis: 'OWNER_RECORDED_AND_PROVIDER_OBSERVATIONS_NOT_BANK_VERIFIED' };
}
