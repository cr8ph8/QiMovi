import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Lock, Unlock, Save, AlertTriangle, Copy } from "lucide-react";
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

const DEFAULT_WEIGHTS = {
  concept: 15,
  story: 20,
  characters: 20,
  dialogue: 10,
  theme: 10,
  market: 15,
  cinematic: 10,
  climax: 10,
  technicalities: 10,
};

const DEFAULT_LABELS: Record<string, string> = {
  concept: "Concept",
  story: "Story",
  characters: "Characters",
  dialogue: "Dialogue",
  theme: "Theme/Message",
  market: "Market Potential",
  cinematic: "Cinematic Quality",
  climax: "Climax",
  technicalities: "Technicalities",
};

const RUBRIC_PRESETS: Array<{ id: string; label: string }> = [
  { id: "default", label: "Default (9-dim, 120 pts)" },
  { id: "vertical", label: "Vertical (mobile 9:16)" },
  { id: "micro", label: "Micro Short (1–5 pages)" },
  { id: "custom", label: "Custom" },
];

interface Competition {
  id: string;
  name: string;
  status: string;
}

export default function JudgeConfigPanel() {
  const { toast } = useToast();
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [selectedComp, setSelectedComp] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [modelProvider, setModelProvider] = useState<"lovable" | "custom">("lovable");
  const [modelId, setModelId] = useState("google/gemini-3-flash-preview");
  const [customApiKey, setCustomApiKey] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [weights, setWeights] = useState<Record<string, number>>({ ...DEFAULT_WEIGHTS });
  const [labels, setLabels] = useState<Record<string, string>>({ ...DEFAULT_LABELS });
  const [rubricPreset, setRubricPreset] = useState<string>("default");
  const [rubricVersion, setRubricVersion] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const [lockedAt, setLockedAt] = useState<string | null>(null);
  const [configExists, setConfigExists] = useState(false);

  useEffect(() => {
    supabase.from("competitions").select("id, name, status").order("created_at", { ascending: false }).then(({ data }) => {
      setCompetitions(data || []);
      if (data?.length) setSelectedComp(data[0].id);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!selectedComp) return;
    setLoading(true);
    supabase
      .from("competition_judge_config")
      .select("*")
      .eq("competition_id", selectedComp)
      .maybeSingle()
      .then(async ({ data }) => {
        if (data) {
          setConfigExists(true);
          setModelProvider(data.model_provider as "lovable" | "custom");
          setModelId(data.model_id);
          setCustomApiKey(data.custom_api_key_encrypted || "");
          setCustomBaseUrl(data.custom_api_base_url || "");
          setWeights((data.scoring_weights as Record<string, number>) || { ...DEFAULT_WEIGHTS });
          const preset = (data as any).rubric_preset || "default";
          setRubricPreset(preset);
          await applyPresetLabels(preset, (data.scoring_weights as Record<string, number>) || null);
          await loadRubricVersion(preset);
          setLocked(data.locked);
          setLockedAt(data.locked_at);
        } else {
          setConfigExists(false);
          setModelProvider("lovable");
          setModelId("google/gemini-3-flash-preview");
          setCustomApiKey("");
          setCustomBaseUrl("");
          setWeights({ ...DEFAULT_WEIGHTS });
          setLabels({ ...DEFAULT_LABELS });
          setRubricPreset("default");
          await loadRubricVersion("default");
          setLocked(false);
          setLockedAt(null);
        }
        setLoading(false);
      });
  }, [selectedComp]);

  async function applyPresetLabels(preset: string, existingWeights: Record<string, number> | null) {
    if (preset === "default" || preset === "custom") {
      setLabels({ ...DEFAULT_LABELS });
      return;
    }
    const { data } = await supabase
      .from("feature_configs")
      .select("usage_policy")
      .eq("id", `rubric_${preset}`)
      .maybeSingle();
    const policy = (data?.usage_policy as any) || {};
    if (policy.labels) setLabels(policy.labels);
    // Only overwrite weights if none already saved
    if (!existingWeights && policy.weights) setWeights(policy.weights);
  }

  async function loadRubricVersion(preset: string) {
    const { data } = await (supabase as any)
      .from("rubric_versions")
      .select("version")
      .eq("preset_id", preset)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    setRubricVersion((data as any)?.version ?? null);
  }

  async function handlePresetChange(preset: string) {
    setRubricPreset(preset);
    await loadRubricVersion(preset);
    if (preset === "default") {
      setWeights({ ...DEFAULT_WEIGHTS });
      setLabels({ ...DEFAULT_LABELS });
      return;
    }
    if (preset === "custom") {
      setLabels({ ...DEFAULT_LABELS });
      return;
    }
    const { data } = await supabase
      .from("feature_configs")
      .select("usage_policy")
      .eq("id", `rubric_${preset}`)
      .maybeSingle();
    const policy = (data?.usage_policy as any) || {};
    if (policy.weights) setWeights(policy.weights);
    if (policy.labels) setLabels(policy.labels);
  }


  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const expectedTotal = rubricPreset === "default" ? 120 : 100;
  const selectedCompObj = competitions.find((c) => c.id === selectedComp);
  const isLive = selectedCompObj && ["open", "judging", "complete"].includes(selectedCompObj.status);

  async function handleSave() {
    setSaving(true);
    const payload = {
      competition_id: selectedComp,
      model_provider: modelProvider,
      model_id: modelId,
      custom_api_key_encrypted: modelProvider === "custom" ? customApiKey : null,
      custom_api_base_url: modelProvider === "custom" ? customBaseUrl : null,
      scoring_weights: weights,
      rubric_preset: rubricPreset,
      rubric_version: rubricVersion,
      locked: !!isLive,
      locked_at: isLive ? new Date().toISOString() : null,
    };

    const { error } = configExists
      ? await supabase.from("competition_judge_config").update(payload).eq("competition_id", selectedComp)
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

  async function handleCloneFrom(sourceCompId: string) {
    if (!sourceCompId || sourceCompId === selectedComp) return;
    const { data } = await supabase
      .from("competition_judge_config")
      .select("*")
      .eq("competition_id", sourceCompId)
      .maybeSingle();
    if (!data) {
      toast({ title: "No config found", description: "The selected competition has no judge config to clone.", variant: "destructive" });
      return;
    }
    setModelProvider(data.model_provider as "lovable" | "custom");
    setModelId(data.model_id);
    setCustomApiKey(data.custom_api_key_encrypted || "");
    setCustomBaseUrl(data.custom_api_base_url || "");
    setWeights((data.scoring_weights as Record<string, number>) || { ...DEFAULT_WEIGHTS });
    toast({ title: "Config cloned", description: "Settings loaded — click Save to apply." });
  }

  if (loading && !competitions.length) {
    return <div className="space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-40 w-full" /></div>;
  }

  const disabled = locked || !!isLive;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold">AI Judge Configuration</h3>
        {disabled ? (
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-destructive/10 text-destructive text-xs font-mono">
            <Lock className="h-3 w-3" /> Locked — competition is live
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-mono">
            <Unlock className="h-3 w-3" /> Editable
          </div>
        )}
      </div>

      {/* Competition selector */}
      <div>
        <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Competition</Label>
        <Select value={selectedComp} onValueChange={setSelectedComp}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {competitions.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name} ({c.status})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Clone from another competition */}
      {!disabled && competitions.filter((c) => c.id !== selectedComp).length > 0 && (
        <div className="flex items-center gap-2">
          <Copy className="h-4 w-4 text-muted-foreground shrink-0" />
          <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider whitespace-nowrap">Clone from</Label>
          <Select onValueChange={handleCloneFrom}>
            <SelectTrigger className="flex-1"><SelectValue placeholder="Select a competition to clone config from…" /></SelectTrigger>
            <SelectContent>
              {competitions.filter((c) => c.id !== selectedComp).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name} ({c.status})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Model provider */}
      <div className="p-4 rounded-xl border border-border/50 bg-card/80 space-y-4">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">Use Custom API</Label>
          <Switch
            checked={modelProvider === "custom"}
            onCheckedChange={(v) => setModelProvider(v ? "custom" : "lovable")}
            disabled={disabled}
          />
        </div>

        {modelProvider === "lovable" ? (
          <div>
            <Label className="text-xs font-mono text-muted-foreground">Model</Label>
            <Select value={modelId} onValueChange={setModelId} disabled={disabled}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LOVABLE_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-mono text-muted-foreground">Model ID</Label>
              <Input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="gpt-4o" disabled={disabled} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs font-mono text-muted-foreground">API Base URL</Label>
              <Input value={customBaseUrl} onChange={(e) => setCustomBaseUrl(e.target.value)} placeholder="https://api.openai.com" disabled={disabled} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs font-mono text-muted-foreground">API Key</Label>
              <Input type="password" value={customApiKey} onChange={(e) => setCustomApiKey(e.target.value)} placeholder="sk-..." disabled={disabled} className="mt-1" />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="h-3 w-3" />
              <span>API key is stored in the database. Use a dedicated key with limited permissions.</span>
            </div>
          </div>
        )}
      </div>

      {/* Rubric preset */}
      <div className="p-4 rounded-xl border border-border/50 bg-card/80 space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">Rubric Preset</Label>
          {rubricVersion !== null && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-border/40 bg-muted/40 text-muted-foreground">
              {rubricPreset} v{rubricVersion}
            </span>
          )}
        </div>
        <Select value={rubricPreset} onValueChange={handlePresetChange} disabled={disabled}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {RUBRIC_PRESETS.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Vertical and Micro use category-specific dimensions. Default uses the 9-dim CanIScreenwrite grading sheet. Custom keeps current weights free-edit.
          Every edit to a rubric preset creates a new immutable version, and each judge report records the version it was scored against.
        </p>
      </div>


      {/* Scoring weights */}
      <div className="p-4 rounded-xl border border-border/50 bg-card/80 space-y-4">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">Scoring Weights</Label>
          <span className={`text-xs font-mono ${totalWeight === expectedTotal ? "text-primary" : "text-destructive"}`}>
            Total: {totalWeight}/{expectedTotal}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Object.entries(weights).map(([key, val]) => (
            <div key={key} className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground flex-1 min-w-0 truncate">{labels[key] || key}</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={val}
                onChange={(e) => setWeights((prev) => ({ ...prev, [key]: Number(e.target.value) || 0 }))}
                disabled={disabled || (rubricPreset !== "default" && rubricPreset !== "custom")}
                className="w-20 text-center"
              />
            </div>
          ))}
        </div>
      </div>

      {!disabled && (
        <Button onClick={handleSave} disabled={saving} className="w-full">
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Saving…" : configExists ? "Update Config" : "Save Config"}
        </Button>
      )}

      {lockedAt && (
        <p className="text-xs text-muted-foreground text-center">
          Locked at {new Date(lockedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
