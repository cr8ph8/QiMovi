// Surfaces a 7-day rollup of the user's reading + review activity.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { MetricCard } from "@/components/donor/MetricCard";
import { CalendarRange } from "lucide-react";

interface Digest {
  pagesRead: number;
  minutesRead: number;
  reviewsApproved: number;
  tokensEarned: number;
}

export function WeeklyDigest() {
  const { user } = useAuth();
  const [d, setD] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    (async () => {
      const since = new Date(Date.now() - 7 * 86400_000).toISOString();
      const [hist, reviews] = await Promise.all([
        supabase.from("reading_history" as any).select("pages_read,read_minutes,started_at").eq("user_id", user.id).gte("started_at", since),
        supabase.from("club_reviews" as any).select("status,reward_tokens,created_at").eq("user_id", user.id).gte("created_at", since),
      ]);
      const h = (hist.data as any[]) ?? [];
      const r = (reviews.data as any[]) ?? [];
      setD({
        pagesRead: h.reduce((s, x) => s + (x.pages_read ?? 0), 0),
        minutesRead: h.reduce((s, x) => s + (x.read_minutes ?? 0), 0),
        reviewsApproved: r.filter((x) => x.status === "approved").length,
        tokensEarned: r.reduce((s, x) => s + (x.reward_tokens ?? 0), 0),
      });
      setLoading(false);
    })();
  }, [user]);

  if (!user) return null;
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <header className="flex items-center gap-2">
        <CalendarRange className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium">Last 7 days</h3>
      </header>
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MetricCard label="Pages" value={loading ? "—" : d!.pagesRead} />
        <MetricCard label="Minutes" value={loading ? "—" : d!.minutesRead} />
        <MetricCard label="Reviews" value={loading ? "—" : d!.reviewsApproved} tone="primary" />
        <MetricCard label="Tokens" value={loading ? "—" : d!.tokensEarned} />
      </div>
    </div>
  );
}

export default WeeklyDigest;
