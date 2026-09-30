import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, CalendarDays, Loader2, RefreshCw } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { toast } from "sonner";

interface FeatureSubscribeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  featureId: string;
  featureLabel?: string;
  perUseCost: number;
  weeklyCost: number;
  monthlyCost: number;
  yearlyCost: number;
}

const CYCLES = [
  { key: "weekly", label: "Weekly", icon: Clock, duration: "7 days" },
  { key: "monthly", label: "Monthly", icon: Calendar, duration: "30 days" },
  { key: "yearly", label: "Yearly", icon: CalendarDays, duration: "365 days" },
] as const;

function calcSavings(cycleCost: number, perUseCost: number, usesPerCycle: number): number {
  if (perUseCost <= 0 || cycleCost <= 0) return 0;
  const payPerUseTotal = perUseCost * usesPerCycle;
  return Math.round(((payPerUseTotal - cycleCost) / payPerUseTotal) * 100);
}

const ESTIMATED_USES = { weekly: 3, monthly: 12, yearly: 144 };

export default function FeatureSubscribeModal({
  open,
  onOpenChange,
  featureId,
  featureLabel,
  perUseCost,
  weeklyCost,
  monthlyCost,
  yearlyCost,
}: FeatureSubscribeModalProps) {
  const { balance, activeSubscriptions, subscribe, cancelSubscription } = useWallet();
  const [loading, setLoading] = useState<string | null>(null);

  const activeSub = activeSubscriptions.find(
    (s) => s.feature_id === featureId && !s.cancelled_at && new Date(s.cycle_end) > new Date()
  );

  const costs: Record<string, number> = { weekly: weeklyCost, monthly: monthlyCost, yearly: yearlyCost };

  const handleSubscribe = async (cycle: string) => {
    setLoading(cycle);
    const ok = await subscribe(featureId, cycle);
    setLoading(null);
    if (ok) {
      toast.success(`Subscribed to ${featureLabel || featureId} (${cycle})`);
      onOpenChange(false);
    }
  };

  const handleCancel = async () => {
    setLoading("cancel");
    const ok = await cancelSubscription(featureId);
    setLoading(null);
    if (ok) {
      toast.success(`Cancelled ${featureLabel || featureId} subscription`);
    }
  };

  // Calculate prorated refund preview
  const refundPreview = activeSub
    ? Math.floor(
        activeSub.tokens_paid *
          (Math.max(0, new Date(activeSub.cycle_end).getTime() - Date.now()) /
            (new Date(activeSub.cycle_end).getTime() - new Date(activeSub.cycle_start).getTime()))
      )
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">
            {activeSub ? "Manage Subscription" : "Subscribe to Feature"}
          </DialogTitle>
          <DialogDescription className="font-body">
            {featureLabel || featureId} — {activeSub ? "Active subscription" : "Choose a billing cycle"}
          </DialogDescription>
        </DialogHeader>

        {activeSub ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border/50 bg-muted/20 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Cycle</span>
                <Badge variant="secondary" className="font-mono text-xs capitalize">{activeSub.cycle}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Paid</span>
                <span className="font-mono text-sm">{activeSub.tokens_paid} ⊘</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Renews</span>
                <span className="font-mono text-sm">{new Date(activeSub.cycle_end).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Auto-renew</span>
                <Badge variant={activeSub.auto_renew ? "default" : "outline"} className="text-xs">
                  {activeSub.auto_renew ? "ON" : "OFF"}
                </Badge>
              </div>
            </div>

            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-sm text-muted-foreground mb-2">
                Cancel and receive a prorated refund of <span className="font-semibold text-foreground">{refundPreview} ⊘</span>
              </p>
              <Button
                variant="destructive"
                size="sm"
                className="w-full"
                onClick={handleCancel}
                disabled={loading === "cancel"}
              >
                {loading === "cancel" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Cancel & Refund {refundPreview} ⊘
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground text-center mb-2">
              Balance: <span className="font-mono text-foreground">{balance ?? 0} ⊘</span>
              {perUseCost > 0 && <> · Pay-per-use: <span className="font-mono">{perUseCost} ⊘</span></>}
            </div>

            {CYCLES.map(({ key, label, icon: Icon, duration }) => {
              const cost = costs[key];
              if (!cost || cost <= 0) return null;
              const savings = calcSavings(cost, perUseCost, ESTIMATED_USES[key]);
              const canAfford = (balance ?? 0) >= cost;

              return (
                <button
                  key={key}
                  onClick={() => handleSubscribe(key)}
                  disabled={!canAfford || loading !== null}
                  className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all ${
                    canAfford
                      ? "border-border/50 bg-card/80 hover:border-primary/50 hover:bg-primary/5 cursor-pointer"
                      : "border-border/30 bg-muted/20 opacity-60 cursor-not-allowed"
                  }`}
                >
                  <Icon className="h-5 w-5 text-primary shrink-0" />
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className="font-body font-semibold text-sm">{label}</span>
                      {savings > 0 && (
                        <Badge variant="secondary" className="text-[10px] font-mono bg-primary/10 text-primary">
                          Save {savings}%
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{duration}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-sm font-semibold">{cost} ⊘</span>
                    {loading === key && <Loader2 className="h-3 w-3 animate-spin ml-1 inline" />}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
