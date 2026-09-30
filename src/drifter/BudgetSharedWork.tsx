import { useState } from 'react';
import { BUDGET_LIMITS, type BudgetLine, type BudgetTarget } from '../../local/contracts/production-budget.mjs';

export default function BudgetSharedWork({ line, lines, targets, disabled, onChange }: {
  line: BudgetLine; lines: BudgetLine[]; targets: BudgetTarget[]; disabled: boolean;
  onChange(ids: string[]): void;
}) {
  const [query, setQuery] = useState(''), [scope, setScope] = useState('requirements'), [limit, setLimit] = useState(20);
  const linked = line.coveredTargetIds ?? [];
  const index = new Map(targets.map(target => [target.id, target]));
  const context = (target: BudgetTarget) => target.parentIds.map(id => index.get(id)?.label ?? id).join(' · ');
  const candidates = targets.filter(target => target.id !== line.targetId && (linked.includes(target.id) || target.costRequired !== false
    && !['project', 'scene', 'world', 'macro'].includes(target.kind)
    && (scope === 'all' || ['world-need', 'breakdown-element'].includes(target.kind))
    && `${target.label} ${context(target)} ${target.id}`.toLowerCase().includes(query.toLowerCase())));
  const selected = candidates.filter(target => linked.includes(target.id));
  const choices = candidates.filter(target => !linked.includes(target.id));
  const missing = linked.filter(id => !index.has(id));
  return <section className="budget-shared-work" aria-label="Work covered by this cost">
    <h5>Work covered by this cost</h5>
    <p>Link the requirements this one expense covers. Its full cost appears in each linked view and counts once in project totals; linked views are not additive.</p>
    <p className="budget-footnote">Main allocation: {index.get(line.targetId)?.label ?? line.targetId}. {linked.length} additional links. Other cost lines stay unchanged.</p>
    <fieldset disabled={disabled}>
      <label>Find work to link<input aria-label="Find work to link" value={query} onChange={event => { setQuery(event.target.value); setLimit(20); }} placeholder="Character, prop, scene or asset…"/></label>
      <label>Work to show<select aria-label="Work to show" value={scope} onChange={event => { setScope(event.target.value); setLimit(20); }}><option value="requirements">Script & world requirements</option><option value="all">All costable work</option></select></label>
      {missing.map(id => <div key={id} className="budget-shared-missing">Unavailable: {id} <button type="button" onClick={() => onChange(linked.filter(value => value !== id))}>Unlink unavailable work</button></div>)}
      <div className="budget-shared-choices">{[...selected, ...choices.slice(0, limit)].map(target => {
        const other = lines.filter(item => item.id !== line.id && (item.targetId === target.id || item.coveredTargetIds?.includes(target.id)));
        return <label key={target.id}><input type="checkbox" aria-label={`Cover ${target.label} (${target.id})`} checked={linked.includes(target.id)} disabled={!linked.includes(target.id) && linked.length >= BUDGET_LIMITS.coveredTargets} onChange={event => onChange(event.target.checked ? [...linked, target.id] : linked.filter(id => id !== target.id))}/><span><strong>{target.label}</strong><small>{context(target)}</small>{Boolean(other.length) && <small>Also linked to {other.map(item => item.label).join(', ')}. Confirm these are different expenses.</small>}</span></label>;
      })}</div>
      {!candidates.length && <p>No matching work. Save script or Story Bible requirements, or show all costable work.</p>}
      {choices.length > limit && <button type="button" onClick={() => setLimit(value => value + 20)}>Show more work ({choices.length - limit} remaining)</button>}
    </fieldset>
  </section>;
}
