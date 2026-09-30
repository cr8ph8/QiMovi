import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Wand2, ArrowRight, Zap, MessageSquare, Users, Clock, Navigation, Heart, Coins, Trash2, X, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWallet } from "@/hooks/useWallet";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { TOKEN_COSTS } from "@/lib/wallet";
import { PAID_AI_SECURITY_HOLD, PAID_AI_SECURITY_MESSAGE } from "@/lib/securityMaintenance";

interface Suggestion {
  id?: string;
  element_text: string;
  type: "dialogue" | "action" | "character" | "pacing" | "transition" | "emotion";
  reason: string;
  suggested_action: "rewrite" | "expand" | "condense" | "punch_up";
  priority: "high" | "medium" | "low";
}

interface RewriteSuggestionsProps {
  entryId?: string;
  scriptText?: string;
  scores?: Record<string, number> | null;
  onRewriteComplete?: () => void;
  onTabChange?: (tab: string) => void;
  isPro?: boolean;
  /** Limit visible suggestions (show expand button for rest). Undefined = show all */
  maxVisible?: number;
}

const TYPE_ICONS: Record<string, typeof MessageSquare> = {
  dialogue: MessageSquare,
  action: Zap,
  character: Users,
  pacing: Clock,
  transition: Navigation,
  emotion: Heart,
};

const TYPE_COLORS: Record<string, string> = {
  dialogue: "bg-primary/15 text-primary",
  action: "bg-destructive/15 text-destructive",
  character: "bg-amber-500/15 text-amber-500",
  pacing: "bg-blue-500/15 text-blue-500",
  transition: "bg-muted text-muted-foreground",
  emotion: "bg-pink-500/15 text-pink-500",
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "border-destructive/40 text-destructive",
  medium: "border-primary/40 text-primary",
  low: "border-muted-foreground/40 text-muted-foreground",
};

const ACTION_LABELS: Record<string, string> = {
  rewrite: "Rewrite",
  expand: "Expand",
  condense: "Condense",
  punch_up: "Punch Up",
};

const SUGGEST_BASE_COST = TOKEN_COSTS.ai_suggest_rewrites;
/** Extra token per suggestion beyond the first */
const SUGGEST_EXTRA_PER = 1;

