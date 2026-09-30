import type { ParityDeal, WaterfallLine, WaterfallResult } from "./types";

/**
 * Computes a Sing Sing-style waterfall from gross receipts.
 * Pure function — no side effects, deterministic.
 *
 * Formulas mirror the source PDF:
 *   AGR = Gross - distribution fee - foreign sales comm - CAM - distribution costs (modeled 0)
 *        - capped P&A - residuals - approved overhead
 *   InvestorSeniorPaid = min(AGR, capital * hurdle)
 *   DeferredPaid       = min(max(AGR - InvSenior, 0), deferred)
 *   NetPool            = max(AGR - InvSenior - DeferredPaid, 0)
 *   InvestorTail/CreatorIP/Contributor split NetPool by pool %.
 */
export function computeWaterfall(deal: ParityDeal, grossReceipts: number): WaterfallResult {
  const lines: WaterfallLine[] = [];
  lines.push({ label: "Gross Receipts (actually collected)", amount: grossReceipts, isTotal: true });

  const distFee = grossReceipts * (deal.distribution_fee_pct / 100);
  const foreignComm = grossReceipts * (deal.foreign_sales_commission_pct / 100);
  const camFee = grossReceipts * (deal.cam_fee_pct / 100);
  // P&A and overhead are CAPPED — they apply up to their cap, not a percentage.
  const pa = Math.min(deal.pa_cap_usd, grossReceipts * 0.15);
  const overhead = Math.min(deal.overhead_cap_usd, grossReceipts * 0.05);
  const residuals = grossReceipts * (deal.residuals_pct / 100);

  if (distFee) lines.push({ label: `Distribution fee (${deal.distribution_fee_pct}%)`, amount: -distFee, isDeduction: true });
  if (foreignComm) lines.push({ label: `Foreign sales commission (${deal.foreign_sales_commission_pct}%)`, amount: -foreignComm, isDeduction: true });
  if (camFee) lines.push({ label: `CAM fee (${deal.cam_fee_pct}%)`, amount: -camFee, isDeduction: true });
  if (pa) lines.push({ label: `P&A (capped at $${deal.pa_cap_usd.toLocaleString()})`, amount: -pa, isDeduction: true });
  if (overhead) lines.push({ label: `Approved overhead (capped at $${deal.overhead_cap_usd.toLocaleString()})`, amount: -overhead, isDeduction: true });
  if (residuals) lines.push({ label: `Modeled residuals (${deal.residuals_pct}%)`, amount: -residuals, isDeduction: true });

  const adjustedGross = Math.max(0, grossReceipts - distFee - foreignComm - camFee - pa - overhead - residuals);
  lines.push({ label: "Adjusted Gross Receipts", amount: adjustedGross, isTotal: true });

  const investorHurdle = deal.investor_capital_usd * deal.hurdle_multiple;
  const investorSeniorPaid = Math.min(adjustedGross, investorHurdle);
  if (investorSeniorPaid) lines.push({ label: `Investor senior recoupment (${deal.hurdle_multiple}x of $${deal.investor_capital_usd.toLocaleString()})`, amount: -investorSeniorPaid, isDeduction: true });

  const afterInvestor = Math.max(0, adjustedGross - investorSeniorPaid);
  const deferredPaid = Math.min(afterInvestor, deal.deferred_payroll_usd);
  if (deferredPaid) lines.push({ label: "Deferred payroll", amount: -deferredPaid, isDeduction: true });

  const netProfitPool = Math.max(0, afterInvestor - deferredPaid);
  lines.push({ label: "Net Profit Pool", amount: netProfitPool, isTotal: true });

  const investorTail = netProfitPool * (deal.pool_investor_tail_pct / 100);
  const creatorIpPool = netProfitPool * (deal.pool_creator_ip_pct / 100);
  const contributorPool = netProfitPool * (deal.pool_contributor_pct / 100);

  lines.push({ label: `Investor Tail (${deal.pool_investor_tail_pct}%)`, amount: investorTail, isPool: true });
  lines.push({ label: `Creator / IP Pool (${deal.pool_creator_ip_pct}%)`, amount: creatorIpPool, isPool: true });
  lines.push({ label: `Contributor Pool (${deal.pool_contributor_pct}%)`, amount: contributorPool, isPool: true });

  return {
    grossReceipts,
    lines,
    adjustedGross,
    investorSeniorPaid,
    deferredPaid,
    netProfitPool,
    investorTail,
    creatorIpPool,
    contributorPool,
  };
}

/**
 * Solve for the gross receipts threshold where a target AGR is reached.
 * Uses binary search since the waterfall has capped/min operations.
 */
export function findGrossForAGR(deal: ParityDeal, targetAGR: number): number {
  let lo = 0;
  let hi = Math.max(targetAGR * 4, 50_000_000);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const r = computeWaterfall(deal, mid);
    if (r.adjustedGross < targetAGR) lo = mid;
    else hi = mid;
  }
  return hi;
}

export function computeThresholds(deal: ParityDeal) {
  return {
    principalRecouped: findGrossForAGR(deal, deal.investor_capital_usd),
    fullHurdleHit: findGrossForAGR(deal, deal.investor_capital_usd * deal.hurdle_multiple),
    contributorPoolOpens: findGrossForAGR(deal, deal.investor_capital_usd * deal.hurdle_multiple + deal.deferred_payroll_usd),
  };
}

export function formatUSD(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
