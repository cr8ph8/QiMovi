import { BUDGET_CATEGORIES, type BudgetCategory, type BudgetLine, type BudgetTarget, type ProductionBudget } from '../../local/contracts/production-budget.mjs';

export type BudgetProductionNextStep = 'allocate' | 'plan' | 'price' | 'ready';

/** Work views are nonadditive: the same explicit cost can support several rows. */
export interface BudgetProductionWorkRow {
  id: string;
  label: string;
  targetId: string;
  kind: string;
  category: BudgetCategory;
  lineIds: string[];
  /** Exact scene target IDs, found through the target graph. */
  sceneIds: string[];
  nextStep: BudgetProductionNextStep;
  unassignedOwner: boolean;
  unpriced: boolean;
  shared: boolean;
}

const requirement = (target: BudgetTarget): boolean => target.costRequired !== false
  && (target.kind === 'world-need' || target.kind === 'breakdown-element');
const allocationIds = (line: BudgetLine): string[] => [...new Set([line.targetId, ...(line.coveredTargetIds ?? [])])];
const blank = (value: string | undefined): boolean => !value?.trim();

/** Derives planning prompts only; does not change costs, allocations or source records. */
export function deriveBudgetProductionWork(budget: ProductionBudget, targets: readonly BudgetTarget[]): BudgetProductionWorkRow[] {
  const targetById = new Map(targets.map(target => [target.id, target]));
  const linesByTarget = new Map<string, BudgetLine[]>();
  for (const line of budget.lines) for (const targetId of allocationIds(line)) {
    const linked = linesByTarget.get(targetId) ?? [];
    linked.push(line); linesByTarget.set(targetId, linked);
  }

  function scenesFor(targetIds: readonly string[]): string[] {
    const pending = [...targetIds], visited = new Set<string>(), scenes = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const target = targetById.get(id);
      if (!target) continue;
      if (target.kind === 'scene') scenes.add(target.id);
      pending.push(...target.parentIds);
    }
    return [...scenes].sort();
  }

  function row(id: string, label: string, targetId: string, lines: BudgetLine[], contextIds: string[]): BudgetProductionWorkRow {
    const target = targetById.get(targetId);
    const targetCategory = BUDGET_CATEGORIES.find(category => category === target?.category) ?? 'other';
    const unassignedOwner = !lines.length || lines.some(line => blank(line.productionPlan?.departmentOwner));
    const unpriced = !lines.length || lines.some(line => line.rate === null || blank(line.basis));
    const needsPlan = lines.some(line => !line.productionPlan?.method || line.productionPlan.method === 'undecided'
      || blank(line.productionPlan.departmentOwner) || blank(line.productionPlan.quantityBasis));
    return {
      id, label, targetId, kind: target?.kind ?? 'cost-line', category: lines[0]?.category ?? targetCategory,
      lineIds: lines.map(line => line.id), sceneIds: scenesFor(contextIds),
      nextStep: !lines.length ? 'allocate' : needsPlan ? 'plan' : unpriced ? 'price' : 'ready',
      unassignedOwner, unpriced, shared: lines.some(line => Boolean(line.coveredTargetIds?.length)),
    };
  }

  const rows = targets.filter(requirement).map(target => row(`target:${target.id}`, target.label, target.id, linesByTarget.get(target.id) ?? [], [target.id]));
  for (const line of budget.lines) {
    const target = targetById.get(line.targetId);
    // Keep authored costs even when their primary work is excluded or missing.
    if (!target || !requirement(target)) rows.push(row(`line:${line.id}`, line.label, line.targetId, [line], allocationIds(line)));
  }
  return rows.sort((left, right) => left.label < right.label ? -1 : left.label > right.label ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}
