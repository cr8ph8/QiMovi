import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { pickActiveScore } from "@/lib/scores";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp, Target, BookOpen, Milestone, Award, Sparkles,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from "recharts";
import { CashBurnDashboard } from "@/components/cashburn/CashBurnDashboard";

interface CareerDevelopmentTabProps {
  userId: string;
}

interface ScoredEntry {
  id: string;
  title: string;
  genre: string | null;
  created_at: string;
  total_score: number;
  narrative: number;
  character_score: number;
  emotional: number;
  visual: number;
  market: number;
  franchise: number;
  production: number;
  audience: number;
  originality: number;
  structure: number;
  character_depth: number;
  dialogue: number;
  theme: number;
  emotion: number;
  format_adherence: number;
}

interface MilestoneItem {
  label: string;
  date: string;
  icon: string;
}

const IPQ_DIMS = [
  { key: "narrative", label: "Narrative" },
  { key: "character_score", label: "Character" },
  { key: "emotional", label: "Emotional" },
  { key: "visual", label: "Visual" },
  { key: "market", label: "Market" },
  { key: "franchise", label: "Franchise" },
  { key: "production", label: "Production" },
  { key: "audience", label: "Audience" },
];

const LEGACY_DIMS = [
  { key: "originality", label: "Originality", max: 20 },
  { key: "structure", label: "Structure", max: 20 },
  { key: "character_depth", label: "Character", max: 15 },
  { key: "dialogue", label: "Dialogue", max: 15 },
  { key: "theme", label: "Theme", max: 10 },
  { key: "emotion", label: "Emotion", max: 10 },
  { key: "format_adherence", label: "Format", max: 10 },
];

function getScoreColor(pct: number): string {
  if (pct >= 80) return "text-emerald-400";
  if (pct >= 60) return "text-primary";
  if (pct >= 40) return "text-amber-400";
  return "text-destructive";
}

function getBarColor(pct: number): string {
  if (pct >= 80) return "bg-emerald-500";
  if (pct >= 60) return "bg-primary";
  if (pct >= 40) return "bg-amber-500";
  return "bg-destructive";
}

