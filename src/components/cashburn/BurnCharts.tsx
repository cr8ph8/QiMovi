import { Card } from "@/components/ui/card";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { CashBurnRecord, EXPENSE_FIELDS, EXPENSE_LABELS, totalExpenses, netBurn, endingCash } from "@/hooks/useCashBurn";

const COLORS = ["#c9a84c", "#4f46e5", "#10b981", "#ef4444", "#f59e0b", "#3b82f6", "#a78bfa", "#ec4899", "#22d3ee"];

export function BurnCharts({ records }: { records: CashBurnRecord[] }) {
  const sorted = [...records].sort((a, b) => a.month.localeCompare(b.month));
  const series = sorted.map((r) => ({
    month: r.month.slice(0, 7),
    cash: endingCash(r),
    revenue: Number(r.revenue_collected || 0),
    expenses: totalExpenses(r),
    net: Math.max(netBurn(r), 0),
  }));

  const totals: Record<string, number> = {};
  for (const r of sorted) {
    for (const f of EXPENSE_FIELDS) totals[EXPENSE_LABELS[f]] = (totals[EXPENSE_LABELS[f]] || 0) + Number((r as any)[f] || 0);
    if (r.custom_categories) for (const [k, v] of Object.entries(r.custom_categories)) totals[k] = (totals[k] || 0) + Number(v || 0);
  }
  const pieData = Object.entries(totals).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <ChartCard title="Cash balance over time">
        <AreaChart data={series}>
          <defs>
            <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c9a84c" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#c9a84c" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeOpacity={0.1} /><XAxis dataKey="month" fontSize={11} /><YAxis fontSize={11} /><Tooltip />
          <Area type="monotone" dataKey="cash" stroke="#c9a84c" fill="url(#g1)" />
        </AreaChart>
      </ChartCard>

      <ChartCard title="Revenue vs expenses">
        <BarChart data={series}>
          <CartesianGrid strokeOpacity={0.1} /><XAxis dataKey="month" fontSize={11} /><YAxis fontSize={11} /><Tooltip /><Legend />
          <Bar dataKey="revenue" fill="#10b981" />
          <Bar dataKey="expenses" fill="#ef4444" />
        </BarChart>
      </ChartCard>

      <ChartCard title="Net burn by month">
        <BarChart data={series}>
          <CartesianGrid strokeOpacity={0.1} /><XAxis dataKey="month" fontSize={11} /><YAxis fontSize={11} /><Tooltip />
          <Bar dataKey="net" fill="#f59e0b" />
        </BarChart>
      </ChartCard>

      <ChartCard title="Expense breakdown">
        <PieChart>
          <Tooltip />
          <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={90} label={(d) => d.name}>
            {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
        </PieChart>
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <Card className="p-4">
      <div className="text-sm font-medium mb-2">{title}</div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </Card>
  );
}
