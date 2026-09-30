export type PlanTier = "free" | "pro" | "studio";

export interface PlanConfig {
  key: PlanTier;
  name: string;
  priceCentsMonthly: number;
  priceLabel: string;
  monthlyTokens: number;
  discountPercent: number;
  maxScripts: number | null; // null = unlimited
  features: string[];
  support: string;
  highlight?: boolean;
  isOnDemand?: boolean;
}

export const PLANS: PlanConfig[] = [
  {
    key: "free",
    name: "Free",
    priceCentsMonthly: 0,
    priceLabel: "$0",
    monthlyTokens: 0,
    discountPercent: 0,
    maxScripts: null,
    support: "Community",
    features: [
      "Unlimited scripts",
      "Token top-ups available",
      "Community support",
      "Basic AI scoring",
      "Qi-List access (members only)",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    priceCentsMonthly: 2000,
    priceLabel: "$20",
    monthlyTokens: 0,
    discountPercent: 10,
    maxScripts: null,
    support: "Email",
    highlight: true,
    features: [
      "10% off all tools & entries",
      "Unlimited scripts",
      "Pro-gated features",
      "Qi-List access & private visibility",
      "Evidence artifact generation",
      "Email support",
      "Token top-ups available",
    ],
  },
  {
    key: "studio",
    name: "Studio",
    priceCentsMonthly: 0,
    priceLabel: "Custom",
    monthlyTokens: 0,
    discountPercent: 0,
    maxScripts: null,
    support: "Dedicated",
    isOnDemand: true,
    features: [
      "Custom token allowances",
      "Batch screenplay processing (maintenance hold)",
      "Sponsorship & ad bidding portal",
      "Run competitions & festivals",
      "Bulk AI scoring rates",
      "Unlimited scripts",
      "API access & team seats",
      "Dedicated support",
    ],
  },
];

export function getPlanConfig(tier: PlanTier): PlanConfig {
  return PLANS.find((p) => p.key === tier) || PLANS[0];
}

/** Return the minimum plan tier required to access a feature tier string */
export function minimumPlanForFeature(featureTier: string): PlanTier {
  switch (featureTier) {
    case "pro":
    case "basic":
    case "film_festival":
      return "pro";
    case "studio":
      return "studio";
    default:
      return "free";
  }
}

/** Check if a user's plan meets or exceeds the required tier */
export function planMeetsRequirement(userPlan: PlanTier, requiredPlan: PlanTier): boolean {
  const order: PlanTier[] = ["free", "pro", "studio"];
  return order.indexOf(userPlan) >= order.indexOf(requiredPlan);
}

/** Apply plan discount to a token amount */
export function applyDiscount(amount: number, discountPercent: number): number {
  if (discountPercent <= 0) return amount;
  return Math.ceil(amount * (1 - discountPercent / 100));
}
