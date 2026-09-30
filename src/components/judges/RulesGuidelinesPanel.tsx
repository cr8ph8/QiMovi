import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Lock, Save } from "lucide-react";

interface Config {
  rules: string | null;
  guidelines: string | null;
  stipulations: string[];
  locked: boolean;
}

export function RulesGuidelinesPanel({
  competitionId,
  canEdit,
}: {
  competitionId: string;
  canEdit: boolean;
}) {
  const [config, setConfig] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("competition_judge_config")
        .select("rules,guidelines,stipulations,locked")
        .eq("competition_id", competitionId)
        .maybeSingle();
      const stips = (data as { stipulations?: unknown })?.stipulations;
      setConfig({
        rules: (data as { rules?: string })?.rules ?? "",
        guidelines: (data as { guidelines?: string })?.guidelines ?? "",
        stipulations: Array.isArray(stips) ? (stips as string[]) : [],
        locked: (data as { locked?: boolean })?.locked ?? false,
      });
    })();
  }, [competitionId]);

  if (!config) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("competition_judge_config")
      .update({
        rules: config.rules,
        guidelines: config.guidelines,
        stipulations: config.stipulations,
      })
      .eq("competition_id", competitionId);
    setSaving(false);
    if (error) toast.error("Save failed", { description: error.message });
    else toast.success("Rules & guidelines saved");
  };

  const readOnly = !canEdit || config.locked;

  return (
    <div className="space-y-4">
      {config.locked && (
        <div className="flex items-center gap-2 text-xs text-amber-400 font-mono">
          <Lock className="h-3.5 w-3.5" /> Config is locked because the competition is open.
        </div>
      )}
      <div className="space-y-2">
        <Label className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Rules</Label>
        <Textarea
          rows={6}
          value={config.rules ?? ""}
          onChange={(e) => setConfig({ ...config, rules: e.target.value })}
          readOnly={readOnly}
          placeholder="Eligibility, page bounds, content restrictions…"
        />
      </div>
      <div className="space-y-2">
        <Label className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Guidelines</Label>
        <Textarea
          rows={6}
          value={config.guidelines ?? ""}
          onChange={(e) => setConfig({ ...config, guidelines: e.target.value })}
          readOnly={readOnly}
          placeholder="Guidance for judges: tone, weighting context, style notes…"
        />
      </div>
      <div className="space-y-2">
        <Label className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          Stipulations (one per line)
        </Label>
        <Textarea
          rows={4}
          value={config.stipulations.join("\n")}
          onChange={(e) =>
            setConfig({ ...config, stipulations: e.target.value.split("\n").filter(Boolean) })
          }
          readOnly={readOnly}
          placeholder={"Must be original work\nNo AI-generated dialogue"}
        />
      </div>
      {!readOnly && (
        <Button onClick={save} disabled={saving} className="bg-gold-gradient">
          <Save className="h-4 w-4 mr-2" /> {saving ? "Saving…" : "Save"}
        </Button>
      )}
    </div>
  );
}
