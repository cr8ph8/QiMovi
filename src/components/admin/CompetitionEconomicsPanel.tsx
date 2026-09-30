import { useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Lock, Unlock, Save, DollarSign, Trophy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  LENGTH_CATEGORIES,
  MODEL_COSTS,
  DEFAULT_SURCHARGES,
  BASE_SCORING_COST,
  TOKEN_VALUE_USD,
  MODEL_TIER_LABELS,
  getEntryTierTotal,
} from "@/lib/wallet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CompetitionFeeRulesEditor,
  normalizeFeeRules,
  resolveEffectiveFee,
  type FeeRules,
  type JudgingMode,
} from "./CompetitionFeeRulesEditor";
import { economicsPayloadSchema, flattenIssues, PRIZE_POOL_PCT_MAX, SURCHARGE_MIN, SURCHARGE_MAX, FEE_MAX } from "@/lib/economicsValidation";
import { logEconomicsChange } from "@/lib/adminEconomicsAudit";


const TIER_KEYS = ["budget", "fast", "standard", "premium", "super_premium"] as const;

/** Average page counts per category for API cost estimation */
const AVG_PAGES: Record<string, number> = {
  vertical: 3,
  micro: 3,
  short: 12,
  pilot_30: 30,
  pilot_60: 55,
  feature: 100,
};

/** Rough tokens per page for cost estimation (prompt + completion) */
const TOKENS_PER_PAGE_INPUT = 500;
const TOKENS_PER_PAGE_OUTPUT = 300;

interface Props {
  competitionId: string;
  competitionStatus: string;
}

type EntryFees = Record<string, number>;
type SurchargeOverrides = Record<string, { multiplier: number; flat: number }>;

