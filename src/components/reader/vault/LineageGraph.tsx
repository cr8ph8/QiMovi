import { useMemo } from "react";

interface LineageNode {
  id: string;
  label: string;
  kind: "doc" | "asset";
}

interface Props {
  current: LineageNode;
  parents?: LineageNode[];
  children?: LineageNode[];
  siblings?: LineageNode[];
}

export function LineageGraph({ current, parents = [], children = [], siblings = [] }: Props) {
  const { nodes, edges } = useMemo(() => {
    const cx = 160;
    const cy = 80;
    const ns: Array<LineageNode & { x: number; y: number; isCurrent?: boolean }> = [
      { ...current, x: cx, y: cy, isCurrent: true },
    ];
    const es: Array<{ from: string; to: string }> = [];

    parents.forEach((p, i) => {
      ns.push({ ...p, x: cx + (i - (parents.length - 1) / 2) * 80, y: 18 });
      es.push({ from: p.id, to: current.id });
    });
    children.forEach((c, i) => {
      ns.push({ ...c, x: cx + (i - (children.length - 1) / 2) * 80, y: 150 });
      es.push({ from: current.id, to: c.id });
    });
    siblings.forEach((s, i) => {
      const angle = ((Math.PI * 2) / Math.max(siblings.length, 1)) * i;
      ns.push({ ...s, x: cx + 110 * Math.cos(angle), y: cy + 50 * Math.sin(angle) });
      es.push({ from: current.id, to: s.id });
    });
    return { nodes: ns, edges: es };
  }, [current, parents, children, siblings]);

  if (edges.length === 0) return null;
  const map = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="space-y-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Lineage</span>
      <svg viewBox="0 0 320 170" className="w-full h-auto" style={{ maxHeight: 170 }}>
        {edges.map((e, i) => {
          const f = map.get(e.from), t = map.get(e.to);
          if (!f || !t) return null;
          return <line key={i} x1={f.x} y1={f.y} x2={t.x} y2={t.y} stroke="hsl(var(--border))" strokeWidth={1} />;
        })}
        {nodes.map((n) => (
          <g key={n.id}>
            <circle
              cx={n.x}
              cy={n.y}
              r={n.isCurrent ? 8 : 6}
              fill={n.kind === "doc" ? "hsl(var(--primary))" : "hsl(142 70% 45%)"}
              opacity={n.isCurrent ? 1 : 0.7}
            />
            <text x={n.x} y={n.y + 18} textAnchor="middle" className="text-[7px] fill-muted-foreground">
              {n.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
