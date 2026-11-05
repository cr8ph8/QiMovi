import { useEffect, useRef, useState } from 'react';
import { brandFinancingApi, type BrandApi, type BrandSnapshot, type BrandScan, type BrandCommand } from './brandFinancingApi';
import './brand-financing.css';

const blankDeal = () => ({ sponsor: '', opportunityId: '', currency: 'USD', cash: '0', extraCost: '0', marketingSupport: '0', lineId: '', saving: '0', basis: '', notes: '', dueDate: '' });
const blankPayment = () => ({ milestone: '', kind: 'receipt', amount: '', externalId: '', evidence: '', receivedDate: '', confirmed: false });
const money = (value: string | null, currency: string) => value === null ? 'Unknown / incomplete budget' : `${value} ${currency}`;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Request not confirmed. Your entry is retained.';

type Props = { projectId: string; open?: boolean; focusRequest?: number; api?: BrandApi };
export default function BrandFinancingPanel(props: Props) {
  return <BrandFinancingWorkspace key={props.projectId} {...props}/>;
}

function BrandFinancingWorkspace({ projectId, open = true, focusRequest = 0, api = brandFinancingApi }: Props) {
  const [expanded, setExpanded] = useState(false), [snapshot, setSnapshot] = useState<BrandSnapshot | null>(null);
  const [scan, setScan] = useState<BrandScan | null>(null), [sourceId, setSourceId] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [reason, setReason] = useState(''), [deal, setDeal] = useState(blankDeal), [payment, setPayment] = useState(blankPayment);
  const [decision, setDecision] = useState({ dealId: '', action: 'sign', evidence: '', confirmed: false });
  const pendingSuccess = useRef<(() => void) | undefined>(undefined);
  const pending = useRef<BrandCommand | null>(null), active = useRef(true), serial = useRef(0), lock = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; ++serial.current; }; }, []);
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (focusRequest > 0 && open && details.current) { details.current.open = true; setExpanded(true); details.current.scrollIntoView?.({ block: 'nearest' }); } }, [focusRequest, open]);
  async function refresh() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); const attempt = ++serial.current;
    try {
      const result = await api.load(projectId);
      if (!active.current || attempt !== serial.current) return;
      setSnapshot(result); setSourceId(current => result.sources.some(source => source.id === current) ? current : result.sources[0]?.id ?? '');
      pending.current = null; pendingSuccess.current = undefined; setScan(null); setNotice('Saved ledger refreshed. Unsaved form entries are retained.');
    } catch (e) { if (active.current) setError(errorText(e)); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  }
  useEffect(() => { if (expanded && open && !snapshot) void refresh(); }, [expanded, open]);
  async function runScan() {
    const source = snapshot?.sources.find(row => row.id === sourceId); if (!source || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { const result = await api.scan(projectId, source); if (active.current) { setScan(result); setNotice(`${result.opportunities.length} suggestions. Nothing was saved or approved.`); } }
    catch (e) { if (active.current) setError(errorText(e)); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  }
  async function submit(action: string, data: unknown, onSuccess?: () => void) {
    if (!snapshot || lock.current || pending.current) return;
    pending.current = { projectId, expectedVersion: snapshot.version, requestId: crypto.randomUUID(), action, data };
    pendingSuccess.current = onSuccess;
    await send();
  }
  async function send() {
    const request = pending.current; if (!request || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await api.command(request);
      if (!active.current) return;
      const onSuccess = pendingSuccess.current;
      pending.current = null; pendingSuccess.current = undefined; setSnapshot(result); setNotice(`Saved ${request.action} event. This does not authorize production, rights, or spending.`); onSuccess?.();
    } catch (e) { if (active.current) setError(errorText(e)); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  }
  function exportLedger() {
    if (!snapshot) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `brand-financing-${projectId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  const blocked = busy || Boolean(pending.current);
  const eligible = snapshot?.reviews.filter(row => row.decision === 'approved' && !row.stale) ?? [];
  return <details ref={details} className="brand-financing" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>Brand Integration &amp; Financing</summary>
    {expanded && <div aria-label="Brand financing workspace" aria-busy={busy}>
      <p>Find natural placements in saved screenplays. Review each opportunity, then track agreements and receipts separately. Nothing here grants legal clearance or changes your screenplay.</p>
      <div className="brand-actions"><button type="button" disabled={busy} onClick={() => void refresh()}>Refresh financing</button><button type="button" disabled={!snapshot || busy} onClick={exportLedger}>Export ledger JSON</button></div>
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      {pending.current && !busy && <p>A request is unconfirmed. <button type="button" onClick={() => void send()}>Retry exact request</button> Or refresh to inspect the saved ledger before submitting another action.</p>}
      {snapshot && <>
        <h4>Financing overview</h4>
        <p>Uses only the saved expense budget, not unsaved edits. Signed cash already includes received cash; never add them together. Other financing is not included.</p>
        <div className="brand-table"><table><caption>Owner-recorded financing by currency</caption><thead><tr><th>Currency</th><th>Draft cash</th><th>Signed cash</th><th>Received cash</th><th>In-kind savings</th><th>Extra costs</th><th>Remaining before other funding</th></tr></thead><tbody>{snapshot.totals.map(total => <tr key={total.currency}><th>{total.currency}</th><td>{total.proposedCash}</td><td>{total.signedCash}</td><td>{total.receivedCash}</td><td>{total.savings}</td><td>{total.extraCost}</td><td>{money(total.remainingBeforeOtherFunding, total.currency)}</td></tr>)}</tbody></table></div>
        {snapshot.totals.length === 0 && <p>No saved budget or financing yet. Unknown amounts are not treated as zero.</p>}
        {snapshot.totals.map(total => <p key={total.currency}>Net brand benefit: {money(total.netBrandBenefit, total.currency)}. Marketing support: {money(total.marketingSupport, total.currency)} (excluded from financing). Held on cancelled deals: {money(total.cancelledHeldCash, total.currency)} (excluded from available cash).</p>)}
        {snapshot.warnings.map((warning, index) => <p role="status" key={index}>{warning}</p>)}
        <h4>1. Scan a saved screenplay</h4>
        <label>Screenplay revision<select value={sourceId} disabled={blocked} onChange={event => { setSourceId(event.target.value); setScan(null); }}>{snapshot.sources.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}</select></label>
        <button type="button" disabled={blocked || !sourceId} onClick={() => void runScan()}>Scan for opportunities</button>
        {!snapshot.sources.length && <p>Save a screenplay draft or attach a production screenplay first.</p>}
        <p>Local English keyword scan; false positives are expected. It does not contact sponsors or estimate screen time or fees.</p>
        <label>Creative review reason<input value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} placeholder="Why this fits—or conflicts with—the scene"/></label>
        {scan?.truncated && <p role="status">The scan reached its 200-suggestion limit. Narrow the screenplay before relying on completeness.</p>}
        {scan?.opportunities.map(opportunity => {
          const review = snapshot.reviews.find(row => row.opportunity.id === opportunity.id);
          return <article className="brand-opportunity" key={opportunity.id}><strong>{opportunity.heading} · {opportunity.category}</strong><blockquote>{opportunity.context}</blockquote><small>Exact text: “{opportunity.quote}” · characters {opportunity.start}–{opportunity.end} · source {opportunity.source.sourceHash.slice(0, 12)}</small><p>{opportunity.reason}</p><p>{review ? `Review: ${review.decision}${review.stale ? ' · stale' : ''}` : 'Unreviewed proposal'}</p><div className="brand-actions">{(['approved', 'rejected'] as const).map(value => <button key={value} type="button" disabled={blocked || !reason.trim()} onClick={() => void submit('review', { sourceId, sourceFingerprint: opportunity.source.fingerprint, opportunityId: opportunity.id, decision: value, reason })}>{value === 'approved' ? 'Approve creative opportunity' : 'Reject opportunity'}</button>)}</div></article>;
        })}
        <details><summary>Saved opportunity reviews ({snapshot.reviews.length})</summary>{snapshot.reviews.map(review => <p key={review.opportunity.id}>{review.opportunity.heading} · {review.opportunity.quote}: {review.decision}{review.stale ? ' · STALE—scan the new revision' : ''}. {review.reason}</p>)}</details>
        <h4>2. Draft a sponsorship deal</h4>
        <form onSubmit={event => {
          event.preventDefault();
          const dealId = `deal:${crypto.randomUUID()}`;
          void submit('deal', { budgetHash: snapshot.budget.recordRef?.sha256 ?? null, deal: {
            id: dealId, sponsor: deal.sponsor, opportunityId: deal.opportunityId, currency: deal.currency, cash: deal.cash, extraCost: deal.extraCost,
            marketingSupport: deal.marketingSupport, notes: deal.notes,
            savings: deal.lineId ? [{ lineId: deal.lineId, amount: deal.saving, basis: deal.basis }] : [],
            milestones: /^0(?:\.0+)?$/.test(deal.cash) ? [] : [{ id: 'payment-1', label: 'Contract payment', amount: deal.cash, dueDate: deal.dueDate || null }],
          } }, () => setDeal(blankDeal()));
        }}><fieldset disabled={blocked}><legend>Draft only—does not count as secured funding</legend><div className="brand-grid">
          <label>Sponsor<input required maxLength={160} value={deal.sponsor} onChange={event => setDeal({ ...deal, sponsor: event.target.value })}/></label>
          <label>Approved opportunity<select required value={deal.opportunityId} onChange={event => setDeal({ ...deal, opportunityId: event.target.value })}><option value="">Choose a reviewed opportunity</option>{eligible.map(review => <option key={review.opportunity.id} value={review.opportunity.id}>{review.opportunity.heading} · {review.opportunity.quote}</option>)}</select></label>
          <label>Currency<input required pattern="[A-Z]{3}" maxLength={3} value={deal.currency} onChange={event => setDeal({ ...deal, currency: event.target.value.toUpperCase(), lineId: '' })}/></label>
          {(['cash', 'extraCost', 'marketingSupport'] as const).map(key => <label key={key}>{({ cash: 'Contract cash', extraCost: 'Additional fulfillment cost—not already budgeted', marketingSupport: 'Brand-paid marketing (not production cash)' })[key]}<input required inputMode="decimal" value={deal[key]} onChange={event => setDeal({ ...deal, [key]: event.target.value })}/></label>)}
          <label>Payment due date (optional)<input type="date" value={deal.dueDate} onChange={event => setDeal({ ...deal, dueDate: event.target.value })}/></label>
          <label>In-kind budget line<select value={deal.lineId} onChange={event => setDeal({ ...deal, lineId: event.target.value })}><option value="">No in-kind savings</option>{snapshot.budget.lines.filter(line => line.currency === deal.currency).map(line => <option key={line.id} value={line.id}>{line.label} · {line.estimate ?? 'unpriced'}</option>)}</select></label>
          {deal.lineId && <><label>Avoided expense<input required inputMode="decimal" value={deal.saving} onChange={event => setDeal({ ...deal, saving: event.target.value })}/></label><label>Replacement-cost evidence<input required maxLength={1000} value={deal.basis} onChange={event => setDeal({ ...deal, basis: event.target.value })}/></label></>}
          <label>Deliverables, restrictions and cost assumptions<textarea required maxLength={2000} value={deal.notes} onChange={event => setDeal({ ...deal, notes: event.target.value })}/></label>
        </div><p>Extra costs must exclude amounts already in the expense budget. In-kind savings replace priced expenses, not product retail value. The MVP form creates one payment milestone; the API accepts up to 30.</p><button type="submit">Save draft deal</button></fieldset></form>
        <h4>3. Record a signed agreement or cancellation</h4>
        {snapshot.deals.map(row => <p key={row.id}><strong>{row.sponsor}</strong> · {row.status} · {money(row.cash, row.currency)} · {row.notes}</p>)}
        <form onSubmit={event => { event.preventDefault(); void submit(decision.action, { dealId: decision.dealId, evidence: decision.evidence, confirmed: decision.confirmed }, () => setDecision({ dealId: '', action: 'sign', evidence: '', confirmed: false })); }}><fieldset disabled={blocked}><legend>Owner-confirmed agreement status</legend><div className="brand-grid">
          <label>Agreement<select required value={decision.dealId} onChange={event => setDecision({ ...decision, dealId: event.target.value, confirmed: false })}><option value="">Choose a deal</option>{snapshot.deals.filter(row => row.status !== 'cancelled').map(row => <option key={row.id} value={row.id}>{row.sponsor} · {row.status}</option>)}</select></label>
          <label>Action<select value={decision.action} onChange={event => setDecision({ ...decision, action: event.target.value, confirmed: false })}><option value="sign">Record signed contract</option><option value="cancel">Cancel deal</option></select></label>
          <label>Contract / cancellation evidence reference<textarea required maxLength={2000} value={decision.evidence} onChange={event => setDecision({ ...decision, evidence: event.target.value, confirmed: false })}/></label>
        </div><label className="brand-confirm"><input type="checkbox" required checked={decision.confirmed} onChange={event => setDecision({ ...decision, confirmed: event.target.checked })}/>I reviewed the agreement and have authority to record this status. This is not independent legal verification.</label><button type="submit" disabled={!decision.confirmed}>Record agreement status</button></fieldset></form>
        <h4>4. Record cash actually received or refunded</h4>
        <form onSubmit={event => { event.preventDefault(); const [dealId, ...milestoneParts] = payment.milestone.split('|'); const milestoneId = milestoneParts.join('|'); void submit('payment', { dealId, milestoneId, kind: payment.kind, amount: payment.amount, externalId: payment.externalId, evidence: payment.evidence, receivedDate: payment.receivedDate, confirmed: payment.confirmed }, () => setPayment(blankPayment())); }}><fieldset disabled={blocked}><legend>Evidence-backed owner entry, not a bank connection</legend><div className="brand-grid">
          <label>Payment milestone<select required value={payment.milestone} onChange={event => setPayment({ ...payment, milestone: event.target.value, confirmed: false })}><option value="">Choose a milestone</option>{snapshot.deals.filter(row => row.signedAt).flatMap(row => row.milestones.map(milestone => <option key={`${row.id}|${milestone.id}`} value={`${row.id}|${milestone.id}`}>{row.sponsor} · {milestone.label} · {row.currency}</option>))}</select></label>
          <label>Payment type<select value={payment.kind} onChange={event => setPayment({ ...payment, kind: event.target.value, confirmed: false })}><option value="receipt">Cash received</option><option value="refund">Refund paid</option></select></label>
          <label>Payment amount<input required inputMode="decimal" value={payment.amount} onChange={event => setPayment({ ...payment, amount: event.target.value, confirmed: false })}/></label>
          <label>External transaction reference<input required maxLength={200} value={payment.externalId} onChange={event => setPayment({ ...payment, externalId: event.target.value, confirmed: false })}/></label>
          <label>Payment evidence<textarea required maxLength={2000} value={payment.evidence} onChange={event => setPayment({ ...payment, evidence: event.target.value, confirmed: false })}/></label>
          <label>Receipt / refund date<input required type="date" value={payment.receivedDate} onChange={event => setPayment({ ...payment, receivedDate: event.target.value, confirmed: false })}/></label>
        </div><label className="brand-confirm"><input required type="checkbox" checked={payment.confirmed} onChange={event => setPayment({ ...payment, confirmed: event.target.checked })}/>I checked the evidence and confirm the money moved.</label><button type="submit" disabled={!payment.confirmed}>Record payment</button></fieldset></form>
        <details><summary>Payment schedule, receipts &amp; audit</summary>
          {snapshot.schedule.map(row => <p key={`${row.dealId}:${row.milestoneId}`}>{row.sponsor} · {row.label} · due {row.dueDate ?? 'unknown'} · outstanding {money(row.outstanding, row.currency)}</p>)}
          {snapshot.payments.map(row => <p key={row.externalId}>{row.receivedDate} · {row.kind} · {row.amount} · {row.externalId} · {row.evidence}</p>)}
          <p>Ledger v{snapshot.version} · {snapshot.headHash}. Local hash chaining detects accidental changes; it is not an external audit anchor.</p>
          <p>Remaining requirement = saved budget − current in-kind savings + additional fulfillment costs − signed cash. Marketing support and draft cash are excluded. Cancelled deals retain their recorded fulfillment costs and receipts; outstanding commitments are removed.</p>
        </details>
      </>}
    </div>}
  </details>;
}
