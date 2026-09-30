import { usePlatform, type FeatureTier } from "@/contexts/PlatformContext";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MODEL_TIER_LABELS } from "@/lib/wallet";

const TIERS: FeatureTier[] = ["free", "basic", "pro", "token", "disabled"];

const LOVABLE_MODELS = [
  { id: "__default__", label: "Default" },
  { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash" },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Lite" },
  { id: "openai/gpt-5", label: "GPT-5" },
  { id: "openai/gpt-5-mini", label: "GPT-5 Mini" },
  { id: "openai/gpt-5-nano", label: "GPT-5 Nano" },
  { id: "openai/gpt-5.2", label: "GPT-5.2" },
];

const ACTION_CATEGORIES: Record<string, string> = {
  ai_score: "AI Tools",
  ai_review: "AI Tools",
  beat_board: "AI Tools",
  writing_stats: "Analysis",
  send_review: "AI Tools",
  script_compare_2: "Analysis",
  script_compare_3: "Analysis",
  scene_analysis: "Analysis",
  deep_voice: "Analysis",
  dialogue_generation: "AI Tools",
  zeitgeist: "Analysis",
  deep_analysis: "Analysis",
  ai_rewrite: "AI Tools",
  filmstack_seed: "AI Tools",
  resubmit: "Entry Costs",
  logline_generate: "AI Tools",
  entry_vertical: "Entry Costs",
  entry_micro: "Entry Costs",
  entry_short: "Entry Costs",
  entry_pilot_30: "Entry Costs",
  entry_pilot_60: "Entry Costs",
  entry_feature: "Entry Costs",
  ip_risk_assessment: "Analysis",
};

const CATEGORY_ORDER = ["AI Tools", "Analysis", "Entry Costs"];

interface SurchargeRow {
  tier: string;
  multiplier: number;
  flat_surcharge: number;
  enabled: boolean;
}

