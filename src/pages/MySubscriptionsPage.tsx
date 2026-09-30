import { useEffect, useState, useCallback } from "react";
import { Link, Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { TOKEN_ACTION_LABELS, type TokenAction } from "@/lib/wallet";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Repeat, XCircle, Loader2, ArrowLeft, Calendar,
  Clock, Coins, BarChart3, RefreshCw, ToggleLeft, ToggleRight,
} from "lucide-react";

interface ActiveSub {
  id: string;
  feature_id: string;
  cycle: string;
  tokens_paid: number;
  cycle_start: string;
  cycle_end: string;
  auto_renew: boolean;
  cancelled_at: string | null;
  refund_amount: number | null;
  created_at: string;
}

interface UsageRow {
  id: string;
  action: string;
  tokens_spent: number;
  created_at: string;
  applied: boolean;
}

function getLabel(action: string) {
  return (TOKEN_ACTION_LABELS as Record<string, string>)[action] || action.replace(/_/g, " ");
}

function daysLeft(dateStr: string) {
  return Math.max(0, Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000));
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function MySubscriptionsPage() {
  const { user, loading: authLoading } = useAuth();
  const { plan } = useSubscription();
  const { toast } = useToast();

  const [subs, setSubs] = useState<ActiveSub[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [togglingRenew, setTogglingRenew] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const [{ data: subData }, { data: usageData }] = await Promise.all([
      supabase
        .from("feature_subscriptions")
        .select("id, feature_id, cycle, tokens_paid, cycle_start, cycle_end, auto_renew, cancelled_at, refund_amount, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("feature_usage_log")
        .select("id, action, tokens_spent, created_at, applied")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    setSubs((subData as ActiveSub[]) || []);
    setUsage((usageData as UsageRow[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (authLoading) return null;
  if (!user) return <Navigate to="/auth" replace />;

  const activeSubs = subs.filter((s) => !s.cancelled_at && new Date(s.cycle_end) > new Date());
  const pastSubs = subs.filter((s) => s.cancelled_at || new Date(s.cycle_end) <= new Date());
  const totalSpent = subs.reduce((sum, s) => sum + s.tokens_paid, 0);
  const totalRefunds = subs.reduce((sum, s) => sum + (s.refund_amount || 0), 0);

  async function handleCancel(sub: ActiveSub) {
    setCancelling(sub.id);
    try {
      const { data, error } = await supabase.functions.invoke("manage-feature-subscription", {
        body: { action: "cancel", feature_id: sub.feature_id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: "Subscription cancelled",
        description: `Refunded ${data.refund_amount ?? 0} ⊘ (prorated).`,
      });
      fetchData();
    } catch (err: any) {
      toast({ title: "Cancel failed", description: err.message, variant: "destructive" });
    } finally {
      setCancelling(null);
    }
  }

  async function toggleAutoRenew(sub: ActiveSub) {
    setTogglingRenew(sub.id);
    const newVal = !sub.auto_renew;
    const { error } = await supabase
      .from("feature_subscriptions")
      .update({ auto_renew: newVal })
      .eq("id", sub.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: newVal ? "Auto-renew enabled" : "Auto-renew disabled" });
      setSubs((prev) => prev.map((s) => (s.id === sub.id ? { ...s, auto_renew: newVal } : s)));
    }
    setTogglingRenew(null);
  }

  return (
    <div className="min-h-screen pt-24 pb-16">
      <div className="container max-w-4xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link to={`/writer/${user.id}`}>
            <Button variant="ghost" size="sm" className="gap-1">
              <ArrowLeft className="h-4 w-4" /> Profile
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight text-foreground">
              My Subscriptions
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage your active feature subscriptions, usage history, and renewal settings.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchData} className="gap-1">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {[
            { label: "Active Subs", value: activeSubs.length, icon: Repeat, color: "text-primary" },
            { label: "Tokens Spent", value: `${totalSpent} ⊘`, icon: Coins, color: "text-primary" },
            { label: "Refunds", value: `${totalRefunds} ⊘`, icon: Coins, color: "text-destructive" },
            { label: "Current Plan", value: plan.charAt(0).toUpperCase() + plan.slice(1), icon: BarChart3, color: "text-primary" },
          ].map((card, i) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="rounded-xl border border-border/50 bg-card/80 p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <card.icon className={`h-4 w-4 ${card.color}`} />
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{card.label}</span>
              </div>
              {loading ? <Skeleton className="h-7 w-16" /> : (
                <p className="font-display text-xl font-bold">{card.value}</p>
              )}
            </motion.div>
          ))}
        </div>

        {/* Active Subscriptions */}
        <section className="mb-10">
          <h2 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
            <Repeat className="h-4.5 w-4.5 text-primary" /> Active Subscriptions
          </h2>

          {loading ? (
            <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}</div>
          ) : activeSubs.length === 0 ? (
            <div className="rounded-xl border border-border/50 bg-card/80 p-8 text-center">
              <p className="text-sm text-muted-foreground">No active feature subscriptions.</p>
              <Link to="/pricing" className="text-xs text-primary hover:underline mt-2 inline-block">
                Explore available features →
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {activeSubs.map((sub) => {
                const remaining = daysLeft(sub.cycle_end);
                return (
                  <motion.div
                    key={sub.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-xl border border-border/50 bg-card/80 p-5"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-body text-sm font-semibold text-foreground">
                          {getLabel(sub.feature_id)}
                        </h3>
                        <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            <span className="capitalize">{sub.cycle}</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <Coins className="h-3 w-3" />
                            {sub.tokens_paid} ⊘ paid
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {remaining}d remaining
                          </span>
                          <span className="font-mono text-[10px]">
                            Ends {formatDate(sub.cycle_end)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {/* Auto-renew toggle */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleAutoRenew(sub)}
                          disabled={togglingRenew === sub.id}
                          className="gap-1.5 text-xs"
                        >
                          {togglingRenew === sub.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : sub.auto_renew ? (
                            <ToggleRight className="h-4 w-4 text-primary" />
                          ) : (
                            <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                          )}
                          {sub.auto_renew ? "Auto-renew on" : "Auto-renew off"}
                        </Button>

                        {/* Cancel */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCancel(sub)}
                          disabled={cancelling === sub.id}
                          className="text-destructive border-destructive/30 hover:bg-destructive/10 gap-1 text-xs"
                        >
                          {cancelling === sub.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5" />
                          )}
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </section>

        {/* Past / Cancelled Subscriptions */}
        {pastSubs.length > 0 && (
          <section className="mb-10">
            <h2 className="font-display text-lg font-semibold mb-4 text-muted-foreground">
              Past Subscriptions
            </h2>
            <div className="rounded-xl border border-border/50 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/20">
                    <th className="text-left py-3 px-4 font-mono text-[10px] text-muted-foreground uppercase">Feature</th>
                    <th className="text-left py-3 px-4 font-mono text-[10px] text-muted-foreground uppercase">Cycle</th>
                    <th className="text-right py-3 px-4 font-mono text-[10px] text-muted-foreground uppercase">Paid</th>
                    <th className="text-right py-3 px-4 font-mono text-[10px] text-muted-foreground uppercase">Refund</th>
                    <th className="text-left py-3 px-4 font-mono text-[10px] text-muted-foreground uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pastSubs.map((sub) => (
                    <tr key={sub.id} className="border-b border-border/20">
                      <td className="py-3 px-4 font-body">{getLabel(sub.feature_id)}</td>
                      <td className="py-3 px-4 capitalize text-muted-foreground">{sub.cycle}</td>
                      <td className="py-3 px-4 font-mono text-right">{sub.tokens_paid} ⊘</td>
                      <td className="py-3 px-4 font-mono text-right text-destructive">{sub.refund_amount || 0} ⊘</td>
                      <td className="py-3 px-4">
                        {sub.cancelled_at ? (
                          <Badge variant="outline" className="text-[10px]">Cancelled</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/30">Expired</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Usage History */}
        <section>
          <h2 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
            <BarChart3 className="h-4.5 w-4.5 text-primary" /> Recent Usage History
          </h2>

          {loading ? (
            <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : usage.length === 0 ? (
            <div className="rounded-xl border border-border/50 bg-card/80 p-8 text-center">
              <p className="text-sm text-muted-foreground">No usage history yet.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border/50 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/20">
                    <th className="text-left py-3 px-4 font-mono text-[10px] text-muted-foreground uppercase">Action</th>
                    <th className="text-right py-3 px-4 font-mono text-[10px] text-muted-foreground uppercase">Tokens</th>
                    <th className="text-left py-3 px-4 font-mono text-[10px] text-muted-foreground uppercase">Applied</th>
                    <th className="text-left py-3 px-4 font-mono text-[10px] text-muted-foreground uppercase">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((row) => (
                    <tr key={row.id} className="border-b border-border/20">
                      <td className="py-2.5 px-4 font-body text-xs">{getLabel(row.action)}</td>
                      <td className="py-2.5 px-4 font-mono text-xs text-right text-primary">{row.tokens_spent} ⊘</td>
                      <td className="py-2.5 px-4">
                        {row.applied ? (
                          <Badge className="text-[10px] bg-primary/10 text-primary border-primary/20">Applied</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Unused</Badge>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-muted-foreground">{formatDate(row.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
