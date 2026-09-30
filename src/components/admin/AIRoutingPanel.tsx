import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Zap, AlertTriangle, Info, Archive, ArrowRight, ShieldAlert } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { logAuditEvent } from "@/lib/audit";

interface AiModel {
  id: string;
  label: string;
  tier: string;
  status: string;
  cost_input_per_1k: number;
  cost_output_per_1k: number;
  deprecated_at: string | null;
  retired_at: string | null;
  replacement_model_id: string | null;
  created_at: string;
}

interface ModelUsageStats {
  avgCostCents: number;
  totalUses: number;
}

interface LogRow {
  id: string;
  created_at: string;
  function_name: string;
  user_id: string | null;
  status: string;
  error_message: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  estimated_cost_cents: number | null;
  duration_ms: number | null;
  routing_reason: string | null;
  sensitivity: string | null;
}

const ROLE_CONTEXTS = [
  { key: "default", label: "Admin" },
  { key: "competition", label: "Host" },
  { key: "user", label: "User" },
];

const TIER_COLORS: Record<string, string> = {
  budget: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  fast: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  standard: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  premium: "bg-purple-500/15 text-purple-400 border-purple-500/30",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  deprecated: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  retired: "bg-red-500/15 text-red-400 border-red-500/30",
};

interface ModelPref {
  id: string;
  role_context: string;
  model_id: string;
  enabled: boolean;
}

