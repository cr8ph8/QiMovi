import { useState, useEffect } from "react";
import { Repeat, XCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { TOKEN_ACTION_LABELS, type TokenAction } from "@/lib/wallet";
import { useToast } from "@/hooks/use-toast";

interface ActiveSub {
  id: string;
  feature_id: string;
  cycle: string;
  cycle_end: string;
  tokens_paid: number;
}

interface WalletSubscriptionsProps {
  userId: string;
  open: boolean;
}

export function WalletSubscriptions({ userId, open }: WalletSubscriptionsProps) {
  const { toast } = useToast();
  const [subs, setSubs] = useState<ActiveSub[]>([]);
  const [cancelling, setCancelling] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !userId) return;
    (async () => {
      const { data } = await supabase
        .from("feature_subscriptions")
        .select("id, feature_id, cycle, cycle_end, tokens_paid")
        .eq("user_id", userId)
        .is("cancelled_at", null)
        .gte("cycle_end", new Date().toISOString());
      setSubs(data || []);
    })();
  }, [open, userId]);

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
        description: `Refunded ${data.refund_amount ?? 0} tokens (prorated).`,
      });
      setSubs((prev) => prev.filter((s) => s.id !== sub.id));
    } catch (err: any) {
      toast({ title: "Cancel failed", description: err.message, variant: "destructive" });
    } finally {
      setCancelling(null);
    }
  }

  if (subs.length === 0) return null;

  return (
    <div className="px-5 pb-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Repeat className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
          Active subscriptions
        </span>
      </div>
      <div className="space-y-1.5">
        {subs.map((sub) => {
          const label =
            TOKEN_ACTION_LABELS[sub.feature_id as TokenAction] ||
            sub.feature_id.replace(/_/g, " ");
          const daysLeft = Math.max(
            0,
            Math.ceil((new Date(sub.cycle_end).getTime() - Date.now()) / 86400000)
          );
          return (
            <div
              key={sub.id}
              className="flex items-center justify-between rounded-lg border border-border/30 bg-muted/10 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-[11px] font-body font-medium text-foreground truncate">
                  {label}
                </p>
                <p className="text-[10px] text-muted-foreground font-mono">
                  {sub.cycle} · {daysLeft}d left
                </p>
              </div>
              <button
                onClick={() => handleCancel(sub)}
                disabled={!!cancelling}
                className="shrink-0 ml-2 text-destructive/70 hover:text-destructive transition-colors disabled:opacity-40"
                title="Cancel subscription"
              >
                {cancelling === sub.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <XCircle className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
