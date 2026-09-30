import { useState, useMemo, useCallback } from "react";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from "@/components/ui/tooltip";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  TOKEN_COSTS, TOKEN_ACTION_METADATA, getAvgTokenPrice,
  MODEL_COSTS, DEFAULT_SURCHARGES, MODEL_TIER_LABELS,
  LENGTH_CATEGORIES, BASE_SCORING_COST,
} from "@/lib/wallet";
import {
  TrendingUp, TrendingDown, AlertTriangle, Save, X, Columns2,
  HelpCircle, RotateCcw, ChevronDown, ChevronRight,
} from "lucide-react";

const MODEL_IDS = Object.keys(MODEL_COSTS);

/* Estimated avg page counts per entry category for API cost estimation */
const ENTRY_PAGE_ESTIMATES: Record<string, number> = {
  vertical: 3, micro: 3, short: 12, pilot_30: 30, pilot_60: 55, feature: 100,
};

/* Rough API token usage per page (input prompt + output) */
const TOKENS_PER_PAGE = { input: 800, output: 400 };

interface SurchargeOverride { multiplier: number; flat: number }

interface ScenarioParams {
  tokenPriceCents: number;
  inputTokens: number;
  outputTokens: number;
  toolPriceOverrides: Record<string, number>;
  entryFeeOverrides: Record<string, number>;
  surchargeOverrides: Record<string, SurchargeOverride>;
}

interface SavedScenario extends ScenarioParams {
  id: string;
  name: string;
  savedAt: string;
}

const STORAGE_KEY = "cis_pricing_scenarios";

function loadScenarios(): SavedScenario[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch { return []; }
}

function persistScenarios(s: SavedScenario[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

/* Default tool prices (AI only) */
function getDefaultToolPrices(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, meta] of Object.entries(TOKEN_ACTION_METADATA)) {
    if (!meta.usesAI || meta.status === "dead_code") continue;
    out[key] = (TOKEN_COSTS as Record<string, number>)[key] ?? 0;
  }
  return out;
}

/* Default entry fees */
function getDefaultEntryFees(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const cat of LENGTH_CATEGORIES) {
    out[cat.key] = cat.cost;
  }
  return out;
}

/* Default surcharges */
function getDefaultSurcharges(): Record<string, SurchargeOverride> {
  const out: Record<string, SurchargeOverride> = {};
  for (const [tier, val] of Object.entries(DEFAULT_SURCHARGES)) {
    out[tier] = { ...val };
  }
  return out;
}

/* Only AI-powered features — uses overrides */
function getAIFeatures(toolOverrides: Record<string, number>) {
  const out: { key: string; label: string; tokenCost: number; description: string }[] = [];
  for (const [key, meta] of Object.entries(TOKEN_ACTION_METADATA)) {
    if (!meta.usesAI || meta.status === "dead_code") continue;
    const cost = toolOverrides[key] ?? (TOKEN_COSTS as Record<string, number>)[key] ?? 0;
    out.push({ key, label: meta.label, tokenCost: cost, description: meta.description });
  }
  return out.sort((a, b) => b.tokenCost - a.tokenCost);
}

/* Entry fee features for margin table */
function getEntryFeatures(entryOverrides: Record<string, number>) {
  return LENGTH_CATEGORIES.map((cat) => ({
    key: `entry_${cat.key}`,
    label: `${cat.label} Entry`,
    tokenCost: entryOverrides[cat.key] ?? cat.cost,
    description: `${cat.pages} pages · est. ${ENTRY_PAGE_ESTIMATES[cat.key]} avg pages`,
    pages: ENTRY_PAGE_ESTIMATES[cat.key] || 30,
    categoryKey: cat.key,
  }));
}

function marginColor(m: number) {
  if (m >= 20) return "text-emerald-400";
  if (m >= 0) return "text-yellow-400";
  return "text-destructive";
}

