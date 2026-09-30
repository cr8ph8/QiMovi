import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Shield, GitBranch, Network, Clock, BarChart3, AlertTriangle, CheckCircle, Download, Loader2, FileCheck } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface GovernancePanelProps {
  entryId: string;
  sensitivity: string;
}

interface InfluenceScore {
  id: string;
  semantic_drift_score: number | null;
  voice_stability_score: number | null;
  originality_distance_score: number | null;
  structural_integrity_score: number | null;
  ai_influence_score: number | null;
  scoring_method: string;
  created_at: string;
}

interface ScreenplayVersion {
  id: string;
  source_type: string;
  actor_type: string;
  text_hash: string;
  text_excerpt: string | null;
  parent_version_id: string | null;
  created_at: string;
}

interface GovernanceEvent {
  id: string;
  event_type: string;
  event_status: string;
  provider: string | null;
  model_name: string | null;
  routing_reason: string | null;
  privacy_mode: string | null;
  created_at: string;
}

interface ProvenanceNode {
  id: string;
  node_type: string;
  label: string;
  created_at: string;
}

interface ProvenanceEdge {
  id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: string;
}

interface EvaluationRun {
  id: string;
  model_used: string;
  temperature: number | null;
  quotient_scores_json: Record<string, number>;
  created_at: string;
}

interface ScriptQuotient {
  id: string;
  structure_q: number | null;
  character_q: number | null;
  dialogue_q: number | null;
  theme_q: number | null;
  creativity_q: number | null;
  audience_q: number | null;
  market_q: number | null;
  variance_score: number | null;
  confidence_score: number | null;
  created_at: string;
}

const QUOTIENT_LABELS: Record<string, string> = {
  structure_q: "Structure",
  character_q: "Character",
  dialogue_q: "Dialogue",
  theme_q: "Theme",
  creativity_q: "Creativity",
  audience_q: "Audience",
  market_q: "Market",
};

const SCORE_LABELS: Record<string, { label: string; invert?: boolean }> = {
  semantic_drift_score: { label: "Semantic Drift" },
  voice_stability_score: { label: "Voice Stability", invert: true },
  originality_distance_score: { label: "Originality Distance" },
  structural_integrity_score: { label: "Structural Integrity", invert: true },
  ai_influence_score: { label: "AI Influence" },
};

function getScoreColor(value: number, invert?: boolean): string {
  const v = invert ? 1 - value : value;
  if (v >= 0.7) return "bg-destructive";
  if (v >= 0.4) return "bg-amber-500";
  return "bg-emerald-500";
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  human_edit: "Human Edit",
  ai_rewrite: "AI Rewrite",
  import: "Import",
  submission_snapshot: "Submission",
  review_snapshot: "Review",
};

const ACTOR_ICONS: Record<string, string> = {
  user: "👤",
  ai: "🤖",
  admin: "🛡️",
  system: "⚙️",
};

