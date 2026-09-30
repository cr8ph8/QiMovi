import type { BudgetLine, BudgetTarget } from '../../local/contracts/production-budget.mjs';

export type BudgetScopeGroupId = 'overhead' | 'shot' | 'requirements' | 'workflow' | 'generation' | 'asset';
export type BudgetScopeGroup = {
  id: BudgetScopeGroupId;
  label: string;
  description: string;
  targets: BudgetTarget[];
};

export const DEFAULT_BUDGET_SCOPE_GROUP_IDS: readonly BudgetScopeGroupId[] = ['overhead', 'shot', 'requirements', 'generation'];

const groups: Omit<BudgetScopeGroup, 'targets'>[] = [
  { id: 'overhead', label: 'Cost groups', description: 'Department and shared production costs.' },
  { id: 'shot', label: 'Shot planning', description: 'Planned shots that need cost lines.' },
  { id: 'requirements', label: 'Script & world requirements', description: 'Saved script elements and world production needs.' },
  { id: 'workflow', label: 'Writing & workflow tasks', description: 'Writing, development and workflow work. Include when it needs a separate cost line.' },
  { id: 'generation', label: 'Generation requests', description: 'Retained generation requests that need cost lines.' },
  { id: 'asset', label: 'Library assets', description: 'Includes reference-only and imported material. Library inclusion does not automatically mean additional production spend.' },
];

const groupForKind: Record<string, BudgetScopeGroupId> = {
  overhead: 'overhead', shot: 'shot', 'breakdown-element': 'requirements', 'world-need': 'requirements',
  task: 'workflow', step: 'workflow', generation: 'generation', asset: 'asset',
};

/** Uses the generation service's eligibility rules, without changing coverage or any existing line. */
export function budgetScopeGroups(targets: readonly BudgetTarget[], lines: readonly BudgetLine[]): BudgetScopeGroup[] {
  const parentIds = new Set(targets.flatMap(target => target.parentIds));
  const existingTargetIds = new Set(lines.flatMap(line => [line.targetId, ...(line.coveredTargetIds ?? [])]));
  const result = groups.map(group => ({ ...group, targets: [] as BudgetTarget[] }));
  const byId = new Map(result.map(group => [group.id, group]));
  for (const target of targets) {
    if (target.costRequired === false || ['project', 'scene', 'macro', 'world'].includes(target.kind)
      || (['task', 'step'].includes(target.kind) && parentIds.has(target.id)) || existingTargetIds.has(target.id)) continue;
    const groupId = groupForKind[target.kind];
    if (groupId) byId.get(groupId)?.targets.push(target);
  }
  for (const group of result) group.targets.sort((left, right) => {
    const leftKey = `${left.label}\u0000${left.id}`, rightKey = `${right.label}\u0000${right.id}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return result;
}
