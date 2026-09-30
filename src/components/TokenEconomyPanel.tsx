import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Coins, TrendingUp, TrendingDown, DollarSign, Users, Tag } from "lucide-react";
import { Section, SectionLabel, SectionTitle } from "@/components/Section";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { getAvgTokenPrice, TOKEN_BUNDLES } from "@/lib/wallet";

interface TokenStats {
  totalCirculating: number;
  totalSpent: number;
  totalEarned: number;
  activeWallets: number;
  avgBalance: number;
  topSpenders: { label: string; pct: number }[];
  spendByLabel: { label: string; pct: number }[];
  realAICostCents: number;
  aiInvocations: number;
}

export default function TokenEconomyPanel() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<TokenStats | null>(null);

  useEffect(() => {
    async function fetchTokenStats() {
      setLoading(true);

      const [
        { data: wallets },
        { data: transactions },
        { data: aiUsage },
        { data: judgeUsage },
      ] = await Promise.all([
        supabase.from("token_wallets").select("user_id, balance"),
        supabase.from("wallet_transactions").select("user_id, amount, label, source"),
        supabase.from("ai_usage_log").select("estimated_cost_cents"),
        supabase.from("judge_usage_log").select("estimated_cost_cents"),
      ]);

      const allWallets = wallets || [];
      const allTxns = transactions || [];

      const totalCirculating = allWallets.reduce((s, w) => s + w.balance, 0);
      const activeWallets = allWallets.filter((w) => w.balance > 0).length;
      const avgBalance = allWallets.length > 0 ? Math.round(totalCirculating / allWallets.length) : 0;

      const totalSpent = allTxns.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
      const totalEarned = allTxns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);

      // Real AI cost from usage logs
      const aiCosts = (aiUsage || []).reduce((s, r) => s + (r.estimated_cost_cents || 0), 0);
      const judgeCosts = (judgeUsage || []).reduce((s, r) => s + (r.estimated_cost_cents || 0), 0);
      const realAICostCents = aiCosts + judgeCosts;
      const aiInvocations = (aiUsage || []).length + (judgeUsage || []).length;

      // Spend by label
      const spendLabels: Record<string, number> = {};
      allTxns.filter((t) => t.amount < 0).forEach((t) => {
        spendLabels[t.label] = (spendLabels[t.label] || 0) + Math.abs(t.amount);
      });
      const maxSpend = Math.max(...Object.values(spendLabels), 1);
      const spendByLabel = Object.entries(spendLabels)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 7)
        .map(([label, val]) => ({ label, pct: Math.round((val / maxSpend) * 100) }));

      // Top spenders
      const userSpend: Record<string, number> = {};
      allTxns.filter((t) => t.amount < 0).forEach((t) => {
        userSpend[t.user_id] = (userSpend[t.user_id] || 0) + Math.abs(t.amount);
      });
      const topSpendMax = Math.max(...Object.values(userSpend), 1);
      const topSpenders = Object.entries(userSpend)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id, val]) => ({ label: id.slice(0, 8) + "…", pct: Math.round((val / topSpendMax) * 100) }));

      setStats({ totalCirculating, totalSpent, totalEarned, activeWallets, avgBalance, topSpenders, spendByLabel, realAICostCents, aiInvocations });
      setLoading(false);
    }

    fetchTokenStats();
  }, []);

  const fadeUp = {
    hidden: { opacity: 0, y: 20 },
    visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.08, duration: 0.5 } }),
  };

  const avgTokenPrice = getAvgTokenPrice();
  const realCostPerToken = stats && stats.totalSpent > 0 ? stats.realAICostCents / 100 / stats.totalSpent : 0;
  const grossMargin = avgTokenPrice > 0 ? ((avgTokenPrice - realCostPerToken) / avgTokenPrice * 100) : 0;

  return (
    <Section>
      <SectionLabel>Token Economy</SectionLabel>
      <SectionTitle>Platform P&L</SectionTitle>

      <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Coins, label: "Circulating Supply", val: stats?.totalCirculating, sub: "tokens in wallets" },
          { icon: TrendingUp, label: "Total Earned", val: stats?.totalEarned, sub: "tokens credited" },
          { icon: TrendingDown, label: "Total Spent", val: stats?.totalSpent, sub: "tokens consumed" },
          { icon: Users, label: "Active Wallets", val: stats?.activeWallets, sub: `avg ${stats?.avgBalance ?? 0} tokens` },
        ].map((card, i) => (
          <motion.div key={card.label} custom={i} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}
            className="p-6 rounded-xl border border-border/50 bg-card/80">
            <div className="flex items-center gap-3 mb-3">
              <card.icon className="h-5 w-5 text-primary" />
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{card.label}</span>
            </div>
            {loading ? (
              <>
                <Skeleton className="h-8 w-20 mb-1" />
                <Skeleton className="h-3 w-28" />
              </>
            ) : (
              <>
                <p className="font-display text-3xl font-bold">{(card.val ?? 0).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
              </>
            )}
          </motion.div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BarChart title="Spend by Action" bars={stats?.spendByLabel || []} loading={loading} />
        <BarChart title="Top Spenders (by user)" bars={stats?.topSpenders || []} loading={loading} />
      </div>

      {/* Revenue Metrics — real data */}
      {stats && !loading && (
        <div className="mt-6 p-6 rounded-xl border border-border/50 bg-card/80">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-4 w-4 text-primary" />
            <h4 className="font-body text-sm font-semibold">Revenue Metrics</h4>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-center">
            <div>
              <p className="font-display text-2xl font-bold">
                {stats.totalEarned > 0 ? (stats.totalSpent / stats.totalEarned * 100).toFixed(0) : 0}%
              </p>
              <p className="text-xs text-muted-foreground">Burn Rate</p>
            </div>
            <div>
              <p className="font-display text-2xl font-bold">
                {stats.activeWallets > 0 ? Math.round(stats.totalSpent / stats.activeWallets) : 0}
              </p>
              <p className="text-xs text-muted-foreground">Avg Spend / User</p>
            </div>
            <div>
              <p className="font-display text-2xl font-bold">
                ${(stats.realAICostCents / 100).toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground">Actual AI Cost</p>
            </div>
            <div>
              <p className="font-display text-2xl font-bold">
                ${realCostPerToken.toFixed(4)}
              </p>
              <p className="text-xs text-muted-foreground">Cost/Token (Real)</p>
            </div>
            <div>
              <p className="font-display text-2xl font-bold">
                ${avgTokenPrice.toFixed(4)}
              </p>
              <p className="text-xs text-muted-foreground">Avg Token Value</p>
            </div>
            <div>
              <p className={`font-display text-2xl font-bold ${grossMargin > 0 ? "text-green-500" : "text-destructive"}`}>
                {grossMargin.toFixed(1)}%
              </p>
              <p className="text-xs text-muted-foreground">Gross Margin</p>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-3 text-right">
            Based on {stats.aiInvocations.toLocaleString()} AI invocations · Market cap est. ${(stats.totalCirculating * avgTokenPrice).toFixed(2)}
          </p>
        </div>
      )}

      {/* Token Valuation — bundle pricing */}
      {!loading && (
        <div className="mt-6 p-6 rounded-xl border border-border/50 bg-card/80">
          <div className="flex items-center gap-2 mb-3">
            <Tag className="h-4 w-4 text-primary" />
            <h4 className="font-body text-sm font-semibold">Token Valuation — Bundle Pricing</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-border/40">
                  <th className="text-left py-2 pr-4 font-mono uppercase tracking-wider">Tier</th>
                  <th className="text-right py-2 px-4 font-mono uppercase tracking-wider">Tokens</th>
                  <th className="text-right py-2 px-4 font-mono uppercase tracking-wider">Price</th>
                  <th className="text-right py-2 pl-4 font-mono uppercase tracking-wider">$/Token</th>
                </tr>
              </thead>
              <tbody>
                {TOKEN_BUNDLES.map((b) => (
                  <tr key={b.name} className="border-b border-border/20">
                    <td className="py-2 pr-4 font-semibold">{b.name}</td>
                    <td className="py-2 px-4 text-right font-mono">{b.tokens.toLocaleString()}</td>
                    <td className="py-2 px-4 text-right font-mono">{b.label}</td>
                    <td className="py-2 pl-4 text-right font-mono text-primary">${(b.priceCents / b.tokens / 100).toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="py-2 pr-4">Weighted Avg</td>
                  <td className="py-2 px-4 text-right font-mono">—</td>
                  <td className="py-2 px-4 text-right font-mono">—</td>
                  <td className="py-2 pl-4 text-right font-mono text-primary">${avgTokenPrice.toFixed(4)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </Section>
  );
}

function BarChart({ title, bars, loading }: { title: string; bars: { label: string; pct: number }[]; loading?: boolean }) {
  return (
    <div className="p-6 rounded-xl border border-border/50 bg-card/80">
      <h4 className="font-body text-sm font-semibold mb-4">{title}</h4>
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i}>
              <div className="flex justify-between mb-1"><Skeleton className="h-3 w-16" /><Skeleton className="h-3 w-8" /></div>
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          ))}
        </div>
      ) : bars.length === 0 ? (
        <p className="text-sm text-muted-foreground">No data available yet.</p>
      ) : (
        <div className="space-y-3">
          {bars.map((bar, i) => (
            <div key={i}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">{bar.label}</span>
                <span className="font-mono text-primary">{bar.pct}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  whileInView={{ width: `${bar.pct}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.8, delay: i * 0.1 }}
                  className="h-full bg-gold-gradient rounded-full"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
