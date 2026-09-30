import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Network } from "lucide-react";

interface Stats {
  totalEdges: number;
  totalProjects: number;
  topRelationships: { rel: string; count: number }[];
}

export default function MemoryGraphOverviewPanel() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("project_memory_edges")
        .select("id, entry_id, relationship");

      if (error || !data) { setLoading(false); return; }

      const entrySet = new Set(data.map((d: any) => d.entry_id));
      const relMap = new Map<string, number>();
      for (const d of data as any[]) {
        relMap.set(d.relationship, (relMap.get(d.relationship) || 0) + 1);
      }
      const topRelationships = [...relMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([rel, count]) => ({ rel, count }));

      setStats({ totalEdges: data.length, totalProjects: entrySet.size, topRelationships });
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="text-xs text-muted-foreground p-4">Loading memory graph stats…</div>;
  if (!stats) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Network className="h-5 w-5 text-primary" />
        <h3 className="font-display text-sm font-semibold">Memory Graph Overview</h3>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-muted/30 p-3 text-center">
          <p className="text-2xl font-bold text-foreground">{stats.totalEdges}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Connections</p>
        </div>
        <div className="rounded-lg bg-muted/30 p-3 text-center">
          <p className="text-2xl font-bold text-foreground">{stats.totalProjects}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Projects</p>
        </div>
      </div>
      {stats.topRelationships.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Top Relationships</p>
          <div className="flex flex-wrap gap-1.5">
            {stats.topRelationships.map((r) => (
              <Badge key={r.rel} variant="secondary" className="text-xs gap-1">
                {r.rel} <span className="text-muted-foreground">({r.count})</span>
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
