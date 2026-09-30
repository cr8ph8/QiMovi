export const PRO_PLAN_ID = "pro" as const;

export interface SubscriptionPlan {
  id: typeof PRO_PLAN_ID;
  stripePriceId: string;
}

/**
 * Subscription prices are operations-owned configuration. Never accept a
 * Stripe price identifier from a browser request and never fall back to a
 * checked-in live price: a missing secret must keep checkout closed.
 */
export function resolveSubscriptionPlan(planId: unknown): SubscriptionPlan | null {
  if (planId !== PRO_PLAN_ID) return null;

  const stripePriceId = Deno.env.get("STRIPE_PRO_MONTHLY_PRICE_ID")?.trim();
  if (!stripePriceId) return null;

  return { id: PRO_PLAN_ID, stripePriceId };
}

export function resolveSubscriptionPlanByPrice(
  stripePriceId: string | null | undefined,
): SubscriptionPlan | null {
  if (!stripePriceId) return null;
  const plan = resolveSubscriptionPlan(PRO_PLAN_ID);
  return plan?.stripePriceId === stripePriceId ? plan : null;
}
