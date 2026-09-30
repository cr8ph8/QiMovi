import { useId, useState } from 'react';
import type { BudgetLine } from '../../local/contracts/production-budget.mjs';
import { PRESERVATION_COST_PERIODS, PRESERVATION_COST_STARTERS, preservationBudgetLineId, type PreservationCostPeriod } from './preservationBudget';

interface Props {
  lines: BudgetLine[];
  disabled: boolean;
  onAdd: (starterIds: string[], currency: string) => void;
}

export default function BudgetPreservationStarter({ lines, disabled, onAdd }: Props) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<PreservationCostPeriod>('initial');
  const [currency, setCurrency] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const existing = new Set(lines.map(line => line.id));
  const rows = PRESERVATION_COST_STARTERS.filter(row => row.period === period);
  const included = rows.filter(row => selected.includes(row.id) && !existing.has(preservationBudgetLineId(row.id)));
  return <section className="budget-preservation" aria-label="Preservation cost planning">
    <div className="budget-section-heading">
      <div><h4>Care for your film after delivery</h4><p>Plan archive preparation, storage and future migration with the rest of your budget.</p></div>
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>Plan preservation costs</button>
    </div>
    {open && <div id={panelId}>
      <fieldset disabled={disabled}>
        <div className="budget-field-grid">
          <label>Preservation planning period<select value={period} onChange={event => { setPeriod(event.target.value as PreservationCostPeriod); setSelected([]); }}>
            {PRESERVATION_COST_PERIODS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select></label>
          <label>Preservation budget currency<input value={currency} maxLength={3} placeholder="Choose USD, CAD, EUR…" onChange={event => setCurrency(event.target.value.toUpperCase())}/></label>
        </div>
        <p>{PRESERVATION_COST_PERIODS.find(item => item.id === period)?.description}</p>
        <p className="budget-footnote">Choose only the work your project needs. Every added line starts with one provisional allowance and an unknown rate. All selected periods add to this budget’s total; annual care and migration do not repeat automatically.</p>
        <ul className="budget-preservation-options">{rows.map(row => {
          const added = existing.has(preservationBudgetLineId(row.id));
          return <li key={row.id}>
            <label><input type="checkbox" disabled={added} checked={added || selected.includes(row.id)} onChange={event => setSelected(current => event.target.checked ? [...current, row.id] : current.filter(id => id !== row.id))}/>
              <span><strong>{row.label}{added && ' · already in this budget'}</strong><small>{row.note}</small><small>Source: Sheet1!{row.locator}</small></span>
            </label>
          </li>;
        })}</ul>
        <button type="button" className="budget-primary" disabled={!included.length || !/^[A-Z]{3}$/.test(currency)} onClick={() => onAdd(included.map(row => row.id), currency)}>Add selected preservation costs</button>
      </fieldset>
      <p className="budget-footnote">Adapted from the supplied IDA workshop digital preservation budget template, Sheet1. Example prices and storage volumes are not imported. Replace allowances with measured quantities and quotes; count provider work once. Added lines remain a draft until you save the budget.</p>
    </div>}
  </section>;
}