export default function CareerDevelopmentTab({ userId }: CareerDevelopmentTabProps) {
  const [entries, setEntries] = useState<ScoredEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("entries")
      .select("id, title, genre, created_at, scores(total_score, narrative, character_score, emotional, visual, market, franchise, production, audience, originality, structure, character_depth, dialogue, theme, emotion, format_adherence, created_at, superseded_at)")
      .eq("user_id", userId)
      .eq("status", "scored")
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        const mapped = (data || [])
          .map((e: any) => ({ ...e, scores: pickActiveScore(e.scores) }))
          .filter((e: any) => e.scores)
          .map((e: any) => ({
            id: e.id,
            title: e.title,
            genre: e.genre,
            created_at: e.created_at,
            ...e.scores,
          }));
        setEntries(mapped);
        setLoading(false);
      });
  }, [userId]);

  // Detect IPQ vs legacy
  const hasIPQ = entries.some((e) => (e.narrative ?? 0) > 0);
  const dims = hasIPQ ? IPQ_DIMS : LEGACY_DIMS;

  // Score trajectory data
  const trajectoryData = useMemo(() =>
    entries.map((e, i) => ({
      index: i + 1,
      score: e.total_score,
      label: e.title.length > 20 ? e.title.slice(0, 20) + "…" : e.title,
      date: new Date(e.created_at).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
    })),
  [entries]);

  // Strengths radar (averaged)
  const radarData = useMemo(() => {
    if (entries.length === 0) return [];
    return dims.map((d) => {
      const values = entries.map((e) => Number((e as any)[d.key] ?? 0));
      const avg = values.reduce((s, v) => s + v, 0) / values.length;
      const max = (d as any).max || 10;
      return { category: d.label, value: avg, normalized: (avg / max) * 100 };
    });
  }, [entries, dims]);

  // Genre mastery
  const genreData = useMemo(() => {
    const map = new Map<string, { count: number; totalScore: number }>();
    entries.forEach((e) => {
      const g = e.genre || "Unspecified";
      const existing = map.get(g) || { count: 0, totalScore: 0 };
      map.set(g, { count: existing.count + 1, totalScore: existing.totalScore + e.total_score });
    });
    return Array.from(map.entries())
      .map(([genre, { count, totalScore }]) => ({ genre, count, avgScore: Math.round(totalScore / count) }))
      .sort((a, b) => b.avgScore - a.avgScore);
  }, [entries]);

  // Auto milestones
  const milestones = useMemo(() => {
    const items: MilestoneItem[] = [];
    if (entries.length > 0) {
      items.push({ label: "First Submission", date: entries[0].created_at, icon: "🎬" });
    }
    if (entries.length >= 5) {
      items.push({ label: "5th Submission", date: entries[4].created_at, icon: "📝" });
    }
    if (entries.length >= 10) {
      items.push({ label: "10th Submission", date: entries[9].created_at, icon: "🏅" });
    }
    const first70 = entries.find((e) => e.total_score >= 70);
    if (first70) {
      items.push({ label: "First 70+ Score", date: first70.created_at, icon: "⭐" });
    }
    const first80 = entries.find((e) => e.total_score >= 80);
    if (first80) {
      items.push({ label: "First 80+ Score", date: first80.created_at, icon: "🌟" });
    }
    const genres = new Set(entries.map((e) => e.genre).filter(Boolean));
    if (genres.size >= 3) {
      items.push({ label: "Genre Diversification (3+)", date: entries.find((e) => {
        const seen = new Set<string>();
        for (const prev of entries) {
          if (new Date(prev.created_at) > new Date(e.created_at)) break;
          if (prev.genre) seen.add(prev.genre);
        }
        return seen.size >= 3;
      })?.created_at || entries[entries.length - 1].created_at, icon: "🎭" });
    }
    // Score improvement streak (3+ in a row)
    let streak = 0;
    let maxStreak = 0;
    let streakEndDate = "";
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].total_score > entries[i - 1].total_score) {
        streak++;
        if (streak >= maxStreak) {
          maxStreak = streak;
          streakEndDate = entries[i].created_at;
        }
      } else {
        streak = 0;
      }
    }
    if (maxStreak >= 3) {
      items.push({ label: `${maxStreak + 1}-Entry Improvement Streak`, date: streakEndDate, icon: "🔥" });
    }
    items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return items;
  }, [entries]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        Loading career data…
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/80 p-12 text-center">
        <TrendingUp className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
        <h3 className="font-display text-xl font-semibold mb-2">No scored entries yet</h3>
        <p className="text-sm text-muted-foreground">Submit and score screenplays to see your career development analytics here.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {/* Score Trajectory */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border/50 bg-card/80 p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h2 className="font-display text-lg font-semibold">Score Trajectory</h2>
          <Badge variant="outline" className="text-[10px] font-mono ml-auto">{entries.length} entries</Badge>
        </div>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trajectoryData} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontFamily: "monospace" }} className="text-muted-foreground" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fontFamily: "monospace" }} className="text-muted-foreground" />
              <Tooltip
                contentStyle={{ fontSize: 11, fontFamily: "monospace", background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.label || ""}
              />
              <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ fill: "hsl(var(--primary))", r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {entries.length >= 2 && (
          <div className="flex items-center gap-2 mt-2 text-xs font-mono text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            {entries[entries.length - 1].total_score > entries[0].total_score
              ? `+${entries[entries.length - 1].total_score - entries[0].total_score} point improvement`
              : entries[entries.length - 1].total_score === entries[0].total_score
              ? "Consistent scoring"
              : `${entries[0].total_score - entries[entries.length - 1].total_score} point delta — room to grow`}
          </div>
        )}
      </motion.div>

      {/* Strengths & Weaknesses Radar */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="rounded-xl border border-border/50 bg-card/80 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Target className="h-5 w-5 text-primary" />
          <h2 className="font-display text-lg font-semibold">Strengths & Weaknesses</h2>
        </div>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="65%">
              <PolarGrid stroke="hsl(var(--border))" />
              <PolarAngleAxis dataKey="category" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
              <Radar name="Average" dataKey="normalized" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.15} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
          {radarData
            .sort((a, b) => b.normalized - a.normalized)
            .slice(0, 4)
            .map((d, i) => (
              <div key={d.category} className="rounded-lg bg-muted/30 p-2 text-center">
                <span className="text-[9px] font-mono text-muted-foreground uppercase block">{i < 2 ? "Strength" : "Growth"}</span>
                <span className={`text-sm font-mono font-bold ${getScoreColor(d.normalized)}`}>{d.category}</span>
                <span className="text-[10px] font-mono text-muted-foreground block">{Math.round(d.normalized)}%</span>
              </div>
            ))}
        </div>
      </motion.div>

      {/* Genre Mastery */}
      {genreData.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="rounded-xl border border-border/50 bg-card/80 p-6">
          <div className="flex items-center gap-2 mb-4">
            <BookOpen className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-semibold">Genre Mastery</h2>
          </div>
          <div className="space-y-3">
            {genreData.map((g) => {
              const pct = g.avgScore;
              return (
                <div key={g.genre}>
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="text-sm font-medium">{g.genre}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[9px] font-mono">{g.count} {g.count === 1 ? "entry" : "entries"}</Badge>
                      <span className={`text-sm font-mono font-bold ${getScoreColor(pct)}`}>{g.avgScore}</span>
                    </div>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8 }}
                      className={`h-full rounded-full ${getBarColor(pct)}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Career Milestones */}
      {milestones.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="rounded-xl border border-border/50 bg-card/80 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Award className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-semibold">Career Milestones</h2>
          </div>
          <div className="relative">
            <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border/50" />
            <div className="space-y-3">
              {milestones.map((m, i) => (
                <div key={i} className="flex items-center gap-3 relative">
                  <div className="relative z-10 h-8 w-8 rounded-full bg-muted/50 border border-border/50 flex items-center justify-center text-sm shrink-0">
                    {m.icon}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{m.label}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">
                      {new Date(m.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="rounded-xl border border-border/50 bg-card/80 p-6">
        <h2 className="font-display text-lg font-semibold mb-4">Career Cash Burn</h2>
        <CashBurnDashboard scopeType="writer" scopeId={userId} scopeLabel="your career" />
      </motion.div>
    </div>
  );
}
