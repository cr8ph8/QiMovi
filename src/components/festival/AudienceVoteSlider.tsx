import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAudienceVote } from "@/hooks/useAudienceVote";
import { Heart } from "lucide-react";

export function AudienceVoteSlider({
  sessionId,
  disabled,
}: {
  sessionId: string;
  disabled?: boolean;
}) {
  const { stats, vote } = useAudienceVote(sessionId);
  const [rating, setRating] = useState<number>(stats.myRating ?? 7);
  const [submitting, setSubmitting] = useState(false);

  if (stats.myRating != null) {
    return (
      <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm text-center">
        Thanks — you rated this <span className="font-mono text-primary">{stats.myRating}</span> / 10
      </div>
    );
  }

  if (disabled) {
    return (
      <div className="rounded-md border border-border/40 bg-background/40 p-3 text-xs text-muted-foreground text-center">
        Voting opens when the screening goes live.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-4 space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono uppercase tracking-wider text-muted-foreground">Your rating</span>
        <span className="font-mono text-primary text-lg">{rating}</span>
      </div>
      <Slider value={[rating]} min={1} max={10} step={1} onValueChange={(v) => setRating(v[0])} />
      <Button
        className="w-full"
        disabled={submitting}
        onClick={async () => {
          setSubmitting(true);
          try {
            await vote(rating);
            toast.success("Vote counted");
          } catch (e: any) {
            toast.error(e.message || "Could not submit vote");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <Heart className="h-3.5 w-3.5 mr-1.5" /> Submit vote
      </Button>
    </div>
  );
}
