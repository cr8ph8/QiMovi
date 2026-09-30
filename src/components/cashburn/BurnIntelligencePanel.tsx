import { Card } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import { CashBurnRecord, RunwayMilestone, EXPENSE_FIELDS, EXPENSE_LABELS, totalExpenses } from "@/hooks/useCashBurn";
import { formatCurrency } from "./BurnSummaryCards";

interface Props {
  records: CashBurnRecord[];
  milestones: RunwayMilestone[];
  runwayMonths: number | null;
  netBurn: number;
  monthlyRevenue: number;
  scopeLabel: string;
}

export function BurnIntelligencePanel({ records, milestones, runwayMonths, netBurn, monthlyRevenue, scopeLabel }: Props) {
  const sorted = [...records].sort((a, b) => a.month.localeCompare(b.month));
  const recent = sorted.slice(-3);

  const driverTotals: Record<string, number> = {};
  for (const r of recent) {
    for (const f of EXPENSE_FIELDS) driverTotals[EXPENSE_LABELS[f]] = (driverTotals[EXPENSE_LABELS[f]] || 0) + Number((r as any)[f] || 0);
  }
  const drivers = Object.entries(driverTotals).sort((a, b) => b[1] - a[1]).slice(0, 3).filter(([, v]) => v > 0);

  const recExp = recent.reduce((s, r) => s + totalExpenses(r), 0);
  const recRev = recent.reduce((s, r) => s + Number(r.revenue_collected || 0), 0);
  const expensesGrowingFaster = recExp > recRev * 2 && recRev > 0;

  const upcomingMilestone = milestones
    .filter((m) => m.status !== "complete" && m.target_date)
    .sort((a, b) => (a.target_date! < b.target_date! ? -1 : 1))[0];

  const headline =
    runwayMonths === null
      ? `${scopeLabel} is currently profitable or has no active burn.`
      : `At the current burn rate, ${scopeLabel} has ${runwayMonths.toFixed(1)} months of runway.`;

  let recommendation = "";
  if (runwayMonths === null) {
    recommendation = "Reinvest a portion of profit into growth experiments (paid pilots, marketing, hiring).";
  } else if (runwayMonths < 3) {
    recommendation = "Critical: cut non-essential spend immediately and accelerate revenue or fundraising in the next 30 days.";
  } else if (runwayMonths < 6) {
    recommendation = "Prioritize closing paid pilots, raising a bridge round, or trimming the largest cost driver within 60 days.";
  } else if (runwayMonths < 12) {
    recommendation = expensesGrowingFaster
      ? "Expenses are outpacing revenue. Tighten contractor and AI spend before scaling marketing."
      : "You have working room — focus on revenue traction and a clear milestone before the next 6 months.";
  } else {
    recommendation = "Healthy runway. Use this window to ship the riskiest milestone and de-risk the fundraise narrative.";
  }

  if (upcomingMilestone) {
    recommendation += ` Most urgent milestone: "${upcomingMilestone.title}".`;
  }

  return (
    <Card className="p-4 space-y-3 bg-gradient-to-br from-amber-500/5 to-transparent border-amber-500/20">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="h-4 w-4 text-amber-400" /> Burn Intelligence
      </div>
      <p className="text-sm leading-relaxed">{headline} {recommendation}</p>
      {drivers.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Biggest cost drivers (last 3 months):{" "}
          {drivers.map(([name, value], i) => (
            <span key={name}>{i > 0 && " · "}<span className="text-foreground font-medium">{name}</span> {formatCurrency(value)}</span>
          ))}
        </div>
      )}
      <div className="text-xs text-muted-foreground">
        Net burn: <span className="text-foreground">{formatCurrency(netBurn)}/mo</span> · Revenue: <span className="text-foreground">{formatCurrency(monthlyRevenue)}/mo</span>
      </div>
    </Card>
  );
}
