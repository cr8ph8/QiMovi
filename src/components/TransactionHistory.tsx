import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Coins, Filter, ArrowUpRight, ArrowDownLeft, Loader2 } from "lucide-react";

interface Transaction {
  id: string;
  amount: number;
  label: string;
  source: string;
  created_at: string;
}

const PAGE_SIZE = 50;

const SOURCE_COLORS: Record<string, string> = {
  system: "bg-muted text-muted-foreground",
  transfer: "bg-violet-500/10 text-violet-500",
  purchase: "bg-emerald-500/10 text-emerald-500",
  user: "bg-amber-500/10 text-amber-500",
  competition: "bg-blue-500/10 text-blue-500",
  bonus: "bg-primary/10 text-primary",
};

interface TransactionHistoryProps {
  entryId?: string;
  maxHeight?: string;
  showFilter?: boolean;
}

export default function TransactionHistory({ entryId, maxHeight = "400px", showFilter = true }: TransactionHistoryProps) {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [filter, setFilter] = useState("all");
  const [allSources, setAllSources] = useState<string[]>([]);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback(async (offset: number, append: boolean) => {
    if (!user) return;
    if (append) setLoadingMore(true); else setLoading(true);

    let query = supabase
      .from("wallet_transactions")
      .select("id, amount, label, source, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (filter !== "all") {
      query = query.eq("source", filter);
    }

    const { data } = await query;
    const rows = (data as Transaction[]) || [];

    if (append) {
      setTransactions((prev) => [...prev, ...rows]);
    } else {
      setTransactions(rows);
      // Collect all sources on first load (unfiltered)
      if (filter === "all") {
        setAllSources([...new Set(rows.map((t) => t.source))].sort());
      }
    }

    setHasMore(rows.length === PAGE_SIZE);
    if (append) setLoadingMore(false); else setLoading(false);
  }, [user, filter]);

  // Reset and load when filter changes
  useEffect(() => {
    setTransactions([]);
    setHasMore(true);
    fetchPage(0, false);
  }, [fetchPage]);

  // Also fetch all sources once on mount (unfiltered) so filter dropdown stays populated
  useEffect(() => {
    if (!user) return;
    supabase
      .from("wallet_transactions")
      .select("source")
      .eq("user_id", user.id)
      .limit(500)
      .then(({ data }) => {
        if (data) {
          setAllSources([...new Set((data as { source: string }[]).map((t) => t.source))].sort());
        }
      });
  }, [user]);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || loadingMore || loading) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !loadingMore) {
          fetchPage(transactions.length, true);
        }
      },
      { rootMargin: "100px" }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loading, transactions.length, fetchPage]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="text-center py-8">
        <Coins className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No transactions yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showFilter && allSources.length > 1 && (
        <div className="flex items-center gap-2 justify-end">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-32 h-7 text-xs bg-muted border-border">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {allSources.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <ScrollArea style={{ maxHeight }}>
        <div className="space-y-1">
          {transactions.map((tx, i) => {
            const isCredit = tx.amount > 0;
            const colorClass = SOURCE_COLORS[tx.source] || SOURCE_COLORS.system;
            return (
              <motion.div
                key={tx.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i, 20) * 0.02 }}
                className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/30 transition-colors"
              >
                <div className={`p-1.5 rounded-md ${isCredit ? "bg-emerald-500/10" : "bg-amber-500/10"}`}>
                  {isCredit ? (
                    <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <ArrowUpRight className="h-3.5 w-3.5 text-amber-500" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-body truncate">{tx.label}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">
                    {new Date(tx.created_at).toLocaleDateString()}{" "}
                    {new Date(tx.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className={`text-[10px] font-mono capitalize ${colorClass}`}>
                    {tx.source}
                  </Badge>
                  <span className={`text-sm font-mono font-semibold ${isCredit ? "text-emerald-500" : "text-amber-500"}`}>
                    {isCredit ? "+" : ""}{tx.amount}
                  </span>
                </div>
              </motion.div>
            );
          })}

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-1" />

          {loadingMore && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground ml-2">Loading more…</span>
            </div>
          )}
        </div>
      </ScrollArea>

      <p className="text-[10px] text-muted-foreground text-center font-mono">
        Showing {transactions.length} transactions{!hasMore ? " (all loaded)" : ""}
      </p>
    </div>
  );
}
