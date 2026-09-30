// Compact reviewer profile card — surfaces a member's reading + review footprint.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MetricCard } from "@/components/donor/MetricCard";
import { StatusPill } from "@/components/donor/StatusPill";
import { BookOpen, MessageSquare, Coins } from "lucide-react";

export interface ReviewerProfileCardProps {
  userId: string;
  displayName?: string;
}

interface Stats {
  finished: number;
  reviews: number;
  approved: number;
  tokensEarned: number;
}

export function ReviewerProfileCard({ userId, displayName }: ReviewerProfileCardProps) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    (async () => {
      const [histRes, reviewsRes] = await Promise.all([
        supabase.from("reading_history" as any).select("status", { count: "exact", head: false }).eq("user_id", userId).eq("status", "finished"),
        supabase.from("club_reviews" as any).select("status,reward_tokens").eq("user_id", userId),
      ]);
      const reviews = (reviewsRes.data as any[]) ?? [];
      setStats({
        finished: histRes.count ?? 0,
        reviews: reviews.length,
        approved: reviews.filter((r) => r.status === "approved").length,
        tokensEarned: reviews.reduce((s, r) => s + (r.reward_tokens ?? 0), 0),
      });
    })();
  }, [userId]);

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Reviewer</p>
          <p className="font-medium text-sm">{displayName ?? "Member"}</p>
        </div>
        {stats && stats.approved >= 5 && <StatusPill tone="gold">Trusted</StatusPill>}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <MetricCard label="Finished" value={stats?.finished ?? "—"} footer={<><BookOpen className="h-3 w-3 inline mr-1" /> scripts read</>} />
        <MetricCard label="Reviews" value={stats?.reviews ?? "—"} footer={<><MessageSquare className="h-3 w-3 inline mr-1" /> total written</>} />
        <MetricCard label="Approved" value={stats?.approved ?? "—"} tone="primary" />
        <MetricCard label="Tokens" value={stats?.tokensEarned ?? "—"} footer={<><Coins className="h-3 w-3 inline mr-1" /> earned</>} />
      </div>
    </div>
  );
}

export default ReviewerProfileCard;
