import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Coins, TrendingUp, ArrowUpRight, Clock, Wallet, Crown, Building2, Sparkles, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWallet } from "@/hooks/useWallet";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useAuth } from "@/hooks/useAuth";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { supabase } from "@/integrations/supabase/client";
import { TOKEN_BUNDLES, TOKEN_ACTION_LABELS, type TokenAction } from "@/lib/wallet";
import { getPlanConfig, PlanTier } from "@/lib/plans";
import { useToast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";
import { WalletSubscriptions } from "@/components/wallet/WalletSubscriptions";
import { WalletDataDeletion } from "@/components/wallet/WalletDataDeletion";

const tierMeta: Record<PlanTier, { icon: typeof Sparkles; color: string; label: string }> = {
  free: { icon: Sparkles, color: "text-muted-foreground", label: "Free" },
  pro: { icon: Crown, color: "text-primary", label: "Pro" },
  studio: { icon: Building2, color: "text-primary", label: "Studio" },
};

interface FloatingWalletProps {
  open: boolean;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement>;
}

interface UsageStats {
  today: number;
  week: number;
  month: number;
}

export function FloatingWallet({ open, onClose }: FloatingWalletProps) {
  const { user } = useAuth();
  const { balance } = useWallet();
  const { plan, discountPercent } = useSubscription();
  const { toast } = useToast();
  const { publicPaymentsOpen } = useSiteSettings();
  const panelRef = useRef<HTMLDivElement>(null);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<{ amount: number; label: string; created_at: string }[]>([]);
  const [usage, setUsage] = useState<UsageStats>({ today: 0, week: 0, month: 0 });
  const [breakdown, setBreakdown] = useState<{ action: string; total: number }[]>([]);

  const isProPlus = plan !== "free";
  const config = getPlanConfig(plan);
  const tier = tierMeta[plan];
  const TierIcon = tier.icon;
  const bundles = isProPlus ? TOKEN_BUNDLES : TOKEN_BUNDLES.slice(0, 2);
  const txLimit = isProPlus ? 5 : 3;

  // Click outside
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  // Fetch transactions + usage stats
  useEffect(() => {
    if (!open || !user) return;

    (async () => {
      const { data: txData } = await supabase
        .from("wallet_transactions")
        .select("amount, label, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(txLimit);
      setTransactions(txData || []);

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const weekStart = new Date(now.getTime() - 7 * 86400000).toISOString();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const [todayRes, weekRes, monthRes] = await Promise.all([
        supabase.from("feature_usage_log").select("tokens_spent").eq("user_id", user.id).gte("created_at", todayStart),
        supabase.from("feature_usage_log").select("tokens_spent").eq("user_id", user.id).gte("created_at", weekStart),
        supabase.from("feature_usage_log").select("action, tokens_spent").eq("user_id", user.id).gte("created_at", monthStart),
      ]);

      const sum = (rows: { tokens_spent: number }[] | null) => (rows || []).reduce((s, r) => s + r.tokens_spent, 0);
      setUsage({
        today: sum(todayRes.data),
        week: sum(weekRes.data),
        month: sum(monthRes.data as { tokens_spent: number }[] | null),
      });

      // Aggregate month data by action for breakdown
      const monthRows = (monthRes.data || []) as { action: string; tokens_spent: number }[];
      const grouped: Record<string, number> = {};
      for (const row of monthRows) {
        grouped[row.action] = (grouped[row.action] || 0) + row.tokens_spent;
      }
      const sorted = Object.entries(grouped)
        .map(([action, total]) => ({ action, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);
      setBreakdown(sorted);
    })();
  }, [open, user, txLimit]);

  async function handlePurchase(bundle: (typeof TOKEN_BUNDLES)[number]) {
    if (!user || !publicPaymentsOpen) return;
    setPurchasing(bundle.id);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { bundle_id: bundle.id },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      if (data?.url) window.open(data.url, "_blank");
    } catch (error) {
      toast({
        title: "Checkout failed",
        description: error instanceof Error ? error.message : "Unable to start checkout.",
        variant: "destructive",
      });
    } finally {
      setPurchasing(null);
    }
  }

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, y: -8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.96 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="absolute right-0 top-full mt-2 z-50 w-[340px] md:w-[380px] rounded-2xl border border-border/60 bg-card shadow-2xl shadow-background/80 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border/30">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" />
              <span className="font-display text-sm font-bold">Wallet</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={`text-[10px] px-2 py-0 h-5 font-mono ${tier.color} border-current/20`}>
                <TierIcon className="h-3 w-3 mr-1" />
                {tier.label}
              </Badge>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Balance */}
          <div className="px-5 py-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-1">Balance</p>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold text-foreground">
                {balance?.toLocaleString() ?? "—"}
              </span>
              <Coins className="h-5 w-5 text-primary" />
            </div>

            {/* Pro+ discount */}
            {isProPlus && (
              <div className="mt-3">
                <div className="rounded-lg border border-border/30 bg-muted/20 px-3 py-2">
                  <p className="text-[10px] text-muted-foreground font-mono">Discount</p>
                  <p className="font-mono text-sm font-semibold text-primary">{discountPercent}% off</p>
                </div>
              </div>
            )}
          </div>

          {/* Usage stats */}
          <div className="px-5 pb-3">
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingUp className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Tokens spent</span>
            </div>
            <div className={`grid ${isProPlus ? "grid-cols-3" : "grid-cols-1"} gap-2`}>
              {isProPlus ? (
                <>
                  <div className="text-center rounded-lg bg-muted/15 px-2 py-1.5">
                    <p className="text-[10px] text-muted-foreground font-mono">Today</p>
                    <p className="font-mono text-sm font-semibold">{usage.today}</p>
                  </div>
                  <div className="text-center rounded-lg bg-muted/15 px-2 py-1.5">
                    <p className="text-[10px] text-muted-foreground font-mono">Week</p>
                    <p className="font-mono text-sm font-semibold">{usage.week}</p>
                  </div>
                  <div className="text-center rounded-lg bg-muted/15 px-2 py-1.5">
                    <p className="text-[10px] text-muted-foreground font-mono">Month</p>
                    <p className="font-mono text-sm font-semibold">{usage.month}</p>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between rounded-lg bg-muted/15 px-3 py-1.5">
                  <span className="text-[10px] text-muted-foreground font-mono">This month</span>
                  <span className="font-mono text-sm font-semibold">{usage.month} ⊘</span>
                </div>
              )}
            </div>
          </div>

          {/* Spending Breakdown */}
          {breakdown.length > 0 && (
            <div className="px-5 pb-3">
              <div className="flex items-center gap-1.5 mb-2">
                <BarChart3 className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Top spenders (month)</span>
              </div>
              <div className="space-y-1.5">
                {breakdown.map((item, i) => {
                  const maxTotal = breakdown[0].total;
                  const pct = maxTotal > 0 ? (item.total / maxTotal) * 100 : 0;
                  const label = TOKEN_ACTION_LABELS[item.action as TokenAction] || item.action.replace(/_/g, " ");
                  return (
                    <div key={item.action} className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground font-mono truncate w-[100px] shrink-0">{label}</span>
                      <div className="flex-1 h-3 rounded-full bg-muted/20 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${pct}%`, opacity: 1 - i * 0.15 }}
                        />
                      </div>
                      <span className="text-[10px] font-mono font-semibold text-foreground w-8 text-right">{item.total}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Top Up */}
          <div className="px-5 pb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-2">Top up</p>
            {!publicPaymentsOpen ? (
              <div className="rounded-lg border border-muted bg-muted/10 p-3 text-center">
                <p className="text-xs text-muted-foreground font-body">Purchases temporarily disabled</p>
              </div>
            ) : (
              <div className={`grid ${isProPlus ? "grid-cols-4" : "grid-cols-2"} gap-2`}>
                {bundles.map((bundle) => (
                  <button
                    key={bundle.name}
                    onClick={() => handlePurchase(bundle)}
                    disabled={!!purchasing}
                    className="relative rounded-xl border border-border/40 bg-muted/10 p-2.5 text-center transition-all hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
                  >
                    <p className="font-display text-base font-bold">{bundle.tokens}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{bundle.label}</p>
                    {purchasing === bundle.id && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-card/90">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Recent Transactions */}
          <div className="px-5 pb-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Recent</span>
            </div>
            {transactions.length === 0 ? (
              <p className="text-xs text-muted-foreground/60 font-body py-2">No transactions yet</p>
            ) : (
              <div className="space-y-1">
                {transactions.map((tx, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 text-xs">
                    <span className="font-body text-muted-foreground truncate max-w-[180px]">{tx.label}</span>
                    <div className="flex items-center gap-2">
                      <span className={`font-mono font-semibold ${tx.amount >= 0 ? "text-primary" : "text-destructive"}`}>
                        {tx.amount >= 0 ? "+" : ""}{tx.amount}
                      </span>
                      <span className="text-[10px] text-muted-foreground/50 font-mono w-12 text-right">{timeAgo(tx.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Active Feature Subscriptions */}
          {user && <WalletSubscriptions userId={user.id} open={open} />}

          {/* Footer CTA */}
          <div className="px-5 py-3 border-t border-border/30 bg-muted/10">
            {!isProPlus ? (
              <Link to="/pricing" onClick={onClose}>
                <Button size="sm" className="w-full bg-gold-gradient font-body font-semibold text-primary-foreground text-xs gap-1.5">
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  Upgrade for Pro tools & discounts
                </Button>
              </Link>
            ) : (
              <Link to="/pricing" onClick={onClose}>
                <Button size="sm" variant="ghost" className="w-full text-xs text-muted-foreground font-body gap-1">
                  Manage plan
                  <ArrowUpRight className="h-3 w-3" />
                </Button>
              </Link>
            )}
          </div>

          {/* Data Deletion */}
          {user && <WalletDataDeletion userId={user.id} />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
