/**
 * NarrativeContinuityPanel — computes and displays continuity signals across
 * screenplay drafts. Uses canonical parsed data (FountainParseResult) to
 * identify character, world, and theme continuity patterns.
 * 
 * All signals are descriptive — drift is not labeled negative.
 */
import { useMemo } from "react";
import { parseFountain, FountainParseResult } from "@/lib/fountain-parser";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Users, MapPin, Sparkles, Activity, TrendingUp, Minus, ArrowUpRight, ArrowDownRight,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DraftInput {
  draft_number: number;
  script_text: string;
}

interface NarrativeContinuityPanelProps {
  drafts: DraftInput[];
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// Continuity analysis helpers
// ---------------------------------------------------------------------------

interface ContinuityLevel {
  label: string;
  color: string;
  badgeVariant: "default" | "secondary" | "outline";
}

function classifyContinuity(variationCoeff: number): ContinuityLevel {
  if (variationCoeff <= 0.15) return { label: "Stable", color: "text-emerald-500", badgeVariant: "secondary" };
  if (variationCoeff <= 0.4) return { label: "Moderate variation", color: "text-amber-500", badgeVariant: "outline" };
  return { label: "High variation", color: "text-orange-500", badgeVariant: "outline" };
}

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

// ---------------------------------------------------------------------------
// Character continuity
// ---------------------------------------------------------------------------

interface CharacterSignal {
  name: string;
  presenceCounts: number[]; // dialogue blocks per draft
  cv: number;
  level: ContinuityLevel;
  trend: "up" | "down" | "stable";
}

function analyzeCharacterContinuity(snapshots: FountainParseResult[]): CharacterSignal[] {
  const allChars = new Set<string>();
  for (const s of snapshots) {
    for (const c of s.stats.uniqueCharacters) allChars.add(c);
  }

  const signals: CharacterSignal[] = [];
  for (const name of allChars) {
    const counts = snapshots.map((s) => s.stats.characterDialogueCounts[name] || 0);
    const cv = coefficientOfVariation(counts);
    const first = counts[0] || 0;
    const last = counts[counts.length - 1] || 0;
    const trend = last > first + 1 ? "up" : last < first - 1 ? "down" : "stable";
    signals.push({ name, presenceCounts: counts, cv, level: classifyContinuity(cv), trend });
  }

  return signals.sort((a, b) => b.cv - a.cv);
}

// ---------------------------------------------------------------------------
// World / location continuity
// ---------------------------------------------------------------------------

interface LocationSignal {
  heading: string;
  appearances: number[]; // count per draft
  cv: number;
  level: ContinuityLevel;
}

function analyzeLocationContinuity(snapshots: FountainParseResult[]): LocationSignal[] {
  const allLocations = new Set<string>();
  for (const s of snapshots) {
    for (const sc of s.scenes) {
      const loc = sc.heading.replace(/^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s*/i, "").replace(/\s*-\s*.*$/, "").trim().toUpperCase();
      if (loc) allLocations.add(loc);
    }
  }

  const signals: LocationSignal[] = [];
  for (const loc of allLocations) {
    const counts = snapshots.map((s) => {
      return s.scenes.filter((sc) => {
        const h = sc.heading.replace(/^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s*/i, "").replace(/\s*-\s*.*$/, "").trim().toUpperCase();
        return h === loc;
      }).length;
    });
    const cv = coefficientOfVariation(counts);
    signals.push({ heading: loc, appearances: counts, cv, level: classifyContinuity(cv) });
  }

  return signals.sort((a, b) => b.cv - a.cv);
}

// ---------------------------------------------------------------------------
// Thematic keyword continuity
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "is", "it", "he", "she",
  "they", "we", "you", "i", "my", "your", "his", "her", "its", "our", "their", "this", "that", "with",
  "from", "as", "be", "was", "were", "been", "are", "am", "do", "does", "did", "will", "would", "could",
  "should", "can", "may", "might", "shall", "have", "has", "had", "not", "no", "so", "if", "then",
  "than", "too", "very", "just", "about", "up", "out", "into", "over", "after", "before", "between",
  "under", "through", "during", "all", "each", "every", "both", "few", "more", "most", "other", "some",
  "such", "only", "same", "also", "back", "there", "here", "where", "when", "how", "what", "which",
  "who", "whom", "why", "one", "two", "now", "new", "like", "make", "know", "take", "come", "see",
  "get", "go", "say", "look", "him", "them", "us", "me", "down", "off", "away", "well", "still",
  "even", "again", "right", "left", "long", "around", "cont", "cont'd", "beat", "ext", "int",
]);

