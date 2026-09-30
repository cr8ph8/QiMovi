import { TOKEN_BUNDLES } from "@/lib/wallet";
import { PLANS } from "@/lib/plans";

/* ── Line-item model ── */
export interface OverheadLineItem {
  id: string;
  label: string;
  category: string;
  amount: number;
  notes: string;
}

export interface SubProjection {
  planKey: string;
  label: string;
  priceUsd: number;
  projectedSubs: number;
}

export interface TokenBundleProjection {
  bundleName: string;
  priceUsd: number;
  projectedSalesPerMonth: number;
}

export const CATEGORIES = ["Compensation", "Platform", "Security", "Infrastructure", "Legal", "Other"] as const;

export const CATEGORY_COLORS: Record<string, string> = {
  Compensation: "text-amber-500",
  Platform: "text-primary",
  Security: "text-red-400",
  Infrastructure: "text-blue-400",
  Legal: "text-violet-400",
  Other: "text-muted-foreground",
};

let _nextId = 0;
export function uid() { return `item_${Date.now()}_${_nextId++}`; }

export const DEFAULT_ITEMS: OverheadLineItem[] = [
  { id: uid(), label: "Lovable Business 1000 Subscription", category: "Platform", amount: 200, notes: "1,000 credits/mo — Business tier for SSO + role mgmt" },
  { id: uid(), label: "Lovable Cloud (Backend)", category: "Platform", amount: 25, notes: "$25 free balance included; overage est. $0–25/mo" },
  { id: uid(), label: "Director's Fee (Owner Compensation)", category: "Compensation", amount: 2000, notes: "Festival director monthly draw — scales with revenue" },
  { id: uid(), label: "Director's Benefits / Health Stipend", category: "Compensation", amount: 400, notes: "Health insurance marketplace + HSA contribution" },
  { id: uid(), label: "Director's Payroll Taxes (est. 15.3%)", category: "Compensation", amount: 306, notes: "Self-employment tax on director draw ($2,000 × 15.3%)" },
  { id: uid(), label: "Security Auditor (Code Review)", category: "Security", amount: 500, notes: "Monthly retainer — external coder audits RLS, edge functions, auth" },
  { id: uid(), label: "Penetration Testing (Quarterly / amortized)", category: "Security", amount: 125, notes: "$500/quarter amortized to $125/mo" },
  { id: uid(), label: "Domain & DNS (caniscreenwrite.com)", category: "Infrastructure", amount: 5, notes: "~$60/yr domain + Cloudflare DNS" },
  { id: uid(), label: "Email Service (Resend)", category: "Infrastructure", amount: 20, notes: "Transactional email — auth confirmations, score notifications" },
  { id: uid(), label: "Custom Domain SSL", category: "Infrastructure", amount: 0, notes: "Included with Lovable Business plan" },
  { id: uid(), label: "LLC Registered Agent", category: "Legal", amount: 15, notes: "~$180/yr registered agent service" },
  { id: uid(), label: "Legal Counsel (Retainer)", category: "Legal", amount: 100, notes: "IP/entertainment attorney — on-call for terms, disputes" },
  { id: uid(), label: "General Liability Insurance", category: "Legal", amount: 75, notes: "E&O + general liability policy" },
  { id: uid(), label: "Stripe Payment Processing (est. 2.9%+$0.30)", category: "Other", amount: 45, notes: "Est. on ~$1,550/mo token revenue (Year 1 avg)" },
  { id: uid(), label: "Accounting / Bookkeeping", category: "Other", amount: 100, notes: "Monthly bookkeeper — reconciliation, tax prep support" },
  { id: uid(), label: "Marketing / Social Media Tools", category: "Other", amount: 30, notes: "Scheduling tools, analytics, minor ad spend" },
];

export const DEFAULT_SUB_PROJECTIONS: SubProjection[] = PLANS.filter(p => p.priceCentsMonthly > 0).map(p => ({
  planKey: p.key,
  label: `${p.name} ($${(p.priceCentsMonthly / 100).toFixed(0)}/mo) — ${p.monthlyTokens}⊘ included`,
  priceUsd: p.priceCentsMonthly / 100,
  projectedSubs: p.key === "pro" ? 10 : 0,
}));

export const DEFAULT_BUNDLE_PROJECTIONS: TokenBundleProjection[] = TOKEN_BUNDLES.map(b => ({
  bundleName: `${b.name} (${b.tokens.toLocaleString()}⊘ — ${b.label})`,
  priceUsd: b.priceCents / 100,
  projectedSalesPerMonth: b.name === "Starter" ? 15 : b.name === "Creator" ? 8 : b.name === "Pro" ? 3 : 1,
}));

export const LOVABLE_PLANS = [
  { name: "Pro 100", credits: 100, price: 20 },
  { name: "Pro 300", credits: 300, price: 50 },
  { name: "Pro 1000", credits: 1000, price: 100 },
  { name: "Business 300", credits: 300, price: 100 },
  { name: "Business 1000", credits: 1000, price: 200 },
  { name: "Business 3000", credits: 3000, price: 400 },
];

export function fmt(n: number) {
  return n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`;
}

export function pct(n: number) {
  return `${n.toFixed(1)}%`;
}
