import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ShieldCheck, Loader2 } from "lucide-react";

export interface AttestationValues {
  is_sole_author: boolean;
  has_rights: boolean;
  acknowledged_terms: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tierLabel: string;
  loading?: boolean;
  onConfirm: (vals: AttestationValues) => Promise<void> | void;
}

const ATTESTATION_TEXT =
  "By submitting this work to a festival or finalist tier, I confirm that I am the sole author or have written authorization from all co-authors, that I hold or have license to all rights necessary for this submission, and that I have read and accept the competition terms and the platform's content policies.";

export default function SubmissionAttestationDialog({ open, onOpenChange, tierLabel, loading, onConfirm }: Props) {
  const [sole, setSole] = useState(false);
  const [rights, setRights] = useState(false);
  const [terms, setTerms] = useState(false);

  const allChecked = sole && rights && terms;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Author Rights Attestation
          </DialogTitle>
          <DialogDescription>
            {tierLabel} submissions require an explicit attestation before they reach festival or studio judges.
          </DialogDescription>
        </DialogHeader>

        <p className="text-xs text-muted-foreground leading-relaxed border border-border/40 rounded-md p-3 bg-muted/20">
          {ATTESTATION_TEXT}
        </p>

        <div className="space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <Checkbox checked={sole} onCheckedChange={(v) => setSole(!!v)} className="mt-0.5" />
            <span className="text-sm">I am the sole author of this work, or have written authorization from every co-author.</span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <Checkbox checked={rights} onCheckedChange={(v) => setRights(!!v)} className="mt-0.5" />
            <span className="text-sm">I hold or have licensed all rights necessary to submit this work for review.</span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <Checkbox checked={terms} onCheckedChange={(v) => setTerms(!!v)} className="mt-0.5" />
            <span className="text-sm">I have read and accept the competition terms and platform content policies.</span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            disabled={!allChecked || loading}
            onClick={() => onConfirm({ is_sole_author: sole, has_rights: rights, acknowledged_terms: terms })}
          >
            {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Confirming…</> : "Confirm & Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ATTESTATION_TEXT };
