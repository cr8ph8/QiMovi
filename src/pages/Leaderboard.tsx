import { useEffect, useId, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { UnifiedScorecard } from "@/components/scoring/UnifiedScorecard";
import { announce } from "@/lib/a11y/announce";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Section } from "@/components/Section";
import { Trophy, ArrowUpDown, Film, Clapperboard, Tv, Monitor, Projector, Videotape, Activity, Mic } from "lucide-react";
import { AccessGate } from "@/components/AccessGate";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScorecardProvenanceTooltip } from "@/components/scoring/ScorecardProvenanceTooltip";
import { GovernanceStatusBadges, GovernanceFlags } from "@/components/GovernanceStatusBadges";
import { computeScoringDrift, type GradingReportInput, type StabilityResult } from "@/lib/stability";
import { useCompetitionAnalyticsAccess } from "@/lib/competition/analyticsAccess";
import { AnalyticsAccessBadge } from "@/components/competition/AnalyticsAccessBadge";
// NOTE: readScorecards is intentionally not imported here. Leaderboard totals
// must go through loadCanonicalTotals (below), which is the ONLY sanctioned
// entrypoint and stamps each value as canonical for assertCanonicalTotal.
import {
  loadCanonicalTotals,
  assertCanonicalTotal,
  withScoreSourceGuard,
} from "@/lib/leaderboardScores";

interface LeaderboardEntry {
  id: string;
  title: string;
  genre: string | null;
  method_type: string;
  length_category: string | null;
  page_count: number | null;
  created_at: string;
  competition_id: string;
  author: string | null;
  user_id: string;
  scores: { total_score: number } | null;
  model_id: string | null;
}

interface Competition {
  id: string;
  name: string;
  categoryKey: string;
}

type SortField = "score" | "date" | "title";

const CATEGORY_TABS = [
  { key: "all", label: "All", icon: Trophy },
  { key: "vertical", label: "Vertical", icon: Videotape },
  { key: "micro", label: "Micro Short", icon: Film },
  { key: "short", label: "Short Film", icon: Clapperboard },
  { key: "pilot_30", label: "30-Min Pilot", icon: Tv },
  { key: "pilot_60", label: "60-Min Pilot", icon: Monitor },
  { key: "feature", label: "Feature", icon: Projector },
] as const;

const CATEGORY_NAME_MAP: Record<string, string> = {
  Vertical: "vertical",
  "Micro Short": "micro",
  "Short Film": "short",
  "30-Min Pilot": "pilot_30",
  "60-Min Pilot": "pilot_60",
  Feature: "feature",
};

