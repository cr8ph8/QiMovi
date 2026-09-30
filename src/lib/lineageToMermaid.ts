import type { LineageNode, LineageEdge } from "@/components/LineageGraph";

const safeId = (id: string) => "n_" + id.replace(/[^a-zA-Z0-9_]/g, "_");

/**
 * Escape a label so Mermaid won't choke on quotes, angle brackets, pipes,
 * backticks, newlines, or trailing backslashes that break parser state.
 */
function escLabel(s: string): string {
  return (s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "&#124;")
    .replace(/`/g, "'")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 80);
}

function escEdgeLabel(s: string): string {
  // Edge labels live between `|...|`, so pipes are extra-deadly.
  return escLabel(s).replace(/&#124;/g, " ");
}

/**
 * Serialize a lineage graph into a Mermaid `flowchart LR` string with
 * one `subgraph` per lane.
 */
export function lineageToMermaid(
  nodes: LineageNode[],
  edges: LineageEdge[],
  lanes: string[] = []
): string {
  const lines: string[] = ["flowchart LR"];
  const used = new Set<string>();

  const laneList = lanes.length ? lanes : ["all"];
  for (const lane of laneList) {
    const laneNodes = nodes.filter((n) => (lanes.length ? n.lane === lane : true));
    if (!laneNodes.length) continue;
    lines.push(`  subgraph ${safeId(lane)}["${escLabel(lane.toUpperCase())}"]`);
    for (const n of laneNodes) {
      lines.push(`    ${safeId(n.id)}["${escLabel(n.label)}<br/><i>${escLabel(n.node_type)}</i>"]`);
      used.add(n.id);
    }
    lines.push(`  end`);
  }

  for (const n of nodes) {
    if (used.has(n.id)) continue;
    lines.push(`  ${safeId(n.id)}["${escLabel(n.label)}<br/><i>${escLabel(n.node_type)}</i>"]`);
  }

  for (const e of edges) {
    lines.push(
      `  ${safeId(e.from_node_id)} -->|${escEdgeLabel(e.edge_type)}| ${safeId(e.to_node_id)}`
    );
  }

  return lines.join("\n");
}

/** Mermaid restricted to the connected component of `seedId`. */
export function lineageToSubgraphMermaid(
  nodes: LineageNode[],
  edges: LineageEdge[],
  lanes: string[],
  seedId: string
): string {
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!adj.has(e.from_node_id)) adj.set(e.from_node_id, new Set());
    if (!adj.has(e.to_node_id)) adj.set(e.to_node_id, new Set());
    adj.get(e.from_node_id)!.add(e.to_node_id);
    adj.get(e.to_node_id)!.add(e.from_node_id);
  }
  const keep = new Set<string>([seedId]);
  const stack = [seedId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const nbr of adj.get(id) ?? []) {
      if (!keep.has(nbr)) {
        keep.add(nbr);
        stack.push(nbr);
      }
    }
  }
  return lineageToMermaid(
    nodes.filter((n) => keep.has(n.id)),
    edges.filter((e) => keep.has(e.from_node_id) && keep.has(e.to_node_id)),
    lanes
  );
}
