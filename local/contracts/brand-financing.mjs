export { scanBrandOpportunities } from './brand-scanner.mjs';

export const BRAND_SCHEMA = 'qimovi-brand-financing/v1';
export const BRAND_LIMITS = Object.freeze({ events: 2000, opportunities: 200, sourceBytes: 800000, requestBytes: 32768 });
const SCALE = 1000000000n;
const MAX = 10n ** 27n - 1n;
export function requireBrand(ok, code, status = 422) {
  if (!ok) throw Object.assign(new Error(code), { code, status });
}
export function brandShape(value, keys) {
  requireBrand(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), 'BRAND_FIELDS_INVALID');
}
function checkedText(value, max, controls) {
  requireBrand(typeof value === 'string' && value.trim().length > 0 && value.length <= max &&
    !controls.test(value) && value.isWellFormed(), 'BRAND_TEXT_INVALID');
  return value;
}
export function brandText(value, max = 500) {
  return checkedText(value, max, /[\x00-\x1f\x7f]/);
}
/** Preserve textarea line endings exactly. Only tab, LF and CR are allowed controls. */
export function brandNarrative(value, max = 2000) {
  return checkedText(value, max, /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);
}
export function brandDate(value) {
  requireBrand(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, 'BRAND_DATE_INVALID');
  return value;
}
export function brandAmount(value) {
  requireBrand(typeof value === 'string' && /^(?:0|[1-9]\d{0,17})(?:\.\d{1,9})?$/.test(value), 'BRAND_AMOUNT_INVALID');
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * SCALE + BigInt(fraction.padEnd(9, '0'));
  requireBrand(amount <= MAX, 'BRAND_AMOUNT_OVERFLOW');
  return amount;
}
export function brandDecimal(value) {
  requireBrand(value >= -MAX && value <= MAX, 'BRAND_AMOUNT_OVERFLOW');
  const sign = value < 0n ? '-' : '', n = value < 0n ? -value : value;
  const fraction = String(n % SCALE).padStart(9, '0').replace(/0+$/, '');
  return `${sign}${n / SCALE}${fraction ? `.${fraction}` : ''}`;
}
const sum = values => values.reduce((n, value) => n + brandAmount(value), 0n);
export function validateBrandDeal(deal) {
  brandShape(deal, ['id', 'sponsor', 'opportunityId', 'currency', 'cash', 'extraCost', 'marketingSupport', 'savings', 'milestones', 'notes']);
  requireBrand(typeof deal.id === 'string' && /^deal:[a-zA-Z0-9-]{1,80}$/.test(deal.id), 'BRAND_DEAL_ID_INVALID');
  brandText(deal.sponsor, 160); brandText(deal.opportunityId, 160); brandNarrative(deal.notes, 2000);
  requireBrand(typeof deal.currency === 'string' && /^[A-Z]{3}$/.test(deal.currency), 'BRAND_CURRENCY_INVALID');
  for (const field of ['cash', 'extraCost', 'marketingSupport']) brandAmount(deal[field]);
  requireBrand(Array.isArray(deal.savings) && deal.savings.length <= 30 && Array.isArray(deal.milestones) && deal.milestones.length <= 30, 'BRAND_DEAL_LIMIT');
  const lines = new Set(), milestones = new Set();
  for (const saving of deal.savings) {
    brandShape(saving, ['lineId', 'amount', 'basis']); brandText(saving.lineId); brandNarrative(saving.basis, 1000);
    requireBrand(!lines.has(saving.lineId) && brandAmount(saving.amount) > 0n, 'BRAND_SAVING_INVALID'); lines.add(saving.lineId);
  }
  for (const milestone of deal.milestones) {
    brandShape(milestone, ['id', 'label', 'amount', 'dueDate']); brandText(milestone.id, 120); brandText(milestone.label, 240);
    requireBrand(!milestones.has(milestone.id) && brandAmount(milestone.amount) > 0n, 'BRAND_MILESTONE_INVALID'); milestones.add(milestone.id);
    if (milestone.dueDate !== null) brandDate(milestone.dueDate);
  }
  requireBrand(sum(deal.milestones.map(row => row.amount)) === brandAmount(deal.cash), 'BRAND_MILESTONE_TOTAL_MISMATCH');
  return deal;
}