export default function AIRoutingPanel() {
  const [costRoutingEnabled, setCostRoutingEnabled] = useState(true);
  const [models, setModels] = useState<AiModel[]>([]);
  const [prefs, setPrefs] = useState<ModelPref[]>([]);
  const [usageLogs, setUsageLogs] = useState<{ model_id: string; estimated_cost_cents: number | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  // Drawer state
  const [selectedModel, setSelectedModel] = useState<AiModel | null>(null);
  const [detailLogs, setDetailLogs] = useState<LogRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Retire dialog state
  const [retireTarget, setRetireTarget] = useState<AiModel | null>(null);
  const [replacementId, setReplacementId] = useState<string>("");
  const [retiring, setRetiring] = useState(false);

  // Deprecate dialog state
  const [deprecateTarget, setDeprecateTarget] = useState<AiModel | null>(null);
  const [deprecating, setDeprecating] = useState(false);

  useEffect(() => {
    async function load() {
      const [{ data: settings }, { data: aiModels }, { data: modelPrefs }, { data: usage }] = await Promise.all([
        supabase.from("site_settings").select("key, value").eq("key", "cost_routing_enabled").maybeSingle(),
        supabase.from("ai_models" as any).select("*").order("tier").order("label"),
        supabase.from("model_preferences" as any).select("id, role_context, model_id, enabled"),
        supabase.from("ai_usage_log").select("model_id, estimated_cost_cents"),
      ]);
      setCostRoutingEnabled(settings?.value ?? true);
      setModels((aiModels as any[] || []) as AiModel[]);
      setPrefs((modelPrefs as any[] || []) as ModelPref[]);
      setUsageLogs(usage || []);
      setLoading(false);
    }
    load();
  }, []);

  // Fetch detail logs when a model is selected
  useEffect(() => {
    if (!selectedModel) return;
    setDetailLoading(true);
    supabase
      .from("ai_usage_log")
      .select("id, created_at, function_name, user_id, status, error_message, prompt_tokens, completion_tokens, estimated_cost_cents, duration_ms, routing_reason, sensitivity")
      .eq("model_id", selectedModel.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setDetailLogs((data as LogRow[]) || []);
        setDetailLoading(false);
      });
  }, [selectedModel]);

  const usageByModel = useMemo(() => {
    const map: Record<string, ModelUsageStats> = {};
    for (const row of usageLogs) {
      if (!map[row.model_id]) map[row.model_id] = { avgCostCents: 0, totalUses: 0 };
      map[row.model_id].totalUses++;
      map[row.model_id].avgCostCents += (row.estimated_cost_cents ?? 0);
    }
    for (const key of Object.keys(map)) {
      if (map[key].totalUses > 0) {
        map[key].avgCostCents = map[key].avgCostCents / map[key].totalUses;
      }
    }
    return map;
  }, [usageLogs]);

  const detailSummary = useMemo(() => {
    const total = detailLogs.length;
    const successes = detailLogs.filter((l) => l.status === "success").length;
    const failures = total - successes;
    const avgDuration = total > 0
      ? detailLogs.reduce((s, l) => s + (l.duration_ms ?? 0), 0) / total
      : 0;
    return { total, successes, failures, successRate: total > 0 ? ((successes / total) * 100).toFixed(1) : "0", avgDuration: Math.round(avgDuration) };
  }, [detailLogs]);

  const activeModels = useMemo(() => models.filter((m) => m.status === "active"), [models]);

  const toggleCostRouting = async (checked: boolean) => {
    setCostRoutingEnabled(checked);
    const { error } = await supabase
      .from("site_settings")
      .upsert({ key: "cost_routing_enabled", value: checked, updated_at: new Date().toISOString() } as any, { onConflict: "key" });
    if (error) {
      toast.error("Failed to update cost routing");
      setCostRoutingEnabled(!checked);
    } else {
      toast.success(`Cost optimization ${checked ? "enabled" : "disabled"}`);
    }
  };

  const toggleModelPref = async (roleContext: string, modelId: string) => {
    const key = `${roleContext}:${modelId}`;
    setToggling(key);
    const existing = prefs.find((p) => p.role_context === roleContext && p.model_id === modelId);
    const newEnabled = existing ? !existing.enabled : false;

    setPrefs((prev) =>
      prev.map((p) =>
        p.role_context === roleContext && p.model_id === modelId ? { ...p, enabled: newEnabled } : p
      )
    );

    const { error } = await supabase
      .from("model_preferences" as any)
      .upsert(
        { role_context: roleContext, model_id: modelId, enabled: newEnabled, updated_at: new Date().toISOString() } as any,
        { onConflict: "role_context,model_id" }
      );

    if (error) {
      toast.error("Failed to update model preference");
      setPrefs((prev) =>
        prev.map((p) =>
          p.role_context === roleContext && p.model_id === modelId ? { ...p, enabled: !newEnabled } : p
        )
      );
    }
    setToggling(null);
  };

  const isModelEnabled = (roleContext: string, modelId: string) => {
    const pref = prefs.find((p) => p.role_context === roleContext && p.model_id === modelId);
    return pref?.enabled ?? true;
  };

  const handleDeprecate = async () => {
    if (!deprecateTarget) return;
    setDeprecating(true);
    const { error } = await supabase
      .from("ai_models" as any)
      .update({ status: "deprecated", deprecated_at: new Date().toISOString() } as any)
      .eq("id", deprecateTarget.id);

    if (error) {
      toast.error("Failed to deprecate model");
    } else {
      setModels((prev) => prev.map((m) => m.id === deprecateTarget.id ? { ...m, status: "deprecated", deprecated_at: new Date().toISOString() } : m));
      if (selectedModel?.id === deprecateTarget.id) {
        setSelectedModel((prev) => prev ? { ...prev, status: "deprecated" } : null);
      }
      // Log to audit
            await logAuditEvent({
        action: "model_deprecated",
        details: { model_id: deprecateTarget.id, label: deprecateTarget.label },
      });
      toast.success(`${deprecateTarget.label} marked as deprecated`);
    }
    setDeprecating(false);
    setDeprecateTarget(null);
  };

  const handleRetire = async () => {
    if (!retireTarget) return;
    setRetiring(true);

    const replacement = replacementId || null;

    // Update ai_models status
    const { error } = await supabase
      .from("ai_models" as any)
      .update({
        status: "retired",
        retired_at: new Date().toISOString(),
        replacement_model_id: replacement,
      } as any)
      .eq("id", retireTarget.id);

    if (error) {
      toast.error("Failed to retire model");
      setRetiring(false);
      return;
    }

    // Disable all model_preferences for this model
    await supabase
      .from("model_preferences" as any)
      .update({ enabled: false, updated_at: new Date().toISOString() } as any)
      .eq("model_id", retireTarget.id);

    // Update feature_configs.model_hint if pointing to retired model
    if (replacement) {
      await supabase
        .from("feature_configs")
        .update({ model_hint: replacement, updated_at: new Date().toISOString() })
        .eq("model_hint", retireTarget.id);
    }

    // Log to audit
        await logAuditEvent({
      action: "model_retired",
      details: {
        model_id: retireTarget.id,
        label: retireTarget.label,
        replacement_model_id: replacement,
      },
    });

    // Update local state
    setModels((prev) => prev.map((m) =>
      m.id === retireTarget.id
        ? { ...m, status: "retired", retired_at: new Date().toISOString(), replacement_model_id: replacement }
        : m
    ));
    setPrefs((prev) => prev.map((p) => p.model_id === retireTarget.id ? { ...p, enabled: false } : p));
    if (selectedModel?.id === retireTarget.id) {
      setSelectedModel((prev) => prev ? { ...prev, status: "retired" } : null);
    }

    toast.success(`${retireTarget.label} retired${replacement ? ` → ${replacement}` : ""}`);
    setRetiring(false);
    setRetireTarget(null);
    setReplacementId("");
  };

  const handleReactivate = async (model: AiModel) => {
    const { error } = await supabase
      .from("ai_models" as any)
      .update({ status: "active", deprecated_at: null, retired_at: null, replacement_model_id: null } as any)
      .eq("id", model.id);

    if (error) {
      toast.error("Failed to reactivate model");
    } else {
      setModels((prev) => prev.map((m) => m.id === model.id ? { ...m, status: "active", deprecated_at: null, retired_at: null, replacement_model_id: null } : m));
      if (selectedModel?.id === model.id) {
        setSelectedModel((prev) => prev ? { ...prev, status: "active" } : null);
      }
            await logAuditEvent({
        action: "model_reactivated",
        details: { model_id: model.id, label: model.label },
      });
      toast.success(`${model.label} reactivated`);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cost Optimization Toggle */}
      <div className="p-5 rounded-xl border border-border/50 bg-card/80">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Zap className="h-5 w-5 text-primary" />
            <div>
              <h4 className="font-display text-sm font-bold">Cost Optimization (Flash-Lite Downgrade)</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Auto-downgrades to <span className="font-mono text-primary/80">gemini-2.5-flash-lite</span> for scripts ≤ 10 pages
              </p>
            </div>
          </div>
          <Switch checked={costRoutingEnabled} onCheckedChange={toggleCostRouting} />
        </div>
        {!costRoutingEnabled && (
          <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300">
              Cost optimization is disabled. All scripts will use the default model regardless of page count, which may increase AI costs.
            </p>
          </div>
        )}
      </div>

      {/* Active Routing Rules */}
      <div className="p-5 rounded-xl border border-border/50 bg-card/80">
        <div className="flex items-center gap-2 mb-3">
          <Info className="h-4 w-4 text-muted-foreground" />
          <h4 className="font-display text-sm font-bold">Active Routing Rules</h4>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
            <span className="text-muted-foreground">Default Model:</span>
            <span className="ml-2 font-mono text-foreground">gemini-3-flash-preview</span>
          </div>
          <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
            <span className="text-muted-foreground">Cost Threshold:</span>
            <span className="ml-2 font-mono text-foreground">≤ 10 pages → flash-lite</span>
          </div>
          <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
            <span className="text-muted-foreground">NDA / Confidential:</span>
            <span className="ml-2 font-mono text-foreground">→ gemini-2.5-pro</span>
          </div>
          <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
            <span className="text-muted-foreground">Embargoed:</span>
            <span className="ml-2 font-mono text-foreground">→ gemini-2.5-flash</span>
          </div>
        </div>
      </div>

      {/* Model Availability Grid */}
      <div className="p-5 rounded-xl border border-border/50 bg-card/80">
        <h4 className="font-display text-sm font-bold mb-4">Model Availability by Role</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2.5 pr-4 font-mono text-xs text-muted-foreground">Model</th>
                <th className="text-center py-2.5 px-3 font-mono text-xs text-muted-foreground">Status</th>
                <th className="text-center py-2.5 px-3 font-mono text-xs text-muted-foreground">Tier</th>
                <th className="text-center py-2.5 px-3 font-mono text-xs text-muted-foreground">Avg Cost</th>
                <th className="text-center py-2.5 px-3 font-mono text-xs text-muted-foreground">Uses</th>
                {ROLE_CONTEXTS.map((rc) => (
                  <th key={rc.key} className="text-center py-2.5 px-3 font-mono text-xs text-muted-foreground">
                    {rc.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {models.map((model) => {
                const isRetired = model.status === "retired";
                const isDeprecated = model.status === "deprecated";
                const replacementLabel = model.replacement_model_id
                  ? models.find((m) => m.id === model.replacement_model_id)?.label || model.replacement_model_id
                  : null;

                return (
                  <tr
                    key={model.id}
                    className={`border-b border-border/20 transition-colors cursor-pointer ${
                      isRetired
                        ? "opacity-50 hover:opacity-70"
                        : isDeprecated
                        ? "bg-amber-500/5 hover:bg-amber-500/10"
                        : "hover:bg-muted/20"
                    }`}
                    onClick={() => setSelectedModel(model)}
                  >
                    <td className="py-3 pr-4">
                      <span className={`font-body text-foreground text-xs ${isRetired ? "line-through" : ""}`}>
                        {model.label}
                      </span>
                      <span className="block font-mono text-[10px] text-muted-foreground mt-0.5">{model.id}</span>
                      {isRetired && replacementLabel && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                          <ArrowRight className="h-3 w-3" /> {replacementLabel}
                        </span>
                      )}
                    </td>
                    <td className="text-center py-3 px-3">
                      <Badge variant="outline" className={`text-[10px] font-mono ${STATUS_COLORS[model.status] || ""}`}>
                        {model.status}
                      </Badge>
                    </td>
                    <td className="text-center py-3 px-3">
                      <Badge variant="outline" className={`text-[10px] font-mono ${TIER_COLORS[model.tier] || ""}`}>
                        {model.tier}
                      </Badge>
                    </td>
                    <td className="text-center py-3 px-3">
                      <span className="font-mono text-xs text-muted-foreground">
                        {usageByModel[model.id]
                          ? `${usageByModel[model.id].avgCostCents.toFixed(2)}¢`
                          : "—"}
                      </span>
                    </td>
                    <td className="text-center py-3 px-3">
                      <span className="font-mono text-xs text-muted-foreground">
                        {usageByModel[model.id]?.totalUses ?? 0}
                      </span>
                    </td>
                    {ROLE_CONTEXTS.map((rc) => (
                      <td key={rc.key} className="text-center py-3 px-3" onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={isModelEnabled(rc.key, model.id)}
                          onCheckedChange={() => toggleModelPref(rc.key, model.id)}
                          disabled={toggling === `${rc.key}:${model.id}` || isRetired}
                          className="mx-auto"
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Model Detail Drawer */}
      <Sheet open={!!selectedModel} onOpenChange={(open) => !open && setSelectedModel(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          {selectedModel && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-3">
                  <span className={selectedModel.status === "retired" ? "line-through" : ""}>{selectedModel.label}</span>
                  <Badge variant="outline" className={`text-[10px] font-mono ${STATUS_COLORS[selectedModel.status] || ""}`}>
                    {selectedModel.status}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] font-mono ${TIER_COLORS[selectedModel.tier] || ""}`}>
                    {selectedModel.tier}
                  </Badge>
                </SheetTitle>
                <p className="font-mono text-xs text-muted-foreground">{selectedModel.id}</p>
              </SheetHeader>

              {/* Lifecycle Actions */}
              <div className="flex items-center gap-2 mt-4">
                {selectedModel.status === "active" && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                      onClick={() => setDeprecateTarget(selectedModel)}
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Deprecate
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-red-400 border-red-500/30 hover:bg-red-500/10"
                      onClick={() => { setRetireTarget(selectedModel); setReplacementId(""); }}
                    >
                      <Archive className="h-3.5 w-3.5" />
                      Retire
                    </Button>
                  </>
                )}
                {selectedModel.status === "deprecated" && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-red-400 border-red-500/30 hover:bg-red-500/10"
                      onClick={() => { setRetireTarget(selectedModel); setReplacementId(""); }}
                    >
                      <Archive className="h-3.5 w-3.5" />
                      Retire
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => handleReactivate(selectedModel)}
                    >
                      Reactivate
                    </Button>
                  </>
                )}
                {selectedModel.status === "retired" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => handleReactivate(selectedModel)}
                  >
                    Reactivate
                  </Button>
                )}
              </div>

              {/* Deprecation / Retirement info */}
              {selectedModel.status === "deprecated" && (
                <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-300">
                    <p className="font-semibold">Deprecated</p>
                    <p>This model is still operational but scheduled for retirement. Consider migrating to an alternative.</p>
                    {selectedModel.deprecated_at && (
                      <p className="text-amber-400/70 mt-1">Since {format(new Date(selectedModel.deprecated_at), "MMM d, yyyy")}</p>
                    )}
                  </div>
                </div>
              )}
              {selectedModel.status === "retired" && (
                <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <ShieldAlert className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-red-300">
                    <p className="font-semibold">Retired</p>
                    <p>This model is blocked from use. All requests are auto-rerouted to the replacement model.</p>
                    {selectedModel.replacement_model_id && (
                      <p className="mt-1">
                        Replacement: <span className="font-mono text-foreground">{selectedModel.replacement_model_id}</span>
                      </p>
                    )}
                    {selectedModel.retired_at && (
                      <p className="text-red-400/70 mt-1">Since {format(new Date(selectedModel.retired_at), "MMM d, yyyy")}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Summary Stats */}
              <div className="grid grid-cols-4 gap-3 mt-5">
                {[
                  { label: "Total Calls", value: detailSummary.total },
                  { label: "Success Rate", value: `${detailSummary.successRate}%` },
                  { label: "Failures", value: detailSummary.failures },
                  { label: "Avg Duration", value: `${detailSummary.avgDuration}ms` },
                ].map((s) => (
                  <div key={s.label} className="p-3 rounded-lg bg-muted/30 border border-border/30 text-center">
                    <p className="text-[10px] text-muted-foreground font-mono">{s.label}</p>
                    <p className="text-sm font-bold text-foreground mt-0.5">{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Logs Table */}
              <div className="mt-5">
                <h4 className="font-display text-xs font-bold mb-3 text-muted-foreground">Recent Calls (last 50)</h4>
                {detailLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : detailLogs.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No usage logs for this model yet.</p>
                ) : (
                  <div className="overflow-x-auto border border-border/30 rounded-lg">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border/50 bg-muted/20">
                          <th className="text-left py-2 px-2.5 font-mono text-muted-foreground">Time</th>
                          <th className="text-left py-2 px-2.5 font-mono text-muted-foreground">Function</th>
                          <th className="text-left py-2 px-2.5 font-mono text-muted-foreground">User</th>
                          <th className="text-center py-2 px-2.5 font-mono text-muted-foreground">Status</th>
                          <th className="text-left py-2 px-2.5 font-mono text-muted-foreground">Error</th>
                          <th className="text-right py-2 px-2.5 font-mono text-muted-foreground">Tokens</th>
                          <th className="text-right py-2 px-2.5 font-mono text-muted-foreground">Cost</th>
                          <th className="text-right py-2 px-2.5 font-mono text-muted-foreground">Duration</th>
                          <th className="text-left py-2 px-2.5 font-mono text-muted-foreground">Routing</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailLogs.map((log) => (
                          <tr key={log.id} className="border-b border-border/10 hover:bg-muted/10">
                            <td className="py-2 px-2.5 font-mono text-muted-foreground whitespace-nowrap">
                              {format(new Date(log.created_at), "MMM d, HH:mm")}
                            </td>
                            <td className="py-2 px-2.5 font-mono text-foreground">{log.function_name}</td>
                            <td className="py-2 px-2.5 font-mono text-muted-foreground">
                              {log.user_id ? log.user_id.slice(0, 8) + "…" : "—"}
                            </td>
                            <td className="py-2 px-2.5 text-center">
                              <Badge
                                variant="outline"
                                className={
                                  log.status === "success"
                                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px]"
                                    : "bg-red-500/15 text-red-400 border-red-500/30 text-[10px]"
                                }
                              >
                                {log.status}
                              </Badge>
                            </td>
                            <td className="py-2 px-2.5 text-red-400 max-w-[180px] truncate" title={log.error_message || undefined}>
                              {log.error_message || "—"}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono text-muted-foreground whitespace-nowrap">
                              {log.prompt_tokens != null ? `${log.prompt_tokens}/${log.completion_tokens ?? 0}` : "—"}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono text-muted-foreground">
                              {log.estimated_cost_cents != null ? `${Number(log.estimated_cost_cents).toFixed(2)}¢` : "—"}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono text-muted-foreground">
                              {log.duration_ms != null ? `${log.duration_ms}ms` : "—"}
                            </td>
                            <td className="py-2 px-2.5 font-mono text-muted-foreground max-w-[120px] truncate" title={log.routing_reason || undefined}>
                              {log.routing_reason || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Deprecate Confirmation Dialog */}
      <AlertDialog open={!!deprecateTarget} onOpenChange={(open) => !open && setDeprecateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deprecate {deprecateTarget?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              This model will remain operational but show a deprecation warning across all admin interfaces.
              It can still be used by the AI router until fully retired.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeprecate}
              disabled={deprecating}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {deprecating ? "Deprecating…" : "Deprecate Model"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Retire Confirmation Dialog */}
      <AlertDialog open={!!retireTarget} onOpenChange={(open) => !open && setRetireTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Archive className="h-5 w-5 text-red-400" />
              Retire {retireTarget?.label}?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                This will permanently block <span className="font-mono font-semibold">{retireTarget?.id}</span> from use.
                All requests will be auto-rerouted to the replacement model. All role preferences for this model will be disabled.
              </p>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Replacement Model</label>
                <Select value={replacementId} onValueChange={setReplacementId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select replacement model…" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeModels
                      .filter((m) => m.id !== retireTarget?.id)
                      .map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label} ({m.tier})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  If no replacement is selected, requests will fall back to the platform default model.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRetire}
              disabled={retiring}
              className="bg-destructive hover:bg-destructive/90"
            >
              {retiring ? "Retiring…" : "Retire Model"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
