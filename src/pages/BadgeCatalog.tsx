import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Award, Lock, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BadgeDef {
  key: string;
  label: string;
  icon: string;
  emoji: string;
  description: string;
  category: "submission" | "scoring" | "milestone" | "genre" | "leaderboard" | "special";
}

const BADGE_CATALOG: BadgeDef[] = [
  // Special badges
  { key: "founder", label: "Founder", icon: "star", emoji: "🏅", description: "One of the first people on the platform. Manually granted to early supporters.", category: "special" },
  { key: "founding_tester", label: "Founding Tester", icon: "shield-check", emoji: "🛡️", description: "Selected as an early tester during the closed trial period.", category: "special" },

  // Submission badges
  { key: "first_upload", label: "First Upload", icon: "upload", emoji: "📤", description: "Submit your very first screenplay.", category: "submission" },
  { key: "first_short", label: "First Short", icon: "award", emoji: "🎖️", description: "Submit your first short screenplay.", category: "submission" },
  { key: "first_feature", label: "First Feature", icon: "award", emoji: "🎖️", description: "Submit your first feature-length screenplay.", category: "submission" },
  { key: "first_micro", label: "First Micro", icon: "award", emoji: "🎖️", description: "Submit your first micro screenplay.", category: "submission" },
  { key: "first_pilot", label: "First Pilot", icon: "award", emoji: "🎖️", description: "Submit your first TV pilot.", category: "submission" },
  { key: "multi_draft_master", label: "Multi-Draft Master", icon: "layers", emoji: "📚", description: "Revise an entry to draft 3 or higher.", category: "submission" },

  // Scoring badges
  { key: "first_score", label: "First Score", icon: "star", emoji: "⭐", description: "Receive your first AI judge score.", category: "scoring" },
  { key: "high_scorer", label: "High Scorer", icon: "trophy", emoji: "🏆", description: "Earn a total score of 80 or higher.", category: "scoring" },
  { key: "top_marks", label: "Top Marks", icon: "trophy", emoji: "🏆", description: "Earn a total score of 90 or higher.", category: "scoring" },
  { key: "perfect_category", label: "Perfect Category", icon: "zap", emoji: "⚡", description: "Score the maximum in any single rubric category.", category: "scoring" },

  // Milestone badges
  { key: "five_submissions", label: "5 Submissions", icon: "trophy", emoji: "🏆", description: "Submit 5 screenplays total.", category: "milestone" },
  { key: "ten_submissions", label: "10 Submissions", icon: "trophy", emoji: "🏆", description: "Submit 10 screenplays total.", category: "milestone" },
  { key: "prolific_writer", label: "Prolific Writer", icon: "pen-tool", emoji: "✍️", description: "Have 5 or more scored entries.", category: "milestone" },

  // Genre badges
  { key: "genre_explorer", label: "Genre Explorer", icon: "compass", emoji: "🧭", description: "Submit screenplays in 3 or more different genres.", category: "genre" },
  { key: "genre_drama", label: "Drama Writer", icon: "pen-tool", emoji: "✍️", description: "Submit a screenplay in the Drama genre.", category: "genre" },
  { key: "genre_comedy", label: "Comedy Writer", icon: "pen-tool", emoji: "✍️", description: "Submit a screenplay in the Comedy genre.", category: "genre" },
  { key: "genre_thriller", label: "Thriller Writer", icon: "pen-tool", emoji: "✍️", description: "Submit a screenplay in the Thriller genre.", category: "genre" },
  { key: "genre_sci-fi", label: "Sci-Fi Writer", icon: "pen-tool", emoji: "✍️", description: "Submit a screenplay in the Sci-Fi genre.", category: "genre" },
  { key: "genre_horror", label: "Horror Writer", icon: "pen-tool", emoji: "✍️", description: "Submit a screenplay in the Horror genre.", category: "genre" },
  { key: "genre_romance", label: "Romance Writer", icon: "pen-tool", emoji: "✍️", description: "Submit a screenplay in the Romance genre.", category: "genre" },

  // Leaderboard placement badges
  { key: "leaderboard_gold", label: "Gold Placement", icon: "trophy", emoji: "🥇", description: "Finish 1st in a competition.", category: "leaderboard" },
  { key: "leaderboard_silver", label: "Silver Placement", icon: "trophy", emoji: "🥈", description: "Finish 2nd in a competition.", category: "leaderboard" },
  { key: "leaderboard_bronze", label: "Bronze Placement", icon: "trophy", emoji: "🥉", description: "Finish 3rd in a competition.", category: "leaderboard" },
  { key: "leaderboard_top10", label: "Top 10 Finish", icon: "award", emoji: "🏅", description: "Finish in the Top 10 of a competition.", category: "leaderboard" },
];

const CATEGORY_LABELS: Record<string, string> = {
  special: "Special",
  submission: "Submission",
  scoring: "Scoring",
  milestone: "Milestones",
  genre: "Genre",
  leaderboard: "Leaderboard",
};

const CATEGORY_ORDER: Array<BadgeDef["category"]> = ["special", "leaderboard", "submission", "scoring", "milestone", "genre"];

