// CreateLinearTicketDialog — admin-only popover for converting any source record
// (entry, governance event, audit row, ai_usage_log error) into a Linear issue.
// Calls the `linear-create-issue` edge function which handles dedupe + mirror.

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Ticket } from "lucide-react";

type TeamSlot = "review_ops" | "ai_systems" | "support" | "product";
type Source = "submission" | "ai_failure" | "support" | "manual" | "governance";

export interface CreateLinearTicketDialogProps {
  source: Source;
  sourceTable?: string | null;
  sourceRecordId?: string | null;
  defaultTeam?: TeamSlot;
  defaultLabels?: string[];
  defaultTitle?: string;
  defaultDescription?: string;
  correlationId?: string | null;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "ghost" | "secondary";
}

const TEAM_OPTIONS: { value: TeamSlot; label: string }[] = [
  { value: "review_ops", label: "CISS Review Ops" },
  { value: "ai_systems", label: "CISS AI Systems" },
  { value: "support", label: "CISS Support" },
  { value: "product", label: "CISS Product" },
];

export default function CreateLinearTicketDialog(props: CreateLinearTicketDialogProps) {
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState<TeamSlot>(props.defaultTeam ?? "review_ops");
  const [title, setTitle] = useState(props.defaultTitle ?? "");
  const [description, setDescription] = useState(props.defaultDescription ?? "");
  const [labels, setLabels] = useState((props.defaultLabels ?? []).join(", "));
  const [priority, setPriority] = useState<number>(3);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      toast.error("Title required");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("linear-create-issue", {
        body: {
          source: props.source,
          source_table: props.sourceTable ?? null,
          source_record_id: props.sourceRecordId ?? null,
          team_slot: team,
          title: title.trim(),
          description: description.trim() || undefined,
          label_slugs: labels
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          priority,
          correlation_id: props.correlationId ?? null,
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) {
        throw new Error((data as { message?: string }).message ?? (data as { error: string }).error);
      }
      toast.success(`Ticket created: ${(data as { issue?: { identifier?: string } })?.issue?.identifier ?? "Linear issue"}`);
      setOpen(false);
    } catch (e) {
      toast.error(`Failed: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={props.triggerVariant ?? "outline"} size="sm">
          <Ticket className="h-3 w-3 mr-1" />
          {props.triggerLabel ?? "Create Ticket"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Linear Ticket</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Team</Label>
            <select
              value={team}
              onChange={(e) => setTeam(e.target.value as TeamSlot)}
              className="w-full bg-background border border-border/40 rounded px-2 py-1.5 text-sm mt-1"
            >
              {TEAM_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Description (markdown)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              className="mt-1 font-mono text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Labels (comma-sep slugs)</Label>
              <Input value={labels} onChange={(e) => setLabels(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Priority</Label>
              <select
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="w-full bg-background border border-border/40 rounded px-2 py-1.5 text-sm mt-1"
              >
                <option value={0}>None</option>
                <option value={1}>Urgent</option>
                <option value={2}>High</option>
                <option value={3}>Medium</option>
                <option value={4}>Low</option>
              </select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>{submitting ? "Creating…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
