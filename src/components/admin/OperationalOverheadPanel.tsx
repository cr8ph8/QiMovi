import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Calculator, TrendingUp, AlertTriangle, Building2, Plus, Trash2, DollarSign, Users } from "lucide-react";
import { TOKEN_COSTS, TOKEN_ACTION_LABELS, LENGTH_CATEGORIES, TOKEN_VALUE_USD, MODEL_COSTS, TOKEN_BUNDLES } from "@/lib/wallet";
import { PLANS } from "@/lib/plans";
import { toast } from "sonner";
import { logEconomicsChange } from "@/lib/adminEconomicsAudit";

/* ── Line-item model ── */

interface OverheadLineItem {
  id: string;
  label: string;
  category: string;
  amount: number;
  notes: string;
}

/* ── Subscription & Revenue projection model ── */

interface SubProjection {
  planKey: string;
  label: string;
  priceUsd: number;
  projectedSubs: number;
}

interface TokenBundleProjection {
  bundleName: string;
  priceUsd: number;
  projectedSalesPerMonth: number;
}

const CATEGORIES = ["Compensation", "Platform", "Security", "Infrastructure", "Legal", "Other"] as const;

const CATEGORY_COLORS: Record<string, string> = {
  Compensation: "text-amber-500",
  Platform: "text-primary",
  Security: "text-red-400",
  Infrastructure: "text-blue-400",
  Legal: "text-violet-400",
  Other: "text-muted-foreground",
};

let _nextId = 0;
function uid() { return `item_${Date.now()}_${_nextId++}`; }

const DEFAULT_ITEMS: OverheadLineItem[] = [
  // ── Platform ──
  { id: uid(), label: "Lovable Business 1000 Subscription", category: "Platform", amount: 200, notes: "1,000 credits/mo — Business tier for SSO + role mgmt" },
  { id: uid(), label: "Lovable Cloud (Backend)", category: "Platform", amount: 25, notes: "$25 free balance included; overage est. $0–25/mo" },
  // ── Compensation ──
  { id: uid(), label: "Director's Fee (Owner Compensation)", category: "Compensation", amount: 2000, notes: "Festival director monthly draw — scales with revenue" },
  { id: uid(), label: "Director's Benefits / Health Stipend", category: "Compensation", amount: 400, notes: "Health insurance marketplace + HSA contribution" },
  { id: uid(), label: "Director's Payroll Taxes (est. 15.3%)", category: "Compensation", amount: 306, notes: "Self-employment tax on director draw ($2,000 × 15.3%)" },
  // ── Security ──
  { id: uid(), label: "Security Auditor (Code Review)", category: "Security", amount: 500, notes: "Monthly retainer — external coder audits RLS, edge functions, auth" },
  { id: uid(), label: "Penetration Testing (Quarterly / amortized)", category: "Security", amount: 125, notes: "$500/quarter amortized to $125/mo" },
  // ── Infrastructure ──
  { id: uid(), label: "Domain & DNS (caniscreenwrite.com)", category: "Infrastructure", amount: 5, notes: "~$60/yr domain + Cloudflare DNS" },
  { id: uid(), label: "Email Service (Resend)", category: "Infrastructure", amount: 20, notes: "Transactional email — auth confirmations, score notifications" },
  { id: uid(), label: "Custom Domain SSL", category: "Infrastructure", amount: 0, notes: "Included with Lovable Business plan" },
  // ── Legal ──
  { id: uid(), label: "LLC Registered Agent", category: "Legal", amount: 15, notes: "~$180/yr registered agent service" },
  { id: uid(), label: "Legal Counsel (Retainer)", category: "Legal", amount: 100, notes: "IP/entertainment attorney — on-call for terms, disputes" },
  { id: uid(), label: "General Liability Insurance", category: "Legal", amount: 75, notes: "E&O + general liability policy" },
  // ── Other ──
  { id: uid(), label: "Stripe Payment Processing (est. 2.9%+$0.30)", category: "Other", amount: 45, notes: "Est. on ~$1,550/mo token revenue (Year 1 avg)" },
  { id: uid(), label: "Accounting / Bookkeeping", category: "Other", amount: 100, notes: "Monthly bookkeeper — reconciliation, tax prep support" },
  { id: uid(), label: "Marketing / Social Media Tools", category: "Other", amount: 30, notes: "Scheduling tools, analytics, minor ad spend" },
];

