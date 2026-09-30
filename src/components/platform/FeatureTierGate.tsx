import { ReactNode, useState } from "react";
import { usePlatform, type FeatureTier } from "@/contexts/PlatformContext";
import { DevStatusDot } from "./DevStatusDot";
import { Button } from "@/components/ui/button";
import { Lock, Coins, ShieldCheck, RefreshCw } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { minimumPlanForFeature, getPlanConfig } from "@/lib/plans";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import FeatureSubscribeModal from "@/components/FeatureSubscribeModal";

interface FeatureTierGateProps {
  id: string;
  children: ReactNode;
}

export function FeatureTierGate({ id, children }: FeatureTierGateProps) {
  const { mode, flags, isFeatureEnabled, unlockFeature, unlockedFeatures, userFeatureGrants } = usePlatform();
  const { balance, spendCustom, hasActiveSubscription, activeSubscriptions } = useWallet();
  const config = flags[id];
  const [subModalOpen, setSubModalOpen] = useState(false);

  // Dev mode: show everything with badge overlay
  if (mode === "developer") {
    const isOff = !config?.enabled || config?.tier === "disabled";
    return (
      <div className={`relative ${isOff ? "opacity-40" : ""}`}>
        <DevStatusDot id={id} />
        <div className="absolute top-1 left-1 z-10 flex items-center gap-1 rounded bg-card/90 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground border border-border/50">
          {config?.tier ?? "free"} · {config?.enabled ? "ON" : "OFF"}
          {userFeatureGrants.has(id) && <ShieldCheck className="h-3 w-3 text-primary ml-1" />}
          {hasActiveSubscription(id) && <RefreshCw className="h-3 w-3 text-primary ml-1" />}
        </div>
        {children}
      </div>
    );
  }

  if (!config || config.tier === "free") {
    if (!config?.enabled) return null;
    return <>{children}</>;
  }

  if (config.tier === "disabled" || !config.enabled) return null;

  // Personal grant override
  if (userFeatureGrants.has(id)) {
    return (
      <div className="relative">
        <div className="absolute top-1 right-1 z-10 flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-mono text-primary border border-primary/20">
          <ShieldCheck className="h-3 w-3" /> Granted
        </div>
        {children}
      </div>
    );
  }

  // Active subscription override
  if (hasActiveSubscription(id)) {
    const sub = activeSubscriptions.find((s) => s.feature_id === id);
    return (
      <div className="relative">
        <div className="absolute top-1 right-1 z-10 flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-mono text-primary border border-primary/20 cursor-pointer"
          onClick={() => setSubModalOpen(true)}>
          <RefreshCw className="h-3 w-3" /> Subscribed
        </div>
        {children}
        <FeatureSubscribeModal
          open={subModalOpen}
          onOpenChange={setSubModalOpen}
          featureId={id}
          featureLabel={id}
          perUseCost={config.token_cost}
          weeklyCost={(config as any).weekly_cost ?? 0}
          monthlyCost={(config as any).monthly_cost ?? 0}
          yearlyCost={(config as any).yearly_cost ?? 0}
        />
      </div>
    );
  }

  // Token gated — show subscribe option if subscribable
  if (config.tier === "token") {
    if (unlockedFeatures.has(id)) return <>{children}</>;
    const cost = config.token_cost;
    const isSubscribable = (config as any).subscribable;

    return (
      <div className="relative rounded-xl border border-border/50 bg-card/80 p-6">
        <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
          <Coins className="h-8 w-8 text-primary" />
          <p className="font-body text-sm text-muted-foreground">This feature requires tokens</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="bg-gold-gradient font-body font-semibold text-primary-foreground"
              onClick={async () => {
                if ((balance ?? 0) < cost) {
                  toast.error("Insufficient tokens");
                  return;
                }
                const ok = await spendCustom(cost, `Unlock ${id}`);
                if (ok) unlockFeature(id);
              }}
            >
              Unlock for {cost} ⊘
            </Button>
            {isSubscribable && (
              <Button size="sm" variant="outline" className="font-body" onClick={() => setSubModalOpen(true)}>
                Subscribe
              </Button>
            )}
          </div>
        </div>
        {isSubscribable && (
          <FeatureSubscribeModal
            open={subModalOpen}
            onOpenChange={setSubModalOpen}
            featureId={id}
            featureLabel={id}
            perUseCost={cost}
            weeklyCost={(config as any).weekly_cost ?? 0}
            monthlyCost={(config as any).monthly_cost ?? 0}
            yearlyCost={(config as any).yearly_cost ?? 0}
          />
        )}
      </div>
    );
  }

  // Basic/Pro/Film Festival/Studio lock overlay
  const requiredPlan = minimumPlanForFeature(config.tier);
  const requiredPlanConfig = getPlanConfig(requiredPlan);
  return (
    <div className="relative rounded-xl border border-border/50 bg-card/80 p-6">
      <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
        <Lock className="h-8 w-8 text-muted-foreground" />
        <p className="font-body text-sm text-muted-foreground">
          This feature requires the <span className="font-semibold text-foreground">{requiredPlanConfig.name}</span> plan
        </p>
        <Link to="/pricing">
          <Button size="sm" variant="outline" className="font-body">
            View Plans
          </Button>
        </Link>
      </div>
    </div>
  );
}
