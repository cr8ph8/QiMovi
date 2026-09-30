import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Users, Sparkles, Cpu, Save, Lock } from "lucide-react";

type Mode = "human" | "hybrid" | "ai";

interface ModeSettings {
  min_reviewers?: number;
  ai_weight_pct?: number;
  model_id?: string;
  temperature?: number;
}

interface Config {
  judging_mode: Mode;
  mode_settings: ModeSettings;
  model_id: string;
  locked: boolean;
}

const TILES: { mode: Mode; label: string; description: string; icon: typeof Users }[] = [
  { mode: "human", label: "Human", description: "Panel of human judges only.", icon: Users },
  { mode: "hybrid", label: "Hybrid", description: "AI assists; humans confirm.", icon: Sparkles },
  { mode: "ai", label: "AI", description: "Median-of-3 AI consensus.", icon: Cpu },
];

export function JudgingModePanel({
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
        .select("judging_mode,mode_settings,model_id,locked")
        .eq("competition_id", competitionId)
        .maybeSingle();
      if (!data) return;
      const settings = (data as { mode_settings?: unknown }).mode_settings;
      setConfig({
        judging_mode: ((data as { judging_mode?: Mode }).judging_mode ?? "ai"),
        mode_settings: (typeof settings === "object" && settings) ? (settings as ModeSettings) : {},
        model_id: (data as { model_id?: string }).model_id ?? "google/gemini-3-flash-preview",
        locked: (data as { locked?: boolean }).locked ?? false,
      });
    })();
  }, [competitionId]);

  if (!config) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const readOnly = !canEdit || config.locked;

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("competition_judge_config")
      .update({
        judging_mode: config.judging_mode,
        mode_settings: config.mode_settings as unknown as never,
        model_id: config.model_id,
      })
      .eq("competition_id", competitionId);
    setSaving(false);
    if (error) toast.error("Save failed", { description: error.message });
    else toast.success("Judging mode saved");
  };

  return (
    <div className="space-y-4">
      {config.locked && (
        <div className="flex items-center gap-2 text-xs text-amber-400 font-mono">
          <Lock className="h-3.5 w-3.5" /> Config is locked.
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        {TILES.map((t) => {
          const active = config.judging_mode === t.mode;
          const Icon = t.icon;
          return (
            <button
              key={t.mode}
              disabled={readOnly}
              onClick={() => setConfig({ ...config, judging_mode: t.mode })}
              className={`p-4 rounded-lg border text-left transition-all disabled:cursor-not-allowed disabled:opacity-70 ${
                active
                  ? "border-primary/60 bg-primary/10 shadow-[0_0_24px_-12px_hsl(var(--primary))]"
                  : "border-border/40 bg-background/40 hover:border-primary/30"
              }`}
            >
              <Icon className={`h-5 w-5 mb-2 ${active ? "text-primary" : "text-muted-foreground"}`} />
              <div className={`font-display text-lg ${active ? "text-primary" : "text-foreground"}`}>{t.label}</div>
              <div className="text-xs text-muted-foreground mt-1">{t.description}</div>
            </button>
          );
        })}
      </div>

      <Card className="p-4 bg-background/30 border-border/40 space-y-4">
        {(config.judging_mode === "human" || config.judging_mode === "hybrid") && (
          <div>
            <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Minimum human reviewers: {config.mode_settings.min_reviewers ?? 3}
            </Label>
            <Slider
              value={[config.mode_settings.min_reviewers ?? 3]}
              min={1} max={9} step={1}
              disabled={readOnly}
              onValueChange={(v) =>
                setConfig({ ...config, mode_settings: { ...config.mode_settings, min_reviewers: v[0] } })
              }
            />
          </div>
        )}
        {config.judging_mode === "hybrid" && (
          <div>
            <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              AI weight: {config.mode_settings.ai_weight_pct ?? 40}%
            </Label>
            <Slider
              value={[config.mode_settings.ai_weight_pct ?? 40]}
              min={0} max={100} step={5}
              disabled={readOnly}
              onValueChange={(v) =>
                setConfig({ ...config, mode_settings: { ...config.mode_settings, ai_weight_pct: v[0] } })
              }
            />
          </div>
        )}
        {(config.judging_mode === "ai" || config.judging_mode === "hybrid") && (
          <>
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Model</Label>
              <Input
                value={config.model_id}
                readOnly={readOnly}
                onChange={(e) => setConfig({ ...config, model_id: e.target.value })}
              />
            </div>
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Temperature: {(config.mode_settings.temperature ?? 0.7).toFixed(2)}
              </Label>
              <Slider
                value={[(config.mode_settings.temperature ?? 0.7) * 100]}
                min={0} max={100} step={5}
                disabled={readOnly}
                onValueChange={(v) =>
                  setConfig({ ...config, mode_settings: { ...config.mode_settings, temperature: v[0] / 100 } })
                }
              />
            </div>
          </>
        )}
      </Card>

      {!readOnly && (
        <Button onClick={save} disabled={saving} className="bg-gold-gradient">
          <Save className="h-4 w-4 mr-2" /> {saving ? "Saving…" : "Save mode"}
        </Button>
      )}
    </div>
  );
}
