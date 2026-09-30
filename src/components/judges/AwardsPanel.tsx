import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Trophy, Plus, Trash2, Save } from "lucide-react";

interface Award {
  title: string;
  description: string;
  prize_tokens: number;
  criteria: string;
}

export function AwardsPanel({
  competitionId,
  canEdit,
}: {
  competitionId: string;
  canEdit: boolean;
}) {
  const [awards, setAwards] = useState<Award[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("competition_judge_config")
        .select("awards")
        .eq("competition_id", competitionId)
        .maybeSingle();
      const a = (data as { awards?: unknown })?.awards;
      setAwards(Array.isArray(a) ? (a as Award[]) : []);
      setLoaded(true);
    })();
  }, [competitionId]);

  const update = (i: number, patch: Partial<Award>) => {
    setAwards((arr) => arr.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  };

  const add = () => {
    setAwards((arr) => [...arr, { title: "", description: "", prize_tokens: 0, criteria: "" }]);
  };
  const remove = (i: number) => setAwards((arr) => arr.filter((_, idx) => idx !== i));

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("competition_judge_config")
      .update({ awards: awards as unknown as never })
      .eq("competition_id", competitionId);
    setSaving(false);
    if (error) toast.error("Save failed", { description: error.message });
    else toast.success("Awards saved");
  };

  if (!loaded) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-3">
      {awards.length === 0 && (
        <div className="text-sm text-muted-foreground italic">No awards configured yet.</div>
      )}
      {awards.map((a, i) => (
        <Card key={i} className="p-4 bg-background/40 border-border/40 space-y-3">
          <div className="flex items-start gap-3">
            <Trophy className="h-5 w-5 text-primary mt-1" />
            <div className="flex-1 grid grid-cols-2 gap-3">
              <div>
                <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Title</Label>
                <Input value={a.title} readOnly={!canEdit} onChange={(e) => update(i, { title: e.target.value })} />
              </div>
              <div>
                <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Prize (tokens)</Label>
                <Input
                  type="number"
                  value={a.prize_tokens}
                  readOnly={!canEdit}
                  onChange={(e) => update(i, { prize_tokens: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="col-span-2">
                <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Description</Label>
                <Textarea rows={2} value={a.description} readOnly={!canEdit} onChange={(e) => update(i, { description: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Selection criteria</Label>
                <Textarea rows={2} value={a.criteria} readOnly={!canEdit} onChange={(e) => update(i, { criteria: e.target.value })} />
              </div>
            </div>
            {canEdit && (
              <Button variant="ghost" size="icon" onClick={() => remove(i)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
          </div>
        </Card>
      ))}
      {canEdit && (
        <div className="flex gap-2">
          <Button variant="outline" onClick={add}>
            <Plus className="h-4 w-4 mr-2" /> Add award
          </Button>
          <Button onClick={save} disabled={saving} className="bg-gold-gradient">
            <Save className="h-4 w-4 mr-2" /> {saving ? "Saving…" : "Save awards"}
          </Button>
        </div>
      )}
    </div>
  );
}
