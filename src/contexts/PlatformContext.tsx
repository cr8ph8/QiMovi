import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type FeatureTier = "free" | "basic" | "pro" | "film_festival" | "studio" | "token" | "disabled";
export type PlatformMode = "user" | "developer";

export interface FeatureConfig {
  id: string;
  enabled: boolean;
  tier: FeatureTier;
  token_cost: number;
  usage_policy: { max_uses?: number; time_window_hours?: number };
  subscribable?: boolean;
  weekly_cost?: number;
  monthly_cost?: number;
  yearly_cost?: number;
  model_hint?: string | null;
}

const DEFAULT_FLAGS: Record<string, FeatureConfig> = {
  ai_score: { id: "ai_score", enabled: true, tier: "free", token_cost: 0, usage_policy: {} },
  deep_analysis: { id: "deep_analysis", enabled: true, tier: "token", token_cost: 20, usage_policy: {} },
  beat_board: { id: "beat_board", enabled: false, tier: "pro", token_cost: 0, usage_policy: {} },
  ai_suggest: { id: "ai_suggest", enabled: true, tier: "free", token_cost: 0, usage_policy: {} },
  script_upload: { id: "script_upload", enabled: true, tier: "free", token_cost: 0, usage_policy: {} },
  competition_entry: { id: "competition_entry", enabled: true, tier: "free", token_cost: 0, usage_policy: {} },
  leaderboard: { id: "leaderboard", enabled: true, tier: "free", token_cost: 0, usage_policy: {} },
  token_purchase: { id: "token_purchase", enabled: true, tier: "free", token_cost: 0, usage_policy: {} },
  pen_name: { id: "pen_name", enabled: false, tier: "free", token_cost: 0, usage_policy: {} },
  token_transfer: { id: "token_transfer", enabled: false, tier: "free", token_cost: 0, usage_policy: {} },
  screenplay_viewer: { id: "screenplay_viewer", enabled: true, tier: "pro", token_cost: 0, usage_policy: {} },
  q2e_analytics: { id: "q2e_analytics", enabled: true, tier: "token", token_cost: 15, usage_policy: {} },
  voice_drift: { id: "voice_drift", enabled: true, tier: "token", token_cost: 10, usage_policy: {} },
  ai_review: { id: "ai_review", enabled: true, tier: "pro", token_cost: 0, usage_policy: {} },
  governance: { id: "governance", enabled: true, tier: "pro", token_cost: 0, usage_policy: {} },
  evidence_artifacts: { id: "evidence_artifacts", enabled: true, tier: "pro", token_cost: 0, usage_policy: {} },
  rewrite_lineage: { id: "rewrite_lineage", enabled: true, tier: "pro", token_cost: 0, usage_policy: {} },
};

interface PlatformContextType {
  mode: PlatformMode;
  setMode: (mode: PlatformMode) => void;
  flags: Record<string, FeatureConfig>;
  isFeatureEnabled: (id: string) => boolean;
  getFeatureConfig: (id: string) => FeatureConfig | undefined;
  toggleFlag: (id: string) => Promise<void>;
  setFeatureTier: (id: string, tier: FeatureTier) => Promise<void>;
  setFeatureUsagePolicy: (id: string, policy: { max_uses?: number; time_window_hours?: number }) => Promise<void>;
  setFeatureTokenCost: (id: string, cost: number) => Promise<void>;
  setFeatureModelHint: (id: string, model: string | null) => Promise<void>;
  setFeatureSubscriptionConfig: (id: string, config: { subscribable?: boolean; weekly_cost?: number; monthly_cost?: number; yearly_cost?: number }) => Promise<void>;
  unlockFeature: (id: string) => void;
  unlockedFeatures: Set<string>;
  userFeatureGrants: Set<string>;
}

