import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TOKEN_COSTS, TokenAction } from "@/lib/wallet";

interface TokenCostRow {
  id: string;
  token_cost: number;
  enabled: boolean;
  tier: string;
}

/**
 * Fetches live token costs from feature_configs, falling back to
 * wallet.ts TOKEN_COSTS for any action not in the DB.
 * 
 * The spend-tokens edge function already reads feature_configs as
 * the authoritative source — this hook mirrors that on the client
 * for accurate cost display in UI.
 */
export function useTokenCosts() {
  const [liveCosts, setLiveCosts] = useState<Record<string, number>>({});
  const [configs, setConfigs] = useState<TokenCostRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    const { data } = await supabase
      .from("feature_configs")
      .select("id, token_cost, enabled, tier");
    const rows = (data ?? []) as TokenCostRow[];
    setConfigs(rows);
    const map: Record<string, number> = {};
    for (const r of rows) {
      map[r.id] = r.token_cost;
    }
    setLiveCosts(map);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  /** Get the cost for a token action — DB value wins, then wallet.ts default */
  const getCost = useCallback(
    (action: TokenAction): number => {
      if (action in liveCosts) return liveCosts[action];
      return TOKEN_COSTS[action];
    },
    [liveCosts],
  );

  /** Check if a feature is enabled in DB (defaults to true if not in DB) */
  const isEnabled = useCallback(
    (action: string): boolean => {
      const row = configs.find((c) => c.id === action);
      return row ? row.enabled : true;
    },
    [configs],
  );

  return { getCost, isEnabled, liveCosts, configs, loading, refresh: fetch };
}
