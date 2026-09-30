import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle, Circle, RefreshCw, Archive } from "lucide-react";
import { toast } from "sonner";

interface ModelResult {
  model: string;
  status: "ok" | "error";
  latency_ms: number;
  response?: string;
  error?: string | null;
}

interface AiModel {
  id: string;
  label: string;
  tier: string;
  status: string;
}

export default function ModelHealthPanel() {
  const [registryModels, setRegistryModels] = useState<AiModel[]>([]);
  const [results, setResults] = useState<ModelResult[]>([]);
  const [testedAt, setTestedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [registryLoading, setRegistryLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("ai_models" as any)
      .select("id, label, tier, status")
      .order("tier")
      .order("label")
      .then(({ data }) => {
        setRegistryModels((data as any[] || []) as AiModel[]);
        setRegistryLoading(false);
      });
  }, []);

  const testableModels = registryModels.filter((m) => m.status !== "retired");

  const runCheck = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("model-health-check");
      if (error) throw error;
      setResults(data.results || []);
      setTestedAt(data.tested_at);
      const ok = (data.results || []).filter((r: ModelResult) => r.status === "ok").length;
      const fail = (data.results || []).length - ok;
      toast.success(`Health check complete: ${ok} passed, ${fail} failed`);
    } catch (e: any) {
      toast.error(e.message || "Health check failed");
    } finally {
      setLoading(false);
    }
  };

  const okCount = results.filter((r) => r.status === "ok").length;
  const failCount = results.filter((r) => r.status === "error").length;

  // Merge registry models with test results
  const displayModels = registryModels.map((m) => {
    const result = results.find((r) => r.model === m.id);
    return {
      model: m.id,
      label: m.label,
      tier: m.tier,
      registryStatus: m.status,
      testStatus: result?.status || ("untested" as const),
      latency_ms: result?.latency_ms || 0,
      response: result?.response,
      error: result?.error,
    };
  });

  if (registryLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="p-4 rounded-xl border border-border/50 bg-card/80 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {results.length > 0 && (
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="flex items-center gap-1 text-green-500"><CheckCircle2 className="h-3.5 w-3.5" />{okCount} passed</span>
              {failCount > 0 && <span className="flex items-center gap-1 text-destructive"><XCircle className="h-3.5 w-3.5" />{failCount} failed</span>}
            </div>
          )}
        </div>
        <Button onClick={runCheck} disabled={loading} size="sm" variant="outline" className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Testing…" : "Run Health Check"}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {loading
          ? testableModels.map((m) => (
              <div key={m.id} className="p-4 rounded-xl border border-border/50 bg-card/80 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            ))
          : displayModels.map((r) => {
              const isOk = r.testStatus === "ok";
              const isError = r.testStatus === "error";
              const isUntested = !isOk && !isError;
              const isRetired = r.registryStatus === "retired";
              const isDeprecated = r.registryStatus === "deprecated";

              return (
                <div
                  key={r.model}
                  className={`p-4 rounded-xl border transition-colors ${
                    isRetired
                      ? "border-red-500/20 bg-red-500/5 opacity-60"
                      : isOk
                      ? "border-green-500/30 bg-green-500/5"
                      : isError
                      ? "border-destructive/30 bg-destructive/5"
                      : "border-border/50 bg-card/80"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {isRetired ? (
                      <Archive className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                    ) : isOk ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                    ) : isError ? (
                      <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-mono font-semibold truncate ${isRetired ? "line-through" : ""}`}>
                          {r.label || r.model}
                        </p>
                        {isDeprecated && (
                          <Badge variant="outline" className="text-[9px] bg-amber-500/15 text-amber-400 border-amber-500/30 shrink-0">
                            deprecated
                          </Badge>
                        )}
                        {isRetired && (
                          <Badge variant="outline" className="text-[9px] bg-red-500/15 text-red-400 border-red-500/30 shrink-0">
                            retired
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px] font-mono text-muted-foreground truncate">{r.model}</p>
                      {r.latency_ms > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {r.latency_ms.toLocaleString()}ms
                        </p>
                      )}
                      {isOk && r.response && (
                        <p className="text-xs text-green-600 dark:text-green-400 mt-1 truncate">
                          → {r.response}
                        </p>
                      )}
                      {isError && r.error && (
                        <p className="text-xs text-destructive mt-1 line-clamp-2">{r.error}</p>
                      )}
                      {isRetired && (
                        <p className="text-xs text-red-400 mt-1">Retired — skipped</p>
                      )}
                      {!isRetired && isUntested && (
                        <p className="text-xs text-muted-foreground mt-1">Not tested yet</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
      </div>

      {testedAt && (
        <p className="text-xs text-muted-foreground text-center">
          Last tested: {new Date(testedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
