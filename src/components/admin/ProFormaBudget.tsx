import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ArrowLeft, Download, RefreshCw, Save, History, Zap, Fuel, TrendingDown, AlertTriangle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceDot, Label } from "recharts";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const zeros = (): number[] => Array(12).fill(0);

export interface ProFormaData {
  year: number;
  revenue: { token: number[]; subscription: number[]; ad: number[] };
  cogs: { hosting: number[]; licenses: number[]; merchant_fees: number[] };
  selling: { ad_spend: number[]; design: number[]; development: number[]; marketing: number[]; travel: number[]; meals: number[]; equipment: number[]; website_email: number[] };
  ga: { office: number[]; legal: number[]; rent: number[]; utilities: number[]; insurance: number[]; subscriptions: number[]; telephone: number[] };
  wages: { four01k: number[]; bonus: number[]; contractor: number[]; payroll_taxes: number[]; unemployment: number[] };
  operations: { equipment_computers: number[]; repairs: number[] };
  other_income: { interest: number[] };
  other_expenses: { bank_fees: number[] };
  cashflow: { carryover: number[]; investment: number[]; operations_cf: number[] };
  compensation: {
    payroll: { owner: number[]; developer: number[]; backend_auditor: number[]; legal: number[]; marketing: number[] };
    benefits: { owner: number[]; developer: number[]; backend_auditor: number[]; legal: number[]; marketing: number[] };
  };
  development?: { lovable_credits: number[]; lovable_unit_cost: number[]; lovable_prepaid_credits: number[]; lovable_prepaid_unit_cost: number[] };
  startup?: { legal_formation: number[]; insurance_deposit: number[]; domain_branding: number[]; research: number[]; software_tools: number[] };
  revenue_projections?: { token: number[]; subscription: number[]; ad: number[] };
}

// Migrate old emp1-4 keys to new role-based keys
function migrateCompensation(comp: any): ProFormaData["compensation"] {
  const keyMap: Record<string, string> = { emp1: "developer", emp2: "backend_auditor", emp3: "legal", emp4: "marketing" };
  const migrate = (sub: any) => {
    const result: any = { owner: sub?.owner || zeros() };
    for (const [oldKey, newKey] of Object.entries(keyMap)) {
      result[newKey] = sub?.[newKey] || sub?.[oldKey] || zeros();
    }
    return result;
  };
  return {
    payroll: migrate(comp?.payroll),
    benefits: migrate(comp?.benefits),
  };
}

function projectedMonthlySalaries() {
  return {
    payroll: {
      owner: Array(12).fill(10000),
      developer: Array(12).fill(8000),
      backend_auditor: Array(12).fill(6000),
      legal: Array(12).fill(4000),
      marketing: Array(12).fill(3000),
    },
    benefits: {
      owner: Array(12).fill(2000),
      developer: Array(12).fill(1600),
      backend_auditor: Array(12).fill(1200),
      legal: Array(12).fill(800),
      marketing: Array(12).fill(600),
    },
  };
}

