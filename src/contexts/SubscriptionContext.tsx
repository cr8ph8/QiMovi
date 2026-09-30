import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PlanTier, getPlanConfig, planMeetsRequirement, applyDiscount, minimumPlanForFeature } from "@/lib/plans";

interface SubscriptionContextType {
  plan: PlanTier;
  discountPercent: number;
  monthlyTokensRemaining: number;
  loading: boolean;
  canAccessFeature: (featureTier: string) => boolean;
  getDiscountedCost: (amount: number) => number;
  refresh: () => Promise<void>;
  isTokenActivated: boolean;
  periodEnd: string | null;
}

const SubscriptionContext = createContext<SubscriptionContextType>({
  plan: "free",
  discountPercent: 0,
  monthlyTokensRemaining: 0,
  loading: true,
  canAccessFeature: () => true,
  getDiscountedCost: (a) => a,
  refresh: async () => {},
  isTokenActivated: false,
  periodEnd: null,
});

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [plan, setPlan] = useState<PlanTier>("free");
  const [monthlyTokensRemaining, setMonthlyTokensRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stripeSubId, setStripeSubId] = useState<string | null>(null);
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);
  const refreshGeneration = useRef(0);

  const config = getPlanConfig(plan);

  const refreshSubscription = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    const isCurrent = () => refreshGeneration.current === generation;

    setLoading(true);
    // Local rows are useful for ancillary counters, but never prove a paid
    // entitlement. Keep paid gates closed until Stripe is verified below.
    setPlan("free");

    if (!user) {
      setMonthlyTokensRemaining(0);
      setStripeSubId(null);
      setPeriodEnd(null);
      setLoading(false);
      return;
    }

    const { data: localData } = await supabase
      .from("subscriptions")
      .select("monthly_tokens_remaining, stripe_subscription_id, current_period_end")
      .eq("user_id", user.id)
      .single();

    if (!isCurrent()) return;
    if (localData) {
      setMonthlyTokensRemaining(localData.monthly_tokens_remaining ?? 0);
      setStripeSubId(localData.stripe_subscription_id ?? null);
      setPeriodEnd(localData.current_period_end ?? null);
    } else {
      setMonthlyTokensRemaining(0);
      setStripeSubId(null);
      setPeriodEnd(null);
    }

    try {
      const { data, error } = await supabase.functions.invoke("check-subscription");
      if (!isCurrent()) return;
      if (error) throw error;

      if (data?.subscribed === true) {
        setPlan("pro");
        setStripeSubId(data.subscription_id ?? null);
        setPeriodEnd(data.subscription_end ?? null);
      } else {
        setPlan("free");
        setStripeSubId(null);
        setPeriodEnd(null);
      }
    } catch {
      if (!isCurrent()) return;
      // Fail closed: a network/API error is not proof of paid entitlement.
      setPlan("free");
      setStripeSubId(null);
      setPeriodEnd(null);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refreshSubscription();
    return () => {
      refreshGeneration.current += 1;
    };
  }, [refreshSubscription]);

  // Realtime — postgres_changes only (broadcast/presence blocked by policy)
  // See REALTIME_SUBSCRIPTION_RULES.md before adding new subscriptions
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("subscription-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${user.id}` },
        (payload: any) => {
          if (payload.new) {
            setMonthlyTokensRemaining(payload.new.monthly_tokens_remaining ?? 0);
            // Realtime may revoke a paid entitlement immediately, but a raw
            // database event can never promote one without Stripe verification.
            if (payload.new.plan !== "pro") {
              setPlan("free");
              setStripeSubId(null);
              setPeriodEnd(null);
            }
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const canAccessFeature = useCallback(
    (featureTier: string) => {
      const required = minimumPlanForFeature(featureTier);
      return planMeetsRequirement(plan, required);
    },
    [plan]
  );

  const getDiscountedCost = useCallback(
    (amount: number) => applyDiscount(amount, config.discountPercent),
    [config.discountPercent]
  );

  const isTokenActivated = stripeSubId === "token_activated";

  return (
    <SubscriptionContext.Provider
      value={{
        plan,
        discountPercent: config.discountPercent,
        monthlyTokensRemaining,
        loading,
        canAccessFeature,
        getDiscountedCost,
        refresh: refreshSubscription,
        isTokenActivated,
        periodEnd,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export const useSubscription = () => useContext(SubscriptionContext);
