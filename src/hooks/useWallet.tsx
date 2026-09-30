import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { TOKEN_COSTS, TokenAction, TOKEN_ACTION_LABELS } from "@/lib/wallet";
import { useTokenCosts } from "@/hooks/useTokenCosts";
import { useToast } from "@/hooks/use-toast";

interface FeatureSubscription {
  id: string;
  feature_id: string;
  cycle: string;
  tokens_paid: number;
  cycle_start: string;
  cycle_end: string;
  auto_renew: boolean;
  cancelled_at: string | null;
  refund_amount: number;
}

interface WalletContextType {
  balance: number | null;
  loading: boolean;
  spend: (action: TokenAction, entryId?: string, model?: string) => Promise<boolean>;
  spendCustom: (amount: number, label: string, model?: string) => Promise<boolean>;
  refresh: () => Promise<void>;
  activeSubscriptions: FeatureSubscription[];
  subscribe: (featureId: string, cycle: string) => Promise<boolean>;
  cancelSubscription: (featureId: string) => Promise<boolean>;
  hasActiveSubscription: (featureId: string) => boolean;
}

const WalletContext = createContext<WalletContextType>({
  balance: null,
  loading: true,
  spend: async () => false,
  spendCustom: async () => false,
  refresh: async () => {},
  activeSubscriptions: [],
  subscribe: async () => false,
  cancelSubscription: async () => false,
  hasActiveSubscription: () => false,
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { getCost } = useTokenCosts();
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSubscriptions, setActiveSubscriptions] = useState<FeatureSubscription[]>([]);

  const fetchBalance = useCallback(async () => {
    if (!user) {
      setBalance(null);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("token_wallets")
      .select("balance")
      .eq("user_id", user.id)
      .single();
    setBalance(data?.balance ?? null);
    setLoading(false);
  }, [user]);

  const fetchSubscriptions = useCallback(async () => {
    if (!user) {
      setActiveSubscriptions([]);
      return;
    }
    const { data } = await supabase
      .from("feature_subscriptions")
      .select("*")
      .eq("user_id", user.id);
    const now = new Date();
    const active = ((data as any[]) || []).filter(
      (s: any) => !s.cancelled_at && new Date(s.cycle_end) > now
    );
    setActiveSubscriptions(active);
  }, [user]);

  useEffect(() => {
    fetchBalance();
    fetchSubscriptions();
  }, [fetchBalance, fetchSubscriptions]);

  // Poll wallet balance and subscriptions (tables removed from realtime for security)
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      fetchBalance();
      fetchSubscriptions();
    }, 15_000);
    return () => clearInterval(interval);
  }, [user, fetchBalance, fetchSubscriptions]);

  const hasActiveSubscription = useCallback(
    (featureId: string) => activeSubscriptions.some((s) => s.feature_id === featureId),
    [activeSubscriptions]
  );

  const subscribe = useCallback(
    async (featureId: string, cycle: string): Promise<boolean> => {
      if (!user) {
        toast({ title: "Sign in required", variant: "destructive" });
        return false;
      }
      const { data, error } = await supabase.functions.invoke("manage-feature-subscription", {
        body: { action: "subscribe", feature_id: featureId, cycle },
      });
      if (error || data?.error) {
        toast({ title: "Subscribe failed", description: data?.error || error?.message, variant: "destructive" });
        return false;
      }
      setBalance(data.new_balance);
      fetchSubscriptions();
      return true;
    },
    [user, toast, fetchSubscriptions]
  );

  const cancelSubscription = useCallback(
    async (featureId: string): Promise<boolean> => {
      if (!user) {
        toast({ title: "Sign in required", variant: "destructive" });
        return false;
      }
      const { data, error } = await supabase.functions.invoke("manage-feature-subscription", {
        body: { action: "cancel", feature_id: featureId },
      });
      if (error || data?.error) {
        toast({ title: "Cancel failed", description: data?.error || error?.message, variant: "destructive" });
        return false;
      }
      setBalance(data.new_balance);
      toast({ title: "Subscription cancelled", description: `Refunded ${data.refund_amount} ⊘ to your wallet.` });
      fetchSubscriptions();
      return true;
    },
    [user, toast, fetchSubscriptions]
  );

  const spendCustom = useCallback(
    async (amount: number, label: string, model?: string): Promise<boolean> => {
      if (!user) {
        toast({ title: "Sign in required", description: "Please sign in to use this feature.", variant: "destructive" });
        return false;
      }
      if (balance !== null && balance < amount) {
        toast({ title: "Insufficient tokens", description: `You need ${amount} tokens but only have ${balance}.`, variant: "destructive" });
        return false;
      }
      // Refresh session to ensure a valid JWT is sent
      await supabase.auth.refreshSession();
      const { data, error } = await supabase.functions.invoke("spend-tokens", {
        body: { amount, label, model },
      });
      if (error || data?.error) {
        const msg = data?.error || error?.message || "Unknown error";
        if (msg === "Unauthorized" || msg === "Missing authorization") {
          toast({ title: "Session expired", description: "Please sign out and sign back in to continue.", variant: "destructive" });
        } else if (msg.includes("requires the Pro plan") || msg.includes("requires the Studio plan")) {
          toast({
            title: "Plan upgrade required",
            description: `${msg}. Visit the Pricing page to upgrade.`,
            variant: "destructive",
          });
        } else {
          toast({ title: "Spend failed", description: msg, variant: "destructive" });
        }
        return false;
      }
      setBalance(data.new_balance);
      return true;
    },
    [user, balance, toast]
  );

  const spend = useCallback(
    async (action: TokenAction, entryId?: string, model?: string): Promise<boolean> => {
      if (!user) {
        toast({ title: "Sign in required", description: "Please sign in to use this feature.", variant: "destructive" });
        return false;
      }
      const cost = getCost(action);
      const label = TOKEN_ACTION_LABELS[action];
      if (balance !== null && balance < cost) {
        toast({ title: "Insufficient tokens", description: `You need ${cost} tokens but only have ${balance}.`, variant: "destructive" });
        return false;
      }
      await supabase.auth.refreshSession();
      const { data, error } = await supabase.functions.invoke("spend-tokens", {
        body: { amount: cost, label, action, entry_id: entryId, model },
      });
      if (error || data?.error) {
        const msg = data?.error || error?.message || "Unknown error";
        if (msg === "Unauthorized" || msg === "Missing authorization") {
          toast({ title: "Session expired", description: "Please sign out and sign back in to continue.", variant: "destructive" });
        } else if (msg === "Feature is currently disabled") {
          toast({ title: "Feature disabled", description: "This feature is currently unavailable.", variant: "destructive" });
        } else if (msg.includes("requires the Pro plan") || msg.includes("requires the Studio plan")) {
          toast({
            title: "Plan upgrade required",
            description: `${msg}. Visit the Pricing page to upgrade.`,
            variant: "destructive",
          });
        } else {
          toast({ title: "Spend failed", description: msg, variant: "destructive" });
        }
        return false;
      }
      setBalance(data.new_balance);
      return true;
    },
    [user, balance, toast, getCost]
  );

  return (
    <WalletContext.Provider value={{ balance, loading, spend, spendCustom, refresh: fetchBalance, activeSubscriptions, subscribe, cancelSubscription, hasActiveSubscription }}>
      {children}
    </WalletContext.Provider>
  );
}

export const useWallet = () => useContext(WalletContext);