function marginBg(m: number) {
  if (m >= 20) return "bg-emerald-500/10";
  if (m >= 0) return "bg-yellow-500/10";
  return "bg-destructive/10";
}

type FeatureRow = { key: string; label: string; tokenCost: number; description: string };

function computeCalcs(
  params: ScenarioParams,
  features: FeatureRow[],
  surcharges: Record<string, SurchargeOverride>,
) {
  const tokenPriceDollars = params.tokenPriceCents / 100;
  return features.map((f) => {
    const baseRevenue = f.tokenCost * tokenPriceDollars;
    const models = MODEL_IDS.map((id) => {
      const mc = MODEL_COSTS[id];
      const tier = mc.tier;
      const surcharge = surcharges[tier] || { multiplier: 1, flat: 0 };
      const surchargedRevenue = Math.ceil(f.tokenCost * surcharge.multiplier + surcharge.flat) * tokenPriceDollars;
      const cost = (params.inputTokens / 1000) * mc.input + (params.outputTokens / 1000) * mc.output;
      const margin = surchargedRevenue > 0 ? ((surchargedRevenue - cost) / surchargedRevenue) * 100 : -Infinity;
      return { id, cost, margin, surchargedRevenue, tier };
    });
    return { ...f, revenue: baseRevenue, models };
  });
}

/* Entry-specific calc using page-count-based API cost */
function computeEntryCalcs(
  params: ScenarioParams,
  entries: ReturnType<typeof getEntryFeatures>,
  surcharges: Record<string, SurchargeOverride>,
) {
  const tokenPriceDollars = params.tokenPriceCents / 100;
  return entries.map((e) => {
    const baseRevenue = e.tokenCost * tokenPriceDollars;
    const models = MODEL_IDS.map((id) => {
      const mc = MODEL_COSTS[id];
      const tier = mc.tier;
      const surcharge = surcharges[tier] || { multiplier: 1, flat: 0 };
      const surchargedRevenue = Math.ceil(e.tokenCost * surcharge.multiplier + surcharge.flat) * tokenPriceDollars;
      const inTokens = e.pages * TOKENS_PER_PAGE.input;
      const outTokens = e.pages * TOKENS_PER_PAGE.output;
      const cost = (inTokens / 1000) * mc.input + (outTokens / 1000) * mc.output;
      const margin = surchargedRevenue > 0 ? ((surchargedRevenue - cost) / surchargedRevenue) * 100 : -Infinity;
      return { id, cost, margin, surchargedRevenue, tier };
    });
    return { ...e, revenue: baseRevenue, models };
  });
}

function computeSummary(calculations: ReturnType<typeof computeCalcs>) {
  return MODEL_IDS.map((id) => {
    const margins = calculations.map((c) => c.models.find((m) => m.id === id)!.margin).filter(isFinite);
    const avg = margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : 0;
    const profitable = margins.filter((m) => m >= 0).length;
    return { id, label: MODEL_COSTS[id].label, avgMargin: avg, profitable, total: margins.length };
  });
}

