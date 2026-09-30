import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Legend } from "recharts";

interface ScoreSet {
  // IPQ dimensions
  narrative?: number;
  character_score?: number;
  emotional?: number;
  visual?: number;
  market?: number;
  franchise?: number;
  production?: number;
  audience?: number;
  // Legacy dimensions
  originality?: number;
  structure?: number;
  character_depth?: number;
  dialogue?: number;
  theme?: number;
  emotion?: number;
  format_adherence?: number;
}

export interface MultiScoreEntry {
  scores: ScoreSet;
  modelId: string;
  color: string;
  label: string;
}

interface ScoreChartProps {
  scores: ScoreSet;
  /** Optional: up to 3 overlaid score sets for multi-model comparison */
  allScores?: MultiScoreEntry[];
}

const IPQ_CATEGORIES = [
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

const LEGACY_CATEGORIES = [
  { key: "originality", label: "Originality", max: 20 },
  { key: "structure", label: "Structure", max: 20 },
  { key: "character_depth", label: "Character", max: 15 },
  { key: "dialogue", label: "Dialogue", max: 15 },
  { key: "theme", label: "Theme", max: 10 },
  { key: "emotion", label: "Emotion", max: 10 },
  { key: "format_adherence", label: "Format", max: 10 },
];

export default function ScoreChart({ scores, allScores }: ScoreChartProps) {
  const hasIPQ = IPQ_CATEGORIES.some((c) => (scores as any)[c.key] > 0);
  const categories = hasIPQ ? IPQ_CATEGORIES : LEGACY_CATEGORIES;

  // Multi-model mode
  if (allScores && allScores.length > 1) {
    const data = categories.map((c) => {
      const row: Record<string, any> = { category: c.label };
      allScores.forEach((entry, i) => {
        row[`score_${i}`] = (((entry.scores as any)[c.key] || 0) / c.max) * 100;
      });
      return row;
    });

    return (
      <ResponsiveContainer width="100%" height={320}>
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="65%">
          <PolarGrid stroke="hsl(var(--border))" />
          <PolarAngleAxis
            dataKey="category"
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10, fontFamily: "Inter" }}
          />
          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
          {allScores.map((entry, i) => (
            <Radar
              key={entry.modelId + i}
              name={entry.label}
              dataKey={`score_${i}`}
              stroke={entry.color}
              fill={entry.color}
              fillOpacity={0.1}
              strokeWidth={2}
            />
          ))}
          <Legend
            wrapperStyle={{ fontSize: 10, fontFamily: "Inter" }}
            iconType="circle"
            iconSize={8}
          />
        </RadarChart>
      </ResponsiveContainer>
    );
  }

  // Single score mode (backward compatible)
  const data = categories.map((c) => ({
    category: c.label,
    value: (scores as any)[c.key] || 0,
    max: c.max,
    normalized: (((scores as any)[c.key] || 0) / c.max) * 100,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
        <PolarGrid stroke="hsl(220, 14%, 16%)" />
        <PolarAngleAxis
          dataKey="category"
          tick={{ fill: "hsl(220, 10%, 50%)", fontSize: 11, fontFamily: "Inter" }}
        />
        <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
        <Radar
          name="Score"
          dataKey="normalized"
          stroke="hsl(42, 78%, 55%)"
          fill="hsl(42, 78%, 55%)"
          fillOpacity={0.2}
          strokeWidth={2}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
