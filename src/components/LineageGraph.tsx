import { forwardRef, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { GitBranch } from "lucide-react";

export interface LineageNode {
  id: string;
  label: string;
  node_type: string;
  /** Optional swimlane the node belongs to. */
  lane?: string;
  created_at?: string;
}

export interface LineageEdge {
  from_node_id: string;
  to_node_id: string;
  edge_type: string;
}

export interface LaneMeta {
  label: string;
  caption?: string;
  glyph?: string;
}

interface LineageGraphProps {
  nodes: LineageNode[];
  edges: LineageEdge[];
  loading?: boolean;
  lanes?: string[];
  laneMeta?: Record<string, LaneMeta>;
  /** When set, only this node + its connected component is foregrounded. */
  focusedId?: string | null;
  /** When set, the matching node gets an emphasized selection ring. */
  highlightedNodeId?: string | null;
  /** When set, this specific edge (parent → child hop) is emphasized. */
  highlightedEdge?: { from: string; to: string } | null;
  onNodeClick?: (node: LineageNode) => void;
  onNodeHover?: (node: LineageNode | null) => void;
  /** Optional density mode for compact vs comfortable layouts. */
  density?: "comfortable" | "compact";
}


const DEFAULT_NODE_W = 168;
const DEFAULT_NODE_H = 46;
const DEFAULT_GAP_X = 84;
const DEFAULT_GAP_Y = 56;
const PAD = 36;

const TYPE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  universe: { bg: "hsl(var(--primary) / 0.18)", border: "hsl(var(--primary))", text: "hsl(var(--primary))" },
  entry: { bg: "hsl(var(--primary) / 0.10)", border: "hsl(var(--primary) / 0.7)", text: "hsl(var(--foreground))" },
  creative_direction: { bg: "hsl(var(--primary) / 0.15)", border: "hsl(var(--primary))", text: "hsl(var(--primary))" },
  ai_generation: { bg: "hsl(270 60% 50% / 0.15)", border: "hsl(270 60% 50%)", text: "hsl(270 60% 50%)" },
  governance_event: { bg: "hsl(45 93% 47% / 0.15)", border: "hsl(45 93% 47%)", text: "hsl(45 93% 47%)" },
  rewrite: { bg: "hsl(160 60% 45% / 0.15)", border: "hsl(160 60% 45%)", text: "hsl(160 60% 45%)" },
  parity_deal: { bg: "hsl(45 93% 47% / 0.12)", border: "hsl(45 93% 47%)", text: "hsl(45 93% 47%)" },
};
const DEFAULT_COLOR = { bg: "hsl(var(--muted))", border: "hsl(var(--border))", text: "hsl(var(--foreground))" };

function colorFor(nodeType: string) {
  if (TYPE_COLORS[nodeType]) return TYPE_COLORS[nodeType];
  if (nodeType.startsWith("artifact_"))
    return { bg: "hsl(var(--accent) / 0.15)", border: "hsl(var(--accent))", text: "hsl(var(--accent-foreground))" };
  return DEFAULT_COLOR;
}

function topoSort(nodes: LineageNode[], edges: LineageEdge[]): string[][] {
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const nodeSet = new Set(nodes.map((n) => n.id));
  for (const id of nodeSet) {
    inDeg.set(id, 0);
    adj.set(id, []);
  }
  for (const e of edges) {
    if (!nodeSet.has(e.from_node_id) || !nodeSet.has(e.to_node_id)) continue;
    adj.get(e.from_node_id)!.push(e.to_node_id);
    inDeg.set(e.to_node_id, (inDeg.get(e.to_node_id) ?? 0) + 1);
  }
  const ranks: string[][] = [];
  let queue = [...nodeSet].filter((id) => (inDeg.get(id) ?? 0) === 0);
  const visited = new Set<string>();
  while (queue.length) {
    ranks.push(queue);
    queue.forEach((id) => visited.add(id));
    const next: string[] = [];
    for (const id of queue) {
      for (const child of adj.get(id) ?? []) {
        inDeg.set(child, (inDeg.get(child) ?? 0) - 1);
        if ((inDeg.get(child) ?? 0) === 0 && !visited.has(child)) next.push(child);
      }
    }
    queue = next;
  }
  const remaining = [...nodeSet].filter((id) => !visited.has(id));
  if (remaining.length) ranks.push(remaining);
  return ranks;
}