/** Rebuild disposable views from immutable events. No external payment claim. */
export function projectBrandEvents(events) {
  const reviews = new Map(), deals = new Map(), payments = [];
  for (const event of events) {
    const data = event.data;
    if (event.action === 'review') reviews.set(data.opportunity.id, { ...data, reviewedAt: event.at, actorId: event.actorId });
    else if (event.action === 'deal') { requireBrand(!deals.has(data.deal.id), 'BRAND_LEDGER_INVALID', 409); deals.set(data.deal.id, { ...data.deal, budgetHash: data.budgetHash, status: 'draft' }); }
    else if (event.action === 'sign' || event.action === 'cancel') {
      const deal = deals.get(data.dealId); requireBrand(deal, 'BRAND_LEDGER_INVALID', 409);
      deal.status = event.action === 'sign' ? 'signed' : 'cancelled';
      if (event.action === 'sign') { deal.contractEvidence = data.evidence; deal.signedAt = event.at; }
    } else if (event.action === 'payment') payments.push({ ...data, recordedAt: event.at });
    else requireBrand(false, 'BRAND_LEDGER_INVALID', 409);
  }
  return { reviews: [...reviews.values()], deals: [...deals.values()], payments };
}

export function calculateBrandFinancing(state, budget, sources) {
  const byCurrency = new Map(), warnings = [], schedule = [];
  const currentSource = new Map(sources.map(source => [source.id, source.fingerprint]));
  const stale = review => currentSource.get(review.opportunity.source.id) !== review.opportunity.source.fingerprint;
  const group = currency => {
    if (!byCurrency.has(currency)) byCurrency.set(currency, { currency, proposedCash: 0n, signedCash: 0n, receivedCash: 0n,
      availableReceivedCash: 0n, cancelledHeldCash: 0n, savings: 0n, extraCost: 0n, marketingSupport: 0n });
    return byCurrency.get(currency);
  };
  for (const total of budget.report.totals) if (/^[A-Z]{3}$/.test(total.currency)) group(total.currency);
  for (const deal of state.deals) {
    const total = group(deal.currency), review = state.reviews.find(row => row.opportunity.id === deal.opportunityId);
    if (!review || stale(review) || review.decision !== 'approved') warnings.push(`${deal.sponsor}: placement needs source/creative review.`);
    if (deal.status === 'draft') total.proposedCash += brandAmount(deal.cash);
    if (deal.signedAt) total.extraCost += brandAmount(deal.extraCost);
    if (deal.status === 'signed') {
      total.signedCash += brandAmount(deal.cash); total.marketingSupport += brandAmount(deal.marketingSupport);
      if (deal.budgetHash === budget.record?.sha256) total.savings += sum(deal.savings.map(row => row.amount));
      else if (deal.savings.length) warnings.push(`${deal.sponsor}: budget changed; in-kind savings excluded until replaced with a reviewed deal.`);
    }
    let received = 0n;
    for (const milestone of deal.milestones) {
      const paid = state.payments.filter(payment => payment.dealId === deal.id && payment.milestoneId === milestone.id)
        .reduce((n, payment) => n + (payment.kind === 'refund' ? -1n : 1n) * brandAmount(payment.amount), 0n);
      received += paid;
      if (deal.status === 'signed') schedule.push({ dealId: deal.id, sponsor: deal.sponsor, milestoneId: milestone.id,
        label: milestone.label, dueDate: milestone.dueDate, currency: deal.currency, amount: milestone.amount,
        received: brandDecimal(paid), outstanding: brandDecimal(brandAmount(milestone.amount) - paid) });
    }
    total.receivedCash += received;
    if (deal.status === 'signed') total.availableReceivedCash += received;
    else if (deal.status === 'cancelled') total.cancelledHeldCash += received;
  }
  const totals = [...byCurrency.values()].map(total => {
    const estimate = budget.report.totals.find(row => row.currency === total.currency)?.estimate;
    const baseline = estimate === null || estimate === undefined || !budget.record ? null : brandAmount(estimate);
    const requirement = baseline === null ? null : baseline - total.savings + total.extraCost;
    const remaining = requirement === null ? null : requirement - total.signedCash;
    return { ...Object.fromEntries(Object.entries(total).map(([key, value]) => [key, typeof value === 'bigint' ? brandDecimal(value) : value])),
      budgetEstimate: baseline === null ? null : brandDecimal(baseline), adjustedRequirement: requirement === null ? null : brandDecimal(requirement),
      netBrandBenefit: brandDecimal(total.signedCash + total.savings - total.extraCost),
      remainingBeforeOtherFunding: remaining === null ? null : brandDecimal(remaining > 0n ? remaining : 0n),
      surplus: remaining !== null && remaining < 0n ? brandDecimal(-remaining) : '0',
      outstandingCash: brandDecimal(total.signedCash - total.availableReceivedCash) };
  });
  return { totals, warnings, schedule: schedule.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')),
    reviews: state.reviews.map(review => ({ ...review, stale: stale(review) })) };
}
