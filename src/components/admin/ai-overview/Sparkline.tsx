import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";

interface SparklineProps {
  data: { day: string; calls: number }[];
}

export function Sparkline({ data }: SparklineProps) {
  const hasData = data.some((d) => d.calls > 0);
  if (!hasData) {
    return <span className="text-[10px] text-muted-foreground">no activity</span>;
  }
  return (
    <div className="w-24 h-6">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line type="monotone" dataKey="calls" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} />
          <Tooltip
            contentStyle={{
              fontSize: "10px",
              padding: "2px 6px",
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
  );
}