/* ── Scenario Summary Card (compact) ── */
function ScenarioSummaryCard({ title, params, accent }: {
  title: string; params: ScenarioParams; accent: string;
}) {
  const features = useMemo(() => getAIFeatures(params.toolPriceOverrides), [params.toolPriceOverrides]);
  const calcs = useMemo(() => computeCalcs(params, features, params.surchargeOverrides), [params, features]);
  const summary = useMemo(() => computeSummary(calcs), [calcs]);
  const best = summary.reduce((a, b) => (a.avgMargin > b.avgMargin ? a : b));
  const worst = summary.reduce((a, b) => (a.avgMargin < b.avgMargin ? a : b));
  const losses = calcs.reduce((cnt, c) => cnt + c.models.filter((m) => m.margin < 0).length, 0);
  const totalCombos = calcs.length * MODEL_IDS.length;
  const overallAvg = summary.reduce((s, m) => s + m.avgMargin, 0) / summary.length;

  return (
    <Card className={`border-border/50 ${accent}`}>
      <CardHeader className="pb-1 pt-3 px-4">
        <CardTitle className="text-xs font-mono">{title}</CardTitle>
        <p className="text-[10px] text-muted-foreground font-mono">
          {params.tokenPriceCents.toFixed(1)}¢/tk · {params.inputTokens}in/{params.outputTokens}out
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-1.5">
        <div className="flex justify-between text-[11px]">
          <span className="text-muted-foreground">Avg Margin</span>
          <span className={`font-mono font-bold ${marginColor(overallAvg)}`}>{overallAvg.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-muted-foreground">Best Model</span>
          <span className="font-mono text-emerald-400">{best.label} ({best.avgMargin.toFixed(0)}%)</span>
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-muted-foreground">Worst Model</span>
          <span className="font-mono text-destructive">{worst.label} ({worst.avgMargin.toFixed(0)}%)</span>
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-muted-foreground">Loss Combos</span>
          <span className="font-mono">{losses}/{totalCombos}</span>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Inline Editable Number Cell ── */
function EditableCell({ value, onChange, min = 0, step = 1, className = "" }: {
  value: number; onChange: (v: number) => void; min?: number; step?: number; className?: string;
}) {
  return (
    <Input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      step={step}
      className={`h-7 w-20 text-xs font-mono text-center px-1 ${className}`}
    />
  );
}

/* ── Main Panel ── */
export default function ModelCostSimulatorPanel() {
  const defaultPrice = Math.round(getAvgTokenPrice() * 100 * 100) / 100;
  const [tokenPriceCents, setTokenPriceCents] = useState(defaultPrice || 5.4);
  const [inputTokens, setInputTokens] = useState(1000);
  const [outputTokens, setOutputTokens] = useState(1000);

  // Pricing overrides
  const [toolPriceOverrides, setToolPriceOverrides] = useState<Record<string, number>>(getDefaultToolPrices);
  const [entryFeeOverrides, setEntryFeeOverrides] = useState<Record<string, number>>(getDefaultEntryFees);
  const [surchargeOverrides, setSurchargeOverrides] = useState<Record<string, SurchargeOverride>>(getDefaultSurcharges);

  // Collapsible sections
  const [showTools, setShowTools] = useState(false);
  const [showEntries, setShowEntries] = useState(false);
  const [showSurcharges, setShowSurcharges] = useState(false);

  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>(loadScenarios);
  const [scenarioName, setScenarioName] = useState("");
  const [compareMode, setCompareMode] = useState(false);
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);

  const features = useMemo(() => getAIFeatures(toolPriceOverrides), [toolPriceOverrides]);
  const entryFeatures = useMemo(() => getEntryFeatures(entryFeeOverrides), [entryFeeOverrides]);

  const currentParams: ScenarioParams = {
    tokenPriceCents, inputTokens, outputTokens,
    toolPriceOverrides, entryFeeOverrides, surchargeOverrides,
  };

  const calculations = useMemo(
    () => computeCalcs(currentParams, features, surchargeOverrides),
    [tokenPriceCents, inputTokens, outputTokens, features, surchargeOverrides],
  );
  const entryCalcs = useMemo(
    () => computeEntryCalcs(currentParams, entryFeatures, surchargeOverrides),
    [tokenPriceCents, inputTokens, outputTokens, entryFeatures, surchargeOverrides],
  );

  const allCalcs = useMemo(() => [...calculations, ...entryCalcs], [calculations, entryCalcs]);
  const summaryByModel = useMemo(() => computeSummary(allCalcs), [allCalcs]);
  const bestModel = summaryByModel.reduce((a, b) => (a.avgMargin > b.avgMargin ? a : b));
  const worstModel = summaryByModel.reduce((a, b) => (a.avgMargin < b.avgMargin ? a : b));

  const updateToolPrice = useCallback((key: string, val: number) => {
    setToolPriceOverrides((prev) => ({ ...prev, [key]: val }));
  }, []);

  const updateEntryFee = useCallback((key: string, val: number) => {
    setEntryFeeOverrides((prev) => ({ ...prev, [key]: val }));
  }, []);

  const updateSurcharge = useCallback((tier: string, field: "multiplier" | "flat", val: number) => {
    setSurchargeOverrides((prev) => ({
      ...prev,
      [tier]: { ...prev[tier], [field]: val },
    }));
  }, []);

  const resetToDefaults = useCallback(() => {
    setToolPriceOverrides(getDefaultToolPrices());
    setEntryFeeOverrides(getDefaultEntryFees());
    setSurchargeOverrides(getDefaultSurcharges());
  }, []);

  const hasOverrides = useMemo(() => {
    const defTools = getDefaultToolPrices();
    const defEntries = getDefaultEntryFees();
    const defSurcharges = getDefaultSurcharges();
    const toolsDiff = Object.entries(toolPriceOverrides).some(([k, v]) => defTools[k] !== v);
    const entriesDiff = Object.entries(entryFeeOverrides).some(([k, v]) => defEntries[k] !== v);
    const surDiff = Object.entries(surchargeOverrides).some(
      ([k, v]) => defSurcharges[k]?.multiplier !== v.multiplier || defSurcharges[k]?.flat !== v.flat,
    );
    return toolsDiff || entriesDiff || surDiff;
  }, [toolPriceOverrides, entryFeeOverrides, surchargeOverrides]);

  const saveScenario = useCallback(() => {
    const name = scenarioName.trim() || `Scenario ${savedScenarios.length + 1}`;
    const s: SavedScenario = {
      id: crypto.randomUUID(),
      name,
      savedAt: new Date().toISOString(),
      ...currentParams,
    };
    const next = [...savedScenarios, s];
    setSavedScenarios(next);
    persistScenarios(next);
    setScenarioName("");
  }, [scenarioName, savedScenarios, currentParams]);

  const deleteScenario = useCallback((id: string) => {
    const next = savedScenarios.filter((s) => s.id !== id);
    setSavedScenarios(next);
    persistScenarios(next);
    if (compareA === id) setCompareA(null);
    if (compareB === id) setCompareB(null);
  }, [savedScenarios, compareA, compareB]);

  const loadScenario = useCallback((s: SavedScenario) => {
    setTokenPriceCents(s.tokenPriceCents);
    setInputTokens(s.inputTokens);
    setOutputTokens(s.outputTokens);
    if (s.toolPriceOverrides) setToolPriceOverrides(s.toolPriceOverrides);
    if (s.entryFeeOverrides) setEntryFeeOverrides(s.entryFeeOverrides);
    if (s.surchargeOverrides) setSurchargeOverrides(s.surchargeOverrides);
  }, []);

  const scenarioAData = compareA ? savedScenarios.find((s) => s.id === compareA) : null;
  const scenarioBData = compareB ? savedScenarios.find((s) => s.id === compareB) : null;

  const SURCHARGE_TIERS = Object.keys(DEFAULT_SURCHARGES);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-border/50 bg-card/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground">Token Sale Price</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold font-mono text-primary">{tokenPriceCents.toFixed(1)}</span>
              <span className="text-xs text-muted-foreground">¢ / token</span>
            </div>
            <Slider value={[tokenPriceCents]} onValueChange={([v]) => setTokenPriceCents(v)} min={1} max={20} step={0.1} />
            <p className="text-[10px] text-muted-foreground font-mono">Range: 1¢ – 20¢</p>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground">Input Tokens / Call</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold font-mono text-primary">{inputTokens.toLocaleString()}</span>
            </div>
            <Slider value={[inputTokens]} onValueChange={([v]) => setInputTokens(v)} min={500} max={5000} step={100} />
            <p className="text-[10px] text-muted-foreground font-mono">500 – 5,000</p>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground">Output Tokens / Call</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold font-mono text-primary">{outputTokens.toLocaleString()}</span>
            </div>
            <Slider value={[outputTokens]} onValueChange={([v]) => setOutputTokens(v)} min={500} max={5000} step={100} />
            <p className="text-[10px] text-muted-foreground font-mono">500 – 5,000</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Pricing Overrides ── */}
      <Card className="border-border/50 bg-card/80">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-xs font-mono text-muted-foreground">Pricing Overrides</CardTitle>
          {hasOverrides && (
            <Button size="sm" variant="outline" onClick={resetToDefaults} className="h-7 text-[10px] gap-1">
              <RotateCcw className="h-3 w-3" /> Reset All to Defaults
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {/* Tool Prices */}
          <Collapsible open={showTools} onOpenChange={setShowTools}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground w-full py-1">
              {showTools ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              AI Tool Prices ({Object.keys(toolPriceOverrides).length} tools)
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 pt-2">
                {Object.entries(toolPriceOverrides)
                  .sort(([, a], [, b]) => b - a)
                  .map(([key, val]) => {
                    const meta = TOKEN_ACTION_METADATA[key];
                    const defaultVal = (TOKEN_COSTS as Record<string, number>)[key] ?? 0;
                    const changed = val !== defaultVal;
                    return (
                      <div key={key} className={`flex items-center gap-2 p-1.5 rounded ${changed ? "bg-primary/10 ring-1 ring-primary/20" : ""}`}>
                        <span className="text-[10px] font-mono text-muted-foreground flex-1 truncate" title={meta?.label || key}>
                          {meta?.label || key}
                        </span>
                        <EditableCell value={val} onChange={(v) => updateToolPrice(key, v)} />
                      </div>
                    );
                  })}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Entry Fees */}
          <Collapsible open={showEntries} onOpenChange={setShowEntries}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground w-full py-1">
              {showEntries ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Entry Fees ({LENGTH_CATEGORIES.length} categories)
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-2">
                {LENGTH_CATEGORIES.map((cat) => {
                  const val = entryFeeOverrides[cat.key] ?? cat.cost;
                  const changed = val !== cat.cost;
                  return (
                    <div key={cat.key} className={`flex items-center gap-2 p-1.5 rounded ${changed ? "bg-primary/10 ring-1 ring-primary/20" : ""}`}>
                      <div className="flex-1 min-w-0">
                        <span className="text-[10px] font-mono text-muted-foreground block truncate">{cat.label}</span>
                        <span className="text-[9px] text-muted-foreground/60">{cat.pages} pp · ~{ENTRY_PAGE_ESTIMATES[cat.key]}pg avg</span>
                      </div>
                      <EditableCell value={val} onChange={(v) => updateEntryFee(cat.key, v)} />
                    </div>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Surcharge Tiers */}
          <Collapsible open={showSurcharges} onOpenChange={setShowSurcharges}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground w-full py-1">
              {showSurcharges ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Model Tier Surcharges ({SURCHARGE_TIERS.length} tiers)
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-2">
                {SURCHARGE_TIERS.map((tier) => {
                  const val = surchargeOverrides[tier] || { multiplier: 1, flat: 0 };
                  const def = DEFAULT_SURCHARGES[tier] || { multiplier: 1, flat: 0 };
                  const changed = val.multiplier !== def.multiplier || val.flat !== def.flat;
                  return (
                    <div key={tier} className={`flex items-center gap-2 p-1.5 rounded ${changed ? "bg-primary/10 ring-1 ring-primary/20" : ""}`}>
                      <span className="text-[10px] font-mono text-muted-foreground flex-1">
                        {MODEL_TIER_LABELS[tier] || tier}
                      </span>
                      <div className="flex items-center gap-1">
                        <EditableCell value={val.multiplier} onChange={(v) => updateSurcharge(tier, "multiplier", v)} min={0.1} step={0.1} className="w-16" />
                        <span className="text-[9px] text-muted-foreground">×</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[9px] text-muted-foreground mt-1 px-1">
                Surcharges proportional to API cost differentials. Standard = 1.0× baseline. Premium/Super Premium pad margins for expensive models.
              </p>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* Save Scenario */}
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          value={scenarioName}
          onChange={(e) => setScenarioName(e.target.value)}
          placeholder="Scenario name…"
          className="max-w-[200px] h-8 text-xs font-mono"
        />
        <Button size="sm" variant="outline" onClick={saveScenario} className="h-8 text-xs gap-1">
          <Save className="h-3 w-3" /> Save Current
        </Button>
        {savedScenarios.length >= 2 && (
          <Button
            size="sm"
            variant={compareMode ? "default" : "outline"}
            onClick={() => setCompareMode(!compareMode)}
            className="h-8 text-xs gap-1"
          >
            <Columns2 className="h-3 w-3" /> {compareMode ? "Exit Compare" : "Compare Scenarios"}
          </Button>
        )}
      </div>

      {/* Saved Scenarios */}
      {savedScenarios.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Saved Scenarios</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {savedScenarios.map((s) => (
              <div key={s.id} className="relative group">
                <ScenarioSummaryCard
                  title={s.name}
                  params={{
                    ...s,
                    toolPriceOverrides: s.toolPriceOverrides || getDefaultToolPrices(),
                    entryFeeOverrides: s.entryFeeOverrides || getDefaultEntryFees(),
                    surchargeOverrides: s.surchargeOverrides || getDefaultSurcharges(),
                  }}
                  accent={
                    compareA === s.id ? "bg-primary/5 ring-1 ring-primary/30" :
                    compareB === s.id ? "bg-accent/10 ring-1 ring-accent/30" :
                    "bg-card/80"
                  }
                />
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {compareMode && (
                    <>
                      <Button
                        size="sm" variant={compareA === s.id ? "default" : "outline"}
                        className="h-5 px-1.5 text-[9px]"
                        onClick={() => setCompareA(compareA === s.id ? null : s.id)}
                      >A</Button>
                      <Button
                        size="sm" variant={compareB === s.id ? "default" : "outline"}
                        className="h-5 px-1.5 text-[9px]"
                        onClick={() => setCompareB(compareB === s.id ? null : s.id)}
                      >B</Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" className="h-5 px-1 text-[9px]" onClick={() => loadScenario(s)}>Load</Button>
                  <Button size="sm" variant="ghost" className="h-5 px-1 text-[9px] text-destructive" onClick={() => deleteScenario(s.id)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="border-border/50 bg-emerald-500/5">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <TrendingUp className="h-5 w-5 text-emerald-400 shrink-0" />
            <div>
              <p className="text-[10px] font-mono text-muted-foreground">Best Avg Margin</p>
              <p className="font-bold text-sm text-emerald-400">{bestModel.label}</p>
              <p className="font-mono text-xs">{bestModel.avgMargin.toFixed(1)}% · {bestModel.profitable}/{bestModel.total} profitable</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-destructive/5">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <TrendingDown className="h-5 w-5 text-destructive shrink-0" />
            <div>
              <p className="text-[10px] font-mono text-muted-foreground">Worst Avg Margin</p>
              <p className="font-bold text-sm text-destructive">{worstModel.label}</p>
              <p className="font-mono text-xs">{worstModel.avgMargin.toFixed(1)}% · {worstModel.profitable}/{worstModel.total} profitable</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/80">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-400 shrink-0" />
            <div>
              <p className="text-[10px] font-mono text-muted-foreground">Loss-Making Combos</p>
              <p className="font-bold text-sm">
                {allCalcs.reduce((cnt, c) => cnt + c.models.filter((m) => m.margin < 0).length, 0)}
              </p>
              <p className="font-mono text-xs text-muted-foreground">of {allCalcs.length * MODEL_IDS.length} total</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── AI Tools Margin Table ── */}
      <TooltipProvider>
        <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">AI Tool Margins</p>
        <div className="border border-border/50 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="font-mono text-[10px] sticky left-0 bg-muted/30 z-10 min-w-[140px]">Feature</TableHead>
                  <TableHead className="font-mono text-[10px] text-center min-w-[50px]">Tkns</TableHead>
                  <TableHead className="font-mono text-[10px] text-right min-w-[70px]">Revenue</TableHead>
                  {MODEL_IDS.map((id) => (
                    <TableHead key={id} className="font-mono text-[10px] text-center min-w-[100px]">
                      <div>{MODEL_COSTS[id].label}</div>
                      <div className="text-muted-foreground text-[9px]">${MODEL_COSTS[id].input}/{MODEL_COSTS[id].output}</div>
                      <Badge variant="outline" className="text-[8px] mt-0.5">{MODEL_TIER_LABELS[MODEL_COSTS[id].tier] || MODEL_COSTS[id].tier}</Badge>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {calculations.map((row) => (
                  <TableRow key={row.key} className="hover:bg-muted/20">
                    <TableCell className="font-mono text-[11px] sticky left-0 bg-card/90 z-10">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center gap-1 cursor-help">
                            {row.label}
                            <HelpCircle className="h-3 w-3 text-muted-foreground/50" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-[220px] text-xs">
                          {row.description}
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="text-center font-mono text-xs">{row.tokenCost}</TableCell>
                    <TableCell className="text-right font-mono text-xs">${row.revenue.toFixed(3)}</TableCell>
                    {row.models.map((m) => (
                      <TableCell key={m.id} className={`text-center ${marginBg(m.margin)}`}>
                        <div className={`font-mono text-[11px] font-bold ${marginColor(m.margin)}`}>
                          {isFinite(m.margin) ? `${m.margin.toFixed(0)}%` : "—"}
                        </div>
                        <div className="text-[9px] text-muted-foreground">${m.cost.toFixed(3)}</div>
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* ── Entry Fee Margin Table ── */}
        <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mt-4">Entry Fee Margins (page-count scaled API cost)</p>
        <div className="border border-border/50 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="font-mono text-[10px] sticky left-0 bg-muted/30 z-10 min-w-[140px]">Category</TableHead>
                  <TableHead className="font-mono text-[10px] text-center min-w-[50px]">Fee⊘</TableHead>
                  <TableHead className="font-mono text-[10px] text-center min-w-[40px]">Pages</TableHead>
                  <TableHead className="font-mono text-[10px] text-right min-w-[70px]">Revenue</TableHead>
                  {MODEL_IDS.map((id) => (
                    <TableHead key={id} className="font-mono text-[10px] text-center min-w-[100px]">
                      {MODEL_COSTS[id].label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {entryCalcs.map((row) => (
                  <TableRow key={row.key} className="hover:bg-muted/20">
                    <TableCell className="font-mono text-[11px] sticky left-0 bg-card/90 z-10">{row.label}</TableCell>
                    <TableCell className="text-center font-mono text-xs">{row.tokenCost}</TableCell>
                    <TableCell className="text-center font-mono text-xs text-muted-foreground">{row.pages}</TableCell>
                    <TableCell className="text-right font-mono text-xs">${row.revenue.toFixed(3)}</TableCell>
                    {row.models.map((m) => (
                      <TableCell key={m.id} className={`text-center ${marginBg(m.margin)}`}>
                        <div className={`font-mono text-[11px] font-bold ${marginColor(m.margin)}`}>
                          {isFinite(m.margin) ? `${m.margin.toFixed(0)}%` : "—"}
                        </div>
                        <div className="text-[9px] text-muted-foreground">${m.cost.toFixed(3)}</div>
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </TooltipProvider>

      <p className="text-[10px] text-muted-foreground font-mono px-1">
        Tool margins use fixed input/output tokens per call. Entry margins scale API cost by estimated page count ({Object.entries(ENTRY_PAGE_ESTIMATES).map(([k, v]) => `${k}: ${v}pg`).join(", ")}). Surcharges apply to premium/super_premium tiers.
      </p>
    </div>
  );
}