interface ThemeSignal {
  word: string;
  frequencies: number[]; // per-draft normalized freq (per 1000 words)
  cv: number;
  level: ContinuityLevel;
  trend: "up" | "down" | "stable";
}

function analyzeThemeContinuity(snapshots: FountainParseResult[]): ThemeSignal[] {
  // Extract word frequency maps per draft
  const draftFreqs: Map<string, number>[] = snapshots.map((s) => {
    const map = new Map<string, number>();
    const totalWords = s.stats.wordCount || 1;
    for (const el of s.elements) {
      if (el.type !== "dialogue" && el.type !== "action") continue;
      const words = el.text.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !STOP_WORDS.has(w));
      for (const w of words) {
        map.set(w, (map.get(w) || 0) + 1);
      }
    }
    // Normalize per 1000 words
    for (const [k, v] of map) {
      map.set(k, (v / totalWords) * 1000);
    }
    return map;
  });

  // Find words that appear in at least 2 drafts
  const allWords = new Map<string, number>();
  for (const fm of draftFreqs) {
    for (const w of fm.keys()) {
      allWords.set(w, (allWords.get(w) || 0) + 1);
    }
  }

  const signals: ThemeSignal[] = [];
  for (const [word, draftCount] of allWords) {
    if (draftCount < 2) continue;
    const freqs = draftFreqs.map((fm) => fm.get(word) || 0);
    const cv = coefficientOfVariation(freqs);
    const first = freqs[0];
    const last = freqs[freqs.length - 1];
    const trend = last > first * 1.2 ? "up" : last < first * 0.8 ? "down" : "stable";
    signals.push({ word, frequencies: freqs, cv, level: classifyContinuity(cv), trend });
  }

  return signals.sort((a, b) => b.cv - a.cv).slice(0, 15);
}

// ---------------------------------------------------------------------------
// Overall drift summary
// ---------------------------------------------------------------------------

interface DriftSummary {
  characterCV: number;
  locationCV: number;
  themeCV: number;
  overallCV: number;
  level: ContinuityLevel;
}

