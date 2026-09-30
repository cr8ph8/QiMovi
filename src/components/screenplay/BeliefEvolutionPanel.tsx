import { useMemo } from "react";
import { FountainParseResult } from "@/lib/fountain-parser";
import CollapsibleSection from "@/components/CollapsibleSection";
import { Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

/* ── Sentiment keywords (mirrors character.ts) ── */

const POS = new Set([
  "love","great","good","happy","beautiful","wonderful","amazing","fantastic",
  "brilliant","perfect","hope","thank","thanks","please","yes","right",
  "best","better","glad","nice","fine","well","okay","sure","absolutely",
  "incredible","excellent","joy","dream","trust","kind","sweet","proud",
]);

const NEG = new Set([
  "hate","bad","terrible","awful","horrible","never","no","not","don't",
  "can't","won't","kill","die","dead","death","damn","hell","stop",
  "wrong","worse","worst","afraid","fear","sorry","hurt","pain",
  "angry","rage","stupid","fool","shut","liar","lie","betrayed","lost",
]);

interface BeliefPoint {
  sceneIndex: number;
  heading: string;
  positiveRatio: number;
  negativeRatio: number;
  confidence: number; // 0-1
  shift: "positive" | "negative" | "neutral";
}

interface CharacterBelief {
  name: string;
  points: BeliefPoint[];
}

function computeBeliefEvolution(parsed: FountainParseResult): CharacterBelief[] {
  const { elements, scenes, stats } = parsed;
  const topChars = stats.uniqueCharacters
    .map((name) => ({ name, count: stats.characterDialogueCounts[name] || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .map((c) => c.name);

  if (topChars.length === 0 || scenes.length === 0) return [];

  return topChars.map((charName) => {
    const points: BeliefPoint[] = [];

    scenes.forEach((scene, si) => {
      const elStart = scene.elementIndex;
      const elEnd = si < scenes.length - 1 ? scenes[si + 1].elementIndex : elements.length;

      const lines: string[] = [];
      let currentChar = "";
      for (let ei = elStart; ei < elEnd; ei++) {
        const el = elements[ei];
        if (el.type === "character") {
          currentChar = el.text.replace(/\s*\(.*\)$/, "").trim();
        } else if (el.type === "dialogue" && currentChar === charName) {
          lines.push(el.text);
        } else if (el.type !== "parenthetical") {
          currentChar = "";
        }
      }

      if (lines.length === 0) return;

      let posCount = 0, negCount = 0, totalWords = 0;
      for (const line of lines) {
        const ws = line.toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean);
        totalWords += ws.length;
        for (const w of ws) {
          if (POS.has(w)) posCount++;
          if (NEG.has(w)) negCount++;
        }
      }

      if (totalWords === 0) return;

      const posR = posCount / totalWords;
      const negR = negCount / totalWords;
      const total = posR + negR || 1;

      const positiveRatio = posR / total;
      const negativeRatio = negR / total;
      const confidence = Math.min(1, (posCount + negCount) / Math.max(totalWords * 0.1, 1));

      let shift: BeliefPoint["shift"] = "neutral";
      if (posR > negR * 1.3) shift = "positive";
      else if (negR > posR * 1.3) shift = "negative";

      points.push({
        sceneIndex: si,
        heading: scene.heading,
        positiveRatio,
        negativeRatio,
        confidence,
        shift,
      });
    });

    return { name: charName, points };
  }).filter((c) => c.points.length >= 2);
}

/* ── Confidence Bar ── */

function ConfidenceBar({ point, index }: { point: BeliefPoint; index: number }) {
  const posWidth = Math.round(point.positiveRatio * 100);
  const negWidth = Math.round(point.negativeRatio * 100);

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="flex items-center gap-2"
    >
      <span className="text-[8px] font-mono text-muted-foreground w-4 shrink-0 text-right">{point.sceneIndex + 1}</span>
      <div className="flex-1 flex h-2.5 rounded-full overflow-hidden bg-muted/30">
        <div
          className="bg-emerald-500/60 transition-all"
          style={{ width: `${posWidth}%` }}
        />
        <div
          className="bg-muted-foreground/20 transition-all"
          style={{ width: `${100 - posWidth - negWidth}%` }}
        />
        <div
          className="bg-red-400/60 transition-all"
          style={{ width: `${negWidth}%` }}
        />
      </div>
      <span className={cn(
        "text-[8px] font-mono w-6 shrink-0",
        point.shift === "positive" ? "text-emerald-500" : point.shift === "negative" ? "text-red-400" : "text-muted-foreground"
      )}>
        {point.shift === "positive" ? "↑" : point.shift === "negative" ? "↓" : "—"}
      </span>
    </motion.div>
  );
}

/* ── Character Section ── */

function CharacterBeliefSection({ belief }: { belief: CharacterBelief }) {
  return (
    <div className="space-y-1.5">
      <h5 className="text-[10px] font-mono font-bold text-foreground">{belief.name}</h5>
      <div className="space-y-0.5">
        {belief.points.map((p, i) => (
          <ConfidenceBar key={`${p.sceneIndex}`} point={p} index={i} />
        ))}
      </div>
      <div className="flex items-center gap-4 text-[8px] font-mono text-muted-foreground pt-0.5">
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500/60" /> Positive</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-red-400/60" /> Negative</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/20" /> Neutral</span>
      </div>
    </div>
  );
}

/* ── Main Panel ── */

interface BeliefEvolutionPanelProps {
  parsed: FountainParseResult;
}

export default function BeliefEvolutionPanel({ parsed }: BeliefEvolutionPanelProps) {
  const beliefs = useMemo(() => computeBeliefEvolution(parsed), [parsed]);

  if (beliefs.length === 0) return null;

  return (
    <CollapsibleSection
      icon={<Brain className="h-3.5 w-3.5 text-primary" />}
      title="Belief Evolution"
      subtitle="Sentiment stance shifts across scenes"
      badge={`${beliefs.length} chars`}
    >
      <div className="space-y-4">
        {beliefs.map((b) => (
          <CharacterBeliefSection key={b.name} belief={b} />
        ))}
      </div>
    </CollapsibleSection>
  );
}
