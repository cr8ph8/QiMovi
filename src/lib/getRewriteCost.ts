import { REWRITE_COST, REWRITE_TYPE_MAP, type RewriteTier } from "@/config/rewrite-costs";

/**
 * Resolve a rewrite operation type to its token cost.
 * Returns the tier cost from REWRITE_TYPE_MAP, defaulting to STANDARD (3) for unknown types.
 */
export function getRewriteCost(type: string): number {
  const tier: RewriteTier | undefined = REWRITE_TYPE_MAP[type];
  if (!tier) return REWRITE_COST.STANDARD;
  return REWRITE_COST[tier];
}

/**
 * Resolve the tier label for a rewrite operation type.
 */
export function getRewriteTier(type: string): RewriteTier {
  return REWRITE_TYPE_MAP[type] ?? "STANDARD";
}
