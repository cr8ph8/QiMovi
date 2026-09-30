import { useState } from 'react';
import type { ProductionRequirementSuggestion } from './productionRequirementSuggestions';

/** Review source observations before adding them to the existing passage drafts. */
export default function SceneRequirementsReview({ suggestions, disabled, editedPassages, onAdd, onSave, onInspect }: {
  suggestions: ProductionRequirementSuggestion[]; disabled: boolean; editedPassages: number;
  onAdd(items: ProductionRequirementSuggestion[]): void; onSave(): void; onInspect(paragraphId: string): void;
}) {
  const [excluded, setExcluded] = useState<string[]>([]);
  const selected = suggestions.filter(item => !excluded.includes(item.id));
  return <section className="sw-requirement-review" aria-label="Scene production requirements">
    <header><div><h3>Build this scene’s requirements</h3><p>Start with the script’s character cues and settings, then review action passages for props, wardrobe, sound and effects.</p></div>
      <button className="primary" disabled={disabled || !editedPassages} onClick={onSave}>Save scene breakdown{editedPassages ? ` · ${editedPassages} passages` : ''}</button></header>
    {suggestions.length ? <>
      <div className="sw-requirement-candidates" role="list" aria-label="Requirements from the screenplay">{suggestions.map(item => <div role="listitem" key={item.id}>
        <label><input type="checkbox" disabled={disabled} checked={!excluded.includes(item.id)} aria-label={`Include ${item.element.name} from ${item.paragraphId}`} onChange={event => setExcluded(previous => event.target.checked ? previous.filter(id => id !== item.id) : [...previous, item.id])}/><span><b>{item.element.name}</b><small>{item.element.category === 'CAST' ? 'Cast / performance' : 'Story setting'} · quantity unknown</small></span></label>
        <button className="text-link" disabled={disabled} onClick={() => onInspect(item.paragraphId)} aria-label={`Review source ${item.paragraphId}`}><q>{item.sourceText}</q><small>{item.paragraphId}</small></button>
      </div>)}</div>
      <div className="sw-actions"><button className="secondary" disabled={disabled || !selected.length} onClick={() => onAdd(selected)}>Add {selected.length} selected requirements</button><small>Review before saving. Appearances are not separate bookings or costs.</small></div>
    </> : <p className="scope-note">No new character cues or settings to add. Inspect a passage below to develop its other production needs.</p>}
    {Boolean(editedPassages) && <p className="scope-note">Saving this scene includes the breakdown and shot-mapping edits in its {editedPassages} edited passages. Other scenes’ drafts stay open.</p>}
  </section>;
}
