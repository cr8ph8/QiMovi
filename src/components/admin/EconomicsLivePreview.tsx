import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { logEconomicsChange } from "@/lib/adminEconomicsAudit";
import { TrendingUp, Activity, AlertTriangle, BarChart3, LineChart as LineIcon, Save, Lock } from "lucide-react";
import {
  LENGTH_CATEGORIES,
  MODEL_COSTS,
  DEFAULT_SURCHARGES,
  TOKEN_VALUE_USD,
  MODEL_TIER_LABELS,
} from "@/lib/wallet";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ReferenceLine,
  Area,
  AreaChart,
} from "recharts";

/** Average page counts per category — mirrors CompetitionEconomicsPanel */
const AVG_PAGES: Record<string, number> = {
  vertical: 3,
  micro: 3,
  short: 12,
  pilot_30: 30,
  pilot_60: 55,
  feature: 100,
};

/** Token estimates per page for ingestion + scoring + rewrite pipeline */
const TOKENS_PER_PAGE_INPUT = 500;
const TOKENS_PER_PAGE_OUTPUT = 300;

type EntryFees = Record<string, number>;
type SurchargeOverrides = Record<string, { multiplier: number; flat: number }>;

interface Props {
  competitionId: string | null;
  competitionName?: string | null;
}

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const fmtPct = (n: number) =>
  `${(n * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;

export default function EconomicsLivePreview({ competitionId, competitionName }: Props) {
  const [entryFees, setEntryFees] = useState<EntryFees>(() =>
    Object.fromEntries(LENGTH_CATEGORIES.map((c) => [c.key, c.cost]))
  );
  const [surcharges, setSurcharges] = useState<SurchargeOverrides>(() => ({ ...DEFAULT_SURCHARGES }));
  const [prizePoolPct, setPrizePoolPct] = useState(5);

  // Assumptions (operator-tunable)
  const [volume, setVolume] = useState<Record<string, number>>({
    vertical: 50,
    micro: 25,
    short: 60,
    pilot_30: 30,
    pilot_60: 15,
    feature: 10,
  });
  const [tier, setTier] = useState<keyof typeof DEFAULT_SURCHARGES | string>("standard");
  const [modelId, setModelId] = useState<string>("google/gemini-2.5-flash");
  const [monthlyBurn, setMonthlyBurn] = useState(5000);
  const [cashBalance, setCashBalance] = useState(25000);

  const [locked, setLocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const snapshotRef = useRef<{ economics: any; assumptions: any }>({ economics: {}, assumptions: {} });

  // Load per-competition overrides + preview assumptions + lock state
  useEffect(() => {
    if (!competitionId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("competition_economics")
        .select("entry_fees, surcharge_overrides, prize_pool_pct, preview_assumptions, locked")
        .eq("competition_id", competitionId)
        .maybeSingle();
      if (cancelled || !data) return;
      const fees = (data.entry_fees as EntryFees) || {};
      const overrides = (data.surcharge_overrides as SurchargeOverrides) || {};
      const mergedFees = {
        ...Object.fromEntries(LENGTH_CATEGORIES.map((c) => [c.key, c.cost])),
        ...fees,
      };
      const mergedSurcharges = { ...DEFAULT_SURCHARGES, ...overrides };
      setEntryFees(mergedFees);
      setSurcharges(mergedSurcharges);
      if (typeof (data as any).prize_pool_pct === "number") {
        setPrizePoolPct((data as any).prize_pool_pct);
      }
      setLocked(Boolean((data as any).locked));

      const a = ((data as any).preview_assumptions ?? {}) as Record<string, any>;
      if (a && typeof a === "object") {
        if (a.volume && typeof a.volume === "object") setVolume((prev) => ({ ...prev, ...a.volume }));
        if (typeof a.tier === "string") setTier(a.tier);
        if (typeof a.modelId === "string") setModelId(a.modelId);
        if (typeof a.monthlyBurn === "number") setMonthlyBurn(a.monthlyBurn);
        if (typeof a.cashBalance === "number") setCashBalance(a.cashBalance);
      }

      snapshotRef.current = {
        economics: {
          entry_fees: mergedFees,
          surcharge_overrides: mergedSurcharges,
          prize_pool_pct: (data as any).prize_pool_pct ?? 5,
        },
        assumptions: a ?? {},
      };
    })();
    return () => { cancelled = true; };
  }, [competitionId]);

  const model = MODEL_COSTS[modelId] ?? MODEL_COSTS["google/gemini-2.5-flash"];
  const surcharge = surcharges[tier] ?? DEFAULT_SURCHARGES.standard;

  async function handleSavePreview() {
    if (!competitionId) {
      toast.error("Select a competition first");
      return;
    }
    if (locked) {
      toast.error("This competition is locked — economics are read-only");
      return;
    }
    setSaving(true);
    const nextEconomics = {
      entry_fees: entryFees,
      surcharge_overrides: surcharges,
      prize_pool_pct: prizePoolPct,
    };
    const nextAssumptions = { volume, tier, modelId, monthlyBurn, cashBalance };

    const { error } = await supabase
      .from("competition_economics")
      .upsert(
        {
          competition_id: competitionId,
          ...nextEconomics,
          preview_assumptions: nextAssumptions,
        },
        { onConflict: "competition_id" }
      );
    setSaving(false);
    if (error) {
      toast.error(`Save failed: ${error.message}`);
      return;
    }
    toast.success("Preview settings saved — scoring and submission flows will use these values");
    await Promise.all([
      logEconomicsChange({
        area: "competition_economics",
        entity_id: competitionId,
        label: "live_preview_save",
        before: snapshotRef.current.economics,
        after: nextEconomics,
      }),
      logEconomicsChange({
        area: "competition_economics",
        entity_id: competitionId,
        label: "preview_assumptions",
        before: snapshotRef.current.assumptions,
        after: nextAssumptions,
      }),
    ]);
    snapshotRef.current = { economics: nextEconomics, assumptions: nextAssumptions };
  }


  const rows = useMemo(() => {
    return LENGTH_CATEGORIES.map((cat) => {
      const baseFee = entryFees[cat.key] ?? cat.cost; // tokens
      const tieredFee = Math.ceil(baseFee * surcharge.multiplier) + surcharge.flat; // tokens
      const feeUsd = tieredFee * TOKEN_VALUE_USD;
      const entries = volume[cat.key] ?? 0;
      const grossUsd = feeUsd * entries;

      // AI cost per entry, derived from per-page token estimates and model cost/1k
      const pages = AVG_PAGES[cat.key] ?? 30;
      const inputCost = (pages * TOKENS_PER_PAGE_INPUT / 1000) * model.input;
      const outputCost = (pages * TOKENS_PER_PAGE_OUTPUT / 1000) * model.output;
      const aiPerEntry = inputCost + outputCost;
      const aiUsd = aiPerEntry * entries;

      return {
        ...cat,
        entries,
        tieredFee,
        feeUsd,
        grossUsd,
        aiPerEntry,
        aiUsd,
      };
    });
  }, [entryFees, surcharge.multiplier, surcharge.flat, volume, model.input, model.output]);

  const totals = useMemo(() => {
    const gross = rows.reduce((s, r) => s + r.grossUsd, 0);
    const ai = rows.reduce((s, r) => s + r.aiUsd, 0);
    const prize = gross * (prizePoolPct / 100);
    const grossMargin = gross > 0 ? (gross - ai) / gross : 0;
    const net = gross - ai - prize;
    const netMargin = gross > 0 ? net / gross : 0;
    const monthlyNet = net - monthlyBurn;
    const runwayMonths = monthlyNet >= 0
      ? Infinity
      : cashBalance / Math.abs(monthlyNet);
    return { gross, ai, prize, grossMargin, net, netMargin, monthlyNet, runwayMonths };
  }, [rows, prizePoolPct, monthlyBurn, cashBalance]);

  /** Per-category chart data — gross vs AI cost side-by-side. */
  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        name: r.label,
        gross: Math.round(r.grossUsd),
        ai: Math.round(r.aiUsd),
        net: Math.round(r.grossUsd - r.aiUsd),
      })),
    [rows]
  );

  /**
   * Runway timeline — projects cash balance forward month-by-month using
   * (net revenue per period − monthly burn). If cash-flow positive, the line
   * grows; if negative, it declines until the balance crosses zero.
   */
  const runwayData = useMemo(() => {
    const horizon = 24;
    const monthlyDelta = totals.monthlyNet; // net + revenue − burn
    const series: { month: string; cash: number; burn: number }[] = [];
    let cash = cashBalance;
    for (let i = 0; i <= horizon; i++) {
      series.push({
        month: `M${i}`,
        cash: Math.round(cash),
        burn: monthlyBurn,
      });
      cash += monthlyDelta;
    }
    return series;
  }, [cashBalance, totals.monthlyNet, monthlyBurn]);

  const zeroCrossingMonth = useMemo(() => {
    const idx = runwayData.findIndex((d) => d.cash <= 0);
    return idx > 0 ? runwayData[idx].month : null;
  }, [runwayData]);

  return (
    <Card className="border-border/60 bg-gradient-to-br from-card to-muted/10">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="font-display flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" />
            Live Preview
            {competitionName ? (
              <Badge variant="outline" className="ml-2 font-mono text-[10px]">{competitionName}</Badge>
            ) : null}
            {locked && (
              <Badge variant="destructive" className="font-mono text-[10px]">
                <Lock className="h-3 w-3 mr-1" />Locked
              </Badge>
            )}
          </CardTitle>
          <CardDescription className="text-xs">
            Real-time calculation of fees, AI cost-of-goods, prize-pool deduction, margin, and runway.
            Save to persist the fee schedule and assumptions to <code>competition_economics</code> so
            scoring, submission, and reporting flows read the same values.
          </CardDescription>
        </div>
        <Button
          size="sm"
          onClick={handleSavePreview}
          disabled={!competitionId || locked || saving}
          className="shrink-0"
        >
          <Save className="h-3.5 w-3.5 mr-1" />
          {saving ? "Saving…" : "Save to competition"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Top KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Kpi label="Gross Revenue" value={fmtUsd(totals.gross)} accent="primary" />
          <Kpi label="AI Cost" value={fmtUsd(totals.ai)} sub={`${fmtPct(totals.gross > 0 ? totals.ai / totals.gross : 0)} of gross`} />
          <Kpi label="Prize Pool" value={fmtUsd(totals.prize)} sub={`${prizePoolPct}% of gross`} />
          <Kpi label="Net Margin" value={fmtPct(totals.netMargin)} sub={fmtUsd(totals.net)} accent={totals.net >= 0 ? "good" : "bad"} />
          <Kpi
            label="Runway"
            value={totals.runwayMonths === Infinity ? "∞" : `${totals.runwayMonths.toFixed(1)} mo`}
            sub={totals.monthlyNet >= 0 ? "Cash-flow positive" : `${fmtUsd(totals.monthlyNet)}/mo`}
            accent={totals.monthlyNet >= 0 ? "good" : "warn"}
          />
        </div>

        {/* Assumption controls */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Scoring Model</Label>
            <Select value={modelId} onValueChange={setModelId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(MODEL_COSTS).map(([id, m]) => (
                  <SelectItem key={id} value={id}>
                    {m.label} · {MODEL_TIER_LABELS[m.tier] ?? m.tier}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Entry Tier (Surcharge)</Label>
            <Select value={tier} onValueChange={setTier}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(MODEL_TIER_LABELS).map(([k, label]) => {
                  const s = surcharges[k] ?? DEFAULT_SURCHARGES[k];
                  return (
                    <SelectItem key={k} value={k}>
                      {label} · ×{s?.multiplier ?? 1} {s?.flat ? `+${s.flat}` : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Monthly Burn (USD)</Label>
                <Input
                  type="number"
                  value={monthlyBurn}
                  onChange={(e) => setMonthlyBurn(Number(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Cash on Hand (USD)</Label>
                <Input
                  type="number"
                  value={cashBalance}
                  onChange={(e) => setCashBalance(Number(e.target.value) || 0)}
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Expected Entries by Category
            </Label>
            <div className="space-y-3">
              {LENGTH_CATEGORIES.map((cat) => (
                <div key={cat.key} className="flex items-center gap-3">
                  <div className="w-28 text-xs font-mono text-muted-foreground shrink-0">{cat.label}</div>
                  <Slider
                    value={[volume[cat.key] ?? 0]}
                    max={500}
                    step={5}
                    onValueChange={(v) => setVolume((prev) => ({ ...prev, [cat.key]: v[0] }))}
                    className="flex-1"
                  />
                  <div className="w-12 text-right text-xs font-mono">{volume[cat.key] ?? 0}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <Separator />

        {/* Interactive charts — revenue vs AI cost, and runway timeline */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="rounded-md border border-border/50 bg-background/40 p-3">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Gross Revenue vs AI Cost by Category
              </span>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} />
                <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    fontSize: 12,
                  }}
                  formatter={(v: number) => fmtUsd(v)}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="gross" name="Gross Revenue" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                <Bar dataKey="ai" name="AI Cost" fill="hsl(var(--destructive))" radius={[3, 3, 0, 0]} />
                <Bar dataKey="net" name="Net (pre-prize)" fill="hsl(var(--muted-foreground))" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-md border border-border/50 bg-background/40 p-3">
            <div className="flex items-center gap-2 mb-2">
              <LineIcon className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Cash Runway (24 mo projection)
              </span>
              {zeroCrossingMonth && (
                <Badge variant="destructive" className="ml-auto text-[10px] font-mono">
                  Zero at {zeroCrossingMonth}
                </Badge>
              )}
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={runwayData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} />
                <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v >= 1000 || v <= -1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    fontSize: 12,
                  }}
                  formatter={(v: number, name: string) => [fmtUsd(v), name === "cash" ? "Projected Cash" : "Monthly Burn"]}
                />
                <ReferenceLine y={0} stroke="hsl(var(--destructive))" strokeDasharray="4 4" />
                <Area
                  type="monotone"
                  dataKey="cash"
                  name="Projected Cash"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#cashFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <Separator />

        {/* Per-category breakdown */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/40">
                <th className="text-left py-2 font-mono uppercase tracking-wider">Category</th>
                <th className="text-right py-2 font-mono uppercase tracking-wider">Fee</th>
                <th className="text-right py-2 font-mono uppercase tracking-wider">Entries</th>
                <th className="text-right py-2 font-mono uppercase tracking-wider">Gross</th>
                <th className="text-right py-2 font-mono uppercase tracking-wider">AI/Entry</th>
                <th className="text-right py-2 font-mono uppercase tracking-wider">AI Cost</th>
                <th className="text-right py-2 font-mono uppercase tracking-wider">Margin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const margin = r.grossUsd > 0 ? (r.grossUsd - r.aiUsd) / r.grossUsd : 0;
                return (
                  <tr key={r.key} className="border-b border-border/20">
                    <td className="py-2">{r.label}</td>
                    <td className="text-right font-mono">{fmtUsd(r.feeUsd)}</td>
                    <td className="text-right font-mono">{r.entries}</td>
                    <td className="text-right font-mono">{fmtUsd(r.grossUsd)}</td>
                    <td className="text-right font-mono text-muted-foreground">{fmtUsd(r.aiPerEntry)}</td>
                    <td className="text-right font-mono">{fmtUsd(r.aiUsd)}</td>
                    <td className={`text-right font-mono ${margin < 0.3 ? "text-destructive" : margin < 0.6 ? "text-amber-500" : "text-primary"}`}>
                      {fmtPct(margin)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="py-2">Total</td>
                <td></td>
                <td className="text-right font-mono">{rows.reduce((s, r) => s + r.entries, 0)}</td>
                <td className="text-right font-mono">{fmtUsd(totals.gross)}</td>
                <td></td>
                <td className="text-right font-mono">{fmtUsd(totals.ai)}</td>
                <td className={`text-right font-mono ${totals.grossMargin < 0.3 ? "text-destructive" : "text-primary"}`}>
                  {fmtPct(totals.grossMargin)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {totals.monthlyNet < 0 && totals.runwayMonths < 6 && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              Runway under 6 months at current assumptions. Increase volume, raise fees, or
              switch to a lower-tier model to extend.
            </div>
          </div>
        )}
        {totals.monthlyNet >= 0 && (
          <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-primary">
            <TrendingUp className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              Cash-flow positive: this competition mix covers ${monthlyBurn.toLocaleString()} of monthly
              burn with {fmtUsd(totals.monthlyNet)} surplus per period.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "primary" | "good" | "warn" | "bad";
}) {
  const tone =
    accent === "good" ? "text-primary border-primary/30" :
    accent === "warn" ? "text-amber-500 border-amber-500/30" :
    accent === "bad"  ? "text-destructive border-destructive/30" :
    accent === "primary" ? "text-primary border-primary/30" :
    "text-foreground border-border/40";
  return (
    <div className={`rounded-md border ${tone.split(" ")[1]} bg-background/40 p-3`}>
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold font-mono ${tone.split(" ")[0]}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
