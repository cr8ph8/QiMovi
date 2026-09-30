import { Card } from "@/components/ui/card";
import { CashBurnRecord, RunwayMilestone, EXPENSE_FIELDS, EXPENSE_LABELS, totalExpenses } from "@/hooks/useCashBurn";

interface Props {
  records: CashBurnRecord[];
  milestones: RunwayMilestone[];
  runwayMonths: number | null;
  monthlyRevenue: number;
}

function clamp(n: number, min = 0, max = 100) { return Math.max(min, Math.min(max, n)); }

export function Q2EStabilityScore({ records, milestones, runwayMonths, monthlyRevenue }: Props) {
  const sorted = [...records].sort((a, b) => a.month.localeCompare(b.month));
  const recent = sorted.slice(-3);
  const prior = sorted.slice(-6, -3);

  const runwayScore = runwayMonths === null ? 100 : clamp((runwayMonths / 18) * 100);

  const recRev = recent.reduce((s, r) => s + Number(r.revenue_collected || 0), 0);
  const priRev = prior.reduce((s, r) => s + Number(r.revenue_collected || 0), 0);
  const revGrowth = priRev > 0 ? (recRev - priRev) / priRev : recRev > 0 ? 1 : 0;
  const revenueGrowthScore = clamp(50 + revGrowth * 100);

  const recExp = recent.reduce((s, r) => s + totalExpenses(r), 0);
  const priExp = prior.reduce((s, r) => s + totalExpenses(r), 0);
  const expGrowth = priExp > 0 ? (recExp - priExp) / priExp : 0;
  const expenseControlScore = clamp(80 - expGrowth * 200);

  const total = milestones.length || 1;
  const completed = milestones.filter((m) => m.status === "complete").length;
  const milestoneScore = clamp((completed / total) * 100);

  const fundingReadinessScore = monthlyRevenue > 0 ? clamp(40 + Math.min(monthlyRevenue / 1000, 60)) : 30;

  const score = Math.round(
    runwayScore * 0.30 +
    revenueGrowthScore * 0.25 +
    expenseControlScore * 0.20 +
    milestoneScore * 0.15 +
    fundingReadinessScore * 0.10
  );

  const band =
    score >= 80 ? { label: "Stable / Scaling", color: "text-emerald-400" } :
    score >= 60 ? { label: "Promising / Needs Control", color: "text-amber-400" } :
    score >= 40 ? { label: "Risk Zone", color: "text-orange-400" } :
                  { label: "Critical", color: "text-red-400" };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">Q2E Business Stability Score</div>
          <div className={`text-3xl font-semibold ${band.color}`}>{score}</div>
          <div className={`text-xs ${band.color}`}>{band.label}</div>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Runway</span><span className="text-right tabular-nums">{Math.round(runwayScore)}</span>
          <span>Revenue growth</span><span className="text-right tabular-nums">{Math.round(revenueGrowthScore)}</span>
          <span>Expense control</span><span className="text-right tabular-nums">{Math.round(expenseControlScore)}</span>
          <span>Milestones</span><span className="text-right tabular-nums">{Math.round(milestoneScore)}</span>
          <span>Funding ready</span><span className="text-right tabular-nums">{Math.round(fundingReadinessScore)}</span>
        </div>
      </div>
    </Card>
  );
}
