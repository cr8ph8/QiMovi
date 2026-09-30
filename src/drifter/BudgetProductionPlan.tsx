import type { BudgetLine } from '../../local/contracts/production-budget.mjs';

type Plan = NonNullable<BudgetLine['productionPlan']>;
const blank: Plan = { method: 'undecided', departmentOwner: '', startDate: null, endDate: null, quantityBasis: '', notes: '' };
export default function BudgetProductionPlan({ line, disabled, onChange }: {
  line: BudgetLine; disabled: boolean; onChange(plan: Plan): void;
}) {
  const plan = line.productionPlan ?? blank;
  const update = (patch: Partial<Plan>) => onChange({ ...plan, ...patch });
  return <section className="budget-production-plan" aria-label="Production approach and schedule">
    <h5>Production approach & schedule</h5>
    <p>Describe how the work will be made before pricing it. Dates are planning windows; they do not book a crew or change payment dates.</p>
    <fieldset disabled={disabled}><div className="budget-field-grid">
      <label>Production method<select value={plan.method} onChange={event => update({ method: event.target.value as Plan['method'] })}>
        <option value="undecided">To decide</option><option value="live-action">Live action</option><option value="virtual">Virtual production / 3D</option><option value="generated">AI generation</option><option value="hybrid">Hybrid</option>
      </select></label>
      <label>Department lead<input maxLength={240} value={plan.departmentOwner} placeholder="Unassigned" onChange={event => update({ departmentOwner: event.target.value })}/></label>
      <label>Work starts<input type="date" value={plan.startDate ?? ''} onChange={event => update({ startDate: event.target.value || null })}/></label>
      <label>Work ends<input type="date" min={plan.startDate ?? undefined} value={plan.endDate ?? ''} onChange={event => update({ endDate: event.target.value || null })}/></label>
      <label className="budget-wide">Quantity basis<textarea maxLength={2000} value={plan.quantityBasis} rows={2} placeholder="e.g. Rehearsal days + shoot days; schedule still to confirm" onChange={event => update({ quantityBasis: event.target.value })}/><small>Explain the quantity and unit used in this cost line. Describing days here does not change the estimate automatically.</small></label>
      <label className="budget-wide">Production decisions & open questions<textarea maxLength={4000} value={plan.notes} rows={3} placeholder="Required work, references, alternatives and decisions still needed…" onChange={event => update({ notes: event.target.value })}/></label>
    </div></fieldset>
  </section>;
}
