import { useMemo, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, BarChart, Bar } from "recharts";
import { RotateCcw, ArrowLeft } from "lucide-react";

interface ShieldProduct {
  id: string;
  name: string;
  tokens: number;
  cogs: number; // $ per unit AI cost
  recurring?: boolean;
  defaultAdoption: [number, number, number]; // low/base/high
  defaultUses: number; // avg uses per adopter / mo
}

const PRODUCTS: ShieldProduct[] = [
  { id: "cert",    name: "Authorship Certificate",         tokens: 5,  cogs: 0.001, defaultAdoption: [5, 15, 30],  defaultUses: 1.0 },
  { id: "scan",    name: "Protected-Author Emulation Scan", tokens: 3, cogs: 0.01,  defaultAdoption: [3, 10, 25],  defaultUses: 1.5 },
  { id: "stylo",   name: "Stylometric Deep Extract",       tokens: 5,  cogs: 0.002, defaultAdoption: [2, 8, 20],   defaultUses: 1.0 },
  { id: "q2e",     name: "Q2E / Qi Full Report",           tokens: 10, cogs: 0.05,  defaultAdoption: [4, 12, 25],  defaultUses: 1.0 },
  { id: "monitor", name: "Shield Monitor (per mo)",        tokens: 20, cogs: 0.02,  defaultAdoption: [1, 5, 12],   defaultUses: 1.0, recurring: true },
];

const TOKEN_PRICE = 0.10;

interface AdoptionState {
  m1: number; // % adopters
  m2: number;
  m3: number;
  uses: number;
}

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const fmtUSDc = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const fmtInt = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n));

