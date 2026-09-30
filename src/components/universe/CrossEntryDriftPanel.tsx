import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, CheckCircle, TrendingDown } from "lucide-react";
import {
  computeCrossEntryDrift,
  computeDimensionDrifts,
  type CrossEntryReportInput,
  type DimensionDrift,
  type StabilityResult,
} from "@/lib/stability";

interface Props {
  universeId: string;
  entryIds: string[];
}

const LABEL_COLOR: Record<string, string> = {
  stable: "text-emerald-500",
  "moderate drift": "text-amber-500",
  unstable: "text-red-500",
  "high variance": "text-red-600",
};

const LABEL_ICON: Record<string, typeof CheckCircle> = {
  stable: CheckCircle,
  "moderate drift": TrendingDown,
  unstable: AlertTriangle,
  "high variance": AlertTriangle,
};

const DIM_LABELS: Record<string, string> = {
  originality: "Concept",
  structure: "Story",
  character_depth: "Characters",
  dialogue: "Dialogue",
  theme: "Theme",
  emotion: "Climax",
  format_adherence: "Technicalities",
};

export default function CrossEntryDriftPanel({ universeId, entryIds }: Props) {
  const [loading, setLoading] = useState(true);
  const [drift, setDrift] = useState<StabilityResult | null>(null);
  const [dimDrifts, setDimDrifts] = useState<DimensionDrift[]>([]);
  const [reports, setReports] = useState<(CrossEntryReportInput & { title: string })[]>([]);

  useEffect(() => {
    if (entryIds.length < 2) { setLoading(false); return; }

    async function load() {
      // Get latest grading report per entry
      // eslint-disable-next-line no-restricted-syntax -- cross-entry drift computation, not display total
      const { data: grData } = await supabase
        .from("grading_reports")
        .select("entry_id, total_score, originality, structure, character_depth, dialogue, theme, emotion, format_adherence, created_at")


        .in("entry_id", entryIds)
        .order("created_at", { ascending: false });

      if (!grData || grData.length === 0) { setLoading(false); return; }

      // Dedupe: keep latest per entry
      const seen = new Set<string>();
      const latest: typeof grData = [];
      for (const r of grData) {
        if (seen.has(r.entry_id)) continue;
        seen.add(r.entry_id);
        latest.push(r);
      }

      // Get titles
      const { data: entries } = await supabase
        .from("entries")
        .select("id, title")
        .in("id", latest.map((r) => r.entry_id));

      const titleMap = new Map((entries ?? []).map((e: any) => [e.id, e.title]));

      const enriched = latest.map((r) => ({
        entry_id: r.entry_id,
        total_score: r.total_score,
        originality: r.originality,
        structure: r.structure,
        character_depth: r.character_depth,
        dialogue: r.dialogue,
        theme: r.theme,
        emotion: r.emotion,
        format_adherence: r.format_adherence,
        title: titleMap.get(r.entry_id) || "Untitled",
      }));

      setReports(enriched);
      setDrift(computeCrossEntryDrift(enriched));
      setDimDrifts(computeDimensionDrifts(enriched));
      setLoading(false);
    }

    load();
  }, [entryIds]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Analyzing score consistency…
      </div>
    );
  }

  if (!drift || drift.confidence === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2">
        Need at least 2 scored entries to compute drift analysis.
      </p>
    );
  }

  const Icon = LABEL_ICON[drift.metric_label] || CheckCircle;
  const flagged = dimDrifts.filter((d) => d.cv > 0.3);

  return (
    <div className="space-y-4">
      {/* Overall drift badge */}
      <div className="flex items-center gap-3">
        <Icon className={`h-5 w-5 ${LABEL_COLOR[drift.metric_label] || "text-muted-foreground"}`} />
        <div>
          <span className="font-display text-sm font-semibold">Franchise Score Stability</span>
          <Badge variant="outline" className={`ml-2 text-[10px] font-mono capitalize ${LABEL_COLOR[drift.metric_label]}`}>
            {drift.metric_label} — {drift.metric_value}/100
          </Badge>
        </div>
      </div>

      {/* Comparison table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-border/30 text-muted-foreground">
              <th className="text-left py-1.5 pr-3 font-medium">Entry</th>
              <th className="text-right py-1.5 px-2 font-medium">Total</th>
              {Object.keys(DIM_LABELS).map((d) => (
                <th key={d} className="text-right py-1.5 px-1.5 font-medium">
                  {DIM_LABELS[d]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.entry_id} className="border-b border-border/10 hover:bg-muted/20">
                <td className="py-1.5 pr-3 truncate max-w-[160px] font-sans text-foreground">{r.title}</td>
                <td className="text-right py-1.5 px-2 font-semibold">{r.total_score}</td>
                {(["originality", "structure", "character_depth", "dialogue", "theme", "emotion", "format_adherence"] as const).map((d) => {
                  const dimDrift = dimDrifts.find((dd) => dd.dimension === d);
                  const isHigh = dimDrift && dimDrift.cv > 0.3;
                  return (
                    <td key={d} className={`text-right py-1.5 px-1.5 ${isHigh ? "text-amber-500 font-semibold" : ""}`}>
                      {r[d]}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Flagged dimensions */}
      {flagged.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[10px] text-muted-foreground font-mono">High variance:</span>
          {flagged.map((f) => (
            <Badge key={f.dimension} variant="destructive" className="text-[10px] font-mono">
              {DIM_LABELS[f.dimension] || f.dimension} (CV {f.cv})
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
