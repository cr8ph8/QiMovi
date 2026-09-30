import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, TrendingDown, TrendingUp, Wallet, Clock, Activity } from "lucide-react";

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
}

const RISK_STYLES: Record<string, string> = {
  healthy: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  watch: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  critical: "bg-red-500/15 text-red-400 border-red-500/30",
  profitable: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

interface Props {
  currentCash: number;
  grossBurn: number;
  monthlyRevenue: number;
  netBurn: number;
  runwayMonths: number | null;
  risk: "healthy" | "watch" | "critical" | "profitable";
}

export function BurnSummaryCards({ currentCash, grossBurn, monthlyRevenue, netBurn, runwayMonths, risk }: Props) {
  const runwayLabel = runwayMonths === null ? "∞" : `${runwayMonths.toFixed(1)} mo`;
  const riskLabel = risk === "profitable" ? "Profitable / No burn" : risk[0].toUpperCase() + risk.slice(1);

  return (
    <div className="space-y-3">
      {risk === "critical" && runwayMonths !== null && runwayMonths < 3 && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4 mt-0.5" />
          <span>Immediate action required: reduce burn, close revenue, or secure funding.</span>
        </div>
      )}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        <SummaryCard icon={<Wallet className="h-4 w-4" />} label="Current cash" value={formatCurrency(currentCash)} />
        <SummaryCard icon={<TrendingDown className="h-4 w-4" />} label="Gross burn / mo" value={formatCurrency(grossBurn)} />
        <SummaryCard icon={<TrendingUp className="h-4 w-4" />} label="Revenue / mo" value={formatCurrency(monthlyRevenue)} />
        <SummaryCard icon={<Activity className="h-4 w-4" />} label="Net burn / mo" value={formatCurrency(netBurn)} />
        <SummaryCard icon={<Clock className="h-4 w-4" />} label="Runway" value={runwayLabel} />
        <Card className="p-4 flex flex-col gap-2">
          <div className="text-xs text-muted-foreground">Risk</div>
          <Badge className={`w-fit border ${RISK_STYLES[risk]}`} variant="outline">{riskLabel}</Badge>
        </Card>
      </div>
    </div>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="mt-2 text-xl font-semibold tracking-tight">{value}</div>
    </Card>
  );
}
