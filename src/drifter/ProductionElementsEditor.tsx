import { PRODUCTION_ELEMENT_CATEGORIES, productionElementBudgetTarget, type ProductionElement } from '../../local/contracts/script-breakdown.mjs';

export const elementCategoryLabel = (category: string) => category.toLowerCase().replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase());

/** Edits the selected source passage's existing coverage record. No second store. */
export default function ProductionElementsEditor({ elements, paragraphId, disabled, saved, onChange, onBudget }: {
  elements: ProductionElement[]; paragraphId: string; disabled: boolean; saved: boolean;
  onChange: (elements: ProductionElement[]) => void; onBudget?: (targetId: string) => void;
}) {
  const update = (id: string, patch: Partial<ProductionElement>) => onChange(elements.map(element => element.id === id ? { ...element, ...patch } : element));
  return <div className="sw-breakdown-editor">
    <p>List what this passage needs. Save once to connect these elements to production documents and budget coverage.</p>
    {!elements.length && <p className="scope-note">No elements recorded for this passage. Read the source, then add the cast, objects, locations or effects it needs.</p>}
    {elements.map((element, index) => <fieldset key={element.id} disabled={disabled} className="sw-production-element">
      <legend>Element {index + 1}</legend>
      <label>Department / category<select aria-label={`Element ${index + 1} category`} value={element.category} onChange={event => update(element.id, { category: event.target.value as ProductionElement['category'] })}>{PRODUCTION_ELEMENT_CATEGORIES.map(category => <option key={category} value={category}>{elementCategoryLabel(category)}</option>)}</select></label>
      <label>Name<input aria-label={`Element ${index + 1} name`} value={element.name} maxLength={240} placeholder="What is needed in this passage?" onChange={event => update(element.id, { name: event.target.value })}/></label>
      <label>Quantity<input aria-label={`Element ${index + 1} quantity`} type="number" min={1} max={10000} step={1} placeholder="Unknown" value={element.quantity ?? ''} onChange={event => update(element.id, { quantity: event.target.value === '' ? null : Number(event.target.value) })}/></label>
      <label>Preparation notes<textarea aria-label={`Element ${index + 1} notes`} maxLength={2000} rows={2} value={element.notes} onChange={event => update(element.id, { notes: event.target.value })}/></label>
      <div className="sw-actions">{onBudget && <button type="button" className="secondary" disabled={!saved} onClick={() => onBudget(productionElementBudgetTarget(paragraphId, element.id))}>Budget this element</button>}<button type="button" className="text-link" onClick={() => onChange(elements.filter(item => item.id !== element.id))}>Remove element {index + 1}</button></div>
    </fieldset>)}
    <button type="button" className="secondary" disabled={disabled || elements.length >= 100} onClick={() => onChange([...elements, { id: crypto.randomUUID(), category: 'PROPS', name: '', quantity: null, notes: '' }])}>Add production element</button>
    <p className="scope-note">Quantities stay unknown until entered. An element is a planning requirement; its cost, casting and availability need separate decisions.</p>
  </div>;
}
