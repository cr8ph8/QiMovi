import { Award, PenTool, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { motion } from "framer-motion";

const TOTAL_BADGES = 20; // Total possible achievement badges

interface UserBadge {
  id: string;
  badge_key: string;
  badge_label: string;
  badge_icon: string;
  earned_at: string;
}

interface AchievementsPanelProps {
  badges: UserBadge[];
  genreStats: Array<{ genre: string; count: number }>;
  userId: string;
}

function badgeEmoji(icon: string): string {
  const map: Record<string, string> = {
    upload: "📤",
    "pen-tool": "✍️",
    star: "⭐",
    trophy: "🏆",
    zap: "⚡",
    award: "🎖️",
    layers: "📚",
    compass: "🧭",
  };
  return map[icon] || "🏅";
}

export default function AchievementsPanel({ badges, genreStats, userId }: AchievementsPanelProps) {
  const badgePercent = Math.round((badges.length / TOTAL_BADGES) * 100);
  const totalGenreEntries = genreStats.reduce((sum, g) => sum + g.count, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 }}
      className="rounded-xl border border-border/50 bg-card/80 p-6 mb-6"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Award className="h-5 w-5 text-primary" />
          <h2 className="font-display text-lg font-semibold">Writer Achievements</h2>
        </div>
        <Link
          to="/badges"
          className="flex items-center gap-1 text-xs font-mono text-primary hover:text-primary/80 transition-colors"
        >
          View All <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Progress overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Badges Unlocked</span>
            <span className="text-xs font-mono text-primary font-semibold">{badges.length} / {TOTAL_BADGES}</span>
          </div>
          <Progress value={badgePercent} className="h-2" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Genres Explored</span>
            <span className="text-xs font-mono text-primary font-semibold">{genreStats.length} genres · {totalGenreEntries} entries</span>
          </div>
          <Progress value={Math.min(genreStats.length * 10, 100)} className="h-2" />
        </div>
      </div>

      {/* Badges */}
      {badges.length > 0 && (
        <div className="mb-4">
          <div className="flex flex-wrap gap-2">
            {badges.map((badge) => (
              <Badge
                key={badge.id}
                variant="outline"
                className="text-xs font-mono border-primary/30 text-primary py-1 px-2.5"
                title={`Earned ${new Date(badge.earned_at).toLocaleDateString()}`}
              >
                {badgeEmoji(badge.badge_icon)} {badge.badge_label}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Genre Stats */}
      {genreStats.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <PenTool className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Genre Breakdown</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {genreStats.map((gs) => (
              <Badge key={gs.genre} variant="secondary" className="text-xs font-mono">
                {gs.genre} · {gs.count}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {badges.length === 0 && genreStats.length === 0 && (
        <p className="text-sm text-muted-foreground">Submit your first screenplay to start earning achievements.</p>
      )}
    </motion.div>
  );
}
