// StabilityMeter — visualises agreement among judges on a panel.
// Pure presentational: takes per-judge dimension scores and computes
// per-dimension coefficient of variation, then an overall stability score.
import { useMemo } from "react";
import { Activity } from "lucide-react";

interface PanelRow {
  submitted: boolean;
  dimension_scores: Record<string, number>;
}

interface Dimension {
  key: string;
  label: string;
}

interface Props {
  rows: PanelRow[];
  dimensions: Dimension[];
}

function mean(v: number[]) {
  return v.reduce((a, b) => a + b, 0) / v.length;
}
function cv(v: number[]) {
  if (v.length < 2) return 0;
  const m = mean(v);
  if (m === 0) return 0;
  const sd = Math.sqrt(mean(v.map((x) => (x - m) ** 2)));
  return sd / m;
}

function scoreLabel(score: number): { label: string; tone: string } {
  if (score >= 85) return { label: "stable", tone: "text-emerald-500" };
  if (score >= 60) return { label: "moderate drift", tone: "text-yellow-500" };
  if (score >= 40) return { label: "unstable", tone: "text-orange-500" };
  return { label: "high variance", tone: "text-red-500" };
}

export function StabilityMeter({ rows, dimensions }: Props) {
  const submitted = rows.filter((r) => r.submitted);

  const perDim = useMemo(() => {
    return dimensions.map((d) => {
      const vals = submitted
        .map((r) => r.dimension_scores?.[d.key])
        .filter((n): n is number => typeof n === "number" && !Number.isNaN(n));
      const c = cv(vals);
      const score = Math.round(Math.max(0, Math.min(100, (1 - c / 0.4) * 100)));
      return { ...d, n: vals.length, cv: c, score };
    });
  }, [dimensions, submitted]);

  const withData = perDim.filter((d) => d.n >= 2);
  const overall = withData.length === 0
    ? 100
    : Math.round(withData.reduce((s, d) => s + d.score, 0) / withData.length);

  const { label, tone } = scoreLabel(overall);

  if (submitted.length < 2) {
    return (
      <div className="rounded-md border border-border/40 bg-card/50 p-3 mb-3 text-xs text-muted-foreground flex items-center gap-2">
        <Activity className="h-3.5 w-3.5" />
        Stability meter activates after 2+ judges submit scores.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border/40 bg-card/50 p-3 mb-3">
      <div className="flex items-baseline justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
          <Activity className="h-3.5 w-3.5" />
          Panel Stability
        </div>
        <div className="text-right">
          <span className="text-lg font-bold tabular-nums">{overall}</span>
          <span className={`ml-2 text-[10px] uppercase tracking-wider ${tone}`}>{label}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
        {perDim.map((d) => (
          <div
            key={d.key}
            className="rounded border border-border/30 bg-background/40 px-2 py-1.5"
            title={`n=${d.n} • cv=${d.cv.toFixed(2)}`}
          >
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
              {d.label}
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-sm font-semibold tabular-nums">
                {d.n >= 2 ? d.score : "—"}
              </span>
              <span className="text-[9px] text-muted-foreground">
                {d.n >= 2 ? scoreLabel(d.score).label : `n=${d.n}`}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
