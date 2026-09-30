import { useEffect, useState } from "react";
import CompetitionEconomicsPanel from "@/components/admin/CompetitionEconomicsPanel";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Lock, Unlock, Save, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const LOVABLE_MODELS = [
  { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash (default)" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
  { id: "openai/gpt-5", label: "GPT-5" },
  { id: "openai/gpt-5-mini", label: "GPT-5 Mini" },
  { id: "openai/gpt-5-nano", label: "GPT-5 Nano" },
  { id: "openai/gpt-5.2", label: "GPT-5.2" },
];

const DEFAULT_WEIGHTS: Record<string, number> = {
  narrative: 10,
  character_score: 10,
  emotional: 10,
  visual: 10,
  market: 10,
  franchise: 10,
  production: 10,
  audience: 10,
};

const WEIGHT_LABELS: Record<string, string> = {
  narrative: "Narrative Quality",
  character_score: "Character Development",
  emotional: "Emotional Impact",
  visual: "Visual Storytelling",
  market: "Market Viability",
  franchise: "Franchise Potential",
  production: "Production Feasibility",
  audience: "Audience Engagement",
};

interface Props {
  competitionId: string;
  competitionStatus: string;
}

export default function InlineJudgeConfig({ competitionId, competitionStatus }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modelProvider, setModelProvider] = useState<"lovable" | "custom">("lovable");
  const [modelId, setModelId] = useState("google/gemini-3-flash-preview");
  const [customApiKey, setCustomApiKey] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [weights, setWeights] = useState<Record<string, number>>({ ...DEFAULT_WEIGHTS });
  const [locked, setLocked] = useState(false);
  const [lockedAt, setLockedAt] = useState<string | null>(null);
  const [configExists, setConfigExists] = useState(false);

  const isLive = ["open", "judging", "complete"].includes(competitionStatus);
  const disabled = locked || isLive;

  useEffect(() => {
    setLoading(true);
    supabase
      .from("competition_judge_config")
      .select("*")
      .eq("competition_id", competitionId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setConfigExists(true);
          setModelProvider(data.model_provider as "lovable" | "custom");
          setModelId(data.model_id);
          setCustomApiKey(data.custom_api_key_encrypted || "");
          setCustomBaseUrl(data.custom_api_base_url || "");
          setWeights((data.scoring_weights as Record<string, number>) || { ...DEFAULT_WEIGHTS });
          setLocked(data.locked);
          setLockedAt(data.locked_at);
        } else {
          setConfigExists(false);
          setModelProvider("lovable");
          setModelId("google/gemini-3-flash-preview");
          setCustomApiKey("");
          setCustomBaseUrl("");
          setWeights({ ...DEFAULT_WEIGHTS });
          setLocked(false);
          setLockedAt(null);
        }
        setLoading(false);
      });
  }, [competitionId]);

  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

  async function handleSave() {
    setSaving(true);
    const payload = {
      competition_id: competitionId,
      model_provider: modelProvider,
      model_id: modelId,
      custom_api_key_encrypted: modelProvider === "custom" ? customApiKey : null,
      custom_api_base_url: modelProvider === "custom" ? customBaseUrl : null,
      scoring_weights: weights,
      locked: !!isLive,
      locked_at: isLive ? new Date().toISOString() : null,
    };

    const { error } = configExists
      ? await supabase.from("competition_judge_config").update(payload).eq("competition_id", competitionId)
      : await supabase.from("competition_judge_config").insert(payload);

    setSaving(false);
    if (error) {
      toast({ title: "Error saving config", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Judge config saved" });
      setConfigExists(true);
      if (isLive) { setLocked(true); setLockedAt(new Date().toISOString()); }
    }
  }

  if (loading) {
    return <div className="p-4 space-y-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-20 w-full" /></div>;
  }

  return (
    <div className="p-4 space-y-5 border-t border-border/30 bg-muted/5">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold font-display">AI Judge Configuration</h4>
        {disabled ? (
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-[10px] font-mono">
            <Lock className="h-3 w-3" /> Locked
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-mono">
            <Unlock className="h-3 w-3" /> Editable
          </div>
        )}
      </div>

      {/* Model provider */}
      <div className="p-3 rounded-lg border border-border/40 bg-card/60 space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold">Custom API</Label>
          <Switch
            checked={modelProvider === "custom"}
            onCheckedChange={(v) => setModelProvider(v ? "custom" : "lovable")}
            disabled={disabled}
          />
        </div>

        {modelProvider === "lovable" ? (
          <div>
            <Label className="text-[10px] font-mono text-muted-foreground">Model</Label>
            <Select value={modelId} onValueChange={setModelId} disabled={disabled}>
              <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LOVABLE_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="space-y-2">
            <div>
              <Label className="text-[10px] font-mono text-muted-foreground">Model ID</Label>
              <Input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="gpt-4o" disabled={disabled} className="mt-1 h-8 text-xs" />
            </div>
            <div>
              <Label className="text-[10px] font-mono text-muted-foreground">API Base URL</Label>
              <Input value={customBaseUrl} onChange={(e) => setCustomBaseUrl(e.target.value)} placeholder="https://api.openai.com" disabled={disabled} className="mt-1 h-8 text-xs" />
            </div>
            <div>
              <Label className="text-[10px] font-mono text-muted-foreground">API Key</Label>
              <Input type="password" value={customApiKey} onChange={(e) => setCustomApiKey(e.target.value)} placeholder="sk-..." disabled={disabled} className="mt-1 h-8 text-xs" />
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <AlertTriangle className="h-3 w-3" />
              <span>Use a dedicated key with limited permissions.</span>
            </div>
          </div>
        )}
      </div>

      {/* Scoring weights */}
      <div className="p-3 rounded-lg border border-border/40 bg-card/60 space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold">Scoring Weights</Label>
          <span className={`text-[10px] font-mono ${totalWeight === 100 ? "text-primary" : "text-destructive"}`}>
            {totalWeight}/100
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(weights).map(([key, val]) => (
            <div key={key} className="flex items-center gap-2">
              <Label className="text-[10px] text-muted-foreground flex-1 min-w-0 truncate">{WEIGHT_LABELS[key] || key}</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={val}
                onChange={(e) => setWeights((prev) => ({ ...prev, [key]: Number(e.target.value) || 0 }))}
                disabled={disabled}
                className="w-16 h-7 text-center text-xs"
              />
            </div>
          ))}
        </div>
      </div>

      {!disabled && (
        <Button onClick={handleSave} disabled={saving} size="sm" className="w-full text-xs">
          <Save className="h-3 w-3 mr-1" />
          {saving ? "Saving…" : configExists ? "Update Config" : "Save Config"}
        </Button>
      )}

      {lockedAt && (
        <p className="text-[10px] text-muted-foreground text-center">
          Locked at {new Date(lockedAt).toLocaleString()}
        </p>
      )}

      {/* Competition Economics Panel */}
      <CompetitionEconomicsPanel competitionId={competitionId} competitionStatus={competitionStatus} />
    </div>
  );
}
