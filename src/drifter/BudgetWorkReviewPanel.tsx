import { useState } from 'react';
import type { BudgetOverlapCandidate, BudgetWorkReview } from './budgetWorkReview';
export default function BudgetWorkReviewPanel({ review, disabled, onPricing, onWork, onOverlap }: {
  review: BudgetWorkReview; disabled: boolean; onPricing(): void;
  onWork(label: string, targetIds: string[], reviewKey: 'requirementTargetIds' | 'libraryAssetTargetIds' | 'otherWorkTargetIds'): void; onOverlap(candidate: BudgetOverlapCandidate): void;
}) {
  const [shown, setShown] = useState(6);
  return <section className="budget-work-review" aria-label="Production cost review">
    <h4>Review the work before pricing</h4>
    <p>Whole-project review. Missing rates, missing requirements and reference assets are different decisions.</p>
    <div className="budget-review-actions">
      <button disabled={disabled || !review.unpricedLineIds.length} onClick={onPricing}>{review.unpricedLineIds.length} cost lines need rates</button>
      <button disabled={disabled || !review.requirementTargetIds.length} onClick={() => onWork('Script & world requirements without cost lines', review.requirementTargetIds, 'requirementTargetIds')}>{review.requirementTargetIds.length} requirements need allocation</button>
      <button disabled={disabled || !review.libraryAssetTargetIds.length} onClick={() => onWork('Library assets to review for production use', review.libraryAssetTargetIds, 'libraryAssetTargetIds')}>{review.libraryAssetTargetIds.length} library assets need scope review</button>
      <button disabled={disabled || !review.otherWorkTargetIds.length} onClick={() => onWork('Other work without cost lines', review.otherWorkTargetIds, 'otherWorkTargetIds')}>{review.otherWorkTargetIds.length} other work items need allocation</button>
    </div>
    <p className="budget-footnote">Use Review use on an asset to record Production use or Reference only with a reason. References stay in the Library; existing costs remain. Unreviewed items stay unresolved.</p>
    <h5>Possible overlapping allowances · {review.overlapCandidates.length}</h5>
    <p>Compare what each expense covers. Keep separate costs for different work; revise or remove an unused allowance only after reviewing it.</p>
    {review.overlapCandidates.length === 0 ? <p>No overlap found through shared links or department allowances. Similar wording and unrecorded work still need review.</p> : <ul>{review.overlapCandidates.slice(0, shown).map(candidate => <li key={candidate.id}><div><strong>{candidate.label}</strong><span>{candidate.type === 'department-allowance' ? 'Department allowance and detailed costs may describe the same work.' : 'Several cost lines link to the same requirement.'} {candidate.lineIds.length} lines to compare.</span></div><button disabled={disabled} onClick={() => onOverlap(candidate)}>Compare {candidate.label}</button></li>)}</ul>}
    {shown < review.overlapCandidates.length && <button onClick={() => setShown(value => value + 6)}>Show more overlap groups</button>}
  </section>;
}
