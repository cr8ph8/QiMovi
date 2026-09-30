import { motion, AnimatePresence } from "framer-motion";
import { Coins, X, Sparkles, ArrowRight, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TOKEN_BUNDLES } from "@/lib/wallet";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { useSiteSettings } from "@/hooks/useSiteSettings";

interface TokenPurchaseModalProps {
  open: boolean;
  onClose: () => void;
}

export function TokenPurchaseModal({ open, onClose }: TokenPurchaseModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { publicPaymentsOpen } = useSiteSettings();
  const [loadingBundle, setLoadingBundle] = useState<string | null>(null);

  async function handleBuyBundle(bundleId: string) {
    if (!user) {
      toast({ title: "Sign in required", description: "Please sign in to purchase tokens.", variant: "destructive" });
      return;
    }

    const bundle = TOKEN_BUNDLES.find((item) => item.id === bundleId);
    if (!bundle) return;

    setLoadingBundle(bundle.id);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: {
          bundle_id: bundle.id,
        },
      });

      if (error || data?.error) throw new Error(data?.error || error?.message);
      if (data?.url) {
        window.open(data.url, "_blank");
      }
    } catch (err: any) {
      toast({ title: "Checkout failed", description: err.message, variant: "destructive" });
    } finally {
      setLoadingBundle(null);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg mx-4 rounded-2xl border border-border bg-card p-6 shadow-xl"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <h2 className="font-display text-xl font-bold">Get More Tokens</h2>
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* How to get tokens */}
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 mb-5">
              <h3 className="font-display text-sm font-bold text-foreground mb-1">How to get tokens</h3>
              <ul className="text-xs font-body text-muted-foreground space-y-1">
                <li>• <strong className="text-foreground">Subscribe to Pro:</strong> Unlock Pro tools + 10% off token-priced actions</li>
                <li>• <strong className="text-foreground">Buy a bundle:</strong> Purchase tokens instantly via Stripe</li>
              </ul>
            </div>

            {!publicPaymentsOpen && (
              <div className="rounded-xl border border-muted bg-muted/20 p-4 mb-5 text-center">
                <Lock className="h-5 w-5 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm font-display font-bold text-muted-foreground">Purchases Temporarily Disabled</p>
                <p className="text-xs text-muted-foreground mt-1">Token purchases are not available at this time. Check back soon.</p>
              </div>
            )}

            {/* Bundle cards */}
            <p className="text-xs font-body text-muted-foreground mb-3 uppercase tracking-wider font-semibold">Token Bundles</p>
            <div className="grid grid-cols-2 gap-3">
              {TOKEN_BUNDLES.map((bundle) => {
                const perToken = (bundle.priceCents / 100 / bundle.tokens).toFixed(3);
                const isLoading = loadingBundle === bundle.id;
                return (
                  <button
                    key={bundle.name}
                    onClick={() => handleBuyBundle(bundle.id)}
                    disabled={!!loadingBundle || !publicPaymentsOpen}
                    className={`relative rounded-xl border border-border/60 bg-card p-4 text-left transition-all hover:border-primary/50 hover:shadow-md ${
                      loadingBundle && !isLoading ? "opacity-50" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Coins className="h-4 w-4 text-primary" />
                      <span className="text-xs font-mono text-muted-foreground uppercase">{bundle.name}</span>
                    </div>
                    <p className="font-display text-2xl font-bold">{bundle.tokens.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">tokens</p>
                    <div className="mt-2 space-y-0.5">
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : bundle.label}
                      </span>
                      <p className="text-[10px] font-mono text-muted-foreground">${perToken}/token</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 flex flex-col gap-2">
              <Link to="/pricing" onClick={onClose}>
                <Button className="w-full font-body font-semibold bg-gold-gradient text-primary-foreground gap-2">
                  View Plans & Subscribe <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              {!user && (
                <p className="text-[10px] text-center text-muted-foreground font-body">
                  Sign in to purchase tokens.
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
