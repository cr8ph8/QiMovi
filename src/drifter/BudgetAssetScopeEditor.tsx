import type { BudgetTarget } from '../../local/contracts/production-budget.mjs';

export type AssetScopeEntry = { targetId: string; usage: 'unreviewed' | 'production' | 'reference-only'; basis: string; contextKey: string };
export default function BudgetAssetScopeEditor({ target, entry, disabled, stale, onChange, onApply, onCancel }: {
  target?: BudgetTarget; entry: AssetScopeEntry; disabled: boolean; stale: boolean;
  onChange(entry: AssetScopeEntry): void; onApply(): void; onCancel(): void;
}) {
  return <section className="budget-asset-scope" aria-label="Asset production use">
    <div className="budget-section-heading"><h4>Asset production use</h4><button disabled={disabled} onClick={onCancel}>Cancel scope entry</button></div>
    <strong>{target?.label ?? entry.targetId}</strong>
    <p>Choose how this retained file is used in this film. The file stays in the Library.</p>
    {(!target || stale) && <p role="alert">The asset or its project links changed. Cancel this entry and reopen the asset to review its current use.</p>}
    <fieldset disabled={disabled || !target || stale}>
      <div className="budget-field-grid">
        <label>Asset use<select value={entry.usage} onChange={event => onChange({ ...entry, usage: event.target.value as AssetScopeEntry['usage'] })}>
          <option value="unreviewed">Not reviewed</option><option value="production">Production use</option><option value="reference-only">Reference only</option>
        </select></label>
        <label className="budget-wide">Scope decision basis<textarea value={entry.basis} maxLength={2000} rows={3} disabled={entry.usage === 'unreviewed'} onChange={event => onChange({ ...entry, basis: event.target.value })} placeholder="Why is this file a reference, or what production work needs costing?"/></label>
      </div>
      <p className="budget-footnote">Reference only removes this file’s missing-allocation requirement. Existing estimates, commitments and actual costs remain. This does not clear rights or approve production use. New project links require a fresh review.</p>
      <button className="budget-primary" disabled={entry.usage !== 'unreviewed' && !entry.basis.trim()} onClick={onApply}>Apply scope to budget draft</button>
      {entry.usage !== 'unreviewed' && !entry.basis.trim() && <span className="budget-scope-reason"> Add a reason to apply this decision.</span>}
    </fieldset>
  </section>;
}
