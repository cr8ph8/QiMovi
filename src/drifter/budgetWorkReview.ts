import type { BudgetCategory, BudgetTarget, ProductionBudget, ProductionBudgetReport } from '../../local/contracts/production-budget.mjs';

/** A review prompt, never a finding that a cost is duplicated or may be removed. */
export interface BudgetOverlapCandidate {
  id: string;
  type: 'shared-target' | 'department-allowance';
  label: string;
  lineIds: string[];
  targetIds: string[];
  category?: BudgetCategory;
}

export interface BudgetWorkReview {
  /** Existing lines needing a base rate. A supplied zero rate is not missing. */
  unpricedLineIds: string[];
  /** Unallocated script breakdown or world production requirements. */
  requirementTargetIds: string[];
  /** Unallocated assets whose use and cost scope still need review. */
  libraryAssetTargetIds: string[];
  /** Remaining costable targets named by the calculation's UNPRICED_TARGET gaps. */
  otherWorkTargetIds: string[];
  overlapCandidates: BudgetOverlapCandidate[];
}

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
const categoryLabel = (category: string) => category.charAt(0).toUpperCase() + category.slice(1);

/**
 * Summarizes the current calculation without repricing, changing coverage, or
 * deduplicating costs. Grouping views are nonadditive: overlap uses only explicit
 * line targets, never the lineIds inherited by a report's parent rollups.
 * Results contain complete groups; callers can cap their displayed rows.
 */
export function summarizeBudgetWork(
  budget: ProductionBudget,
  targets: readonly BudgetTarget[],
  report: ProductionBudgetReport,
): BudgetWorkReview {
  const targetById = new Map(targets.map(target => [target.id, target]));
  const reportByTargetId = new Map(report.targets.map(target => [target.id, target]));
  const unpricedTargets = new Set(report.gaps.filter(gap => gap.code === 'UNPRICED_TARGET' && gap.targetId).map(gap => gap.targetId!));
  const requirementTargetIds = new Set<string>(), libraryAssetTargetIds = new Set<string>(), otherWorkTargetIds = new Set<string>();

  for (const target of targets) {
    const targetReport = reportByTargetId.get(target.id);
    if (target.costRequired === false || !targetReport || targetReport.lineIds.length > 0) continue;
    if (target.kind === 'world-need' || target.kind === 'breakdown-element') requirementTargetIds.add(target.id);
    else if (target.kind === 'asset' && target.budgetUsage !== 'production') libraryAssetTargetIds.add(target.id);
    else if (unpricedTargets.has(target.id)) otherWorkTargetIds.add(target.id);
  }

  const unpricedLineIds = new Set<string>();
  const directLinesByTarget = new Map<string, Set<string>>();
  const categoryGroups = new Map<BudgetCategory, { allowanceLineIds: Set<string>; detailLineIds: Set<string>; targetIds: Set<string> }>();
  for (const line of budget.lines) {
    if (line.rate === null) unpricedLineIds.add(line.id);
    const directTargetIds = new Set([line.targetId, ...(line.coveredTargetIds ?? [])]);
    for (const targetId of directTargetIds) {
      const lineIds = directLinesByTarget.get(targetId) ?? new Set<string>();
      lineIds.add(line.id);
      directLinesByTarget.set(targetId, lineIds);
    }
    const primaryTarget = targetById.get(line.targetId);
    // Missing targets have separate calculation gaps; do not guess their scope.
    if (!primaryTarget) continue;
    const group = categoryGroups.get(line.category) ?? { allowanceLineIds: new Set<string>(), detailLineIds: new Set<string>(), targetIds: new Set<string>() };
    (primaryTarget.kind === 'overhead' ? group.allowanceLineIds : group.detailLineIds).add(line.id);
    for (const targetId of directTargetIds) group.targetIds.add(targetId);
    categoryGroups.set(line.category, group);
  }

  const overlapCandidates: BudgetOverlapCandidate[] = [];
  for (const [targetId, lineIds] of directLinesByTarget) {
    if (lineIds.size < 2) continue;
    overlapCandidates.push({
      id: `shared-target:${targetId}`, type: 'shared-target',
      label: targetById.get(targetId)?.label ?? targetId,
      lineIds: sorted(lineIds), targetIds: [targetId],
    });
  }
  for (const [category, group] of categoryGroups) {
    if (group.allowanceLineIds.size === 0 || group.detailLineIds.size === 0) continue;
    overlapCandidates.push({
      id: `department-allowance:${category}`, type: 'department-allowance',
      label: `${categoryLabel(category)} department allowance and detailed costs`, category,
      lineIds: sorted([...group.allowanceLineIds, ...group.detailLineIds]), targetIds: sorted(group.targetIds),
    });
  }
  overlapCandidates.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return {
    unpricedLineIds: sorted(unpricedLineIds), requirementTargetIds: sorted(requirementTargetIds),
    libraryAssetTargetIds: sorted(libraryAssetTargetIds), otherWorkTargetIds: sorted(otherWorkTargetIds), overlapCandidates,
  };
}
