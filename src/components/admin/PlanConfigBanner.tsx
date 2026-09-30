import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePlatform } from "@/contexts/PlatformContext";
import { FEATURES } from "@/components/admin/FeatureMapPanel";
import { PlanTier } from "@/lib/plans";
import { X, ChevronDown, ChevronRight, Save, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface PlanRow {
  tier: string;
  name: string;
  price_cents_monthly: number;
  price_label: string;
  monthly_tokens: number;
  discount_percent: number;
  support: string;
}

type FeatureStatus = "live" | "partial" | "planned" | "off";

const STATUS_BADGE: Record<FeatureStatus, { label: string; className: string }> = {
  live: { label: "Live", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  partial: { label: "Partial", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  planned: { label: "Planned", className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  off: { label: "Off", className: "bg-muted text-muted-foreground border-border" },
};

const TIER_ORDER: PlanTier[] = ["free", "pro", "studio"];

// Build a lookup from feature configId → FeatureMapPanel status
const featureStatusMap = new Map<string, FeatureStatus>();
FEATURES.forEach((f) => {
  if (f.configId) featureStatusMap.set(f.configId, f.status);
});
// Also map by id for features without configId
FEATURES.forEach((f) => {
  if (!featureStatusMap.has(f.id)) featureStatusMap.set(f.id, f.status);
});

export default function PlanConfigBanner({ onClose }: { onClose: () => void }) {
  const { flags, setFeatureTier } = usePlatform();
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [editing, setEditing] = useState<Record<string, Partial<PlanRow>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [featureOpen, setFeatureOpen] = useState(false);

  const loadPlans = useCallback(async () => {
    const { data } = await supabase.from("plan_configs").select("*");
    if (data) setPlans(data as PlanRow[]);
  }, []);

  useEffect(() => { loadPlans(); }, [loadPlans]);

  function getEdited(tier: string): PlanRow {
    const base = plans.find((p) => p.tier === tier) || { tier, name: tier, price_cents_monthly: 0, price_label: "$0", monthly_tokens: 0, discount_percent: 0, support: "Community" };
    return { ...base, ...(editing[tier] || {}) };
  }

  function updateField(tier: string, field: keyof PlanRow, value: any) {
    setEditing((prev) => ({ ...prev, [tier]: { ...(prev[tier] || {}), [field]: value } }));
  }

  async function saveTier(tier: string) {
    const row = getEdited(tier);
    setSaving(tier);
    const { error } = await supabase.from("plan_configs").upsert({
      tier: row.tier,
      name: row.name,
      price_cents_monthly: row.price_cents_monthly,
      price_label: row.price_label,
      monthly_tokens: row.monthly_tokens,
      discount_percent: row.discount_percent,
      support: row.support,
      updated_at: new Date().toISOString(),
    } as any);
    setSaving(null);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Plan saved", description: `${row.name} tier updated` });
      setEditing((prev) => { const n = { ...prev }; delete n[tier]; return n; });
      loadPlans();
    }
  }

  // Feature checklist: map feature tier to plan tier
  function featureTierToPlan(tier: string): PlanTier | null {
    if (tier === "free") return "free";
    if (tier === "pro" || tier === "basic" || tier === "film_festival") return "pro";
    if (tier === "studio") return "studio";
    return null;
  }

  async function handleTierCheck(featureId: string, planTier: PlanTier) {
    // Map plan tier to feature_configs tier value
    const tierValue = planTier === "free" ? "free" : planTier === "pro" ? "pro" : "studio";
    await setFeatureTier(featureId, tierValue);
    toast({ title: "Feature tier updated", description: `${featureId} → ${planTier}` });
  }

  const featureList = Object.entries(flags).sort(([a], [b]) => a.localeCompare(b));

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="p-6 rounded-xl border border-primary/20 bg-card/90 relative"
    >
      <button onClick={onClose} className="absolute top-3 right-3 p-1 rounded-md hover:bg-muted transition-colors">
        <X className="h-4 w-4 text-muted-foreground" />
      </button>

      <div className="flex items-center gap-2 mb-5">
        <Settings2 className="h-5 w-5 text-primary" />
        <h3 className="font-display text-lg font-bold">Plan Configuration</h3>
        <Badge variant="secondary" className="ml-2 text-[10px]">Admin Only</Badge>
      </div>

      {/* Tier Editor Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {TIER_ORDER.map((tier) => {
          const row = getEdited(tier);
          const hasEdits = !!editing[tier] && Object.keys(editing[tier]!).length > 0;
          return (
            <div key={tier} className="p-4 rounded-lg border border-border/30 bg-background/50 space-y-3">
              <div className="flex items-center justify-between">
                <Badge variant="secondary" className={tier === "pro" ? "bg-primary/10 text-primary" : tier === "studio" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}>
                  {row.name}
                </Badge>
                {hasEdits && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => saveTier(tier)} disabled={saving === tier}>
                    <Save className="h-3 w-3" /> {saving === tier ? "…" : "Save"}
                  </Button>
                )}
              </div>

              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Price (cents/mo)</label>
                <Input
                  type="number"
                  value={row.price_cents_monthly}
                  onChange={(e) => {
                    const cents = parseInt(e.target.value) || 0;
                    updateField(tier, "price_cents_monthly", cents);
                    updateField(tier, "price_label", cents === 0 ? (tier === "studio" ? "Custom" : "$0") : `$${(cents / 100).toFixed(0)}`);
                  }}
                  className="h-8 text-sm font-mono mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Price Label</label>
                <Input value={row.price_label} onChange={(e) => updateField(tier, "price_label", e.target.value)} className="h-8 text-sm mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Tokens/mo</label>
                  <Input type="number" value={row.monthly_tokens} onChange={(e) => updateField(tier, "monthly_tokens", parseInt(e.target.value) || 0)} className="h-8 text-sm font-mono mt-1" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Discount %</label>
                  <Input type="number" value={row.discount_percent} onChange={(e) => updateField(tier, "discount_percent", parseInt(e.target.value) || 0)} className="h-8 text-sm font-mono mt-1" />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Support</label>
                <Input value={row.support} onChange={(e) => updateField(tier, "support", e.target.value)} className="h-8 text-sm mt-1" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Feature Access Checklist */}
      <Collapsible open={featureOpen} onOpenChange={setFeatureOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors">
          {featureOpen ? <ChevronDown className="h-4 w-4 text-primary" /> : <ChevronRight className="h-4 w-4 text-primary" />}
          <span className="font-body text-sm font-semibold">Feature Access Checklist</span>
          <Badge variant="outline" className="ml-2 text-[10px]">{featureList.length} features</Badge>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-3 rounded-lg border border-border/30 overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[1fr_80px_60px_60px_60px] gap-2 px-4 py-2 bg-muted/30 border-b border-border/20 text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
              <span>Feature</span>
              <span className="text-center">Status</span>
              <span className="text-center">Free</span>
              <span className="text-center">Pro</span>
              <span className="text-center">Studio</span>
            </div>
            {/* Rows */}
            <div className="max-h-[400px] overflow-y-auto divide-y divide-border/10">
              {featureList.map(([id, config]) => {
                const currentPlanTier = featureTierToPlan(config.tier);
                const status = featureStatusMap.get(id) || (config.enabled ? "live" : "off");
                const badge = STATUS_BADGE[status as FeatureStatus] || STATUS_BADGE.off;
                const isToken = config.tier === "token";

                return (
                  <div key={id} className="grid grid-cols-[1fr_80px_60px_60px_60px] gap-2 px-4 py-2 items-center hover:bg-muted/20 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-mono truncate">{id}</span>
                      {isToken && <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">token</Badge>}
                    </div>
                    <div className="flex justify-center">
                      <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${badge.className}`}>{badge.label}</Badge>
                    </div>
                    {TIER_ORDER.map((t) => (
                      <div key={t} className="flex justify-center">
                        <Checkbox
                          checked={currentPlanTier === t}
                          onCheckedChange={() => handleTierCheck(id, t)}
                          className="h-3.5 w-3.5"
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </motion.div>
  );
}
