import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, AlertTriangle, Target } from "lucide-react";
import { FILMSTACK_DOCS, type FilmStackDocument, type ReadinessScores, computeReadinessScores } from "@/lib/filmstack";
import type { Distributor } from "./DistributorExplorer";

interface ReadinessDashboardProps {
  filmstackDocs: Record<string, FilmStackDocument>;
  distributors: Distributor[];
  projectGenre?: string;
  projectBudget?: number;
}

function matchDistributors(distributors: Distributor[], genre?: string, budget?: number): { distributor: Distributor; score: number; reasons: string[] }[] {
  return distributors
    .map(d => {
      let score = 50;
      const reasons: string[] = [];

      // Genre match
      if (genre) {
        const genreLower = genre.toLowerCase();
        if (d.genres.some(g => g.toLowerCase() === "all genres")) {
          score += 15;
          reasons.push("Accepts all genres");
        } else if (d.genres.some(g => g.toLowerCase().includes(genreLower) || genreLower.includes(g.toLowerCase()))) {
          score += 25;
          reasons.push(`Strong ${genre} track record`);
        }
      }

      // Budget match
      if (budget !== undefined) {
        if (budget >= d.budgetRange[0] && budget <= d.budgetRange[1]) {
          score += 25;
          reasons.push("Budget in range");
        } else if (budget < d.budgetRange[0]) {
          const gap = d.budgetRange[0] - budget;
          score -= Math.min(20, gap * 3);
          reasons.push("Below typical budget");
        }
      }

      // Bonus for open submissions
      if (d.submissionType.toLowerCase().includes("open") || d.submissionType.toLowerCase().includes("unsolicited")) {
        score += 10;
        reasons.push("Open submissions");
      }

      return { distributor: d, score: Math.max(0, Math.min(100, score)), reasons };
    })
    .sort((a, b) => b.score - a.score);
}

function RadialGauge({ value, label, size = 80 }: { value: number; label: string; size?: number }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const progress = (value / 100) * circ;
  const color = value >= 70 ? "hsl(142 71% 45%)" : value >= 40 ? "hsl(45 93% 47%)" : "hsl(0 84% 60%)";

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-border/20" strokeWidth={4} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4}
          strokeDasharray={`${progress} ${circ - progress}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="transition-all duration-700"
        />
        <text x={size / 2} y={size / 2 + 1} textAnchor="middle" dominantBaseline="middle" className="fill-foreground" style={{ fontSize: 16, fontFamily: "monospace", fontWeight: 700 }}>
          {value}
        </text>
      </svg>
      <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">{label}</span>
    </div>
  );
}

export default function ReadinessDashboard({ filmstackDocs, distributors, projectGenre, projectBudget }: ReadinessDashboardProps) {
  const scores: ReadinessScores = useMemo(() => computeReadinessScores(filmstackDocs), [filmstackDocs]);

  const missingDocs = useMemo(() => {
    return FILMSTACK_DOCS.filter(def => {
      const doc = filmstackDocs[def.id];
      return !doc || doc.status === "missing";
    });
  }, [filmstackDocs]);

  const topMatches = useMemo(() => {
    return matchDistributors(distributors, projectGenre, projectBudget).slice(0, 3);
  }, [distributors, projectGenre, projectBudget]);

  const overallScore = Math.round((scores.completeness + scores.competition + scores.production + scores.legal) / 4);

  return (
    <div className="space-y-4">
      {/* Radial Gauges */}
      <div className="rounded-lg border border-border/30 bg-card p-4">
        <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-4">Distribution Readiness</h4>
        <div className="flex items-center justify-around flex-wrap gap-4">
          <RadialGauge value={overallScore} label="Overall" size={90} />
          <RadialGauge value={scores.completeness} label="Docs" />
          <RadialGauge value={scores.competition} label="Creative" />
          <RadialGauge value={scores.production} label="Production" />
          <RadialGauge value={scores.legal} label="Legal" />
        </div>
      </div>

      {/* Category Breakdown */}
      <div className="rounded-lg border border-border/30 bg-card p-4 space-y-3">
        <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Category Breakdown</h4>
        {([
          { label: "Document Completeness", value: scores.completeness },
          { label: "Competition Readiness", value: scores.competition },
          { label: "Production Readiness", value: scores.production },
          { label: "Legal Readiness", value: scores.legal },
        ]).map(item => (
          <div key={item.label} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-muted-foreground">{item.label}</span>
              <span className="text-[10px] font-mono text-foreground font-semibold">{item.value}%</span>
            </div>
            <Progress value={item.value} className="h-1.5" />
          </div>
        ))}
      </div>

      {/* Missing Docs */}
      {missingDocs.length > 0 && (
        <div className="rounded-lg border border-border/30 bg-card p-4 space-y-2">
          <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3 text-amber-500" /> Missing Documents ({missingDocs.length})
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {missingDocs.slice(0, 10).map(doc => (
              <Badge key={doc.id} variant="outline" className="text-[9px] font-mono text-muted-foreground">
                {doc.title}
              </Badge>
            ))}
            {missingDocs.length > 10 && (
              <Badge variant="outline" className="text-[9px] font-mono text-muted-foreground">
                +{missingDocs.length - 10} more
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Top 3 Recommendations */}
      <div className="rounded-lg border border-border/30 bg-card p-4 space-y-3">
        <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Target className="h-3 w-3 text-primary" /> Top Distributor Matches
        </h4>
        {topMatches.map(({ distributor, score, reasons }, i) => (
          <div key={distributor.id} className="rounded-lg bg-muted/20 p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-muted-foreground">#{i + 1}</span>
                <span className="text-sm font-semibold text-foreground">{distributor.name}</span>
              </div>
              <Badge variant={score >= 70 ? "default" : "outline"} className="text-[9px] font-mono">
                {score}% fit
              </Badge>
            </div>
            <div className="flex flex-wrap gap-1">
              {reasons.map((r, j) => (
                <span key={j} className="text-[9px] font-mono px-1.5 py-0.5 bg-secondary rounded-full text-secondary-foreground flex items-center gap-0.5">
                  <CheckCircle2 className="h-2.5 w-2.5" /> {r}
                </span>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">{distributor.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
