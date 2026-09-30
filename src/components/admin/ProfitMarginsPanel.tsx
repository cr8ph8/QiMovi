import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import {
  DollarSign, TrendingUp, TrendingDown, Target, Cpu, Hammer, Coins, Wallet,
  AlertTriangle, Building2, Plus, Trash2, Save, Calculator, Users, ChevronRight, Trophy, Activity,
} from "lucide-react";
import { LOVABLE_CREDIT_DEFAULT_COST, LOVABLE_CREDIT_PREPAID_COST, TOKEN_BUNDLES, getAvgTokenPrice, TOKEN_COSTS, TOKEN_ACTION_LABELS, LENGTH_CATEGORIES, TOKEN_VALUE_USD, MODEL_COSTS, DEFAULT_SURCHARGES } from "@/lib/wallet";
import { toast } from "sonner";
import { logEconomicsChange } from "@/lib/adminEconomicsAudit";
import {
  OverheadLineItem, SubProjection, TokenBundleProjection,
  CATEGORIES, CATEGORY_COLORS, uid, DEFAULT_ITEMS, DEFAULT_SUB_PROJECTIONS, DEFAULT_BUNDLE_PROJECTIONS, LOVABLE_PLANS,
  fmt, pct,
} from "./overhead-shared";

/* ── Cost helpers (now model-aware) ── */
const MODEL_IDS = Object.keys(MODEL_COSTS);

function getAvgApiCostForEntry(category: string, modelId: string): number {
  const m = MODEL_COSTS[modelId] || MODEL_COSTS["google/gemini-2.5-flash"];
  const pageMult = category === "feature" ? 3 : category === "pilot_60" ? 2 : category === "pilot_30" ? 1.5 : 1;
  return (m.input * 2 * pageMult) + (m.output * 1);
}
function getAvgApiCostForTool(modelId: string): number {
  const m = MODEL_COSTS[modelId] || MODEL_COSTS["google/gemini-2.5-flash"];
  return (m.input * 1) + (m.output * 0.5);
}

/** Revenue from base tokens, factoring in surcharge multiplier for model tier */
function getSurchargedRevenue(baseTokens: number, tierKey?: string): number {
  const surcharge = tierKey ? (DEFAULT_SURCHARGES[tierKey] || DEFAULT_SURCHARGES.standard) : DEFAULT_SURCHARGES.standard;
  return Math.ceil(baseTokens * surcharge.multiplier) * TOKEN_VALUE_USD;
}

/** Revenue from base tokens — no surcharge (for standard tier) */
function getFlatRevenue(baseTokens: number): number {
  return baseTokens * TOKEN_VALUE_USD;
}

/* ── Metric Card ── */
function MetricCard({ icon: Icon, label, value, sub, color }: {
  icon: any; label: string; value: string; sub: string; color: string;
}) {
  return (
    <Card className="border-border/50 bg-card/80">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon className={`h-4 w-4 ${color}`} />
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{label}</span>
        </div>
        <p className="font-display text-lg font-bold">{value}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
      </CardContent>
    </Card>
  );
}

/* ── Main Component ── */
/* ── Action key maps ── */
const ENTRY_ACTION_KEYS = ["entry_vertical", "entry_micro", "entry_short", "entry_pilot_30", "entry_pilot_60", "entry_feature"] as const;
const TOOL_ACTION_KEYS = ["ai_score", "deep_analysis", "ai_script_generate", "ai_rewrite", "ai_suggest_rewrites", "logline_generate", "title_suggest", "scene_analysis"] as const;
const ALL_ACTION_KEYS = [...ENTRY_ACTION_KEYS, ...TOOL_ACTION_KEYS] as readonly string[];

