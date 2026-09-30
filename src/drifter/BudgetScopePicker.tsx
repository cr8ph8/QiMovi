import { useId, useMemo, useState } from 'react';
import type { BudgetLine, BudgetTarget } from '../../local/contracts/production-budget.mjs';
import { budgetScopeGroups, DEFAULT_BUDGET_SCOPE_GROUP_IDS, type BudgetScopeGroupId } from './budgetScope';
import './budget-scope.css';

export type BudgetScopePickerProps = {
  targets: BudgetTarget[];
  lines: BudgetLine[];
  disabled: boolean;
  onGenerate: (targetIds: string[]) => void;
  onCancel: () => void;
};

export default function BudgetScopePicker({ targets, lines, disabled, onGenerate, onCancel }: BudgetScopePickerProps) {
  const descriptionId = useId();
  const groups = useMemo(() => budgetScopeGroups(targets, lines), [targets, lines]);
  const [selectedGroups, setSelectedGroups] = useState<readonly BudgetScopeGroupId[]>(DEFAULT_BUDGET_SCOPE_GROUP_IDS);
  const selected = groups.filter(group => selectedGroups.includes(group.id)).flatMap(group => group.targets);
  const availableCount = groups.reduce((count, group) => count + group.targets.length, 0);
  const toggle = (groupId: BudgetScopeGroupId) => setSelectedGroups(current => current.includes(groupId)
    ? current.filter(id => id !== groupId) : [...current, groupId]);

  return <section className="budget-scope-picker" aria-label="Choose budget scope" aria-describedby={descriptionId}>
    <div className="budget-section-heading"><h4>Choose budget scope</h4></div>
    <p id={descriptionId}>Select the work that needs new cost lines. Existing cost lines are skipped.</p>
    <fieldset className="budget-scope-groups" disabled={disabled}>
      <legend className="budget-sr-only">Work to include</legend>
      {groups.map(group => <label key={group.id} className="budget-scope-option">
        <input type="checkbox" aria-label={group.label} checked={selectedGroups.includes(group.id)}
          disabled={!group.targets.length} onChange={() => toggle(group.id)} />
        <span className="budget-scope-option-content">
          <span className="budget-scope-option-heading"><strong>{group.label}</strong><span>{group.targets.length}</span></span>
          <span className="budget-scope-option-description">{group.description}</span>
        </span>
      </label>)}
    </fieldset>
    <div className="budget-scope-preview">
      <p aria-live="polite"><strong>{selected.length} selected</strong><span> of {availableCount} available new cost lines</span></p>
      {selected.length > 0 ? <>
        <ul aria-label="Selected cost line preview">{selected.slice(0, 8).map(target => <li key={target.id}>{target.label}</li>)}</ul>
        {selected.length > 8 && <details>
          <summary>Show all {selected.length} selected targets</summary>
          <ul aria-label="All selected cost lines">{selected.map(target => <li key={target.id}>{target.label}</li>)}</ul>
        </details>}
      </> : <p>{availableCount ? 'Select a category to add cost lines.' : 'Every eligible target already has a cost line, or no eligible targets are available.'}</p>}
    </div>
    <p className="budget-scope-explanation">Unselected work stays outside this addition. This does not mark its costs as free or covered.</p>
    <div className="budget-actions">
      <button type="button" className="budget-primary" disabled={disabled || !selected.length} onClick={() => onGenerate(selected.map(target => target.id))}>Add selected cost lines</button>
      <button type="button" disabled={disabled} onClick={onCancel}>Cancel</button>
    </div>
  </section>;
}
