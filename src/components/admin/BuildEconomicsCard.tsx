import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getAvgTokenPrice, LOVABLE_CREDIT_DEFAULT_COST, LOVABLE_CREDIT_PREPAID_COST } from "@/lib/wallet";
import { DollarSign, TrendingUp, Coins, Edit2, Check, Cpu, PiggyBank } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

const DEFAULT_AI_COST_PER_TOKEN = 0.01;

function MetricRow({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/20 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="text-right">
        <span className={`font-mono text-sm font-bold ${accent ? "text-primary" : ""}`}>{value}</span>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

export default function BuildEconomicsCard() {
  const [loading, setLoading] = useState(true);
  const [creditsOnDemand, setCreditsOnDemand] = useState(0);
  const [creditsPrepaid, setCreditsPrepaid] = useState(0);
  const [costPerCredit, setCostPerCredit] = useState(LOVABLE_CREDIT_DEFAULT_COST);
  const [costPerCreditPrepaid, setCostPerCreditPrepaid] = useState(LOVABLE_CREDIT_PREPAID_COST);
  const [aiCostPerToken, setAiCostPerToken] = useState(DEFAULT_AI_COST_PER_TOKEN);
  const [editing, setEditing] = useState(false);
  const [editCreditsOnDemand, setEditCreditsOnDemand] = useState("");
  const [editCreditsPrepaid, setEditCreditsPrepaid] = useState("");
  const [editCost, setEditCost] = useState("");
  const [editCostPrepaid, setEditCostPrepaid] = useState("");
  const [editAiCost, setEditAiCost] = useState("");

  const [totalRevenueCents, setTotalRevenueCents] = useState(0);
  const [totalTokensSpent, setTotalTokensSpent] = useState(0);
  const [totalTokensSold, setTotalTokensSold] = useState(0);

  const avgTokenPrice = getAvgTokenPrice();

  const fetchData = useCallback(async () => {
    const [settingsRes, purchasesRes, txnRes] = await Promise.all([
      supabase.from("site_settings" as any).select("key, text_value").in("key", [
        "lovable_credits_used", "lovable_cost_per_credit", "ai_cost_per_token",
        "lovable_cost_per_credit_prepaid", "lovable_credits_prepaid",
      ]),
      supabase.from("purchases").select("price_cents, token_amount").eq("status", "completed"),
      supabase.from("wallet_transactions").select("amount").lt("amount", 0),
    ]);

    const settings = (settingsRes.data as any[]) || [];
    const get = (key: string) => settings.find((s: any) => s.key === key)?.text_value;

    if (get("lovable_credits_used")) setCreditsOnDemand(Number(get("lovable_credits_used")) || 0);
    if (get("lovable_cost_per_credit")) setCostPerCredit(Number(get("lovable_cost_per_credit")) || LOVABLE_CREDIT_DEFAULT_COST);
    if (get("ai_cost_per_token")) setAiCostPerToken(Number(get("ai_cost_per_token")) || DEFAULT_AI_COST_PER_TOKEN);
    if (get("lovable_cost_per_credit_prepaid")) setCostPerCreditPrepaid(Number(get("lovable_cost_per_credit_prepaid")) || LOVABLE_CREDIT_PREPAID_COST);
    if (get("lovable_credits_prepaid")) setCreditsPrepaid(Number(get("lovable_credits_prepaid")) || 0);

    const purchases = purchasesRes.data || [];
    setTotalRevenueCents(purchases.reduce((s, p) => s + (p.price_cents || 0), 0));
    setTotalTokensSold(purchases.reduce((s, p) => s + (p.token_amount || 0), 0));

    const txns = txnRes.data || [];
    setTotalTokensSpent(txns.reduce((s, t) => s + Math.abs(t.amount), 0));

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();

    const channel = supabase
      .channel("build-economics-live")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "wallet_transactions" }, () => fetchData())
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "purchases" }, () => fetchData())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchData]);

  const startEdit = () => {
    setEditCreditsOnDemand(String(creditsOnDemand));
    setEditCreditsPrepaid(String(creditsPrepaid));
    setEditCost(String(costPerCredit));
    setEditCostPrepaid(String(costPerCreditPrepaid));
    setEditAiCost(String(aiCostPerToken));
    setEditing(true);
  };

  const saveEdit = async () => {
    const newCreditsOD = Number(editCreditsOnDemand) || 0;
    const newCreditsPP = Number(editCreditsPrepaid) || 0;
    const newCost = Number(editCost) || LOVABLE_CREDIT_DEFAULT_COST;
    const newCostPP = Number(editCostPrepaid) || LOVABLE_CREDIT_PREPAID_COST;
    const newAiCost = Number(editAiCost) || DEFAULT_AI_COST_PER_TOKEN;

    await Promise.all([
      supabase.from("site_settings" as any).upsert({ key: "lovable_credits_used", value: false, text_value: String(newCreditsOD) }, { onConflict: "key" }),
      supabase.from("site_settings" as any).upsert({ key: "lovable_credits_prepaid", value: false, text_value: String(newCreditsPP) }, { onConflict: "key" }),
      supabase.from("site_settings" as any).upsert({ key: "lovable_cost_per_credit", value: false, text_value: String(newCost) }, { onConflict: "key" }),
      supabase.from("site_settings" as any).upsert({ key: "lovable_cost_per_credit_prepaid", value: false, text_value: String(newCostPP) }, { onConflict: "key" }),
      supabase.from("site_settings" as any).upsert({ key: "ai_cost_per_token", value: false, text_value: String(newAiCost) }, { onConflict: "key" }),
    ]);

    setCreditsOnDemand(newCreditsOD);
    setCreditsPrepaid(newCreditsPP);
    setCostPerCredit(newCost);
    setCostPerCreditPrepaid(newCostPP);
    setAiCostPerToken(newAiCost);
    setEditing(false);
    toast.success("Build economics updated");
  };

  const totalCredits = creditsOnDemand + creditsPrepaid;
  const onDemandCost = creditsOnDemand * costPerCredit;
  const prepaidCost = creditsPrepaid * costPerCreditPrepaid;
  const buildCost = onDemandCost + prepaidCost;
  const allOnDemandCost = totalCredits * costPerCredit;
  const savings = allOnDemandCost - buildCost;
  const blendedRate = totalCredits > 0 ? buildCost / totalCredits : costPerCredit;

  const platformRevenue = totalRevenueCents / 100;
  const platformTokenValue = totalTokensSpent * avgTokenPrice;
  const estimatedAiCost = totalTokensSpent * aiCostPerToken;
  const roi = buildCost > 0 ? platformRevenue / buildCost : 0;

  if (loading) {
    return (
      <div className="p-6 rounded-xl border border-border/50 bg-card/80 col-span-full">
        <Skeleton className="h-6 w-48 mb-4" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 rounded-xl border border-border/50 bg-card/80 col-span-full">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-primary" />
          <h4 className="font-body text-sm font-semibold">Build Economics</h4>
          <span className="text-[10px] font-mono text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded">● LIVE</span>
        </div>
        {!editing ? (
          <Button variant="ghost" size="sm" onClick={startEdit}>
            <Edit2 className="h-3.5 w-3.5 mr-1" /> Edit Costs
          </Button>
        ) : (
          <Button size="sm" onClick={saveEdit}>
            <Check className="h-3.5 w-3.5 mr-1" /> Save
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Lovable Build Costs */}
        <div className="space-y-1">
          <h5 className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Coins className="h-3.5 w-3.5" /> Lovable Build Costs
          </h5>
          {editing ? (
            <div className="space-y-3 py-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Credits (On-Demand)</label>
                <Input type="number" value={editCreditsOnDemand} onChange={(e) => setEditCreditsOnDemand(e.target.value)} className="h-8 text-sm font-mono" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">On-Demand Cost per Credit ($)</label>
                <Input type="number" step="0.01" value={editCost} onChange={(e) => setEditCost(e.target.value)} className="h-8 text-sm font-mono" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Credits (Prepaid)</label>
                <Input type="number" value={editCreditsPrepaid} onChange={(e) => setEditCreditsPrepaid(e.target.value)} className="h-8 text-sm font-mono" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Prepaid Cost per Credit ($)</label>
                <Input type="number" step="0.01" value={editCostPrepaid} onChange={(e) => setEditCostPrepaid(e.target.value)} className="h-8 text-sm font-mono" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">AI Cost per Token ($)</label>
                <Input type="number" step="0.001" value={editAiCost} onChange={(e) => setEditAiCost(e.target.value)} className="h-8 text-sm font-mono" />
              </div>
            </div>
          ) : (
            <>
              <MetricRow label="On-Demand Credits" value={creditsOnDemand.toLocaleString()} sub={`@ $${costPerCredit.toFixed(2)}/credit`} />
              <MetricRow label="Prepaid Credits" value={creditsPrepaid.toLocaleString()} sub={`@ $${costPerCreditPrepaid.toFixed(2)}/credit (20% off)`} />
              <MetricRow label="Blended Rate" value={`$${blendedRate.toFixed(4)}`} sub={`across ${totalCredits.toLocaleString()} total credits`} />
              <MetricRow label="Total Build Cost" value={`$${buildCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} accent />
            </>
          )}
        </div>

        {/* Right: Platform Token Economy */}
        <div className="space-y-1">
          <h5 className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" /> Platform Token Economy
          </h5>
          <MetricRow label="Tokens Sold" value={totalTokensSold.toLocaleString()} sub={`$${platformRevenue.toFixed(2)} revenue`} />
          <MetricRow label="Tokens Spent by Users" value={totalTokensSpent.toLocaleString()} sub={`~$${platformTokenValue.toFixed(2)} value`} />
          <MetricRow label="Avg Token Price" value={`$${avgTokenPrice.toFixed(4)}`} sub="weighted from bundles" />
          <MetricRow
            label="Est. AI Cost"
            value={`$${estimatedAiCost.toFixed(2)}`}
            sub={`@ $${aiCostPerToken}/token`}
            accent
          />
        </div>
      </div>

      {/* Bottom comparison */}
      <div className="mt-5 pt-4 border-t border-border/30 grid grid-cols-2 md:grid-cols-6 gap-4">
        <div className="text-center">
          <p className="text-[10px] font-mono text-muted-foreground uppercase">Build Cost</p>
          <p className="font-mono text-lg font-bold text-primary">${buildCost.toFixed(2)}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] font-mono text-muted-foreground uppercase">Token Revenue</p>
          <p className="font-mono text-lg font-bold">${platformRevenue.toFixed(2)}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] font-mono text-muted-foreground uppercase flex items-center justify-center gap-1"><Cpu className="h-3 w-3" /> Est. AI Cost</p>
          <p className="font-mono text-lg font-bold text-destructive">${estimatedAiCost.toFixed(2)}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] font-mono text-muted-foreground uppercase">ROI</p>
          <p className={`font-mono text-lg font-bold ${roi >= 1 ? "text-green-500" : "text-destructive"}`}>
            {roi > 0 ? `${roi.toFixed(2)}x` : "—"}
          </p>
        </div>
        <div className="text-center">
          <p className="text-[10px] font-mono text-muted-foreground uppercase flex items-center justify-center gap-1"><PiggyBank className="h-3 w-3" /> Prepaid Savings</p>
          <p className="font-mono text-lg font-bold text-green-500">
            {savings > 0 ? `$${savings.toFixed(2)}` : "—"}
          </p>
          {savings > 0 && <p className="text-[10px] text-muted-foreground">vs all on-demand</p>}
        </div>
        <div className="text-center">
          <p className="text-[10px] font-mono text-muted-foreground uppercase">Token Equivalency</p>
          <p className="font-mono text-lg font-bold">
            {buildCost > 0 && avgTokenPrice > 0 ? Math.round(buildCost / avgTokenPrice).toLocaleString() : "—"}
          </p>
          <p className="text-[10px] text-muted-foreground">platform tokens</p>
        </div>
      </div>
    </div>
  );
}
