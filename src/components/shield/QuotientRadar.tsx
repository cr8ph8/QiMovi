import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";

import type { ShieldScores } from "@/lib/shield/scoring";

interface Props {
  scores: ShieldScores;
}

export function QuotientRadar({ scores }: Props) {
  const data = [
    { axis: "Syntax", value: scores.syntax_quotient },
    { axis: "Rhythm", value: scores.rhythm_quotient },
    { axis: "Dialogue", value: scores.dialogue_quotient },
    { axis: "Scene Arch.", value: scores.scene_architecture_quotient },
    { axis: "Theme", value: scores.theme_quotient },
    { axis: "Char. Pressure", value: scores.character_pressure_quotient },
    { axis: "Emotion", value: scores.emotional_temperature_quotient },
    { axis: "Genre", value: scores.genre_convention_quotient },
    { axis: "Culture", value: scores.cultural_texture_quotient },
    { axis: "Provenance", value: scores.provenance_quotient },
  ];

  return (
    <div className="w-full h-[360px]">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="78%">
          <PolarGrid stroke="hsl(var(--border))" />
          <PolarAngleAxis
            dataKey="axis"
            tick={{
              fill: "hsl(var(--muted-foreground))",
              fontSize: 10,
              fontFamily: "JetBrains Mono",
            }}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }}
            stroke="hsl(var(--border))"
          />
          <Radar
            name="Quotient"
            dataKey="value"
            stroke="hsl(var(--gold))"
            fill="hsl(var(--gold))"
            fillOpacity={0.25}
            strokeWidth={2}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
