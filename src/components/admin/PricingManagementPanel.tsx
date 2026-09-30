import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from "@/components/ui/tooltip";
import {
  TOKEN_COSTS, TOKEN_ACTION_METADATA, MODEL_COSTS,
  DEFAULT_SURCHARGES, MODEL_TIER_LABELS, TokenAction,
  TOKEN_ACTION_LABELS, getAvgTokenPrice,
} from "@/lib/wallet";
import {
  Save, RotateCcw, AlertTriangle, HelpCircle, CheckCircle2,
  TrendingDown, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { logEconomicsChange } from "@/lib/adminEconomicsAudit";

const MODEL_IDS = Object.keys(MODEL_COSTS);
const AVG_TOKEN_PRICE = getAvgTokenPrice(); // dollars per token

/* Estimate API cost for a feature at a given model */
function estimateApiCost(modelId: string, inputTokens = 1000, outputTokens = 1000) {
  const mc = MODEL_COSTS[modelId];
  return (inputTokens / 1000) * mc.input + (outputTokens / 1000) * mc.output;
}

/* Compute recommended token price for a target margin % */
function recommendedTokenCost(targetMargin: number, worstCaseCostDollars: number): number {
  // revenue = tokens × avgTokenPrice
  // margin = (revenue - cost) / revenue → revenue = cost / (1 - margin)
  const requiredRevenue = worstCaseCostDollars / (1 - targetMargin / 100);
  return Math.ceil(requiredRevenue / AVG_TOKEN_PRICE);
}

interface FeatureConfig {
  id: string;
  token_cost: number;
  enabled: boolean;
  tier: string;
}

interface EditState {
  token_cost: number;
  enabled: boolean;
}

export default function PricingManagementPanel() {
  const [configs, setConfigs] = useState<FeatureConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [targetMargin, setTargetMargin] = useState(40);
  const [estInputTokens, setEstInputTokens] = useState(1500);
  const [estOutputTokens, setEstOutputTokens] = useState(1000);

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("feature_configs")
      .select("id, token_cost, enabled, tier");
    const rows = (data ?? []) as FeatureConfig[];
    setConfigs(rows);
    // Populate edits from DB + defaults for missing features
    const editMap: Record<string, EditState> = {};
    for (const [key, meta] of Object.entries(TOKEN_ACTION_METADATA)) {
      const dbRow = rows.find((r) => r.id === key);
      const defaultCost = (TOKEN_COSTS as Record<string, number>)[key] ?? 0;
      editMap[key] = {
        token_cost: dbRow?.token_cost ?? defaultCost,
        enabled: dbRow?.enabled ?? true,
      };
    }
    setEdits(editMap);
    setLoading(false);
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const features = useMemo(() => {
    return Object.entries(TOKEN_ACTION_METADATA)
      .filter(([, m]) => m.status !== "dead_code")
      .sort((a, b) => {
        const catOrder = ["main", "sub", "entry_cost", "admin", "unwired"];
        const diff = catOrder.indexOf(a[1].category) - catOrder.indexOf(b[1].category);
        if (diff !== 0) return diff;
        return (edits[b[0]]?.token_cost ?? 0) - (edits[a[0]]?.token_cost ?? 0);
      });
  }, [edits]);

  /* Per-feature: worst-case API cost (most expensive model), recommended cost */
  const costAnalysis = useMemo(() => {
    const analysis: Record<string, {
      worstModelId: string;
      worstCost: number;
      bestModelId: string;
      bestCost: number;
      recommended: number;
      currentRevenue: number;
      worstMargin: number;
    }> = {};

    for (const [key] of features) {
      const meta = TOKEN_ACTION_METADATA[key];
      if (!meta.usesAI) {
        analysis[key] = {
          worstModelId: "", worstCost: 0, bestModelId: "", bestCost: 0,
          recommended: 0, currentRevenue: 0, worstMargin: 100,
        };
        continue;
      }

      let worstCost = 0, worstModelId = "";
      let bestCost = Infinity, bestModelId = "";
      for (const mid of MODEL_IDS) {
        const cost = estimateApiCost(mid, estInputTokens, estOutputTokens);
        if (cost > worstCost) { worstCost = cost; worstModelId = mid; }
        if (cost < bestCost) { bestCost = cost; bestModelId = mid; }
      }

      const currentCost = edits[key]?.token_cost ?? 0;
      const currentRevenue = currentCost * AVG_TOKEN_PRICE;
      const worstMargin = currentRevenue > 0
        ? ((currentRevenue - worstCost) / currentRevenue) * 100
        : -Infinity;
      const rec = recommendedTokenCost(targetMargin, worstCost);

      analysis[key] = {
        worstModelId, worstCost, bestModelId, bestCost,
        recommended: rec, currentRevenue, worstMargin,
      };
    }
    return analysis;
  }, [features, edits, targetMargin, estInputTokens, estOutputTokens]);

  const updateEdit = useCallback((key: string, field: keyof EditState, val: number | boolean) => {
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], [field]: val } }));
  }, []);

  const applyRecommended = useCallback((key: string) => {
    const rec = costAnalysis[key]?.recommended;
    if (rec != null && rec > 0) {
      setEdits((prev) => ({ ...prev, [key]: { ...prev[key], token_cost: rec } }));
    }
  }, [costAnalysis]);

  const applyAllRecommended = useCallback(() => {
    setEdits((prev) => {
      const next = { ...prev };
      for (const [key] of features) {
        const rec = costAnalysis[key]?.recommended;
        if (rec != null && rec > 0 && TOKEN_ACTION_METADATA[key].usesAI) {
          next[key] = { ...next[key], token_cost: rec };
        }
      }
      return next;
    });
  }, [features, costAnalysis]);

  const resetToDefaults = useCallback(() => {
    setEdits((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        next[key] = {
          token_cost: (TOKEN_COSTS as Record<string, number>)[key] ?? 0,
          enabled: true,
        };
      }
      return next;
    });
  }, []);

  const hasChanges = useMemo(() => {
    for (const [key, edit] of Object.entries(edits)) {
      const dbRow = configs.find((c) => c.id === key);
      const defaultCost = (TOKEN_COSTS as Record<string, number>)[key] ?? 0;
      const dbCost = dbRow?.token_cost ?? defaultCost;
      const dbEnabled = dbRow?.enabled ?? true;
      if (edit.token_cost !== dbCost || edit.enabled !== dbEnabled) return true;
    }
    return false;
  }, [edits, configs]);

  const saveAll = useCallback(async () => {
    setSaving(true);
    const upserts = Object.entries(edits).map(([id, edit]) => ({
      id,
      token_cost: edit.token_cost,
      enabled: edit.enabled,
    }));

    // Snapshot before state so we can log per-row diffs
    const beforeByKey: Record<string, { token_cost: number; enabled: boolean }> = {};
    for (const [key, edit] of Object.entries(edits)) {
      const dbRow = configs.find((c) => c.id === key);
      const defaultCost = (TOKEN_COSTS as Record<string, number>)[key] ?? 0;
      beforeByKey[key] = {
        token_cost: dbRow?.token_cost ?? defaultCost,
        enabled: dbRow?.enabled ?? true,
      };
    }

    // Batch upsert
    const { error } = await supabase
      .from("feature_configs")
      .upsert(upserts, { onConflict: "id" });

    if (error) {
      toast.error("Failed to save pricing: " + error.message);
    } else {
      toast.success(`Saved ${upserts.length} feature configs`);

      // Audit: one row per feature_configs entry that actually changed
      await Promise.all(
        Object.entries(edits).map(([key, edit]) => {
          const before = beforeByKey[key];
          const after = { token_cost: edit.token_cost, enabled: edit.enabled };
          return logEconomicsChange({
            area: "feature_configs",
            entity_id: key,
            label: TOKEN_ACTION_LABELS[key as TokenAction] ?? key,
            before,
            after,
          });
        }),
      );

      fetchConfigs();
    }
    setSaving(false);
  }, [edits, configs, fetchConfigs]);

  const negativeMarginCount = useMemo(() => {
    return Object.entries(costAnalysis).filter(
      ([key, a]) => TOKEN_ACTION_METADATA[key]?.usesAI && a.worstMargin < 0,
    ).length;
  }, [costAnalysis]);

  function marginColor(m: number) {
    if (m >= 40) return "text-emerald-400";
    if (m >= 20) return "text-yellow-400";
    if (m >= 0) return "text-orange-400";
    return "text-destructive";
  }

  function marginBg(m: number) {
    if (m >= 40) return "";
    if (m >= 20) return "bg-yellow-500/5";
    if (m >= 0) return "bg-orange-500/10";
    return "bg-destructive/10";
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Loading pricing data…</div>;
  }

  return (
    <div className="space-y-4">
      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Card className="border-border/50 bg-card/80 flex-1 min-w-[200px]">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <div>
              <p className="text-[10px] font-mono text-muted-foreground">Target Margin %</p>
              <div className="flex items-center gap-2">
                <Input
                  type="number" value={targetMargin}
                  onChange={(e) => setTargetMargin(Number(e.target.value))}
                  min={0} max={95} step={5}
                  className="h-7 w-16 text-xs font-mono"
                />
                <span className="text-xs text-muted-foreground">for recommendations</span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/80 flex-1 min-w-[200px]">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <div>
              <p className="text-[10px] font-mono text-muted-foreground">Est. API Tokens / Call</p>
              <div className="flex items-center gap-2">
                <Input
                  type="number" value={estInputTokens}
                  onChange={(e) => setEstInputTokens(Number(e.target.value))}
                  min={100} step={100}
                  className="h-7 w-20 text-xs font-mono"
                />
                <span className="text-[10px] text-muted-foreground">in</span>
                <Input
                  type="number" value={estOutputTokens}
                  onChange={(e) => setEstOutputTokens(Number(e.target.value))}
                  min={100} step={100}
                  className="h-7 w-20 text-xs font-mono"
                />
                <span className="text-[10px] text-muted-foreground">out</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Summary stats */}
      <div className="flex flex-wrap items-center gap-3">
        {negativeMarginCount > 0 && (
          <Badge variant="destructive" className="gap-1 text-xs">
            <AlertTriangle className="h-3 w-3" />
            {negativeMarginCount} features with negative worst-case margin
          </Badge>
        )}
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={applyAllRecommended} className="h-7 text-[10px] gap-1">
          <TrendingDown className="h-3 w-3" /> Apply All Recommended
        </Button>
        <Button size="sm" variant="outline" onClick={resetToDefaults} className="h-7 text-[10px] gap-1">
          <RotateCcw className="h-3 w-3" /> Reset to Defaults
        </Button>
        <Button
          size="sm" onClick={saveAll} disabled={!hasChanges || saving}
          className="h-7 text-[10px] gap-1"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save All to Database
        </Button>
      </div>

      {/* Pricing Table */}
      <TooltipProvider>
        <div className="border border-border/50 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="font-mono text-[10px] sticky left-0 bg-muted/30 z-10 min-w-[160px]">Feature</TableHead>
                  <TableHead className="font-mono text-[10px] text-center min-w-[50px]">Cat</TableHead>
                  <TableHead className="font-mono text-[10px] text-center min-w-[45px]">On</TableHead>
                  <TableHead className="font-mono text-[10px] text-center min-w-[70px]">Default⊘</TableHead>
                  <TableHead className="font-mono text-[10px] text-center min-w-[80px]">Current⊘</TableHead>
                  <TableHead className="font-mono text-[10px] text-center min-w-[70px]">Revenue</TableHead>
                  <TableHead className="font-mono text-[10px] text-center min-w-[80px]">Worst API $</TableHead>
                  <TableHead className="font-mono text-[10px] text-center min-w-[75px]">Worst Margin</TableHead>
                  <TableHead className="font-mono text-[10px] text-center min-w-[80px]">
                    <Tooltip>
                      <TooltipTrigger className="inline-flex items-center gap-1 cursor-help">
                        Rec⊘ <HelpCircle className="h-3 w-3 text-muted-foreground/50" />
                      </TooltipTrigger>
                      <TooltipContent className="text-xs max-w-[200px]">
                        Recommended token cost to achieve {targetMargin}% margin on worst-case model
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="font-mono text-[10px] text-center min-w-[50px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {features.map(([key, meta]) => {
                  const edit = edits[key];
                  if (!edit) return null;
                  const analysis = costAnalysis[key];
                  const defaultCost = (TOKEN_COSTS as Record<string, number>)[key] ?? 0;
                  const changed = edit.token_cost !== defaultCost;
                  const dbRow = configs.find((c) => c.id === key);
                  const dbDirty = edit.token_cost !== (dbRow?.token_cost ?? defaultCost) || edit.enabled !== (dbRow?.enabled ?? true);

                  const catColors: Record<string, string> = {
                    main: "bg-primary/10 text-primary",
                    sub: "bg-accent/10 text-accent-foreground",
                    admin: "bg-muted text-muted-foreground",
                    entry_cost: "bg-yellow-500/10 text-yellow-600",
                    unwired: "bg-muted/50 text-muted-foreground/60",
                  };

                  return (
                    <TableRow
                      key={key}
                      className={`hover:bg-muted/20 ${dbDirty ? "ring-1 ring-inset ring-primary/20" : ""} ${marginBg(analysis.worstMargin)}`}
                    >
                      <TableCell className="font-mono text-[11px] sticky left-0 bg-card/90 z-10">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-1 cursor-help">
                              {meta.label}
                              {meta.usesAI && <Badge variant="outline" className="text-[8px] px-1 py-0">AI</Badge>}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-[240px] text-xs">
                            <p>{meta.description}</p>
                            {meta.edgeFunction && (
                              <p className="text-muted-foreground mt-1">Edge: {meta.edgeFunction}</p>
                            )}
                            {analysis.worstModelId && (
                              <p className="text-muted-foreground">Worst: {MODEL_COSTS[analysis.worstModelId]?.label}</p>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className={`text-[8px] px-1 py-0 ${catColors[meta.category] || ""}`}>
                          {meta.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={edit.enabled}
                          onCheckedChange={(v) => updateEdit(key, "enabled", v)}
                          className="scale-75"
                        />
                      </TableCell>
                      <TableCell className="text-center font-mono text-[11px] text-muted-foreground">
                        {defaultCost}
                      </TableCell>
                      <TableCell className="text-center">
                        <Input
                          type="number" value={edit.token_cost}
                          onChange={(e) => updateEdit(key, "token_cost", Number(e.target.value))}
                          min={0}
                          className={`h-7 w-20 text-xs font-mono text-center mx-auto ${changed ? "border-primary/50" : ""}`}
                        />
                      </TableCell>
                      <TableCell className="text-center font-mono text-[11px]">
                        ${analysis.currentRevenue.toFixed(3)}
                      </TableCell>
                      <TableCell className="text-center font-mono text-[11px]">
                        {meta.usesAI ? (
                          <Tooltip>
                            <TooltipTrigger className="cursor-help">
                              ${analysis.worstCost.toFixed(3)}
                            </TooltipTrigger>
                            <TooltipContent className="text-xs">
                              {MODEL_COSTS[analysis.worstModelId]?.label} @ {estInputTokens}in/{estOutputTokens}out
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                      <TableCell className={`text-center font-mono text-[11px] font-bold ${marginColor(analysis.worstMargin)}`}>
                        {meta.usesAI ? (
                          isFinite(analysis.worstMargin) ? `${analysis.worstMargin.toFixed(0)}%` : "—"
                        ) : (
                          <span className="text-emerald-400/60">100%</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center font-mono text-[11px]">
                        {meta.usesAI && analysis.recommended > 0 ? (
                          <span className={analysis.recommended > edit.token_cost ? "text-destructive" : "text-emerald-400"}>
                            {analysis.recommended}⊘
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {meta.usesAI && analysis.recommended > 0 && analysis.recommended !== edit.token_cost && (
                          <Button
                            size="sm" variant="ghost"
                            className="h-5 px-1.5 text-[9px]"
                            onClick={() => applyRecommended(key)}
                          >
                            Apply
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </TooltipProvider>

      <p className="text-[10px] text-muted-foreground font-mono px-1">
        Revenue = tokens × ${AVG_TOKEN_PRICE.toFixed(4)}/tk (weighted avg). Worst-case margin uses most expensive model ({MODEL_COSTS[MODEL_IDS[MODEL_IDS.length - 1]]?.label}). 
        Recommendations target {targetMargin}% margin on worst-case model at {estInputTokens}in/{estOutputTokens}out API tokens.
        Changes are saved to the database and take effect immediately for all users.
      </p>
    </div>
  );
}