export default function GovernancePanel({ entryId, sensitivity }: GovernancePanelProps) {
  const [loading, setLoading] = useState(true);
  const [scores, setScores] = useState<InfluenceScore | null>(null);
  const [versions, setVersions] = useState<ScreenplayVersion[]>([]);
  const [events, setEvents] = useState<GovernanceEvent[]>([]);
  const [nodes, setNodes] = useState<ProvenanceNode[]>([]);
  const [edges, setEdges] = useState<ProvenanceEdge[]>([]);
  const [evalRuns, setEvalRuns] = useState<EvaluationRun[]>([]);
  const [quotients, setQuotients] = useState<ScriptQuotient | null>(null);
  const [exportingBundle, setExportingBundle] = useState(false);
  const [bundleHash, setBundleHash] = useState<string | null>(null);
  const { isAdmin } = useAuth();

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [scoresRes, versionsRes, eventsRes, nodesRes, edgesRes, evalRes, quotientsRes] = await Promise.all([
        supabase.from("influence_scores").select("*").eq("entry_id", entryId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("screenplay_versions").select("*").eq("entry_id", entryId).order("created_at", { ascending: true }),
        supabase.from("governance_events").select("*").eq("entry_id", entryId).order("created_at", { ascending: false }).limit(50),
        supabase.from("provenance_nodes").select("*").eq("entry_id", entryId).order("created_at", { ascending: true }),
        supabase.from("provenance_edges").select("*").eq("entry_id", entryId),
        supabase.from("evaluation_runs").select("*").eq("entry_id", entryId).order("created_at", { ascending: true }),
        supabase.from("script_quotients").select("*").eq("entry_id", entryId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);

      setScores(scoresRes.data as any);
      setVersions((versionsRes.data as any) || []);
      setEvents((eventsRes.data as any) || []);
      setNodes((nodesRes.data as any) || []);
      setEdges((edgesRes.data as any) || []);
      setEvalRuns((evalRes.data as any) || []);
      setQuotients(quotientsRes.data as any);
      setLoading(false);
    }
    load();
  }, [entryId]);

  const hasData = scores || versions.length > 0 || events.length > 0 || nodes.length > 0 || evalRuns.length > 0 || quotients;

  if (loading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
        <Shield className="h-4 w-4" />
        <span>No governance data recorded yet for this entry.</span>
      </div>
    );
  }

  return (
    <Tabs defaultValue="overview" className="w-full">
      <TabsList className="w-full grid grid-cols-3 h-8">
        <TabsTrigger value="overview" className="text-xs gap-1"><Shield className="h-3 w-3" /> Overview</TabsTrigger>
        <TabsTrigger value="versions" className="text-xs gap-1"><GitBranch className="h-3 w-3" /> Versions</TabsTrigger>
        <TabsTrigger value="provenance" className="text-xs gap-1"><Network className="h-3 w-3" /> Provenance</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-4 mt-3">
        {/* Sensitivity badge + Export button */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={`text-[10px] font-mono ${
            sensitivity !== "standard" ? "bg-violet-500/10 text-violet-400 border-violet-500/30" : ""
          }`}>
            {sensitivity}
          </Badge>
          {events.length > 0 && events[0].model_name && (
            <Badge variant="outline" className="text-[10px] font-mono">
              Model: {events[0].model_name.split("/").pop()}
            </Badge>
          )}
          {events.length > 0 && events[0].routing_reason && (
            <Badge variant="outline" className="text-[10px] font-mono bg-blue-500/10 text-blue-400 border-blue-500/30">
              {events[0].routing_reason.replace(/_/g, " ")}
            </Badge>
          )}
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto text-[10px] h-6 px-2 gap-1 font-mono"
              disabled={exportingBundle}
              onClick={async () => {
                setExportingBundle(true);
                try {
                  const { data, error } = await supabase.functions.invoke("export-evidence-bundle", {
                    body: { entry_id: entryId },
                  });
                  if (error) throw error;
                  const hash = data?.bundle?.evidence_bundle_hash;
                  setBundleHash(hash || null);
                  // Download as JSON
                  const blob = new Blob([JSON.stringify(data.bundle, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `evidence-bundle-${entryId.slice(0, 8)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast.success("Evidence bundle exported");
                } catch (err: any) {
                  console.error(err);
                  toast.error("Export failed: " + (err.message || "Unknown error"));
                } finally {
                  setExportingBundle(false);
                }
              }}
            >
              {exportingBundle ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
              Export Evidence
            </Button>
          )}
        </div>

        {/* Evidence bundle hash */}
        {bundleHash && (
          <div className="flex items-center gap-2 rounded-md border border-border/30 bg-card/60 px-2.5 py-1.5">
            <FileCheck className="h-3 w-3 text-emerald-500 shrink-0" />
            <span className="text-[9px] font-mono text-muted-foreground truncate">
              Bundle: {bundleHash.slice(0, 16)}…{bundleHash.slice(-8)}
            </span>
          </div>
        )}

        {/* Influence Scores */}
        {scores && (
          <div className="space-y-2">
            <h4 className="text-xs font-mono font-semibold text-muted-foreground">Influence Scores</h4>
            {Object.entries(SCORE_LABELS).map(([key, { label, invert }]) => {
              const value = Number((scores as any)[key]) || 0;
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">{label}</span>
                    <span className="text-[11px] font-mono font-semibold">{(value * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full ${getScoreColor(value, invert)}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${value * 100}%` }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                    />
                  </div>
                </div>
              );
            })}
            <p className="text-[10px] font-mono text-muted-foreground">
              Method: {scores.scoring_method}
            </p>
          </div>
        )}

        {/* Multi-Pass Evaluation Runs */}
        {evalRuns.length > 0 && (() => {
          // Compute per-quotient stats across passes
          const quotientKeys = Object.keys(QUOTIENT_LABELS);
          const passData = evalRuns.map((run) => {
            const qs = run.quotient_scores_json || {};
            return { temp: run.temperature, scores: qs, model: run.model_used };
          });
          const stats: Record<string, { avg: number; stdDev: number; values: number[] }> = {};
          for (const key of quotientKeys) {
            const vals = passData.map((p) => Number(p.scores[key]) || 0);
            const avg = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
            const variance = vals.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (vals.length || 1);
            stats[key] = { avg, stdDev: Math.sqrt(variance), values: vals };
          }
          const avgVariance = Object.values(stats).reduce((s, q) => s + q.stdDev, 0) / quotientKeys.length;
          const isUnstable = avgVariance > 0.15;

          return (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-mono font-semibold text-muted-foreground flex items-center gap-1.5">
                  <BarChart3 className="h-3 w-3" /> Multi-Pass Evaluation ({evalRuns.length} passes)
                </h4>
                <Badge variant="outline" className={`text-[9px] font-mono gap-1 ${
                  isUnstable ? "border-amber-500/30 text-amber-400" : "border-emerald-500/30 text-emerald-400"
                }`}>
                  {isUnstable ? <AlertTriangle className="h-2.5 w-2.5" /> : <CheckCircle className="h-2.5 w-2.5" />}
                  {isUnstable ? "Unstable" : "Stable"}
                </Badge>
              </div>

              {/* Temperature passes */}
              <div className="flex gap-2 flex-wrap">
                {passData.map((p, i) => (
                  <Badge key={i} variant="outline" className="text-[9px] font-mono">
                    T={p.temp ?? "?"} · {p.model.split("/").pop()}
                  </Badge>
                ))}
              </div>

              {/* Quotient breakdown with variance bars */}
              <div className="space-y-1.5">
                {quotientKeys.map((key) => {
                  const s = stats[key];
                  const isHigh = s.stdDev > 0.15;
                  return (
                    <div key={key} className="space-y-0.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">{QUOTIENT_LABELS[key]}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {s.values.map((v) => v.toFixed(1)).join(" / ")}
                          </span>
                          <span className={`text-[10px] font-mono font-semibold ${isHigh ? "text-amber-400" : "text-foreground"}`}>
                            μ {s.avg.toFixed(2)}
                          </span>
                          {isHigh && <AlertTriangle className="h-2.5 w-2.5 text-amber-400" />}
                        </div>
                      </div>
                      <div className="h-1 w-full rounded-full bg-muted overflow-hidden relative">
                        <motion.div
                          className={`h-full rounded-full ${isHigh ? "bg-amber-500" : "bg-primary/60"}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(s.avg * 10, 100)}%` }}
                          transition={{ duration: 0.5, ease: "easeOut" }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="text-[9px] font-mono text-muted-foreground">
                Avg σ: {avgVariance.toFixed(3)} · Threshold: 0.150 · {isUnstable ? "⚠ Variance exceeds 15% threshold" : "✓ Within stability bounds"}
              </p>
            </div>
          );
        })()}

        {/* Aggregate Script Quotients */}
        {quotients && (() => {
          const qKeys = Object.keys(QUOTIENT_LABELS);
          const qValues = qKeys.map((k) => Number((quotients as any)[k]) || 0);
          const avg = qValues.reduce((a, b) => a + b, 0) / (qValues.length || 1);
          const confidence = Number(quotients.confidence_score) || 0;
          const variance = Number(quotients.variance_score) || 0;
          const isLowConfidence = confidence < 0.6;

          return (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-mono font-semibold text-muted-foreground flex items-center gap-1.5">
                  <BarChart3 className="h-3 w-3" /> Aggregate Quotients
                </h4>
                <Badge variant="outline" className={`text-[9px] font-mono gap-1 ${
                  isLowConfidence ? "border-amber-500/30 text-amber-400" : "border-emerald-500/30 text-emerald-400"
                }`}>
                  {isLowConfidence ? <AlertTriangle className="h-2.5 w-2.5" /> : <CheckCircle className="h-2.5 w-2.5" />}
                  {(confidence * 100).toFixed(0)}% confidence
                </Badge>
              </div>

              <div className="space-y-1.5">
                {qKeys.map((key) => {
                  const val = Number((quotients as any)[key]) || 0;
                  return (
                    <div key={key} className="space-y-0.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">{QUOTIENT_LABELS[key]}</span>
                        <span className="text-[10px] font-mono font-semibold">{val.toFixed(2)}</span>
                      </div>
                      <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                        <motion.div
                          className="h-full rounded-full bg-primary/60"
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(val * 10, 100)}%` }}
                          transition={{ duration: 0.5, ease: "easeOut" }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="text-[9px] font-mono text-muted-foreground">
                Avg: {avg.toFixed(2)} · Variance: {variance.toFixed(3)} · Confidence: {(confidence * 100).toFixed(1)}%
              </p>
            </div>
          );
        })()}

        {/* Recent governance events */}
        {events.length > 0 && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-mono font-semibold text-muted-foreground">Recent Events</h4>
            <ScrollArea className="h-[160px]">
              {events.slice(0, 20).map((evt) => (
                <div key={evt.id} className="flex items-center gap-2 py-1 border-b border-border/20 last:border-0">
                  <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                    {new Date(evt.created_at).toLocaleTimeString()}
                  </span>
                  <Badge variant="outline" className="text-[9px] font-mono shrink-0">
                    {evt.event_type.replace(/_/g, " ")}
                  </Badge>
                  {evt.model_name && (
                    <span className="text-[10px] text-muted-foreground truncate">
                      {evt.model_name.split("/").pop()}
                    </span>
                  )}
                </div>
              ))}
            </ScrollArea>
          </div>
        )}
      </TabsContent>

      <TabsContent value="versions" className="mt-3">
        {versions.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No version snapshots yet.</p>
        ) : (
          <ScrollArea className="h-[300px]">
            <div className="relative pl-6">
              {/* Vertical line */}
              <div className="absolute left-2.5 top-2 bottom-2 w-px bg-border" />
              {versions.map((v, i) => (
                <motion.div
                  key={v.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="relative mb-3"
                >
                  {/* Dot */}
                  <div className={`absolute -left-[14px] top-2 w-2.5 h-2.5 rounded-full border-2 ${
                    v.source_type === "ai_rewrite" ? "bg-primary border-primary" :
                    v.source_type === "review_snapshot" ? "bg-amber-500 border-amber-500" :
                    "bg-muted-foreground border-muted-foreground"
                  }`} />
                  <div className="rounded-lg border border-border/30 bg-card/60 p-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs">{ACTOR_ICONS[v.actor_type] || "⚙️"}</span>
                      <Badge variant="outline" className="text-[9px] font-mono">
                        {SOURCE_TYPE_LABELS[v.source_type] || v.source_type}
                      </Badge>
                      <span className="text-[10px] font-mono text-muted-foreground ml-auto">
                        {new Date(v.created_at).toLocaleString()}
                      </span>
                    </div>
                    {v.text_excerpt && (
                      <p className="text-[10px] text-muted-foreground line-clamp-2 font-mono">
                        {v.text_excerpt.slice(0, 120)}…
                      </p>
                    )}
                    <p className="text-[9px] font-mono text-muted-foreground/60 mt-1">
                      Hash: {v.text_hash.slice(0, 12)}…
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </ScrollArea>
        )}
      </TabsContent>

      <TabsContent value="provenance" className="mt-3">
        {nodes.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No provenance data yet.</p>
        ) : (
          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {nodes.map((node, i) => {
                const outEdges = edges.filter((e) => e.from_node_id === node.id);
                const targetNodes = outEdges
                  .map((e) => nodes.find((n) => n.id === e.to_node_id))
                  .filter(Boolean);

                return (
                  <motion.div
                    key={node.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="rounded-lg border border-border/30 bg-card/60 p-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${
                        node.node_type === "version" ? "bg-primary" :
                        node.node_type === "rewrite_event" ? "bg-amber-500" :
                        node.node_type === "review_output" ? "bg-emerald-500" :
                        "bg-muted-foreground"
                      }`} />
                      <span className="text-xs font-semibold">{node.label}</span>
                      <Badge variant="outline" className="text-[9px] font-mono ml-auto">
                        {node.node_type.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    {outEdges.length > 0 && (
                      <div className="mt-1.5 pl-4 border-l border-border/30 space-y-1">
                        {outEdges.map((edge) => {
                          const target = nodes.find((n) => n.id === edge.to_node_id);
                          return (
                            <div key={edge.id} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                              <span className="font-mono">→</span>
                              <span className="font-mono text-primary/70">{edge.edge_type.replace(/_/g, " ")}</span>
                              {target && <span className="truncate">{target.label}</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </TabsContent>
    </Tabs>
  );
}
