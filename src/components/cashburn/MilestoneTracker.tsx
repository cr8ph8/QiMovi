import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, AlertTriangle } from "lucide-react";
import { RunwayMilestone } from "@/hooks/useCashBurn";
import { formatCurrency } from "./BurnSummaryCards";

interface Props {
  milestones: RunwayMilestone[];
  canEdit: boolean;
  runwayMonths: number | null;
  onUpsert: (m: Partial<RunwayMilestone>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  complete: "Complete",
  at_risk: "At risk",
};

export function MilestoneTracker({ milestones, canEdit, runwayMonths, onUpsert, onDelete }: Props) {
  const [newTitle, setNewTitle] = useState("");
  const runwayEnd = runwayMonths !== null ? new Date(Date.now() + runwayMonths * 30 * 24 * 3600 * 1000) : null;

  const add = async () => {
    if (!newTitle.trim()) return;
    await onUpsert({ title: newTitle.trim(), status: "not_started" });
    setNewTitle("");
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Runway milestones</h3>
      {canEdit && (
        <div className="flex gap-2">
          <Input placeholder="New milestone (e.g. Launch paid competition)" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          <Button onClick={add}><Plus className="h-3 w-3 mr-1" />Add</Button>
        </div>
      )}
      <div className="grid gap-2">
        {milestones.length === 0 && <div className="text-sm text-muted-foreground">No milestones yet.</div>}
        {milestones.map((m) => {
          const past = runwayEnd && m.target_date && new Date(m.target_date) > runwayEnd;
          return (
            <Card key={m.id} className="p-3">
              <div className="flex items-start gap-3">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Input
                      defaultValue={m.title}
                      onBlur={(e) => e.target.value !== m.title && onUpsert({ id: m.id, title: e.target.value })}
                      disabled={!canEdit}
                      className="h-8 max-w-xs"
                    />
                    {past && (
                      <Badge variant="outline" className="border-red-500/30 text-red-400 bg-red-500/10 text-xs gap-1">
                        <AlertTriangle className="h-3 w-3" /> Past runway
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-2 flex-wrap items-center text-xs">
                    <Input
                      type="date"
                      defaultValue={m.target_date ?? ""}
                      onBlur={(e) => onUpsert({ id: m.id, target_date: e.target.value || null })}
                      disabled={!canEdit}
                      className="h-8 w-40"
                    />
                    <Input
                      type="number"
                      defaultValue={m.estimated_cost}
                      onBlur={(e) => onUpsert({ id: m.id, estimated_cost: Number(e.target.value) })}
                      disabled={!canEdit}
                      className="h-8 w-32"
                      placeholder="Est. cost"
                    />
                    <span className="text-muted-foreground">{formatCurrency(Number(m.estimated_cost))}</span>
                    <Select defaultValue={m.status} onValueChange={(v) => onUpsert({ id: m.id, status: v as any })} disabled={!canEdit}>
                      <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Textarea
                    defaultValue={m.notes ?? ""}
                    placeholder="Notes"
                    onBlur={(e) => e.target.value !== (m.notes ?? "") && onUpsert({ id: m.id, notes: e.target.value })}
                    disabled={!canEdit}
                    className="text-xs min-h-[60px]"
                  />
                </div>
                {canEdit && (
                  <Button size="icon" variant="ghost" onClick={() => onDelete(m.id)}><Trash2 className="h-3 w-3" /></Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
