import { useState } from "react";
import { Trash2, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { logAuditEvent } from "@/lib/audit";

interface WalletDataDeletionProps {
  userId: string;
}

export function WalletDataDeletion({ userId }: WalletDataDeletionProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<"idle" | "confirm" | "reason" | "submitting" | "done">("idle");
  const [reason, setReason] = useState("");

  async function handleSubmit() {
    setStep("submitting");
    try {
      // Insert deletion request
      const { error: reqError } = await supabase
        .from("data_deletion_requests")
        .insert({ user_id: userId, reason: reason || null, status: "pending" });

      if (reqError) throw reqError;

      // Audit log (fire-and-forget; logAuditEvent swallows failures)
      await logAuditEvent({
        userId: userId,
        action: "data_deletion_requested",
        details: {
          reason: reason || "No reason provided",
          requested_at: new Date().toISOString(),
          source: "floating_wallet",
        },
      });


      setStep("done");
      toast({
        title: "Deletion request submitted",
        description: "Your request will be reviewed by our team. You'll be notified once processed.",
      });
    } catch (err: any) {
      toast({ title: "Request failed", description: err.message, variant: "destructive" });
      setStep("idle");
    }
  }

  if (step === "done") {
    return (
      <div className="px-5 py-2">
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-center">
          <p className="text-[11px] text-primary font-mono">Deletion request pending review</p>
        </div>
      </div>
    );
  }

  if (step === "confirm" || step === "reason") {
    return (
      <div className="px-5 py-2">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-[11px] font-body font-semibold text-destructive">
                This will permanently remove all your data
              </p>
              <p className="text-[10px] text-muted-foreground font-body mt-0.5">
                Entries, scores, subscriptions, tokens, and usage history will be deleted after admin review.
              </p>
            </div>
          </div>
          {step === "reason" && (
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Optional: Why are you requesting deletion?"
              className="w-full text-[11px] font-body rounded-md border border-border/40 bg-background px-2 py-1.5 resize-none h-14 focus:outline-none focus:ring-1 focus:ring-destructive/40"
              maxLength={500}
            />
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="flex-1 text-[10px] h-7"
              onClick={() => setStep("idle")}
            >
              Cancel
            </Button>
            {step === "confirm" ? (
              <Button
                size="sm"
                variant="destructive"
                className="flex-1 text-[10px] h-7"
                onClick={() => setStep("reason")}
              >
                Continue
              </Button>
            ) : (
              <Button
                size="sm"
                variant="destructive"
                className="flex-1 text-[10px] h-7 gap-1"
                onClick={handleSubmit}
              >
                Submit request
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 py-2">
      <button
        onClick={() => setStep("confirm")}
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 hover:text-destructive/80 font-mono transition-colors"
      >
        <Trash2 className="h-3 w-3" />
        Request data deletion
      </button>
    </div>
  );
}
