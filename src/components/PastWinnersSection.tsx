import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Trophy, Crown, Medal, Award, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Section, SectionLabel, SectionTitle, SectionDescription } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type Winner = {
  id: string;
  title: string;
  author: string | null;
  total_score: number;
  rank: number;
  competition_name: string;
  season_name: string;
};

const RANK_CONFIG = [
  { icon: Crown, color: "text-amber-400", bg: "bg-amber-400/10 border-amber-400/30", label: "1st" },
  { icon: Medal, color: "text-zinc-300", bg: "bg-zinc-300/10 border-zinc-300/30", label: "2nd" },
  { icon: Award, color: "text-amber-600", bg: "bg-amber-600/10 border-amber-600/30", label: "3rd" },
];

export default function PastWinnersSection() {
  const [winners, setWinners] = useState<Winner[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      // Get completed seasons
      const { data: seasons } = await supabase
        .from("seasons")
        .select("id, name")
        .eq("status", "completed");

      if (!seasons || seasons.length === 0) {
        setLoading(false);
        return;
      }

      const seasonIds = seasons.map((s) => s.id);
      const seasonMap = new Map(seasons.map((s) => [s.id, s.name]));

      // Get festivals in those seasons
      const { data: festivals } = await supabase
        .from("festivals")
        .select("id, season_id")
        .in("season_id", seasonIds);

      if (!festivals || festivals.length === 0) {
        setLoading(false);
        return;
      }

      const festivalIds = festivals.map((f) => f.id);
      const festSeasonMap = new Map(festivals.map((f) => [f.id, f.season_id!]));

      // Get competitions in those festivals
      const { data: competitions } = await supabase
        .from("competitions")
        .select("id, name, festival_id")
        .in("festival_id", festivalIds);

      if (!competitions || competitions.length === 0) {
        setLoading(false);
        return;
      }

      const compIds = competitions.map((c) => c.id);
      const compMap = new Map(competitions.map((c) => [c.id, c]));

      // Get scored entries
      const { data: entries } = await supabase
        .from("public_entries")
        .select("id, title, author, competition_id")
        .in("competition_id", compIds);

      if (!entries || entries.length === 0) {
        setLoading(false);
        return;
      }

      const entryIds = entries.map((e) => e.id);
      const { data: reports } = await (supabase as any)
        .from("v_entry_scorecard")
        .select("entry_id, total_score")
        .in("entry_id", entryIds)
        .order("total_score", { ascending: false });

      if (!reports) {
        setLoading(false);
        return;
      }

      const entryMap = new Map(entries.map((e) => [e.id, e]));
      const perComp = new Map<string, Winner[]>();

      for (const r of reports) {
        const entry = entryMap.get(r.entry_id);
        if (!entry || !entry.competition_id) continue;
        const compId = entry.competition_id;
        const list = perComp.get(compId) ?? [];
        if (list.length < 3) {
          const comp = compMap.get(compId);
          const seasonId = comp?.festival_id ? festSeasonMap.get(comp.festival_id) : null;
          list.push({
            id: entry.id,
            title: entry.title,
            author: entry.author,
            total_score: r.total_score,
            rank: list.length + 1,
            competition_name: comp?.name ?? "Unknown",
            season_name: seasonId ? seasonMap.get(seasonId) ?? "" : "",
          });
          perComp.set(compId, list);
        }
      }

      setWinners(Array.from(perComp.values()).flat());
      setLoading(false);
    }
    load();
  }, []);

  // Don't render if no completed seasons have winners
  if (!loading && winners.length === 0) return null;

  // Group by competition for display
  const grouped = winners.reduce<Record<string, Winner[]>>((acc, w) => {
    const key = w.competition_name;
    if (!acc[key]) acc[key] = [];
    acc[key].push(w);
    return acc;
  }, {});

  return (
    <Section>
      <SectionLabel>Past Winners</SectionLabel>
      <SectionTitle>
        Hall of <span className="text-gradient-gold italic">Champions</span>
      </SectionTitle>
      <SectionDescription>
        Top-scoring screenplays from completed seasons — the best stories as judged by AI.
      </SectionDescription>

      {loading ? (
        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="mt-10 space-y-8 max-w-5xl mx-auto">
          {Object.entries(grouped).map(([compName, entries], gi) => (
            <motion.div
              key={compName}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: gi * 0.1, duration: 0.5 }}
            >
              <div className="flex items-center gap-2 mb-4">
                <Trophy className="h-4 w-4 text-primary" />
                <h3 className="font-display text-lg font-semibold text-foreground">{compName}</h3>
                {entries[0]?.season_name && (
                  <span className="text-xs font-mono text-muted-foreground ml-2">
                    {entries[0].season_name}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {entries.map((winner, i) => {
                  const cfg = RANK_CONFIG[winner.rank - 1] ?? RANK_CONFIG[2];
                  const Icon = cfg.icon;
                  return (
                    <Link
                      key={winner.id}
                      to={`/entry/${winner.id}`}
                      className={`group relative p-5 rounded-xl border ${cfg.bg} hover:border-primary/40 transition-all`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className={`flex items-center gap-1.5 text-xs font-mono ${cfg.color}`}>
                          <Icon className="h-4 w-4" />
                          {cfg.label} Place
                        </div>
                        <span className="font-mono text-sm font-bold text-primary tabular-nums">
                          {winner.total_score.toFixed(1)}
                        </span>
                      </div>
                      <h4 className="font-display text-base font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2 mb-1">
                        {winner.title}
                      </h4>
                      {winner.author && (
                        <p className="text-xs text-muted-foreground truncate">
                          by {winner.author}
                        </p>
                      )}
                    </Link>
                  );
                })}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <div className="text-center mt-10">
        <Link to="/seasons">
          <Button variant="outline" className="font-body">
            View Season Archive <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </div>
    </Section>
  );
}