export default function ShieldForecast() {
  const { user, isAdmin, loading: authLoading } = useAuth();

  // Active user base per month
  const [mau, setMau] = useState({ m1: 500, m2: 850, m3: 1400 });

  // Per-product adoption %
  const buildDefault = (): Record<string, AdoptionState> => {
    const o: Record<string, AdoptionState> = {};
    for (const p of PRODUCTS) {
      const [, base] = p.defaultAdoption;
      o[p.id] = { m1: base * 0.5, m2: base, m3: base * 1.4, uses: p.defaultUses };
    }
    return o;
  };
  const [adoption, setAdoption] = useState<Record<string, AdoptionState>>(buildDefault);

  const applyPreset = (key: "low" | "base" | "high") => {
    const idx = key === "low" ? 0 : key === "base" ? 1 : 2;
    const next: Record<string, AdoptionState> = {};
    for (const p of PRODUCTS) {
      const v = p.defaultAdoption[idx];
      next[p.id] = { m1: v * 0.5, m2: v, m3: v * 1.4, uses: p.defaultUses };
    }
    setAdoption(next);
  };

  const reset = () => {
    setMau({ m1: 500, m2: 850, m3: 1400 });
    setAdoption(buildDefault());
  };

  // Compute per-month/per-product results
  const results = useMemo(() => {
    const monthKeys = ["m1", "m2", "m3"] as const;
    const perProduct = PRODUCTS.map((p) => {
      const months = monthKeys.map((mk) => {
        const users = mau[mk];
        const pct = adoption[p.id][mk] / 100;
        const adopters = Math.round(users * pct);
        const units = Math.round(adopters * adoption[p.id].uses);
        const price = p.tokens * TOKEN_PRICE;
        const revenue = units * price;
        const cogs = units * p.cogs;
        const profit = revenue - cogs;
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
        return { month: mk, users, adopters, units, revenue, cogs, profit, margin, price };
      });
      const qRev = months.reduce((s, m) => s + m.revenue, 0);
      const qProfit = months.reduce((s, m) => s + m.profit, 0);
      const qUnits = months.reduce((s, m) => s + m.units, 0);
      const qMargin = qRev > 0 ? (qProfit / qRev) * 100 : 0;
      return { product: p, months, qRev, qProfit, qUnits, qMargin };
    });

    const monthTotals = monthKeys.map((mk, i) => {
      const rev = perProduct.reduce((s, r) => s + r.months[i].revenue, 0);
      const profit = perProduct.reduce((s, r) => s + r.months[i].profit, 0);
      const units = perProduct.reduce((s, r) => s + r.months[i].units, 0);
      return {
        month: mk.toUpperCase(),
        revenue: rev,
        profit,
        units,
        margin: rev > 0 ? (profit / rev) * 100 : 0,
      };
    });

    const qRev = monthTotals.reduce((s, m) => s + m.revenue, 0);
    const qProfit = monthTotals.reduce((s, m) => s + m.profit, 0);
    const qUnits = monthTotals.reduce((s, m) => s + m.units, 0);
    const qMargin = qRev > 0 ? (qProfit / qRev) * 100 : 0;

    return { perProduct, monthTotals, qRev, qProfit, qUnits, qMargin };
  }, [mau, adoption]);

  const chartData = results.monthTotals.map((m) => ({
    month: m.month,
    Revenue: Math.round(m.revenue),
    Profit: Math.round(m.profit),
    Margin: Number(m.margin.toFixed(1)),
  }));

  const productChartData = results.perProduct.map((r) => ({
    name: r.product.name.replace(" (per mo)", ""),
    Revenue: Math.round(r.qRev),
    Profit: Math.round(r.qProfit),
  }));

  if (authLoading) return null;
  if (!user || !isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="container mx-auto max-w-7xl px-4 py-10">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-3">
            <Link to="/god-mode"><ArrowLeft className="mr-2 h-4 w-4" />Back to God Mode</Link>
          </Button>
          <h1 className="font-serif text-4xl text-primary">Authorship Shield — Forecast Studio</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Interactive 3-month revenue and margin model. Adjust monthly active writers and per-product
            adoption curves — every number recomputes instantly. Token unit price = ${TOKEN_PRICE.toFixed(2)}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link to="/god-mode/shield-analytics">← Live analytics</Link>
          </Button>
          <Button size="sm" variant="outline" onClick={() => applyPreset("low")}>Low preset</Button>
          <Button size="sm" variant="outline" onClick={() => applyPreset("base")}>Base preset</Button>
          <Button size="sm" variant="outline" onClick={() => applyPreset("high")}>High preset</Button>
          <Button size="sm" variant="ghost" onClick={reset}><RotateCcw className="mr-1 h-4 w-4" />Reset</Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "Quarter Revenue", value: fmtUSD(results.qRev) },
          { label: "Quarter Gross Profit", value: fmtUSD(results.qProfit) },
          { label: "Blended Margin", value: fmtPct(results.qMargin) },
          { label: "Total Units", value: fmtInt(results.qUnits) },
        ].map((k) => (
          <Card key={k.label} className="border-primary/20 bg-card/50">
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{k.label}</div>
              <div className="mt-1 font-serif text-2xl text-primary">{k.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        {/* CONTROLS */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Monthly active writers</CardTitle>
              <CardDescription>Top-of-funnel base each month</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(["m1", "m2", "m3"] as const).map((mk, i) => (
                <div key={mk}>
                  <div className="mb-1 flex items-center justify-between">
                    <Label className="text-sm">Month {i + 1}</Label>
                    <Input
                      type="number"
                      className="h-7 w-24 text-right"
                      value={mau[mk]}
                      onChange={(e) => setMau({ ...mau, [mk]: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </div>
                  <Slider
                    value={[mau[mk]]}
                    min={0}
                    max={10000}
                    step={50}
                    onValueChange={([v]) => setMau({ ...mau, [mk]: v })}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Adoption curves per product</CardTitle>
              <CardDescription>% of active writers using each product / month</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {PRODUCTS.map((p) => (
                <div key={p.id} className="rounded-md border border-border/50 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.tokens}⊘ · {fmtUSDc(p.tokens * TOKEN_PRICE)} · COGS {fmtUSDc(p.cogs)}
                        {p.recurring && <Badge variant="outline" className="ml-2 text-[10px]">recurring</Badge>}
                      </div>
                    </div>
                  </div>
                  {(["m1", "m2", "m3"] as const).map((mk, i) => (
                    <div key={mk} className="mt-2">
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">M{i + 1} adoption</span>
                        <span className="font-mono">{adoption[p.id][mk].toFixed(1)}%</span>
                      </div>
                      <Slider
                        value={[adoption[p.id][mk]]}
                        min={0}
                        max={60}
                        step={0.5}
                        onValueChange={([v]) =>
                          setAdoption({ ...adoption, [p.id]: { ...adoption[p.id], [mk]: v } })
                        }
                      />
                    </div>
                  ))}
                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Avg uses / adopter / mo</span>
                      <span className="font-mono">{adoption[p.id].uses.toFixed(1)}</span>
                    </div>
                    <Slider
                      value={[adoption[p.id].uses]}
                      min={0.5}
                      max={5}
                      step={0.1}
                      onValueChange={([v]) =>
                        setAdoption({ ...adoption, [p.id]: { ...adoption[p.id], uses: v } })
                      }
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* RESULTS */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Monthly trajectory</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full">
                <ResponsiveContainer>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="month" />
                    <YAxis yAxisId="left" tickFormatter={(v) => `$${v}`} />
                    <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      formatter={(value: number, name: string) =>
                        name === "Margin" ? `${value}%` : fmtUSD(value)
                      }
                    />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="Revenue" stroke="hsl(var(--primary))" strokeWidth={2} />
                    <Line yAxisId="left" type="monotone" dataKey="Profit" stroke="hsl(var(--accent))" strokeWidth={2} />
                    <Line yAxisId="right" type="monotone" dataKey="Margin" stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Quarter revenue & profit by product</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full">
                <ResponsiveContainer>
                  <BarChart data={productChartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={70} />
                    <YAxis tickFormatter={(v) => `$${v}`} />
                    <Tooltip formatter={(value: number) => fmtUSD(value)} />
                    <Legend />
                    <Bar dataKey="Revenue" fill="hsl(var(--primary))" />
                    <Bar dataKey="Profit" fill="hsl(var(--accent))" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Per-product breakdown</CardTitle>
              <CardDescription>Quarter totals across all 3 months</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">COGS</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                    <TableHead className="text-right">Margin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.perProduct.map((r) => {
                    const cogs = r.qRev - r.qProfit;
                    return (
                      <TableRow key={r.product.id}>
                        <TableCell className="font-medium">{r.product.name}</TableCell>
                        <TableCell className="text-right font-mono">{fmtInt(r.qUnits)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtUSD(r.qRev)}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">{fmtUSDc(cogs)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtUSD(r.qProfit)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtPct(r.qMargin)}</TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="border-t-2 border-primary/40 bg-muted/30 font-semibold">
                    <TableCell>Quarter Total</TableCell>
                    <TableCell className="text-right font-mono">{fmtInt(results.qUnits)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtUSD(results.qRev)}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {fmtUSDc(results.qRev - results.qProfit)}
                    </TableCell>
                    <TableCell className="text-right font-mono">{fmtUSD(results.qProfit)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtPct(results.qMargin)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Month-by-month detail</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                    <TableHead className="text-right">Margin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.monthTotals.map((m) => (
                    <TableRow key={m.month}>
                      <TableCell className="font-medium">{m.month}</TableCell>
                      <TableCell className="text-right font-mono">{fmtInt(m.units)}</TableCell>
                      <TableCell className="text-right font-mono">{fmtUSD(m.revenue)}</TableCell>
                      <TableCell className="text-right font-mono">{fmtUSD(m.profit)}</TableCell>
                      <TableCell className="text-right font-mono">{fmtPct(m.margin)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Separator className="my-4" />
              <p className="text-xs text-muted-foreground">
                Gross margin = (revenue − AI inference COGS) / revenue. Excludes Stripe purchase fees (paid at
                token-bundle checkout) and platform overhead.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
