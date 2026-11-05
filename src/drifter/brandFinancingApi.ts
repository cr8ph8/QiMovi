export type BrandSource = { id: string; label: string; fingerprint: string; sourceHash: string; recordRef: { id: string; version: number; sha256: string } | null };
export type BrandOpportunity = { id: string; source: BrandSource; scriptSceneId: string; productionSceneId: string | null; heading: string; category: string; start: number; end: number; quote: string; context: string; reason: string };
export type BrandReview = { opportunity: BrandOpportunity; decision: 'approved' | 'rejected'; reason: string; stale: boolean; reviewedAt: string };
export type BrandDeal = { id: string; sponsor: string; opportunityId: string; currency: string; cash: string; extraCost: string; marketingSupport: string; savings: { lineId: string; amount: string; basis: string }[]; milestones: { id: string; label: string; amount: string; dueDate: string | null }[]; notes: string; status: 'draft' | 'signed' | 'cancelled'; signedAt?: string; contractEvidence?: string };
export type BrandSnapshot = {
  schemaVersion: 'qimovi-brand-financing/v1'; projectId: string; version: number; headHash: string; sources: BrandSource[];
  reviews: BrandReview[]; deals: BrandDeal[]; payments: { dealId: string; milestoneId: string; kind: string; amount: string; externalId: string; evidence: string; receivedDate: string }[];
  budget: { recordRef: { id: string; version: number; sha256: string } | null; lines: { id: string; label: string; currency: string; estimate: string | null; actual: string | null; committed: string }[] };
  totals: { currency: string; proposedCash: string; signedCash: string; receivedCash: string; availableReceivedCash: string; cancelledHeldCash: string; savings: string; extraCost: string; marketingSupport: string; budgetEstimate: string | null; adjustedRequirement: string | null; netBrandBenefit: string; remainingBeforeOtherFunding: string | null; surplus: string; outstandingCash: string }[];
  warnings: string[]; schedule: { dealId: string; milestoneId: string; sponsor: string; label: string; dueDate: string | null; currency: string; amount: string; received: string; outstanding: string }[];
  events: unknown[]; authority: 'OWNER_RECORDED_PLANNING_ONLY'; externalVerification: false; approvalGranted: false;
};
export type BrandScan = { schemaVersion: string; projectId: string; source: BrandSource; opportunities: BrandOpportunity[]; truncated: boolean; method: string; approvalGranted: false };
export type BrandCommand = { projectId: string; expectedVersion: number; requestId: string; action: string; data: unknown };
export type BrandApi = { load(projectId: string): Promise<BrandSnapshot>; scan(projectId: string, source: BrandSource): Promise<BrandScan>; command(request: BrandCommand): Promise<BrandSnapshot> };
const messages: Record<string, string> = {
  BRAND_VERSION_CONFLICT: 'The ledger changed. Refresh, review the new state, and submit again.',
  BRAND_SOURCE_CHANGED: 'The saved screenplay changed. Scan and review its new revision.',
  BRAND_DUPLICATE_PAYMENT: 'That external payment reference is already recorded.',
  BRAND_PAYMENT_EXCEEDS_MILESTONE: 'The payment or refund exceeds the outstanding or received milestone amount.',
  BRAND_BUDGET_CHANGED: 'The saved budget changed. Refresh and create a replacement draft deal for the new cost basis.',
  BRAND_SAVING_EXCEEDS_COST: 'Combined in-kind savings exceed the linked budget expense.',
  BRAND_SAVING_BASIS_INVALID: 'Savings need a priced, unspent, uncommitted budget line in the same currency.',
  BRAND_AMOUNT_INVALID: 'Use a nonnegative decimal amount, without currency symbols or commas.',
  BRAND_CONFIRMATION_REQUIRED: 'An explicit owner confirmation is required.',
  BRAND_OPPORTUNITY_NOT_APPROVED: 'Review and approve the placement before creating or signing a deal.',
};
async function request(route: string, body?: unknown) {
  const response = await fetch(`/api/brand-financing${route}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'error',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) { const code = String(data?.error ?? 'BRAND_REQUEST_REJECTED'); throw new Error(messages[code] ?? `Request not confirmed (${code}). Your entry is retained.`); }
  return data;
}
function verify(data: BrandSnapshot, projectId: string) {
  if (data?.schemaVersion !== 'qimovi-brand-financing/v1' || data.projectId !== projectId || !Number.isSafeInteger(data.version) ||
    data.version < 0 || !/^[a-f0-9]{64}$/.test(data.headHash) || data.authority !== 'OWNER_RECORDED_PLANNING_ONLY' ||
    data.externalVerification !== false || data.approvalGranted !== false ||
    ![data.sources, data.reviews, data.deals, data.payments, data.totals, data.warnings, data.schedule, data.events, data.budget?.lines].every(Array.isArray))
    throw new Error('The financing response could not be verified. Refresh before continuing.');
  return data;
}
function sameSource(value: unknown, expected: BrandSource): boolean {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<BrandSource>;
  const record = source.recordRef, wanted = expected.recordRef;
  return source.id === expected.id && source.fingerprint === expected.fingerprint && source.sourceHash === expected.sourceHash &&
    (wanted === null ? record === null : Boolean(record && record.id === wanted.id && record.version === wanted.version && record.sha256 === wanted.sha256));
}
function validOpportunity(value: unknown, source: BrandSource): boolean {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<BrandOpportunity>;
  return typeof row.id === 'string' && row.id.startsWith('placement:') && row.id.length <= 160 && sameSource(row.source, source) &&
    typeof row.scriptSceneId === 'string' && typeof row.heading === 'string' && typeof row.context === 'string' && typeof row.reason === 'string' &&
    (row.productionSceneId === null || typeof row.productionSceneId === 'string') &&
    ['beverage', 'food', 'technology', 'vehicle', 'wardrobe', 'location'].includes(row.category ?? '') &&
    Number.isSafeInteger(row.start) && Number.isSafeInteger(row.end) && row.start! >= 0 && row.end! <= 800000 &&
    typeof row.quote === 'string' && row.quote.length > 0 && row.end! - row.start! === row.quote.length;
}
export const brandFinancingApi: BrandApi = {
  async load(projectId) { return verify(await request(''), projectId); },
  async scan(projectId, source) {
    const data = await request('/scan', { projectId, sourceId: source.id, sourceFingerprint: source.fingerprint });
    if (data?.schemaVersion !== 'qimovi-brand-financing/v1' || data.projectId !== projectId || !sameSource(data.source, source) ||
      data.method !== 'LOCAL_KEYWORD_HEURISTIC' || typeof data.truncated !== 'boolean' || data.approvalGranted !== false ||
      !Array.isArray(data.opportunities) || data.opportunities.length > 200 ||
      !data.opportunities.every((row: unknown) => validOpportunity(row, source)) ||
      new Set(data.opportunities.map((row: BrandOpportunity) => row.id)).size !== data.opportunities.length) throw new Error('The scan response could not be verified.');
    return data;
  },
  async command(input) {
    const result = verify(await request('/command', input), input.projectId);
    if (result.version <= input.expectedVersion) throw new Error('The financing write was not confirmed. Retry the exact request.');
    window.dispatchEvent(new Event('qimovi:brand-financing-changed'));
    return result;
  },
};
