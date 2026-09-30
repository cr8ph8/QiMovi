import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Calculator, Coins, Sparkles, ArrowRight } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { TOKEN_BUNDLES, TOKEN_COSTS, LENGTH_CATEGORIES } from "@/lib/wallet";

interface Props {
  onBuyBundle?: (bundleId: string) => void;
  loadingBundle?: string | null;
}

type CategoryKey = (typeof LENGTH_CATEGORIES)[number]["key"];

const REVIEW_COST = TOKEN_COSTS.ai_review;     // 15
const REWRITE_COST = TOKEN_COSTS.rewrite_standard; // 3
const BASE_RATE_CENTS = 10; // flat $0.10/token

export function TokenBundleEstimator({ onBuyBundle, loadingBundle }: Props) {
  const [category, setCategory] = useState<CategoryKey>("short");
  const [entries, setEntries] = useState(2);
  const [reviews, setReviews] = useState(4);
  const [rewrites, setRewrites] = useState(10);

  const selectedCat = LENGTH_CATEGORIES.find((c) => c.key === category)!;

  const breakdown = useMemo(() => {
    const entryTokens = entries * selectedCat.cost;
    const reviewTokens = reviews * REVIEW_COST;
    const rewriteTokens = rewrites * REWRITE_COST;
    const total = entryTokens + reviewTokens + rewriteTokens;
    return { entryTokens, reviewTokens, rewriteTokens, total };
  }, [entries, reviews, rewrites, selectedCat]);

  // Recommend the smallest single bundle that covers the total. If no
  // single bundle covers it, recommend the largest (Studio) — user can buy
  // multiples.
  const recommendation = useMemo(() => {
    const sorted = [...TOKEN_BUNDLES].sort((a, b) => a.tokens - b.tokens);
    const covering = sorted.find((b) => b.tokens >= breakdown.total);
    if (covering) {
      const overage = covering.tokens - breakdown.total;
      return {
        bundle: covering,
        quantity: 1,
        totalCents: covering.priceCents,
        overage,
      };
    }
    const largest = sorted[sorted.length - 1];
    const qty = Math.ceil(breakdown.total / largest.tokens);
    const totalCents = largest.priceCents * qty;
    return {
      bundle: largest,
      quantity: qty,
      totalCents,
      overage: largest.tokens * qty - breakdown.total,
    };
  }, [breakdown.total]);

  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  return (
    <div className="max-w-4xl mx-auto mb-10 rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/[0.04] to-card overflow-hidden">
      <div className="px-6 py-4 border-b border-border/40 flex items-center gap-2.5">
        <div className="p-1.5 rounded-lg bg-primary/10">
          <Calculator className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h3 className="font-display text-base font-bold">Bundle Estimator</h3>
          <p className="text-xs font-body text-muted-foreground">
            Estimate your monthly usage and see the bundle that fits best.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-0">
        {/* Inputs */}
        <div className="lg:col-span-3 p-6 space-y-6 border-b lg:border-b-0 lg:border-r border-border/40">
          {/* Category */}
          <div>
            <label className="text-xs font-body text-muted-foreground uppercase tracking-wider mb-2 block">
              Submission category
            </label>
            <div className="flex flex-wrap gap-1.5">
              {LENGTH_CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setCategory(c.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-body transition-all ${
                    category === c.key
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                  }`}
                >
                  {c.label}
                  <span className="ml-1.5 font-mono opacity-70">{c.cost}⊘</span>
                </button>
              ))}
            </div>
          </div>

          {/* Sliders */}
          <SliderRow
            label="Competition entries / month"
            value={entries}
            max={20}
            unitLabel={`× ${selectedCat.cost}⊘`}
            onChange={setEntries}
          />
          <SliderRow
            label="AI reviews / month"
            value={reviews}
            max={30}
            unitLabel={`× ${REVIEW_COST}⊘`}
            onChange={setReviews}
          />
          <SliderRow
            label="AI rewrites / month"
            value={rewrites}
            max={60}
            unitLabel={`× ${REWRITE_COST}⊘`}
            onChange={setRewrites}
          />
        </div>

        {/* Result */}
        <div className="lg:col-span-2 p-6 bg-card/50 flex flex-col">
          <div className="space-y-2 mb-4">
            <BreakdownLine label="Entries" tokens={breakdown.entryTokens} />
            <BreakdownLine label="Reviews" tokens={breakdown.reviewTokens} />
            <BreakdownLine label="Rewrites" tokens={breakdown.rewriteTokens} />
            <div className="pt-2 mt-2 border-t border-border/40 flex justify-between items-baseline">
              <span className="text-xs font-body text-muted-foreground uppercase tracking-wider">
                Estimated total
              </span>
              <span className="font-display text-2xl font-bold text-foreground">
                {breakdown.total.toLocaleString()} <span className="text-sm font-mono text-primary">⊘</span>
              </span>
            </div>
            <p className="text-[10px] font-mono text-muted-foreground text-right">
              ≈ {dollars(breakdown.total * BASE_RATE_CENTS)} at base rate
            </p>
          </div>

          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 mt-auto">
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-[10px] font-mono text-primary uppercase tracking-wider font-semibold">
                Recommended
              </span>
            </div>
            <div className="flex items-baseline justify-between mb-1">
              <span className="font-display text-lg font-bold">
                {recommendation.quantity > 1 ? `${recommendation.quantity}× ` : ""}
                {recommendation.bundle.name}
              </span>
              <span className="font-display text-lg font-bold text-primary">
                {dollars(recommendation.totalCents)}
              </span>
            </div>
            <p className="text-[11px] font-body text-muted-foreground mb-3">
              {(recommendation.bundle.tokens * recommendation.quantity).toLocaleString()} tokens
              {recommendation.overage > 0 && (
                <> · {recommendation.overage.toLocaleString()} ⊘ leftover for next month</>
              )}
            </p>
            {onBuyBundle && (
              <Button
                size="sm"
                onClick={() => onBuyBundle(recommendation.bundle.id)}
                disabled={!!loadingBundle}
                className="w-full font-body font-semibold bg-gold-gradient text-primary-foreground hover:opacity-90 gap-1.5"
              >
                <Coins className="h-3.5 w-3.5" />
                Buy {recommendation.bundle.name}
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  max,
  unitLabel,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  unitLabel: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <label className="text-xs font-body text-muted-foreground">{label}</label>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-lg font-bold text-foreground tabular-nums">{value}</span>
          <span className="text-[10px] font-mono text-muted-foreground">{unitLabel}</span>
        </div>
      </div>
      <Slider value={[value]} min={0} max={max} step={1} onValueChange={(v) => onChange(v[0])} />
    </div>
  );
}

function BreakdownLine({ label, tokens }: { label: string; tokens: number }) {
  return (
    <div className="flex justify-between text-xs font-body">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground tabular-nums">
        {tokens.toLocaleString()} <span className="text-muted-foreground">⊘</span>
      </span>
    </div>
  );
}
