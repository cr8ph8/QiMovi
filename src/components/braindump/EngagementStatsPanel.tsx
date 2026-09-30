import { useEffect, useState } from "react";
import { BarChart3, Eye, Users, Code2, MessageSquare, Clock, Loader2, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

type Stats = {
  total_views: number;
  unique_viewers: number;
  embed_views: number;
  public_views: number;
  authenticated_views: number;
  last_viewed_at: string | null;
  comment_count: number;
  views_last_7d: number;
  views_last_24h: number;
};

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-border/50 bg-card/40 p-2.5 space-y-0.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="font-display text-lg leading-none">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function EngagementStatsPanel({ briefId }: { briefId: string }) {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.rpc("get_brief_engagement_stats", {
      p_brief_id: briefId,
    });
    if (error) setError(error.message);
    else if (data && (data as Stats[]).length > 0) setStats((data as Stats[])[0]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefId]);

  return (
    <div className="space-y-2 pt-3 mt-2 border-t border-border/50">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5">
          <BarChart3 className="h-3.5 w-3.5" /> Engagement
        </Label>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading} className="h-7 px-2">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </Button>
      </div>

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      {!error && stats && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat
              icon={Eye}
              label="Views"
              value={stats.total_views}
              hint={`${stats.views_last_24h} in 24h · ${stats.views_last_7d} in 7d`}
            />
            <Stat
              icon={Users}
              label="Unique"
              value={stats.unique_viewers}
              hint={`${stats.authenticated_views} signed in`}
            />
            <Stat
              icon={Code2}
              label="Embed"
              value={stats.embed_views}
              hint={`${stats.public_views} on page`}
            />
            <Stat
              icon={MessageSquare}
              label="Comments"
              value={stats.comment_count}
            />
          </div>
          {stats.last_viewed_at && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Last view {formatDistanceToNow(new Date(stats.last_viewed_at), { addSuffix: true })}
            </p>
          )}
          {stats.total_views === 0 && (
            <p className="text-[11px] text-muted-foreground">
              No traffic yet. Share the link or paste the embed code on your site to start measuring outreach.
            </p>
          )}
        </>
      )}
    </div>
  );
}
