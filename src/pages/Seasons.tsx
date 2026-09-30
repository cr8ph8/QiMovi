import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Trophy, Film, Calendar } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { readScorecards } from "@/lib/entryScorecard";
import { ScorecardProvenanceTooltip } from "@/components/scoring/ScorecardProvenanceTooltip";

type Season = {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: string;
  sort_order: number;
};

type Festival = {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  status: string;
  season_id: string | null;
};

type Competition = {
  id: string;
  name: string;
  status: string;
  festival_id: string | null;
};

type TopEntry = {
  id: string;
  title: string;
  author: string | null;
  total_score: number;
  competition_id: string;
};

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-green-500/15 text-green-400 border-green-500/30" },
  completed: { label: "Completed", className: "bg-muted text-muted-foreground border-border" },
  upcoming: { label: "Upcoming", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
};

export default function Seasons() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [festivals, setFestivals] = useState<Festival[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [topEntries, setTopEntries] = useState<TopEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [sRes, fRes, cRes] = await Promise.all([
        supabase.from("seasons").select("*").order("sort_order", { ascending: false }),
        supabase.from("festivals").select("id, title, subtitle, icon, status, season_id"),
        supabase.from("competitions").select("id, name, status, festival_id"),
      ]);

      const seasonsData = (sRes.data ?? []) as Season[];
      const festivalsData = (fRes.data ?? []) as Festival[];
      const competitionsData = (cRes.data ?? []) as Competition[];

      setSeasons(seasonsData);
      setFestivals(festivalsData);
      setCompetitions(competitionsData);

      // Fetch top 3 scored entries per competition with grading reports
      const compIds = competitionsData.map((c) => c.id);
      if (compIds.length > 0) {
        const { data: entries } = await supabase
          .from("public_entries")
          .select("id, title, author, competition_id")
          .in("competition_id", compIds)
          .eq("status", "scored")
          .eq("visibility", "default")
          .eq("sensitivity", "standard");

        if (entries && entries.length > 0) {
          const entryIds = entries.map((e) => e.id);
          // Canonical scorecards from v_entry_scorecard
          const cards = await readScorecards(entryIds);
          const ranked = entries
            .map((e) => ({ entry: e, total: cards.get(e.id)?.total_score ?? null }))
            .filter((r) => r.total != null)
            .sort((a, b) => (b.total as number) - (a.total as number));

          const entryMap = new Map(entries.map((e) => [e.id, e]));
          const perComp = new Map<string, TopEntry[]>();

          for (const r of ranked) {
            const entry = entryMap.get(r.entry.id);
            if (!entry) continue;
            const compId = entry.competition_id!;
            const list = perComp.get(compId) ?? [];
            if (list.length < 3) {
              list.push({
                id: entry.id,
                title: entry.title,
                author: entry.author,
                total_score: r.total as number,
                competition_id: compId,
              });
              perComp.set(compId, list);
            }
          }

          setTopEntries(Array.from(perComp.values()).flat());
        }
      }

      setLoading(false);
    }
    load();
  }, []);

  const festivalsForSeason = (seasonId: string) => festivals.filter((f) => f.season_id === seasonId);
  const compsForFestival = (festivalId: string) => competitions.filter((c) => c.festival_id === festivalId);
  const topForComp = (compId: string) => topEntries.filter((e) => e.competition_id === compId);

  return (
    <div className="min-h-screen pt-24 pb-16">
      {/* Hero */}
      <section className="container mb-12">
        <div className="flex items-center gap-3 mb-2">
          <Calendar className="h-6 w-6 text-primary" />
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-foreground">
            Season Archive
          </h1>
        </div>
        <p className="text-muted-foreground max-w-2xl">
          Browse every season of CanIScreenwrite — from inaugural competitions to the latest challenges. Explore festivals, competitions, and top-scoring entries.
        </p>
      </section>

      {/* Timeline */}
      <section className="container">
        {loading ? (
          <div className="space-y-8">
            {[1, 2].map((i) => (
              <div key={i} className="flex gap-6">
                <div className="w-3 flex flex-col items-center">
                  <Skeleton className="h-3 w-3 rounded-full" />
                  <Skeleton className="flex-1 w-px" />
                </div>
                <div className="flex-1 space-y-3">
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-4 w-full max-w-md" />
                  <Skeleton className="h-24 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : seasons.length === 0 ? (
          <p className="text-muted-foreground text-center py-16">No seasons yet — check back soon.</p>
        ) : (
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-[5px] top-2 bottom-2 w-px bg-border hidden md:block" />

            <div className="space-y-10">
              {seasons.map((season) => {
                const sFestivals = festivalsForSeason(season.id);
                const badge = STATUS_STYLES[season.status] ?? STATUS_STYLES.upcoming;

                return (
                  <div key={season.id} className="relative flex gap-4 md:gap-8">
                    {/* Dot */}
                    <div className="hidden md:flex flex-col items-center pt-1.5">
                      <div className={`h-3 w-3 rounded-full border-2 ${
                        season.status === "active" ? "border-primary bg-primary" : "border-border bg-background"
                      }`} />
                    </div>

                    {/* Card */}
                    <div className="flex-1 rounded-xl border border-border/60 bg-card p-5 md:p-6">
                      <div className="flex flex-wrap items-center gap-3 mb-2">
                        <h2 className="font-display text-xl font-semibold text-foreground">{season.name}</h2>
                        <Badge variant="outline" className={badge.className}>{badge.label}</Badge>
                      </div>
                      {season.description && (
                        <p className="text-sm text-muted-foreground mb-4">{season.description}</p>
                      )}

                      {sFestivals.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">No festivals in this season yet.</p>
                      ) : (
                        <div className="space-y-3">
                          {sFestivals.map((fest) => {
                            const fComps = compsForFestival(fest.id);
                            return (
                              <Collapsible key={fest.id}>
                                <CollapsibleTrigger className="group flex items-center gap-2 w-full text-left p-3 rounded-lg border border-border/40 bg-muted/30 hover:bg-muted/50 transition-colors">
                                  <Film className="h-4 w-4 text-primary shrink-0" />
                                  <span className="font-body text-sm font-medium text-foreground flex-1">
                                    {fest.title}
                                  </span>
                                  <span className="text-xs text-muted-foreground mr-2">
                                    {fComps.length} competition{fComps.length !== 1 ? "s" : ""}
                                  </span>
                                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                                </CollapsibleTrigger>
                                <CollapsibleContent className="pl-6 pt-2 space-y-3">
                                  {fest.subtitle && (
                                    <p className="text-xs text-muted-foreground">{fest.subtitle}</p>
                                  )}
                                  <Link
                                    to={`/festival/${fest.id}`}
                                    className="inline-block text-xs text-primary hover:underline"
                                  >
                                    View festival →
                                  </Link>

                                  {fComps.map((comp) => {
                                    const top = topForComp(comp.id);
                                    return (
                                      <div key={comp.id} className="rounded-md border border-border/30 p-3 bg-background/50">
                                        <h4 className="text-sm font-medium text-foreground mb-1">{comp.name}</h4>
                                        {top.length > 0 ? (
                                          <ol className="space-y-1">
                                            {top.map((entry, i) => (
                                              <li key={entry.id} className="flex items-center gap-2 text-xs">
                                                <Trophy className={`h-3 w-3 shrink-0 ${
                                                  i === 0 ? "text-amber-400" : i === 1 ? "text-zinc-400" : "text-amber-700"
                                                }`} />
                                                <Link to={`/entry/${entry.id}`} className="text-foreground hover:text-primary truncate">
                                                  {entry.title}
                                                </Link>
                                                <span className="text-muted-foreground ml-auto whitespace-nowrap">
                                                  <ScorecardProvenanceTooltip>
                                                    {entry.total_score.toFixed(1)} pts
                                                  </ScorecardProvenanceTooltip>
                                                </span>
                                              </li>
                                            ))}
                                          </ol>
                                        ) : (
                                          <p className="text-xs text-muted-foreground italic">No scored entries yet.</p>
                                        )}
                                      </div>
                                    );
                                  })}

                                  {fComps.length === 0 && (
                                    <p className="text-xs text-muted-foreground italic">No competitions listed.</p>
                                  )}
                                </CollapsibleContent>
                              </Collapsible>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
