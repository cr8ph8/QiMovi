import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BurnScenario, riskFromRunway } from "@/hooks/useCashBurn";
import { formatCurrency } from "./BurnSummaryCards";
import { Badge } from "@/components/ui/badge";

interface Props {
  scenarios: BurnScenario[];
  canEdit: boolean;
  onUpsert: (s: Partial<BurnScenario> & { name: string }) => Promise<void>;
}

const DEFAULTS: Array<Partial<BurnScenario> & { name: string }> = [
  { name: "Conservative", starting_cash: 0, monthly_revenue: 0, monthly_expenses: 0, revenue_growth_rate: 0, expense_growth_rate: 0.02, expected_funding: 0 },
  { name: "Base", starting_cash: 0, monthly_revenue: 0, monthly_expenses: 0, revenue_growth_rate: 0.05, expense_growth_rate: 0.03, expected_funding: 0 },
  { name: "Growth", starting_cash: 0, monthly_revenue: 0, monthly_expenses: 0, revenue_growth_rate: 0.15, expense_growth_rate: 0.08, expected_funding: 0 },
];

function computeRunway(s: Partial<BurnScenario>): number | null {
  const net = Number(s.monthly_expenses || 0) - Number(s.monthly_revenue || 0);
  if (net <= 0) return null;
  const cash = Number(s.starting_cash || 0) + Number(s.expected_funding || 0);
  return cash / net;
}

export function ScenarioModeler({ scenarios, canEdit, onUpsert }: Props) {
  const [drafts, setDrafts] = useState<Record<string, Partial<BurnScenario>>>({});

  const ensure = async () => {
    for (const d of DEFAULTS) {
      if (!scenarios.find((s) => s.name === d.name)) {
        await onUpsert(d);
      }
    }
  };

  const set = (id: string, k: keyof BurnScenario, v: any) => {
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] || {}), [k]: v } }));
  };
  const merged = (s: BurnScenario) => ({ ...s, ...(drafts[s.id] || {}) });

  const save = async (s: BurnScenario) => {
    const m = merged(s);
    const runway = computeRunway(m);
    await onUpsert({ ...m, runway_months: runway, risk_level: riskFromRunway(runway) });
    setDrafts((d) => { const n = { ...d }; delete n[s.id]; return n; });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Scenarios</h3>
        {canEdit && scenarios.length < DEFAULTS.length && (
          <Button size="sm" onClick={ensure}>Seed defaults</Button>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {scenarios.map((s) => {
          const m = merged(s);
          const runway = computeRunway(m);
          const risk = riskFromRunway(runway);
          const dirty = Boolean(drafts[s.id]);
          return (
            <Card key={s.id} className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-medium">{s.name}</div>
                <Badge variant="outline" className="text-xs">{risk}</Badge>
              </div>
              <Field label="Starting cash" v={m.starting_cash} onChange={(v) => set(s.id, "starting_cash", v)} editable={canEdit} />
              <Field label="Monthly revenue" v={m.monthly_revenue} onChange={(v) => set(s.id, "monthly_revenue", v)} editable={canEdit} />
              <Field label="Monthly expenses" v={m.monthly_expenses} onChange={(v) => set(s.id, "monthly_expenses", v)} editable={canEdit} />
              <Field label="Revenue growth %/mo" v={m.revenue_growth_rate} step={0.01} onChange={(v) => set(s.id, "revenue_growth_rate", v)} editable={canEdit} />
              <Field label="Expense growth %/mo" v={m.expense_growth_rate} step={0.01} onChange={(v) => set(s.id, "expense_growth_rate", v)} editable={canEdit} />
              <Field label="Expected funding" v={m.expected_funding} onChange={(v) => set(s.id, "expected_funding", v)} editable={canEdit} />
              <div className="text-xs text-muted-foreground pt-1">
                Runway: <span className="text-foreground font-medium">{runway === null ? "Profitable" : `${runway.toFixed(1)} mo`}</span>
              </div>
              {canEdit && dirty && <Button size="sm" className="w-full" onClick={() => save(s)}>Save</Button>}
            </Card>
          );
        })}
      </div>

      {scenarios.length > 0 && (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scenario</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Expenses</TableHead>
                <TableHead className="text-right">Net burn</TableHead>
                <TableHead className="text-right">Runway</TableHead>
                <TableHead>Risk</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scenarios.map((s) => {
                const m = merged(s);
                const runway = computeRunway(m);
                const net = Number(m.monthly_expenses || 0) - Number(m.monthly_revenue || 0);
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(Number(m.monthly_revenue || 0))}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(Number(m.monthly_expenses || 0))}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(Math.max(net, 0))}</TableCell>
                    <TableCell className="text-right tabular-nums">{runway === null ? "∞" : `${runway.toFixed(1)} mo`}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{riskFromRunway(runway)}</Badge></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function Field({ label, v, onChange, editable, step }: { label: string; v: any; onChange: (n: number) => void; editable: boolean; step?: number }) {
  return (
    <label className="block text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input type="number" step={step ?? 1} value={v ?? 0} onChange={(e) => onChange(Number(e.target.value))} disabled={!editable} className="h-8 mt-1" />
    </label>
  );
}
