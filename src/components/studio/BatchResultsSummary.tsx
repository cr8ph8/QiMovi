import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { BarChart3, Download, FileText, Lock, TrendingUp } from "lucide-react";
import { useCompetitionAnalyticsAccess } from "@/lib/competition/analyticsAccess";
import { AnalyticsAccessBadge, LockedActionButton } from "@/components/competition/AnalyticsAccessBadge";
import { readScorecards } from "@/lib/entryScorecard";

interface BatchItem {
  id: string;
  title: string;
  author: string | null;
  status: string;
  entry_id: string | null;
}

interface GradingReport {
  entry_id: string;
  total_score: number;
  originality: number;
  structure: number;
  character_depth: number;
  dialogue: number;
  theme: number;
  emotion: number;
  format_adherence: number;
  market: number | null;
  visual: number | null;
}

const DIMENSIONS = [
  { key: "originality", label: "Concept", max: 15 },
  { key: "structure", label: "Story", max: 20 },
  { key: "character_depth", label: "Characters", max: 20 },
  { key: "dialogue", label: "Dialogue", max: 10 },
  { key: "theme", label: "Theme", max: 10 },
  { key: "market", label: "Market", max: 15 },
  { key: "visual", label: "Cinematic", max: 10 },
  { key: "emotion", label: "Climax", max: 10 },
  { key: "format_adherence", label: "Technicalities", max: 10 },
];

interface BatchResultsSummaryProps {
  batchJobId: string;
}

export default function BatchResultsSummary({ batchJobId }: BatchResultsSummaryProps) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [reports, setReports] = useState<GradingReport[]>([]);
  const [loading, setLoading] = useState(true);
  const { canExportAnalytics } = useCompetitionAnalyticsAccess();

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      // Get completed items with entry_ids
      const { data: batchItems } = await (supabase
        .from("batch_items") as any)
        .select("id, title, author, status, entry_id")
        .eq("batch_job_id", batchJobId)
        .eq("status", "completed");

      const completedItems = (batchItems as BatchItem[]) || [];
      setItems(completedItems);

      const entryIds = completedItems.map(i => i.entry_id).filter(Boolean) as string[];

      if (entryIds.length > 0) {
        const cards = await readScorecards(entryIds);
        const rows: GradingReport[] = [];
        cards.forEach((c) => {
          if (c.total_score == null) return;
          rows.push({
            entry_id: c.entry_id,
            total_score: c.total_score,
            originality: c.originality ?? 0,
            structure: c.structure ?? 0,
            character_depth: c.character_depth ?? 0,
            dialogue: c.dialogue ?? 0,
            theme: c.theme ?? 0,
            emotion: c.emotion ?? 0,
            format_adherence: c.format_adherence ?? 0,
            market: c.market,
            visual: c.visual,
          });
        });
        setReports(rows);
      }

      setLoading(false);
    };
    load();
  }, [batchJobId]);

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground font-body">
        No completed items in this batch yet.
      </div>
    );
  }

  // Build scores map
  const scoresMap = new Map(reports.map(r => [r.entry_id, r]));

  // Dimension averages
  const dimAverages = DIMENSIONS.map(dim => {
    const values = reports
      .map(r => (r as any)[dim.key])
      .filter((v): v is number => v !== null && v !== undefined);
    const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    return { ...dim, avg, pct: dim.max > 0 ? (avg / dim.max) * 100 : 0 };
  });

  const overallAvg = reports.length > 0
    ? reports.reduce((s, r) => s + r.total_score, 0) / reports.length
    : 0;

  // CSV export — gated to entrants/judges/operators only
  const exportCSV = () => {
    if (!canExportAnalytics) return;
    const header = ["Title", "Author", "Total Score", ...DIMENSIONS.map(d => d.label)];
    const rows = items.map(item => {
      const report = item.entry_id ? scoresMap.get(item.entry_id) : null;
      return [
        item.title,
        item.author || "",
        report?.total_score?.toString() || "",
        ...DIMENSIONS.map(d => report ? String((report as any)[d.key] ?? "") : ""),
      ];
    });
    const csv = [header, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `batch-results-${batchJobId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border/50 bg-card overflow-hidden"
    >
      {/* Summary header */}
      <div className="p-6 border-b border-border/30">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <BarChart3 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-display text-lg font-semibold">Batch Results</h3>
              <p className="text-xs text-muted-foreground font-body">
                {items.length} screenplay{items.length !== 1 ? "s" : ""} profiled
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AnalyticsAccessBadge showCapabilities={false} />
            <LockedActionButton
              allowed={canExportAnalytics}
              actionId="export_batch_csv"
              surface="BatchResultsSummary"
              variant="outline"
              size="sm"
              onClick={exportCSV}
              className="gap-2"
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </LockedActionButton>
          </div>
        </div>


        {/* Overall avg */}
        <div className="flex items-center gap-4 mb-6">
          <div className="text-center">
            <div className="text-3xl font-display font-bold text-primary">{overallAvg.toFixed(1)}</div>
            <div className="text-[10px] font-mono text-muted-foreground uppercase">Avg Score / 120</div>
          </div>
          <div className="flex-1">
            <Progress value={(overallAvg / 120) * 100} className="h-2" />
          </div>
        </div>

        {/* Dimension heatmap */}
        <div className="grid grid-cols-3 md:grid-cols-9 gap-2">
          {dimAverages.map(dim => (
            <div key={dim.key} className="text-center">
              <div className="text-xs font-body font-medium truncate">{dim.label}</div>
              <div className="text-lg font-mono font-semibold">{dim.avg.toFixed(1)}</div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-1">
                <div
                  className="h-full bg-primary/60 rounded-full transition-all"
                  style={{ width: `${dim.pct}%` }}
                />
              </div>
              <div className="text-[9px] font-mono text-muted-foreground mt-0.5">/ {dim.max}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Items table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="font-body text-xs">Title</TableHead>
            <TableHead className="font-body text-xs">Author</TableHead>
            <TableHead className="font-body text-xs text-right">Score</TableHead>
            <TableHead className="font-body text-xs text-right">Rank</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items
            .map(item => ({
              ...item,
              score: item.entry_id ? scoresMap.get(item.entry_id)?.total_score ?? null : null,
            }))
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
            .map((item, idx) => (
              <TableRow key={item.id}>
                <TableCell className="font-body text-sm flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  {item.title}
                </TableCell>
                <TableCell className="font-body text-sm text-muted-foreground">{item.author || "—"}</TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {item.score !== null ? (
                    <span className={item.score >= 90 ? "text-emerald-500 font-semibold" : ""}>
                      {item.score.toFixed(1)}
                    </span>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {item.score !== null && (
                    <Badge variant="outline" className="text-[10px] font-mono">
                      #{idx + 1}
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </motion.div>
  );
}