export default function ProfitMarginsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const initialSnapshot = useRef<Record<string, unknown> | null>(null);

  // DB-driven actuals
  const [costPerCredit, setCostPerCredit] = useState(LOVABLE_CREDIT_DEFAULT_COST);
  const [costPerCreditPrepaid, setCostPerCreditPrepaid] = useState(LOVABLE_CREDIT_PREPAID_COST);
  const [creditsUsed, setCreditsUsed] = useState(0);
  const [creditsPrepaid, setCreditsPrepaid] = useState(0);
  const [aiCostPerToken, setAiCostPerToken] = useState(0.01);
  const [totalRevenueCents, setTotalRevenueCents] = useState(0);
  const [totalTokensConsumed, setTotalTokensConsumed] = useState(0);
  const [totalTokensSold, setTotalTokensSold] = useState(0);
  const [monthlyData, setMonthlyData] = useState<any[]>([]);

  // Usage tracker counts
  const [usageAllTime, setUsageAllTime] = useState<Record<string, number>>({});
  const [usageThisMonth, setUsageThisMonth] = useState<Record<string, number>>({});

  // Overhead line items
  const [items, setItems] = useState<OverheadLineItem[]>(DEFAULT_ITEMS);
  // Revenue projections
  const [subProjections, setSubProjections] = useState<SubProjection[]>(DEFAULT_SUB_PROJECTIONS);
  const [bundleProjections, setBundleProjections] = useState<TokenBundleProjection[]>(DEFAULT_BUNDLE_PROJECTIONS);
  // What-if sliders
  const [projectedEntries, setProjectedEntries] = useState(30);
  const [projectedToolUses, setProjectedToolUses] = useState(120);
  const [whatIfSubs, setWhatIfSubs] = useState(10);
  const [whatIfEntries, setWhatIfEntries] = useState(30);
  const [whatIfTools, setWhatIfTools] = useState(120);
  // Model selectors
  const [selectedEntryModel, setSelectedEntryModel] = useState("google/gemini-2.5-flash");
  const [selectedToolModel, setSelectedToolModel] = useState("google/gemini-2.5-flash");
  const [selectedJudgeModel, setSelectedJudgeModel] = useState("google/gemini-2.5-flash");
  const [freeUserCount, setFreeUserCount] = useState(50);
  const [selectedBundleModel, setSelectedBundleModel] = useState("google/gemini-2.5-flash");

  // Live actuals tracker
  const [liveSubCount, setLiveSubCount] = useState(0);
  const [liveEntryCountMonth, setLiveEntryCountMonth] = useState(0);
  const [liveEntryCountTotal, setLiveEntryCountTotal] = useState(0);

  // Competition data
  const [competitions, setCompetitions] = useState<any[]>([]);
  const [compEntryCounts, setCompEntryCounts] = useState<Record<string, Record<string, number>>>({});
  const [compJudgeCosts, setCompJudgeCosts] = useState<Record<string, number>>({});
  const [selectedCompId, setSelectedCompId] = useState<string | null>(null);

  /* ── Load everything ── */
  useEffect(() => {
    (async () => {
      setLoading(true);
      const thisMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      const [
        { data: purchases },
        { data: txns },
        { data: settings },
        { data: allUsage },
        { data: monthUsage },
      ] = await Promise.all([
        supabase.from("purchases").select("price_cents, token_amount, created_at, status").eq("status", "completed"),
        supabase.from("wallet_transactions" as any).select("amount, created_at").lt("amount", 0),
        supabase.from("site_settings").select("key, text_value, value").in("key", [
          "lovable_credits_used", "lovable_cost_per_credit", "ai_cost_per_token",
          "lovable_cost_per_credit_prepaid", "lovable_credits_prepaid",
          "overhead_line_items", "overhead_projected_entries", "overhead_projected_tool_uses",
          "overhead_sub_projections", "overhead_bundle_projections",
        ]),
        supabase.from("feature_usage_log").select("action").in("action", ALL_ACTION_KEYS as unknown as string[]),
        supabase.from("feature_usage_log").select("action").in("action", ALL_ACTION_KEYS as unknown as string[]).gte("created_at", thisMonthStart),
      ]);

      // Build usage count maps
      const allMap: Record<string, number> = {};
      (allUsage || []).forEach((r: any) => { allMap[r.action] = (allMap[r.action] || 0) + 1; });
      setUsageAllTime(allMap);
      const moMap: Record<string, number> = {};
      (monthUsage || []).forEach((r: any) => { moMap[r.action] = (moMap[r.action] || 0) + 1; });
      setUsageThisMonth(moMap);

      const map: Record<string, string> = {};
      (settings || []).forEach((s: any) => { map[s.key] = s.text_value || String(s.value); });

      const credits = Number(map["lovable_credits_used"]) || 0;
      const cpc = Number(map["lovable_cost_per_credit"]) || LOVABLE_CREDIT_DEFAULT_COST;
      const aiCpt = Number(map["ai_cost_per_token"]) || 0.01;
      const cpcPP = Number(map["lovable_cost_per_credit_prepaid"]) || LOVABLE_CREDIT_PREPAID_COST;
      const credPP = Number(map["lovable_credits_prepaid"]) || 0;
      setCreditsUsed(credits); setCostPerCredit(cpc); setAiCostPerToken(aiCpt);
      setCostPerCreditPrepaid(cpcPP); setCreditsPrepaid(credPP);

      // Overhead items
      if (map["overhead_line_items"]) {
        try { const p = JSON.parse(map["overhead_line_items"]); if (Array.isArray(p) && p.length) setItems(p); } catch {}
      }
      if (map["overhead_sub_projections"]) {
        try { const p = JSON.parse(map["overhead_sub_projections"]); if (Array.isArray(p)) setSubProjections(p); } catch {}
      }
      if (map["overhead_bundle_projections"]) {
        try { const p = JSON.parse(map["overhead_bundle_projections"]); if (Array.isArray(p)) setBundleProjections(p); } catch {}
      }
      const pe = Number(map["overhead_projected_entries"]); if (!isNaN(pe) && pe > 0) { setProjectedEntries(pe); setWhatIfEntries(pe); }
      const pt = Number(map["overhead_projected_tool_uses"]); if (!isNaN(pt) && pt > 0) { setProjectedToolUses(pt); setWhatIfTools(pt); }

      // Snapshot for audit diffs (mirrors the fields written on save)
      initialSnapshot.current = {
        overhead_line_items: (() => { try { return JSON.parse(map["overhead_line_items"] ?? "null"); } catch { return null; } })(),
        overhead_projected_entries: Number(map["overhead_projected_entries"]) || null,
        overhead_projected_tool_uses: Number(map["overhead_projected_tool_uses"]) || null,
        overhead_sub_projections: (() => { try { return JSON.parse(map["overhead_sub_projections"] ?? "null"); } catch { return null; } })(),
        overhead_bundle_projections: (() => { try { return JSON.parse(map["overhead_bundle_projections"] ?? "null"); } catch { return null; } })(),
      };

      // Actuals
      const revCents = (purchases || []).reduce((s: number, p: any) => s + (p.price_cents || 0), 0);
      setTotalRevenueCents(revCents);
      const sold = (purchases || []).reduce((s: number, p: any) => s + (p.token_amount || 0), 0);
      setTotalTokensSold(sold);
      const consumed = (txns || []).reduce((s: number, t: any) => s + Math.abs(t.amount || 0), 0);
      setTotalTokensConsumed(consumed);

      // Monthly breakdown
      const revByMonth: Record<string, number> = {};
      const soldByMonth: Record<string, number> = {};
      (purchases || []).forEach((p: any) => {
        const m = p.created_at?.slice(0, 7) || "unknown";
        revByMonth[m] = (revByMonth[m] || 0) + (p.price_cents || 0);
        soldByMonth[m] = (soldByMonth[m] || 0) + (p.token_amount || 0);
      });
      const consumedByMonth: Record<string, number> = {};
      (txns || []).forEach((t: any) => {
        const m = t.created_at?.slice(0, 7) || "unknown";
        consumedByMonth[m] = (consumedByMonth[m] || 0) + Math.abs(t.amount || 0);
      });
      const allMonths = [...new Set([...Object.keys(revByMonth), ...Object.keys(consumedByMonth)])].sort().reverse();
      const devTotal = credits * cpc;
      const devPerMonth = allMonths.length > 0 ? devTotal / allMonths.length : devTotal;
      setMonthlyData(allMonths.map((month) => {
        const rev = (revByMonth[month] || 0) / 100;
        const ai = (consumedByMonth[month] || 0) * aiCpt;
        const dev = devPerMonth;
        const tSold = soldByMonth[month] || 0;
        const tConsumed = consumedByMonth[month] || 0;
        return { month, revenue: rev, aiCost: ai, devCost: dev, gross: rev - ai, net: rev - ai - dev, tokensSold: tSold, tokensConsumed: tConsumed, carryover: tSold - tConsumed };
      }));

      // ── Competition data ──
      const [
        { data: comps },
        { data: compEntries },
        { data: judgeLog },
      ] = await Promise.all([
        supabase.from("competitions").select("id, name, status"),
        supabase.from("entries").select("competition_id, length_category").not("competition_id", "is", null),
        supabase.from("judge_usage_log").select("competition_id, estimated_cost_cents"),
      ]);

      setCompetitions(comps || []);

      // Group entry counts: { compId: { vertical: 5, micro: 3, ... } }
      const ecMap: Record<string, Record<string, number>> = {};
      (compEntries || []).forEach((e: any) => {
        if (!e.competition_id) return;
        if (!ecMap[e.competition_id]) ecMap[e.competition_id] = {};
        const cat = e.length_category || "vertical";
        ecMap[e.competition_id][cat] = (ecMap[e.competition_id][cat] || 0) + 1;
      });
      setCompEntryCounts(ecMap);

      // Sum judge costs per competition (cents → dollars)
      const jcMap: Record<string, number> = {};
      (judgeLog || []).forEach((j: any) => {
        if (!j.competition_id) return;
        jcMap[j.competition_id] = (jcMap[j.competition_id] || 0) + (j.estimated_cost_cents || 0);
      });
      // Convert cents to dollars
      Object.keys(jcMap).forEach(k => { jcMap[k] = jcMap[k] / 100; });
      setCompJudgeCosts(jcMap);

      // Auto-select first competition
      if ((comps || []).length > 0 && !selectedCompId) {
        setSelectedCompId(comps![0].id);
      }

      // ── Live actuals ──
      const [
        { count: subCount },
        { count: entryMonthCount },
        { count: entryTotalCount },
      ] = await Promise.all([
        supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active").neq("plan", "free"),
        supabase.from("entries").select("id", { count: "exact", head: true }).gte("created_at", thisMonthStart),
        supabase.from("entries").select("id", { count: "exact", head: true }),
      ]);
      setLiveSubCount(subCount || 0);
      setLiveEntryCountMonth(entryMonthCount || 0);
      setLiveEntryCountTotal(entryTotalCount || 0);

      setLoading(false);
    })();
  }, []);

  /* ── Realtime usage tracker ──
   * postgres_changes only (broadcast/presence blocked by policy).
   * See REALTIME_SUBSCRIPTION_RULES.md before adding new subscriptions. */
  useEffect(() => {
    const channel = supabase
      .channel('usage-tracker')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'feature_usage_log',
      }, (payload: any) => {
        const action = payload.new?.action;
        if (action && (ALL_ACTION_KEYS as readonly string[]).includes(action)) {
          setUsageAllTime(prev => ({ ...prev, [action]: (prev[action] || 0) + 1 }));
          const now = new Date();
          const created = new Date(payload.new.created_at);
          if (created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear()) {
            setUsageThisMonth(prev => ({ ...prev, [action]: (prev[action] || 0) + 1 }));
          }
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  /* ── Realtime live actuals ── */
  useEffect(() => {
    const ch = supabase
      .channel('live-actuals')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subscriptions' }, () => {
        supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active").neq("plan", "free")
          .then(({ count }) => setLiveSubCount(count || 0));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'entries' }, () => {
        const thisMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
        setLiveEntryCountTotal(prev => prev + 1);
        supabase.from("entries").select("id", { count: "exact", head: true }).gte("created_at", thisMonthStart)
          .then(({ count }) => setLiveEntryCountMonth(count || 0));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  /* ── Save all ── */

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
        area: "profit_margins",
        entity_id: "site_settings.overhead",
        before: initialSnapshot.current ?? null,
        after,
      });
      initialSnapshot.current = after;
      toast.success("All profit margin settings saved");
    } catch {
      toast.error("Failed to save");
    }
    setSaving(false);
  }, [items, projectedEntries, projectedToolUses, subProjections, bundleProjections]);

  /* ── Overhead mutations ── */
  const updateItem = (id: string, field: keyof OverheadLineItem, val: string | number) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: val } : i));
  };
  const removeItem = (id: string) => setItems(prev => prev.filter(i => i.id !== id));
  const addItem = () => setItems(prev => [...prev, { id: uid(), label: "", category: "Other", amount: 0, notes: "" }]);

  /* ── Derived: Actuals ── */
  const totalRevenue = totalRevenueCents / 100;
  const onDemandDevCost = creditsUsed * costPerCredit;
  const prepaidDevCost = creditsPrepaid * costPerCreditPrepaid;
  const totalDevCost = onDemandDevCost + prepaidDevCost;
  const totalCreditsAll = creditsUsed + creditsPrepaid;
  const blendedRate = totalCreditsAll > 0 ? totalDevCost / totalCreditsAll : costPerCredit;
  const totalAiCost = totalTokensConsumed * aiCostPerToken;
  const carryoverTokens = totalTokensSold - totalTokensConsumed;

  /* ── Derived: Overhead ── */
  const monthlyOverhead = useMemo(() => items.reduce((s, i) => s + i.amount, 0), [items]);
  const categorySubtotals = useMemo(() => {
    const m: Record<string, number> = {};
    items.forEach(i => { m[i.category] = (m[i.category] || 0) + i.amount; });
    return CATEGORIES.filter(c => (m[c] || 0) > 0).map(c => ({ category: c, total: m[c] }));
  }, [items]);

  const entryOverheadShare = monthlyOverhead * 0.7;
  const toolOverheadShare = monthlyOverhead * 0.3;
  const allocPerEntry = projectedEntries > 0 ? entryOverheadShare / projectedEntries : 0;
  const allocPerTool = projectedToolUses > 0 ? toolOverheadShare / projectedToolUses : 0;

  /* ── Derived: Revenue projections ── */
  const subscriptionRevenue = useMemo(() => subProjections.reduce((s, sp) => s + sp.priceUsd * sp.projectedSubs, 0), [subProjections]);
  const bundleRevenue = useMemo(() => bundleProjections.reduce((s, bp) => s + bp.priceUsd * bp.projectedSalesPerMonth, 0), [bundleProjections]);
  const projectedMonthlyRevenue = subscriptionRevenue + bundleRevenue;

  /* ── Derived: True margins (actual + overhead) ── */
  const grossMargin = totalRevenue - totalAiCost;
  const netMarginWithOverhead = totalRevenue - totalAiCost - totalDevCost - monthlyOverhead;
  const grossPct = totalRevenue > 0 ? (grossMargin / totalRevenue) * 100 : 0;
  const netPct = totalRevenue > 0 ? (netMarginWithOverhead / totalRevenue) * 100 : 0;

  /* ── Derived: Per-entry / per-tool rows (model-aware) ── */
  const entryRows = LENGTH_CATEGORIES.map(cat => {
    const feeTokens = cat.cost;
    const feeRevenue = getFlatRevenue(feeTokens);
    const apiCost = getAvgApiCostForEntry(cat.key, selectedEntryModel);
    const trueCost = apiCost + allocPerEntry;
    const trueMargin = feeRevenue - trueCost;
    const marginPct = feeRevenue > 0 ? (trueMargin / feeRevenue) * 100 : 0;
    return { ...cat, feeTokens, feeRevenue, apiCost, allocOverhead: allocPerEntry, trueCost, trueMargin, marginPct };
  });

  const toolKeys = ["ai_score", "deep_analysis", "ai_script_generate", "ai_rewrite", "ai_suggest_rewrites", "logline_generate", "title_suggest", "scene_analysis"] as const;
  const toolRows = toolKeys.map(key => {
    const tokens = TOKEN_COSTS[key as keyof typeof TOKEN_COSTS] || 0;
    const revenue = getFlatRevenue(tokens);
    const apiCost = getAvgApiCostForTool(selectedToolModel);
    const trueCost = apiCost + allocPerTool;
    const trueMargin = revenue - trueCost;
    const marginPct = revenue > 0 ? (trueMargin / revenue) * 100 : 0;
    return { key, label: TOKEN_ACTION_LABELS[key as keyof typeof TOKEN_ACTION_LABELS] || key, tokens, revenue, apiCost, allocOverhead: allocPerTool, trueCost, trueMargin, marginPct };
  });

  /* ── All-models comparison (representative rows) ── */
  const allModelsEntry = useMemo(() => {
    const repCat = LENGTH_CATEGORIES.find(c => c.key === "vertical") || LENGTH_CATEGORIES[0];
    return MODEL_IDS.map(mid => {
      const m = MODEL_COSTS[mid];
      const feeTokens = repCat.cost;
      const revenue = getFlatRevenue(feeTokens);
      const apiCost = getAvgApiCostForEntry(repCat.key, mid);
      const trueCost = apiCost + allocPerEntry;
      const trueMargin = revenue - trueCost;
      const marginPct = revenue > 0 ? (trueMargin / revenue) * 100 : 0;
      return { modelId: mid, label: m.label, tier: m.tier, revenue, apiCost, trueCost, trueMargin, marginPct };
    });
  }, [allocPerEntry]);

  const allModelsTool = useMemo(() => {
    const repKey = "ai_score";
    const tokens = TOKEN_COSTS[repKey] || 0;
    return MODEL_IDS.map(mid => {
      const m = MODEL_COSTS[mid];
      const revenue = getFlatRevenue(tokens);
      const apiCost = getAvgApiCostForTool(mid);
      const trueCost = apiCost + allocPerTool;
      const trueMargin = revenue - trueCost;
      const marginPct = revenue > 0 ? (trueMargin / revenue) * 100 : 0;
      return { modelId: mid, label: m.label, tier: m.tier, revenue, apiCost, trueCost, trueMargin, marginPct };
    });
  }, [allocPerTool]);

  /* ── Competition P&L (derived) ── */
  const activeComp = competitions.find(c => c.id === selectedCompId);
  const compCatKeys = ["vertical", "micro", "short", "pilot_30", "pilot_60", "feature"] as const;

  const compEntryRows = useMemo(() => {
    if (!selectedCompId) return [];
    const counts = compEntryCounts[selectedCompId] || {};
    return compCatKeys.map(catKey => {
      const catMeta = LENGTH_CATEGORIES.find(c => c.key === catKey);
      const label = catMeta?.label || catKey;
      const entryCount = counts[catKey] || 0;
      const feeTokens = TOKEN_COSTS[`entry_${catKey}` as keyof typeof TOKEN_COSTS] || 200;
      const feeRevenue = getFlatRevenue(feeTokens);
      const totalRevenue = entryCount * feeRevenue;
      // Judge AI cost per entry = scoring one entry with selected model
      const judgeCostPerEntry = getAvgApiCostForEntry(catKey, selectedJudgeModel);
      const totalJudgeCost = entryCount * judgeCostPerEntry;
      const margin = totalRevenue - totalJudgeCost;
      const marginPct = totalRevenue > 0 ? (margin / totalRevenue) * 100 : 0;
      return { catKey, label, entryCount, feeTokens, feeRevenue, totalRevenue, judgeCostPerEntry, totalJudgeCost, margin, marginPct };
    }).filter(r => r.entryCount > 0 || true); // show all categories
  }, [selectedCompId, compEntryCounts, selectedJudgeModel]);

  const compTotals = useMemo(() => {
    const totalEntries = compEntryRows.reduce((s, r) => s + r.entryCount, 0);
    const totalRevenue = compEntryRows.reduce((s, r) => s + r.totalRevenue, 0);
    const totalJudgeCost = compEntryRows.reduce((s, r) => s + r.totalJudgeCost, 0);
    const actualJudgeCost = selectedCompId ? (compJudgeCosts[selectedCompId] || 0) : 0;
    const netMargin = totalRevenue - totalJudgeCost;
    const marginPct = totalRevenue > 0 ? (netMargin / totalRevenue) * 100 : 0;
    return { totalEntries, totalRevenue, totalJudgeCost, actualJudgeCost, netMargin, marginPct };
  }, [compEntryRows, selectedCompId, compJudgeCosts]);

  // All-models comparison for competition (representative: vertical entry judging)
  const allModelsComp = useMemo(() => {
    const repCat = "vertical";
    const feeTokens = TOKEN_COSTS.entry_vertical;
    return MODEL_IDS.map(mid => {
      const m = MODEL_COSTS[mid];
      const revenue = getFlatRevenue(feeTokens);
      const judgeCost = getAvgApiCostForEntry(repCat, mid);
      const margin = revenue - judgeCost;
      const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
      return { modelId: mid, label: m.label, tier: m.tier, revenue, judgeCost, margin, marginPct };
    });
  }, []);


  const avgSubPrice = useMemo(() => {
    const paidPlans = subProjections.filter(s => s.priceUsd > 0);
    if (paidPlans.length === 0) return 0;
    const totalSubs = paidPlans.reduce((s, p) => s + p.projectedSubs, 0);
    const totalRev = paidPlans.reduce((s, p) => s + p.priceUsd * p.projectedSubs, 0);
    return totalSubs > 0 ? totalRev / totalSubs : paidPlans[0].priceUsd;
  }, [subProjections]);

  const avgEntryMargin = useMemo(() => {
    return entryRows.reduce((s, r) => s + (r.feeRevenue - r.apiCost), 0) / entryRows.length;
  }, [entryRows]);

  const avgToolMargin = useMemo(() => {
    return toolRows.reduce((s, r) => s + (r.revenue - r.apiCost), 0) / toolRows.length;
  }, [toolRows]);

  const subsOnlyBreakeven = avgSubPrice > 0 ? Math.ceil(monthlyOverhead / avgSubPrice) : Infinity;
  const entriesOnlyBreakeven = avgEntryMargin > 0 ? Math.ceil(monthlyOverhead / avgEntryMargin) : Infinity;
  const toolsOnlyBreakeven = avgToolMargin > 0 ? Math.ceil(monthlyOverhead / avgToolMargin) : Infinity;

  /* ── What-if mixed P&L ── */
  const whatIfSubRev = whatIfSubs * avgSubPrice;
  const whatIfEntryRev = whatIfEntries * avgEntryMargin;
  const whatIfToolRev = whatIfTools * avgToolMargin;
  const whatIfTotal = whatIfSubRev + whatIfEntryRev + whatIfToolRev + bundleRevenue;
  const whatIfNetPL = whatIfTotal - monthlyOverhead;

  const recommendedPlan = LOVABLE_PLANS.find(p => p.credits >= Math.max(creditsUsed, 100)) || LOVABLE_PLANS[LOVABLE_PLANS.length - 1];

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Save button ── */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-muted-foreground">Unified Profit Margins</h2>
        <Button size="sm" variant="outline" onClick={handleSave} disabled={saving} className="gap-1">
          <Save className="h-3 w-3" />
          {saving ? "Saving…" : "Save All"}
        </Button>
      </div>

      {/* ── Cost inputs ── */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground font-mono">On-Demand:</span>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">$</span>
            <Input type="number" step="0.01" min="0" value={costPerCredit} onChange={e => setCostPerCredit(Number(e.target.value) || 0)} className="w-20 h-8 text-sm font-mono" />
          </div>
          <span className="text-muted-foreground">×</span>
          <span className="font-mono text-foreground">{creditsUsed.toLocaleString()} credits</span>
          <span className="text-muted-foreground">=</span>
          <span className="font-mono font-bold text-foreground">{fmt(onDemandDevCost)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground font-mono">Prepaid (20% off):</span>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">$</span>
            <Input type="number" step="0.01" min="0" value={costPerCreditPrepaid} onChange={e => setCostPerCreditPrepaid(Number(e.target.value) || 0)} className="w-20 h-8 text-sm font-mono" />
          </div>
          <span className="text-muted-foreground">×</span>
          <span className="font-mono text-foreground">{creditsPrepaid.toLocaleString()} credits</span>
          <span className="text-muted-foreground">=</span>
          <span className="font-mono font-bold text-foreground">{fmt(prepaidDevCost)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm border-t border-border/30 pt-2">
          <span className="text-muted-foreground font-mono">Blended:</span>
          <span className="font-mono font-bold">${blendedRate.toFixed(4)}/cr</span>
          <span className="text-muted-foreground">•</span>
          <span className="font-mono font-bold text-foreground">Dev Total: {fmt(totalDevCost)}</span>
        </div>
      </div>

      {/* ═══════ SECTION A: Summary Cards ═══════ */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <MetricCard icon={Hammer} label="Dev Cost" value={fmt(totalDevCost)} sub={`${totalCreditsAll} credits`} color="text-orange-500" />
        <MetricCard icon={DollarSign} label="Actual Revenue" value={fmt(totalRevenue)} sub="from purchases" color="text-emerald-500" />
        <MetricCard icon={Cpu} label="AI Cost" value={fmt(totalAiCost)} sub={`${totalTokensConsumed.toLocaleString()} tokens`} color="text-blue-500" />
        <MetricCard icon={Building2} label="Monthly Overhead" value={fmt(monthlyOverhead)} sub="fixed costs" color="text-amber-500" />
        <MetricCard icon={TrendingUp} label="Gross Margin" value={fmt(grossMargin)} sub={pct(grossPct)} color={grossMargin >= 0 ? "text-emerald-500" : "text-destructive"} />
        <MetricCard icon={netMarginWithOverhead >= 0 ? TrendingUp : TrendingDown} label="True Net Margin" value={fmt(netMarginWithOverhead)} sub={pct(netPct)} color={netMarginWithOverhead >= 0 ? "text-emerald-500" : "text-destructive"} />
        <MetricCard icon={Coins} label="Tokens Sold" value={totalTokensSold.toLocaleString()} sub="total purchased" color="text-emerald-500" />
        <MetricCard icon={Wallet} label="Carryover" value={carryoverTokens.toLocaleString()} sub="liability in wallets" color={carryoverTokens > 0 ? "text-amber-500" : "text-emerald-500"} />
      </div>

      {/* ═══════ Monthly Breakdown ═══════ */}
      {monthlyData.length > 0 && (
        <Card className="border-border/50 bg-card/80">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-mono">Actual Monthly Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-mono text-xs">Month</TableHead>
                  <TableHead className="font-mono text-xs text-right">Revenue</TableHead>
                  <TableHead className="font-mono text-xs text-right">AI Cost</TableHead>
                  <TableHead className="font-mono text-xs text-right">Dev Cost</TableHead>
                  <TableHead className="font-mono text-xs text-right">Gross</TableHead>
                  <TableHead className="font-mono text-xs text-right">Net</TableHead>
                  <TableHead className="font-mono text-xs text-right">Sold</TableHead>
                  <TableHead className="font-mono text-xs text-right">Used</TableHead>
                  <TableHead className="font-mono text-xs text-right">Carry</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthlyData.map((row: any) => (
                  <TableRow key={row.month}>
                    <TableCell className="font-mono text-xs">{row.month}</TableCell>
                    <TableCell className="font-mono text-xs text-right text-emerald-500">{fmt(row.revenue)}</TableCell>
                    <TableCell className="font-mono text-xs text-right text-blue-500">{fmt(row.aiCost)}</TableCell>
                    <TableCell className="font-mono text-xs text-right text-orange-500">{fmt(row.devCost)}</TableCell>
                    <TableCell className={`font-mono text-xs text-right ${row.gross >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmt(row.gross)}</TableCell>
                    <TableCell className={`font-mono text-xs text-right ${row.net >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmt(row.net)}</TableCell>
                    <TableCell className="font-mono text-xs text-right">{row.tokensSold.toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs text-right">{row.tokensConsumed.toLocaleString()}</TableCell>
                    <TableCell className={`font-mono text-xs text-right ${row.carryover > 0 ? "text-amber-500" : "text-emerald-500"}`}>{row.carryover.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ═══════ SECTION B: Recurring Overhead ═══════ */}
      <Card className="border-border/50 bg-card/80">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Building2 className="h-4 w-4 text-amber-500" />
            Recurring Monthly Overhead
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="hidden md:grid grid-cols-[1fr_140px_100px_1fr_36px] gap-2 text-[10px] font-mono text-muted-foreground uppercase tracking-wider px-1">
            <span>Label</span><span>Category</span><span>$/Month</span><span>Notes</span><span />
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
              <Input value={item.notes} onChange={e => updateItem(item.id, "notes", e.target.value)} placeholder="Notes…" className="h-8 text-xs font-mono text-muted-foreground" />
              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive/60 hover:text-destructive" onClick={() => removeItem(item.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={addItem} className="gap-1 mt-1">
            <Plus className="h-3 w-3" /> Add Line Item
          </Button>
          <div className="border-t border-border/30 pt-3 mt-3 flex flex-wrap gap-4">
            {categorySubtotals.map(cs => (
              <div key={cs.category} className="font-mono text-xs">
                <span className={CATEGORY_COLORS[cs.category] || "text-muted-foreground"}>{cs.category}:</span>{" "}
                <span className="font-bold">{fmt(cs.total)}</span>
              </div>
            ))}
            <div className="font-mono text-xs ml-auto">
              <span className="text-amber-500 font-bold">Total: {fmt(monthlyOverhead)}/mo</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ═══════ SECTION C: Revenue Projections ═══════ */}
      <Card className="border-border/50 bg-card/80">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-emerald-500" />
            Projected Monthly Revenue
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Subscriptions */}
          <div>
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
              <Users className="h-3 w-3" /> Platform Subscriptions
            </p>
            {subProjections.map((sp, idx) => (
              <div key={sp.planKey} className="grid grid-cols-1 md:grid-cols-[1fr_100px_100px_120px] gap-2 items-center mb-1">
                <span className="text-xs font-mono truncate">{sp.label}</span>
                <span className="text-xs font-mono text-muted-foreground">{fmt(sp.priceUsd)}</span>
                <Input type="number" min="0" step="1" value={sp.projectedSubs} onChange={e => {
                  const val = Number(e.target.value) || 0;
                  setSubProjections(prev => prev.map((s, i) => i === idx ? { ...s, projectedSubs: val } : s));
                }} className="h-7 text-xs font-mono w-20" />
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
            {bundleProjections.map((bp, idx) => (
              <div key={bp.bundleName} className="grid grid-cols-1 md:grid-cols-[1fr_100px_100px_120px] gap-2 items-center mb-1">
                <span className="text-xs font-mono truncate">{bp.bundleName}</span>
                <span className="text-xs font-mono text-muted-foreground">{fmt(bp.priceUsd)}</span>
                <Input type="number" min="0" step="1" value={bp.projectedSalesPerMonth} onChange={e => {
                  const val = Number(e.target.value) || 0;
                  setBundleProjections(prev => prev.map((b, i) => i === idx ? { ...b, projectedSalesPerMonth: val } : b));
                }} className="h-7 text-xs font-mono w-20" />
                <span className="text-xs font-mono font-bold text-emerald-500">{fmt(bp.priceUsd * bp.projectedSalesPerMonth)}</span>
              </div>
            ))}
            <div className="flex justify-end mt-1">
              <span className="text-xs font-mono text-muted-foreground">Subtotal:</span>
              <span className="text-xs font-mono font-bold text-emerald-500 ml-2">{fmt(bundleRevenue)}/mo</span>
            </div>
          </div>

          <div className="border-t border-border/30 pt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="font-mono">
              <span className="text-[10px] text-muted-foreground uppercase block tracking-wider">Subscription Rev</span>
              <span className="font-bold text-emerald-500">{fmt(subscriptionRevenue)}</span>
            </div>
            <div className="font-mono">
              <span className="text-[10px] text-muted-foreground uppercase block tracking-wider">Bundle Rev</span>
              <span className="font-bold text-emerald-500">{fmt(bundleRevenue)}</span>
            </div>
            <div className="font-mono">
              <span className="text-[10px] text-muted-foreground uppercase block tracking-wider">Total Projected</span>
              <span className="font-bold text-lg text-emerald-500">{fmt(projectedMonthlyRevenue)}</span>
            </div>
            <div className="font-mono">
              <span className="text-[10px] text-muted-foreground uppercase block tracking-wider">Net (Proj − Overhead)</span>
              <span className={`font-bold text-lg ${projectedMonthlyRevenue - monthlyOverhead >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                {fmt(projectedMonthlyRevenue - monthlyOverhead)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ═══════ SECTION D: Break-Even Dashboard ═══════ */}
      <Card className="border-primary/30 bg-card/90 border-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            ★ Unified Break-Even Dashboard
          </CardTitle>
          <p className="text-[10px] text-muted-foreground mt-1">
            How many of each revenue path you need to cover {fmt(monthlyOverhead)}/mo overhead.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* ── Live Actuals Tracker ── */}
          {(() => {
            const now = new Date();
            const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
            const toolUsesMonth = Object.values(usageThisMonth).reduce((s, v) => s + v, 0);
            const toolUsesTotal = Object.values(usageAllTime).reduce((s, v) => s + v, 0);

            const subPct = subsOnlyBreakeven === Infinity ? 0 : Math.min((liveSubCount / subsOnlyBreakeven) * 100, 100);
            const entryPct = entriesOnlyBreakeven === Infinity ? 0 : Math.min((liveEntryCountMonth / entriesOnlyBreakeven) * 100, 100);
            const toolPct = toolsOnlyBreakeven === Infinity ? 0 : Math.min((toolUsesMonth / toolsOnlyBreakeven) * 100, 100);

            const barColor = (pctVal: number) =>
              pctVal >= 80 ? "bg-emerald-500" : pctVal >= 40 ? "bg-amber-500" : "bg-destructive";

            return (
              <div className="border border-primary/20 rounded-lg p-4 bg-primary/5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary animate-pulse" />
                    <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider font-bold">Live This Month</span>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground">{monthLabel}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Paid Subscribers */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 text-primary" />
                      <span className="text-[10px] font-mono text-muted-foreground">Paid Subscribers</span>
                    </div>
                    <p className="text-xl font-bold font-mono">{liveSubCount}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">active now · need {subsOnlyBreakeven === Infinity ? "∞" : subsOnlyBreakeven} to break even</p>
                    <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${barColor(subPct)}`} style={{ width: `${subPct}%` }} />
                    </div>
                  </div>
                  {/* Entries */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Coins className="h-3.5 w-3.5 text-emerald-500" />
                      <span className="text-[10px] font-mono text-muted-foreground">Entries</span>
                    </div>
                    <p className="text-xl font-bold font-mono">
                      {liveEntryCountMonth} <span className="text-sm text-muted-foreground font-normal">/ {liveEntryCountTotal}</span>
                    </p>
                    <p className="text-[10px] text-muted-foreground font-mono">this mo / all-time · need {entriesOnlyBreakeven === Infinity ? "∞" : entriesOnlyBreakeven}/mo</p>
                    <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${barColor(entryPct)}`} style={{ width: `${entryPct}%` }} />
                    </div>
                  </div>
                  {/* Tool Uses */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Cpu className="h-3.5 w-3.5 text-blue-500" />
                      <span className="text-[10px] font-mono text-muted-foreground">Tool Uses</span>
                    </div>
                    <p className="text-xl font-bold font-mono">
                      {toolUsesMonth} <span className="text-sm text-muted-foreground font-normal">/ {toolUsesTotal}</span>
                    </p>
                    <p className="text-[10px] text-muted-foreground font-mono">this mo / all-time · need {toolsOnlyBreakeven === Infinity ? "∞" : toolsOnlyBreakeven}/mo</p>
                    <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${barColor(toolPct)}`} style={{ width: `${toolPct}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Single-path break-even */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border border-border/40 rounded-lg p-4 text-center">
              <Users className="h-5 w-5 mx-auto text-primary mb-2" />
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Subs Only</p>
              <p className="text-2xl font-bold font-mono">{subsOnlyBreakeven === Infinity ? "∞" : subsOnlyBreakeven.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">paid subscribers @ avg {fmt(avgSubPrice)}/mo</p>
            </div>
            <div className="border border-border/40 rounded-lg p-4 text-center">
              <Coins className="h-5 w-5 mx-auto text-emerald-500 mb-2" />
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Entries Only</p>
              <p className="text-2xl font-bold font-mono">{entriesOnlyBreakeven === Infinity ? "∞" : entriesOnlyBreakeven.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">entries/mo @ avg margin {fmt(avgEntryMargin)}</p>
            </div>
            <div className="border border-border/40 rounded-lg p-4 text-center">
              <Cpu className="h-5 w-5 mx-auto text-blue-500 mb-2" />
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Tool Uses Only</p>
              <p className="text-2xl font-bold font-mono">{toolsOnlyBreakeven === Infinity ? "∞" : toolsOnlyBreakeven.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">tool clicks/mo @ avg margin {fmt(avgToolMargin)}</p>
            </div>
          </div>

          {/* What-If Sliders */}
          <div className="border-t border-border/30 pt-4 space-y-4">
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">What-If Forecast (Mixed Revenue)</p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-muted-foreground">Paid Subscribers</span>
                  <span className="font-bold">{whatIfSubs}</span>
                </div>
                <Slider value={[whatIfSubs]} onValueChange={v => setWhatIfSubs(v[0])} min={0} max={200} step={1} />
                <p className="text-[10px] text-muted-foreground">{fmt(whatIfSubRev)}/mo</p>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-muted-foreground">Entries / Month</span>
                  <span className="font-bold">{whatIfEntries}</span>
                </div>
                <Slider value={[whatIfEntries]} onValueChange={v => setWhatIfEntries(v[0])} min={0} max={500} step={5} />
                <p className="text-[10px] text-muted-foreground">{fmt(whatIfEntryRev)}/mo margin</p>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-muted-foreground">Tool Uses / Month</span>
                  <span className="font-bold">{whatIfTools}</span>
                </div>
                <Slider value={[whatIfTools]} onValueChange={v => setWhatIfTools(v[0])} min={0} max={2000} step={10} />
                <p className="text-[10px] text-muted-foreground">{fmt(whatIfToolRev)}/mo margin</p>
              </div>
            </div>

            {/* Mixed result */}
            <div className="border border-border/40 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="font-mono">
                <span className="text-[10px] text-muted-foreground uppercase block tracking-wider">Mixed Revenue (Projected)</span>
                <span className="font-bold text-lg text-emerald-500">{fmt(whatIfTotal)}</span>
              </div>
              <div className="font-mono">
                <span className="text-[10px] text-muted-foreground uppercase block tracking-wider">Monthly Overhead</span>
                <span className="font-bold text-lg text-amber-500">{fmt(monthlyOverhead)}</span>
              </div>
              <div className="font-mono">
                <span className="text-[10px] text-muted-foreground uppercase block tracking-wider">Net Monthly P&L</span>
                <span className={`font-bold text-2xl ${whatIfNetPL >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                  {fmt(whatIfNetPL)}
                </span>
              </div>
              <Badge variant={whatIfNetPL >= 0 ? "default" : "destructive"} className="text-sm font-mono">
                {whatIfNetPL >= 0 ? "✓ Profitable" : "⚠ Loss"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ═══════ SECTION D½: Per-Subscriber True Cost ═══════ */}
      <Card className="border-border/50 bg-card/80">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-mono">Per-Subscriber True Cost</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Free user slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-muted-foreground">Free (non-paying) users sharing overhead</span>
              <span className="font-bold">{freeUserCount}</span>
            </div>
            <Slider min={0} max={500} step={5} value={[freeUserCount]} onValueChange={([v]) => setFreeUserCount(v)} />
          </div>

          {/* Tier Economics Table */}
          {(() => {
            const totalUsers = (subProjections.reduce((s, sp) => s + sp.projectedSubs, 0)) + freeUserCount;
            const overheadShare = totalUsers > 0 ? monthlyOverhead / totalUsers : monthlyOverhead;
            const PLAN_ROWS = [
              { name: "Free", price: 0, tokens: 0 },
              { name: "Pro", price: 19, tokens: 200 },
              { name: "Studio", price: 0, tokens: 0, isCustom: true },
            ];
            return (
              <>
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Tier Economics (projected {totalUsers} total users)</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px]">Tier</TableHead>
                        <TableHead className="text-[10px] text-right">Price/mo</TableHead>
                        <TableHead className="text-[10px] text-right">Included ⊘</TableHead>
                        <TableHead className="text-[10px] text-right">Token Value</TableHead>
                        <TableHead className="text-[10px] text-right">Overhead Share</TableHead>
                        <TableHead className="text-[10px] text-right">True Cost</TableHead>
                        <TableHead className="text-[10px] text-right bg-primary/5">Suggested Price</TableHead>
                        <TableHead className="text-[10px] text-right">Margin</TableHead>
                        <TableHead className="text-[10px] text-right">Margin %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {PLAN_ROWS.map(p => {
                        const tokenValue = p.tokens * TOKEN_VALUE_USD;
                        const trueCost = overheadShare + tokenValue;
                        const margin = p.price - trueCost;
                        const marginPctVal = p.price > 0 ? (margin / p.price) * 100 : 0;
                        // Suggested = true cost / (1 - target margin) → targets 50% margin
                        const suggestedPrice = trueCost / (1 - 0.50);
                        return (
                          <TableRow key={p.name}>
                            <TableCell className="text-xs font-mono font-semibold">{p.name}</TableCell>
                            <TableCell className="text-xs font-mono text-right">{p.isCustom ? "Custom" : fmt(p.price)}</TableCell>
                            <TableCell className="text-xs font-mono text-right">{p.tokens.toLocaleString()}⊘</TableCell>
                            <TableCell className="text-xs font-mono text-right">{fmt(tokenValue)}</TableCell>
                            <TableCell className="text-xs font-mono text-right">{fmt(overheadShare)}</TableCell>
                            <TableCell className="text-xs font-mono text-right">{fmt(trueCost)}</TableCell>
                            <TableCell className="text-xs font-mono text-right font-bold text-primary bg-primary/5">
                              {fmt(suggestedPrice)}
                            </TableCell>
                            <TableCell className={`text-xs font-mono text-right font-bold ${p.isCustom ? "text-muted-foreground" : margin >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                              {p.isCustom ? "—" : fmt(margin)}
                            </TableCell>
                            <TableCell className={`text-xs font-mono text-right ${p.isCustom ? "text-muted-foreground" : marginPctVal >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                              {p.isCustom || p.price === 0 ? "—" : pct(marginPctVal)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </>
            );
          })()}

          {/* Token Bundle Economics Table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Token Bundle Economics</p>
              <Select value={selectedBundleModel} onValueChange={setSelectedBundleModel}>
                <SelectTrigger className="h-7 w-48 text-xs font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_IDS.map(mid => (
                    <SelectItem key={mid} value={mid} className="text-xs font-mono">
                      {MODEL_COSTS[mid].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px]">Bundle</TableHead>
                  <TableHead className="text-[10px] text-right">Price</TableHead>
                  <TableHead className="text-[10px] text-right">Tokens</TableHead>
                  <TableHead className="text-[10px] text-right">$/Token</TableHead>
                  <TableHead className="text-[10px] text-right">Avg AI Cost</TableHead>
                  <TableHead className="text-[10px] text-right bg-primary/5">Suggested Price</TableHead>
                  <TableHead className="text-[10px] text-right">Platform Margin</TableHead>
                  <TableHead className="text-[10px] text-right">Margin %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TOKEN_BUNDLES.map(b => {
                  const priceUsd = b.priceCents / 100;
                  const perToken = priceUsd / b.tokens;
                  const avgAiCost = b.tokens * getAvgApiCostForTool(selectedBundleModel) / 150;
                  const platformMargin = priceUsd - avgAiCost;
                  const marginPctVal = priceUsd > 0 ? (platformMargin / priceUsd) * 100 : 0;
                  // Suggested = AI cost / (1 - target margin) → targets 50% margin
                  const suggestedPrice = avgAiCost / (1 - 0.50);
                  return (
                    <TableRow key={b.name}>
                      <TableCell className="text-xs font-mono font-semibold">{b.name}</TableCell>
                      <TableCell className="text-xs font-mono text-right">{fmt(priceUsd)}</TableCell>
                      <TableCell className="text-xs font-mono text-right">{b.tokens.toLocaleString()}⊘</TableCell>
                      <TableCell className="text-xs font-mono text-right">${perToken.toFixed(4)}</TableCell>
                      <TableCell className="text-xs font-mono text-right">{fmt(avgAiCost)}</TableCell>
                      <TableCell className="text-xs font-mono text-right font-bold text-primary bg-primary/5">
                        {fmt(suggestedPrice)}
                      </TableCell>
                      <TableCell className={`text-xs font-mono text-right font-bold ${platformMargin >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                        {fmt(platformMargin)}
                      </TableCell>
                      <TableCell className={`text-xs font-mono text-right ${marginPctVal >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                        {pct(marginPctVal)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ═══════ SECTION E: Per-Entry True Cost ═══════ */}
      <Card className="border-border/50 bg-card/80">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-mono">Per-Entry True Cost</CardTitle>
              <Select value={selectedEntryModel} onValueChange={setSelectedEntryModel}>
                <SelectTrigger className="h-7 w-48 text-xs font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_IDS.map(mid => (
                    <SelectItem key={mid} value={mid} className="text-xs font-mono">
                      {MODEL_COSTS[mid].label} ({MODEL_COSTS[mid].tier})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono">
              <label className="flex items-center gap-1 text-muted-foreground">
                <Calculator className="h-3 w-3" /> Entries/mo
              </label>
              <Input type="number" min="0" step="1" value={projectedEntries} onChange={e => setProjectedEntries(Number(e.target.value) || 0)} className="h-7 w-16 text-xs font-mono" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-mono text-xs">Category</TableHead>
                <TableHead className="font-mono text-xs text-right">Uses</TableHead>
                <TableHead className="font-mono text-xs text-right">Fee (⊘)</TableHead>
                <TableHead className="font-mono text-xs text-right bg-primary/5">Suggested ⊘</TableHead>
                <TableHead className="font-mono text-xs text-right">Revenue</TableHead>
                <TableHead className="font-mono text-xs text-right">Actual Rev</TableHead>
                <TableHead className="font-mono text-xs text-right">AI Cost</TableHead>
                <TableHead className="font-mono text-xs text-right">Overhead</TableHead>
                <TableHead className="font-mono text-xs text-right">True Cost</TableHead>
                <TableHead className="font-mono text-xs text-right">True Margin</TableHead>
                <TableHead className="font-mono text-xs text-right">Margin %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entryRows.map(r => {
                const actionKey = `entry_${r.key}`;
                const allTime = usageAllTime[actionKey] || 0;
                const thisMo = usageThisMonth[actionKey] || 0;
                const actualRev = allTime * r.feeRevenue;
                // Suggested tokens = true cost / TOKEN_VALUE_USD / (1 - 0.50) → 50% margin target
                const suggestedTokens = Math.ceil(r.trueCost / TOKEN_VALUE_USD / (1 - 0.50));
                return (
                  <TableRow key={r.key}>
                    <TableCell className="font-mono text-xs">{r.label}</TableCell>
                    <TableCell className="font-mono text-xs text-right">
                      <span className="font-bold">{allTime.toLocaleString()}</span>
                      <span className="text-muted-foreground ml-1">({thisMo} this mo)</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-right">{r.feeTokens}⊘</TableCell>
                    <TableCell className={`font-mono text-xs text-right font-bold bg-primary/5 ${suggestedTokens > r.feeTokens ? "text-destructive" : "text-primary"}`}>
                      {suggestedTokens}⊘
                    </TableCell>
                    <TableCell className="font-mono text-xs text-right text-emerald-500">{fmt(r.feeRevenue)}</TableCell>
                    <TableCell className="font-mono text-xs text-right text-emerald-400 font-bold">{fmt(actualRev)}</TableCell>
                    <TableCell className="font-mono text-xs text-right text-blue-500">{fmt(r.apiCost)}</TableCell>
                    <TableCell className="font-mono text-xs text-right text-amber-500">{fmt(r.allocOverhead)}</TableCell>
                    <TableCell className="font-mono text-xs text-right text-orange-500">{fmt(r.trueCost)}</TableCell>
                    <TableCell className={`font-mono text-xs text-right ${r.trueMargin >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmt(r.trueMargin)}</TableCell>
                    <TableCell className={`font-mono text-xs text-right ${r.marginPct >= 0 ? "text-emerald-500" : "text-destructive"}`}>{pct(r.marginPct)}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="border-t-2 border-border font-bold">
                <TableCell className="font-mono text-xs">TOTAL</TableCell>
                <TableCell className="font-mono text-xs text-right">
                  {ENTRY_ACTION_KEYS.reduce((s, k) => s + (usageAllTime[k] || 0), 0).toLocaleString()}
                  <span className="text-muted-foreground ml-1 font-normal">({ENTRY_ACTION_KEYS.reduce((s, k) => s + (usageThisMonth[k] || 0), 0)} this mo)</span>
                </TableCell>
                <TableCell className="font-mono text-xs text-right" />
                <TableCell className="font-mono text-xs text-right" />
                <TableCell className="font-mono text-xs text-right text-emerald-400">
                  {fmt(entryRows.reduce((s, r) => s + (usageAllTime[`entry_${r.key}`] || 0) * r.feeRevenue, 0))}
                </TableCell>
                <TableCell colSpan={5} />
              </TableRow>
            </TableBody>
          </Table>

          {/* All Models comparison for entries */}
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors group">
              <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
              Compare All Models (Vertical entry)
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-mono text-xs">Model</TableHead>
                    <TableHead className="font-mono text-xs">Tier</TableHead>
                    <TableHead className="font-mono text-xs text-right">Revenue</TableHead>
                    <TableHead className="font-mono text-xs text-right">AI Cost</TableHead>
                    <TableHead className="font-mono text-xs text-right">True Cost</TableHead>
                    <TableHead className="font-mono text-xs text-right">True Margin</TableHead>
                    <TableHead className="font-mono text-xs text-right">Margin %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allModelsEntry.map(row => (
                    <TableRow key={row.modelId} className={row.modelId === selectedEntryModel ? "bg-muted/30" : ""}>
                      <TableCell className="font-mono text-xs">{row.label}</TableCell>
                      <TableCell className="font-mono text-xs">
                        <Badge variant="outline" className="text-[10px] font-mono">{row.tier}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-right text-emerald-500">{fmt(row.revenue)}</TableCell>
                      <TableCell className="font-mono text-xs text-right text-blue-500">{fmt(row.apiCost)}</TableCell>
                      <TableCell className="font-mono text-xs text-right text-orange-500">{fmt(row.trueCost)}</TableCell>
                      <TableCell className={`font-mono text-xs text-right ${row.trueMargin >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmt(row.trueMargin)}</TableCell>
                      <TableCell className={`font-mono text-xs text-right ${row.marginPct >= 0 ? "text-emerald-500" : "text-destructive"}`}>{pct(row.marginPct)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* ═══════ Per-Tool True Cost ═══════ */}
      <Card className="border-border/50 bg-card/80">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-mono">Per-Tool True Cost</CardTitle>
              <Select value={selectedToolModel} onValueChange={setSelectedToolModel}>
                <SelectTrigger className="h-7 w-48 text-xs font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_IDS.map(mid => (
                    <SelectItem key={mid} value={mid} className="text-xs font-mono">
                      {MODEL_COSTS[mid].label} ({MODEL_COSTS[mid].tier})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono">
              <label className="flex items-center gap-1 text-muted-foreground">
                <Calculator className="h-3 w-3" /> Uses/mo
              </label>
              <Input type="number" min="0" step="1" value={projectedToolUses} onChange={e => setProjectedToolUses(Number(e.target.value) || 0)} className="h-7 w-16 text-xs font-mono" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-mono text-xs">Tool</TableHead>
                <TableHead className="font-mono text-xs text-right">Uses</TableHead>
                <TableHead className="font-mono text-xs text-right">Cost (⊘)</TableHead>
                <TableHead className="font-mono text-xs text-right bg-primary/5">Suggested ⊘</TableHead>
                <TableHead className="font-mono text-xs text-right">Revenue</TableHead>
                <TableHead className="font-mono text-xs text-right">Actual Rev</TableHead>
                <TableHead className="font-mono text-xs text-right">AI Cost</TableHead>
                <TableHead className="font-mono text-xs text-right">Overhead</TableHead>
                <TableHead className="font-mono text-xs text-right">True Cost</TableHead>
                <TableHead className="font-mono text-xs text-right">True Margin</TableHead>
                <TableHead className="font-mono text-xs text-right">Margin %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {toolRows.map(r => {
                const allTime = usageAllTime[r.key] || 0;
                const thisMo = usageThisMonth[r.key] || 0;
                const actualRev = allTime * r.revenue;
                const suggestedTokens = Math.ceil(r.trueCost / TOKEN_VALUE_USD / (1 - 0.50));
                return (
                  <TableRow key={r.key}>
                    <TableCell className="font-mono text-xs">{r.label}</TableCell>
                    <TableCell className="font-mono text-xs text-right">
                      <span className="font-bold">{allTime.toLocaleString()}</span>
                      <span className="text-muted-foreground ml-1">({thisMo} this mo)</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-right">{r.tokens}⊘</TableCell>
                    <TableCell className={`font-mono text-xs text-right font-bold bg-primary/5 ${suggestedTokens > r.tokens ? "text-destructive" : "text-primary"}`}>
                      {suggestedTokens}⊘
                    </TableCell>
                    <TableCell className="font-mono text-xs text-right text-emerald-500">{fmt(r.revenue)}</TableCell>
                    <TableCell className="font-mono text-xs text-right text-emerald-400 font-bold">{fmt(actualRev)}</TableCell>
                    <TableCell className="font-mono text-xs text-right text-blue-500">{fmt(r.apiCost)}</TableCell>
                    <TableCell className="font-mono text-xs text-right text-amber-500">{fmt(r.allocOverhead)}</TableCell>
                    <TableCell className="font-mono text-xs text-right text-orange-500">{fmt(r.trueCost)}</TableCell>
                    <TableCell className={`font-mono text-xs text-right ${r.trueMargin >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmt(r.trueMargin)}</TableCell>
                    <TableCell className={`font-mono text-xs text-right ${r.marginPct >= 0 ? "text-emerald-500" : "text-destructive"}`}>{pct(r.marginPct)}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="border-t-2 border-border font-bold">
                <TableCell className="font-mono text-xs">TOTAL</TableCell>
                <TableCell className="font-mono text-xs text-right">
                  {TOOL_ACTION_KEYS.reduce((s, k) => s + (usageAllTime[k] || 0), 0).toLocaleString()}
                  <span className="text-muted-foreground ml-1 font-normal">({TOOL_ACTION_KEYS.reduce((s, k) => s + (usageThisMonth[k] || 0), 0)} this mo)</span>
                </TableCell>
                <TableCell className="font-mono text-xs text-right" />
                <TableCell className="font-mono text-xs text-right" />
                <TableCell className="font-mono text-xs text-right text-emerald-400">
                  {fmt(toolRows.reduce((s, r) => s + (usageAllTime[r.key] || 0) * r.revenue, 0))}
                </TableCell>
                <TableCell colSpan={5} />
              </TableRow>
            </TableBody>
          </Table>

          {/* All Models comparison for tools */}
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors group">
              <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
              Compare All Models (AI Score)
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-mono text-xs">Model</TableHead>
                    <TableHead className="font-mono text-xs">Tier</TableHead>
                    <TableHead className="font-mono text-xs text-right">Revenue</TableHead>
                    <TableHead className="font-mono text-xs text-right">AI Cost</TableHead>
                    <TableHead className="font-mono text-xs text-right">True Cost</TableHead>
                    <TableHead className="font-mono text-xs text-right">True Margin</TableHead>
                    <TableHead className="font-mono text-xs text-right">Margin %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allModelsTool.map(row => (
                    <TableRow key={row.modelId} className={row.modelId === selectedToolModel ? "bg-muted/30" : ""}>
                      <TableCell className="font-mono text-xs">{row.label}</TableCell>
                      <TableCell className="font-mono text-xs">
                        <Badge variant="outline" className="text-[10px] font-mono">{row.tier}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-right text-emerald-500">{fmt(row.revenue)}</TableCell>
                      <TableCell className="font-mono text-xs text-right text-blue-500">{fmt(row.apiCost)}</TableCell>
                      <TableCell className="font-mono text-xs text-right text-orange-500">{fmt(row.trueCost)}</TableCell>
                      <TableCell className={`font-mono text-xs text-right ${row.trueMargin >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmt(row.trueMargin)}</TableCell>
                      <TableCell className={`font-mono text-xs text-right ${row.marginPct >= 0 ? "text-emerald-500" : "text-destructive"}`}>{pct(row.marginPct)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* ═══════ SECTION G: Competition P&L ═══════ */}
      {competitions.length > 0 && (
        <Card className="border-primary/20 bg-card/80">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-500" />
                <CardTitle className="text-sm font-mono">Competition P&L</CardTitle>
                {competitions.length > 1 && (
                  <Select value={selectedCompId || ""} onValueChange={setSelectedCompId}>
                    <SelectTrigger className="h-7 w-56 text-xs font-mono">
                      <SelectValue placeholder="Select competition" />
                    </SelectTrigger>
                    <SelectContent>
                      {competitions.map(c => (
                        <SelectItem key={c.id} value={c.id} className="text-xs font-mono">
                          {c.name} ({c.status})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-muted-foreground uppercase">Judge Model:</span>
                <Select value={selectedJudgeModel} onValueChange={setSelectedJudgeModel}>
                  <SelectTrigger className="h-7 w-48 text-xs font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_IDS.map(mid => (
                      <SelectItem key={mid} value={mid} className="text-xs font-mono">
                        {MODEL_COSTS[mid].label} ({MODEL_COSTS[mid].tier})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {activeComp && (
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                {activeComp.name} — <Badge variant="outline" className="text-[10px] font-mono">{activeComp.status}</Badge>
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Summary metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard icon={Users} label="Total Entries" value={compTotals.totalEntries.toString()} sub="across all categories" color="text-primary" />
              <MetricCard icon={DollarSign} label="Entry Revenue" value={fmt(compTotals.totalRevenue)} sub="from entry fees" color="text-emerald-500" />
              <MetricCard icon={Cpu} label="Judge AI Cost" value={fmt(compTotals.totalJudgeCost)} sub={`simulated • actual: ${fmt(compTotals.actualJudgeCost)}`} color="text-blue-500" />
              <MetricCard icon={compTotals.netMargin >= 0 ? TrendingUp : TrendingDown} label="Net Margin" value={fmt(compTotals.netMargin)} sub={pct(compTotals.marginPct)} color={compTotals.netMargin >= 0 ? "text-emerald-500" : "text-destructive"} />
            </div>

            {/* Category breakdown table */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-mono text-xs">Category</TableHead>
                  <TableHead className="font-mono text-xs text-right">Entries</TableHead>
                  <TableHead className="font-mono text-xs text-right">Fee (⊘)</TableHead>
                  <TableHead className="font-mono text-xs text-right">Revenue/ea</TableHead>
                  <TableHead className="font-mono text-xs text-right">Total Revenue</TableHead>
                  <TableHead className="font-mono text-xs text-right">Judge Cost/ea</TableHead>
                  <TableHead className="font-mono text-xs text-right">Total Judge Cost</TableHead>
                  <TableHead className="font-mono text-xs text-right">Margin</TableHead>
                  <TableHead className="font-mono text-xs text-right">Margin %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {compEntryRows.map(r => (
                  <TableRow key={r.catKey}>
                    <TableCell className="font-mono text-xs">{r.label}</TableCell>
                    <TableCell className="font-mono text-xs text-right font-bold">{r.entryCount}</TableCell>
                    <TableCell className="font-mono text-xs text-right">{r.feeTokens}⊘</TableCell>
                    <TableCell className="font-mono text-xs text-right text-emerald-500">{fmt(r.feeRevenue)}</TableCell>
                    <TableCell className="font-mono text-xs text-right text-emerald-400 font-bold">{fmt(r.totalRevenue)}</TableCell>
                    <TableCell className="font-mono text-xs text-right text-blue-500">{fmt(r.judgeCostPerEntry)}</TableCell>
                    <TableCell className="font-mono text-xs text-right text-blue-400">{fmt(r.totalJudgeCost)}</TableCell>
                    <TableCell className={`font-mono text-xs text-right ${r.margin >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmt(r.margin)}</TableCell>
                    <TableCell className={`font-mono text-xs text-right ${r.marginPct >= 0 ? "text-emerald-500" : "text-destructive"}`}>{pct(r.marginPct)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 border-border font-bold">
                  <TableCell className="font-mono text-xs">TOTALS</TableCell>
                  <TableCell className="font-mono text-xs text-right">{compTotals.totalEntries}</TableCell>
                  <TableCell className="font-mono text-xs text-right" />
                  <TableCell className="font-mono text-xs text-right" />
                  <TableCell className="font-mono text-xs text-right text-emerald-400">{fmt(compTotals.totalRevenue)}</TableCell>
                  <TableCell className="font-mono text-xs text-right" />
                  <TableCell className="font-mono text-xs text-right text-blue-400">{fmt(compTotals.totalJudgeCost)}</TableCell>
                  <TableCell className={`font-mono text-xs text-right ${compTotals.netMargin >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmt(compTotals.netMargin)}</TableCell>
                  <TableCell className={`font-mono text-xs text-right ${compTotals.marginPct >= 0 ? "text-emerald-500" : "text-destructive"}`}>{pct(compTotals.marginPct)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>

            {/* Actual vs Simulated */}
            {compTotals.actualJudgeCost > 0 && (
              <div className="flex items-center gap-2 text-xs font-mono border border-border/30 rounded-md p-2">
                <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0" />
                <span className="text-muted-foreground">Actual judge cost from logs:</span>
                <span className="font-bold text-blue-500">{fmt(compTotals.actualJudgeCost)}</span>
                <span className="text-muted-foreground">vs simulated ({MODEL_COSTS[selectedJudgeModel]?.label}):</span>
                <span className="font-bold text-blue-400">{fmt(compTotals.totalJudgeCost)}</span>
              </div>
            )}

            {/* Overhead allocation */}
            <div className="flex items-center gap-4 text-xs font-mono border-t border-border/30 pt-3">
              <span className="text-muted-foreground">Overhead share (if 1-month comp):</span>
              <span className="font-bold text-amber-500">{fmt(monthlyOverhead)}</span>
              <span className="text-muted-foreground">Net after overhead:</span>
              <span className={`font-bold ${compTotals.netMargin - monthlyOverhead >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                {fmt(compTotals.netMargin - monthlyOverhead)}
              </span>
            </div>

            {/* All Models comparison for judging */}
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors group">
                <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
                Compare All Models (Vertical entry judging)
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="font-mono text-xs">Model</TableHead>
                      <TableHead className="font-mono text-xs">Tier</TableHead>
                      <TableHead className="font-mono text-xs text-right">Revenue</TableHead>
                      <TableHead className="font-mono text-xs text-right">Judge Cost</TableHead>
                      <TableHead className="font-mono text-xs text-right">Margin</TableHead>
                      <TableHead className="font-mono text-xs text-right">Margin %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allModelsComp.map(row => (
                      <TableRow key={row.modelId} className={row.modelId === selectedJudgeModel ? "bg-muted/30" : ""}>
                        <TableCell className="font-mono text-xs">{row.label}</TableCell>
                        <TableCell className="font-mono text-xs">
                          <Badge variant="outline" className="text-[10px] font-mono">{row.tier}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-right text-emerald-500">{fmt(row.revenue)}</TableCell>
                        <TableCell className="font-mono text-xs text-right text-blue-500">{fmt(row.judgeCost)}</TableCell>
                        <TableCell className={`font-mono text-xs text-right ${row.margin >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmt(row.margin)}</TableCell>
                        <TableCell className={`font-mono text-xs text-right ${row.marginPct >= 0 ? "text-emerald-500" : "text-destructive"}`}>{pct(row.marginPct)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
      )}

      {/* ═══════ Lovable Plan Advisor ═══════ */}
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
        </CardContent>
      </Card>
    </div>
  );
}
