import { useMemo } from "react";
import { FountainParseResult } from "@/lib/fountain-parser";
import AdaptationPathwayPanel from "@/components/screenplay/AdaptationPathwayPanel";
import StoryWorldPanel from "@/components/StoryWorldPanel";
import ProjectMemoryGraph from "@/components/ProjectMemoryGraph";
import NarrativeContinuityPanel from "@/components/NarrativeContinuityPanel";
import DevelopmentTrajectoryPanel from "@/components/DevelopmentTrajectoryPanel";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { BarChart3, Activity, MessageSquare, Clapperboard, Hash, TrendingUp } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from "recharts";

interface NarrativeIntelligencePanelProps {
  parsed: FountainParseResult;
  entryId?: string;
  drafts?: { draft_number: number; script_text: string }[];
}

/** Compute per-scene line counts */
function computeSceneMetrics(parsed: FountainParseResult) {
  const { scenes, elements } = parsed;
  return scenes.map((scene, idx) => {
    const nextElIdx = idx < scenes.length - 1 ? scenes[idx + 1].elementIndex : elements.length;
    const slice = elements.slice(scene.elementIndex, nextElIdx);
    const dialogue = slice.filter((e) => e.type === "dialogue").length;
    const action = slice.filter((e) => e.type === "action").length;
    const total = slice.filter((e) => e.type !== "empty" && e.type !== "page_break").length;
    const chars = new Set(slice.filter((e) => e.type === "character").map((e) => e.text.replace(/\s*\(.*\)$/, "").trim()));
    return { index: idx + 1, heading: scene.heading, dialogue, action, total, charCount: chars.size };
  });
}

