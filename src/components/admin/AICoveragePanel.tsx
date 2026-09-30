import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TOKEN_ACTION_METADATA } from "@/lib/wallet";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, AlertTriangle, EyeOff, Loader2, Radar } from "lucide-react";

/**
 * AICoveragePanel — registry-vs-log drift.
 *
 * Compares the AI features declared in `TOKEN_ACTION_METADATA` (and the
 * known router-governed edge functions that aren't token-bound) against
 * the distinct `function_name`s observed in `ai_usage_log` over the last
 * 30 days. Surfaces three classes of drift:
 *
 *   ✅ COVERED      — registered + recently logged
 *   ⚠ STALE        — registered but no recent log entries
 *   ❗ UNREGISTERED — logged via router but missing from the registry
 *                     (likely a new function that needs metadata)
 */

// Functions that legitimately route through ai-router.ts but aren't
// user-facing token actions (so they don't appear in TOKEN_ACTION_METADATA).
const NON_TOKEN_GOVERNED = new Set<string>([
  "organize-brain-dump",
  "outline-from-beats",
  "parse-screenplay",
  "seed-filmstack",
  "auto-audit",
  "model-health-check",
  "ai-analyze-reports",
  "voice-drift",
  "suggest-metadata",
  "legal-summary",
  "generate-title",
  "generate-logline",
  "generate-artifact",
]);

interface UsageRow {
  function_name: string;
  created_at: string;
}

type Status = "covered" | "stale" | "unregistered";

interface Row {
  fn: string;
  status: Status;
  calls30d: number;
  lastUsed: string | null;
  registered: boolean;
  source: "token_action" | "non_token" | "log_only";
  registryKeys: string[];
}

const STATUS_META: Record<Status, { label: string; tone: string; icon: typeof ShieldCheck }> = {
  covered: { label: "Covered", tone: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: ShieldCheck },
  stale: { label: "Stale (30d)", tone: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: EyeOff },
  unregistered: { label: "Unregistered", tone: "bg-destructive/15 text-destructive border-destructive/30", icon: AlertTriangle },
};

export default function AICoveragePanel() {
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState<UsageRow[]>([]);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const { data } = await supabase
        .from("ai_usage_log")
        .select("function_name, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1000);
      setUsage((data as UsageRow[]) || []);
      setLoading(false);
    })();
  }, []);

  const rows: Row[] = useMemo(() => {
    // Aggregate logs by function_name.
    const logMap = new Map<string, { calls: number; last: string }>();
    for (const r of usage) {
      const cur = logMap.get(r.function_name);
      if (!cur) logMap.set(r.function_name, { calls: 1, last: r.created_at });
      else {
        cur.calls++;
        if (r.created_at > cur.last) cur.last = r.created_at;
      }
    }

    // Build registry: edge function -> metadata keys.
    const registryByFn = new Map<string, string[]>();
    for (const [key, meta] of Object.entries(TOKEN_ACTION_METADATA)) {
      if (!meta.usesAI || !meta.edgeFunction) continue;
      const arr = registryByFn.get(meta.edgeFunction) || [];
      arr.push(key);
      registryByFn.set(meta.edgeFunction, arr);
    }

    const out: Row[] = [];
    const seen = new Set<string>();

    // Token-action registered functions.
    for (const [fn, keys] of registryByFn) {
      seen.add(fn);
      const log = logMap.get(fn);
      out.push({
        fn,
        status: log ? "covered" : "stale",
        calls30d: log?.calls || 0,
        lastUsed: log?.last || null,
        registered: true,
        source: "token_action",
        registryKeys: keys,
      });
    }

    // Non-token but governed.
    for (const fn of NON_TOKEN_GOVERNED) {
      if (seen.has(fn)) continue;
      seen.add(fn);
      const log = logMap.get(fn);
      out.push({
        fn,
        status: log ? "covered" : "stale",
        calls30d: log?.calls || 0,
        lastUsed: log?.last || null,
        registered: true,
        source: "non_token",
        registryKeys: [],
      });
    }

    // Logged but missing from any registry.
    for (const [fn, log] of logMap) {
      if (seen.has(fn)) continue;
      out.push({
        fn,
        status: "unregistered",
        calls30d: log.calls,
        lastUsed: log.last,
        registered: false,
        source: "log_only",
        registryKeys: [],
      });
    }

    return out.sort((a, b) => {
      const order: Record<Status, number> = { unregistered: 0, stale: 1, covered: 2 };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return b.calls30d - a.calls30d;
    });
  }, [usage]);

  const counts = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc[r.status]++;
        return acc;
      },
      { covered: 0, stale: 0, unregistered: 0 } as Record<Status, number>,
    );
  }, [rows]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Radar className="h-4 w-4 text-primary" /> AI Coverage — Registry vs Log Drift
        </CardTitle>
        <CardDescription className="text-xs">
          Cross-checks declared AI features against <code>ai_usage_log</code> over the last 30 days. Unregistered rows
          indicate a router call from a function missing from <code>TOKEN_ACTION_METADATA</code> or the governed
          allowlist.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading coverage…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {(["covered", "stale", "unregistered"] as Status[]).map((s) => {
                const Icon = STATUS_META[s].icon;
                return (
                  <div key={s} className={`rounded-md border px-3 py-2 ${STATUS_META[s].tone}`}>
                    <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
                      <Icon className="h-3.5 w-3.5" />
                      {STATUS_META[s].label}
                    </div>
                    <div className="text-2xl font-semibold tabular-nums mt-1">{counts[s]}</div>
                  </div>
                );
              })}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 pr-3 font-medium">Function</th>
                    <th className="text-left py-2 pr-3 font-medium">Status</th>
                    <th className="text-left py-2 pr-3 font-medium">Source</th>
                    <th className="text-right py-2 pr-3 font-medium">Calls (30d)</th>
                    <th className="text-left py-2 pr-3 font-medium">Last used</th>
                    <th className="text-left py-2 font-medium">Registry keys</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.fn} className="border-b border-border/40">
                      <td className="py-2 pr-3 font-mono">{r.fn}</td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className={STATUS_META[r.status].tone}>
                          {STATUS_META[r.status].label}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {r.source === "token_action" ? "Token action" : r.source === "non_token" ? "Governed (no token)" : "Log only"}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.calls30d}</td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {r.lastUsed ? new Date(r.lastUsed).toLocaleString() : "—"}
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {r.registryKeys.length ? r.registryKeys.join(", ") : "—"}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-muted-foreground">
                        No AI activity logged in the last 30 days.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
