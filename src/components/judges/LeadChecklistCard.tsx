import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Crown, CheckCircle2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useEntryReadiness } from "@/hooks/useEntryReadiness";
import { FinalizeReadinessChips } from "./FinalizeReadinessChips";

interface Props {
  entryId: string;
  canEdit: boolean;
  minJudges?: number;
  maxVariance?: number;
}

/**
 * Lead-only checklist block — surfaces readiness chips and the
 * "Mark reviewed" action that finalize gates on.
 */
export function LeadChecklistCard({ entryId, canEdit, minJudges, maxVariance }: Props) {
  const { readiness, markReviewed, clearReview } = useEntryReadiness(entryId);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const reviewed = !!readiness?.lead_reviewed_at;

  return (
    <Card className="p-4 bg-background/40 border-border/40 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Crown className="h-4 w-4 text-primary" />
          <h3 className="font-display text-sm">Lead pre-finalize checklist</h3>
        </div>
        {reviewed && (
          <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-300 inline-flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Reviewed {new Date(readiness!.lead_reviewed_at!).toLocaleString()}
          </span>
        )}
      </div>

      <FinalizeReadinessChips
        readiness={readiness}
        minJudges={minJudges}
        maxVariance={maxVariance}
      />

      {canEdit && !reviewed && (
        <div className="space-y-2 pt-1">
          <Textarea
            placeholder="Optional notes for the audit trail (rubric checks, panel deliberation, etc.)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={1000}
          />
          <Button
            size="sm"
            className="bg-gold-gradient"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const err = await markReviewed(notes || undefined);
              setBusy(false);
              if (err) toast.error("Could not mark reviewed", { description: err.message });
              else toast.success("Marked reviewed — finalize is now unlocked");
            }}
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
            Mark reviewed
          </Button>
        </div>
      )}

      {canEdit && reviewed && (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await clearReview();
            setBusy(false);
            toast.info("Lead review cleared");
          }}
        >
          <Undo2 className="h-3.5 w-3.5 mr-1.5" /> Clear review
        </Button>
      )}
    </Card>
  );
}
