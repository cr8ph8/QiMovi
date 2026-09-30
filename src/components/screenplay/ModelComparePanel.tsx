import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, Columns2, Info, Coins, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { computeWordDiff, type WordSegment } from "@/lib/diff";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWallet } from "@/hooks/useWallet";
import { TOKEN_COSTS } from "@/lib/wallet";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { PAID_AI_SECURITY_HOLD, PAID_AI_SECURITY_MESSAGE } from "@/lib/securityMaintenance";

const AVAILABLE_MODELS = [
  { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash" },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Lite" },
  { id: "openai/gpt-5", label: "GPT-5" },
  { id: "openai/gpt-5-mini", label: "GPT-5 Mini" },
  { id: "openai/gpt-5-nano", label: "GPT-5 Nano" },
  { id: "openai/gpt-5.2", label: "GPT-5.2" },
];

const DEFAULT_MODEL_ID = "google/gemini-3-flash-preview";

interface CompareResult {
  model: string;
  content: string | null;
  error?: string;
  prompt_tokens: number;
  completion_tokens: number;
  estimated_cost_cents: number;
}

const ACTIONS = [
  { id: "rewrite", label: "Rewrite" },
  { id: "expand", label: "Expand" },
  { id: "condense", label: "Condense" },
  { id: "punch_up", label: "Punch Up" },
  { id: "analyze", label: "Analyze" },
];

function WordDiffView({ segments }: { segments: WordSegment[] }) {
  return (
    <span className="text-xs font-mono leading-relaxed whitespace-pre-wrap">
      {segments.map((seg, i) => (
        <span
          key={i}
          className={cn(
            seg.type === "add" && "bg-emerald-500/20 text-emerald-300",
            seg.type === "remove" && "bg-destructive/20 text-destructive line-through",
          )}
        >
          {seg.text}
        </span>
      ))}
    </span>
  );
}

function getModelLabel(id: string) {
  return AVAILABLE_MODELS.find((m) => m.id === id)?.label || id.split("/").pop() || id;
}

interface ModelComparePanelProps {
  entryId?: string;
  scriptText?: string;
  /** Pre-filled text from highlight toolbar */
  initialText?: string;
}

