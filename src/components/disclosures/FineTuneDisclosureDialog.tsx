import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entryId?: string | null;
  screenplayId?: string | null;
  onDisclosed?: () => void;
  /** When true, dialog cannot be dismissed without saving a disclosure (no Cancel, no outside/esc close). */
  required?: boolean;
}

/**
 * User-facing AI-assistance disclosure tied to Chakrabarty/Ginsburg/Dhillon (2025).
 * Captures whether the work used in-context prompting, a fine-tuned model, or
 * a third-party corpus, plus permission status. Append-only — every submission
 * gets a fresh record. Visible in the admin Fine-Tune Risk panel.
 */
export default function FineTuneDisclosureDialog({
  open, onOpenChange, entryId, screenplayId, onDisclosed, required = false,
}: Props) {
  const [type, setType] = useState<"none" | "in_context_style" | "fine_tuned_model" | "third_party_corpus">("none");
  const [declaredAuthor, setDeclaredAuthor] = useState("");
  const [declaredModel, setDeclaredModel] = useState("");
  const [hasPermission, setHasPermission] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const requiresAuthor = type === "fine_tuned_model" || type === "in_context_style" || type === "third_party_corpus";
  const canSubmit = type === "none" || (requiresAuthor && declaredAuthor.trim().length > 0);

  async function submit() {
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u?.user) throw new Error("Sign in required");
      const { error } = await supabase.from("fine_tune_disclosures").insert({
        user_id: u.user.id,
        entry_id: entryId ?? null,
        screenplay_id: screenplayId ?? null,
        disclosure_type: type,
        declared_author: requiresAuthor ? declaredAuthor.trim() : null,
        declared_model: declaredModel.trim() || null,
        has_permission: hasPermission,
        notes: notes.trim() || null,
      });
      if (error) throw error;
      toast.success(type === "none" ? "Disclosure recorded — no AI author emulation declared." : "Disclosure saved.");
      onDisclosed?.();
      onOpenChange(false);
      // Reset
      setType("none"); setDeclaredAuthor(""); setDeclaredModel(""); setHasPermission(false); setNotes("");
    } catch (e: any) {
      toast.error(e.message || "Could not save disclosure");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (required && !v) return; onOpenChange(v); }}>
      <DialogContent
        className="max-w-lg"
        onInteractOutside={(e) => { if (required) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (required) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Sparkles className="h-4 w-4 text-primary" /> AI Author-Emulation Disclosure
          </DialogTitle>
          <DialogDescription className="text-xs">
            {required && (
              <span className="block mb-1 font-medium text-foreground">
                Required before we can finalize your submission.
              </span>
            )}
            Recent research (Chakrabarty, Ginsburg & Dhillon, 2025) shows fine-tuned models can
            convincingly emulate named authors. Please disclose any AI assistance tied to a specific
            author's voice. Records are append-only and visible to platform admins only.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <RadioGroup value={type} onValueChange={(v: any) => setType(v)} className="space-y-2">
            <DisclosureOption v="none" current={type} label="No author-emulation AI used"
              hint="My writing did not target a specific named author's style via AI." />
            <DisclosureOption v="in_context_style" current={type} label="In-context style prompting"
              hint="I prompted an AI to write 'in the style of' a named author, without fine-tuning." />
            <DisclosureOption v="fine_tuned_model" current={type} label="Fine-tuned model on author's works"
              hint="I (or a tool I used) fine-tuned an AI on a named author's body of work." />
            <DisclosureOption v="third_party_corpus" current={type} label="Third-party corpus assistance"
              hint="I supplied AI with extended excerpts attributed to a third party." />
          </RadioGroup>

          {requiresAuthor && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="declared-author" className="text-xs">Author / source name</Label>
                <Input id="declared-author" value={declaredAuthor}
                  onChange={(e) => setDeclaredAuthor(e.target.value)}
                  placeholder="e.g. Aaron Sorkin" />
              </div>
              <div>
                <Label htmlFor="declared-model" className="text-xs">Model used (optional)</Label>
                <Input id="declared-model" value={declaredModel}
                  onChange={(e) => setDeclaredModel(e.target.value)}
                  placeholder="e.g. GPT-4o fine-tune" />
              </div>
              <label className="flex items-start gap-2 text-xs cursor-pointer">
                <Checkbox checked={hasPermission} onCheckedChange={(v) => setHasPermission(Boolean(v))} />
                <span>I have the rights or explicit permission from the named author / rights-holder.</span>
              </label>
              <div>
                <Label htmlFor="notes" className="text-xs">Notes (optional)</Label>
                <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                  placeholder="Context for reviewers (e.g. public-domain works, licensing)." />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {!required && (
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          )}
          <Button onClick={submit} disabled={!canSubmit || saving}>
            {saving ? "Saving…" : required ? "Save & continue" : "Save disclosure"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DisclosureOption({ v, current, label, hint }: { v: string; current: string; label: string; hint: string }) {
  return (
    <label className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
      current === v ? "border-primary/60 bg-primary/5" : "border-border/40 hover:bg-muted/30"
    }`}>
      <RadioGroupItem value={v} className="mt-0.5" />
      <div className="space-y-0.5">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[11px] text-muted-foreground leading-snug">{hint}</div>
      </div>
    </label>
  );
}
