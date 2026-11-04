import { useEffect, useState } from 'react';
import { brandFinancingApi, type BrandApi, type BrandSnapshot } from './brandFinancingApi';
import './brand-financing.css';

/** A read-only companion in every desktop workflow. Never scans or writes on navigation. */
export default function BrandWorkflowPanel({ projectId, sceneId, stage, active = true, revisionKey = '', onOpenFinance, api = brandFinancingApi }: {
  projectId: string; sceneId?: string; stage: string; active?: boolean; revisionKey?: string;
  onOpenFinance: () => void; api?: BrandApi;
}) {
  const [expanded, setExpanded] = useState(false), [snapshot, setSnapshot] = useState<BrandSnapshot | null>(null);
  const [error, setError] = useState(''), [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(false);
  useEffect(() => {
    const changed = () => setRefresh(value => value + 1);
    window.addEventListener('qimovi:brand-financing-changed', changed);
    return () => window.removeEventListener('qimovi:brand-financing-changed', changed);
  }, []);
  useEffect(() => {
    let cancelled = false; setSnapshot(null); setError(''); setLoading(false);
    if (expanded && active) {
      setLoading(true);
      void api.load(projectId).then(value => { if (!cancelled) setSnapshot(value); })
        .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Financing unavailable.'); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }
    return () => { cancelled = true; };
  }, [projectId, sceneId, stage, active, expanded, revisionKey, refresh, api]);
  const reviews = snapshot?.reviews.filter(row => !sceneId || row.opportunity.source.id === 'production' && row.opportunity.productionSceneId === sceneId) ?? [];
  return <section className="brand-financing" aria-label="Brand workflow companion" hidden={!active}>
    <div className="brand-actions"><strong>Brand placements · {stage}</strong><button type="button" onClick={onOpenFinance}>Open brand financing</button></div>
    <details onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>Review placement context{sceneId ? ' for this production scene' : ' across saved drafts'}</summary>
      {expanded && <div aria-busy={loading}>
        <p>Suggestions and creative reviews never change the script. During production and delivery, review agreed obligations against actual footage; a planned placement is not proof of delivery.</p>
        <button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh placement context</button>
        {error && <p role="alert">{error}</p>}
        {snapshot && <>
          <p>Project financing · ledger v{snapshot.version}. Totals cover the entire project, not this scene. Signed cash includes received cash.</p>
          {snapshot.totals.map(row => <p key={row.currency}>{row.currency}: signed {row.signedCash}; received {row.receivedCash}; remaining before other funding {row.remainingBeforeOtherFunding ?? 'unknown'}.</p>)}
          {snapshot.warnings.map((warning, index) => <p role="status" key={index}>{warning}</p>)}
          {reviews.length === 0 && <p>No reviewed placements in this context. Use the financing workspace to scan a saved screenplay. Draft reviews are not automatically applied to production scenes.</p>}
          {reviews.map(review => <article key={review.opportunity.id}>
            <h4>{review.opportunity.heading} · {review.opportunity.category}</h4>
            <blockquote>{review.opportunity.context}</blockquote>
            <p>{review.stale ? 'STALE — review the changed screenplay' : review.decision} · {review.reason}</p>
            {snapshot.deals.filter(deal => deal.opportunityId === review.opportunity.id).map(deal => <p key={deal.id}>{deal.sponsor}: {deal.status}. {deal.notes}</p>)}
          </article>)}
        </>}
      </div>}
    </details>
  </section>;
}