/** Find every node reachable from `seed` ignoring edge direction. */
function connectedComponent(seed: string, edges: LineageEdge[]): Set<string> {
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!adj.has(e.from_node_id)) adj.set(e.from_node_id, new Set());
    if (!adj.has(e.to_node_id)) adj.set(e.to_node_id, new Set());
    adj.get(e.from_node_id)!.add(e.to_node_id);
    adj.get(e.to_node_id)!.add(e.from_node_id);
  }
  const out = new Set<string>([seed]);
  const stack = [seed];
  while (stack.length) {
    const id = stack.pop()!;
    for (const nbr of adj.get(id) ?? []) {
      if (!out.has(nbr)) {
        out.add(nbr);
        stack.push(nbr);
      }
    }
  }
  return out;
}

const LineageGraph = forwardRef<SVGSVGElement, LineageGraphProps>(function LineageGraph(
  { nodes, edges, loading, lanes, laneMeta, focusedId, highlightedNodeId, highlightedEdge, onNodeClick, onNodeHover, density = "comfortable" },
  ref
) {
  const nodeRefs = useRef(new Map<string, SVGGElement | null>());
  const NODE_W = density === "compact" ? 132 : DEFAULT_NODE_W;
  const NODE_H = density === "compact" ? 38 : DEFAULT_NODE_H;
  const GAP_X = density === "compact" ? 56 : DEFAULT_GAP_X;
  const GAP_Y = density === "compact" ? 38 : DEFAULT_GAP_Y;

  const layout = useMemo(() => {
    if (!nodes.length) return null;
    const positions = new Map<string, { x: number; y: number }>();
    let width = 0;
    let height = 0;
    const laneBands: { name: string; y: number; height: number }[] = [];

    if (lanes && lanes.length && nodes.some((n) => n.lane)) {
      const laneOf = (id: string) => nodes.find((n) => n.id === id)?.lane ?? lanes[0];
      const byLane = new Map<string, LineageNode[]>();
      for (const ln of lanes) byLane.set(ln, []);
      for (const n of nodes) {
        const key = n.lane && byLane.has(n.lane) ? n.lane : lanes[0];
        byLane.get(key)!.push(n);
      }
      const laneColumns = new Map<string, string[][]>();
      let maxCols = 0;
      for (const ln of lanes) {
        const laneNodes = byLane.get(ln)!;
        const laneEdges = edges.filter((e) => laneOf(e.from_node_id) === ln && laneOf(e.to_node_id) === ln);
        const cols = topoSort(laneNodes, laneEdges);
        laneColumns.set(ln, cols);
        if (cols.length > maxCols) maxCols = cols.length;
      }
      let cursorY = PAD + 40;
      for (const ln of lanes) {
        const cols = laneColumns.get(ln)!;
        const rowsPerCol = Math.max(...cols.map((c) => c.length), 1);
        const laneHeight = rowsPerCol * NODE_H + (rowsPerCol - 1) * GAP_Y;
        laneBands.push({ name: ln, y: cursorY - 32, height: laneHeight + 44 });
        for (let col = 0; col < cols.length; col++) {
          const rank = cols[col];
          for (let row = 0; row < rank.length; row++) {
            positions.set(rank[row], {
              x: PAD + 16 + col * (NODE_W + GAP_X),
              y: cursorY + row * (NODE_H + GAP_Y),
            });
          }
        }
        cursorY += laneHeight + 56;
      }
      width = PAD + maxCols * (NODE_W + GAP_X) + PAD + 16;
      height = cursorY + PAD;
    } else {
      const ranks = topoSort(nodes, edges);
      for (let col = 0; col < ranks.length; col++) {
        const rank = ranks[col];
        const totalH = rank.length * NODE_H + (rank.length - 1) * GAP_Y;
        const startY = -totalH / 2;
        for (let row = 0; row < rank.length; row++) {
          positions.set(rank[row], {
            x: PAD + col * (NODE_W + GAP_X),
            y: startY + row * (NODE_H + GAP_Y),
          });
        }
      }
      const ys = [...positions.values()].map((p) => p.y);
      const minY = Math.min(...ys);
      for (const [id, pos] of positions) positions.set(id, { x: pos.x, y: pos.y - minY + PAD });
      const xs = [...positions.values()].map((p) => p.x);
      width = Math.max(...xs) + NODE_W + PAD;
      height = Math.max(...[...positions.values()].map((p) => p.y)) + NODE_H + PAD;
    }
    return { positions, width, height, laneBands };
  }, [nodes, edges, lanes, NODE_W, NODE_H, GAP_X, GAP_Y]);

  const focusedSet = useMemo(
    () => (focusedId ? connectedComponent(focusedId, edges) : null),
    [focusedId, edges]
  );

  if (loading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (!nodes.length || !layout) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
        <GitBranch className="h-8 w-8 opacity-40" />
        <p className="text-sm">No lineage data yet</p>
      </div>
    );
  }

  const { positions, width, height, laneBands } = layout;
  const isDim = (id: string) => focusedSet !== null && !focusedSet.has(id);
  const isEdgeDim = (e: LineageEdge) =>
    focusedSet !== null && (!focusedSet.has(e.from_node_id) || !focusedSet.has(e.to_node_id));

  const nodeOrder = nodes.map((n) => n.id);
  const focusNodeAt = (idx: number) => {
    if (idx < 0 || idx >= nodeOrder.length) return;
    const el = nodeRefs.current.get(nodeOrder[idx]);
    el?.focus?.();
  };

  return (
    <svg
      ref={ref}
      width={width}
      height={height}
      className="block focus:outline-none"
      style={{ minWidth: width, minHeight: height }}
      role="img"
      aria-label={`Story lineage graph: ${nodes.length} nodes, ${edges.length} connections`}
      tabIndex={-1}
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 3.5 L 0 7 z" fill="hsl(var(--muted-foreground))" />
        </marker>
        <marker id="arrow-gold" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 3.5 L 0 7 z" fill="hsl(var(--primary))" />
        </marker>
        <filter id="node-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Lane bands */}
      {laneBands?.map((band, i) => {
        const meta = laneMeta?.[band.name];
        return (
          <g key={`lane-${band.name}`}>
            <rect
              x={0}
              y={band.y}
              width={width}
              height={band.height}
              fill={i % 2 === 0 ? "hsl(var(--muted) / 0.18)" : "hsl(var(--muted) / 0.08)"}
            />
            <rect x={0} y={band.y} width={3} height={band.height} fill="hsl(var(--primary) / 0.4)" />
            <text
              x={18}
              y={band.y + 18}
              fontSize={10}
              fontWeight={700}
              fill="hsl(var(--primary))"
              style={{ textTransform: "uppercase", letterSpacing: "0.14em" }}
            >
              {meta?.glyph ? `${meta.glyph}  ` : ""}{meta?.label ?? band.name}
            </text>
            {meta?.caption && (
              <text x={18} y={band.y + 32} fontSize={9} fill="hsl(var(--muted-foreground))">
                {meta.caption}
              </text>
            )}
          </g>
        );
      })}

      {/* Edges */}
      {edges.map((e, i) => {
        const from = positions.get(e.from_node_id);
        const to = positions.get(e.to_node_id);
        if (!from || !to) return null;
        const x1 = from.x + NODE_W;
        const y1 = from.y + NODE_H / 2;
        const x2 = to.x;
        const y2 = to.y + NODE_H / 2;
        const cx = (x1 + x2) / 2;
        const dim = isEdgeDim(e);
        const isHopHighlighted = !!(
          highlightedEdge &&
          highlightedEdge.from === e.from_node_id &&
          highlightedEdge.to === e.to_node_id
        );
        const highlighted = isHopHighlighted || (focusedSet !== null && !dim);
        const fromLabel = nodes.find((n) => n.id === e.from_node_id)?.label ?? "node";
        const toLabel = nodes.find((n) => n.id === e.to_node_id)?.label ?? "node";
        return (
          <path
            key={`edge-${i}`}
            d={`M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`}
            fill="none"
            stroke={highlighted ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.4)"}
            strokeWidth={isHopHighlighted ? 3 : highlighted ? 2 : 1.4}
            opacity={isHopHighlighted ? 1 : dim ? 0.12 : 1}
            markerEnd={highlighted ? "url(#arrow-gold)" : "url(#arrow)"}
            style={{
              transition: "opacity 200ms, stroke 200ms, stroke-width 200ms",
              filter: isHopHighlighted ? "drop-shadow(0 0 4px hsl(var(--primary) / 0.6))" : undefined,
            }}
            tabIndex={0}
            role="img"
            aria-label={`${e.edge_type.replace(/_/g, " ")} from ${fromLabel} to ${toLabel}${isHopHighlighted ? " (selected hop)" : ""}`}
            className="focus:outline-none focus-visible:[stroke:hsl(var(--primary))]"
          >
            <title>{`${fromLabel} → ${toLabel} (${e.edge_type})`}</title>
          </path>
        );
      })}


      {/* Nodes */}
      {nodes.map((n, idx) => {
        const pos = positions.get(n.id);
        if (!pos) return null;
        const colors = colorFor(n.node_type);
        const truncLabel = n.label.length > 24 ? n.label.slice(0, 22) + "…" : n.label;
        const clickable = Boolean(onNodeClick);
        const dim = isDim(n.id);
        const isFocused = focusedId === n.id;
        const isHopHighlight = highlightedNodeId === n.id;

        const onKey = (ev: ReactKeyboardEvent<SVGGElement>) => {
          if (!clickable) return;
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            onNodeClick!(n);
          } else if (ev.key === "ArrowRight" || ev.key === "ArrowDown") {
            ev.preventDefault();
            focusNodeAt(idx + 1);
          } else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") {
            ev.preventDefault();
            focusNodeAt(idx - 1);
          }
        };
        return (
          <g
            key={n.id}
            ref={(el) => nodeRefs.current.set(n.id, el)}
            style={{
              cursor: clickable ? "pointer" : "default",
              opacity: dim ? 0.18 : 1,
              transition: "opacity 200ms",
              outline: "none",
            }}
            onClick={clickable ? () => onNodeClick!(n) : undefined}
            onMouseEnter={() => onNodeHover?.(n)}
            onMouseLeave={() => onNodeHover?.(null)}
            onFocus={() => onNodeHover?.(n)}
            onBlur={() => onNodeHover?.(null)}
            onKeyDown={onKey}
            filter={isFocused || isHopHighlight ? "url(#node-glow)" : undefined}
            tabIndex={clickable ? 0 : -1}
            role={clickable ? "button" : "img"}
            aria-label={`${n.label} — ${n.node_type.replace(/_/g, " ")}${n.lane ? `, ${n.lane} lane` : ""}${isHopHighlight ? " (selected hop)" : ""}`}
            className="focus-visible:[&>rect:nth-of-type(2)]:stroke-primary focus-visible:[&>rect:nth-of-type(2)]:stroke-[3px]"
          >
            <rect
              x={pos.x}
              y={pos.y + 2}
              width={NODE_W}
              height={NODE_H}
              rx={8}
              fill="hsl(var(--background) / 0.4)"
            />
            <rect
              x={pos.x}
              y={pos.y}
              width={NODE_W}
              height={NODE_H}
              rx={8}
              fill={colors.bg}
              stroke={isFocused || isHopHighlight ? "hsl(var(--primary))" : colors.border}
              strokeWidth={isHopHighlight ? 3 : isFocused ? 2 : 1.4}
            />

            <text
              x={pos.x + NODE_W / 2}
              y={pos.y + NODE_H / 2 - 4}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={colors.text}
              fontSize={11}
              fontWeight={600}
            >
              {truncLabel}
            </text>
            <text
              x={pos.x + NODE_W / 2}
              y={pos.y + NODE_H / 2 + 10}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="hsl(var(--muted-foreground))"
              fontSize={9}
            >
              {n.node_type.replace(/_/g, " ")}
            </text>
          </g>
        );
      })}
    </svg>
  );
});

export default LineageGraph;
