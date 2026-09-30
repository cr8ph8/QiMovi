import { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";
import { Section, SectionLabel, SectionTitle, SectionDescription } from "@/components/Section";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronUp, Coins, Rocket, FlaskConical, Lightbulb, ChevronDown } from "lucide-react";

interface FeatureWithVotes {
  id: string;
  title: string;
  description: string | null;
  status: string;
  target_date: string | null;
  vote_count: number;
  token_total: number;
  popularity: number;
  user_voted: boolean;
  user_tokens: number;
}

interface RoadmapConfig {
  section_label: string;
  section_title: string;
  section_description: string;
  grid_columns: number;
  max_visible_cards: number;
  cta_text: string;
  cta_url: string;
}

const DEFAULT_CONFIG: RoadmapConfig = {
  section_label: "Coming Soon",
  section_title: "What We're Building Next",
  section_description: "Vote and boost features you want to see. Token bids increase priority.",
  grid_columns: 1,
  max_visible_cards: 3,
  cta_text: "View All Features",
  cta_url: "/roadmap",
};

const STATUS_PROGRESS: Record<string, { pct: number; label: string }> = {
  planned: { pct: 25, label: "Planned" },
  "in-progress": { pct: 55, label: "In Progress" },
  testing: { pct: 85, label: "Testing" },
};

const STATUS_ICON: Record<string, typeof Lightbulb> = {
  planned: Lightbulb,
  "in-progress": Rocket,
  testing: FlaskConical,
};

const GRID_CLASS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 md:grid-cols-2",
  3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
};

const FEATURE_VOTING_ON_HOLD = true;

