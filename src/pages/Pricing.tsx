import React, { useState, useEffect, useCallback } from "react";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Crown, Building2, Sparkles, Coins, ArrowRight, X, ChevronDown, MessageSquare, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useWallet } from "@/hooks/useWallet";
import { PLANS, PlanConfig, PlanTier, planMeetsRequirement } from "@/lib/plans";
import { TOKEN_BUNDLES, TOKEN_COSTS, TOKEN_ACTION_LABELS, TokenAction } from "@/lib/wallet";
import { useToast } from "@/hooks/use-toast";
import { Link, useNavigate } from "react-router-dom";
import { loadAccessIntent, clearAccessIntent, resolveRedirectPath } from "@/lib/accessIntent";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { TokenBundleEstimator } from "@/components/pricing/TokenBundleEstimator";


const tierIcons: Record<PlanTier, typeof Sparkles> = {
  free: Sparkles,
  pro: Crown,
  studio: Building2,
};

const TIER_TAGLINES: Record<PlanTier, string> = {
  free: "Explore the platform. Score one script and try the tools.",
  pro: "For active writers shipping drafts, entries, and rewrites every month.",
  studio: "For production companies, festivals, and competitions running at scale.",
};


type CheckoutStep = "review" | "payment" | "processing" | "success";

function StudioInquiryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [useCase, setUseCase] = useState("");
  const [volume, setVolume] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setSubmitting(true);

    const { error } = await supabase.from("studio_inquiries").insert({
      user_id: user?.id ?? null,
      name: name.trim(),
      email: email.trim(),
      use_case: useCase.trim(),
      estimated_volume: volume.trim(),
    });

    setSubmitting(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    setSubmitted(true);
  }

  function resetAndClose() {
    setName(""); setEmail(""); setUseCase(""); setVolume("");
    setSubmitted(false);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && resetAndClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden bg-card border-border/50">
        <DialogTitle className="sr-only">Studio Access Inquiry</DialogTitle>
        <AnimatePresence mode="wait">
          {!submitted ? (
            <motion.form
              key="form"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              onSubmit={handleSubmit}
              className="p-6 space-y-4"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold">Studio Access</h3>
                  <p className="text-xs text-muted-foreground font-body">
                    Tell us about your needs — we'll craft a custom plan
                  </p>
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground font-body mb-1 block">Name *</label>
                <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} className="h-9 text-sm" required />
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-body mb-1 block">Email *</label>
                <Input type="email" placeholder="you@studio.com" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9 text-sm" required />
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-body mb-1 block">Use Case</label>
                <Textarea
                  placeholder="e.g. We're a production company scoring 50+ scripts per month for festival submissions…"
                  value={useCase}
                  onChange={(e) => setUseCase(e.target.value)}
                  className="text-sm min-h-[80px]"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-body mb-1 block">Estimated Volume</label>
                <Input placeholder="e.g. 50 scripts/month, 5 team members" value={volume} onChange={(e) => setVolume(e.target.value)} className="h-9 text-sm" />
              </div>

              <div className="rounded-lg border border-border/30 bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground font-body">
                  We'll reach out within 24 hours with custom pricing including bulk processing rates and reduced per-action costs.
                </p>
              </div>

              <div className="flex gap-3">
                <Button type="button" variant="outline" onClick={resetAndClose} className="flex-1 font-body">Cancel</Button>
                <Button type="submit" disabled={submitting || !name.trim() || !email.trim()} className="flex-1 font-body font-semibold bg-gold-gradient text-primary-foreground gap-2">
                  {submitting ? "Submitting…" : <><Send className="h-4 w-4" /> Submit</>}
                </Button>
              </div>
            </motion.form>
          ) : (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-8 flex flex-col items-center justify-center text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", delay: 0.2 }}
                className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-6"
              >
                <Check className="h-8 w-8 text-primary" />
              </motion.div>
              <h3 className="font-display text-xl font-bold mb-2">Inquiry Received!</h3>
              <p className="text-sm text-muted-foreground font-body mb-6">
                We'll be in touch within 24 hours with a custom Studio plan tailored to your needs.
              </p>
              <Button onClick={resetAndClose} className="font-body font-semibold">Done</Button>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

function useStripeCheckout() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { publicPaymentsOpen } = useSiteSettings();
  const [loading, setLoading] = useState(false);

  const startCheckout = useCallback(async (opts: {
    plan_id: "pro";
  }) => {
    if (!user) {
      toast({ title: "Sign in required", description: "Please sign in first.", variant: "destructive" });
      return;
    }
    if (!publicPaymentsOpen) {
      toast({ title: "Purchases unavailable", description: "Checkout is not open yet.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: opts,
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      if (data?.url) {
        window.open(data.url, "_blank");
      }
    } catch (err: any) {
      toast({ title: "Checkout failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [publicPaymentsOpen, user, toast]);

  return { startCheckout, loading };
}

export default function Pricing() {
  const { user } = useAuth();
  const { plan: currentPlan, refresh } = useSubscription();
  const { refresh: refreshWallet } = useWallet();
  const { toast } = useToast();
  const { launchState, publicCta, publicPaymentsOpen } = useSiteSettings();
  const { startCheckout, loading: checkoutLoading } = useStripeCheckout();
  const [studioModalOpen, setStudioModalOpen] = useState(false);
  const [loadingBundle, setLoadingBundle] = useState<string | null>(null);
  const navigate = useNavigate();
  const [pendingIntent, setPendingIntent] = useState(() => loadAccessIntent());

  // Handle checkout success from Stripe redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkoutStatus = params.get("checkout");
    const sessionId = params.get("session_id");

    if (checkoutStatus === "success" && sessionId) {
      // Clean URL
      window.history.replaceState({}, "", "/pricing");

      (async () => {
        try {
          const { data, error } = await supabase.functions.invoke("fulfill-checkout", {
            body: { session_id: sessionId },
          });
          if (error || data?.error) throw new Error(data?.error || error?.message);

          if (data?.type === "token_purchase") {
            toast({ title: "Tokens Credited! 🎉", description: `${data.tokens_credited} tokens added to your wallet.` });
          } else if (data?.type === "subscription") {
            toast({ title: "Welcome to Pro! 🎉", description: "Your Pro subscription is now active." });
          } else if (data?.already_fulfilled) {
            toast({ title: "Already processed", description: "This purchase was already fulfilled." });
          }
          refresh();
          refreshWallet();
          // Intent preservation: return user to the locked surface that
          // sent them here, if any.
          const dest = resolveRedirectPath(new URLSearchParams(), "");
          if (dest) {
            clearAccessIntent();
            setPendingIntent(null);
            setTimeout(() => navigate(dest), 1500);
          }
        } catch (err: any) {
          toast({ title: "Fulfillment issue", description: err.message, variant: "destructive" });
        }
      })();
    } else if (checkoutStatus === "canceled") {
      window.history.replaceState({}, "", "/pricing");
      toast({ title: "Checkout canceled", description: "No charges were made." });
    }
  }, []);

  const handleSubscribe = (plan: PlanConfig) => {
    if (!user) {
      toast({ title: "Sign in required", description: "Please sign in to subscribe.", variant: "destructive" });
      return;
    }
    if (plan.isOnDemand) {
      if (!publicPaymentsOpen) {
        toast({ title: "Access not open", description: "Apply for launch access first.", variant: "destructive" });
        return;
      }
      setStudioModalOpen(true);
      return;
    }
    if (plan.key === "pro") {
      if (!publicPaymentsOpen) {
        toast({ title: "Purchases unavailable", description: "Subscriptions are not open yet.", variant: "destructive" });
        return;
      }
      startCheckout({ plan_id: "pro" });
      return;
    }
  };

  async function handleBuyBundle(bundleId: string) {
    if (!user) {
      toast({ title: "Sign in required", description: "Please sign in to purchase tokens.", variant: "destructive" });
      return;
    }
    if (!publicPaymentsOpen) {
      toast({ title: "Purchases unavailable", description: "Token checkout is not open yet.", variant: "destructive" });
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
      if (data?.url) window.open(data.url, "_blank");
    } catch (err: any) {
      toast({ title: "Checkout failed", description: err.message, variant: "destructive" });
    } finally {
      setLoadingBundle(null);
    }
  }

  return (
    <div className="min-h-screen bg-background pt-24 pb-16">
      <div className="container max-w-6xl">
        {pendingIntent && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
          >
            <div className="flex items-center gap-2 min-w-0">
              <ArrowRight className="h-4 w-4 text-primary shrink-0" />
              <span className="truncate">
                After upgrading you'll return to{" "}
                <code className="font-mono text-xs text-primary">{pendingIntent.returnTo}</code>
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                clearAccessIntent();
                setPendingIntent(null);
              }}
            >
              Dismiss
            </Button>
          </motion.div>
        )}
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <Badge variant="outline" className="mb-4 border-primary/30 text-primary font-mono text-[11px] px-3 py-1">
            <Sparkles className="h-3 w-3 mr-1.5" /> Pay only for what you create
          </Badge>
          <h1 className="font-display text-4xl md:text-5xl font-bold mb-4 leading-tight">
            Pricing built for <span className="text-gradient-gold">working writers</span>
          </h1>
          <p className="font-body text-lg text-muted-foreground max-w-2xl mx-auto">
            One flat token rate. No surprise fees. Top up anytime, on any plan — unused tokens never expire.
          </p>
        </motion.div>


        {/* Plan Cards — 3 tiers */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16 max-w-4xl mx-auto">
          {PLANS.map((plan, i) => {
            const Icon = tierIcons[plan.key];
            const isCurrent = currentPlan === plan.key;
            const isHighlighted = plan.highlight;
            const isOnDemand = plan.isOnDemand;

            return (
              <motion.div
                key={plan.key}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className={`relative flex flex-col rounded-2xl border p-7 transition-all hover:-translate-y-0.5 ${
                  isHighlighted
                    ? "border-primary/60 bg-gradient-to-b from-primary/[0.08] via-card to-card shadow-xl shadow-primary/10"
                    : isOnDemand
                    ? "border-accent/30 bg-card/90"
                    : "border-border/50 bg-card/80"
                } ${isCurrent ? "ring-2 ring-primary" : ""}`}
              >
                {isHighlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-gold-gradient text-xs font-body font-semibold text-primary-foreground shadow-md shadow-primary/30">
                    Most Popular
                  </div>
                )}
                {isCurrent && !isOnDemand && (
                  <div className="absolute -top-3 right-4 px-3 py-0.5 rounded-full bg-primary/20 text-xs font-body font-semibold text-primary border border-primary/30">
                    Current Plan
                  </div>
                )}

                <div className="flex items-center gap-2 mb-2">
                  <div className={`p-2 rounded-lg ${isHighlighted ? "bg-primary/15" : "bg-muted"}`}>
                    <Icon className={`h-5 w-5 ${isHighlighted ? "text-primary" : "text-muted-foreground"}`} />
                  </div>
                  <h3 className="font-display text-lg font-bold">{plan.name}</h3>
                </div>

                <p className="text-xs font-body text-muted-foreground leading-relaxed mb-5 min-h-[2.5rem]">
                  {TIER_TAGLINES[plan.key]}
                </p>

                <div className="mb-5 pb-5 border-b border-border/40">
                  {isOnDemand ? (
                    <div>
                      <span className="font-display text-4xl font-bold">Custom</span>
                      <p className="text-xs text-muted-foreground font-body mt-1">On-demand pricing via consultation</p>
                    </div>
                  ) : (
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-display text-4xl font-bold">{plan.priceLabel}</span>
                      {plan.priceCentsMonthly > 0 ? (
                        <span className="text-sm text-muted-foreground font-body">/ month</span>
                      ) : (
                        <span className="text-sm text-muted-foreground font-body">forever</span>
                      )}
                    </div>
                  )}
                </div>

                {plan.monthlyTokens > 0 && (
                  <div className="flex items-center gap-1.5 mb-3 px-3 py-1.5 rounded-lg bg-primary/5 border border-primary/10">
                    <Coins className="h-3.5 w-3.5 text-primary" />
                    <span className="text-sm font-mono font-semibold text-primary">
                      {plan.monthlyTokens.toLocaleString()} tokens / month included
                    </span>
                  </div>
                )}


                {plan.discountPercent > 0 && (
                  <div className="mb-4 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-center">
                    <span className="text-sm font-body font-semibold text-accent-foreground">
                      {plan.discountPercent}% off all tools & entries
                    </span>
                  </div>
                )}

                <ul className="flex-1 space-y-2 mb-6">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm font-body text-muted-foreground">
                      <Check className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                {isOnDemand ? (
                  <div className="space-y-2">
                    {publicPaymentsOpen ? (
                      <Button
                        onClick={() => handleSubscribe(plan)}
                        className="w-full font-body font-semibold gap-2"
                        variant="outline"
                      >
                        <MessageSquare className="h-4 w-4" /> Request Access
                      </Button>
                    ) : launchState === "open" ? (
                      <Button variant="outline" disabled className="w-full font-body">
                        Purchases temporarily unavailable
                      </Button>
                    ) : (
                      <Button asChild variant="outline" className="w-full font-body">
                        <Link to={publicCta.to}>{publicCta.label}</Link>
                      </Button>
                    )}
                    {user && (
                      <Link to="/studio-portal">
                        <Button variant="ghost" className="w-full font-body text-sm gap-2 text-primary hover:text-primary">
                          <Building2 className="h-3.5 w-3.5" /> Studio Portal — Sponsorships & Ads
                        </Button>
                      </Link>
                    )}
                  </div>
                ) : isCurrent ? (
                  <Button variant="outline" disabled className="w-full font-body">Current Plan</Button>
                ) : plan.key === "free" && currentPlan !== "free" ? (
                  <Button variant="outline" disabled className="w-full font-body" title="Self-service billing changes are not available yet">
                    Contact support to change plan
                  </Button>
                ) : plan.key === "free" ? (
                  <Button variant="outline" disabled className="w-full font-body text-muted-foreground">Free Forever</Button>
                ) : !publicPaymentsOpen ? (
                  launchState === "open" ? (
                    <Button variant="outline" disabled className="w-full font-body">
                      Purchases temporarily unavailable
                    </Button>
                  ) : (
                    <Button asChild variant="outline" className="w-full font-body">
                      <Link to={publicCta.to}>{publicCta.label}</Link>
                    </Button>
                  )
                ) : (
                  <div className="space-y-2">
                    <Button
                      onClick={() => handleSubscribe(plan)}
                      className={`w-full font-body font-semibold ${
                        isHighlighted ? "bg-gold-gradient text-primary-foreground hover:opacity-90" : ""
                      }`}
                    >
                      {planMeetsRequirement(plan.key, currentPlan)
                        ? `Upgrade — ${plan.priceLabel}/mo`
                        : `Switch — ${plan.priceLabel}/mo`}
                    </Button>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Feature Comparison Matrix — 3 columns */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="mb-16">
          <div className="text-center mb-8">
            <h2 className="font-display text-2xl font-bold mb-2">Feature <span className="text-gradient-gold">Comparison</span></h2>
            <p className="font-body text-sm text-muted-foreground">See exactly what's included in each plan</p>
          </div>

          <div className="rounded-2xl border border-border/50 bg-card/80 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/20">
                    <th className="text-left py-4 px-5 font-body text-xs text-muted-foreground uppercase tracking-wider min-w-[200px]">Feature</th>
                    {PLANS.map((p) => {
                      const Icon = tierIcons[p.key];
                      return (
                        <th key={p.key} className="text-center py-4 px-4 min-w-[120px]">
                          <div className="flex flex-col items-center gap-1.5">
                            <div className={`p-1.5 rounded-lg ${p.highlight ? "bg-primary/10" : "bg-muted/50"}`}>
                              <Icon className={`h-4 w-4 ${p.highlight ? "text-primary" : "text-muted-foreground"}`} />
                            </div>
                            <span className={`font-display text-xs font-bold ${p.highlight ? "text-primary" : "text-foreground"}`}>{p.name}</span>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Scripts", values: ["Unlimited", "Unlimited", "Unlimited"] },
                    { label: "Tool & Entry Discount", values: ["—", "10%", "Custom"] },
                    { label: "Qi-List Access", values: [true, true, true] },
                    { label: "Private Qi-List Visibility", values: [false, true, true] },
                    { label: "Screenplay Viewer", values: [false, true, true] },
                    { label: "AI Score", values: [true, true, true], cost: [15, 14, "—"] },
                    { label: "AI Review", values: [true, true, true], cost: [15, 14, "—"] },
                    { label: "Beat Board", values: [false, true, true], cost: [null, 14, "—"] },
                    { label: "AI Rewrite", values: [false, true, true], cost: [null, 3, "—"] },
                    { label: "Deep Analysis", values: [false, true, true], cost: [null, 18, "—"] },
                    { label: "Scene Analysis", values: [false, true, true], cost: [null, 5, "—"] },
                    { label: "Dialogue Generation", values: [false, true, true], cost: [null, 3, "—"] },
                    { label: "Writing Stats", values: [false, true, true], cost: [null, 9, "—"] },
                    { label: "Voice Drift Detection", values: [false, true, true] },
                    { label: "Script Compare", values: [false, true, true], cost: [null, 18, "—"] },
                    { label: "Logline Generator", values: [false, true, true], cost: [null, 5, "—"] },
                    { label: "Evidence Artifacts", values: [false, true, true] },
                    { label: "Batch Processing", values: [false, false, "Maintenance hold"] },
                    { label: "Sponsorship & Ad Bidding", values: [false, false, true] },
                    { label: "Festival Submissions", values: [false, false, true] },
                    { label: "Private Competitions", values: [false, false, true] },
                    { label: "API Access", values: [false, false, true] },
                    { label: "Team Seats", values: ["—", "—", "Custom"] },
                  ].map((row, idx) => (
                    <tr key={row.label} className={`border-b border-border/20 ${idx % 2 === 0 ? "" : "bg-muted/5"}`}>
                      <td className="py-3 px-5 font-body text-sm text-foreground">{row.label}</td>
                      {row.values.map((val, i) => (
                        <td key={i} className="py-3 px-4 text-center">
                          {typeof val === "boolean" ? (
                            val ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <Check className="h-4 w-4 text-primary mx-auto" />
                                {row.cost && row.cost[i] !== null && (
                                  <span className="text-[10px] font-mono text-muted-foreground">{row.cost[i]} {typeof row.cost[i] === "number" ? "⊘" : ""}</span>
                                )}
                              </div>
                            ) : (
                              <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />
                            )
                          ) : (
                            <span className={`text-xs font-mono ${val === "—" ? "text-muted-foreground/40" : "text-foreground font-semibold"}`}>{val}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>

        {/* How Tokens Work */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }} className="mb-16">
          <div className="text-center mb-8">
            <h2 className="font-display text-2xl font-bold mb-2">How Tokens <span className="text-gradient-gold">Work</span></h2>
            <p className="font-body text-sm text-muted-foreground max-w-2xl mx-auto">
              Tokens (⊘) are the universal creative currency of CanIScreenwrite. Understand how they're valued and why they're powerful.
            </p>
          </div>

          <div className="max-w-4xl mx-auto space-y-3 mb-10">
            {[
              { q: "What are tokens?", a: "Tokens (⊘) are CanIScreenwrite's universal creative currency. Every AI-powered tool, competition entry, and analysis costs a specific number of tokens — giving you full control over what you spend and when. No hidden fees, no surprise charges." },
              { q: "How are token costs set?", a: "Token costs are calibrated to the computational weight and creative value of each action. A 3-token AI rewrite reflects a quick generation; a 100-token feature entry reflects deep multi-pass AI judging across 7 quotients with variance analysis. Every cost is transparent and listed in the reference table below." },
              { q: "Why is this useful for writers?", a: "Tokens let you choose which priced actions to use. Pro subscribers receive a 10% discount on token-priced actions, and purchased tokens do not expire." },
              { q: "What's the return on every token?", a: "Every token spent produces tangible creative output: AI scores with actionable feedback, rewritten scenes, beat boards, voice drift detection, market analysis, and more. Your investment directly improves your screenplay and your competitive standing in festivals." },
            ].map((item) => (
              <details key={item.q} className="group rounded-xl border border-border/50 bg-card/80 overflow-hidden">
                <summary className="flex items-center justify-between cursor-pointer px-5 py-4 font-display text-sm font-semibold text-foreground hover:text-primary transition-colors list-none [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="px-5 pb-4 text-sm font-body text-muted-foreground leading-relaxed">{item.a}</div>
              </details>
            ))}
          </div>

          {/* Token Cost Reference Table */}
          <div className="max-w-4xl mx-auto rounded-2xl border border-border/50 bg-card/80 overflow-hidden">
            <div className="px-5 py-4 border-b border-border/30">
              <h3 className="font-display text-sm font-bold">Token Cost Reference</h3>
              <p className="text-xs text-muted-foreground font-body mt-0.5">Base cost per action, with plan discounts applied</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/30 bg-muted/10">
                    <th className="text-left py-3 px-5 font-body text-xs text-muted-foreground uppercase tracking-wider">Action</th>
                    <th className="text-center py-3 px-4 font-body text-xs text-muted-foreground uppercase tracking-wider">Base</th>
                    {PLANS.filter((p) => p.discountPercent > 0).map((p) => (
                      <th key={p.key} className="text-center py-3 px-4 font-body text-xs text-muted-foreground uppercase tracking-wider">
                        {p.name} ({p.discountPercent}% off)
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(TOKEN_COSTS).map(([key, cost], idx) => (
                    <tr key={key} className={`border-b border-border/10 ${idx % 2 === 0 ? "" : "bg-muted/5"}`}>
                      <td className="py-2.5 px-5 font-body text-sm text-foreground">{TOKEN_ACTION_LABELS[key as TokenAction]}</td>
                      <td className="py-2.5 px-4 text-center font-mono text-sm text-foreground">{cost} ⊘</td>
                      {PLANS.filter((p) => p.discountPercent > 0).map((p) => (
                        <td key={p.key} className="py-2.5 px-4 text-center font-mono text-sm text-primary">
                          {Math.ceil(cost * (1 - p.discountPercent / 100))} ⊘
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>

        {/* Token Top-ups */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="mb-16">
          <div className="text-center mb-8">
            <h2 className="font-display text-2xl font-bold mb-2">
              {publicPaymentsOpen ? "Token " : "Plan your "}
              <span className="text-gradient-gold">{publicPaymentsOpen ? "Top-ups" : "token usage"}</span>
            </h2>
            <p className="font-body text-sm text-muted-foreground max-w-xl mx-auto">
              {publicPaymentsOpen
                ? "Buy on any plan at the published flat token rate. Tokens never expire."
                : "Preview bundle sizes and estimated usage. Checkout will appear when purchases open."}
            </p>
          </div>

          <TokenBundleEstimator
            onBuyBundle={publicPaymentsOpen ? handleBuyBundle : undefined}
            loadingBundle={loadingBundle}
          />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">

            {TOKEN_BUNDLES.map((bundle) => {
              const perTokenCents = bundle.priceCents / bundle.tokens;
              const perToken = (perTokenCents / 100).toFixed(3);
              const usageScenarios: Record<string, string> = {
                Starter: "1 Feature entry, or 6 AI reviews",
                Creator: "3 Feature entries, or 20 AI reviews",
                Pro: "5 Feature entries, or 33 AI reviews",
                Studio: "10 Feature entries, or 66 AI reviews",
              };
              const isLoading = loadingBundle === bundle.id;
              return (
                <button
                  key={bundle.name}
                  onClick={() => handleBuyBundle(bundle.id)}
                  disabled={!!loadingBundle || !user || !publicPaymentsOpen}
                  className={`group relative rounded-xl border border-border/60 bg-card/80 p-5 text-left transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 ${
                    loadingBundle && !isLoading ? "opacity-50" : ""
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Coins className="h-4 w-4 text-primary" />
                      <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{bundle.name}</span>
                    </div>
                  </div>
                  <p className="font-display text-2xl font-bold leading-tight">{bundle.tokens.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground mb-3">tokens</p>
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="font-display text-lg font-bold text-primary">
                      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : bundle.label}
                    </span>
                  </div>
                  <p className="text-[10px] font-mono text-muted-foreground">${perToken} / token</p>
                  <p className="mt-3 text-[10px] font-body text-muted-foreground leading-snug border-t border-border/40 pt-3">
                    {usageScenarios[bundle.name]}
                  </p>
                </button>
              );
            })}
          </div>

          <p className="text-center text-xs text-muted-foreground font-body mt-5">
            {publicPaymentsOpen
              ? "Secure checkout via Stripe · Tokens credited instantly · No expiration"
              : launchState === "open"
                ? "Purchases are temporarily unavailable."
                : `${publicCta.label} before purchasing tokens.`}
          </p>
        </motion.div>

        {/* FAQ */}
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }} className="mb-16">
          <div className="text-center mb-8">
            <h2 className="font-display text-2xl font-bold mb-2">Frequently Asked <span className="text-gradient-gold">Questions</span></h2>
            <p className="font-body text-sm text-muted-foreground">Everything you need to know before you commit.</p>
          </div>

          <div className="max-w-3xl mx-auto space-y-3">
            {[
              { q: "Do tokens expire?", a: "No. Purchased tokens never expire. Monthly Pro allowances reset each billing cycle and don't roll over, but anything you've topped up is yours to keep." },
              { q: "Can I cancel Pro at any time?", a: "Yes. Cancel anytime from your account — you keep Pro benefits through the end of your billing period, then drop to Free. No cancellation fees." },
              { q: "What happens if I run out of tokens mid-action?", a: "The action stops before charging. You'll see a clear prompt with the exact top-up needed. No partial charges, no surprise overage fees." },
              { q: "How is Studio different from Pro?", a: "Studio is for organizations running screenplays at scale: batch processing, custom token rates, festival/competition hosting, sponsorship & ad bidding, API access, and team seats. Pricing is custom and quoted after a short consultation." },
              { q: "Is my screenplay private?", a: "Yes. Every submission is private by default. You explicitly choose what to share publicly via Qi-List visibility settings. Evidence bundles and provenance lineage are tied to your account only." },
              { q: "Do you offer refunds?", a: "Token purchases are non-refundable once credited. Subscription charges are pro-rated where required by law. Reach out to support if there's an issue with your purchase." },
            ].map((item) => (
              <details key={item.q} className="group rounded-xl border border-border/50 bg-card/80 overflow-hidden">
                <summary className="flex items-center justify-between cursor-pointer px-5 py-4 font-display text-sm font-semibold text-foreground hover:text-primary transition-colors list-none [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="px-5 pb-4 text-sm font-body text-muted-foreground leading-relaxed">{item.a}</div>
              </details>
            ))}
          </div>
        </motion.div>


        {!user && (
          <div className="text-center mt-12">
            <p className="text-sm text-muted-foreground font-body mb-3">
              {publicPaymentsOpen ? "Sign in to subscribe or purchase tokens" : "Access is not publicly open yet"}
            </p>
            <Button asChild variant="outline" className="font-body">
              <Link to={publicPaymentsOpen ? "/auth" : publicCta.to}>
                {publicPaymentsOpen ? "Sign In" : publicCta.label}
              </Link>
            </Button>
          </div>
        )}
      </div>

      <StudioInquiryModal open={studioModalOpen} onClose={() => setStudioModalOpen(false)} />
    </div>
  );
}
