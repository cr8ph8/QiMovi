import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Section, SectionLabel, SectionTitle, SectionDescription } from "@/components/Section";
import { BookOpen, MessageSquare, Star, Users, TrendingUp, Bell, Calendar, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { readScorecards } from "@/lib/entryScorecard";
import { ScorecardProvenanceTooltip } from "@/components/scoring/ScorecardProvenanceTooltip";
import { format } from "date-fns";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.1, duration: 0.5 } })
};

interface ReadingCycle {
  id: string;
  screenplay_title: string;
  screenplay_author: string | null;
  screenplay_genre: string | null;
  tier: string;
  total_pages: number;
  start_date: string;
  end_date: string;
}

interface TopEntry {
  id: string;
  title: string;
  author: string | null;
  total_score: number | null;
}

export default function FutureReaders() {
  const [cycles, setCycles] = useState<ReadingCycle[]>([]);
  const [topEntries, setTopEntries] = useState<TopEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [cyclesRes, entriesRes] = await Promise.all([
        (supabase.from("reading_cycles" as any) as any)
          .select("id, screenplay_title, screenplay_author, screenplay_genre, tier, total_pages, start_date, end_date")
          .eq("status", "open")
          .order("start_date", { ascending: false })
          .limit(6),
        // Pull a candidate pool of public entries; canonical totals come from v_entry_scorecard.
        supabase
          .from("public_entries")
          .select("id, title, author")
          .limit(60),
      ]);

      if (cyclesRes.data) setCycles(cyclesRes.data as ReadingCycle[]);
      if (entriesRes.data) {
        const candidates = entriesRes.data as Array<{ id: string; title: string; author: string | null }>;
        const cards = await readScorecards(candidates.map((c) => c.id));
        const ranked = candidates
          .map((c) => ({ ...c, total_score: cards.get(c.id)?.total_score ?? null }))
          .filter((c) => c.total_score != null)
          .sort((a, b) => (b.total_score as number) - (a.total_score as number))
          .slice(0, 6)
          .map((c) => ({ id: c.id, title: c.title, author: c.author, total_score: c.total_score }));
        setTopEntries(ranked);
      }

      setLoading(false);
    };
    load();
  }, []);

  return (
    <>
      <section className="pt-20 pb-10">
        <div className="container">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-border/80 bg-muted/50 mb-6">
              <span className="text-xs font-mono tracking-wider text-muted-foreground">READER HUB</span>
            </div>
            <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
              For Screenplay{" "}
              <span className="text-gradient-gold italic">Readers</span>
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl">
              Discover open reading cycles, browse top-rated screenplays, and follow the work moving through the
              competition pipeline.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── Open reading cycles ── */}
      <Section>
        <SectionLabel>Open Now</SectionLabel>
        <SectionTitle>Active Reading Cycles</SectionTitle>
        <SectionDescription>Reader chapters currently reviewing a script. Join a cycle to read along.</SectionDescription>
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)
          ) : cycles.length === 0 ? (
            <p className="text-sm text-muted-foreground font-body col-span-full">
              No open cycles right now. Check back soon — new cycles open each week.
            </p>
          ) : (
            cycles.map((c, i) => (
              <motion.div
                key={c.id}
                custom={i}
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                className="p-6 rounded-xl border border-border/50 bg-card/50 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <Calendar className="h-5 w-5 text-primary shrink-0" />
                  <Badge variant="outline" className="text-[10px] capitalize">{c.tier}</Badge>
                </div>
                <h3 className="font-display text-base font-semibold leading-tight">{c.screenplay_title}</h3>
                {c.screenplay_author && (
                  <p className="text-xs text-muted-foreground font-body">by {c.screenplay_author}</p>
                )}
                <div className="flex items-center gap-3 text-[11px] font-mono text-muted-foreground mt-auto">
                  <span>{c.total_pages}p</span>
                  {c.screenplay_genre && <span className="truncate">{c.screenplay_genre}</span>}
                  <span className="ml-auto">closes {format(new Date(c.end_date), "MMM d")}</span>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </Section>

      {/* ── Top entries ── */}
      <Section className="bg-surface-overlay">
        <SectionLabel>Top Rated</SectionLabel>
        <SectionTitle>Highest-Scoring Screenplays</SectionTitle>
        <SectionDescription>The current top of the leaderboard across all competitions.</SectionDescription>
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)
          ) : topEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground font-body col-span-full">No scored entries available yet.</p>
          ) : (
            topEntries.map((e, i) => (
              <motion.div
                key={e.id}
                custom={i}
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                className="p-6 rounded-xl border border-border/50 bg-card/50 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <Trophy className="h-5 w-5 text-primary shrink-0" />
                  {e.total_score !== null && (
                    <ScorecardProvenanceTooltip>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        #{i + 1} • {e.total_score.toFixed(1)}
                      </Badge>
                    </ScorecardProvenanceTooltip>
                  )}
                </div>
                <h3 className="font-display text-base font-semibold leading-tight">{e.title}</h3>
                {e.author && <p className="text-xs text-muted-foreground font-body">by {e.author}</p>}
              </motion.div>
            ))
          )}
        </div>
        <div className="mt-8 text-center">
          <Link to="/leaderboard">
            <Button variant="outline">View Full Leaderboard</Button>
          </Link>
        </div>
      </Section>

      {/* ── Reader features (descriptive) ── */}
      <Section>
        <SectionLabel>Reader Features</SectionLabel>
        <SectionTitle>Discover. Rate. Discuss.</SectionTitle>
        <SectionDescription>A new way to engage with screenplays across the intelligence spectrum.</SectionDescription>
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            { icon: BookOpen, title: "Script Discovery", desc: "Browse competition finalists and top-rated screenplays in a curated feed." },
            { icon: Star, title: "Community Ratings", desc: "Rate scripts on the same dimensions used by the AI judges." },
            { icon: MessageSquare, title: "Discussion Threads", desc: "Join conversations about craft, storytelling, and intelligence-era writing." },
            { icon: TrendingUp, title: "Trending Scripts", desc: "See what the community is reading and talking about right now." },
            { icon: Users, title: "Reader Profiles", desc: "Build your reader identity with preferences, reading history, and reviews." },
            { icon: Bell, title: "Notifications", desc: "Get alerts when new competitions launch or top scripts are published." },
          ].map((feat, i) => (
            <motion.div key={i} custom={i} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}
              className="p-6 rounded-xl border border-border/50 bg-card/50">
              <feat.icon className="h-5 w-5 text-primary mb-4" />
              <h3 className="font-display text-base font-semibold mb-2">{feat.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{feat.desc}</p>
            </motion.div>
          ))}
        </div>
      </Section>

      <Section className="bg-surface-overlay">
        <div className="max-w-xl mx-auto text-center">
          <SectionLabel>Stay Updated</SectionLabel>
          <SectionTitle className="mx-auto">Be the First to Know</SectionTitle>
          <p className="text-muted-foreground mt-2 mb-8">
            Join the waitlist for upcoming reader features. We'll notify you when they launch.
          </p>
          <div className="flex gap-3 max-w-md mx-auto">
            <Input placeholder="your@email.com" className="bg-muted border-border font-body" />
            <Button className="bg-gold-gradient text-primary-foreground font-body font-semibold shrink-0 hover:opacity-90">
              Join Waitlist
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-3">No spam. We'll only email when new features launch.</p>
        </div>
      </Section>
    </>
  );
}