export default function ModelComparePanel({ entryId, scriptText, initialText }: ModelComparePanelProps) {
  const { spend } = useWallet();
  const { canAccessFeature } = useSubscription();
  const isPro = canAccessFeature("pro");

  const [defaultModel, setDefaultModel] = useState(DEFAULT_MODEL_ID);
  const [selectedModels, setSelectedModels] = useState<string[]>([
    DEFAULT_MODEL_ID,
    "google/gemini-2.5-flash",
  ]);
  const [inputText, setInputText] = useState(initialText || scriptText?.slice(0, 2000) || "");
  const [action, setAction] = useState("rewrite");
  const [results, setResults] = useState<CompareResult[]>([]);
  const [loading, setLoading] = useState(false);

  

  // Sync initialText when it changes (e.g. from highlight toolbar)
  useEffect(() => {
    if (initialText) {
      setInputText(initialText);
    }
  }, [initialText]);

  // When default model changes, ensure it's in the selected list
  const handleDefaultModelChange = (modelId: string) => {
    setDefaultModel(modelId);
    if (!selectedModels.includes(modelId)) {
      setSelectedModels((prev) => {
        const next = [modelId, ...prev.filter((m) => m !== defaultModel)];
        return next.slice(0, 3);
      });
    }
  };

  const toggleModel = (id: string) => {
    setSelectedModels((prev) => {
      if (prev.includes(id)) return prev.filter((m) => m !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  };

  const tokenCost = selectedModels.length === 3
    ? TOKEN_COSTS.script_compare_3
    : TOKEN_COSTS.script_compare_2;

  const handleCompare = useCallback(async () => {
    if (PAID_AI_SECURITY_HOLD) return;
    if (!inputText.trim() || selectedModels.length < 2) return;

    // Spend tokens based on model count
    const tokenAction = selectedModels.length === 3 ? "script_compare_3" : "script_compare_2";
    const ok = await spend(tokenAction, entryId);
    if (!ok) return;

    setLoading(true);
    setResults([]);

    try {
      const { data, error } = await supabase.functions.invoke("ai-compare", {
        body: {
          selected_text: inputText.slice(0, 5000),
          action,
          models: selectedModels,
          entry_id: entryId || null,
        },
      });

      if (error) throw error;
      setResults(data.results || []);
    } catch (e) {
      console.error("Compare error:", e);
    } finally {
      setLoading(false);
    }
  }, [inputText, selectedModels, action, entryId, spend]);




  return (
    <div className="space-y-4 relative">
      {!isPro && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm rounded-lg">
          <Lock className="h-6 w-6 text-muted-foreground mb-2" />
          <p className="text-sm font-mono font-semibold text-foreground">Pro Feature</p>
          <p className="text-xs text-muted-foreground mt-1">Upgrade to Pro to compare models side-by-side</p>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Columns2 className="h-4 w-4 text-primary" />
        <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Compare Models</h4>
      </div>

      {PAID_AI_SECURITY_HOLD && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {PAID_AI_SECURITY_MESSAGE}
        </p>
      )}

      {/* Default model banner */}
      <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
        <Info className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">Platform default:</span>
        <Select value={defaultModel} onValueChange={handleDefaultModelChange}>
          <SelectTrigger className="h-6 w-auto min-w-[140px] text-[10px] font-mono border-primary/30 bg-transparent">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AVAILABLE_MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id} className="text-xs font-mono">
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Model selection */}
      <div className="space-y-2">
        <p className="text-[10px] font-mono text-muted-foreground">Select 2–3 models:</p>
        <div className="flex flex-wrap gap-2">
          {AVAILABLE_MODELS.map((m) => (
            <label
              key={m.id}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2 py-1 cursor-pointer transition-colors text-[10px] font-mono",
                selectedModels.includes(m.id)
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/50 bg-muted/20 text-muted-foreground hover:bg-muted/40",
                m.id === defaultModel && "ring-1 ring-primary/30",
              )}
            >
              <Checkbox
                checked={selectedModels.includes(m.id)}
                onCheckedChange={() => toggleModel(m.id)}
                className="h-3 w-3"
              />
              {m.label}
              {m.id === defaultModel && (
                <Badge variant="outline" className="text-[8px] h-3.5 px-1 font-mono ml-0.5">default</Badge>
              )}
            </label>
          ))}
        </div>
      </div>

      {/* Action + input */}
      <div className="flex gap-2 items-start">
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-28 h-8 text-xs shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTIONS.map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Paste screenplay text to compare…"
          className="min-h-[60px] text-xs font-mono resize-y"
          rows={3}
        />
      </div>

      <Button
        onClick={handleCompare}
        disabled={PAID_AI_SECURITY_HOLD || loading || selectedModels.length < 2 || !inputText.trim()}
        size="sm"
        className="w-full"
      >
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            Comparing {selectedModels.length} models…
          </>
        ) : (
          <span className="flex items-center gap-1.5">
            Compare {selectedModels.length} Models
            <span className="flex items-center gap-0.5 text-[10px] opacity-80">
              <Coins className="h-3 w-3" /> {tokenCost}t
            </span>
          </span>
        )}
      </Button>

      {/* Results */}
      {results.length > 0 && (
        <>
          {/* Original text reference */}
          <div className="rounded-lg border border-border/40 bg-muted/10 p-3 space-y-1">
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Original</p>
            <p className="text-xs font-mono text-foreground whitespace-pre-wrap leading-relaxed max-h-[120px] overflow-y-auto">
              {inputText}
            </p>
          </div>
          <div className={cn(
            "grid gap-3",
            results.length === 2 ? "grid-cols-2" : "grid-cols-3",
          )}>
            {results.map((r) => {
              const diffSegments = r.content
                ? computeWordDiff(inputText, r.content)
                : null;

              return (
                <div key={r.model} className="rounded-lg border border-border/40 bg-card/50 p-3 space-y-2 overflow-hidden">
                  <div className="space-y-1">
                    <p className="text-[11px] font-mono font-semibold text-foreground truncate">
                      {getModelLabel(r.model)}
                    </p>
                    <div className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground">
                      <span>{(r.estimated_cost_cents / 100).toFixed(4)}¢</span>
                      <span>·</span>
                      <span>{r.prompt_tokens + r.completion_tokens} tok</span>
                    </div>
                  </div>

                  {r.error ? (
                    <Badge variant="destructive" className="text-[9px]">{r.error}</Badge>
                  ) : r.content ? (
                    <div className="max-h-[300px] overflow-y-auto rounded bg-muted/20 p-2">
                      {diffSegments ? (
                        <WordDiffView segments={diffSegments} />
                      ) : (
                        <p className="text-xs font-mono text-foreground whitespace-pre-wrap leading-relaxed">
                          {r.content}
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
