import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Crown, Gavel, Trash2, UserPlus } from "lucide-react";
import { RoleChip } from "./RoleChip";
import { useCompetitionJudges, type JudgeRole } from "@/hooks/useCompetitionJudges";

export function LeadJudgeManager({
  competitionId,
  canManage,
}: {
  competitionId: string;
  canManage: boolean;
}) {
  const { judges, refresh } = useCompetitionJudges(competitionId);
  const [newUserId, setNewUserId] = useState("");
  const [newRole, setNewRole] = useState<JudgeRole>("judge");
  const [busy, setBusy] = useState(false);

  const leadCount = judges.filter((j) => j.role === "lead").length;

  const add = async () => {
    if (!newUserId.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("competition_judges").insert({
      competition_id: competitionId,
      user_id: newUserId.trim(),
      role: newRole,
    });
    setBusy(false);
    if (error) toast.error("Could not add judge", { description: error.message });
    else {
      toast.success(`Added ${newRole === "lead" ? "Lead Judge" : "Judge"}`);
      setNewUserId("");
      refresh();
    }
  };

  const updateRole = async (id: string, role: JudgeRole) => {
    const { error } = await supabase.from("competition_judges").update({ role }).eq("id", id);
    if (error) toast.error("Update failed", { description: error.message });
    else refresh();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("competition_judges").delete().eq("id", id);
    if (error) toast.error("Remove failed", { description: error.message });
    else refresh();
  };

  return (
    <div className="space-y-4">
      <div className="text-xs font-mono text-muted-foreground">
        {leadCount} Lead{leadCount === 1 ? "" : "s"} · {judges.length - leadCount} Judge{judges.length - leadCount === 1 ? "" : "s"}
      </div>

      {judges.length === 0 && (
        <Card className="p-4 bg-amber-500/5 border-amber-500/30 text-sm text-amber-300">
          No judges assigned. The competition cannot open until at least one Lead Judge is added.
        </Card>
      )}

      {judges.map((j) => (
        <Card key={j.id} className="p-3 bg-background/40 border-border/40 flex items-center gap-3">
          {j.role === "lead" ? <Crown className="h-4 w-4 text-primary" /> : <Gavel className="h-4 w-4 text-muted-foreground" />}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-mono text-foreground truncate">{j.user_id}</div>
            <div className="text-[11px] text-muted-foreground">Assigned {new Date(j.assigned_at).toLocaleDateString()}</div>
          </div>
          <RoleChip role={j.role} />
          {canManage && (
            <>
              {j.role === "judge" ? (
                <Button size="sm" variant="outline" onClick={() => updateRole(j.id, "lead")}>Promote</Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => updateRole(j.id, "judge")} disabled={leadCount < 2}>
                  Demote
                </Button>
              )}
              <Button size="icon" variant="ghost" onClick={() => remove(j.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </>
          )}
        </Card>
      ))}

      {canManage && (
        <Card className="p-4 bg-background/30 border-border/40 space-y-3">
          <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Add judge</div>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label className="text-[10px] font-mono uppercase text-muted-foreground">User ID (auth.users.id)</Label>
              <Input value={newUserId} onChange={(e) => setNewUserId(e.target.value)} placeholder="uuid…" />
            </div>
            <select
              className="bg-background border border-border rounded-md px-2 py-2 text-sm"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as JudgeRole)}
            >
              <option value="judge">Judge</option>
              <option value="lead">Lead</option>
            </select>
            <Button onClick={add} disabled={busy || !newUserId.trim()}>
              <UserPlus className="h-4 w-4 mr-2" /> Add
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