export default function ComingSoonSection() {
  const { user } = useAuth();
  const [features, setFeatures] = useState<FeatureWithVotes[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [boostAmounts, setBoostAmounts] = useState<Record<string, string>>({});
  const [acting, setActing] = useState<string | null>(null);
  const [config, setConfig] = useState<RoadmapConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    supabase
      .from("landing_page_config")
      .select("*")
      .eq("id", "roadmap")
      .single()
      .then(({ data }: any) => {
        if (data) setConfig(data);
      });
  }, []);

  async function fetchFeatures() {
    const { data: roadmap } = await supabase
      .from("feature_roadmap")
      .select("id, title, description, status, target_date")
      .in("status", ["planned", "in-progress", "testing"]);

    if (!roadmap || roadmap.length === 0) {
      setFeatures([]);
      setLoading(false);
      return;
    }

    const { data: votes } = await supabase
      .from("feature_votes")
      .select("feature_id, user_id, tokens_bid");

    const allVotes = votes || [];
    const userId = user?.id;

    const enriched: FeatureWithVotes[] = roadmap.map((f) => {
      const fVotes = allVotes.filter((v) => v.feature_id === f.id);
      const vote_count = fVotes.length;
      const token_total = fVotes.reduce((s, v) => s + (v.tokens_bid || 0), 0);
      const userVote = userId ? fVotes.find((v) => v.user_id === userId) : undefined;
      return {
        ...f,
        vote_count,
        token_total,
        popularity: vote_count + token_total,
        user_voted: !!userVote,
        user_tokens: userVote?.tokens_bid || 0,
      };
    });

    enriched.sort((a, b) => b.popularity - a.popularity);
    setFeatures(enriched);
    setLoading(false);
  }

  useEffect(() => { fetchFeatures(); }, [user?.id]);

  async function handleVote(featureId: string, currentlyVoted: boolean, currentTokens: number) {
    if (FEATURE_VOTING_ON_HOLD) {
      toast({
        title: "Voting is temporarily paused",
        description: "We are upgrading vote and token protections. Your existing votes remain safe.",
      });
      return;
    }
    if (!user) {
      toast({ title: "Sign in to vote", description: "You need an account to vote on features.", variant: "destructive" });
      return;
    }
    setActing(featureId);
    if (currentlyVoted && currentTokens === 0) {
      await supabase.from("feature_votes").delete().eq("feature_id", featureId).eq("user_id", user.id);
    } else if (!currentlyVoted) {
      const { error } = await supabase.rpc("cast_feature_vote", { p_feature_id: featureId, p_tokens_bid: 0 });
      if (error) {
        toast({ title: "Vote failed", description: error.message, variant: "destructive" });
      }
    }
    await fetchFeatures();
    setActing(null);
  }

  async function handleBoost(featureId: string) {
    if (FEATURE_VOTING_ON_HOLD) {
      toast({
        title: "Voting is temporarily paused",
        description: "We are upgrading vote and token protections. Your existing votes remain safe.",
      });
      return;
    }
    if (!user) {
      toast({ title: "Sign in to boost", description: "You need an account to boost features.", variant: "destructive" });
      return;
    }
    const amount = parseInt(boostAmounts[featureId] || "0");
    if (!amount || amount <= 0) return;
    setActing(featureId);
    const { error } = await supabase.rpc("spend_tokens", { p_feature_id: featureId, p_amount: amount });
    if (error) {
      toast({ title: "Boost failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Boosted!", description: `You spent ${amount} tokens on this feature.` });
      setBoostAmounts((prev) => ({ ...prev, [featureId]: "" }));
    }
    await fetchFeatures();
    setActing(null);
  }

  const visible = expanded ? features : features.slice(0, config.max_visible_cards);

  if (!loading && features.length === 0) return null;

  return (
    <Section>
      <SectionLabel>{config.section_label}</SectionLabel>
      <SectionTitle>{config.section_title}</SectionTitle>
      <SectionDescription>{config.section_description}</SectionDescription>

      <div className={`mt-10 gap-4 max-w-4xl mx-auto grid ${GRID_CLASS[config.grid_columns] || "grid-cols-1"}`}>
        {loading ? (
          [1, 2, 3].map((i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)
        ) : (
          visible.map((f, idx) => {
            const rank = idx + 1;
            const progress = STATUS_PROGRESS[f.status] || { pct: 0, label: f.status };
            const Icon = STATUS_ICON[f.status] || Lightbulb;
            const isTop = rank === 1;

            return (
              <motion.div
                key={f.id}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.08 }}
                className={`p-5 rounded-xl border transition-colors ${
                  isTop ? "border-primary/40 glow-gold" : "border-border/50"
                } bg-card/80`}
              >
                <div className="flex items-start gap-4">
                  <div className={`flex items-center justify-center w-8 h-8 rounded-lg shrink-0 font-mono text-sm font-bold ${
                    isTop ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                  }`}>
                    {rank}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className="h-4 w-4 text-primary shrink-0" />
                      <h4 className="font-display text-lg font-semibold truncate">{f.title}</h4>
                    </div>
                    {f.description && (
                      <p className="text-sm text-muted-foreground leading-relaxed mb-3">{f.description}</p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2 flex-wrap">
                      <span className="font-mono">{progress.label}</span>
                      {f.target_date && (
                        <span>Target: {new Date(f.target_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
                      )}
                      <span>{f.vote_count} vote{f.vote_count !== 1 ? "s" : ""}</span>
                      {f.token_total > 0 && <span className="text-primary">{f.token_total} tokens</span>}
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          f.status === "testing" ? "bg-green-500/70" : f.status === "in-progress" ? "bg-primary/70" : "bg-muted-foreground/30"
                        }`}
                        style={{ width: `${progress.pct}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant={f.user_voted ? "default" : "outline"}
                      disabled={FEATURE_VOTING_ON_HOLD || acting === f.id}
                      onClick={() => handleVote(f.id, f.user_voted, f.user_tokens)}
                      className="text-xs"
                    >
                      <ChevronUp className="h-3 w-3 mr-1" />
                      {f.user_voted ? "Voted" : "Upvote"}
                    </Button>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        min={1}
                        placeholder="0"
                        value={boostAmounts[f.id] || ""}
                        onChange={(e) => setBoostAmounts((prev) => ({ ...prev, [f.id]: e.target.value }))}
                        className="w-16 h-7 text-xs"
                        disabled={FEATURE_VOTING_ON_HOLD || acting === f.id}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={FEATURE_VOTING_ON_HOLD || acting === f.id || !boostAmounts[f.id]}
                        onClick={() => handleBoost(f.id)}
                        title={FEATURE_VOTING_ON_HOLD ? "Temporarily paused" : "Boost this feature"}
                        className="h-7 text-xs px-2"
                      >
                        <Coins className="h-3 w-3 mr-1" /> Boost
                      </Button>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {!loading && features.length > config.max_visible_cards && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full text-center text-sm font-mono text-muted-foreground hover:text-primary transition-colors py-2 mt-4"
        >
          {expanded ? "Show less" : `See all ${features.length} features`}
          <ChevronDown className={`inline ml-1 h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
    </Section>
  );
}
