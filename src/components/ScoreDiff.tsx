interface ScoreObj {
  narrative?: number;
  character_score?: number;
  emotional?: number;
  visual?: number;
  market?: number;
  franchise?: number;
  production?: number;
  audience?: number;
  originality?: number;
  structure?: number;
  character_depth?: number;
  dialogue?: number;
  theme?: number;
  emotion?: number;
  format_adherence?: number;
  total_score: number;
}

const IPQ_CATEGORIES: { key: string; label: string; max: number }[] = [
  { key: "narrative", label: "Narrative", max: 10 },
  { key: "character_score", label: "Character", max: 10 },
  { key: "emotional", label: "Emotional", max: 10 },
  { key: "visual", label: "Visual", max: 10 },
  { key: "market", label: "Market", max: 10 },
  { key: "franchise", label: "Franchise", max: 10 },
  { key: "production", label: "Production", max: 10 },
  { key: "audience", label: "Audience", max: 10 },
];

const LEGACY_CATEGORIES: { key: string; label: string; max: number }[] = [
  { key: "originality", label: "Originality", max: 20 },
  { key: "structure", label: "Structure", max: 20 },
  { key: "character_depth", label: "Character", max: 15 },
  { key: "dialogue", label: "Dialogue", max: 15 },
  { key: "theme", label: "Theme", max: 10 },
  { key: "emotion", label: "Emotion", max: 10 },
  { key: "format_adherence", label: "Format", max: 10 },
];

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return <span className="text-xs font-mono text-muted-foreground">—</span>;
  const positive = delta > 0;
  return (
    <span className={`text-xs font-mono font-semibold ${positive ? "text-emerald-500" : "text-destructive"}`}>
      {positive ? "+" : ""}{delta}
    </span>
  );
}

export default function ScoreDiff({ current, previous }: { current: ScoreObj; previous: ScoreObj }) {
  const totalDelta = current.total_score - previous.total_score;

  // Detect which scoring system by checking IPQ dimensions
  const hasIPQ = IPQ_CATEGORIES.some((c) => (current as any)[c.key] > 0);
  const categories = hasIPQ ? IPQ_CATEGORIES : LEGACY_CATEGORIES;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between pb-2 border-b border-border/50">
        <span className="text-sm font-display font-semibold">Total Score</span>
        <div className="flex items-center gap-3">
          <span className="font-mono text-muted-foreground text-sm">{previous.total_score}</span>
          <span className="text-muted-foreground">→</span>
          <span className="font-mono text-primary text-sm font-bold">{current.total_score}</span>
          <DeltaBadge delta={totalDelta} />
        </div>
      </div>
      {categories.map((cat) => {
        const delta = ((current as any)[cat.key] || 0) - ((previous as any)[cat.key] || 0);
        return (
          <div key={cat.key} className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{cat.label}</span>
            <div className="flex items-center gap-3">
              <span className="font-mono text-muted-foreground text-xs">{(previous as any)[cat.key] || 0}</span>
              <span className="text-muted-foreground text-xs">→</span>
              <span className="font-mono text-xs">{(current as any)[cat.key] || 0}/{cat.max}</span>
              <DeltaBadge delta={delta} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
