import { useCompetitionAudienceTotals } from "@/hooks/useAudienceVote";
import { Card } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Trophy, EyeOff, Info } from "lucide-react";

interface Props {
  competitionId: string;
  films: Array<{ id: string; film_title: string | null; title: string | null }>;
}

export function AudienceLeaderboard({ competitionId, films }: Props) {
  const totals = useCompetitionAudienceTotals(competitionId);
  const ranked = films
    .map((f) => ({ ...f, ...(totals[f.id] ?? { count: 0, average: 0 }) }))
    .sort((a, b) => b.average - a.average || b.count - a.count);

  return (
    <Card className="p-4 bg-background/40 border-border/40">
      <div className="flex items-center gap-2 mb-3">
        <Trophy className="h-4 w-4 text-primary" />
        <h3 className="font-display text-lg">Audience Leaderboard</h3>
      </div>
      <ol className="space-y-1.5">
        {ranked.map((f, i) => (
          <li
            key={f.id}
            className="flex items-center justify-between text-sm py-1.5 px-2 rounded border border-border/30 bg-background/40"
          >
            <span className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground w-5">#{i + 1}</span>
              <span className="font-body">{f.film_title || f.title || "Untitled"}</span>
            </span>
            <span className="text-xs text-muted-foreground font-mono">
              {f.count ? `${f.average.toFixed(1)} (${f.count})` : "—"}
            </span>
          </li>
        ))}
      </ol>

      <TooltipProvider delayDuration={150}>
        <div
          className="mt-3 rounded-md border border-border/40 bg-background/60 p-2.5 flex items-start gap-2"
          aria-label="Audience vote transparency"
        >
          <EyeOff className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 text-[11px] text-muted-foreground leading-snug">
            Only aggregated audience metrics are shown. Individual votes and
            voter identities stay private under row-level security.
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center ml-1 align-middle text-muted-foreground/80 hover:text-foreground"
                  aria-label="Why are individual votes private?"
                >
                  <Info className="h-3 w-3" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-xs">
                The audience vote table is protected by RLS: each voter can read
                only their own row. The leaderboard displays only the
                aggregated average and vote count from
                <code className="mx-1 font-mono">screening_audience_vote_aggregates</code>,
                so no one can reconstruct who voted for what.
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>
    </Card>
  );
}
