import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import LineageGraph, { LineageNode, LineageEdge } from "@/components/LineageGraph";

interface ProvenanceLineagePanelProps {
  entryId: string;
}

export default function ProvenanceLineagePanel({ entryId }: ProvenanceLineagePanelProps) {
  const [nodes, setNodes] = useState<LineageNode[]>([]);
  const [edges, setEdges] = useState<LineageEdge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [nodesRes, edgesRes] = await Promise.all([
        supabase.from("provenance_nodes").select("id, label, node_type, created_at").eq("entry_id", entryId).order("created_at"),
        supabase.from("provenance_edges").select("from_node_id, to_node_id, edge_type").eq("entry_id", entryId),
      ]);
      if (cancelled) return;
      setNodes(
        (nodesRes.data ?? []).map((n) => ({
          id: n.id,
          label: n.label,
          node_type: n.node_type,
          created_at: n.created_at,
        }))
      );
      setEdges(
        (edgesRes.data ?? []).map((e) => ({
          from_node_id: e.from_node_id,
          to_node_id: e.to_node_id,
          edge_type: e.edge_type,
        }))
      );
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [entryId]);

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <LineageGraph nodes={nodes} edges={edges} loading={loading} />
    </div>
  );
}