function projectedStartupCosts() {
  return {
    legal_formation: [2000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    insurance_deposit: [1500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    domain_branding: [500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    research: [500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    software_tools: [300, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

function defaultRevenueProjections() {
  return {
    token: [0, 0, 500, 750, 1000, 1250, 1250, 1500, 1500, 1750, 2000, 2000],
    subscription: [0, 0, 57, 95, 133, 190, 190, 228, 266, 285, 342, 380],
    ad: [0, 0, 0, 0, 0, 0, 50, 50, 100, 100, 100, 150],
  };
}

export function emptyProForma(year?: number): ProFormaData {
  const salaries = projectedMonthlySalaries();
  return {
    year: year || new Date().getFullYear(),
    revenue: { token: zeros(), subscription: zeros(), ad: zeros() },
    cogs: { hosting: zeros(), licenses: zeros(), merchant_fees: zeros() },
    selling: { ad_spend: zeros(), design: zeros(), development: zeros(), marketing: zeros(), travel: zeros(), meals: zeros(), equipment: zeros(), website_email: zeros() },
    ga: { office: zeros(), legal: zeros(), rent: zeros(), utilities: zeros(), insurance: Array(12).fill(500), subscriptions: zeros(), telephone: zeros() },
    wages: { four01k: zeros(), bonus: zeros(), contractor: zeros(), payroll_taxes: Array(12).fill(2372), unemployment: zeros() },
    operations: { equipment_computers: zeros(), repairs: zeros() },
    other_income: { interest: zeros() },
    other_expenses: { bank_fees: zeros() },
    cashflow: { carryover: zeros(), investment: zeros(), operations_cf: zeros() },
    compensation: salaries,
    development: { lovable_credits: zeros(), lovable_unit_cost: zeros(), lovable_prepaid_credits: zeros(), lovable_prepaid_unit_cost: zeros() },
    startup: projectedStartupCosts(),
    revenue_projections: defaultRevenueProjections(),
  };
}
const sumArrays = (...arrs: number[][]): number[] => arrs[0].map((_, i) => arrs.reduce((s, a) => s + (a[i] || 0), 0));
const sumArr = (a: number[]) => a.reduce((s, v) => s + v, 0);
const fmt = (v: number) => v === 0 ? "$0" : `$${v < 0 ? "-" : ""}${Math.abs(v).toLocaleString()}`;

interface CellProps { value: number; onChange: (v: number) => void; }
function Cell({ value, onChange }: CellProps) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(String(value));
  useEffect(() => { if (!editing) setRaw(String(value)); }, [value, editing]);
  if (editing) {
    return (
      <input
        type="number"
        className="w-full h-full bg-transparent text-right text-xs font-mono px-1 outline-none border-b border-primary/40"
        value={raw}
        autoFocus
        onChange={(e) => setRaw(e.target.value)}
        onBlur={() => { setEditing(false); const n = parseInt(raw) || 0; if (n !== value) onChange(n); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
    );
  }
  return (
    <span
      className="block w-full text-right text-xs font-mono px-1 cursor-text hover:bg-accent/30 rounded"
      onClick={() => setEditing(true)}
    >
      {fmt(value)}
    </span>
  );
}

function ReadonlyCell({ value, bold }: { value: number; bold?: boolean }) {
  return (
    <span className={`block w-full text-right text-xs font-mono px-1 ${bold ? "font-bold" : ""}`}>
      {fmt(value)}
    </span>
  );
}

interface ChangeLogEntry {
  id: string;
  field_path: string;
  old_value: number | null;
  new_value: number | null;
  created_at: string;
}

interface Doc { id: string; title: string; doc_type: string; content: string; status: string; version: number; updated_at: string; }

interface Props { doc: Doc; onBack?: () => void; }

interface BurnChartData {
  month: string;
  projectedExpense: number;
  actualExpense: number;
  projectedRevenue: number;
  actualRevenue: number;
  cumProjectedBurn: number;
  cumActualBurn: number;
}

function BurnChart({ data, type, breakEvenMonth }: { data: BurnChartData[]; type: "monthly" | "cumulative"; breakEvenMonth?: string | null }) {
  if (type === "cumulative") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
          <XAxis dataKey="month" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
          <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
            formatter={(value: number) => [`$${value.toLocaleString()}`, undefined]}
          />
          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeWidth={1}>
            <Label value="Break-Even" position="insideTopRight" fill="hsl(var(--muted-foreground))" fontSize={9} />
          </ReferenceLine>
          {breakEvenMonth && (
            <ReferenceLine x={breakEvenMonth} stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="6 3">
              <Label value={`↓ ${breakEvenMonth}`} position="top" fill="hsl(var(--primary))" fontSize={10} fontWeight="bold" />
            </ReferenceLine>
          )}
          <Line type="monotone" dataKey="cumProjectedBurn" name="Projected Burn" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 5" />
          <Line type="monotone" dataKey="cumActualBurn" name="Actual Burn" stroke="hsl(var(--destructive))" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
        <XAxis dataKey="month" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
        <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
        <Tooltip
          contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
          formatter={(value: number) => [`$${value.toLocaleString()}`, undefined]}
        />
        <Bar dataKey="projectedExpense" name="Proj. Expense" fill="hsl(var(--primary) / 0.25)" radius={[2, 2, 0, 0]} />
        <Bar dataKey="actualExpense" name="Actual Expense" fill="hsl(var(--destructive) / 0.5)" radius={[2, 2, 0, 0]} />
        <Bar dataKey="projectedRevenue" name="Proj. Revenue" fill="hsl(var(--primary) / 0.6)" radius={[2, 2, 0, 0]} />
        <Bar dataKey="actualRevenue" name="Actual Revenue" fill="hsl(var(--accent-foreground) / 0.5)" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function ProFormaBudget({ doc, onBack }: Props) {
  const { user } = useAuth();
  const [data, setData] = useState<ProFormaData>(() => {
    try {
      const parsed = JSON.parse(doc.content);
      // Migrate old emp1-4 keys if present
      if (parsed.compensation) {
        parsed.compensation = migrateCompensation(parsed.compensation);
      }
      return parsed;
    } catch { return emptyProForma(); }
  });
  const [saving, setSaving] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [changeLog, setChangeLog] = useState<ChangeLogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  const save = useCallback(async (d: ProFormaData) => {
    setSaving(true);
    await supabase.from("business_documents").update({ content: JSON.stringify(d), updated_at: new Date().toISOString() }).eq("id", doc.id);
    setSaving(false);
  }, [doc.id]);

  const logChange = useCallback(async (fieldPath: string, oldValue: number, newValue: number) => {
    if (!user) return;
    await supabase.from("proforma_change_log" as any).insert({
      document_id: doc.id,
      user_id: user.id,
      field_path: fieldPath,
      old_value: oldValue,
      new_value: newValue,
    } as any);
  }, [doc.id, user]);

  const loadChangeLog = useCallback(async () => {
    setLogLoading(true);
    const { data: logs } = await supabase
      .from("proforma_change_log" as any)
      .select("id, field_path, old_value, new_value, created_at")
      .eq("document_id", doc.id)
      .order("created_at", { ascending: false })
      .limit(100) as any;
    setChangeLog(logs || []);
    setLogLoading(false);
  }, [doc.id]);

  useEffect(() => {
    if (showLog) loadChangeLog();
  }, [showLog, loadChangeLog]);

  const update = useCallback((fn: (d: ProFormaData) => ProFormaData) => {
    setData(prev => {
      const next = fn({ ...prev });
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(next), 2000);
      return next;
    });
  }, [save]);

  const setCell = (section: string, key: string, monthIdx: number, value: number) => {
    const currentData = data as any;
    const oldValue = currentData[section]?.[key]?.[monthIdx] ?? 0;
    logChange(`${section}.${key}.${monthIdx}`, oldValue, value);
    update(d => {
      const s = d as any;
      if (!s[section] || !s[section][key]) return d;
      s[section][key] = [...s[section][key]];
      s[section][key][monthIdx] = value;
      return { ...d };
    });
  };

  const setCompCell = (sub: "payroll" | "benefits", key: string, monthIdx: number, value: number) => {
    const oldValue = (data.compensation[sub] as any)[key]?.[monthIdx] ?? 0;
    logChange(`compensation.${sub}.${key}.${monthIdx}`, oldValue, value);
    update(d => {
      const comp = { ...d.compensation };
      comp[sub] = { ...comp[sub] };
      (comp[sub] as any)[key] = [...(comp[sub] as any)[key]];
      (comp[sub] as any)[key][monthIdx] = value;
      return { ...d, compensation: comp };
    });
  };

  // Row label lookup for change log display
  const fieldPathToLabel = (fp: string): string => {
    const parts = fp.split(".");
    const monthIdx = parseInt(parts[parts.length - 1]);
    const month = MONTHS[monthIdx] || `M${monthIdx}`;
    const labelMap: Record<string, string> = {
      "revenue.token": "Token Revenue",
      "revenue.subscription": "Subscription Revenue",
      "revenue.ad": "Ad Revenue",
      "cogs.hosting": "Hosting / AI Infra",
      "cogs.licenses": "Licenses",
      "cogs.merchant_fees": "Merchant Fees",
      "selling.ad_spend": "Ad Spend",
      "selling.design": "Design",
      "selling.development": "Development",
      "selling.marketing": "Marketing",
      "selling.travel": "Travel",
      "selling.meals": "Meals & Entertainment",
      "selling.equipment": "Equipment",
      "selling.website_email": "Website / Email",
      "ga.office": "Office Supplies",
      "ga.legal": "Legal & Accounting",
      "ga.rent": "Rent",
      "ga.utilities": "Utilities",
      "ga.insurance": "Business Insurance / E&O",
      "ga.subscriptions": "Subscriptions / SaaS",
      "ga.telephone": "Telephone",
      "wages.four01k": "401(k) Match",
      "wages.bonus": "Bonus",
      "wages.contractor": "Contractor",
      "wages.payroll_taxes": "Payroll Taxes",
      "wages.unemployment": "Unemployment Tax",
      "operations.equipment_computers": "Equipment / Computers",
      "operations.repairs": "Repairs & Maintenance",
      "other_income.interest": "Interest Income",
      "other_expenses.bank_fees": "Bank Fees",
      "cashflow.carryover": "Cash Carryover",
      "cashflow.investment": "Investment / Funding",
      "cashflow.operations_cf": "Operations Cash",
      "development.lovable_credits": "Lovable Credits (On-Demand)",
      "development.lovable_unit_cost": "Unit Cost — On-Demand ($/credit)",
      "development.lovable_prepaid_credits": "Lovable Credits (Prepaid)",
      "development.lovable_prepaid_unit_cost": "Unit Cost — Prepaid ($/credit)",
      "compensation.payroll.owner": "Payroll — Owner / Director",
      "compensation.payroll.developer": "Payroll — Developer",
      "compensation.payroll.backend_auditor": "Payroll — Backend Auditor",
      "compensation.payroll.legal": "Payroll — Legal Counsel",
      "compensation.payroll.marketing": "Payroll — Marketing / Growth",
      "compensation.benefits.owner": "Benefits — Owner / Director",
      "compensation.benefits.developer": "Benefits — Developer",
      "compensation.benefits.backend_auditor": "Benefits — Backend Auditor",
      "compensation.benefits.legal": "Benefits — Legal Counsel",
      "compensation.benefits.marketing": "Benefits — Marketing / Growth",
      "startup.legal_formation": "Startup — Legal Formation",
      "startup.insurance_deposit": "Startup — Insurance Deposit",
      "startup.domain_branding": "Startup — Domain & Branding",
      "startup.research": "Startup — Research & Planning",
      "startup.software_tools": "Startup — Software & Tools",
      "revenue_projections.token": "Rev. Projection — Token",
      "revenue_projections.subscription": "Rev. Projection — Subscription",
      "revenue_projections.ad": "Rev. Projection — Ad",
    };
    const fieldKey = parts.slice(0, -1).join(".");
    return `${labelMap[fieldKey] || fieldKey} — ${month}`;
  };

  // Computed rows
  const totalRevenue = sumArrays(data.revenue.token, data.revenue.subscription, data.revenue.ad);
  const totalCOGS = sumArrays(data.cogs.hosting, data.cogs.licenses, data.cogs.merchant_fees);
  const grossProfit = totalRevenue.map((r, i) => r - totalCOGS[i]);
  const totalSelling = sumArrays(...Object.values(data.selling));
  const totalGA = sumArrays(...Object.values(data.ga));
  const totalWages = sumArrays(...Object.values(data.wages));
  const totalOps = sumArrays(...Object.values(data.operations));
  const totalExpense = sumArrays(totalSelling, totalGA, totalWages, totalOps);
  const netOrdinaryIncome = grossProfit.map((g, i) => g - totalExpense[i]);
  const totalOtherIncome = data.other_income.interest;
  const totalOtherExpense = data.other_expenses.bank_fees;
  const netIncome = netOrdinaryIncome.map((n, i) => n + totalOtherIncome[i] - totalOtherExpense[i]);
  const netCash = sumArrays(data.cashflow.carryover, data.cashflow.investment, data.cashflow.operations_cf);
  const totalPayroll = sumArrays(...Object.values(data.compensation.payroll));
  const totalBenefits = sumArrays(...Object.values(data.compensation.benefits));
  const totalCompensation = sumArrays(totalPayroll, totalBenefits);
  const devCredits = data.development?.lovable_credits || zeros();
  const devUnitCost = data.development?.lovable_unit_cost || zeros();
  const devPrepaidCredits = data.development?.lovable_prepaid_credits || zeros();
  const devPrepaidUnitCost = data.development?.lovable_prepaid_unit_cost || zeros();
  const totalDevCostOD = devCredits.map((c, i) => Math.round(c * (devUnitCost[i] || 0)));
  const totalDevCostPP = devPrepaidCredits.map((c, i) => Math.round(c * (devPrepaidUnitCost[i] || 0)));
  const totalDevCost = totalDevCostOD.map((v, i) => v + totalDevCostPP[i]);
  const devSavings = devCredits.map((c, i) => {
    const allOnDemand = (c + devPrepaidCredits[i]) * (devUnitCost[i] || 0);
    return Math.round(allOnDemand - (totalDevCostOD[i] + totalDevCostPP[i]));
  });
  const startupData = data.startup || projectedStartupCosts();
  const totalStartup = sumArrays(
    startupData.legal_formation || zeros(),
    startupData.insurance_deposit || zeros(),
    startupData.domain_branding || zeros(),
    startupData.research || zeros(),
    startupData.software_tools || zeros(),
  );
  const revProj = data.revenue_projections || defaultRevenueProjections();
  const totalRevProj = sumArrays(revProj.token, revProj.subscription, revProj.ad);

  // Check if compensation is all zeros (needs projections applied)
  const compAllZeros = Object.values(data.compensation.payroll).every(arr => arr.every(v => v === 0));

  const applyProjections = () => {
    const proj = projectedMonthlySalaries();
    update(d => {
      const comp = { payroll: { ...d.compensation.payroll }, benefits: { ...d.compensation.benefits } };
      for (const role of ["owner", "developer", "backend_auditor", "legal", "marketing"] as const) {
        comp.payroll[role] = (comp.payroll[role] || zeros()).map((v, i) => v === 0 ? proj.payroll[role][i] : v);
        comp.benefits[role] = (comp.benefits[role] || zeros()).map((v, i) => v === 0 ? proj.benefits[role][i] : v);
      }
      const next = { ...d, compensation: comp };
      if (!next.startup) next.startup = projectedStartupCosts();
      return next;
    });
    toast.success("Salary projections applied to empty cells");
  };

  // Annual compensation per role
  const roleKeys = ["owner", "developer", "backend_auditor", "legal", "marketing"] as const;
  const roleLabels: Record<string, string> = {
    owner: "Owner / Company Director",
    developer: "Developer (Lovable / Frontend)",
    backend_auditor: "Backend Auditor / Security",
    legal: "Legal Counsel (Lawyer)",
    marketing: "Marketing / Growth",
  };
  const annualCompByRole = roleKeys.map(k => ({
    label: roleLabels[k],
    payroll: sumArr((data.compensation.payroll as any)[k] || zeros()),
    benefits: sumArr((data.compensation.benefits as any)[k] || zeros()),
    get total() { return this.payroll + this.benefits; },
  }));
  const annualTotalComp = annualCompByRole.reduce((s, r) => s + r.total, 0);

  const pullLiveData = async () => {
    setPulling(true);
    try {
      const year = data.year;
      const startDate = `${year}-01-01`;
      const endDate = `${year + 1}-01-01`;

      const [purchasesRes, aiUsageRes, judgeUsageRes, adSlotsRes, settingsRes] = await Promise.all([
        supabase.from("purchases").select("price_cents, created_at").gte("created_at", startDate).lt("created_at", endDate).eq("status", "completed"),
        supabase.from("ai_usage_log").select("estimated_cost_cents, created_at").gte("created_at", startDate).lt("created_at", endDate),
        supabase.from("judge_usage_log").select("estimated_cost_cents, created_at").gte("created_at", startDate).lt("created_at", endDate),
        supabase.from("festival_ad_slots").select("bid_amount_cents, created_at").gte("created_at", startDate).lt("created_at", endDate).eq("status", "active"),
        supabase.from("site_settings" as any).select("key, text_value").in("key", ["lovable_credits_used", "lovable_cost_per_credit"]),
      ]);

      const groupByMonth = (rows: any[] | null, field: string): number[] => {
        const m = zeros();
        (rows || []).forEach(r => {
          const month = new Date(r.created_at).getMonth();
          m[month] += Math.round(Number(r[field] || 0) / 100);
        });
        return m;
      };

      const tokenRev = groupByMonth(purchasesRes.data, "price_cents");
      const aiCosts = groupByMonth(aiUsageRes.data, "estimated_cost_cents");
      const judgeCosts = groupByMonth(judgeUsageRes.data, "estimated_cost_cents");
      const adRev = groupByMonth(adSlotsRes.data, "bid_amount_cents");

      update(d => {
        const next = { ...d };
        next.revenue = { ...d.revenue };
        next.cogs = { ...d.cogs };
        next.revenue.token = d.revenue.token.map((v, i) => v === 0 ? tokenRev[i] : v);
        next.revenue.ad = d.revenue.ad.map((v, i) => v === 0 ? adRev[i] : v);
        const combinedAICosts = aiCosts.map((v, i) => v + judgeCosts[i]);
        next.cogs.hosting = d.cogs.hosting.map((v, i) => v === 0 ? combinedAICosts[i] : v);
        const newTotalRev = sumArrays(next.revenue.token, next.revenue.subscription, next.revenue.ad);
        next.cogs.merchant_fees = d.cogs.merchant_fees.map((v, i) => v === 0 ? Math.round(newTotalRev[i] * 0.029) : v);

        const sArr = (settingsRes.data as any[]) || [];
        const totalCredits = Number(sArr.find((s: any) => s.key === "lovable_credits_used")?.text_value || 0);
        const unitCost = Number(sArr.find((s: any) => s.key === "lovable_cost_per_credit")?.text_value || 0);
        const currentMonth = new Date().getMonth();
        if (!next.development) next.development = { lovable_credits: zeros(), lovable_unit_cost: zeros(), lovable_prepaid_credits: zeros(), lovable_prepaid_unit_cost: zeros() };
        next.development = { ...next.development };
        next.development.lovable_credits = (d.development?.lovable_credits || zeros()).map((v, i) => v === 0 && i === currentMonth ? totalCredits : v);
        next.development.lovable_unit_cost = (d.development?.lovable_unit_cost || zeros()).map((v, i) => v === 0 && i === currentMonth ? Math.round(unitCost * 100) / 100 : v);

        return next;
      });

      toast.success("Live data pulled successfully");
    } catch (err) {
      toast.error("Failed to pull live data");
    } finally {
      setPulling(false);
    }
  };

  const exportDocx = async () => {
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) { toast.error("Not authenticated"); return; }

      const res = await supabase.functions.invoke("export-document", {
        body: { document_id: doc.id, format: "proforma-docx" },
      });

      if (res.error) throw res.error;
      const { base64, filename } = res.data;
      const byteChars = atob(base64);
      const byteNums = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
      const blob = new Blob([new Uint8Array(byteNums)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "ProForma.docx";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Exported to .docx — open in Google Docs!");
    } catch {
      toast.error("Export failed");
    }
  };

  type RowDef = { label: string; section?: string; key?: string; computed?: number[]; bold?: boolean; header?: boolean; compSub?: "payroll" | "benefits" };

  const rows: RowDef[] = [
    { label: "REVENUE", header: true },
    { label: "Token Revenue", section: "revenue", key: "token" },
    { label: "Subscription Revenue", section: "revenue", key: "subscription" },
    { label: "Ad Revenue", section: "revenue", key: "ad" },
    { label: "Total Revenue", computed: totalRevenue, bold: true },

    { label: "COST OF GOODS SOLD", header: true },
    { label: "Hosting / AI Infra", section: "cogs", key: "hosting" },
    { label: "Licenses", section: "cogs", key: "licenses" },
    { label: "Merchant Fees (2.9%)", section: "cogs", key: "merchant_fees" },
    { label: "Total COGS", computed: totalCOGS, bold: true },

    { label: "GROSS PROFIT", computed: grossProfit, bold: true, header: true },

    { label: "SELLING EXPENSES", header: true },
    { label: "Ad Spend", section: "selling", key: "ad_spend" },
    { label: "Design", section: "selling", key: "design" },
    { label: "Development", section: "selling", key: "development" },
    { label: "Marketing", section: "selling", key: "marketing" },
    { label: "Travel", section: "selling", key: "travel" },
    { label: "Meals & Entertainment", section: "selling", key: "meals" },
    { label: "Equipment", section: "selling", key: "equipment" },
    { label: "Website / Email", section: "selling", key: "website_email" },
    { label: "Total Selling", computed: totalSelling, bold: true },

    { label: "G&A EXPENSES", header: true },
    { label: "Office Supplies", section: "ga", key: "office" },
    { label: "Legal & Accounting", section: "ga", key: "legal" },
    { label: "Rent", section: "ga", key: "rent" },
    { label: "Utilities", section: "ga", key: "utilities" },
    { label: "Business Insurance / E&O", section: "ga", key: "insurance" },
    { label: "Subscriptions / SaaS", section: "ga", key: "subscriptions" },
    { label: "Telephone", section: "ga", key: "telephone" },
    { label: "Total G&A", computed: totalGA, bold: true },

    { label: "WAGES & BENEFITS", header: true },
    { label: "401(k) Match", section: "wages", key: "four01k" },
    { label: "Bonus", section: "wages", key: "bonus" },
    { label: "Contractor", section: "wages", key: "contractor" },
    { label: "Payroll Taxes", section: "wages", key: "payroll_taxes" },
    { label: "Unemployment Tax", section: "wages", key: "unemployment" },
    { label: "Total Wages", computed: totalWages, bold: true },

    { label: "OPERATIONS", header: true },
    { label: "Equipment / Computers", section: "operations", key: "equipment_computers" },
    { label: "Repairs & Maintenance", section: "operations", key: "repairs" },
    { label: "Total Operations", computed: totalOps, bold: true },

    { label: "TOTAL EXPENSE", computed: totalExpense, bold: true, header: true },
    { label: "NET ORDINARY INCOME", computed: netOrdinaryIncome, bold: true, header: true },

    { label: "OTHER INCOME", header: true },
    { label: "Interest Income", section: "other_income", key: "interest" },
    { label: "OTHER EXPENSES", header: true },
    { label: "Bank Fees", section: "other_expenses", key: "bank_fees" },

    { label: "NET INCOME", computed: netIncome, bold: true, header: true },

    { label: "CASH FLOW", header: true },
    { label: "Cash Carryover", section: "cashflow", key: "carryover" },
    { label: "Investment / Funding", section: "cashflow", key: "investment" },
    { label: "Operations Cash", section: "cashflow", key: "operations_cf" },
    { label: "Net Cash Position", computed: netCash, bold: true },

    { label: "STARTUP COSTS (PRE-LAUNCH)", header: true },
    { label: "Legal Formation", section: "startup", key: "legal_formation" },
    { label: "Business Insurance (Startup)", section: "startup", key: "insurance_deposit" },
    { label: "Domain & Branding", section: "startup", key: "domain_branding" },
    { label: "Research & Planning", section: "startup", key: "research" },
    { label: "Software & Tools", section: "startup", key: "software_tools" },
    { label: "Total Startup Costs", computed: totalStartup, bold: true },

    { label: "DEVELOPMENT COSTS", header: true },
    { label: "Credits (On-Demand)", section: "development", key: "lovable_credits" },
    { label: "Unit Cost — On-Demand ($/cr)", section: "development", key: "lovable_unit_cost" },
    { label: "On-Demand Cost", computed: totalDevCostOD, bold: false },
    { label: "Credits (Prepaid)", section: "development", key: "lovable_prepaid_credits" },
    { label: "Unit Cost — Prepaid ($/cr)", section: "development", key: "lovable_prepaid_unit_cost" },
    { label: "Prepaid Cost", computed: totalDevCostPP, bold: false },
    { label: "Total Dev Cost", computed: totalDevCost, bold: true },
    { label: "Prepaid Savings", computed: devSavings, bold: true },

    { label: "REVENUE PROJECTIONS (TARGETS)", header: true },
    { label: "Token Revenue Target", section: "revenue_projections", key: "token" },
    { label: "Subscription Revenue Target", section: "revenue_projections", key: "subscription" },
    { label: "Ad Revenue Target", section: "revenue_projections", key: "ad" },
    { label: "Total Revenue Target", computed: totalRevProj, bold: true },

    { label: "COMPENSATION — PAYROLL", header: true },
    { label: "Owner / Company Director", section: "compensation", key: "owner", compSub: "payroll" },
    { label: "Developer (Lovable / Frontend)", section: "compensation", key: "developer", compSub: "payroll" },
    { label: "Backend Auditor / Security", section: "compensation", key: "backend_auditor", compSub: "payroll" },
    { label: "Legal Counsel (Lawyer)", section: "compensation", key: "legal", compSub: "payroll" },
    { label: "Marketing / Growth", section: "compensation", key: "marketing", compSub: "payroll" },
    { label: "Total Payroll", computed: totalPayroll, bold: true },

    { label: "COMPENSATION — BENEFITS", header: true },
    { label: "Owner / Company Director", section: "compensation", key: "owner", compSub: "benefits" },
    { label: "Developer (Lovable / Frontend)", section: "compensation", key: "developer", compSub: "benefits" },
    { label: "Backend Auditor / Security", section: "compensation", key: "backend_auditor", compSub: "benefits" },
    { label: "Legal Counsel (Lawyer)", section: "compensation", key: "legal", compSub: "benefits" },
    { label: "Marketing / Growth", section: "compensation", key: "marketing", compSub: "benefits" },
    { label: "Total Benefits", computed: totalBenefits, bold: true },
    { label: "TOTAL COMPENSATION", computed: totalCompensation, bold: true, header: true },
  ];

  const getValues = (row: RowDef): number[] => {
    if (row.computed) return row.computed;
    if (row.compSub && row.key) return (data.compensation[row.compSub] as any)[row.key] || zeros();
    if (row.section && row.key) return ((data as any)[row.section]?.[row.key]) || zeros();
    return zeros();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
          )}
          <h3 className="font-display text-lg font-bold">{doc.title}</h3>
          <Badge variant="outline" className="font-mono text-[10px]">FY {data.year}</Badge>
          {saving && <Badge variant="secondary" className="text-[10px] animate-pulse"><Save className="h-3 w-3 mr-1" />Saving…</Badge>}
        </div>
        <div className="flex gap-2">
          <Button variant={showLog ? "default" : "outline"} size="sm" onClick={() => setShowLog(!showLog)}>
            <History className="h-3.5 w-3.5 mr-1" /> Change Log
          </Button>
          <Button variant="outline" size="sm" onClick={pullLiveData} disabled={pulling}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${pulling ? "animate-spin" : ""}`} /> Pull Live Data
          </Button>
          <Button variant="outline" size="sm" onClick={exportDocx}>
            <Download className="h-3.5 w-3.5 mr-1" /> Export to Docs
          </Button>
          <Button size="sm" onClick={() => save(data)}><Save className="h-3.5 w-3.5 mr-1" /> Save</Button>
          {compAllZeros && (
            <Button variant="secondary" size="sm" onClick={applyProjections}>
              <Zap className="h-3.5 w-3.5 mr-1" /> Apply Salary Projections
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/50">
        <table className="w-full text-xs border-collapse min-w-[1100px]">
          <thead>
            <tr className="bg-muted/60">
              <th className="text-left px-2 py-1.5 font-mono font-semibold sticky left-0 bg-muted/60 min-w-[180px] z-10">Line Item</th>
              {MONTHS.map(m => (
                <th key={m} className="text-right px-1 py-1.5 font-mono font-semibold w-[72px]">{m}</th>
              ))}
              <th className="text-right px-2 py-1.5 font-mono font-bold w-[85px] bg-muted/80">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const isHeader = row.header && !row.computed;
              const isComputedHeader = row.header && !!row.computed;
              const vals = getValues(row);
              const total = sumArr(vals);
              const isEditable = !row.computed && !row.header;

              if (isHeader && !row.computed) {
                return (
                  <tr key={ri} className="bg-muted/40 border-t border-border/30">
                    <td colSpan={14} className="px-2 py-1.5 font-mono font-bold text-[11px] text-muted-foreground tracking-wide">{row.label}</td>
                  </tr>
                );
              }

              return (
                <tr
                  key={ri}
                  className={`border-t border-border/20 ${isComputedHeader ? "bg-primary/5 border-t-2 border-primary/20" : row.bold ? "bg-muted/20" : ri % 2 === 0 ? "bg-background" : "bg-muted/10"}`}
                >
                  <td className={`px-2 py-1 sticky left-0 z-10 ${isComputedHeader ? "bg-primary/5 font-bold text-primary" : row.bold ? "bg-muted/20 font-semibold" : ri % 2 === 0 ? "bg-background" : "bg-muted/10"}`}>
                    {row.label}
                  </td>
                  {vals.map((v, mi) => (
                    <td key={mi} className="px-0.5 py-0.5">
                      {isEditable ? (
                        <Cell
                          value={v}
                          onChange={(nv) => {
                            if (row.compSub && row.key) setCompCell(row.compSub, row.key, mi, nv);
                            else if (row.section && row.key) setCell(row.section, row.key, mi, nv);
                          }}
                        />
                      ) : (
                        <ReadonlyCell value={v} bold={row.bold} />
                      )}
                    </td>
                  ))}
                  <td className={`px-1 py-0.5 bg-muted/30 ${row.bold ? "font-bold" : ""}`}>
                    <ReadonlyCell value={total} bold={row.bold} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Change Log Panel */}
      {showLog && (
        <div className="rounded-xl border border-border/50 bg-card/80 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-display text-sm font-bold flex items-center gap-2">
              <History className="h-4 w-4 text-primary" /> Change Log
            </h4>
            <Button variant="ghost" size="sm" onClick={loadChangeLog} disabled={logLoading}>
              <RefreshCw className={`h-3 w-3 ${logLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <ScrollArea className="h-[280px]">
            {changeLog.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No changes recorded yet.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="text-left py-1.5 px-2 font-mono text-muted-foreground">Timestamp</th>
                    <th className="text-left py-1.5 px-2 font-mono text-muted-foreground">Field</th>
                    <th className="text-right py-1.5 px-2 font-mono text-muted-foreground">Old</th>
                    <th className="text-right py-1.5 px-2 font-mono text-muted-foreground">New</th>
                  </tr>
                </thead>
                <tbody>
                  {changeLog.map((entry) => (
                    <tr key={entry.id} className="border-b border-border/10 hover:bg-muted/20">
                      <td className="py-1 px-2 font-mono text-muted-foreground whitespace-nowrap">
                        {new Date(entry.created_at).toLocaleString()}
                      </td>
                      <td className="py-1 px-2">{fieldPathToLabel(entry.field_path)}</td>
                      <td className="py-1 px-2 text-right font-mono text-destructive">
                        {fmt(entry.old_value ?? 0)}
                      </td>
                      <td className="py-1 px-2 text-right font-mono text-emerald-600">
                        {fmt(entry.new_value ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ScrollArea>
        </div>
      )}

      {/* Annual Compensation Summary */}
      {(() => {
        const annualRevenue = sumArr(totalRevenue);
        const pctOf = (v: number) => annualRevenue > 0 ? ((v / annualRevenue) * 100).toFixed(1) + "%" : "—";
        return (
          <div className="rounded-xl border border-border/50 bg-card/80 p-4 space-y-3">
            <h4 className="font-display text-sm font-bold">Annual Compensation Summary — FY {data.year}</h4>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="text-left py-1.5 px-2 font-mono text-muted-foreground">Role</th>
                  <th className="text-right py-1.5 px-2 font-mono text-muted-foreground">Annual Payroll</th>
                  <th className="text-right py-1.5 px-2 font-mono text-muted-foreground">Annual Benefits</th>
                  <th className="text-right py-1.5 px-2 font-mono text-muted-foreground">Total Cost</th>
                  <th className="text-right py-1.5 px-2 font-mono text-muted-foreground">% of Revenue</th>
                </tr>
              </thead>
              <tbody>
                {annualCompByRole.map((r) => (
                  <tr key={r.label} className="border-b border-border/10 hover:bg-muted/20">
                    <td className="py-1.5 px-2">{r.label}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{fmt(r.payroll)}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{fmt(r.benefits)}</td>
                    <td className="py-1.5 px-2 text-right font-mono font-bold">{fmt(r.total)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">{pctOf(r.total)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-primary/30 bg-muted/30">
                  <td className="py-2 px-2 font-bold">Grand Total</td>
                  <td className="py-2 px-2 text-right font-mono font-bold">
                    {fmt(annualCompByRole.reduce((s, r) => s + r.payroll, 0))}
                  </td>
                  <td className="py-2 px-2 text-right font-mono font-bold">
                    {fmt(annualCompByRole.reduce((s, r) => s + r.benefits, 0))}
                  </td>
                  <td className="py-2 px-2 text-right font-mono font-bold text-primary">
                    {fmt(annualTotalComp)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono font-bold text-primary">
                    {pctOf(annualTotalComp)}
                  </td>
                </tr>
              </tbody>
            </table>
            {annualRevenue === 0 && (
              <p className="text-[10px] text-muted-foreground">Revenue is $0 — percentage column will populate once revenue data is entered.</p>
            )}
          </div>
        );
      })()}

      {/* Budget Analysis — Projected vs. Actual */}
      {(() => {
        const proj = projectedMonthlySalaries();
        const projStartup = projectedStartupCosts();
        const sumSlice = (arr: number[], from: number, to: number) => arr.slice(from, to + 1).reduce((s, v) => s + v, 0);
        const sumObjSlice = (obj: Record<string, number[]>, from: number, to: number) =>
          Object.values(obj).reduce((s, arr) => s + sumSlice(arr, from, to), 0);
        const projTokenRevenue = revProj.token;
        const projSubRevenue = revProj.subscription;
        const projAdRevenue = revProj.ad;
        const projTotalRevenue = totalRevProj;

        const phases = [
          { label: "Pre-Launch (Jan–Feb)", from: 0, to: 1 },
          { label: "Operations (Mar–Dec)", from: 2, to: 11 },
          { label: "Full Year", from: 0, to: 11 },
        ];


        const revenueCategories = [
          {
            label: "Token Revenue",
            projected: (from: number, to: number) => sumSlice(projTokenRevenue, from, to),
            actual: (from: number, to: number) => sumSlice(data.revenue.token, from, to),
            isRevenue: true,
          },
          {
            label: "Subscription Revenue",
            projected: (from: number, to: number) => sumSlice(projSubRevenue, from, to),
            actual: (from: number, to: number) => sumSlice(data.revenue.subscription, from, to),
            isRevenue: true,
          },
          {
            label: "Ad Revenue",
            projected: (from: number, to: number) => sumSlice(projAdRevenue, from, to),
            actual: (from: number, to: number) => sumSlice(data.revenue.ad, from, to),
            isRevenue: true,
          },
        ];

        const expenseCategories = [
          {
            label: "Total Compensation",
            projected: (from: number, to: number) => sumObjSlice(proj.payroll, from, to) + sumObjSlice(proj.benefits, from, to),
            actual: (from: number, to: number) => sumSlice(totalCompensation, from, to),
          },
          {
            label: "Startup Costs",
            projected: (from: number, to: number) => sumObjSlice(projStartup, from, to),
            actual: (from: number, to: number) => sumSlice(totalStartup, from, to),
          },
          {
            label: "Development Costs",
            projected: () => 0,
            actual: (from: number, to: number) => sumSlice(totalDevCost, from, to),
          },
          {
            label: "G&A Expenses",
            projected: (from: number, to: number) => sumSlice(Array(12).fill(500), from, to),
            actual: (from: number, to: number) => sumSlice(totalGA, from, to),
          },
          {
            label: "Payroll Taxes",
            projected: (from: number, to: number) => sumSlice(Array(12).fill(2372), from, to),
            actual: (from: number, to: number) => sumSlice(data.wages.payroll_taxes, from, to),
          },
        ];

        return (
          <div className="rounded-xl border border-border/50 bg-card/80 p-4 space-y-3">
            <h4 className="font-display text-sm font-bold">Budget Analysis — Projected vs. Actual — FY {data.year}</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="text-left py-1.5 px-2 font-mono text-muted-foreground">Category</th>
                    {phases.map(p => (
                      <th key={p.label} colSpan={4} className="text-center py-1.5 px-1 font-mono text-muted-foreground border-l border-border/20">{p.label}</th>
                    ))}
                  </tr>
                  <tr className="border-b border-border/20">
                    <th />
                    {phases.map(p => (
                      <>
                        <th key={`${p.label}-p`} className="text-right py-1 px-1 font-mono text-muted-foreground text-[10px] border-l border-border/20">Projected</th>
                        <th key={`${p.label}-a`} className="text-right py-1 px-1 font-mono text-muted-foreground text-[10px]">Actual</th>
                        <th key={`${p.label}-v`} className="text-right py-1 px-1 font-mono text-muted-foreground text-[10px]">Var ($)</th>
                        <th key={`${p.label}-vp`} className="text-right py-1 px-1 font-mono text-muted-foreground text-[10px]">Var (%)</th>
                      </>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Revenue section header */}
                  <tr className="bg-muted/40 border-t border-border/30">
                    <td colSpan={1 + phases.length * 4} className="px-2 py-1 font-mono font-bold text-[11px] text-muted-foreground tracking-wide">REVENUE</td>
                  </tr>
                  {revenueCategories.map(cat => (
                    <tr key={cat.label} className="border-b border-border/10 hover:bg-muted/20">
                      <td className="py-1.5 px-2 font-medium">{cat.label}</td>
                      {phases.map(p => {
                        const pv = cat.projected(p.from, p.to);
                        const av = cat.actual(p.from, p.to);
                        const variance = av - pv;
                        const variancePct = pv !== 0 ? ((variance / pv) * 100) : (av !== 0 ? 100 : 0);
                        // For revenue, positive variance (more income) is good
                        const colorClass = variance > 0 ? "text-primary" : variance < 0 ? "text-destructive" : "text-muted-foreground";
                        return (
                          <>
                            <td key={`${p.label}-p`} className="py-1.5 px-1 text-right font-mono border-l border-border/20">{fmt(pv)}</td>
                            <td key={`${p.label}-a`} className="py-1.5 px-1 text-right font-mono">{fmt(av)}</td>
                            <td key={`${p.label}-v`} className={`py-1.5 px-1 text-right font-mono font-bold ${colorClass}`}>{variance >= 0 ? "+" : ""}{fmt(variance)}</td>
                            <td key={`${p.label}-vp`} className={`py-1.5 px-1 text-right font-mono ${colorClass}`}>{variancePct >= 0 ? "+" : ""}{variancePct.toFixed(1)}%</td>
                          </>
                        );
                      })}
                    </tr>
                  ))}
                  {/* Total Revenue row */}
                  <tr className="border-t border-primary/20 bg-muted/20">
                    <td className="py-1.5 px-2 font-bold">Total Revenue</td>
                    {phases.map(p => {
                      const pv = sumSlice(projTotalRevenue, p.from, p.to);
                      const av = sumSlice(totalRevenue, p.from, p.to);
                      const variance = av - pv;
                      const variancePct = pv !== 0 ? ((variance / pv) * 100) : (av !== 0 ? 100 : 0);
                      const colorClass = variance > 0 ? "text-primary" : variance < 0 ? "text-destructive" : "text-muted-foreground";
                      return (
                        <>
                          <td key={`${p.label}-rtp`} className="py-1.5 px-1 text-right font-mono font-bold border-l border-border/20">{fmt(pv)}</td>
                          <td key={`${p.label}-rta`} className="py-1.5 px-1 text-right font-mono font-bold">{fmt(av)}</td>
                          <td key={`${p.label}-rtv`} className={`py-1.5 px-1 text-right font-mono font-bold ${colorClass}`}>{variance >= 0 ? "+" : ""}{fmt(variance)}</td>
                          <td key={`${p.label}-rtvp`} className={`py-1.5 px-1 text-right font-mono font-bold ${colorClass}`}>{variancePct >= 0 ? "+" : ""}{variancePct.toFixed(1)}%</td>
                        </>
                      );
                    })}
                  </tr>

                  {/* Expenses section header */}
                  <tr className="bg-muted/40 border-t border-border/30">
                    <td colSpan={1 + phases.length * 4} className="px-2 py-1 font-mono font-bold text-[11px] text-muted-foreground tracking-wide">EXPENSES</td>
                  </tr>
                  {expenseCategories.map(cat => (
                    <tr key={cat.label} className="border-b border-border/10 hover:bg-muted/20">
                      <td className="py-1.5 px-2 font-medium">{cat.label}</td>
                      {phases.map(p => {
                        const pv = cat.projected(p.from, p.to);
                        const av = cat.actual(p.from, p.to);
                        const variance = av - pv;
                        const variancePct = pv !== 0 ? ((variance / pv) * 100) : (av !== 0 ? 100 : 0);
                        const colorClass = variance > 0 ? "text-destructive" : variance < 0 ? "text-primary" : "text-muted-foreground";
                        return (
                          <>
                            <td key={`${p.label}-p`} className="py-1.5 px-1 text-right font-mono border-l border-border/20">{fmt(pv)}</td>
                            <td key={`${p.label}-a`} className="py-1.5 px-1 text-right font-mono">{fmt(av)}</td>
                            <td key={`${p.label}-v`} className={`py-1.5 px-1 text-right font-mono font-bold ${colorClass}`}>{variance >= 0 ? "+" : ""}{fmt(variance)}</td>
                            <td key={`${p.label}-vp`} className={`py-1.5 px-1 text-right font-mono ${colorClass}`}>{variancePct >= 0 ? "+" : ""}{variancePct.toFixed(1)}%</td>
                          </>
                        );
                      })}
                    </tr>
                  ))}
                  {/* Total Spending row */}
                  <tr className="border-t border-primary/20 bg-muted/20">
                    <td className="py-1.5 px-2 font-bold">Total Expenses</td>
                    {phases.map(p => {
                      const pv = expenseCategories.reduce((s, c) => s + c.projected(p.from, p.to), 0);
                      const av = expenseCategories.reduce((s, c) => s + c.actual(p.from, p.to), 0);
                      const variance = av - pv;
                      const variancePct = pv !== 0 ? ((variance / pv) * 100) : (av !== 0 ? 100 : 0);
                      const colorClass = variance > 0 ? "text-destructive" : variance < 0 ? "text-primary" : "text-muted-foreground";
                      return (
                        <>
                          <td key={`${p.label}-etp`} className="py-1.5 px-1 text-right font-mono font-bold border-l border-border/20">{fmt(pv)}</td>
                          <td key={`${p.label}-eta`} className="py-1.5 px-1 text-right font-mono font-bold">{fmt(av)}</td>
                          <td key={`${p.label}-etv`} className={`py-1.5 px-1 text-right font-mono font-bold ${colorClass}`}>{variance >= 0 ? "+" : ""}{fmt(variance)}</td>
                          <td key={`${p.label}-etvp`} className={`py-1.5 px-1 text-right font-mono font-bold ${colorClass}`}>{variancePct >= 0 ? "+" : ""}{variancePct.toFixed(1)}%</td>
                        </>
                      );
                    })}
                  </tr>

                  {/* Net Income row */}
                  <tr className="border-t-2 border-primary/30 bg-primary/5">
                    <td className="py-2 px-2 font-bold text-primary">Net Income (Rev − Exp)</td>
                    {phases.map(p => {
                      const projRev = sumSlice(projTotalRevenue, p.from, p.to);
                      const projExp = expenseCategories.reduce((s, c) => s + c.projected(p.from, p.to), 0);
                      const pv = projRev - projExp;
                      const actRev = sumSlice(totalRevenue, p.from, p.to);
                      const actExp = expenseCategories.reduce((s, c) => s + c.actual(p.from, p.to), 0);
                      const av = actRev - actExp;
                      const variance = av - pv;
                      const variancePct = pv !== 0 ? ((variance / Math.abs(pv)) * 100) : (av !== 0 ? 100 : 0);
                      const colorClass = variance > 0 ? "text-primary" : variance < 0 ? "text-destructive" : "text-muted-foreground";
                      return (
                        <>
                          <td key={`${p.label}-nip`} className="py-2 px-1 text-right font-mono font-bold border-l border-border/20">{fmt(pv)}</td>
                          <td key={`${p.label}-nia`} className="py-2 px-1 text-right font-mono font-bold">{fmt(av)}</td>
                          <td key={`${p.label}-niv`} className={`py-2 px-1 text-right font-mono font-bold ${colorClass}`}>{variance >= 0 ? "+" : ""}{fmt(variance)}</td>
                          <td key={`${p.label}-nivp`} className={`py-2 px-1 text-right font-mono font-bold ${colorClass}`}>{variancePct >= 0 ? "+" : ""}{variancePct.toFixed(1)}%</td>
                        </>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground">
              <span className="text-primary">■</span> Favorable (under budget / above revenue target) &nbsp;
              <span className="text-destructive">■</span> Unfavorable (over budget / below revenue target) &nbsp;
              Revenue projections assume gradual ramp from Mar launch: Token ($500→$2K/mo), Subscription ($57→$380/mo), Ad ($50→$150/mo Q3+).
            </p>
          </div>
        );
      })()}

      {/* Monthly Burn Rate Chart */}
      {(() => {
        const projComp = projectedMonthlySalaries();
        const projStart = projectedStartupCosts();
        const projCompMonth = MONTHS.map((_, i) =>
          Object.values(projComp.payroll).reduce((s, a) => s + a[i], 0) +
          Object.values(projComp.benefits).reduce((s, a) => s + a[i], 0)
        );
        const projStartMonth = MONTHS.map((_, i) =>
          Object.values(projStart).reduce((s, a) => s + a[i], 0)
        );
        const projGAMonth = Array(12).fill(500);
        const projTaxMonth = Array(12).fill(2372);


        const chartData = MONTHS.map((m, i) => {
          const projExpense = projCompMonth[i] + projStartMonth[i] + projGAMonth[i] + projTaxMonth[i];
          const actExpense = totalCompensation[i] + totalStartup[i] + totalGA[i] + (data.wages.payroll_taxes[i] || 0) + totalDevCost[i];
          const projRev = revProj.token[i] + revProj.subscription[i] + revProj.ad[i];
          const actRev = totalRevenue[i];
          return {
            month: m,
            projectedExpense: projExpense,
            actualExpense: actExpense,
            projectedRevenue: projRev,
            actualRevenue: actRev,
            projectedNet: projRev - projExpense,
            actualNet: actRev - actExpense,
          };
        });

        // Cumulative burn
        let cumProjBurn = 0;
        let cumActBurn = 0;
        const cumData = chartData.map(d => {
          cumProjBurn += d.projectedExpense - d.projectedRevenue;
          cumActBurn += d.actualExpense - d.actualRevenue;
          return { ...d, cumProjectedBurn: cumProjBurn, cumActualBurn: cumActBurn };
        });

        // Find projected break-even: first month where cumulative burn starts decreasing (monthly revenue > expenses)
        // i.e., the first month where projected revenue >= projected expense
        const projBreakEvenIdx = chartData.findIndex(d => d.projectedRevenue >= d.projectedExpense);
        const projBreakEvenMonth = projBreakEvenIdx >= 0 ? MONTHS[projBreakEvenIdx] : null;

        return (
          <div className="rounded-xl border border-border/50 bg-card/80 p-4 space-y-4">
            <h4 className="font-display text-sm font-bold">Monthly Burn Rate — FY {data.year}</h4>
            {projBreakEvenMonth && (
              <p className="text-xs text-muted-foreground">
                📍 Projected monthly break-even: <span className="font-bold text-primary">{projBreakEvenMonth} {data.year}</span> — the first month where projected revenue ≥ projected expenses.
              </p>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Monthly Expenses vs Revenue */}
              <div className="space-y-2">
                <p className="text-[11px] font-mono text-muted-foreground font-semibold">Monthly Expenses vs Revenue</p>
                <div className="h-[220px]">
                  <BurnChart data={cumData} type="monthly" />
                </div>
              </div>
              {/* Cumulative Burn */}
              <div className="space-y-2">
                <p className="text-[11px] font-mono text-muted-foreground font-semibold">Cumulative Net Burn (Expenses − Revenue)</p>
                <div className="h-[220px]">
                  <BurnChart data={cumData} type="cumulative" breakEvenMonth={projBreakEvenMonth} />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-4 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-primary inline-block rounded" /> Projected</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-destructive inline-block rounded" /> Actual Expense</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block rounded" style={{ backgroundColor: "hsl(var(--accent-foreground))" }} /> Actual Revenue</span>
              <span className="flex items-center gap-1"><span className="w-3 h-1.5 bg-primary/20 inline-block rounded" /> Projected (bar)</span>
              <span className="flex items-center gap-1"><span className="w-3 h-1.5 bg-destructive/20 inline-block rounded" /> Actual (bar)</span>
            </div>
          </div>
        );
      })()}

      {/* ── Runway Calculator ── */}
      {(() => {
        // Available funds = sum of cashflow (carryover + investment + operations_cf) + cumulative net income
        const totalCashflow = sumArr(sumArrays(data.cashflow.carryover, data.cashflow.investment, data.cashflow.operations_cf));

        // Use the last 3 months with actual data to compute average burn rate
        const monthlyNet: number[] = MONTHS.map((_, i) => totalRevenue[i] - totalExpense[i]);
        const monthsWithActivity = monthlyNet.map((n, i) => ({ net: n, expense: totalExpense[i], idx: i })).filter(m => m.expense > 0);
        const trailingMonths = monthsWithActivity.slice(-3);

        const avgMonthlyBurn = trailingMonths.length > 0
          ? trailingMonths.reduce((s, m) => s + m.expense, 0) / trailingMonths.length
          : 0;
        const avgMonthlyRevenue = trailingMonths.length > 0
          ? trailingMonths.reduce((s, m) => s + totalRevenue[m.idx], 0) / trailingMonths.length
          : 0;
        const avgNetBurn = avgMonthlyBurn - avgMonthlyRevenue; // positive = losing money

        // Available cash = cash injected + cumulative actual net income up to current month
        const cumActualNet = sumArr(monthlyNet);
        const availableCash = totalCashflow + cumActualNet;

        // Runway in months
        const runwayMonths = avgNetBurn > 0 ? availableCash / avgNetBurn : availableCash > 0 ? Infinity : 0;
        const runwayDisplay = runwayMonths === Infinity ? "∞" : runwayMonths <= 0 ? "0" : runwayMonths.toFixed(1);

        // Severity
        const severity: "critical" | "warning" | "healthy" =
          runwayMonths <= 3 ? "critical" : runwayMonths <= 6 ? "warning" : "healthy";
        const severityConfig = {
          critical: { icon: AlertTriangle, color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/30", label: "Critical" },
          warning: { icon: TrendingDown, color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/30", label: "Caution" },
          healthy: { icon: CheckCircle, color: "text-primary", bg: "bg-primary/10", border: "border-primary/30", label: "Healthy" },
        }[severity];
        const SeverityIcon = severityConfig.icon;

        // Projected runway using projected burn
        const revProj2 = data.revenue_projections || defaultRevenueProjections();
        const projMonthlyExpense = (() => {
          const pc = projectedMonthlySalaries();
          const ps = projectedStartupCosts();
          return MONTHS.map((_, i) =>
            Object.values(pc.payroll).reduce((s, a) => s + a[i], 0) +
            Object.values(pc.benefits).reduce((s, a) => s + a[i], 0) +
            Object.values(ps).reduce((s, a) => s + a[i], 0) +
            500 + 2372 // GA + payroll taxes
          );
        })();
        const projMonthlyRev = MONTHS.map((_, i) => revProj2.token[i] + revProj2.subscription[i] + revProj2.ad[i]);
        const avgProjBurn = sumArr(projMonthlyExpense) / 12;
        const avgProjRev = sumArr(projMonthlyRev) / 12;
        const projNetBurn = avgProjBurn - avgProjRev;
        const projRunway = projNetBurn > 0 ? availableCash / projNetBurn : (availableCash > 0 ? Infinity : 0);
        const projRunwayDisplay = projRunway === Infinity ? "∞" : projRunway <= 0 ? "0" : projRunway.toFixed(1);

        return (
          <div className={`rounded-xl border ${severityConfig.border} bg-card/80 p-4 space-y-4`}>
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${severityConfig.bg}`}>
                <Fuel className={`h-5 w-5 ${severityConfig.color}`} />
              </div>
              <div>
                <h4 className="font-display text-sm font-bold">Cash Runway Calculator</h4>
                <p className="text-[11px] text-muted-foreground">Based on trailing {trailingMonths.length}-month average burn rate and available funds</p>
              </div>
              <Badge variant="outline" className={`ml-auto gap-1 ${severityConfig.color} ${severityConfig.border}`}>
                <SeverityIcon className="h-3 w-3" />
                {severityConfig.label}
              </Badge>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* Available Cash */}
              <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-1">
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Available Cash</p>
                <p className={`font-display text-xl font-bold ${availableCash < 0 ? "text-destructive" : "text-foreground"}`}>
                  {fmt(Math.round(availableCash))}
                </p>
                <p className="text-[9px] text-muted-foreground">Cashflow + net income</p>
              </div>

              {/* Avg Monthly Net Burn */}
              <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-1">
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Avg Net Burn/Mo</p>
                <p className={`font-display text-xl font-bold ${avgNetBurn > 0 ? "text-destructive" : "text-primary"}`}>
                  {avgNetBurn > 0 ? "-" : "+"}{fmt(Math.round(Math.abs(avgNetBurn)))}
                </p>
                <p className="text-[9px] text-muted-foreground">Expenses − revenue (trailing)</p>
              </div>

              {/* Actual Runway */}
              <div className={`rounded-lg border ${severityConfig.border} ${severityConfig.bg} p-3 space-y-1`}>
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Actual Runway</p>
                <p className={`font-display text-xl font-bold ${severityConfig.color}`}>
                  {runwayDisplay} <span className="text-xs font-body font-normal">months</span>
                </p>
                <p className="text-[9px] text-muted-foreground">At current burn rate</p>
              </div>

              {/* Projected Runway */}
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1">
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Projected Runway</p>
                <p className="font-display text-xl font-bold text-primary">
                  {projRunwayDisplay} <span className="text-xs font-body font-normal">months</span>
                </p>
                <p className="text-[9px] text-muted-foreground">Using budget projections</p>
              </div>
            </div>

            {/* Breakdown details */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px] font-mono">
              <div className="space-y-0.5">
                <p className="text-muted-foreground">Avg Monthly Expense</p>
                <p className="font-semibold">{fmt(Math.round(avgMonthlyBurn))}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-muted-foreground">Avg Monthly Revenue</p>
                <p className="font-semibold text-primary">{fmt(Math.round(avgMonthlyRevenue))}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-muted-foreground">Cashflow Injections</p>
                <p className="font-semibold">{fmt(totalCashflow)}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-muted-foreground">Cumulative Net</p>
                <p className={`font-semibold ${cumActualNet < 0 ? "text-destructive" : "text-primary"}`}>{fmt(Math.round(cumActualNet))}</p>
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground">
              Runway = Available Cash ÷ Avg Monthly Net Burn. Uses trailing {trailingMonths.length > 0 ? trailingMonths.length : "0"} months with activity.
              {severity === "critical" && " ⚠️ Less than 3 months of runway remaining — action required."}
              {severity === "warning" && " ⚡ Less than 6 months of runway — monitor closely."}
            </p>
          </div>
        );
      })()}
    </div>
  );
}