export default function RewriteSuggestions({
  entryId,
  scriptText,
  scores,
  onRewriteComplete,
  onTabChange,
  isPro = false,
  maxVisible,
}: RewriteSuggestionsProps) {
  const { user } = useAuth();
  const { balance, spend, spendCustom } = useWallet();

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [rewriting, setRewriting] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Load suggestions from DB on mount
  useEffect(() => {
    if (!entryId || !user?.id) {
      setInitialLoading(false);
      return;
    }
    (async () => {
      try {
        const { data } = await supabase
          .from("rewrite_suggestions")
          .select("*")
          .eq("entry_id", entryId)
          .eq("user_id", user.id)
          .order("created_at", { ascending: true });
        if (data && data.length > 0) {
          setSuggestions(data as Suggestion[]);
        }
      } catch {
        // silent
      } finally {
        setInitialLoading(false);
      }
    })();
  }, [entryId, user?.id]);

  const hasGenerated = suggestions.length > 0;

  const spendForSuggestions = useCallback(async (suggestionCount: number) => {
    const extraTokens = Math.max(0, suggestionCount - 1) * SUGGEST_EXTRA_PER;
    const totalCost = SUGGEST_BASE_COST + extraTokens;
    const ok = await spendCustom(totalCost, `Rewrite Suggestions (${suggestionCount})`);
    if (!ok) throw new Error("Token spend failed");
  }, [spendCustom]);

  const generateSuggestions = useCallback(async () => {
    if (PAID_AI_SECURITY_HOLD) {
      toast({ title: "AI tools paused", description: PAID_AI_SECURITY_MESSAGE });
      return;
    }
    if (!scriptText || scriptText.length < 50) {
      toast({ title: "Script too short", description: "Need more text to analyze.", variant: "destructive" });
      return;
    }
    if ((balance ?? 0) < SUGGEST_BASE_COST) {
      toast({ title: "Insufficient tokens", description: `You need at least ${SUGGEST_BASE_COST} tokens for suggestions.`, variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("suggest-rewrites", {
        body: {
          script_text: scriptText,
          entry_id: entryId,
          user_id: user?.id,
          scores: scores || null,
        },
      });
      if (error) throw error;
      if (data?.suggestions) {
        const count = data.suggestion_count ?? data.suggestions.length;
        await spendForSuggestions(count);
        setSuggestions(prev => [...prev, ...data.suggestions]);
      }
    } catch (err: any) {
      toast({ title: "AI Error", description: err?.message || "Failed to generate suggestions", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [scriptText, entryId, user?.id, scores, balance, spendForSuggestions]);

  const deleteOne = useCallback(async (suggestion: Suggestion, idx: number) => {
    if (!suggestion.id) {
      setSuggestions(prev => prev.filter((_, i) => i !== idx));
      return;
    }
    setDeletingId(suggestion.id);
    try {
      await supabase.from("rewrite_suggestions").delete().eq("id", suggestion.id);
      setSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }, []);

  const clearAll = useCallback(async () => {
    if (entryId && user?.id) {
      try {
        await supabase
          .from("rewrite_suggestions")
          .delete()
          .eq("entry_id", entryId)
          .eq("user_id", user.id);
      } catch {
        // silent
      }
    }
    setSuggestions([]);
  }, [entryId, user?.id]);

  const handleRewrite = useCallback(async (idx: number) => {
    if (PAID_AI_SECURITY_HOLD) {
      toast({ title: "AI tools paused", description: PAID_AI_SECURITY_MESSAGE });
      return;
    }
    const s = suggestions[idx];
    if (!s) return;
    setRewriting(idx);
    try {
      const { error } = await supabase.functions.invoke("rewrite-selection", {
        body: {
          selected_text: s.element_text,
          action: s.suggested_action,
          context: "",
          entry_id: entryId,
          user_id: user?.id,
        },
      });
      if (error) throw error;
      toast({ title: "Rewrite generated", description: "Check the Rewrites tab to review the result." });
      onRewriteComplete?.();
      setTimeout(() => onTabChange?.("rewrites"), 600);
    } catch (err: any) {
      toast({ title: "Rewrite failed", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setRewriting(null);
    }
  }, [suggestions, entryId, user?.id, onRewriteComplete, onTabChange]);

  if (initialLoading) {
    return (
      <div className="rounded-lg border border-border/30 bg-muted/10 p-4 flex items-center justify-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Loading suggestions…</span>
      </div>
    );
  }

  // Initial state — not yet generated
  if (!hasGenerated) {
    return (
      <div className="rounded-lg border border-border/30 bg-muted/10 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Rewrite Suggestions</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          AI will identify critical points in your screenplay that could benefit from rewriting — weak dialogue, flat action, pacing issues, and more.
        </p>
        {PAID_AI_SECURITY_HOLD && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-700 dark:text-amber-300">
            {PAID_AI_SECURITY_MESSAGE}
          </p>
        )}
        <Button
          size="sm"
          className="w-full font-mono text-xs gap-2"
          onClick={generateSuggestions}
          disabled={PAID_AI_SECURITY_HOLD || loading || !scriptText}
        >
          {loading ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing…</>
          ) : (
            <><Wand2 className="h-3.5 w-3.5" /> Generate Suggestions<Coins className="h-3 w-3 ml-1 text-muted-foreground" /><span className="text-muted-foreground">{SUGGEST_BASE_COST}+</span></>
          )}
        </Button>
      </div>
    );
  }

  // Suggestions list
  return (
    <div className="rounded-lg border border-border/30 bg-muted/10 space-y-0 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/20">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Rewrite Suggestions ({suggestions.length})
          </span>
        </div>
        <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive" onClick={clearAll} title="Clear all suggestions">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      <div className="divide-y divide-border/20">
        {(() => {
          const isLimited = maxVisible !== undefined && !expanded && suggestions.length > maxVisible;
          const visibleSuggestions = isLimited ? suggestions.slice(0, maxVisible) : suggestions;
          const hiddenCount = suggestions.length - (maxVisible || 0);

          return (
            <>
              {visibleSuggestions.map((s, i) => {
                const Icon = TYPE_ICONS[s.type] || Zap;
                const typeColor = TYPE_COLORS[s.type] || TYPE_COLORS.action;
                const priorityColor = PRIORITY_COLORS[s.priority] || PRIORITY_COLORS.medium;
                const isRewriting = rewriting === i;
                const isDeleting = deletingId === s.id;

                return (
                  <div key={s.id || i} className="px-3 py-2.5 space-y-1.5 hover:bg-muted/20 transition-colors relative group">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-1 right-1 h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                      onClick={() => deleteOne(s, i)}
                      disabled={isDeleting}
                      title="Remove this suggestion"
                    >
                      {isDeleting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <X className="h-3 w-3" />}
                    </Button>

                    <div className="flex items-start gap-2">
                      <div className={cn("p-1 rounded shrink-0 mt-0.5", typeColor)}>
                        <Icon className="h-3 w-3" />
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="outline" className={cn("text-[8px] font-mono", priorityColor)}>
                            {s.priority}
                          </Badge>
                          <span className="text-[9px] font-mono text-muted-foreground capitalize">{s.type}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-relaxed">{s.reason}</p>
                        <p className="text-[10px] font-mono text-secondary-foreground italic line-clamp-2 bg-card/50 rounded px-2 py-1">
                          "{s.element_text}"
                        </p>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[9px] font-mono gap-1"
                        disabled={PAID_AI_SECURITY_HOLD || isRewriting}
                        onClick={() => handleRewrite(i)}
                      >
                        {isRewriting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Wand2 className="h-2.5 w-2.5" />}
                        {ACTION_LABELS[s.suggested_action] || "Rewrite"}
                        <ArrowRight className="h-2.5 w-2.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}

              {/* Expand/collapse toggle */}
              {maxVisible !== undefined && suggestions.length > maxVisible && (
                <button
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                  onClick={() => setExpanded(!expanded)}
                >
                  <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
                  {expanded ? "Show less" : `Show ${hiddenCount} more suggestion${hiddenCount !== 1 ? "s" : ""}`}
                </button>
              )}
            </>
          );
        })()}
      </div>

      {/* Get More button */}
      <div className="px-3 py-2 border-t border-border/20">
        <Button
          variant="ghost"
          size="sm"
          className="w-full h-7 text-[10px] font-mono gap-1.5"
          onClick={generateSuggestions}
          disabled={PAID_AI_SECURITY_HOLD || loading}
        >
          {loading ? (
            <><Loader2 className="h-3 w-3 animate-spin" /> Generating…</>
          ) : (
            <>
              <Sparkles className="h-3 w-3" /> Get More Suggestions
              <Coins className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">{SUGGEST_BASE_COST}+</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
