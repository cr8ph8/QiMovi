/**
 * DevelopmentPipelineOverviewPanel — admin aggregate view of project
 * development stages across all entries.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Milestone } from "lucide-react";

const STAGE_LABELS: Record<string, string> = {
  concept: "Concept",
  outline: "Outline",
  draft: "Draft",
  revised_draft: "Revised Draft",
  submission_ready: "Submission Ready",
  pitch_package_ready: "Pitch Package Ready",
  in_development: "In Development",
  active_development: "Active Development",
};

export default function DevelopmentPipelineOverviewPanel() {
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({});
  const [totalTransitions, setTotalTransitions] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [entriesRes, histRes] = await Promise.all([
        supabase.from("entries").select("dev_stage"),
        supabase.from("project_stage_history").select("id", { count: "exact", head: true }),
      ]);

      const counts: Record<string, number> = {};
      for (const e of (entriesRes.data as any[]) || []) {
        const s = e.dev_stage || "draft";
        counts[s] = (counts[s] || 0) + 1;
      }
      setStageCounts(counts);
      setTotalTransitions(histRes.count || 0);
      setLoading(false);
    }
    load();
  }, []);

  const total = Object.values(stageCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Milestone className="h-4 w-4 text-primary" />
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Development Pipeline Overview</span>
        <Badge variant="outline" className="text-[9px] font-mono ml-auto">
          {total} projects · {totalTransitions} transitions
        </Badge>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {Object.entries(STAGE_LABELS).map(([key, label]) => {
            const count = stageCounts[key] || 0;
            return (
              <div key={key} className="rounded-lg border border-border/30 bg-card/60 px-3 py-2 text-center">
                <p className="text-lg font-mono font-bold text-foreground">{count}</p>
                <p className="text-[9px] font-mono text-muted-foreground uppercase">{label}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