export default function BadgeCatalog() {
  const { user, loading: authLoading } = useAuth();
  const [earnedKeys, setEarnedKeys] = useState<Set<string>>(new Set());
  const [earnedDates, setEarnedDates] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Helper: leaderboard badges have keys like "leaderboard_gold_<uuid>"
  // Match them to catalog entries by prefix
  function matchesCatalogBadge(earnedKey: string, catalogKey: string): boolean {
    if (earnedKey === catalogKey) return true;
    // Leaderboard badges: earned key starts with catalog key + "_"
    if (catalogKey.startsWith("leaderboard_") && earnedKey.startsWith(catalogKey + "_")) return true;
    return false;
  }

  function hasCatalogBadge(catalogKey: string): boolean {
    return [...earnedKeys].some((k) => matchesCatalogBadge(k, catalogKey));
  }

  function getCatalogBadgeDate(catalogKey: string): string | undefined {
    for (const k of earnedKeys) {
      if (matchesCatalogBadge(k, catalogKey) && earnedDates[k]) return earnedDates[k];
    }
    return undefined;
  }

  // Count how many times a leaderboard badge was earned (multiple competitions)
  function getCatalogBadgeCount(catalogKey: string): number {
    return [...earnedKeys].filter((k) => matchesCatalogBadge(k, catalogKey)).length;
  }

  useEffect(() => {
    async function fetch() {
      if (!user) { setLoading(false); return; }
      const { data } = await supabase
        .from("user_badges")
        .select("badge_key, badge_label, earned_at")
        .eq("user_id", user.id);
      const keys = new Set<string>();
      const dates: Record<string, string> = {};
      const labels: Record<string, string> = {};
      for (const b of data || []) {
        keys.add(b.badge_key);
        dates[b.badge_key] = b.earned_at;
        labels[b.badge_key] = b.badge_label;
      }
      setEarnedKeys(keys);
      setEarnedDates(dates);
      setEarnedLabels(labels);
      setLoading(false);
    }
    if (!authLoading) fetch();
  }, [user, authLoading]);

  const [earnedLabels, setEarnedLabels] = useState<Record<string, string>>({});

  const earnedCount = BADGE_CATALOG.filter((b) => hasCatalogBadge(b.key)).length;
  const percent = Math.round((earnedCount / BADGE_CATALOG.length) * 100);

  if (authLoading || loading) {
    return (
      <section className="min-h-screen pt-20 pb-20 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </section>
    );
  }

  return (
    <section className="min-h-screen pt-20 pb-20">
      <div className="container max-w-4xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Link to="/my-submissions">
            <Button variant="ghost" size="sm" className="mb-4 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to Dashboard
            </Button>
          </Link>

          <div className="flex items-center gap-3 mb-2">
            <Award className="h-6 w-6 text-primary" />
            <h1 className="font-display text-3xl md:text-4xl font-bold">Badge Catalog</h1>
          </div>
          <p className="text-muted-foreground text-sm mb-6">
            {user
              ? `${earnedCount} of ${BADGE_CATALOG.length} badges unlocked`
              : "Sign in to start earning badges"}
          </p>

          {user && (
            <div className="mb-8">
              <Progress value={percent} className="h-2.5" />
              <p className="text-xs font-mono text-muted-foreground mt-1.5">{percent}% complete</p>
            </div>
          )}
        </motion.div>

        {CATEGORY_ORDER.map((cat, ci) => {
          const badges = BADGE_CATALOG.filter((b) => b.category === cat);
          return (
            <motion.div
              key={cat}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: ci * 0.05 }}
              className="mb-8"
            >
              <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
                <span className="text-xs font-mono uppercase tracking-[0.15em] text-muted-foreground">
                  {CATEGORY_LABELS[cat]}
                </span>
                <Badge variant="secondary" className="text-[10px] font-mono">
                  {badges.filter((b) => hasCatalogBadge(b.key)).length}/{badges.length}
                </Badge>
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {badges.map((badge) => {
                  const earned = hasCatalogBadge(badge.key);
                  const earnedAt = getCatalogBadgeDate(badge.key);
                  const count = getCatalogBadgeCount(badge.key);
                  return (
                    <div
                      key={badge.key}
                      className={`rounded-xl border p-4 transition-colors ${
                        earned
                          ? "border-primary/30 bg-card/90"
                          : "border-border/30 bg-card/40 opacity-60"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`text-2xl ${earned ? "" : "grayscale"}`}>
                          {earned ? badge.emoji : <Lock className="h-5 w-5 text-muted-foreground/50 mt-0.5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <h3 className={`font-display text-sm font-semibold ${earned ? "text-foreground" : "text-muted-foreground"}`}>
                              {badge.label}
                            </h3>
                            {earned && (
                              <Badge variant="outline" className="text-[9px] font-mono border-primary/30 text-primary">
                                Unlocked{count > 1 ? ` ×${count}` : ""}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {badge.description}
                          </p>
                          {earned && earnedAt && (
                            <p className="text-[10px] font-mono text-primary/60 mt-1">
                              Earned {new Date(earnedAt).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
