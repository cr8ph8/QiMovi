/**
 * ProjectIntelligenceOverviewPanel — admin aggregate view of project intelligence
 * signals across all entries. Reads canonical entries + grading_reports.
 */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, Layers, FileText, Users, GitBranch, Activity } from "lucide-react";

interface AggregateStats {
  totalEntries: number;
  avgDraftNumber: number;
  multiDraftPct: number;
  avgSceneCount: number;
  avgPageCount: number;
  avgCharacterCount: number;
  withScriptText: number;
}

export default function ProjectIntelligenceOverviewPanel() {
  const [stats, setStats] = useState<AggregateStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    const { data: entries } = await supabase
      .from("entries")
      .select("id, draft_number, script_text, parsed_metadata, page_count")
      .limit(500);

    if (!entries) { setLoading(false); return; }

    const total = entries.length;
    const withScript = entries.filter((e) => e.script_text && e.script_text.length > 100).length;
    const avgDraft = total > 0 ? entries.reduce((s, e) => s + (e.draft_number || 1), 0) / total : 0;
    const multiDraft = entries.filter((e) => (e.draft_number || 1) >= 2).length;

    // Extract parsed metadata stats where available
    let totalScenes = 0, totalPages = 0, totalChars = 0, metaCount = 0;
    entries.forEach((e) => {
      const meta = e.parsed_metadata as any;
      if (meta && typeof meta === "object") {
        if (meta.sceneCount) { totalScenes += meta.sceneCount; metaCount++; }
        if (meta.pageCount) totalPages += meta.pageCount;
        if (meta.uniqueCharacters?.length) totalChars += meta.uniqueCharacters.length;
      } else if (e.page_count) {
        totalPages += e.page_count;
        metaCount++;
      }
    });

    setStats({
      totalEntries: total,
      avgDraftNumber: Math.round(avgDraft * 10) / 10,
      multiDraftPct: total > 0 ? Math.round((multiDraft / total) * 100) : 0,
      avgSceneCount: metaCount > 0 ? Math.round(totalScenes / metaCount) : 0,
      avgPageCount: metaCount > 0 ? Math.round(totalPages / metaCount) : 0,
      avgCharacterCount: metaCount > 0 ? Math.round(totalChars / metaCount) : 0,
      withScriptText: withScript,
    });
    setLoading(false);
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    );
  }

  if (!stats) return <p className="text-sm text-muted-foreground">No data available.</p>;

  const items = [
    { icon: FileText, label: "Projects with Script", value: String(stats.withScriptText), sub: `of ${stats.totalEntries} total` },
    { icon: GitBranch, label: "Avg Draft Depth", value: String(stats.avgDraftNumber), sub: `${stats.multiDraftPct}% multi-draft` },
    { icon: Layers, label: "Avg Scenes", value: String(stats.avgSceneCount), sub: `${stats.avgPageCount} avg pages` },
    { icon: Users, label: "Avg Characters", value: String(stats.avgCharacterCount), sub: "per project" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <BarChart3 className="h-4 w-4 text-primary" />
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Project Intelligence Overview</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {items.map((item) => (
          <div key={item.label} className="p-4 rounded-xl border border-border/50 bg-card/80">
            <div className="flex items-center gap-2 mb-2">
              <item.icon className="h-4 w-4 text-primary" />
              <span className="text-[10px] font-mono text-muted-foreground uppercase">{item.label}</span>
            </div>
            <p className="font-display text-2xl font-bold text-foreground">{item.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{item.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
