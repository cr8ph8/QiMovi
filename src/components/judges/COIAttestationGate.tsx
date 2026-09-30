import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ShieldAlert, ShieldCheck, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { useJudgeCOI } from "@/hooks/useJudgeCOI";
import { useJudgeRecusals } from "@/hooks/useJudgeRecusals";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  entryId: string;
  /** Renders children only when judge has attested "no conflict". */
  children: React.ReactNode;
}

/**
 * Gate that blocks scorecard editing until the judge has attested no conflict
 * of interest (or recused themselves) for this entry.
 */
export function COIAttestationGate({ entryId, children }: Props) {
  const { user } = useAuth();
  const { attestation, attest } = useJudgeCOI(entryId);
  const { recusals, recuse } = useJudgeRecusals(entryId);
  const [note, setNote] = useState("");
  const [recuseReason, setRecuseReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showRecuse, setShowRecuse] = useState(false);

  const selfRecused = !!user && recusals.some((r) => r.judge_user_id === user.id);

  if (selfRecused) {
    return (
      <Card className="p-6 bg-amber-500/5 border-amber-500/30 text-center space-y-2">
        <UserMinus className="h-6 w-6 text-amber-300 mx-auto" />
        <div className="font-display text-lg text-amber-200">You are recused from this entry</div>
        <p className="text-sm text-muted-foreground">
          Your scorecard will not be counted toward consensus. Contact a Lead Judge if this was a mistake.
        </p>
      </Card>
    );
  }

  if (attestation && !attestation.has_conflict) {
    return <>{children}</>;
  }

  return (
    <Card className="p-6 bg-background/40 border-border/40 space-y-4">
      <div className="flex items-start gap-3">
        <ShieldAlert className="h-5 w-5 text-primary mt-1 shrink-0" />
        <div>
          <h3 className="font-display text-lg">Conflict-of-Interest attestation required</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Before scoring this entry, confirm you have no personal, financial, or professional
            relationship with the writer that would impair an impartial review.
          </p>
        </div>
      </div>

      {!showRecuse ? (
        <div className="space-y-3">
          <Textarea
            placeholder="Optional context for the audit trail (e.g. 'reviewed for prior co-writing — none found')"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              className="bg-gold-gradient"
              disabled={submitting}
              onClick={async () => {
                setSubmitting(true);
                const err = await attest(false, note || undefined);
                setSubmitting(false);
                if (err) toast.error("Could not record attestation", { description: err.message });
                else toast.success("Attestation recorded — you may now score this entry");
              }}
            >
              <ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> I have no conflict
            </Button>
            <Button variant="outline" onClick={() => setShowRecuse(true)}>
              <UserMinus className="h-3.5 w-3.5 mr-1.5" /> Recuse myself
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Textarea
            placeholder="Reason for recusal (visible to the Lead Judge; min 5 characters)"
            value={recuseReason}
            onChange={(e) => setRecuseReason(e.target.value)}
            rows={3}
            maxLength={500}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              disabled={submitting || recuseReason.trim().length < 5 || !user}
              onClick={async () => {
                if (!user) return;
                setSubmitting(true);
                // Mark the COI flag first (defense in depth), then create the recusal.
                await attest(true, recuseReason);
                const err = await recuse(user.id, recuseReason);
                setSubmitting(false);
                if (err) toast.error("Could not record recusal", { description: err.message });
                else toast.success("You have been recused from this entry");
              }}
            >
              Confirm recusal
            </Button>
            <Button variant="ghost" onClick={() => setShowRecuse(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