const PlatformContext = createContext<PlatformContextType>({
  mode: "user",
  setMode: () => {},
  flags: DEFAULT_FLAGS,
  isFeatureEnabled: () => true,
  getFeatureConfig: () => undefined,
  toggleFlag: async () => {},
  setFeatureTier: async () => {},
  setFeatureUsagePolicy: async () => {},
  setFeatureTokenCost: async () => {},
  setFeatureModelHint: async () => {},
  setFeatureSubscriptionConfig: async () => {},
  unlockFeature: () => {},
  unlockedFeatures: new Set(),
  userFeatureGrants: new Set(),
});

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<PlatformMode>(() => {
    const stored = localStorage.getItem("platform-mode");
    return (stored === "developer" ? "developer" : "user") as PlatformMode;
  });
  const [flags, setFlags] = useState<Record<string, FeatureConfig>>({ ...DEFAULT_FLAGS });
  const [unlockedFeatures, setUnlockedFeatures] = useState<Set<string>>(new Set());
  const [userFeatureGrants, setUserFeatureGrants] = useState<Set<string>>(new Set());
  const { isAdmin, user } = useAuth();

  const setMode = useCallback((m: PlatformMode) => {
    localStorage.setItem("platform-mode", m);
    setModeState(m);
  }, []);

  // Load feature configs from DB and subscribe to realtime
  useEffect(() => {
    async function load() {
      const { data } = await supabase.from("feature_configs").select("*");
      if (data) {
        const merged = { ...DEFAULT_FLAGS };
        data.forEach((row: any) => {
          merged[row.id] = {
            id: row.id,
            enabled: row.enabled,
            tier: row.tier as FeatureTier,
            token_cost: row.token_cost,
            usage_policy: (row.usage_policy as any) || {},
            subscribable: row.subscribable ?? false,
            weekly_cost: row.weekly_cost ?? 0,
            monthly_cost: row.monthly_cost ?? 0,
            yearly_cost: row.yearly_cost ?? 0,
            model_hint: row.model_hint ?? null,
          };
        });
        setFlags(merged);
      }
    }
    load();

    // Realtime — postgres_changes only (broadcast/presence blocked by policy)
    // See REALTIME_SUBSCRIPTION_RULES.md before adding new subscriptions
    const channel = supabase
      .channel("feature_configs_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "feature_configs" }, (payload) => {
        if (payload.eventType === "DELETE") {
          setFlags((prev) => {
            const next = { ...prev };
            const id = (payload.old as any).id;
            if (DEFAULT_FLAGS[id]) {
              next[id] = DEFAULT_FLAGS[id];
            } else {
              delete next[id];
            }
            return next;
          });
        } else {
          const row = payload.new as any;
          setFlags((prev) => ({
            ...prev,
            [row.id]: {
              id: row.id,
              enabled: row.enabled,
              tier: row.tier as FeatureTier,
              token_cost: row.token_cost,
              usage_policy: row.usage_policy || {},
              subscribable: row.subscribable ?? false,
              weekly_cost: row.weekly_cost ?? 0,
              monthly_cost: row.monthly_cost ?? 0,
              yearly_cost: row.yearly_cost ?? 0,
              model_hint: row.model_hint ?? null,
            },
          }));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Load user feature grants
  useEffect(() => {
    if (!user) {
      setUserFeatureGrants(new Set());
      return;
    }

    async function loadGrants() {
      const { data } = await supabase
        .from("user_feature_grants")
        .select("feature_id, expires_at")
        .eq("user_id", user!.id);
      if (data) {
        const now = new Date();
        const activeGrants = data
          .filter((g: any) => !g.expires_at || new Date(g.expires_at) > now)
          .map((g: any) => g.feature_id);
        setUserFeatureGrants(new Set(activeGrants));
      }
    }
    loadGrants();

    // Realtime — postgres_changes only (broadcast/presence blocked by policy)
    // See REALTIME_SUBSCRIPTION_RULES.md before adding new subscriptions
    const channel = supabase
      .channel("user_feature_grants_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "user_feature_grants", filter: `user_id=eq.${user.id}` }, () => {
        loadGrants();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const isFeatureEnabled = useCallback(
    (id: string) => {
      if (mode === "developer") return true;
      const config = flags[id];
      if (!config) return true;
      if (!config.enabled || config.tier === "disabled") return false;
      // Check personal grant override
      if (userFeatureGrants.has(id)) return true;
      if (config.tier === "token") return unlockedFeatures.has(id);
      if (config.tier === "free") return true;
      return false;
    },
    [mode, flags, unlockedFeatures, userFeatureGrants]
  );

  const getFeatureConfig = useCallback((id: string) => flags[id], [flags]);

  const upsertConfig = async (id: string, updates: Record<string, any>) => {
    const current = flags[id] || DEFAULT_FLAGS[id] || { id, enabled: true, tier: "free", token_cost: 0, usage_policy: {} };
    const row: Record<string, any> = {
      id,
      enabled: updates.enabled ?? current.enabled,
      tier: updates.tier ?? current.tier,
      token_cost: updates.token_cost ?? current.token_cost,
      usage_policy: updates.usage_policy ?? current.usage_policy,
    };
    // Include subscription fields if provided
    if (updates.subscribable !== undefined) row.subscribable = updates.subscribable;
    if (updates.weekly_cost !== undefined) row.weekly_cost = updates.weekly_cost;
    if (updates.monthly_cost !== undefined) row.monthly_cost = updates.monthly_cost;
    if (updates.yearly_cost !== undefined) row.yearly_cost = updates.yearly_cost;
    if (updates.model_hint !== undefined) row.model_hint = updates.model_hint;
    await supabase.from("feature_configs").upsert(row as any);
  };

  const toggleFlag = async (id: string) => {
    const current = flags[id];
    await upsertConfig(id, { enabled: !(current?.enabled ?? true) });
  };

  const setFeatureTier = async (id: string, tier: FeatureTier) => {
    await upsertConfig(id, { tier });
  };

  const setFeatureUsagePolicy = async (id: string, policy: { max_uses?: number; time_window_hours?: number }) => {
    await upsertConfig(id, { usage_policy: policy });
  };

  const setFeatureTokenCost = async (id: string, cost: number) => {
    await upsertConfig(id, { token_cost: cost });
  };

  const setFeatureSubscriptionConfig = async (id: string, config: { subscribable?: boolean; weekly_cost?: number; monthly_cost?: number; yearly_cost?: number }) => {
    await upsertConfig(id, config);
  };

  const setFeatureModelHint = async (id: string, model: string | null) => {
    await upsertConfig(id, { model_hint: model });
  };

  const unlockFeature = useCallback((id: string) => {
    setUnlockedFeatures((prev) => new Set(prev).add(id));
  }, []);

  return (
    <PlatformContext.Provider
      value={{
        mode: isAdmin ? mode : "user",
        setMode,
        flags,
        isFeatureEnabled,
        getFeatureConfig,
        toggleFlag,
        setFeatureTier,
        setFeatureUsagePolicy,
        setFeatureTokenCost,
        setFeatureModelHint,
        setFeatureSubscriptionConfig,
        unlockFeature,
        unlockedFeatures,
        userFeatureGrants,
      }}
    >
      {children}
    </PlatformContext.Provider>
  );
}

export const usePlatform = () => useContext(PlatformContext);
