import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";

interface FeatureSub {
  id: string;
  user_id: string;
  feature_id: string;
  cycle: string;
  tokens_paid: number;
  cycle_start: string;
  cycle_end: string;
  auto_renew: boolean;
  cancelled_at: string | null;
  refund_amount: number;
}

export default function FeatureSubscriptionAdminPanel() {
  const [subs, setSubs] = useState<FeatureSub[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const fetchSubs = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("feature_subscriptions")
      .select("*")
      .order("created_at", { ascending: false });
    setSubs((data as any[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchSubs();
  }, []);

  const activeSubs = subs.filter((s) => !s.cancelled_at && new Date(s.cycle_end) > new Date());
  const cancelledSubs = subs.filter((s) => s.cancelled_at);
  const totalRevenue = subs.reduce((sum, s) => sum + s.tokens_paid, 0);
  const totalRefunds = subs.reduce((sum, s) => sum + (s.refund_amount || 0), 0);

  const byFeature: Record<string, number> = {};
  activeSubs.forEach((s) => { byFeature[s.feature_id] = (byFeature[s.feature_id] || 0) + 1; });

  const byCycle: Record<string, number> = {};
  activeSubs.forEach((s) => { byCycle[s.cycle] = (byCycle[s.cycle] || 0) + 1; });

  const handleAdminCancel = async (sub: FeatureSub) => {
    setCancelling(sub.id);
    const { data, error } = await supabase.functions.invoke("manage-feature-subscription", {
      body: { action: "cancel", feature_id: sub.feature_id, target_user_id: sub.user_id },
    });
    setCancelling(null);
    if (error || data?.error) {
      toast.error(data?.error || error?.message || "Failed to cancel");
    } else {
      toast.success(`Cancelled & refunded ${data.refund_amount} ⊘`);
      fetchSubs();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold">Feature Subscriptions</h3>
        <Button variant="ghost" size="sm" onClick={fetchSubs}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Active", value: String(activeSubs.length) },
          { label: "Cancelled", value: String(cancelledSubs.length) },
          { label: "Revenue (⊘)", value: String(totalRevenue) },
          { label: "Refunds (⊘)", value: String(totalRefunds) },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border/50 bg-card/80 p-4">
            <p className="text-xs font-mono text-muted-foreground uppercase">{s.label}</p>
            <p className="font-display text-2xl font-bold mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* By Feature + Cycle breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border/50 bg-card/80 p-4">
          <p className="text-xs font-mono text-muted-foreground uppercase mb-2">By Feature</p>
          {Object.entries(byFeature).length === 0 ? (
            <p className="text-sm text-muted-foreground">No active subscriptions</p>
          ) : (
            Object.entries(byFeature).sort((a, b) => b[1] - a[1]).map(([f, c]) => (
              <div key={f} className="flex justify-between text-sm py-1">
                <span className="font-body">{f}</span>
                <span className="font-mono text-primary">{c}</span>
              </div>
            ))
          )}
        </div>
        <div className="rounded-xl border border-border/50 bg-card/80 p-4">
          <p className="text-xs font-mono text-muted-foreground uppercase mb-2">By Cycle</p>
          {Object.entries(byCycle).length === 0 ? (
            <p className="text-sm text-muted-foreground">No active subscriptions</p>
          ) : (
            Object.entries(byCycle).map(([c, n]) => (
              <div key={c} className="flex justify-between text-sm py-1">
                <span className="font-body capitalize">{c}</span>
                <span className="font-mono text-primary">{n}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Active subs table */}
      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (
        <div className="rounded-xl border border-border/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/20">
                <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Feature</th>
                <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">User</th>
                <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Cycle</th>
                <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Paid</th>
                <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Ends</th>
                <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Status</th>
                <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody>
              {subs.map((sub) => {
                const isActive = !sub.cancelled_at && new Date(sub.cycle_end) > new Date();
                const isExpired = !sub.cancelled_at && new Date(sub.cycle_end) <= new Date();
                return (
                  <tr key={sub.id} className="border-b border-border/20 hover:bg-muted/10">
                    <td className="py-3 px-4 font-body">{sub.feature_id}</td>
                    <td className="py-3 px-4 font-mono text-xs text-muted-foreground">{sub.user_id.slice(0, 8)}…</td>
                    <td className="py-3 px-4 capitalize">{sub.cycle}</td>
                    <td className="py-3 px-4 font-mono">{sub.tokens_paid} ⊘</td>
                    <td className="py-3 px-4 font-mono text-xs">{new Date(sub.cycle_end).toLocaleDateString()}</td>
                    <td className="py-3 px-4">
                      {sub.cancelled_at ? (
                        <Badge variant="outline" className="text-xs">Cancelled (refund: {sub.refund_amount}⊘)</Badge>
                      ) : isExpired ? (
                        <Badge variant="outline" className="text-xs text-amber-500">Expired</Badge>
                      ) : (
                        <Badge className="text-xs bg-primary/10 text-primary border-primary/20">Active</Badge>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleAdminCancel(sub)}
                          disabled={cancelling === sub.id}
                        >
                          <XCircle className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {subs.length === 0 && (
                <tr><td colSpan={7} className="py-8 text-center text-muted-foreground text-sm">No feature subscriptions yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
