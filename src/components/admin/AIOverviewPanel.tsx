import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePlatform } from "@/contexts/PlatformContext";
import { Brain, FlaskConical, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { TOKEN_ACTION_METADATA } from "@/lib/wallet";
import { SummaryCards } from "./ai-overview/SummaryCards";
import { FeatureTable } from "./ai-overview/FeatureTable";
import { ModelBreakdown } from "./ai-overview/ModelBreakdown";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { AiUsageRow, JudgeUsageRow, UsageRow, FnStat } from "./ai-overview/types";
import { PAID_AI_SECURITY_HOLD } from "@/lib/securityMaintenance";

function buildLast7Days(): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

export default function AIOverviewPanel() {
  const { flags, toggleFlag } = usePlatform();
  const [loading, setLoading] = useState(true);
  const [aiUsage, setAiUsage] = useState<AiUsageRow[]>([]);
  const [judgeUsage, setJudgeUsage] = useState<JudgeUsageRow[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ model: string; pass: boolean; error?: string } | null>(null);

  const handleTestCostRoute = async () => {
    if (PAID_AI_SECURITY_HOLD) return;
    setTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-script", {
        body: { prompt: "A robot discovers it can dream.", category: "micro" },
      });
      if (error) throw error;
      const model = data?.model || "unknown";
      const pass = model.includes("flash-lite");
      setTestResult({ model, pass });
      toast(pass ? "Cost route verified — flash-lite used" : `Route used ${model} (not flash-lite)`);
    } catch (err: any) {
      setTestResult({ model: "error", pass: false, error: err.message || "Unknown error" });
      toast.error("Test failed: " + (err.message || "Unknown error"));
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    async function load() {
      const [aiRes, judgeRes] = await Promise.all([
        supabase.from("ai_usage_log").select("function_name, model_id, prompt_tokens, completion_tokens, estimated_cost_cents, created_at").order("created_at", { ascending: false }).limit(500),
        supabase.from("judge_usage_log").select("model_id, prompt_tokens, completion_tokens, estimated_cost_cents, created_at").order("created_at", { ascending: false }).limit(500),
      ]);
      setAiUsage((aiRes.data as AiUsageRow[]) || []);
      setJudgeUsage((judgeRes.data as JudgeUsageRow[]) || []);
      setLoading(false);
    }
    load();
  }, []);

  const allUsage: UsageRow[] = useMemo(() => [
    ...aiUsage.map((r) => ({ ...r, source: r.function_name })),
    ...judgeUsage.map((r) => ({ ...r, source: "ai-judge" as string })),
  ], [aiUsage, judgeUsage]);

  const totalCalls = allUsage.length;
  const totalCostCents = allUsage.reduce((s, r) => s + (r.estimated_cost_cents || 0), 0);
  const totalTokens = allUsage.reduce((s, r) => s + (r.prompt_tokens || 0) + (r.completion_tokens || 0), 0);

  const activeCount = Object.values(TOKEN_ACTION_METADATA).filter((m) => m.status === "active").length;
  const deadCount = Object.values(TOKEN_ACTION_METADATA).filter((m) => m.status === "dead_code" || m.status === "unwired" || m.status === "gate_only").length;

  const fnStats: Record<string, FnStat> = useMemo(() => {
    const map: Record<string, FnStat> = {};
    for (const r of allUsage) {
      if (!map[r.source]) map[r.source] = { calls: 0, cost: 0, tokens: 0, lastUsed: "" };
      map[r.source].calls++;
      map[r.source].cost += r.estimated_cost_cents || 0;
      map[r.source].tokens += (r.prompt_tokens || 0) + (r.completion_tokens || 0);
      if (!map[r.source].lastUsed || r.created_at > map[r.source].lastUsed) {
        map[r.source].lastUsed = r.created_at;
      }
    }
    return map;
  }, [allUsage]);

  const last7 = useMemo(() => buildLast7Days(), []);

  const sparklineData = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    const allMap: Record<string, number> = {};
    for (const r of allUsage) {
      const day = r.created_at.slice(0, 10);
      if (!map[r.source]) map[r.source] = {};
      map[r.source][day] = (map[r.source][day] || 0) + 1;
      allMap[day] = (allMap[day] || 0) + 1;
    }
    const result: Record<string, { day: string; calls: number }[]> = {};
    for (const fn of Object.keys(map)) {
      result[fn] = last7.map((day) => ({ day, calls: map[fn]?.[day] || 0 }));
    }
    result["__all__"] = last7.map((day) => ({ day, calls: allMap[day] || 0 }));
    return result;
  }, [allUsage, last7]);

  const tableProps = { loading, fnStats, sparklineData, last7, flags, toggleFlag };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-display text-lg font-semibold mb-1 flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" /> AI Features Overview
        </h3>
        <p className="text-xs text-muted-foreground">
          Complete registry of all AI-powered features, their status, pricing, and usage.
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          disabled={PAID_AI_SECURITY_HOLD || testing}
          onClick={handleTestCostRoute}
        >
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
          Test Cost Route
        </Button>
        {testResult && (
          <span className="inline-flex items-center gap-1.5 text-xs font-mono">
            {testResult.error ? (
              <><XCircle className="h-4 w-4 text-destructive" /> {testResult.error}</>
            ) : (
              <>
                {testResult.pass
                  ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                  : <XCircle className="h-4 w-4 text-destructive" />}
                Model: <span className="font-semibold">{testResult.model}</span>
              </>
            )}
          </span>
        )}
      </div>

      <SummaryCards
        loading={loading}
        totalCalls={totalCalls}
        totalCostCents={totalCostCents}
        totalTokens={totalTokens}
        activeCount={activeCount}
        deadCount={deadCount}
        sparklineAll={sparklineData["__all__"] || last7.map((d) => ({ day: d, calls: 0 }))}
      />

      <FeatureTable category="main" title="🎬 Main Features" {...tableProps} />
      <FeatureTable category="sub" title="🔧 Sub-Features" {...tableProps} />
      <FeatureTable category="admin" title="🛡️ Admin Tools" {...tableProps} />
      <FeatureTable category="entry_cost" title="🎟️ Entry Costs" {...tableProps} />
      <FeatureTable category="dead" title="💀 Dead Code" {...tableProps} />
      <FeatureTable category="unwired" title="🔌 Unwired Feature Flags" {...tableProps} />

      <ModelBreakdown loading={loading} allUsage={allUsage} totalCostCents={totalCostCents} />
    </div>
  );
}