export default function Leaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortField>("score");
  const [filterGenre, setFilterGenre] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<string>("all");
  const [govFlags, setGovFlags] = useState<Record<string, GovernanceFlags>>({});
  const [stabilityMap, setStabilityMap] = useState<Record<string, StabilityResult>>({});
  const [voiceDriftMap, setVoiceDriftMap] = useState<Record<string, { drift_score: number; flagged: boolean }>>({});
  const [openScorecard, setOpenScorecard] = useState<{ id: string; title: string } | null>(null);
  const SCORECARD_SHEET_ID = "leaderboard-scorecard-sheet";
  const scorecardTitleId = useId();
  const scorecardDescId = useId();
  const scorecardMainId = useId();
  const wasScorecardOpenRef = useRef(false);
  const { canSeeAnalytics } = useCompetitionAnalyticsAccess();

  // Announce scorecard sheet open/close for screen readers, matching the
  // pattern in EvidenceCard and the Judges Console EntryScorecard drawer.
  useEffect(() => {
    const isOpen = !!openScorecard;
    if (isOpen && !wasScorecardOpenRef.current) {
      wasScorecardOpenRef.current = true;
      announce(`Scorecard opened for ${openScorecard?.title ?? "entry"}.`);
    } else if (!isOpen && wasScorecardOpenRef.current) {
      wasScorecardOpenRef.current = false;
      announce("Scorecard closed.");
    }
  }, [openScorecard]);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    const [entriesRes, compsRes] = await Promise.all([
      supabase
        .from("public_entries")
        .select("id, title, genre, method_type, length_category, page_count, created_at, competition_id, author, sensitivity, user_id")
        .order("created_at", { ascending: false }),
      supabase
        .from("competitions")
        .select("id, name")
        .ilike("name", "Season Zero%"),
    ]);

    const rawEntries = (entriesRes.data as unknown as (Omit<LeaderboardEntry, 'scores'> & { sensitivity?: string })[]) || [];

    // Fetch scores separately since public_entries view doesn't join grading_reports
    const entryIds = rawEntries.map(e => e.id);
    let scoresMap: Record<string, number> = {};
    let modelsMap: Record<string, string | null> = {};
    let reportsPerEntry: Record<string, GradingReportInput[]> = {};
    if (entryIds.length > 0) {
      // Canonical totals — v_entry_scorecard via readScorecards is the ONLY
      // allowed source for displayed leaderboard scores. The guard proxies
      // supabase.from() during this block so any read of `scores`,
      // `judge_consensus`, `grading_reports`, or `public_entries` throws.
      const canonical = await withScoreSourceGuard(() =>
        loadCanonicalTotals(entryIds),
      );
      for (const [entryId, { total, card }] of canonical) {
        scoresMap[entryId] = total;
        modelsMap[entryId] = card.finalized_model_id ?? null;
      }

      // Stability drift is a separate, non-display signal. It reads
      // grading_reports for variance computation ONLY — its output never
      // becomes a displayed total. This read happens OUTSIDE the score
      // guard because grading_reports is on the forbidden list.
      // eslint-disable-next-line no-restricted-syntax -- variance-only stability signal, not a displayed total
      const { data: driftRows } = await supabase
        .from("grading_reports")
        .select("entry_id, total_score, model_id, created_at")
        .in("entry_id", entryIds);

      for (const s of (driftRows || []) as any[]) {
        if (!reportsPerEntry[s.entry_id]) reportsPerEntry[s.entry_id] = [];
        reportsPerEntry[s.entry_id].push({
          total_score: Number(s.total_score),
          model_id: s.model_id || "",
          created_at: s.created_at,
        });
      }
    }

    // Compute stability per entry
    const stMap: Record<string, StabilityResult> = {};
    for (const [entryId, reports] of Object.entries(reportsPerEntry)) {
      stMap[entryId] = computeScoringDrift(reports);
    }
    setStabilityMap(stMap);


    const allEntries: (LeaderboardEntry & { sensitivity?: string })[] = rawEntries.map(e => ({
      ...e,
      scores: scoresMap[e.id] != null ? { total_score: scoresMap[e.id] } : null,
      model_id: modelsMap[e.id] || null,
    }));

    // Final gate: every displayed total must trace back to loadCanonicalTotals.
    // Any non-canonical value here means a regression re-introduced an
    // alternative-table backfill — throw so the bug is loud instead of silent.
    for (const e of allEntries) {
      if (e.scores) assertCanonicalTotal(e.id, e.scores.total_score);
    }

    setEntries(allEntries);

    if (compsRes.data) {
      const mapped: Competition[] = compsRes.data.map((c: any) => {
        let categoryKey = "unknown";
        for (const [label, key] of Object.entries(CATEGORY_NAME_MAP)) {
          if (c.name.includes(label)) { categoryKey = key; break; }
        }
        return { id: c.id, name: c.name, categoryKey };
      });
      setCompetitions(mapped);
    }

    setLoading(false);

    // Fetch governance flags
    const ids = allEntries.map((e) => e.id);
    if (ids.length === 0) return;

    const [driftRes, influenceRes, routingRes] = await Promise.all([
      supabase.from("voice_drift_analysis").select("entry_id, drift_score, flagged").in("entry_id", ids),
      supabase.from("influence_scores").select("entry_id, ai_influence_score").in("entry_id", ids),
      supabase.from("ai_usage_log").select("entry_id, routing_reason").in("entry_id", ids).not("routing_reason", "is", null),
    ]);

    const driftMap: Record<string, { drift_score: number; flagged: boolean }> = {};
    for (const d of (driftRes.data as any[]) || []) {
      driftMap[d.entry_id] = { drift_score: Number(d.drift_score), flagged: Boolean(d.flagged) };
    }
    setVoiceDriftMap(driftMap);
    const influenceMap: Record<string, number> = {};
    for (const i of (influenceRes.data as any[]) || []) {
      const score = Number(i.ai_influence_score);
      if (!influenceMap[i.entry_id] || score > influenceMap[i.entry_id]) influenceMap[i.entry_id] = score;
    }

    const routedMap: Record<string, string> = {};
    for (const r of (routingRes.data as any[]) || []) {
      if (!routedMap[r.entry_id]) routedMap[r.entry_id] = r.routing_reason;
    }

    const flags: Record<string, GovernanceFlags> = {};
    for (const e of allEntries) {
      const sens = (e as any).sensitivity || "standard";
      const isProtected = sens !== "standard";
      const aiScore = influenceMap[e.id];
      const isFlagged = aiScore != null && aiScore > 0.8;
      const drift = driftMap[e.id];
      const isHighDrift = drift?.flagged === true;
      const isRouted = !!routedMap[e.id];
      if (isProtected || isFlagged || isHighDrift || isRouted) {
        flags[e.id] = { isProtected, isFlagged, isHighDrift, isRouted, aiInfluenceScore: aiScore, driftScore: drift?.drift_score, sensitivity: sens, routingReason: routedMap[e.id] };
      }
    }
    setGovFlags(flags);
  }

  // Map competition_id -> category key
  const compToCat = Object.fromEntries(competitions.map((c) => [c.id, c.categoryKey]));

  const filteredEntries = entries
    .filter((e) => {
      if (activeTab !== "all") {
        const cat = compToCat[e.competition_id] || e.length_category;
        if (cat !== activeTab) return false;
      }
      if (filterGenre !== "all" && e.genre !== filterGenre) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "score") return (b.scores?.total_score ?? 0) - (a.scores?.total_score ?? 0);
      if (sortBy === "date") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return a.title.localeCompare(b.title);
    });

  const genres = [...new Set(entries.map((e) => e.genre).filter(Boolean))];

  // Count entries per category for badges
  const categoryCounts: Record<string, number> = { all: entries.length };
  for (const e of entries) {
    const cat = compToCat[e.competition_id] || e.length_category || "unknown";
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  }

  return (
    <AccessGate tier="extended" label="the Leaderboard">
    <>
      <section className="pt-20 pb-10">
        <div className="container">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-border/80 bg-muted/50 mb-6">
              <Trophy className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-mono tracking-wider text-muted-foreground">SEASON ZERO</span>
            </div>
            <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight mb-4">Leaderboard</h1>
            <p className="text-lg text-muted-foreground mb-4">Ranked by AI judge scores across all screenplay categories.</p>
            <AnalyticsAccessBadge />

          </motion.div>
        </div>
      </section>

      <Section>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
            <TabsList className="bg-muted/50 flex-wrap h-auto gap-1 p-1">
              {CATEGORY_TABS.map((tab) => {
                const TabIcon = tab.icon;
                const count = categoryCounts[tab.key] || 0;
                return (
                  <TabsTrigger
                    key={tab.key}
                    value={tab.key}
                    className="font-body text-xs sm:text-sm gap-1.5 data-[state=active]:bg-background"
                  >
                    <TabIcon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{tab.label}</span>
                    <span className="sm:hidden">{tab.key === "all" ? "All" : tab.label.split(" ")[0]}</span>
                    {count > 0 && (
                      <Badge variant="secondary" className="text-[9px] font-mono px-1.5 py-0 h-4 ml-0.5">
                        {count}
                      </Badge>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            <div className="flex gap-2">
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortField)}>
                <SelectTrigger className="w-[150px] bg-muted border-border text-xs">
                  <ArrowUpDown className="h-3 w-3 mr-1.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="score">Sort by Score</SelectItem>
                  <SelectItem value="date">Sort by Date</SelectItem>
                  <SelectItem value="title">Sort by Title</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterGenre} onValueChange={setFilterGenre}>
                <SelectTrigger className="w-[140px] bg-muted border-border text-xs">
                  <SelectValue placeholder="All Genres" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Genres</SelectItem>
                  {genres.map((g) => (
                    <SelectItem key={g} value={g!}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Single shared content area — tabs just filter */}
          <div>
            {loading ? (
              <div className="text-center py-20 text-muted-foreground">Loading entries...</div>
            ) : filteredEntries.length === 0 ? (
              <div className="text-center py-20">
                <Trophy className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" />
                <p className="text-muted-foreground mb-1 font-display text-lg">
                  {activeTab === "all" ? "No scored entries yet" : `No scored entries in ${CATEGORY_TABS.find(t => t.key === activeTab)?.label || activeTab}`}
                </p>
                <p className="text-sm text-muted-foreground/60 mb-6">Be the first to submit and get scored!</p>
                <Link to="/submit">
                  <Button className="bg-gold-gradient text-primary-foreground font-body font-semibold">Submit Entry</Button>
                </Link>
              </div>
            ) : (
              <div className="rounded-xl border border-border/50 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/30">
                      <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">#</th>
                      <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Title</th>
                      <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground hidden sm:table-cell">Author</th>
                      <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground hidden md:table-cell">Genre</th>
                      {activeTab === "all" && (
                        <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground hidden lg:table-cell">Category</th>
                      )}
                      <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground hidden md:table-cell">Method</th>
                      {canSeeAnalytics && (
                        <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground hidden lg:table-cell">Model</th>
                      )}
                      <th className="text-right py-3 px-4 font-mono text-xs text-muted-foreground">Score</th>
                      {canSeeAnalytics && (
                        <th className="text-center py-3 px-4 font-mono text-xs text-muted-foreground hidden md:table-cell">Stability</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.map((entry, i) => {
                      const cat = compToCat[entry.competition_id] || entry.length_category;
                      const catLabel = CATEGORY_TABS.find(t => t.key === cat)?.label || cat || "—";
                      return (
                        <tr key={entry.id} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                          <td className="py-3 px-4 font-mono text-xs">
                            {i < 3 ? (
                              <span className={`inline-flex items-center justify-center h-6 w-6 rounded-full text-[10px] font-bold ${
                                i === 0 ? "bg-amber-500/20 text-amber-500" :
                                i === 1 ? "bg-slate-400/20 text-slate-400" :
                                "bg-orange-700/20 text-orange-700"
                              }`}>
                                {i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"}
                              </span>
                            ) : i < 10 ? (
                              <span className="inline-flex items-center justify-center h-6 w-6 rounded-full text-[10px] font-bold bg-primary/10 text-primary">
                                {i + 1}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">{i + 1}</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Link to={`/entry/${entry.id}`} className="font-body text-foreground hover:text-primary transition-colors">
                                {entry.title}
                              </Link>
                              {canSeeAnalytics && govFlags[entry.id] && <GovernanceStatusBadges flags={govFlags[entry.id]} />}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-muted-foreground hidden sm:table-cell">
                            {entry.author || "Anonymous"}
                          </td>
                          <td className="py-3 px-4 text-muted-foreground hidden md:table-cell">{entry.genre || "—"}</td>
                          {activeTab === "all" && (
                            <td className="py-3 px-4 hidden lg:table-cell">
                              <Badge variant="outline" className="text-[10px] font-mono">
                                {catLabel}
                              </Badge>
                            </td>
                          )}
                          <td className="py-3 px-4 hidden md:table-cell">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex px-2 py-0.5 rounded text-xs font-mono bg-primary/10 text-primary uppercase cursor-help">
                                  {entry.method_type === "ai" ? "🤖 AI" : entry.method_type === "hybrid" ? "🔀 Hybrid" : "✍️ Human"}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs max-w-[200px]">
                                {entry.method_type === "ai"
                                  ? "Script generated by AI from writer's concept"
                                  : entry.method_type === "hybrid"
                                  ? "AI-generated base with human edits"
                                  : "Human-written screenplay"}
                              </TooltipContent>
                            </Tooltip>
                          </td>
                          {canSeeAnalytics && (
                            <td className="py-3 px-4 hidden lg:table-cell">
                              {entry.model_id ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-mono bg-muted text-muted-foreground truncate max-w-[140px]">
                                      {entry.model_id.includes("/") ? entry.model_id.split("/").pop() : entry.model_id}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs">{entry.model_id}</TooltipContent>
                                </Tooltip>
                              ) : (
                                <span className="text-muted-foreground/40 text-xs">—</span>
                              )}
                            </td>
                          )}
                          <td className="py-3 px-4 text-right font-mono text-primary font-semibold">
                            <span className="inline-flex items-center justify-end gap-1.5">
                              {entry.scores?.total_score != null ? (
                                <button
                                  type="button"
                                  onClick={() => setOpenScorecard({ id: entry.id, title: entry.title })}
                                  className="hover:text-gradient-gold transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                                  aria-label={`Open scorecard for ${entry.title}, current total ${entry.scores.total_score}`}
                                  aria-haspopup="dialog"
                                  aria-expanded={openScorecard?.id === entry.id}
                                  aria-controls={openScorecard?.id === entry.id ? SCORECARD_SHEET_ID : undefined}
                                >
                                  <ScorecardProvenanceTooltip>
                                    {entry.scores.total_score}
                                  </ScorecardProvenanceTooltip>
                                </button>
                              ) : (
                                "—"
                              )}
                              {canSeeAnalytics && (() => {
                                const drift = voiceDriftMap[entry.id];
                                if (!drift) return null;
                                const preservation = Math.round(100 - drift.drift_score);
                                const color =
                                  preservation >= 80 ? "text-emerald-400" :
                                  preservation >= 60 ? "text-amber-400" :
                                  "text-destructive";
                                return (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className={`inline-flex items-center gap-0.5 text-[10px] cursor-help opacity-80 ${color}`}>
                                        <Mic className="h-3 w-3" />
                                        {preservation}%
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="left" className="text-xs max-w-[200px]">
                                      Voice preservation — how consistent the writer's voice remained across drafts
                                    </TooltipContent>
                                  </Tooltip>
                                );
                              })()}
                            </span>
                          </td>
                          {canSeeAnalytics && (
                            <td className="py-3 px-4 text-center hidden md:table-cell">
                              {(() => {
                                const st = stabilityMap[entry.id];
                                if (!st || st.confidence === 0) return <span className="text-muted-foreground/40 text-xs">—</span>;
                                const color =
                                  st.metric_label === "stable" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
                                  st.metric_label === "moderate drift" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
                                  "bg-destructive/15 text-destructive border-destructive/30";
                                return (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono border ${color}`}>
                                        <Activity className="h-2.5 w-2.5" />
                                        {st.metric_label === "stable" ? "Stable" :
                                         st.metric_label === "moderate drift" ? "Moderate" : "Unstable"}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="text-xs max-w-[220px]">
                                      Score variance: {st.metric_value}/100 · Confidence: {Math.round(st.confidence * 100)}%
                                    </TooltipContent>
                                  </Tooltip>
                                );
                              })()}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Tabs>
      </Section>
      <Sheet open={!!openScorecard} onOpenChange={(v) => !v && setOpenScorecard(null)}>
        <SheetContent
          id={SCORECARD_SHEET_ID}
          side="right"
          className="w-full sm:max-w-xl overflow-y-auto bg-background border-border/60 focus:outline-none"
          aria-labelledby={scorecardTitleId}
          aria-describedby={scorecardDescId}
          onOpenAutoFocus={(event) => {
            // Radix default focuses the close (X) button; move focus onto
            // the scorecard body so keyboard users land on real content.
            const main = document.getElementById(scorecardMainId);
            if (!main) return;
            event.preventDefault();
            main.focus({ preventScroll: false });
          }}
        >
          <a
            href={`#${scorecardMainId}`}
            onClick={(e) => {
              e.preventDefault();
              const el = document.getElementById(scorecardMainId);
              if (el) {
                el.focus();
                el.scrollIntoView({ block: "start" });
              }
            }}
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:border focus:border-primary/40 focus:bg-background focus:px-3 focus:py-1.5 focus:text-xs focus:font-mono focus:uppercase focus:tracking-wider focus:text-primary focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Skip to scorecard content
          </a>
          <SheetHeader>
            <SheetTitle id={scorecardTitleId}>
              {openScorecard ? `Scorecard — ${openScorecard.title}` : "Scorecard"}
            </SheetTitle>
            <SheetDescription id={scorecardDescId}>
              Canonical totals and structured reviews for this entry. Press Escape to close.
            </SheetDescription>
          </SheetHeader>
          <div
            id={scorecardMainId}
            tabIndex={-1}
            aria-label={`Scorecard content${openScorecard ? ` for ${openScorecard.title}` : ""}`}
            className="mt-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            <UnifiedScorecard entryId={openScorecard?.id ?? null} />
          </div>
        </SheetContent>
      </Sheet>
    </>
    </AccessGate>
  );
}
