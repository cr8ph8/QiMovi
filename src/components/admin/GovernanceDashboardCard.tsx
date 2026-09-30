import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Shield, ShieldOff, ShieldAlert, BarChart3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface PolicyFlag {
  key: string;
  label: string;
  active: boolean;
}

interface SensitivityBucket {
  label: string;
  count: number;
}

export default function GovernanceDashboardCard() {
  const [loading, setLoading] = useState(true);
  const [policies, setPolicies] = useState<PolicyFlag[]>([]);
  const [recentBlocked, setRecentBlocked] = useState(0);
  const [sensitivities, setSensitivities] = useState<SensitivityBucket[]>([]);

  useEffect(() => {
    async function load() {
      const [{ data: settings }, { count: blockedCount }, { data: entries }] = await Promise.all([
        supabase.from("site_settings").select("key, value").in("key", [
          "block_ai_confidential", "block_ai_nda_protected", "block_ai_embargoed",
        ]),
        supabase
          .from("ai_usage_log")
          .select("*", { count: "exact", head: true })
          .eq("routing_reason", "policy_blocked")
          .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
        supabase.from("entries").select("sensitivity"),
      ]);

      const labels: Record<string, string> = {
        block_ai_confidential: "Confidential",
        block_ai_nda_protected: "NDA Protected",
        block_ai_embargoed: "Embargoed",
      };
      const flags = ["block_ai_confidential", "block_ai_nda_protected", "block_ai_embargoed"].map((key) => {
        const row = (settings || []).find((s: any) => s.key === key);
        return { key, label: labels[key], active: row?.value === true };
      });
      setPolicies(flags);
      setRecentBlocked(blockedCount ?? 0);

      // Sensitivity distribution
      const counts: Record<string, number> = {};
      (entries || []).forEach((e: any) => {
        const s = e.sensitivity || "standard";
        counts[s] = (counts[s] || 0) + 1;
      });
      setSensitivities(
        Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([label, count]) => ({ label, count }))
      );
      setLoading(false);
    }
    load();
  }, []);

  const activeCount = policies.filter((p) => p.active).length;
  const totalEntries = sensitivities.reduce((sum, s) => sum + s.count, 0) || 1;

  if (loading) {
    return (
      <div className="p-6 rounded-xl border border-border/50 bg-card/80">
        <Skeleton className="h-5 w-40 mb-4" />
        <div className="space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 rounded-xl border border-border/50 bg-card/80">
      <div className="flex items-center gap-2 mb-4">
        <Shield className="h-4 w-4 text-primary" />
        <h4 className="font-body text-sm font-semibold">Governance Overview</h4>
      </div>

      {/* Active Policy Blocks */}
      <div className="mb-4">
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">Policy Blocks</p>
        <div className="flex flex-wrap gap-2">
          {policies.map((p) => (
            <Badge
              key={p.key}
              variant="outline"
              className={`text-[10px] font-mono ${
                p.active
                  ? "bg-red-500/10 text-red-400 border-red-500/30"
                  : "bg-muted/50 text-muted-foreground border-border/30"
              }`}
            >
              {p.active ? <ShieldAlert className="h-2.5 w-2.5 mr-1" /> : <ShieldOff className="h-2.5 w-2.5 mr-1 opacity-40" />}
              {p.label}: {p.active ? "BLOCKED" : "Open"}
            </Badge>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">
          {activeCount === 0
            ? "No AI blocking policies active"
            : `${activeCount} active block${activeCount > 1 ? "s" : ""}`}
        </p>
      </div>

      {/* Recent Blocked Requests */}
      <div className="flex items-center justify-between py-3 border-t border-border/20">
        <div>
          <p className="text-xs font-mono text-muted-foreground">Blocked Requests (7d)</p>
        </div>
        <span className={`font-display text-lg font-bold ${recentBlocked > 0 ? "text-red-400" : "text-muted-foreground"}`}>
          {recentBlocked}
        </span>
      </div>

      {/* Sensitivity Distribution */}
      <div className="pt-3 border-t border-border/20">
        <div className="flex items-center gap-1.5 mb-2">
          <BarChart3 className="h-3 w-3 text-muted-foreground" />
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Sensitivity Distribution</p>
        </div>
        <div className="space-y-2">
          {sensitivities.map((s) => {
            const pct = Math.round((s.count / totalEntries) * 100);
            return (
              <div key={s.label}>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-muted-foreground capitalize">{s.label.replace(/_/g, " ")}</span>
                  <span className="font-mono text-foreground">{s.count} ({pct}%)</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      s.label === "standard" ? "bg-primary/60" :
                      s.label === "confidential" ? "bg-amber-500/70" :
                      s.label === "nda_protected" ? "bg-violet-500/70" :
                      s.label === "embargoed" ? "bg-red-500/70" :
                      "bg-muted-foreground/40"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
