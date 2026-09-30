import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, ResponsiveContainer, XAxis, Tooltip } from "recharts";
import { Cpu, DollarSign, Activity, CheckCircle2, XCircle } from "lucide-react";

interface SummaryCardsProps {
  loading: boolean;
  totalCalls: number;
  totalCostCents: number;
  totalTokens: number;
  activeCount: number;
  deadCount: number;
  sparklineAll: { day: string; calls: number }[];
}

export function SummaryCards({ loading, totalCalls, totalCostCents, totalTokens, activeCount, deadCount, sparklineAll }: SummaryCardsProps) {
  const cards = [
    { label: "Total AI Calls", value: loading ? "…" : String(totalCalls), icon: Cpu },
    { label: "Total Cost", value: loading ? "…" : `$${(totalCostCents / 100).toFixed(2)}`, icon: DollarSign },
    { label: "Tokens Consumed", value: loading ? "…" : `${(totalTokens / 1000).toFixed(1)}k`, icon: Activity },
    { label: "Active Features", value: String(activeCount), icon: CheckCircle2 },
    { label: "Dead / Unwired", value: String(deadCount), icon: XCircle },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((card) => (
        <div key={card.label} className="rounded-xl border border-border/50 bg-card/80 p-4">
          <div className="flex items-center gap-2 mb-2">
            <card.icon className="h-4 w-4 text-primary" />
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{card.label}</span>
          </div>
          {loading && card.label !== "Active Features" && card.label !== "Dead / Unwired" ? (
            <Skeleton className="h-7 w-16" />
          ) : (
            <p className="font-display text-xl font-bold">{card.value}</p>
          )}
        </div>
      ))}
      <div className="rounded-xl border border-border/50 bg-card/80 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">7-Day Trend</span>
        </div>
        {loading ? <Skeleton className="h-7 w-full" /> : (
          <div className="h-10 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparklineAll}>
                <XAxis dataKey="day" hide />
                <Line type="monotone" dataKey="calls" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                <Tooltip
                  contentStyle={{
                    fontSize: "10px",
                    padding: "4px 8px",
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                  }}
                  labelStyle={{ fontSize: "9px", color: "hsl(var(--muted-foreground))" }}
                  formatter={(value: number) => [`${value}`, "calls"]}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
