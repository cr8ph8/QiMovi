// Opens a dispute against a review whose AI verdict the user contests.
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Flag } from "lucide-react";

const REASONS = [
  { value: "ai_misread",        label: "AI misread the review" },
  { value: "bias",              label: "Bias / unfair scoring" },
  { value: "rules_violation",   label: "Violates community rules" },
  { value: "plagiarism",        label: "Plagiarized content" },
  { value: "other",             label: "Other" },
];

export function ReviewDisputeModal({
  open, onOpenChange, reviewId, onSubmitted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  reviewId: string;
  onSubmitted?: () => void;
}) {
  const { user } = useAuth();
  const [category, setCategory] = useState("ai_misread");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const composed = `[${category}] ${details.trim()}`;
  const detailsLen = details.trim().length;

  const submit = async () => {
    if (!user) { toast.error("Sign in to dispute"); return; }
    // review_disputes.reason has CHECK length 20..2000
    if (composed.length < 20) { toast.error("Please describe the issue in more detail."); return; }
    setSubmitting(true);
    const { error } = await supabase.from("review_disputes" as any).insert({
      review_id: reviewId,
      user_id: user.id,
      reason: composed.slice(0, 2000),
      status: "open",
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Dispute opened. A moderator will review it.");
    onOpenChange(false);
    setDetails("");
    onSubmitted?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="h-4 w-4 text-destructive" /> Dispute this review
          </DialogTitle>
          <DialogDescription>
            Tell us what's wrong. Moderators triage disputes in order received.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Details ({detailsLen} chars)</Label>
            <Textarea
              rows={4}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Quote the parts of the review you're contesting and explain why."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || composed.length < 20}>
            {submitting ? "Filing…" : "File dispute"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ReviewDisputeModal;
