import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { DollarSign, Trophy, Cpu, TrendingUp, Receipt, Wallet, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

import PricingManagementPanel from "@/components/admin/PricingManagementPanel";
import TokenEconomyPanel from "@/components/TokenEconomyPanel";
import CompetitionEconomicsPanel from "@/components/admin/CompetitionEconomicsPanel";
import EventEconomicsPanel from "@/components/admin/EventEconomicsPanel";
import ModelCostSimulatorPanel from "@/components/admin/ModelCostSimulatorPanel";
import CostMonitorPanel from "@/components/admin/CostMonitorPanel";
import ProfitMarginsPanel from "@/components/admin/ProfitMarginsPanel";
import ProFormaBudgetSection from "@/components/admin/ProFormaBudgetSection";
import OperationalOverheadPanel from "@/components/admin/OperationalOverheadPanel";
import BuildEconomicsCard from "@/components/admin/BuildEconomicsCard";
import EconomicsLivePreview from "@/components/admin/EconomicsLivePreview";
import EconomicsAuditLogPanel from "@/components/admin/EconomicsAuditLogPanel";


type CompetitionRow = { id: string; name: string | null; status: string | null };


/**
 * Unified operator console for every pricing, fee, and cost-of-goods surface in the
 * platform. Wraps existing source-of-truth panels (feature_configs, plan_configs,
 * competition_economics, ai_models, proforma_*) so operators don't have to bounce
 * between tabs to set token prices, entry fees, competition fee rules, AI surcharges,
 * margins, and runway.
 */
export default function AdminEconomicsPanel() {
  const [comps, setComps] = useState<CompetitionRow[]>([]);
  const [selectedComp, setSelectedComp] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("competitions")
        .select("id, name, status")
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      const rows = (data ?? []) as CompetitionRow[];
      setComps(rows);
      if (rows.length) setSelectedComp((cur) => cur ?? rows[0].id);
    })();
    return () => { cancelled = true; };
  }, []);

  const selected = comps.find((c) => c.id === selectedComp) ?? null;

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-primary" />
          Admin Economics
        </CardTitle>
        <CardDescription>
          Single console for token pricing, entry fees, competition fee rules,
          AI cost-of-goods, profit margins, and runway. All edits write through
          to <code>feature_configs</code>, <code>plan_configs</code>, and
          <code>competition_economics</code> — the strict sources of truth.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Global competition scope — every per-competition panel below binds to this */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 rounded-md border border-border/40 bg-muted/10 p-3">
          <div className="flex-1 space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Competition scope
            </Label>
            <Select value={selectedComp ?? undefined} onValueChange={(v) => setSelectedComp(v)}>
              <SelectTrigger className="max-w-md">
                <SelectValue placeholder="Select a competition" />
              </SelectTrigger>
              <SelectContent>
                {comps.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name ?? c.id.slice(0, 8)} {c.status ? `· ${c.status}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selected && (
            <p className="text-[10px] font-mono text-muted-foreground">
              status: <span className="text-foreground">{selected.status ?? "draft"}</span> —
              pricing, entry fees, and fee rules load & save against this competition.
            </p>
          )}
        </div>

        <EconomicsLivePreview competitionId={selectedComp} competitionName={selected?.name ?? null} />
        <Tabs defaultValue="pricing" className="w-full">

          <TabsList className="mb-6 bg-muted/30 border border-border/50 overflow-x-auto scrollbar-none justify-start w-full flex-nowrap sm:flex-wrap">
            <TabsTrigger value="pricing" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0">
              <DollarSign className="h-3 w-3 mr-1" />Token Pricing
            </TabsTrigger>
            <TabsTrigger value="entry-fees" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0">
              <Receipt className="h-3 w-3 mr-1" />Entry Fees
            </TabsTrigger>
            <TabsTrigger value="competition-fees" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0">
              <Trophy className="h-3 w-3 mr-1" />Competition Fees
            </TabsTrigger>
            <TabsTrigger value="ai-costs" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0">
              <Cpu className="h-3 w-3 mr-1" />AI Cost of Goods
            </TabsTrigger>
            <TabsTrigger value="margins" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0">
              <TrendingUp className="h-3 w-3 mr-1" />Margins & Runway
            </TabsTrigger>
            <TabsTrigger value="ops" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0">
              <Wallet className="h-3 w-3 mr-1" />Operational
            </TabsTrigger>
            <TabsTrigger value="audit" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0">
              <History className="h-3 w-3 mr-1" />Audit Log
            </TabsTrigger>
          </TabsList>

          {/* Token Pricing — feature_configs source-of-truth (global, not per-competition) */}
          <TabsContent value="pricing" className="space-y-6">
            <div className="rounded-md border border-border/40 bg-muted/10 p-3 text-xs text-muted-foreground">
              Flat <strong>$0.10 / token</strong>. Token costs per feature live in
              <code className="mx-1">feature_configs</code> and are enforced
              server-side by <code>spend-tokens</code>. Pricing is platform-wide;
              per-competition surcharges live under Entry Fees.
            </div>
            <PricingManagementPanel />
            <TokenEconomyPanel />
          </TabsContent>

          {/* Entry / submission fees — scoped to selected competition */}
          <TabsContent value="entry-fees" className="space-y-6">
            <div className="rounded-md border border-border/40 bg-muted/10 p-3 text-xs text-muted-foreground">
              Entry fees are scaled by page bucket (Vertical, Micro, Short, Pilot
              30/60, Feature). Overrides live in
              <code className="mx-1">competition_economics</code> and lock automatically
              once the competition opens.
            </div>
            {selected ? (
              <CompetitionEconomicsPanel
                key={`fees-${selected.id}`}
                competitionId={selected.id}
                competitionStatus={selected.status ?? "draft"}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No competitions found.</p>
            )}
          </TabsContent>

          {/* Competition fee rules + per-event prize pool economics */}
          <TabsContent value="competition-fees" className="space-y-6">
            <div className="rounded-md border border-border/40 bg-muted/10 p-3 text-xs text-muted-foreground">
              Per-event prize pool, partner splits, sponsorship offsets, and fee-rule
              overrides (AI-only, Human-only, Hybrid) for the selected competition.
              Saves to <code className="mx-1">competition_economics.entry_fees</code>.
            </div>
            {selected ? (
              <CompetitionEconomicsPanel
                key={`rules-${selected.id}`}
                competitionId={selected.id}
                competitionStatus={selected.status ?? "draft"}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Select a competition to edit fee rules.</p>
            )}
            <EventEconomicsPanel />
          </TabsContent>


          {/* AI cost-of-goods: model surcharges + cost monitor + simulator */}
          <TabsContent value="ai-costs" className="space-y-6">
            <div className="rounded-md border border-border/40 bg-muted/10 p-3 text-xs text-muted-foreground">
              Model surcharges, observed cost per action, and forward simulation.
              Premium models add surcharges on top of the flat token price.
            </div>
            <CostMonitorPanel />
            <ModelCostSimulatorPanel />
          </TabsContent>

          {/* Margins, build economics, runway */}
          <TabsContent value="margins" className="space-y-6">
            <BuildEconomicsCard />
            <ProfitMarginsPanel />
            <ProFormaBudgetSection />
          </TabsContent>

          {/* Operational overhead — fixed costs, infra, payroll lines */}
          <TabsContent value="ops" className="space-y-6">
            <OperationalOverheadPanel />
          </TabsContent>

          {/* Immutable audit trail — every save into feature_configs / competition_economics / site_settings */}
          <TabsContent value="audit" className="space-y-6">
            <EconomicsAuditLogPanel />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