export default function CompetitionEconomicsPanel({ competitionId, competitionStatus }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configExists, setConfigExists] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockedAt, setLockedAt] = useState<string | null>(null);

  const [feeRules, setFeeRules] = useState<FeeRules>(() => normalizeFeeRules(null));
  const [activeMode, setActiveMode] = useState<JudgingMode>("ai_only");
  const [surcharges, setSurcharges] = useState<SurchargeOverrides>(() => ({ ...DEFAULT_SURCHARGES }));
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Snapshot of the last-loaded config, used to compute before/after audit entries.
  const initialSnapshot = useRef<{
    economics: Record<string, unknown> | null;
    pool: Record<string, unknown> | null;
  }>({ economics: null, pool: null });


  // Prize pool state
  const [prizePoolPct, setPrizePoolPct] = useState(5);
  const [distributionMode, setDistributionMode] = useState("top_1");
  const [distributionSplits, setDistributionSplits] = useState<number[]>([100]);
  const [poolTotal, setPoolTotal] = useState(0);
  const [poolAwarded, setPoolAwarded] = useState(false);

  const isLive = ["open", "judging", "complete"].includes(competitionStatus);
  const disabled = locked || isLive;

  useEffect(() => {
    setLoading(true);
    supabase
      .from("competition_economics")
      .select("*")
      .eq("competition_id", competitionId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setConfigExists(true);
          const overrides = (data.surcharge_overrides as SurchargeOverrides) || {};
          const normalizedFees = normalizeFeeRules(data.entry_fees);
          const mergedSurcharges = { ...DEFAULT_SURCHARGES, ...overrides };
          setFeeRules(normalizedFees);
          setSurcharges(mergedSurcharges);
          setLocked(data.locked);
          setLockedAt(data.locked_at);
          if (typeof (data as any).prize_pool_pct === "number") {
            setPrizePoolPct((data as any).prize_pool_pct);
          }
          initialSnapshot.current.economics = {
            entry_fees: normalizedFees,
            surcharge_overrides: mergedSurcharges,
            prize_pool_pct: (data as any).prize_pool_pct ?? 5,
          };
        } else {
          setConfigExists(false);
          setFeeRules(normalizeFeeRules(null));
          setSurcharges({ ...DEFAULT_SURCHARGES });
          setLocked(false);
          setLockedAt(null);
          initialSnapshot.current.economics = null;
        }

        // Load active judging mode for the mode-scoped preview
        supabase
          .from("competition_judge_config")
          .select("judging_mode")
          .eq("competition_id", competitionId)
          .maybeSingle()
          .then(({ data: cfg }) => {
            const jm = (cfg as any)?.judging_mode as string | undefined;
            if (jm === "ai_only" || jm === "human_only" || jm === "hybrid") {
              setActiveMode(jm);
            }
          });

        // Load prize pool data
        supabase
          .from("prize_pools")
          .select("*")
          .eq("competition_id", competitionId)
          .maybeSingle()
          .then(({ data: pool }) => {
            if (pool) {
              setPrizePoolPct((pool as any).contribution_pct ?? 5);
              setDistributionMode((pool as any).distribution_mode ?? "top_1");
              setDistributionSplits((pool as any).distribution_splits ?? [100]);
              setPoolTotal((pool as any).total_tokens ?? 0);
              setPoolAwarded((pool as any).awarded ?? false);
              initialSnapshot.current.pool = {
                contribution_pct: (pool as any).contribution_pct ?? 5,
                distribution_mode: (pool as any).distribution_mode ?? "top_1",
                distribution_splits: (pool as any).distribution_splits ?? [100],
              };
            } else {
              initialSnapshot.current.pool = null;
            }
          });

        setLoading(false);
      });
  }, [competitionId]);

  async function handleSave() {
    const parsed = economicsPayloadSchema.safeParse({
      feeRules,
      surcharges,
      prizePoolPct,
      distributionMode,
      distributionSplits,
    });

    if (!parsed.success) {
      const issues = flattenIssues(parsed.error);
      setErrors(issues);
      const first = Object.values(issues)[0];
      toast({
        title: "Fix invalid fee configuration",
        description: first ?? "One or more fields are out of range.",
        variant: "destructive",
      });
      return;
    }
    setErrors({});

    setSaving(true);
    const payload = {
      competition_id: competitionId,
      entry_fees: feeRules as any,
      surcharge_overrides: surcharges,
      prize_pool_pct: prizePoolPct,
      locked: !!isLive,
      locked_at: isLive ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    const { error } = configExists
      ? await supabase.from("competition_economics").update(payload as any).eq("competition_id", competitionId)
      : await supabase.from("competition_economics").insert(payload as any);

    // Upsert prize_pools row
    const poolPayload = {
      competition_id: competitionId,
      contribution_pct: prizePoolPct,
      distribution_mode: distributionMode,
      distribution_splits: distributionSplits,
      updated_at: new Date().toISOString(),
    };
    const { data: existingPool } = await supabase
      .from("prize_pools")
      .select("id")
      .eq("competition_id", competitionId)
      .maybeSingle();
    if (existingPool) {
      await supabase.from("prize_pools").update(poolPayload as any).eq("competition_id", competitionId);
    } else {
      await supabase.from("prize_pools").insert(poolPayload as any);
    }

    setSaving(false);
    if (error) {
      toast({ title: "Error saving economics", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Economics config saved" });
      setConfigExists(true);
      if (isLive) {
        setLocked(true);
        setLockedAt(new Date().toISOString());
      }

      // ── Audit: record before/after for economics + prize pool ──
      const nextEconomics = {
        entry_fees: feeRules,
        surcharge_overrides: surcharges,
        prize_pool_pct: prizePoolPct,
      };
      const nextPool = {
        contribution_pct: prizePoolPct,
        distribution_mode: distributionMode,
        distribution_splits: distributionSplits,
      };
      await Promise.all([
        logEconomicsChange({
          area: "competition_economics",
          entity_id: competitionId,
          before: initialSnapshot.current.economics,
          after: nextEconomics,
        }),
        logEconomicsChange({
          area: "prize_pool",
          entity_id: competitionId,
          before: initialSnapshot.current.pool,
          after: nextPool,
        }),
      ]);
      initialSnapshot.current.economics = nextEconomics;
      initialSnapshot.current.pool = nextPool;
    }
  }


  function handleDistributionModeChange(mode: string) {
    setDistributionMode(mode);
    if (mode === "top_1") setDistributionSplits([100]);
    else if (mode === "top_3") setDistributionSplits([60, 30, 10]);
    // custom keeps existing splits
  }

  function computeMargin(modelId: string, categoryKey: string) {
    const model = MODEL_COSTS[modelId];
    if (!model) return null;
    const baseFee = resolveEffectiveFee(feeRules, categoryKey, activeMode);
    // Apply surcharge based on model tier
    const surcharge = surcharges[model.tier] || DEFAULT_SURCHARGES[model.tier] || { multiplier: 1, flat: 0 };
    const totalFeeTokens = getEntryTierTotal(baseFee, surcharge.multiplier, surcharge.flat);
    const revenue = totalFeeTokens * TOKEN_VALUE_USD;

    const pages = AVG_PAGES[categoryKey] || 30;
    const inputTokens = pages * TOKENS_PER_PAGE_INPUT;
    const outputTokens = pages * TOKENS_PER_PAGE_OUTPUT;
    const apiCost = (inputTokens / 1000) * model.input + (outputTokens / 1000) * model.output;
    const profit = revenue - apiCost;
    const marginPct = revenue > 0 ? (profit / revenue) * 100 : 0;

    return { totalFee: totalFeeTokens, revenue, apiCost, profit, marginPct };
  }

  const liveValidation = useMemo(() => {
    const result = economicsPayloadSchema.safeParse({
      feeRules,
      surcharges,
      prizePoolPct,
      distributionMode,
      distributionSplits,
    });
    if (result.success) return { hasErrors: false, messages: [] as string[] };
    const messages = Array.from(new Set(result.error.issues.map((i) => i.message)));
    return { hasErrors: true, messages };
  }, [feeRules, surcharges, prizePoolPct, distributionMode, distributionSplits]);

  if (loading) {
    return <div className="p-4 space-y-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-20 w-full" /></div>;
  }


  // Pick representative models for margin table
  const marginModels = [
    "google/gemini-3-flash-preview",
    "google/gemini-2.5-pro",
    "openai/gpt-5-mini",
    "openai/gpt-5",
  ];
  const marginCategories = ["vertical", "short", "feature"];

  return (
    <div className="p-4 space-y-5 border-t border-border/30 bg-muted/5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold font-display">Competition Economics</h4>
        </div>
        {disabled ? (
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-[10px] font-mono">
            <Lock className="h-3 w-3" /> Locked
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-mono">
            <Unlock className="h-3 w-3" /> Editable
          </div>
        )}
      </div>

      {/* Fee Rules · structured, per-mode overrides */}
      <CompetitionFeeRulesEditor
        value={feeRules}
        onChange={setFeeRules}
        activeMode={activeMode}
        disabled={disabled}
      />

      {/* Surcharge Tiers */}
      <div className="p-3 rounded-lg border border-border/40 bg-card/60 space-y-3">
        <Label className="text-xs font-semibold">Model Tier Surcharges</Label>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] font-mono h-8 px-2">Tier</TableHead>
                <TableHead className="text-[10px] font-mono h-8 px-2 text-center">Multiplier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {TIER_KEYS.map((tier) => {
                const s = surcharges[tier] || DEFAULT_SURCHARGES[tier];
                return (
                  <TableRow key={tier}>
                    <TableCell className="text-xs px-2 py-1.5 font-medium">{MODEL_TIER_LABELS[tier]}</TableCell>
                    <TableCell className="px-2 py-1.5 text-center">
                      <Input
                        type="number"
                        min={SURCHARGE_MIN}
                        max={SURCHARGE_MAX}
                        step={0.1}
                        value={s.multiplier}
                        onChange={(e) => {
                          const raw = Number(e.target.value);
                          const clamped = Number.isFinite(raw)
                            ? Math.min(SURCHARGE_MAX, Math.max(SURCHARGE_MIN, raw))
                            : 1;
                          setSurcharges((prev) => ({ ...prev, [tier]: { ...prev[tier], multiplier: clamped } }));
                        }}
                        disabled={disabled}
                        className={`w-20 h-7 text-center text-xs mx-auto ${errors[`surcharges.${tier}.multiplier`] ? "border-destructive" : ""}`}
                      />
                      {errors[`surcharges.${tier}.multiplier`] && (
                        <p className="text-[9px] text-destructive mt-0.5">{errors[`surcharges.${tier}.multiplier`]}</p>
                      )}

                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="text-[9px] text-muted-foreground">
          Proportional to API cost differentials. Standard = 1.0× baseline.
        </p>
      </div>

      {/* Prize Pool Config */}
      <div className="p-3 rounded-lg border border-border/40 bg-card/60 space-y-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-3.5 w-3.5 text-primary" />
          <Label className="text-xs font-semibold">Prize Pool</Label>
          {poolAwarded && (
            <Badge variant="outline" className="text-[9px] bg-primary/10 text-primary">Awarded</Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[10px] text-muted-foreground">Contribution %</Label>
            <Input
              type="number"
              min={0}
              max={PRIZE_POOL_PCT_MAX}
              step={0.5}
              value={prizePoolPct}
              onChange={(e) => {
                const raw = Number(e.target.value);
                const clamped = Number.isFinite(raw)
                  ? Math.min(PRIZE_POOL_PCT_MAX, Math.max(0, raw))
                  : 0;
                setPrizePoolPct(clamped);
              }}
              disabled={disabled}
              className={`w-full h-7 text-xs mt-1 ${errors["prizePoolPct"] ? "border-destructive" : ""}`}
            />
            {errors["prizePoolPct"] && (
              <p className="text-[9px] text-destructive mt-0.5">{errors["prizePoolPct"]}</p>
            )}
          </div>

          <div>
            <Label className="text-[10px] text-muted-foreground">Pool Total (⊘)</Label>
            <div className="mt-1 h-7 flex items-center px-2 rounded-md border border-border/40 bg-muted/30 text-xs font-mono">
              {poolTotal.toLocaleString()}
            </div>
          </div>
        </div>

        <div>
          <Label className="text-[10px] text-muted-foreground">Distribution Mode</Label>
          <Select value={distributionMode} onValueChange={handleDistributionModeChange} disabled={disabled}>
            <SelectTrigger className="h-7 text-xs mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="top_1">Winner takes all</SelectItem>
              <SelectItem value="top_3">Top 3 split</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {(distributionMode === "top_3" || distributionMode === "custom") && (
          <div>
            <Label className="text-[10px] text-muted-foreground">
              Splits (%) — must sum to 100
            </Label>
            <div className="flex gap-2 mt-1 flex-wrap items-center">
              {distributionSplits.map((split, i) => (
                <div key={i} className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={split}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      const clamped = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 0;
                      const newSplits = [...distributionSplits];
                      newSplits[i] = clamped;
                      setDistributionSplits(newSplits);
                    }}
                    disabled={disabled || distributionMode !== "custom" && distributionMode !== "top_3"}
                    className="w-16 h-7 text-center text-xs"
                  />
                  {distributionMode === "custom" && !disabled && distributionSplits.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-6 p-0 text-[10px] text-muted-foreground hover:text-destructive"
                      onClick={() => setDistributionSplits(distributionSplits.filter((_, j) => j !== i))}
                    >
                      ×
                    </Button>
                  )}
                </div>
              ))}
              {distributionMode === "custom" && !disabled && distributionSplits.length < 20 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px] px-2"
                  onClick={() => setDistributionSplits([...distributionSplits, 0])}
                >
                  +
                </Button>
              )}
            </div>
            <p className={`text-[9px] mt-1 ${errors["distributionSplits"] ? "text-destructive" : "text-muted-foreground"}`}>
              {errors["distributionSplits"] ?? `Sum: ${distributionSplits.reduce((a, b) => a + b, 0)}%`}
            </p>
          </div>
        )}


        <p className="text-[9px] text-muted-foreground">
          {prizePoolPct}% of every entry fee is diverted into the prize pool for top scorers.
        </p>
      </div>

      {/* Margin Analysis (read-only) */}
      <div className="p-3 rounded-lg border border-border/40 bg-card/60 space-y-3">
        <Label className="text-xs font-semibold">Margin Analysis (estimated)</Label>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] font-mono h-8 px-2">Model</TableHead>
                <TableHead className="text-[10px] font-mono h-8 px-2 text-center">Tier</TableHead>
                {marginCategories.map((c) => (
                  <TableHead key={c} className="text-[10px] font-mono h-8 px-1 text-center" colSpan={1}>
                    {LENGTH_CATEGORIES.find((l) => l.key === c)?.label}
                  </TableHead>
                ))}
              </TableRow>
              <TableRow>
                <TableHead className="h-6 px-2" />
                <TableHead className="h-6 px-2" />
                {marginCategories.map((c) => (
                  <TableHead key={c} className="text-[9px] font-mono h-6 px-1 text-center text-muted-foreground">
                    Profit / Margin%
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {marginModels.map((modelId) => {
                const model = MODEL_COSTS[modelId];
                if (!model) return null;
                return (
                  <TableRow key={modelId}>
                    <TableCell className="text-xs px-2 py-1.5 font-medium">{model.label}</TableCell>
                    <TableCell className="px-2 py-1.5 text-center">
                      <Badge
                        variant="outline"
                        className={`text-[9px] font-mono ${
                          model.tier === "super_premium"
                            ? "bg-destructive/10 text-destructive"
                            : model.tier === "premium"
                            ? "bg-amber-500/10 text-amber-600"
                            : "bg-primary/10 text-primary"
                        }`}
                      >
                        {MODEL_TIER_LABELS[model.tier]}
                      </Badge>
                    </TableCell>
                    {marginCategories.map((c) => {
                      const m = computeMargin(modelId, c);
                      if (!m) return <TableCell key={c} className="px-1 py-1.5 text-center text-xs">—</TableCell>;
                      const isNeg = m.profit < 0;
                      return (
                        <TableCell
                          key={c}
                          className={`px-1 py-1.5 text-center text-xs font-mono ${
                            isNeg ? "text-destructive font-semibold" : "text-muted-foreground"
                          }`}
                        >
                          ${m.profit.toFixed(2)} / {m.marginPct.toFixed(0)}%
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="text-[9px] text-muted-foreground">
          Estimates based on avg page counts. Red = negative margin (API cost exceeds revenue).
        </p>
      </div>

      {!disabled && (
        <>
          {liveValidation.hasErrors && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-[10px] text-destructive space-y-0.5">
              <p className="font-semibold">Fix before saving:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {liveValidation.messages.slice(0, 4).map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          <Button
            onClick={handleSave}
            disabled={saving || liveValidation.hasErrors}
            size="sm"
            className="w-full text-xs"
          >
            <Save className="h-3 w-3 mr-1" />
            {saving ? "Saving…" : configExists ? "Update Economics" : "Save Economics"}
          </Button>
        </>
      )}


      {lockedAt && (
        <p className="text-[10px] text-muted-foreground text-center">
          Locked at {new Date(lockedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
