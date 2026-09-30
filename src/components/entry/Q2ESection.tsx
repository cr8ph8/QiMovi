import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer } from "recharts";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import CollapsibleSection from "@/components/CollapsibleSection";
import { getScoreColor, getBarColor } from "@/lib/score-utils";

const Q2E_DIMS = [
  { key: "structure_q", label: "Structure Q", desc: "Plot coherence, pacing" },
  { key: "character_q", label: "Character Q", desc: "Arc depth, motivation" },
  { key: "dialogue_q", label: "Dialogue Q", desc: "Voice distinction" },
  { key: "theme_q", label: "Theme Q", desc: "Thematic resonance" },
  { key: "creativity_q", label: "Creativity Q", desc: "Originality" },
  { key: "audience_q", label: "Audience Q", desc: "Engagement" },
  { key: "market_q", label: "Market Q", desc: "Commercial viability" },
];

interface Q2ESectionProps {
  quotients: Record<string, number> | null;
  evaluationRuns: any[];
}

export default function Q2ESection({ quotients, evaluationRuns }: Q2ESectionProps) {
  if (!quotients) {
    return (
      <CollapsibleSection icon={<Sparkles className="h-5 w-5 text-primary" />} title="Q2E Narrative Quotients" defaultOpen={false} delay={0}>
        <p className="text-sm text-muted-foreground text-center py-4">No Q2E data yet. Run an AI evaluation.</p>
      </CollapsibleSection>
    );
  }

  const q = quotients as any;
  const varianceScore = Number(q.variance_score ?? 0);
  const confidenceScore = Number(q.confidence_score ?? 0);

  const radarData = Q2E_DIMS.map((d) => ({
    category: d.label.replace(" Q", ""),
    value: Number(q[d.key] ?? 0),
    normalized: Number(q[d.key] ?? 0),
  }));

  return (
    <CollapsibleSection
      icon={<Sparkles className="h-5 w-5 text-primary" />}
      title="Q2E Narrative Quotients"
      badge={`${Math.round(confidenceScore)}% confidence`}
      badgeColor="bg-primary/15 text-primary"
      badgeVariant="pill"
      defaultOpen delay={0}
    >
      <div className="space-y-4">
        {Q2E_DIMS.map((dim) => {
          const val = Number(q[dim.key] ?? 0);
          return (
            <div key={dim.key}>
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-sm font-medium">{dim.label}</span>
                <span className={`text-sm font-mono font-bold ${getScoreColor(val)}`}>{Math.round(val)}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${val}%` }} transition={{ duration: 0.8 }} className={`h-full rounded-full ${getBarColor(val)}`} />
              </div>
            </div>
          );
        })}

        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="65%">
              <PolarGrid stroke="hsl(var(--border))" />
              <PolarAngleAxis dataKey="category" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
              <Radar name="Q2E" dataKey="normalized" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.15} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-muted/40 p-2 text-center">
            <span className="text-[9px] font-mono text-muted-foreground uppercase block">Variance</span>
            <span className={`text-sm font-mono font-bold ${varianceScore <= 10 ? "text-emerald-400" : "text-amber-400"}`}>{varianceScore.toFixed(1)}%</span>
          </div>
          <div className="rounded-lg bg-muted/40 p-2 text-center">
            <span className="text-[9px] font-mono text-muted-foreground uppercase block">Confidence</span>
            <span className={`text-sm font-mono font-bold ${getScoreColor(confidenceScore)}`}>{Math.round(confidenceScore)}%</span>
          </div>
          <div className="rounded-lg bg-muted/40 p-2 text-center">
            <span className="text-[9px] font-mono text-muted-foreground uppercase block">Passes</span>
            <span className="text-sm font-mono font-bold text-foreground">{evaluationRuns.length}</span>
          </div>
        </div>

        {evaluationRuns.length > 1 && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Multi-Pass</h4>
            {evaluationRuns.map((run: any, i: number) => {
              const scores = run.quotient_scores_json || {};
              const avg = Q2E_DIMS.reduce((sum, d) => sum + Number(scores[d.key] ?? 0), 0) / Q2E_DIMS.length;
              return (
                <div key={run.id} className="flex items-center gap-2 rounded-lg bg-muted/20 px-3 py-1.5">
                  <Badge variant="outline" className="text-[9px] font-mono shrink-0">Pass {i + 1}</Badge>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${getBarColor(avg)}`} style={{ width: `${avg}%` }} />
                  </div>
                  <span className={`text-xs font-mono font-bold ${getScoreColor(avg)}`}>{Math.round(avg)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