/* ── Default revenue projections ── */

const DEFAULT_SUB_PROJECTIONS: SubProjection[] = PLANS.filter(p => p.priceCentsMonthly > 0).map(p => ({
  planKey: p.key,
  label: `${p.name} ($${(p.priceCentsMonthly / 100).toFixed(0)}/mo) — ${p.monthlyTokens}⊘ included`,
  priceUsd: p.priceCentsMonthly / 100,
  projectedSubs: p.key === "pro" ? 10 : 0,
}));

const DEFAULT_BUNDLE_PROJECTIONS: TokenBundleProjection[] = TOKEN_BUNDLES.map(b => ({
  bundleName: `${b.name} (${b.tokens.toLocaleString()}⊘ — ${b.label})`,
  priceUsd: b.priceCents / 100,
  projectedSalesPerMonth: b.name === "Starter" ? 15 : b.name === "Creator" ? 8 : b.name === "Pro" ? 3 : 1,
}));

/* ── Helpers ── */

function fmt(n: number) {
  return n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`;
}
function pct(n: number) {
  return `${n.toFixed(1)}%`;
}
function getAvgApiCostForEntry(category: string): number {
  const m = MODEL_COSTS["google/gemini-2.5-flash"];
  const pageMult = category === "feature" ? 3 : category === "pilot_60" ? 2 : category === "pilot_30" ? 1.5 : 1;
  return (m.input * 2 * pageMult) + (m.output * 1);
}
function getAvgApiCostForTool(): number {
  const m = MODEL_COSTS["google/gemini-2.5-flash"];
  return (m.input * 1) + (m.output * 0.5);
}

const LOVABLE_PLANS = [
  { name: "Pro 100", credits: 100, price: 20 },
  { name: "Pro 300", credits: 300, price: 50 },
  { name: "Pro 1000", credits: 1000, price: 100 },
  { name: "Business 300", credits: 300, price: 100 },
  { name: "Business 1000", credits: 1000, price: 200 },
  { name: "Business 3000", credits: 3000, price: 400 },
];

/* ── Component ── */

export default function OperationalOverheadPanel() {
  const [items, setItems] = useState<OverheadLineItem[]>(DEFAULT_ITEMS);
  const [projectedEntries, setProjectedEntries] = useState(30);
  const [projectedToolUses, setProjectedToolUses] = useState(120);
  const [subProjections, setSubProjections] = useState<SubProjection[]>(DEFAULT_SUB_PROJECTIONS);
  const [bundleProjections, setBundleProjections] = useState<TokenBundleProjection[]>(DEFAULT_BUNDLE_PROJECTIONS);
  const [saving, setSaving] = useState(false);
  const [creditsUsed, setCreditsUsed] = useState(0);
  const initialSnapshot = useRef<Record<string, unknown> | null>(null);

  /* load */
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("key, text_value, value")
        .in("key", [
          "overhead_line_items", "overhead_projected_entries", "overhead_projected_tool_uses",
          "lovable_credits_used", "overhead_sub_projections", "overhead_bundle_projections",
        ]);
      if (!data) return;
      const map: Record<string, string> = {};
      data.forEach((s: any) => { map[s.key] = s.text_value || String(s.value); });

      if (map["overhead_line_items"]) {
        try { const p = JSON.parse(map["overhead_line_items"]); if (Array.isArray(p) && p.length) setItems(p); } catch {}
      }
      if (map["overhead_sub_projections"]) {
        try { const p = JSON.parse(map["overhead_sub_projections"]); if (Array.isArray(p)) setSubProjections(p); } catch {}
      }
      if (map["overhead_bundle_projections"]) {
        try { const p = JSON.parse(map["overhead_bundle_projections"]); if (Array.isArray(p)) setBundleProjections(p); } catch {}
      }
      const pe = Number(map["overhead_projected_entries"]);
      if (!isNaN(pe) && pe > 0) setProjectedEntries(pe);
      const pt = Number(map["overhead_projected_tool_uses"]);
      if (!isNaN(pt) && pt > 0) setProjectedToolUses(pt);
      setCreditsUsed(Number(map["lovable_credits_used"]) || 0);

      // Capture the loaded snapshot for audit diffs
      initialSnapshot.current = {
        overhead_line_items: (() => { try { return JSON.parse(map["overhead_line_items"] ?? "null"); } catch { return null; } })(),
        overhead_projected_entries: Number(map["overhead_projected_entries"]) || null,
        overhead_projected_tool_uses: Number(map["overhead_projected_tool_uses"]) || null,
        overhead_sub_projections: (() => { try { return JSON.parse(map["overhead_sub_projections"] ?? "null"); } catch { return null; } })(),
        overhead_bundle_projections: (() => { try { return JSON.parse(map["overhead_bundle_projections"] ?? "null"); } catch { return null; } })(),
      };
    })();
  }, []);

  /* save */
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const rows = [
        { key: "overhead_line_items", value: false, text_value: JSON.stringify(items) },
        { key: "overhead_projected_entries", value: false, text_value: String(projectedEntries) },
        { key: "overhead_projected_tool_uses", value: false, text_value: String(projectedToolUses) },
        { key: "overhead_sub_projections", value: false, text_value: JSON.stringify(subProjections) },
        { key: "overhead_bundle_projections", value: false, text_value: JSON.stringify(bundleProjections) },
      ];
      for (const row of rows) {
        await supabase.from("site_settings").upsert(row, { onConflict: "key" });
      }
      const after = {
        overhead_line_items: items,
        overhead_projected_entries: projectedEntries,
        overhead_projected_tool_uses: projectedToolUses,
        overhead_sub_projections: subProjections,
        overhead_bundle_projections: bundleProjections,
      };
      await logEconomicsChange({
        area: "operational_overhead",
        entity_id: "site_settings.overhead",
        before: initialSnapshot.current,
        after,
      });
      initialSnapshot.current = after;
      toast.success("Overhead & revenue settings saved");
    } catch {
      toast.error("Failed to save");
    }
    setSaving(false);
  }, [items, projectedEntries, projectedToolUses, subProjections, bundleProjections]);

  /* mutations */
  const updateItem = (id: string, field: keyof OverheadLineItem, val: string | number) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: val } : i));
  };
  const removeItem = (id: string) => setItems(prev => prev.filter(i => i.id !== id));
  const addItem = () => setItems(prev => [...prev, { id: uid(), label: "", category: "Other", amount: 0, notes: "" }]);

  /* ── derived: costs ── */
  const monthlyOverhead = useMemo(() => items.reduce((s, i) => s + i.amount, 0), [items]);

  const categorySubtotals = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach(i => { map[i.category] = (map[i.category] || 0) + i.amount; });
    return CATEGORIES.filter(c => (map[c] || 0) > 0).map(c => ({ category: c, total: map[c] }));
  }, [items]);

  const entryOverheadShare = monthlyOverhead * 0.7;
  const toolOverheadShare = monthlyOverhead * 0.3;
  const allocPerEntry = projectedEntries > 0 ? entryOverheadShare / projectedEntries : 0;
  const allocPerTool = projectedToolUses > 0 ? toolOverheadShare / projectedToolUses : 0;

  /* ── derived: revenue ── */
  const subscriptionRevenue = useMemo(() => subProjections.reduce((s, sp) => s + sp.priceUsd * sp.projectedSubs, 0), [subProjections]);
  const bundleRevenue = useMemo(() => bundleProjections.reduce((s, bp) => s + bp.priceUsd * bp.projectedSalesPerMonth, 0), [bundleProjections]);
  const totalMonthlyRevenue = subscriptionRevenue + bundleRevenue;
  const netMonthly = totalMonthlyRevenue - monthlyOverhead;

  const recommendedPlan = LOVABLE_PLANS.find(p => p.credits >= Math.max(creditsUsed, 100)) || LOVABLE_PLANS[LOVABLE_PLANS.length - 1];

  const entryRows = LENGTH_CATEGORIES.map(cat => {
    const feeTokens = cat.cost;
    const feeRevenue = feeTokens * TOKEN_VALUE_USD;
    const apiCost = getAvgApiCostForEntry(cat.key);
    const trueCost = apiCost + allocPerEntry;
    const trueMargin = feeRevenue - trueCost;
    const marginPct = feeRevenue > 0 ? (trueMargin / feeRevenue) * 100 : 0;
    return { ...cat, feeTokens, feeRevenue, apiCost, allocOverhead: allocPerEntry, trueCost, trueMargin, marginPct };
  });

  const toolKeys = ["ai_score", "deep_analysis", "ai_script_generate", "ai_rewrite", "ai_suggest_rewrites", "logline_generate", "title_suggest", "scene_analysis"] as const;
  const toolRows = toolKeys.map(key => {
    const tokens = TOKEN_COSTS[key as keyof typeof TOKEN_COSTS] || 0;
    const revenue = tokens * TOKEN_VALUE_USD;
    const apiCost = getAvgApiCostForTool();
    const trueCost = apiCost + allocPerTool;
    const trueMargin = revenue - trueCost;
    const marginPct = revenue > 0 ? (trueMargin / revenue) * 100 : 0;
    return { key, label: TOKEN_ACTION_LABELS[key as keyof typeof TOKEN_ACTION_LABELS] || key, tokens, revenue, apiCost, allocOverhead: allocPerTool, trueCost, trueMargin, marginPct };
  });

  const avgEntryMarginBeforeOverhead = entryRows.reduce((s, r) => s + (r.feeRevenue - r.apiCost), 0) / entryRows.length;
  const breakEvenEntries = avgEntryMarginBeforeOverhead > 0 ? Math.ceil(monthlyOverhead / avgEntryMarginBeforeOverhead) : Infinity;

  return (
    <div className="space-y-6">
      {/* ─── Revenue Projections ─── */}
      <Card className="border-border/50 bg-card/80">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-emerald-500" />
              Projected Monthly Revenue
            </CardTitle>
            <Button size="sm" variant="outline" onClick={handleSave} disabled={saving} className="gap-1">
              <Save className="h-3 w-3" />
              {saving ? "Saving…" : "Save All"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Set projected subscriber counts and token bundle sales per month to calculate expected revenue.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Subscriptions */}
          <div>
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
              <Users className="h-3 w-3" /> Platform Subscriptions
            </p>
            <div className="hidden md:grid grid-cols-[1fr_100px_100px_120px] gap-2 text-[10px] font-mono text-muted-foreground uppercase tracking-wider px-1 mb-1">
              <span>Plan</span>
              <span>Price/mo</span>
              <span>Proj. Subs</span>
              <span>Monthly Rev</span>
            </div>
            {subProjections.map((sp, idx) => (
              <div key={sp.planKey} className="grid grid-cols-1 md:grid-cols-[1fr_100px_100px_120px] gap-2 items-center mb-1">
                <span className="text-xs font-mono truncate">{sp.label}</span>
                <span className="text-xs font-mono text-muted-foreground">{fmt(sp.priceUsd)}</span>
                <Input
                  type="number" min="0" step="1"
                  value={sp.projectedSubs}
                  onChange={e => {
                    const val = Number(e.target.value) || 0;
                    setSubProjections(prev => prev.map((s, i) => i === idx ? { ...s, projectedSubs: val } : s));
                  }}
                  className="h-7 text-xs font-mono w-20"
                />
                <span className="text-xs font-mono font-bold text-emerald-500">{fmt(sp.priceUsd * sp.projectedSubs)}</span>
              </div>
            ))}
            <div className="flex justify-end mt-1">
              <span className="text-xs font-mono text-muted-foreground">Subtotal:</span>
              <span className="text-xs font-mono font-bold text-emerald-500 ml-2">{fmt(subscriptionRevenue)}/mo</span>
            </div>
          </div>

          {/* Token Bundles */}
          <div className="border-t border-border/30 pt-3">
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
              <DollarSign className="h-3 w-3" /> Token Bundle Sales
            </p>
            <div className="hidden md:grid grid-cols-[1fr_100px_100px_120px] gap-2 text-[10px] font-mono text-muted-foreground uppercase tracking-wider px-1 mb-1">
              <span>Bundle</span>
              <span>Price</span>
              <span>Sales/mo</span>
              <span>Monthly Rev</span>
            </div>
            {bundleProjections.map((bp, idx) => (
              <div key={bp.bundleName} className="grid grid-cols-1 md:grid-cols-[1fr_100px_100px_120px] gap-2 items-center mb-1">
                <span className="text-xs font-mono truncate">{bp.bundleName}</span>
                <span className="text-xs font-mono text-muted-foreground">{fmt(bp.priceUsd)}</span>
                <Input
                  type="number" min="0" step="1"
                  value={bp.projectedSalesPerMonth}
                  onChange={e => {
                    const val = Number(e.target.value) || 0;
                    setBundleProjections(prev => prev.map((b, i) => i === idx ? { ...b, projectedSalesPerMonth: val } : b));
                  }}
                  className="h-7 text-xs font-mono w-20"
                />
                <span className="text-xs font-mono font-bold text-emerald-500">{fmt(bp.priceUsd * bp.projectedSalesPerMonth)}</span>
              </div>
            ))}
            <div className="flex justify-end mt-1">
              <span className="text-xs font-mono text-muted-foreground">Subtotal:</span>
              <span className="text-xs font-mono font-bold text-emerald-500 ml-2">{fmt(bundleRevenue)}/mo</span>
            </div>
          </div>

          {/* Revenue Summary */}
          <div className="border-t border-border/30 pt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="font-mono">
              <span className="text-[10px] text-muted-foreground uppercase block tracking-wider">Subscription Rev</span>
              <span className="font-bold text-emerald-500">{fmt(subscriptionRevenue)}</span>
            </div>
            <div className="font-mono">
              <span className="text-[10px] text-muted-foreground uppercase block tracking-wider">Token Bundle Rev</span>
              <span className="font-bold text-emerald-500">{fmt(bundleRevenue)}</span>
            </div>
            <div className="font-mono">
              <span className="text-[10px] text-muted-foreground uppercase block tracking-wider">Total Monthly Rev</span>
              <span className="font-bold text-lg text-emerald-500">{fmt(totalMonthlyRevenue)}</span>
            </div>
            <div className="font-mono">
              <span className="text-[10px] text-muted-foreground uppercase block tracking-wider">Net (Rev − Overhead)</span>
              <span className={`font-bold text-lg ${netMonthly >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmt(netMonthly)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Recurring Overhead Line Items ─── */}
      <Card className="border-border/50 bg-card/80">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <Building2 className="h-4 w-4 text-amber-500" />
              Recurring Monthly Overhead
            </CardTitle>
            <Button size="sm" variant="outline" onClick={handleSave} disabled={saving} className="gap-1">
              <Save className="h-3 w-3" />
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Every fixed monthly cost your business incurs. Add, edit, or remove line items to reflect your true operating expenses.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="hidden md:grid grid-cols-[1fr_140px_100px_1fr_36px] gap-2 text-[10px] font-mono text-muted-foreground uppercase tracking-wider px-1">
            <span>Label</span>
            <span>Category</span>
            <span>$/Month</span>
            <span>Notes</span>
            <span />
          </div>

          {items.map(item => (
            <div key={item.id} className="grid grid-cols-1 md:grid-cols-[1fr_140px_100px_1fr_36px] gap-2 items-start border border-border/30 rounded-md p-2 md:border-0 md:p-0">
              <Input value={item.label} onChange={e => updateItem(item.id, "label", e.target.value)} placeholder="Cost label…" className="h-8 text-xs font-mono" />
              <Select value={item.category} onValueChange={v => updateItem(item.id, "category", v)}>
                <SelectTrigger className="h-8 text-xs font-mono"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}</SelectContent>
              </Select>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground text-xs">$</span>
                <Input type="number" min="0" step="0.01" value={item.amount} onChange={e => updateItem(item.id, "amount", Number(e.target.value) || 0)} className="h-8 text-xs font-mono" />
              </div>
              <Input value={item.notes} onChange={e => updateItem(item.id, "notes", e.target.value)} placeholder="Optional notes…" className="h-8 text-xs font-mono text-muted-foreground" />
              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive/60 hover:text-destructive" onClick={() => removeItem(item.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}

          <Button size="sm" variant="outline" onClick={addItem} className="gap-1 mt-1">
            <Plus className="h-3 w-3" /> Add Line Item
          </Button>

          {/* Category subtotals */}
          <div className="border-t border-border/30 pt-3 mt-3 space-y-1">
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Category Subtotals</p>
            <div className="flex flex-wrap gap-3">
              {categorySubtotals.map(cs => (
                <div key={cs.category} className="font-mono text-xs">
                  <span className={CATEGORY_COLORS[cs.category] || "text-muted-foreground"}>{cs.category}:</span>{" "}
                  <span className="font-bold">{fmt(cs.total)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Projections + Summary */}
          <div className="border-t border-border/30 pt-3 mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                <Calculator className="h-3 w-3" /> Projected Entries/mo
              </label>
              <Input type="number" min="0" step="1" value={projectedEntries} onChange={e => setProjectedEntries(Number(e.target.value) || 0)} className="h-8 text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <label className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                <Calculator className="h-3 w-3" /> Projected Tool Uses/mo
              </label>
              <Input type="number" min="0" step="1" value={projectedToolUses} onChange={e => setProjectedToolUses(Number(e.target.value) || 0)} className="h-8 text-sm font-mono" />
            </div>
            <div className="flex items-end">
              <div className="font-mono text-sm">
                <span className="text-muted-foreground text-[10px] uppercase block tracking-wider">Total Monthly Overhead</span>
                <span className="font-bold text-lg text-amber-500">{fmt(monthlyOverhead)}</span>
              </div>
            </div>
            <div className="flex items-end gap-4">
              <div className="font-mono text-xs">
                <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">Per Entry (70%)</span>
                <span className="font-bold">{fmt(allocPerEntry)}</span>
              </div>
              <div className="font-mono text-xs">
                <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">Per Tool (30%)</span>
                <span className="font-bold">{fmt(allocPerTool)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Lovable Plan Advisor ─── */}
      <Card className="border-border/50 bg-card/80">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Lovable Plan Advisor
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <div className="flex flex-wrap gap-3 font-mono">
            <span className="text-muted-foreground">Credits used (lifetime):</span>
            <span className="font-bold">{creditsUsed.toLocaleString()}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground font-mono">Recommended:</span>
            <Badge variant="outline" className="font-mono">{recommendedPlan.name}</Badge>
            <span className="font-mono font-bold">${recommendedPlan.price}/mo</span>
            <span className="text-muted-foreground font-mono">({recommendedPlan.credits} credits)</span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            This cost is included in your Platform line item above. Adjust the subscription amount to match your actual plan.
          </p>
        </CardContent>
      </Card>

      {/* ─── Per-Entry True Cost Table ─── */}
      <Card className="border-border/50 bg-card/80">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono">Per-Entry True Cost (Standard Model)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-mono text-xs">Category</TableHead>
                <TableHead className="font-mono text-xs text-right">Fee (⊘)</TableHead>
                <TableHead className="font-mono text-xs text-right">Revenue</TableHead>
                <TableHead className="font-mono text-xs text-right">AI Cost</TableHead>
                <TableHead className="font-mono text-xs text-right">Overhead</TableHead>
                <TableHead className="font-mono text-xs text-right">True Cost</TableHead>
                <TableHead className="font-mono text-xs text-right">True Margin</TableHead>
                <TableHead className="font-mono text-xs text-right">Margin %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entryRows.map(r => (
                <TableRow key={r.key}>
                  <TableCell className="font-mono text-xs">{r.label}</TableCell>
                  <TableCell className="font-mono text-xs text-right">{r.feeTokens}⊘</TableCell>
                  <TableCell className="font-mono text-xs text-right text-emerald-500">{fmt(r.feeRevenue)}</TableCell>
                  <TableCell className="font-mono text-xs text-right text-blue-500">{fmt(r.apiCost)}</TableCell>
                  <TableCell className="font-mono text-xs text-right text-amber-500">{fmt(r.allocOverhead)}</TableCell>
                  <TableCell className="font-mono text-xs text-right text-orange-500">{fmt(r.trueCost)}</TableCell>
                  <TableCell className={`font-mono text-xs text-right ${r.trueMargin >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmt(r.trueMargin)}</TableCell>
                  <TableCell className={`font-mono text-xs text-right ${r.marginPct >= 0 ? "text-emerald-500" : "text-destructive"}`}>{pct(r.marginPct)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ─── Per-Tool True Cost Table ─── */}
      <Card className="border-border/50 bg-card/80">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono">Per-Tool True Cost (Standard Model)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-mono text-xs">Tool</TableHead>
                <TableHead className="font-mono text-xs text-right">Cost (⊘)</TableHead>
                <TableHead className="font-mono text-xs text-right">Revenue</TableHead>
                <TableHead className="font-mono text-xs text-right">AI Cost</TableHead>
                <TableHead className="font-mono text-xs text-right">Overhead</TableHead>
                <TableHead className="font-mono text-xs text-right">True Cost</TableHead>
                <TableHead className="font-mono text-xs text-right">True Margin</TableHead>
                <TableHead className="font-mono text-xs text-right">Margin %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {toolRows.map(r => (
                <TableRow key={r.key}>
                  <TableCell className="font-mono text-xs">{r.label}</TableCell>
                  <TableCell className="font-mono text-xs text-right">{r.tokens}⊘</TableCell>
                  <TableCell className="font-mono text-xs text-right text-emerald-500">{fmt(r.revenue)}</TableCell>
                  <TableCell className="font-mono text-xs text-right text-blue-500">{fmt(r.apiCost)}</TableCell>
                  <TableCell className="font-mono text-xs text-right text-amber-500">{fmt(r.allocOverhead)}</TableCell>
                  <TableCell className="font-mono text-xs text-right text-orange-500">{fmt(r.trueCost)}</TableCell>
                  <TableCell className={`font-mono text-xs text-right ${r.trueMargin >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmt(r.trueMargin)}</TableCell>
                  <TableCell className={`font-mono text-xs text-right ${r.marginPct >= 0 ? "text-emerald-500" : "text-destructive"}`}>{pct(r.marginPct)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ─── Break-Even Analysis ─── */}
      <Card className="border-border/50 bg-card/80">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Break-Even Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm font-mono">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Monthly Overhead</p>
              <p className="text-lg font-bold text-amber-500">{fmt(monthlyOverhead)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Projected Revenue</p>
              <p className="text-lg font-bold text-emerald-500">{fmt(totalMonthlyRevenue)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Net Monthly P&L</p>
              <p className={`text-lg font-bold ${netMonthly >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmt(netMonthly)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Entry-Only Break-Even</p>
              <p className={`text-lg font-bold ${breakEvenEntries <= projectedEntries ? "text-emerald-500" : "text-destructive"}`}>
                {breakEvenEntries === Infinity ? "∞" : breakEvenEntries.toLocaleString()}
              </p>
              {breakEvenEntries !== Infinity && breakEvenEntries <= projectedEntries && (
                <p className="text-[10px] text-emerald-500">✓ Within projected volume</p>
              )}
              {breakEvenEntries !== Infinity && breakEvenEntries > projectedEntries && (
                <p className="text-[10px] text-destructive">⚠ Above projected volume</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
