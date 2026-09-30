import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { UserMinus, UserX } from "lucide-react";
import { toast } from "sonner";
import { useJudgeRecusals } from "@/hooks/useJudgeRecusals";
import { useCompetitionJudges } from "@/hooks/useCompetitionJudges";

interface Props {
  entryId: string;
  competitionId: string | null;
  canEdit: boolean;
}

/** Lead/admin tool: recuse or restore individual judges on a single entry. */
export function RecusalManager({ entryId, competitionId, canEdit }: Props) {
  const { recusals, recuse, unrecuse } = useJudgeRecusals(entryId);
  const { judges } = useCompetitionJudges(competitionId);
  const [selected, setSelected] = useState<string>("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (!canEdit) {
    if (recusals.length === 0) return null;
    return (
      <Card className="p-3 bg-background/40 border-border/40 space-y-1.5">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Recused judges
        </div>
        <div className="flex flex-wrap gap-1.5">
          {recusals.map((r) => (
            <Badge
              key={r.id}
              variant="outline"
              className="bg-amber-500/10 border-amber-500/30 text-amber-200 text-[10px]"
              title={r.reason}
            >
              <UserMinus className="h-3 w-3 mr-1" />
              {r.judge_user_id.slice(0, 8)}…
            </Badge>
          ))}
        </div>
      </Card>
    );
  }

  const available = judges.filter(
    (j) => !recusals.some((r) => r.judge_user_id === j.user_id),
  );

  return (
    <Card className="p-3 bg-background/40 border-border/40 space-y-3">
      <div className="flex items-center gap-2">
        <UserX className="h-4 w-4 text-primary" />
        <div className="font-display text-sm">Recusals for this entry</div>
      </div>

      {recusals.length > 0 && (
        <div className="space-y-1">
          {recusals.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-2 text-xs border border-border/30 rounded p-2 bg-background/30"
            >
              <UserMinus className="h-3 w-3 text-amber-300" />
              <div className="flex-1 min-w-0">
                <div className="font-mono">{r.judge_user_id.slice(0, 8)}…</div>
                <div className="text-muted-foreground truncate">{r.reason}</div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const err = await unrecuse(r.id);
                  setBusy(false);
                  if (err) toast.error(err.message);
                  else toast.success("Recusal removed");
                }}
              >
                Restore
              </Button>
            </div>
          ))}
        </div>
      )}

      {available.length > 0 ? (
        <div className="space-y-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full bg-background/40 border border-border/40 rounded text-sm px-2 py-1.5"
          >
            <option value="">Select a judge to recuse…</option>
            {available.map((j) => (
              <option key={j.user_id} value={j.user_id}>
                {j.user_id.slice(0, 8)}… ({j.role})
              </option>
            ))}
          </select>
          <Textarea
            placeholder="Reason for recusal (min 5 chars; visible in audit trail)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
          />
          <Button
            size="sm"
            variant="destructive"
            disabled={!selected || reason.trim().length < 5 || busy}
            onClick={async () => {
              setBusy(true);
              const err = await recuse(selected, reason);
              setBusy(false);
              if (err) {
                toast.error(err.message);
              } else {
                toast.success("Judge recused from this entry");
                setSelected("");
                setReason("");
              }
            }}
          >
            <UserMinus className="h-3.5 w-3.5 mr-1.5" /> Recuse judge
          </Button>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          All eligible judges are already recused or none are on the roster.
        </div>
      )}
    </Card>
  );
}
