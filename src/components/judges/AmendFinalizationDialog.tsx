import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  entryId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAmended?: () => void;
}

export function AmendFinalizationDialog({ entryId, open, onOpenChange, onAmended }: Props) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const valid = reason.trim().length >= 20;

  const submit = async () => {
    if (!entryId || !valid) return;
    setSubmitting(true);
    const { error } = await supabase.rpc("unfinalize_entry_score", {
      _entry_id: entryId,
      _reason: reason.trim(),
    });
    setSubmitting(false);
    if (error) {
      toast.error("Could not amend finalized score", { description: error.message });
      return;
    }
    toast.success("Entry amended — finalize again after review");
    setReason("");
    onOpenChange(false);
    onAmended?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-background border-border/60">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Undo2 className="h-5 w-5 text-amber-400" /> Amend finalized score
          </DialogTitle>
          <DialogDescription>
            This will mark the current score as superseded, move the entry back to
            <span className="font-mono text-foreground"> under_review</span>, and clear the
            Lead Judge review stamp. Previous scores are kept for audit history.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Reason for amendment (required, ≥ 20 chars)
          </label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. New rubric weighting discovered after publication; rescoring required."
            rows={5}
            maxLength={2000}
          />
          <div className="text-[10px] font-mono text-muted-foreground text-right">
            {reason.trim().length}/20 minimum
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!valid || submitting} onClick={submit}>
            {submitting ? "Amending…" : "Amend & re-open"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
