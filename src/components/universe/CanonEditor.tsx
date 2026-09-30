import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import {
  STRUCTURE_LABELS,
  TRADITION_LABELS,
  type NarrativeTradition,
  type StructureModel,
} from "@/lib/narrativeTradition";

interface Canon {
  id?: string;
  tradition: NarrativeTradition;
  structure_model: StructureModel;
  core_want: string;
  core_need: string;
  core_obstacle: string;
  central_pattern: string;
  intended_turn: string;
  equilibrium_state: string;
  theme_claim: string;
  theme_counterclaim: string;
}

const EMPTY: Canon = {
  tradition: "hybrid",
  structure_model: "hybrid",
  core_want: "",
  core_need: "",
  core_obstacle: "",
  central_pattern: "",
  intended_turn: "",
  equilibrium_state: "",
  theme_claim: "",
  theme_counterclaim: "",
};

export default function CanonEditor({
  universeId,
  userId,
  onSaved,
}: {
  universeId: string;
  userId: string;
  onSaved?: (canon: Canon) => void;
}) {
  const [canon, setCanon] = useState<Canon>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("universe_canonical_narrative" as any)
        .select("*")
        .eq("universe_id", universeId)
        .maybeSingle();
      if (data) setCanon({ ...EMPTY, ...(data as any) });
      setLoading(false);
    })();
  }, [universeId]);

  const update = <K extends keyof Canon>(k: K, v: Canon[K]) => setCanon((c) => ({ ...c, [k]: v }));

  const save = async () => {
    setSaving(true);
    const payload = { ...canon, universe_id: universeId, created_by: userId };
    const { data, error } = await supabase
      .from("universe_canonical_narrative" as any)
      .upsert(payload, { onConflict: "universe_id" })
      .select()
      .single();
    setSaving(false);
    if (error) {
      toast.error("Could not save canon", { description: error.message });
      return;
    }
    setCanon({ ...EMPTY, ...(data as any) });
    onSaved?.(data as any);
    toast.success("Canonical narrative saved");
  };

  if (loading) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  return (
    <div className="space-y-5">
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs font-mono uppercase tracking-wide">Tradition</Label>
          <Select value={canon.tradition} onValueChange={(v) => update("tradition", v as NarrativeTradition)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(TRADITION_LABELS) as NarrativeTradition[]).map((t) => (
                <SelectItem key={t} value={t}>{TRADITION_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs font-mono uppercase tracking-wide">Structure model</Label>
          <Select value={canon.structure_model} onValueChange={(v) => update("structure_model", v as StructureModel)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(STRUCTURE_LABELS) as StructureModel[]).map((s) => (
                <SelectItem key={s} value={s}>{STRUCTURE_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <fieldset className="space-y-4 border border-amber-500/20 rounded-lg p-4">
        <legend className="px-2 text-xs font-mono uppercase text-amber-300">Causal column — what the hero wants</legend>
        <div>
          <Label>Core want (external goal)</Label>
          <Input value={canon.core_want} onChange={(e) => update("core_want", e.target.value)} placeholder="What does the protagonist actively pursue?" />
        </div>
        <div>
          <Label>Core need (internal truth)</Label>
          <Input value={canon.core_need} onChange={(e) => update("core_need", e.target.value)} placeholder="What do they actually need, beneath the want?" />
        </div>
        <div>
          <Label>Core obstacle</Label>
          <Input value={canon.core_obstacle} onChange={(e) => update("core_obstacle", e.target.value)} placeholder="What blocks them — antagonist, system, self?" />
        </div>
      </fieldset>

      <fieldset className="space-y-4 border border-sky-500/20 rounded-lg p-4">
        <legend className="px-2 text-xs font-mono uppercase text-sky-300">Relational column — the world's condition</legend>
        <div>
          <Label>Central pattern (Ki · Shō)</Label>
          <Textarea rows={2} value={canon.central_pattern} onChange={(e) => update("central_pattern", e.target.value)} placeholder="What pattern slowly reveals itself across installments?" />
        </div>
        <div>
          <Label>Intended turn (Ten)</Label>
          <Textarea rows={2} value={canon.intended_turn} onChange={(e) => update("intended_turn", e.target.value)} placeholder="What reframe should recontextualize the pattern?" />
        </div>
        <div>
          <Label>Equilibrium state (Ketsu)</Label>
          <Input value={canon.equilibrium_state} onChange={(e) => update("equilibrium_state", e.target.value)} placeholder="What balance is restored, transformed, or accepted?" />
        </div>
      </fieldset>

      <fieldset className="space-y-4 border border-primary/20 rounded-lg p-4">
        <legend className="px-2 text-xs font-mono uppercase text-primary">Theme — the argument under test</legend>
        <div>
          <Label>Claim</Label>
          <Input value={canon.theme_claim} onChange={(e) => update("theme_claim", e.target.value)} placeholder="e.g. Love conquers fear" />
        </div>
        <div>
          <Label>Counterclaim</Label>
          <Input value={canon.theme_counterclaim} onChange={(e) => update("theme_counterclaim", e.target.value)} placeholder="e.g. Fear protects us from pain" />
        </div>
      </fieldset>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save canonical narrative
        </Button>
      </div>
    </div>
  );
}
