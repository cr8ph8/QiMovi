import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Heart, Users, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAudienceVote } from "@/hooks/useAudienceVote";

interface Props {
  sessionId: string;
  filmTitle: string;
  director?: string | null;
}

export function ActiveSessionVotePanel({ sessionId, filmTitle, director }: Props) {
  const { stats, vote } = useAudienceVote(sessionId);
  const [hover, setHover] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const hasVoted = stats.myRating != null;

  const cast = async (rating: number) => {
    setPending(rating);
    try {
      await vote(rating);
      toast.success(`Vote counted — you rated ${rating}/10`);
    } catch (e: any) {
      toast.error(e.message || "Could not submit vote");
    } finally {
      setPending(null);
    }
  };

  return (
    <Card className="p-5 border-primary/60 bg-gradient-to-br from-primary/10 via-background/40 to-background/20 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-primary text-primary animate-pulse">● LIVE</Badge>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Now screening
            </span>
          </div>
          <h2 className="font-display text-2xl">{filmTitle}</h2>
          {director && <div className="text-xs text-muted-foreground">dir. {director}</div>}
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1 justify-end">
            <Users className="h-3 w-3" /> Audience avg
          </div>
          <div className="font-mono text-3xl text-primary leading-tight">
            {stats.average != null ? stats.average.toFixed(1) : "—"}
          </div>
          <div className="text-[10px] font-mono text-muted-foreground">
            {stats.count} {stats.count === 1 ? "vote" : "votes"}
          </div>
        </div>
      </div>

      {hasVoted ? (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Thanks for voting — your rating: <span className="font-mono text-primary">{stats.myRating}/10</span>
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Cast your vote
          </div>
          <div className="grid grid-cols-10 gap-1.5">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
              const active = (hover ?? 0) >= n;
              return (
                <Button
                  key={n}
                  size="sm"
                  variant="outline"
                  disabled={pending != null}
                  onMouseEnter={() => setHover(n)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => cast(n)}
                  className={`h-10 p-0 font-mono text-sm transition-colors ${
                    active
                      ? "bg-primary/20 border-primary text-primary"
                      : "border-border/40 hover:border-primary/60"
                  } ${pending === n ? "opacity-60" : ""}`}
                  aria-label={`Rate ${n} out of 10`}
                >
                  {n}
                </Button>
              );
            })}
          </div>
          <div className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Heart className="h-3 w-3" /> Tap a number 1–10 to submit. One vote per viewer.
          </div>
        </div>
      )}
    </Card>
  );
}
