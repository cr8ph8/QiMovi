import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type CashBurnScope = "workspace" | "project" | "screenplay" | "writer" | "franchise";

export interface CashBurnRecord {
  id: string;
  user_id: string;
  scope_type: CashBurnScope;
  scope_id: string;
  month: string;
  starting_cash: number;
  revenue_collected: number;
  payroll: number;
  contractors: number;
  ai_api_costs: number;
  cloud_costs: number;
  marketing: number;
  legal_accounting: number;
  software_tools: number;
  event_costs: number;
  miscellaneous: number;
  custom_categories: Record<string, number>;
  notes: string | null;
}

export interface BurnScenario {
  id: string;
  user_id: string;
  scope_type: CashBurnScope;
  scope_id: string;
  name: string;
  starting_cash: number;
  monthly_revenue: number;
  monthly_expenses: number;
  revenue_growth_rate: number;
  expense_growth_rate: number;
  expected_funding: number;
  runway_months: number | null;
  risk_level: string | null;
}

export interface RunwayMilestone {
  id: string;
  user_id: string;
  scope_type: CashBurnScope;
  scope_id: string;
  title: string;
  target_date: string | null;
  estimated_cost: number;
  status: "not_started" | "in_progress" | "complete" | "at_risk";
  notes: string | null;
}

export const EXPENSE_FIELDS: Array<keyof CashBurnRecord> = [
  "payroll",
  "contractors",
  "ai_api_costs",
  "cloud_costs",
  "marketing",
  "legal_accounting",
  "software_tools",
  "event_costs",
  "miscellaneous",
];

export const EXPENSE_LABELS: Record<string, string> = {
  payroll: "Payroll",
  contractors: "Contractors",
  ai_api_costs: "AI / API",
  cloud_costs: "Cloud / Storage",
  marketing: "Marketing",
  legal_accounting: "Legal / Accounting",
  software_tools: "Software / Tools",
  event_costs: "Competitions / Events",
  miscellaneous: "Misc.",
};

export function totalExpenses(r: Partial<CashBurnRecord>): number {
  let t = 0;
  for (const f of EXPENSE_FIELDS) t += Number(r[f] ?? 0);
  if (r.custom_categories) for (const v of Object.values(r.custom_categories)) t += Number(v ?? 0);
  return t;
}

export function netBurn(r: Partial<CashBurnRecord>): number {
  return totalExpenses(r) - Number(r.revenue_collected ?? 0);
}

export function endingCash(r: Partial<CashBurnRecord>): number {
  return Number(r.starting_cash ?? 0) + Number(r.revenue_collected ?? 0) - totalExpenses(r);
}

export function riskFromRunway(months: number | null): "healthy" | "watch" | "critical" | "profitable" {
  if (months === null || !isFinite(months)) return "profitable";
  if (months >= 12) return "healthy";
  if (months >= 6) return "watch";
  return "critical";
}

export function useCashBurn(scopeType: CashBurnScope, scopeId: string | null | undefined) {
  const [records, setRecords] = useState<CashBurnRecord[]>([]);
  const [scenarios, setScenarios] = useState<BurnScenario[]>([]);
  const [milestones, setMilestones] = useState<RunwayMilestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!scopeId) return;
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    setUserId(u.user?.id ?? null);

    const [{ data: rec }, { data: sc }, { data: ms }, { data: edit }] = await Promise.all([
      supabase.from("cash_burn_records" as any).select("*").eq("scope_type", scopeType).eq("scope_id", scopeId).order("month"),
      supabase.from("burn_scenarios" as any).select("*").eq("scope_type", scopeType).eq("scope_id", scopeId).order("name"),
      supabase.from("runway_milestones" as any).select("*").eq("scope_type", scopeType).eq("scope_id", scopeId).order("target_date", { nullsFirst: false }),
      supabase.rpc("can_edit_cash_burn" as any, { _scope: scopeType, _scope_id: scopeId }),
    ]);

    setRecords(((rec as any) ?? []).map((r: any) => ({ ...r, custom_categories: r.custom_categories || {} })));
    setScenarios((sc as any) ?? []);
    setMilestones((ms as any) ?? []);
    setCanEdit(Boolean(edit));
    setLoading(false);
  }, [scopeType, scopeId]);

  useEffect(() => { reload(); }, [reload]);

  const summary = useMemo(() => {
    const sorted = [...records].sort((a, b) => a.month.localeCompare(b.month));
    const last = sorted[sorted.length - 1];
    const cash = last ? endingCash(last) : 0;
    const recent = sorted.slice(-3);
    const avgExpenses = recent.length ? recent.reduce((s, r) => s + totalExpenses(r), 0) / recent.length : 0;
    const avgRevenue = recent.length ? recent.reduce((s, r) => s + Number(r.revenue_collected || 0), 0) / recent.length : 0;
    const net = avgExpenses - avgRevenue;
    const runway = net > 0 ? cash / net : null;
    return {
      currentCash: cash,
      grossBurn: avgExpenses,
      monthlyRevenue: avgRevenue,
      netBurn: net,
      runwayMonths: runway,
      risk: riskFromRunway(runway),
    };
  }, [records]);

  const upsertRecord = useCallback(async (rec: Partial<CashBurnRecord> & { month: string }) => {
    if (!userId) return;
    const payload: any = {
      ...rec,
      user_id: userId,
      scope_type: scopeType,
      scope_id: scopeId,
    };
    const { error } = await supabase.from("cash_burn_records" as any).upsert(payload, { onConflict: "scope_type,scope_id,month" });
    if (error) { toast.error(error.message); return; }
    await reload();
  }, [userId, scopeType, scopeId, reload]);

  const deleteRecord = useCallback(async (id: string) => {
    const { error } = await supabase.from("cash_burn_records" as any).delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    await reload();
  }, [reload]);

  const upsertScenario = useCallback(async (s: Partial<BurnScenario> & { name: string }) => {
    if (!userId) return;
    const payload: any = { ...s, user_id: userId, scope_type: scopeType, scope_id: scopeId };
    const { error } = await supabase.from("burn_scenarios" as any).upsert(payload);
    if (error) { toast.error(error.message); return; }
    await reload();
  }, [userId, scopeType, scopeId, reload]);

  const upsertMilestone = useCallback(async (m: Partial<RunwayMilestone>) => {
    if (!userId) return;
    const payload: any = { ...m, user_id: userId, scope_type: scopeType, scope_id: scopeId };
    const { error } = await supabase.from("runway_milestones" as any).upsert(payload);
    if (error) { toast.error(error.message); return; }
    await reload();
  }, [userId, scopeType, scopeId, reload]);

  const deleteMilestone = useCallback(async (id: string) => {
    const { error } = await supabase.from("runway_milestones" as any).delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    await reload();
  }, [reload]);

  return {
    loading, canEdit, records, scenarios, milestones, summary,
    upsertRecord, deleteRecord, upsertScenario, upsertMilestone, deleteMilestone, reload,
  };
}
