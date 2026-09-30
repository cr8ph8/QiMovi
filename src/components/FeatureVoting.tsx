import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Coins, Sparkles, Rocket, FlaskConical, CheckCircle, Pause, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { motion } from "framer-motion";

interface Feature {
  id: string;
  title: string;
  description: string | null;
  status: string;
  target_date: string | null;
  vote_count: number;
  token_total: number;
  user_tokens: number;
}

const STATUS_CONFIG: Record<string, { label: string; icon: typeof Sparkles; className: string }> = {
  planned: { label: "Planned", icon: Sparkles, className: "bg-muted text-muted-foreground" },
  "in-progress": { label: "In Progress", icon: Rocket, className: "bg-primary/10 text-primary" },
  testing: { label: "Testing", icon: FlaskConical, className: "bg-amber-500/10 text-amber-500" },
  released: { label: "Released", icon: CheckCircle, className: "bg-emerald-500/10 text-emerald-500" },
  paused: { label: "Paused", icon: Pause, className: "bg-muted text-muted-foreground" },
};

const FEATURE_VOTING_ON_HOLD = true;

export default function FeatureVoting() {
  const { user } = useAuth();
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState<string | null>(null);
  const [boostAmounts, setBoostAmounts] = useState<Record<string, string>>({});

  async function fetchFeatures() {
    const [{ data: roadmap }, { data: voteTotals }, { data: myVotes }] = await Promise.all([
      supabase.from("feature_roadmap").select("id, title, description, status, target_date").order("sort_order"),
      supabase.rpc("get_feature_vote_totals"),
      user ? supabase.from("feature_votes").select("feature_id, tokens_bid") : Promise.resolve({ data: [] }),
    ]);

    const totalsMap = new Map((voteTotals || []).map((v: any) => [v.feature_id, v]));
    const myTokensMap = new Map<string, number>();
    for (const v of myVotes || []) {
      myTokensMap.set(v.feature_id, (myTokensMap.get(v.feature_id) || 0) + (v.tokens_bid || 0));
    }

    const enriched: Feature[] = (roadmap || []).map((f) => {
      const totals = totalsMap.get(f.id);
      return {
        ...f,
        vote_count: totals ? Number(totals.vote_count) : 0,
        token_total: totals ? Number(totals.token_total) : 0,
        user_tokens: myTokensMap.get(f.id) || 0,
      };
    });

    setFeatures(enriched);
    setLoading(false);
  }

  useEffect(() => { fetchFeatures(); }, [user]);

  async function handleVote(featureId: string, amount: number) {
    if (FEATURE_VOTING_ON_HOLD) {
      toast({
        title: "Voting is temporarily paused",
        description: "We are upgrading vote and token protections. Your existing votes remain safe.",
      });
      return;
    }
    if (!user) {
      toast({ title: "Sign in required", description: "You need to be signed in to vote.", variant: "destructive" });
      return;
    }
    setVoting(featureId);
    const { error } = await supabase.rpc("spend_tokens", { p_amount: amount, p_feature_id: featureId });
    if (error) {
      toast({
        title: "Vote failed",
        description: error.message.includes("Insufficient") ? "Not enough tokens." : error.message,
        variant: "destructive",
      });
    } else {
      toast({ title: `Boosted with ${amount} token${amount > 1 ? "s" : ""}!` });
    }
    await fetchFeatures();
    setVoting(null);
  }

  const maxTokens = Math.max(1, ...features.map((f) => f.token_total));
  const nonReleased = features.filter((f) => f.status !== "released");
  const released = features.filter((f) => f.status === "released");
  const topFeatures = nonReleased.slice(0, 3);
  const remainingFeatures = nonReleased.slice(3);

  function renderFeatureCard(f: Feature, i: number) {
    const cfg = STATUS_CONFIG[f.status] || STATUS_CONFIG.planned;
    const StatusIcon = cfg.icon;
    return (
      <motion.div
        key={f.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: i * 0.04 }}
        className="p-4 rounded-xl border border-border/50 bg-card/80 hover:border-primary/20 transition-colors"
      >
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-body text-sm font-semibold truncate">{f.title}</h3>
              <Badge variant="outline" className={`shrink-0 text-[10px] font-mono ${cfg.className}`}>
                <StatusIcon className="h-3 w-3 mr-1" />
                {cfg.label}
              </Badge>
            </div>
            {f.description && (
              <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{f.description}</p>
            )}
            <div className="flex items-center gap-4">
              <Progress value={(f.token_total / maxTokens) * 100} className="flex-1 h-1.5" />
              <span className="text-xs font-mono text-muted-foreground shrink-0 flex items-center gap-1">
                <Coins className="h-3 w-3" /> {f.token_total}
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <div className="flex items-center gap-1">
              {[1, 5, 10].map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant={f.user_tokens > 0 ? "default" : "outline"}
                  className="h-7 px-2 text-xs font-mono"
                  disabled={FEATURE_VOTING_ON_HOLD || voting === f.id}
                  onClick={() => handleVote(f.id, n)}
                  title={FEATURE_VOTING_ON_HOLD ? "Temporarily paused" : `Boost with ${n} token${n > 1 ? "s" : ""}`}
                >
                  {n}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min={1}
                placeholder="#"
                className="h-7 w-14 text-xs font-mono px-1.5"
                value={boostAmounts[f.id] || ""}
                onChange={(e) => setBoostAmounts((p) => ({ ...p, [f.id]: e.target.value }))}
                disabled={FEATURE_VOTING_ON_HOLD || voting === f.id}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs gap-1"
                disabled={FEATURE_VOTING_ON_HOLD || voting === f.id || !boostAmounts[f.id]}
                onClick={() => {
                  const amt = parseInt(boostAmounts[f.id] || "0", 10);
                  if (amt <= 0) {
                    toast({ title: "Invalid amount", description: "Enter a positive number.", variant: "destructive" });
                    return;
                  }
                  handleVote(f.id, amt);
                  setBoostAmounts((p) => ({ ...p, [f.id]: "" }));
                }}
              >
                <Coins className="h-3 w-3" /> Boost
              </Button>
            </div>
            {f.user_tokens > 0 && (
              <span className="text-[10px] font-mono text-primary">You: {f.user_tokens} token{f.user_tokens !== 1 ? "s" : ""}</span>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="mt-12">
      <div className="flex items-center gap-3 mb-1">
        <Sparkles className="h-5 w-5 text-primary" />
        <h2 className="font-display text-lg font-semibold">Feature Roadmap</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        {FEATURE_VOTING_ON_HOLD
          ? "Voting is temporarily paused while we upgrade token protections. Existing votes are still shown."
          : "Vote with tokens to boost the features you want most. Higher-voted features get prioritized."}
      </p>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : features.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No features on the roadmap yet.</p>
      ) : (
        <>
          {/* Always-visible top 3 */}
          <div className="space-y-3">
            {topFeatures.map((f, i) => renderFeatureCard(f, i))}
          </div>

          {/* Collapsible remaining features + released */}
          {(remainingFeatures.length > 0 || released.length > 0) && (
            <Collapsible defaultOpen={false} className="mt-3">
              <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors group w-full">
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
                <span>Show {remainingFeatures.length + released.length} more feature{remainingFeatures.length + released.length !== 1 ? "s" : ""}</span>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3">
                {remainingFeatures.length > 0 && (
                  <div className="space-y-3">
                    {remainingFeatures.map((f, i) => renderFeatureCard(f, i + 3))}
                  </div>
                )}

                {released.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">Released</h3>
                    <div className="space-y-2">
                      {released.map((f) => (
                        <div key={f.id} className="flex items-center gap-3 p-3 rounded-lg border border-border/30 bg-card/30">
                          <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
                          <span className="text-sm font-body text-muted-foreground">{f.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          )}
        </>
      )}
    </div>
  );
}