function ModelSurchargesEditor() {
  const [surcharges, setSurcharges] = useState<Record<string, { multiplier: number; flat_surcharge: number; enabled: boolean }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("model_surcharges").select("tier, multiplier, flat_surcharge, enabled");
      if (data) {
        const map: Record<string, { multiplier: number; flat_surcharge: number; enabled: boolean }> = {};
        data.forEach((r: any) => { map[r.tier] = r; });
        setSurcharges(map);
      }
      setLoading(false);
    })();
  }, []);

  const handleUpdate = useCallback(async (tier: string, field: string, value: number | boolean) => {
    setSurcharges(prev => ({
      ...prev,
      [tier]: { ...prev[tier], [field]: value },
    }));
    await supabase.from("model_surcharges").update({ [field]: value }).eq("tier", tier);
    toast.success(`${tier} ${field} → ${value}`);
  }, []);

  const tiers = Object.keys(MODEL_TIER_LABELS);

  return (
    <div>
      <h4 className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-2 mt-4">Model Tier Surcharges</h4>
      <div className="rounded-xl border border-border/50 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-muted/20">
              <th className="text-left py-2 px-3 font-mono text-xs text-muted-foreground">Tier</th>
              <th className="text-left py-2 px-3 font-mono text-xs text-muted-foreground">Enabled</th>
              <th className="text-left py-2 px-3 font-mono text-xs text-muted-foreground">Multiplier</th>
              <th className="text-left py-2 px-3 font-mono text-xs text-muted-foreground">Rationale</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map(tier => {
              const s = surcharges[tier] || { multiplier: 1.0, flat_surcharge: 0, enabled: true };
              const rationale = tier === "premium" ? "~8× API cost, compressed to 3×"
                : tier === "super_premium" ? "~26× API cost, compressed to 5×"
                : "At or below standard baseline";
              return (
                <tr key={tier} className="border-b border-border/20 hover:bg-muted/10">
                  <td className="py-2 px-3 font-body">{MODEL_TIER_LABELS[tier]}</td>
                  <td className="py-2 px-3">
                    <Switch checked={s.enabled} onCheckedChange={(v) => handleUpdate(tier, "enabled", v)} />
                  </td>
                  <td className="py-2 px-3">
                    <Input
                      type="number"
                      className="w-20 h-8 text-xs"
                      value={s.multiplier}
                      min={0.1}
                      step={0.1}
                      onChange={(e) => handleUpdate(tier, "multiplier", parseFloat(e.target.value) || 1)}
                    />
                  </td>
                  <td className="py-2 px-3 text-xs text-muted-foreground italic">{rationale}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[9px] text-muted-foreground mt-1">
        Surcharges are proportional to API cost differentials. Standard tier = 1.0× baseline. Changes save immediately.
      </p>
    </div>
  );
}

export default function SwitchboardPanel() {
  const { flags, toggleFlag, setFeatureTier, setFeatureTokenCost, setFeatureUsagePolicy, setFeatureSubscriptionConfig, setFeatureModelHint } = usePlatform();

  const allFlags = Object.values(flags);

  // Group by category
  const grouped: Record<string, typeof allFlags> = {};
  for (const f of allFlags) {
    const cat = ACTION_CATEGORIES[f.id] || "Platform";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(f);
  }

  const sortedCategories = [...new Set([...CATEGORY_ORDER, ...Object.keys(grouped)])];

  return (
    <div className="space-y-6">
      <h3 className="font-display text-lg font-semibold">Feature Switchboard</h3>
      <p className="text-sm text-muted-foreground">Configure feature flags, tiers, token costs, and policies. Changes propagate in real time.</p>

      <ModelSurchargesEditor />

      {sortedCategories.filter((cat) => grouped[cat]?.length).map((category) => (
        <div key={category}>
          <h4 className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-2 mt-4">{category}</h4>
          <div className="rounded-xl border border-border/50 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/20">
                  <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Feature</th>
                  <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Enabled</th>
                  <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Tier</th>
                   <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Token Cost</th>
                  <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Model</th>
                  <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Sub</th>
                  <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Weekly</th>
                  <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Monthly</th>
                  <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Yearly</th>
                  <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Max Uses</th>
                  <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Window</th>
                </tr>
              </thead>
              <tbody>
                {grouped[category].map((f) => (
                  <tr key={f.id} className="border-b border-border/20 hover:bg-muted/10">
                    <td className="py-3 px-4 font-body">{f.id}</td>
                    <td className="py-3 px-4">
                      <Switch checked={f.enabled} onCheckedChange={() => toggleFlag(f.id)} />
                    </td>
                    <td className="py-3 px-4">
                      <Select
                        value={f.tier}
                        onValueChange={(val) => {
                          setFeatureTier(f.id, val as FeatureTier);
                          toast.success(`${f.id} tier → ${val}`);
                        }}
                      >
                        <SelectTrigger className="w-28 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TIERS.map((t) => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-3 px-4">
                      <Input
                        type="number"
                        className="w-20 h-8 text-xs"
                        value={f.token_cost}
                        min={0}
                        onChange={(e) => setFeatureTokenCost(f.id, parseInt(e.target.value) || 0)}
                      />
                     </td>
                    <td className="py-3 px-4">
                      <Select
                        value={f.model_hint || "__default__"}
                        onValueChange={(val) => {
                          const model = val === "__default__" ? null : val;
                          setFeatureModelHint(f.id, model);
                          toast.success(`${f.id} model → ${model || "default"}`);
                        }}
                      >
                        <SelectTrigger className="w-36 h-8 text-xs">
                          <SelectValue placeholder="Default" />
                        </SelectTrigger>
                        <SelectContent>
                          {LOVABLE_MODELS.map((m) => (
                            <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-3 px-4">
                      <Checkbox
                        checked={f.subscribable ?? false}
                        onCheckedChange={(checked) => setFeatureSubscriptionConfig(f.id, { subscribable: !!checked })}
                      />
                    </td>
                    <td className="py-3 px-4">
                      <Input
                        type="number"
                        className="w-16 h-8 text-xs"
                        value={f.weekly_cost ?? 0}
                        min={0}
                        onChange={(e) => setFeatureSubscriptionConfig(f.id, { weekly_cost: parseInt(e.target.value) || 0 })}
                      />
                    </td>
                    <td className="py-3 px-4">
                      <Input
                        type="number"
                        className="w-16 h-8 text-xs"
                        value={f.monthly_cost ?? 0}
                        min={0}
                        onChange={(e) => setFeatureSubscriptionConfig(f.id, { monthly_cost: parseInt(e.target.value) || 0 })}
                      />
                    </td>
                    <td className="py-3 px-4">
                      <Input
                        type="number"
                        className="w-16 h-8 text-xs"
                        value={f.yearly_cost ?? 0}
                        min={0}
                        onChange={(e) => setFeatureSubscriptionConfig(f.id, { yearly_cost: parseInt(e.target.value) || 0 })}
                      />
                    </td>
                    <td className="py-3 px-4">
                      <Input
                        type="number"
                        className="w-16 h-8 text-xs"
                        value={f.usage_policy.max_uses ?? ""}
                        placeholder="∞"
                        min={0}
                        onChange={(e) => {
                          const val = e.target.value ? parseInt(e.target.value) : undefined;
                          setFeatureUsagePolicy(f.id, { ...f.usage_policy, max_uses: val });
                        }}
                      />
                    </td>
                    <td className="py-3 px-4">
                      <Input
                        type="number"
                        className="w-16 h-8 text-xs"
                        value={f.usage_policy.time_window_hours ?? ""}
                        placeholder="∞"
                        min={0}
                        onChange={(e) => {
                          const val = e.target.value ? parseInt(e.target.value) : undefined;
                          setFeatureUsagePolicy(f.id, { ...f.usage_policy, time_window_hours: val });
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