/** Extract recurring thematic keywords from action + dialogue text */
function extractThematicKeywords(parsed: FountainParseResult, topN = 20): { word: string; count: number }[] {
  const STOP = new Set([
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

  const freq = new Map<string, number>();
  for (const el of parsed.elements) {
    if (el.type !== "dialogue" && el.type !== "action") continue;
    const words = el.text.toLowerCase().replace(/[^a-z'\s-]/g, "").split(/\s+/).filter(Boolean);
    for (const w of words) {
      if (w.length < 3 || STOP.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }

  return Array.from(freq.entries())
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));
}

export default function NarrativeIntelligencePanel({ parsed, entryId, drafts }: NarrativeIntelligencePanelProps) {
  const { scenes, stats, elements } = parsed;

  const sceneMetrics = useMemo(() => computeSceneMetrics(parsed), [parsed]);

  // Act distribution (rough thirds)
  const actDistribution = useMemo(() => {
    if (scenes.length < 3) return null;
    const third = Math.ceil(scenes.length / 3);
    const acts = [
      { act: "Act I", scenes: sceneMetrics.slice(0, third) },
      { act: "Act II", scenes: sceneMetrics.slice(third, third * 2) },
      { act: "Act III", scenes: sceneMetrics.slice(third * 2) },
    ];
    return acts.map((a) => ({
      act: a.act,
      sceneCount: a.scenes.length,
      totalLines: a.scenes.reduce((s, m) => s + m.total, 0),
      dialogueLines: a.scenes.reduce((s, m) => s + m.dialogue, 0),
      actionLines: a.scenes.reduce((s, m) => s + m.action, 0),
    }));
  }, [scenes, sceneMetrics]);

  // Pacing: scene length variation
  const pacingSignals = useMemo(() => {
    if (sceneMetrics.length < 2) return null;
    const lengths = sceneMetrics.map((m) => m.total);
    const avg = lengths.reduce((s, v) => s + v, 0) / lengths.length;
    const variance = lengths.reduce((s, v) => s + (v - avg) ** 2, 0) / lengths.length;
    const stdDev = Math.sqrt(variance);
    const cv = avg > 0 ? stdDev / avg : 0;
    const max = Math.max(...lengths);
    const min = Math.min(...lengths);

    // Dialogue density per scene for rhythm
    const dialogueDensities = sceneMetrics.map((m) => (m.total > 0 ? m.dialogue / m.total : 0));
    const avgDensity = dialogueDensities.reduce((s, v) => s + v, 0) / dialogueDensities.length;
    const densityVariance = dialogueDensities.reduce((s, v) => s + (v - avgDensity) ** 2, 0) / dialogueDensities.length;
    const densityCV = avgDensity > 0 ? Math.sqrt(densityVariance) / avgDensity : 0;

    let rhythmLabel: string;
    if (cv < 0.3) rhythmLabel = "Uniform";
    else if (cv < 0.6) rhythmLabel = "Moderate variation";
    else rhythmLabel = "High variation";

    return { avg: Math.round(avg), stdDev: Math.round(stdDev), cv, max, min, rhythmLabel, densityCV };
  }, [sceneMetrics]);

  // Dialogue share by character
  const dialogueShare = useMemo(() => {
    const sorted = Object.entries(stats.characterDialogueCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
    const total = sorted.reduce((s, [, c]) => s + c, 0);
    return sorted.map(([name, count]) => ({
      name: name.length > 14 ? name.slice(0, 12) + "…" : name,
      count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
    }));
  }, [stats.characterDialogueCounts]);

  // Scene length chart data
  const sceneLengthData = useMemo(
    () => sceneMetrics.map((m) => ({ name: `S${m.index}`, lines: m.total, dialogue: m.dialogue, action: m.action })),
    [sceneMetrics]
  );

  // Longest / shortest
  const sortedByLength = useMemo(
    () => [...sceneMetrics].sort((a, b) => b.total - a.total),
    [sceneMetrics]
  );

  // Thematic keywords
  const keywords = useMemo(() => extractThematicKeywords(parsed), [parsed]);
  const maxKeywordCount = keywords.length > 0 ? keywords[0].count : 1;

  if (scenes.length === 0) {
    return (
      <div className="p-8 text-center">
        <BarChart3 className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No scenes parsed. Upload and parse a screenplay to view narrative intelligence.</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 mt-0">
      {/* ── Structural Overview ── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="h-4 w-4 text-primary" />
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Structural Overview</span>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="rounded-lg bg-muted/40 p-3 text-center">
            <p className="text-lg font-mono font-bold text-foreground">{stats.sceneCount}</p>
            <p className="text-[10px] font-mono text-muted-foreground uppercase">Scenes</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3 text-center">
            <p className="text-lg font-mono font-bold text-foreground">
              {stats.dialogueBlockCount + stats.actionLineCount > 0
                ? Math.round((stats.dialogueBlockCount / (stats.dialogueBlockCount + stats.actionLineCount)) * 100)
                : 0}%
            </p>
            <p className="text-[10px] font-mono text-muted-foreground uppercase">Dialogue</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3 text-center">
            <p className="text-lg font-mono font-bold text-foreground">
              {stats.dialogueBlockCount + stats.actionLineCount > 0
                ? Math.round((stats.actionLineCount / (stats.dialogueBlockCount + stats.actionLineCount)) * 100)
                : 0}%
            </p>
            <p className="text-[10px] font-mono text-muted-foreground uppercase">Action</p>
          </div>
        </div>

        {actDistribution && (
          <div className="space-y-1.5">
            {actDistribution.map((a) => {
              const total = actDistribution.reduce((s, x) => s + x.totalLines, 0) || 1;
              const pct = Math.round((a.totalLines / total) * 100);
              return (
                <div key={a.act} className="flex items-center gap-2">
                  <span className="text-[10px] font-mono w-12 shrink-0 text-foreground">{a.act}</span>
                  <div className="flex-1 h-3 bg-muted/30 rounded-full overflow-hidden">
                    <div className="h-full bg-primary/50 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground w-16 text-right">
                    {a.sceneCount}sc · {pct}%
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Pacing Signals ── */}
      {pacingSignals && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Activity className="h-4 w-4 text-primary" />
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Pacing Signals</span>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="rounded-lg bg-muted/40 p-3 text-center">
              <p className="text-lg font-mono font-bold text-foreground">{pacingSignals.avg}</p>
              <p className="text-[10px] font-mono text-muted-foreground uppercase">Avg Scene Length</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3 text-center">
              <p className="text-lg font-mono font-bold text-foreground">{pacingSignals.rhythmLabel}</p>
              <p className="text-[10px] font-mono text-muted-foreground uppercase">Rhythm</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3 text-center">
              <p className="text-lg font-mono font-bold text-foreground">{pacingSignals.min}</p>
              <p className="text-[10px] font-mono text-muted-foreground uppercase">Shortest</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3 text-center">
              <p className="text-lg font-mono font-bold text-foreground">{pacingSignals.max}</p>
              <p className="text-[10px] font-mono text-muted-foreground uppercase">Longest</p>
            </div>
          </div>
          <div className="rounded-lg border border-border/30 bg-muted/10 p-2 text-[10px] font-mono text-muted-foreground">
            <TrendingUp className="h-3 w-3 inline mr-1 text-primary" />
            Dialogue density variation: {pacingSignals.densityCV < 0.3 ? "Consistent" : pacingSignals.densityCV < 0.6 ? "Moderate shifts" : "Significant shifts"} across scenes
          </div>
        </section>
      )}

      {/* ── Scene Distribution ── */}
      {sceneLengthData.length > 1 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Clapperboard className="h-4 w-4 text-primary" />
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Scene Length Distribution</span>
          </div>
          <div className="h-[140px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sceneLengthData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" />
                <XAxis dataKey="name" tick={{ fontSize: 8, fontFamily: "monospace" }} interval={Math.max(0, Math.floor(sceneLengthData.length / 15))} />
                <YAxis tick={{ fontSize: 8, fontFamily: "monospace" }} />
                <Tooltip
                  contentStyle={{ fontSize: 10, fontFamily: "monospace", background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                />
                <Bar dataKey="lines" name="Total Lines" radius={[2, 2, 0, 0]}>
                  {sceneLengthData.map((_, i) => (
                    <Cell key={i} fill={`hsl(var(--primary) / ${0.3 + (sceneLengthData[i].lines / (pacingSignals?.max || 1)) * 0.7})`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Top longest / shortest */}
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Longest Scenes</span>
              {sortedByLength.slice(0, 3).map((s) => (
                <div key={s.index} className="flex items-center gap-1 text-[10px] font-mono text-foreground">
                  <Badge variant="outline" className="text-[8px] px-1 py-0">{s.index}</Badge>
                  <span className="truncate flex-1">{s.heading.slice(0, 30)}</span>
                  <span className="text-muted-foreground">{s.total}L</span>
                </div>
              ))}
            </div>
            <div>
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Shortest Scenes</span>
              {sortedByLength.slice(-3).reverse().map((s) => (
                <div key={s.index} className="flex items-center gap-1 text-[10px] font-mono text-foreground">
                  <Badge variant="outline" className="text-[8px] px-1 py-0">{s.index}</Badge>
                  <span className="truncate flex-1">{s.heading.slice(0, 30)}</span>
                  <span className="text-muted-foreground">{s.total}L</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Dialogue Balance ── */}
      {dialogueShare.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="h-4 w-4 text-primary" />
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Dialogue Balance</span>
          </div>
          <div className="space-y-1">
            {dialogueShare.map((c) => (
              <div key={c.name} className="flex items-center gap-2">
                <span className="text-[10px] font-mono w-24 truncate shrink-0 text-foreground">{c.name}</span>
                <div className="flex-1 h-2.5 bg-muted/30 rounded-full overflow-hidden">
                  <div className="h-full bg-primary/60 rounded-full transition-all" style={{ width: `${c.pct}%` }} />
                </div>
                <span className="text-[10px] font-mono text-muted-foreground w-10 text-right">{c.pct}%</span>
                <Badge variant="outline" className="text-[8px] font-mono shrink-0">{c.count}</Badge>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Thematic Keywords ── */}
      {keywords.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Hash className="h-4 w-4 text-primary" />
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Recurring Language</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {keywords.map((kw) => {
              const intensity = Math.max(0.3, kw.count / maxKeywordCount);
              return (
                <span
                  key={kw.word}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono bg-primary/10 text-primary transition-colors"
                  style={{ opacity: intensity }}
                  title={`"${kw.word}" appears ${kw.count} times`}
                >
                  {kw.word}
                  <span className="text-[8px] text-primary/60">{kw.count}</span>
                </span>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Adaptation Pathway Signals ── */}
      <section>
        <AdaptationPathwayPanel parsed={parsed} />
      </section>
      {/* ── Story World ── */}
      {entryId && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Story World</h3>
          <StoryWorldPanel entryId={entryId} parsed={parsed} compact />
        </section>
      )}
      {/* ── Memory Graph ── */}
      {entryId && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Memory Graph</h3>
          <ProjectMemoryGraph entryId={entryId} parsed={parsed} compact />
        </section>
      )}
      {/* ── Development Trajectory ── */}
      {drafts && drafts.length >= 2 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Development Trajectory</h3>
          <DevelopmentTrajectoryPanel drafts={drafts} compact />
        </section>
      )}
      {/* ── Continuity Signals ── */}
      {drafts && drafts.length >= 2 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Continuity Signals</h3>
          <NarrativeContinuityPanel drafts={drafts} compact />
        </section>
      )}
    </div>
  );
}