function computeDriftSummary(charSignals: CharacterSignal[], locSignals: LocationSignal[], themeSignals: ThemeSignal[]): DriftSummary {
  const avgCV = (items: { cv: number }[]) => items.length > 0 ? items.reduce((s, i) => s + i.cv, 0) / items.length : 0;
  const characterCV = avgCV(charSignals);
  const locationCV = avgCV(locSignals);
  const themeCV = avgCV(themeSignals);
  const overallCV = (characterCV + locationCV + themeCV) / 3;
  return { characterCV, locationCV, themeCV, overallCV, level: classifyContinuity(overallCV) };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function TrendIcon({ trend }: { trend: "up" | "down" | "stable" }) {
  if (trend === "up") return <ArrowUpRight className="h-3 w-3 text-muted-foreground" />;
  if (trend === "down") return <ArrowDownRight className="h-3 w-3 text-muted-foreground" />;
  return <Minus className="h-3 w-3 text-muted-foreground" />;
}

export default function NarrativeContinuityPanel({ drafts, compact = false }: NarrativeContinuityPanelProps) {
  const analysis = useMemo(() => {
    if (drafts.length < 2) return null;
    const sorted = [...drafts].sort((a, b) => a.draft_number - b.draft_number);
    const snapshots = sorted.map((d) => parseFountain(d.script_text || ""));

    const charSignals = analyzeCharacterContinuity(snapshots);
    const locSignals = analyzeLocationContinuity(snapshots);
    const themeSignals = analyzeThemeContinuity(snapshots);
    const drift = computeDriftSummary(charSignals, locSignals, themeSignals);

    return { charSignals, locSignals, themeSignals, drift, draftCount: sorted.length };
  }, [drafts]);

  if (!analysis) {
    return (
      <p className="text-xs text-muted-foreground text-center py-4">
        Continuity signals require at least two drafts.
      </p>
    );
  }

  const { charSignals, locSignals, themeSignals, drift } = analysis;

  // ── Compact ──
  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium">Continuity</span>
          <Badge variant={drift.level.badgeVariant} className={cn("text-[10px]", drift.level.color)}>
            {drift.level.label}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          <Badge variant="outline" className="gap-1"><Users className="h-2.5 w-2.5" /> Characters: {classifyContinuity(drift.characterCV).label}</Badge>
          <Badge variant="outline" className="gap-1"><MapPin className="h-2.5 w-2.5" /> Locations: {classifyContinuity(drift.locationCV).label}</Badge>
          <Badge variant="outline" className="gap-1"><Sparkles className="h-2.5 w-2.5" /> Themes: {classifyContinuity(drift.themeCV).label}</Badge>
        </div>
      </div>
    );
  }

  // ── Full view ──
  return (
    <div className="space-y-5">
      {/* Overall drift summary */}
      <div className="flex items-center gap-3">
        <Activity className="h-5 w-5 text-primary" />
        <div>
          <p className="text-sm font-medium">Narrative Continuity Signals</p>
          <p className="text-xs text-muted-foreground">Across {analysis.draftCount} drafts</p>
        </div>
        <Badge variant={drift.level.badgeVariant} className={cn("ml-auto text-xs", drift.level.color)}>
          {drift.level.label}
        </Badge>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Characters", cv: drift.characterCV, icon: Users, count: charSignals.length },
          { label: "Locations", cv: drift.locationCV, icon: MapPin, count: locSignals.length },
          { label: "Themes", cv: drift.themeCV, icon: Sparkles, count: themeSignals.length },
        ].map((item) => {
          const level = classifyContinuity(item.cv);
          return (
            <div key={item.label} className="rounded-lg border border-border bg-muted/20 p-3 space-y-1">
              <div className="flex items-center gap-1.5">
                <item.icon className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium">{item.label}</span>
              </div>
              <Badge variant={level.badgeVariant} className={cn("text-[10px]", level.color)}>{level.label}</Badge>
              <p className="text-[10px] text-muted-foreground">{item.count} tracked</p>
            </div>
          );
        })}
      </div>

      {/* Character continuity details */}
      {charSignals.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> Character Continuity
          </h4>
          <div className="space-y-1">
            {charSignals.slice(0, 8).map((cs) => (
              <div key={cs.name} className="flex items-center gap-2 text-xs bg-muted/20 rounded px-2.5 py-1.5">
                <span className="font-medium truncate flex-1">{cs.name}</span>
                <TrendIcon trend={cs.trend} />
                <Badge variant={cs.level.badgeVariant} className={cn("text-[10px] px-1.5", cs.level.color)}>
                  {cs.level.label}
                </Badge>
                <span className="text-[10px] text-muted-foreground tabular-nums w-16 text-right">
                  {cs.presenceCounts.map((c) => c).join(" → ")}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Location continuity details */}
      {locSignals.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" /> Location Continuity
          </h4>
          <div className="space-y-1">
            {locSignals.slice(0, 6).map((ls) => (
              <div key={ls.heading} className="flex items-center gap-2 text-xs bg-muted/20 rounded px-2.5 py-1.5">
                <span className="font-medium truncate flex-1">{ls.heading}</span>
                <Badge variant={ls.level.badgeVariant} className={cn("text-[10px] px-1.5", ls.level.color)}>
                  {ls.level.label}
                </Badge>
                <span className="text-[10px] text-muted-foreground tabular-nums w-16 text-right">
                  {ls.appearances.join(" → ")}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Theme continuity details */}
      {themeSignals.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> Theme Continuity
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {themeSignals.map((ts) => (
              <Badge key={ts.word} variant={ts.level.badgeVariant} className={cn("text-xs gap-1", ts.level.color)}>
                {ts.word}
                <TrendIcon trend={ts.trend} />
              </Badge>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
