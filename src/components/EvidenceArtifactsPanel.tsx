import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Shield, FileCheck, Brain, Network, Eye, Lock, Sparkles,
  Loader2, Download, RefreshCw, BarChart3, AlertTriangle, CheckCircle,
  Activity, Mic, Target, Layers, Hash, PackageCheck,
} from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import {
  EVIDENCE_SCHEMA_VERSION,
  checkExportReadiness,
  computeEvidenceHealth,
  normalizeArtifactType,
  type EvidenceBundleV1,
} from "@/lib/evidence-schema";
import { assembleEvidenceBundle, downloadEvidenceJSON } from "@/lib/export/exportEvidenceBundle";
import { downloadEvidencePDF } from "@/lib/export/exportEvidencePDF";
import ProofVerificationSection from "@/components/evidence/ProofVerificationSection";
import { FileText } from "lucide-react";

interface EvidenceArtifactsPanelProps {
  entryId: string;
  sensitivity: string;
  /** When false, export buttons (JSON / PDF certificate) are hidden. */
  canExport?: boolean;
}

interface Artifact {
  id: string;
  artifact_type: string;
  artifact_data: Record<string, any>;
  artifact_hash: string;
  artifact_version?: number;
  text_hash?: string;
  version_graph_hash?: string;
  governance_log_hash?: string;
  created_at: string;
  status: string;
}

const TYPE_META: Record<string, { label: string; icon: any; color: string }> = {
  authorship_continuity: { label: "Continuity", icon: FileCheck, color: "text-emerald-400" },
  ai_influence_map: { label: "AI Influence", icon: Brain, color: "text-violet-400" },
  provenance_graph: { label: "Provenance", icon: Network, color: "text-blue-400" },
  model_behavior: { label: "Models", icon: BarChart3, color: "text-amber-400" },
  confidentiality_boundary: { label: "Confidentiality", icon: Lock, color: "text-rose-400" },
  originality_distance: { label: "Originality", icon: Sparkles, color: "text-primary" },
};

const STATUS_COLORS: Record<string, string> = {
  ready: "border-emerald-500/30 text-emerald-400",
  stale: "border-amber-500/30 text-amber-400",
  failed: "border-destructive/30 text-destructive",
  generating: "border-blue-500/30 text-blue-400",
  pending: "border-muted-foreground/30 text-muted-foreground",
  exported: "border-primary/30 text-primary",
};

function ScoreBar({ label, value, max = 1, invert }: { label: string; value: number; max?: number; invert?: boolean }) {
  const pct = Math.min((value / max) * 100, 100);
  const color = invert
    ? pct > 70 ? "bg-emerald-500" : pct > 40 ? "bg-amber-500" : "bg-destructive"
    : pct > 70 ? "bg-destructive" : pct > 40 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className="text-[10px] font-mono font-semibold">{(value * 100).toFixed(1)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <motion.div className={`h-full rounded-full ${color}`} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }} />
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, sublabel, colorClass }: { icon: any; label: string; value: string; sublabel?: string; colorClass?: string }) {
  return (
    <div className="rounded-lg bg-muted/40 border border-border/20 p-2 text-center space-y-0.5">
      <div className="flex items-center justify-center gap-1">
        <Icon className={`h-3 w-3 ${colorClass || "text-muted-foreground"}`} />
        <span className="text-[9px] font-mono text-muted-foreground">{label}</span>
      </div>
      <span className={`text-sm font-mono font-bold block ${colorClass || "text-foreground"}`}>{value}</span>
      {sublabel && <span className="text-[8px] font-mono text-muted-foreground">{sublabel}</span>}
    </div>
  );
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  return (
    <Badge variant="outline" className={`text-[7px] font-mono px-1 py-0 h-3.5 ${STATUS_COLORS[status] || ""}`}>
      {status}
    </Badge>
  );
}

export default function EvidenceArtifactsPanel({ entryId, sensitivity, canExport = true }: EvidenceArtifactsPanelProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const { isAdmin } = useAuth();

  async function fetchArtifacts() {
    setLoading(true);
    const { data } = await supabase
      .from("artifacts")
      .select("*")
      .eq("entry_id", entryId)
      .order("created_at", { ascending: false });
    // Deduplicate: keep latest per type
    const byType = new Map<string, Artifact>();
    (data || []).forEach((a: any) => {
      const existing = byType.get(a.artifact_type);
      if (!existing || (a.status === "ready" && existing.status !== "ready")) {
        byType.set(a.artifact_type, a);
      }
    });
    setArtifacts(Array.from(byType.values()));
    setLoading(false);
  }

  useEffect(() => { fetchArtifacts(); }, [entryId]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-artifact", {
        body: { entry_id: entryId },
      });
      if (error) throw error;
      toast.success(`Generated ${data?.artifacts?.length || 0} artifacts`);
      await fetchArtifacts();
    } catch (err: any) {
      toast.error("Generation failed: " + (err.message || "Unknown error"));
    } finally {
      setGenerating(false);
    }
  }

  function handleExportJSON() {
    const bundle = assembleEvidenceBundle(entryId, artifacts);
    downloadEvidenceJSON(bundle);
    toast.success("Evidence bundle v1 exported");
  }

  async function handleExportPDF() {
    const bundle = assembleEvidenceBundle(entryId, artifacts);
    try {
      await downloadEvidencePDF(bundle);
      toast.success("Evidence certificate PDF exported");
    } catch (err: any) {
      toast.error("PDF export failed: " + (err.message || "Unknown error"));
    }
  }

  const getArtifact = (type: string) => artifacts.find((a) => a.artifact_type === type);

  // Extract top-level metrics for summary cards
  const continuityArt = getArtifact("authorship_continuity");
  const influenceArt = getArtifact("ai_influence_map");
  const originalityArt = getArtifact("originality_distance");

  const continuityScore = continuityArt ? Number(continuityArt.artifact_data?.continuity_score) : null;
  const continuityLabel = continuityArt?.artifact_data?.continuity_label;
  const driftScore = continuityArt ? Number(continuityArt.artifact_data?.baseline_drift_score || continuityArt.artifact_data?.drift_score) : null;
  const aiInfluence = influenceArt ? Number(influenceArt.artifact_data?.overall_ai_influence) : null;
  const voiceScore = originalityArt ? Number(originalityArt.artifact_data?.voice_stability_score) : null;
  const voiceLabel = originalityArt?.artifact_data?.voice_stability_label;
  const origDistance = originalityArt ? Number(originalityArt.artifact_data?.overall_distance) : null;
  const origRisk = originalityArt?.artifact_data?.originality_risk_label;

  if (loading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  // Evidence readiness check
  const readiness = checkExportReadiness(artifacts);
  const healthLevel = artifacts.length > 0
    ? computeEvidenceHealth({
        authorship_continuity_score: continuityScore ?? undefined,
        ai_influence_ratio: aiInfluence ?? undefined,
        voice_stability_score: voiceScore ?? undefined,
        originality_distance_score: origDistance ?? undefined,
      })
    : "weak";

  return (
    <div className="space-y-3">
      {/* Evidence Readiness Banner */}
      {artifacts.length > 0 && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[10px] font-mono ${
          readiness.ready
            ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
            : "border-amber-500/30 bg-amber-500/5 text-amber-400"
        }`}>
          {readiness.ready ? (
            <><PackageCheck className="h-3.5 w-3.5" /> Export-ready · Schema v{EVIDENCE_SCHEMA_VERSION} · Health: {healthLevel}</>
          ) : (
            <><AlertTriangle className="h-3.5 w-3.5" />
              Not export-ready
              {readiness.missing.length > 0 && <> · Missing: {readiness.missing.join(", ")}</>}
              {readiness.failed.length > 0 && <> · Failed: {readiness.failed.join(", ")}</>}
            </>
          )}
          {/* Integrity hashes */}
          {artifacts[0]?.version_graph_hash && (
            <span className="ml-auto flex items-center gap-1 text-muted-foreground">
              <Hash className="h-2.5 w-2.5" />
              {artifacts[0].version_graph_hash.slice(0, 8)}
            </span>
          )}
        </div>
      )}

      {/* Proof verification — per-item verified / pending / conflicting */}
      {artifacts.length > 0 && (
        <ProofVerificationSection entryId={entryId} />
      )}

      {/* Actions row */}
      <div className="flex items-center gap-2 flex-wrap">
        {isAdmin && (
          <Button
            size="sm" variant="outline"
            className="text-[10px] h-6 px-2 gap-1 font-mono"
            disabled={generating}
            onClick={handleGenerate}
          >
            {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Generate Artifacts
          </Button>
        )}
        {artifacts.length > 0 && canExport && (
          <>
            <Button size="sm" variant="ghost" className="text-[10px] h-6 px-2 gap-1 font-mono" onClick={handleExportJSON}>
              <Download className="h-3 w-3" /> JSON
            </Button>
            <Button size="sm" variant="ghost" className="text-[10px] h-6 px-2 gap-1 font-mono" onClick={handleExportPDF}>
              <FileText className="h-3 w-3" /> PDF Certificate
            </Button>
          </>
        )}
        <Badge variant="outline" className="text-[9px] font-mono ml-auto">
          {artifacts.length} artifact{artifacts.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      {/* ─── Top Metric Cards ─── */}
      {artifacts.length > 0 && (
        <div className="grid grid-cols-5 gap-1.5">
          <MetricCard
            icon={FileCheck} label="Continuity"
            value={continuityScore != null ? `${(continuityScore * 100).toFixed(0)}%` : "—"}
            sublabel={continuityLabel}
            colorClass={continuityScore != null ? (continuityScore >= 0.7 ? "text-emerald-400" : continuityScore >= 0.4 ? "text-amber-400" : "text-destructive") : undefined}
          />
          <MetricCard
            icon={Activity} label="Drift"
            value={driftScore != null ? `${(driftScore * 100).toFixed(0)}%` : "—"}
            colorClass={driftScore != null ? (driftScore < 0.3 ? "text-emerald-400" : driftScore < 0.6 ? "text-amber-400" : "text-destructive") : undefined}
          />
          <MetricCard
            icon={Mic} label="Voice"
            value={voiceScore != null ? `${(voiceScore * 100).toFixed(0)}%` : "—"}
            sublabel={voiceLabel}
            colorClass={voiceScore != null ? (voiceScore >= 0.7 ? "text-emerald-400" : voiceScore >= 0.4 ? "text-amber-400" : "text-destructive") : undefined}
          />
          <MetricCard
            icon={Brain} label="AI Influence"
            value={aiInfluence != null ? `${(aiInfluence * 100).toFixed(0)}%` : "—"}
            colorClass={aiInfluence != null ? (aiInfluence < 0.3 ? "text-emerald-400" : aiInfluence < 0.7 ? "text-violet-400" : "text-destructive") : undefined}
          />
          <MetricCard
            icon={Target} label="Originality"
            value={origDistance != null ? `${(origDistance * 100).toFixed(0)}%` : "—"}
            sublabel={origRisk}
            colorClass={origRisk === "low" ? "text-emerald-400" : origRisk === "moderate" ? "text-amber-400" : origRisk === "high" ? "text-destructive" : undefined}
          />
        </div>
      )}

      {artifacts.length === 0 ? (
        <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground rounded-lg border border-border/30 bg-card/60">
          <Shield className="h-4 w-4" />
          <span>No evidence artifacts generated yet.{isAdmin ? " Click 'Generate Artifacts' to create them." : ""}</span>
        </div>
      ) : (
        <Tabs defaultValue={artifacts[0]?.artifact_type || "authorship_continuity"} className="w-full">
          <TabsList className="w-full flex-wrap h-auto gap-0.5 bg-muted/20 p-1">
            {Object.entries(TYPE_META).map(([type, meta]) => {
              const art = getArtifact(type);
              return (
                <TabsTrigger key={type} value={type} disabled={!art} className="text-[9px] gap-1 px-2 py-1 font-mono">
                  <meta.icon className={`h-2.5 w-2.5 ${art ? meta.color : "text-muted-foreground/30"}`} />
                  {meta.label}
                  {art && <StatusBadge status={art.status} />}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {/* Authorship Continuity */}
          <TabsContent value="authorship_continuity" className="mt-3 space-y-3">
            {(() => {
              const a = getArtifact("authorship_continuity");
              if (!a) return null;
              const d = a.artifact_data;
              const curve = d.stability_curve || [];
              return (
                <>
                  <div className="grid grid-cols-4 gap-2">
                    <div className="rounded-lg bg-muted/40 p-2 text-center">
                      <span className="text-[9px] font-mono text-muted-foreground block">Continuity</span>
                      <span className={`text-sm font-mono font-bold ${Number(d.continuity_score) >= 0.7 ? "text-emerald-400" : Number(d.continuity_score) >= 0.4 ? "text-amber-400" : "text-destructive"}`}>
                        {(Number(d.continuity_score) * 100).toFixed(1)}%
                      </span>
                      {d.continuity_label && <Badge variant="outline" className="text-[7px] font-mono mt-0.5">{d.continuity_label}</Badge>}
                    </div>
                    <div className="rounded-lg bg-muted/40 p-2 text-center">
                      <span className="text-[9px] font-mono text-muted-foreground block">Baseline Drift</span>
                      <span className={`text-sm font-mono font-bold ${Number(d.baseline_drift_score || d.drift_score) < 0.3 ? "text-emerald-400" : "text-amber-400"}`}>
                        {(Number(d.baseline_drift_score || d.drift_score) * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-2 text-center">
                      <span className="text-[9px] font-mono text-muted-foreground block">Cumulative</span>
                      <span className="text-sm font-mono font-bold text-foreground">
                        {d.cumulative_drift_score != null ? `${(Number(d.cumulative_drift_score) * 100).toFixed(1)}%` : "—"}
                      </span>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-2 text-center">
                      <span className="text-[9px] font-mono text-muted-foreground block">Revisions</span>
                      <span className="text-sm font-mono font-bold text-foreground">{d.revision_count}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 text-[9px] font-mono text-muted-foreground">
                    <span>Human: {d.human_version_count}</span>
                    <span>AI: {d.ai_version_count}</span>
                  </div>

                  {/* Drift Over Time Chart */}
                  {curve.length > 1 && (
                    <div className="space-y-1">
                      <h4 className="text-[10px] font-mono text-muted-foreground uppercase">Drift Over Time</h4>
                      <div className="h-32 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={curve.map((pt: any, i: number) => ({ version: `v${i + 1}`, drift: pt.semantic_drift, voice: pt.voice_stability }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                            <XAxis dataKey="version" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                            <YAxis domain={[0, 1]} tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                            <Tooltip contentStyle={{ fontSize: 10, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                            <Line type="monotone" dataKey="drift" stroke="hsl(var(--destructive))" strokeWidth={1.5} dot={{ r: 2 }} name="Drift" />
                            <Line type="monotone" dataKey="voice" stroke="#34d399" strokeWidth={1.5} dot={{ r: 2 }} name="Voice" />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {curve.length > 0 && (
                    <div className="space-y-1.5">
                      <h4 className="text-[10px] font-mono text-muted-foreground uppercase">Stability Curve</h4>
                      {curve.map((pt: any, i: number) => (
                        <ScoreBar key={i} label={`v${i + 1}`} value={pt.voice_stability} invert />
                      ))}
                    </div>
                  )}
                  <HashFooter hash={a.artifact_hash} date={a.created_at} />
                </>
              );
            })()}
          </TabsContent>

          {/* AI Influence Map */}
          <TabsContent value="ai_influence_map" className="mt-3 space-y-3">
            {(() => {
              const a = getArtifact("ai_influence_map");
              if (!a) return null;
              const d = a.artifact_data;
              return (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-muted/40 p-2 text-center">
                      <span className="text-[9px] font-mono text-muted-foreground block">AI Influence</span>
                      <span className="text-sm font-mono font-bold text-violet-400">
                        {(Number(d.overall_ai_influence) * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-2 text-center">
                      <span className="text-[9px] font-mono text-muted-foreground block">Human Ratio</span>
                      <span className="text-sm font-mono font-bold text-emerald-400">
                        {(Number(d.overall_human_ratio) * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-3 text-[9px] font-mono text-muted-foreground">
                    <span>AI Events: {d.ai_rewrite_event_count ?? "—"}</span>
                    <span>Human Edits: {d.human_edit_count ?? "—"}</span>
                    <span>Restoration: {d.human_restoration_factor != null ? `${(Number(d.human_restoration_factor) * 100).toFixed(0)}%` : "—"}</span>
                  </div>
                  {d.per_version?.length > 0 && (
                    <div className="space-y-1.5">
                      <h4 className="text-[10px] font-mono text-muted-foreground uppercase">Per Version</h4>
                      {d.per_version.map((v: any, i: number) => (
                        <div key={i} className="space-y-0.5">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-muted-foreground">v{i + 1}</span>
                            <div className="flex gap-2">
                              <span className="font-mono text-violet-400">{(v.ai_token_ratio * 100).toFixed(0)}% AI</span>
                              <span className="font-mono text-emerald-400">{(v.human_edit_ratio * 100).toFixed(0)}% Human</span>
                            </div>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden flex">
                            <div className="h-full bg-violet-500" style={{ width: `${v.ai_token_ratio * 100}%` }} />
                            <div className="h-full bg-emerald-500" style={{ width: `${v.human_edit_ratio * 100}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <HashFooter hash={a.artifact_hash} date={a.created_at} />
                </>
              );
            })()}
          </TabsContent>

          {/* Provenance Graph */}
          <TabsContent value="provenance_graph" className="mt-3 space-y-3">
            {(() => {
              const a = getArtifact("provenance_graph");
              if (!a) return null;
              const d = a.artifact_data;
              return (
                <>
                  <div className="flex gap-3 text-xs">
                    <Badge variant="outline" className="text-[9px] font-mono">{d.node_count} nodes</Badge>
                    <Badge variant="outline" className="text-[9px] font-mono">{d.edge_count} edges</Badge>
                  </div>
                  <ScrollArea className="max-h-48">
                    <div className="space-y-1">
                      {d.nodes?.map((n: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 rounded bg-muted/20 px-2 py-1">
                          <Badge variant="outline" className="text-[8px] font-mono shrink-0">{n.node_type}</Badge>
                          <span className="text-[10px] text-foreground truncate">{n.label}</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                  {d.edges?.length > 0 && (
                    <div className="space-y-1">
                      <h4 className="text-[10px] font-mono text-muted-foreground uppercase">Edges</h4>
                      {d.edges.map((e: any, i: number) => (
                        <div key={i} className="text-[9px] font-mono text-muted-foreground">
                          {e.from.slice(0, 8)}… → {e.to.slice(0, 8)}… <span className="text-primary">({e.edge_type})</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <HashFooter hash={a.artifact_hash} date={a.created_at} />
                </>
              );
            })()}
          </TabsContent>

          {/* Model Behavior */}
          <TabsContent value="model_behavior" className="mt-3 space-y-3">
            {(() => {
              const a = getArtifact("model_behavior");
              if (!a) return null;
              const d = a.artifact_data;
              return (
                <>
                  <Badge variant="outline" className="text-[9px] font-mono">
                    {d.total_model_interactions} interactions
                  </Badge>
                  {d.models?.map((m: any, i: number) => (
                    <div key={i} className="rounded-lg border border-border/30 bg-card/60 p-2 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono font-semibold">{m.model_id.split("/").pop()}</span>
                        {m.hallucination_flag && (
                          <Badge variant="outline" className="text-[8px] font-mono border-destructive/30 text-destructive gap-0.5">
                            <AlertTriangle className="h-2 w-2" /> High Drift
                          </Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 text-[9px] font-mono text-muted-foreground">
                        <span>Events: {m.event_count}</span>
                        <span>Avg Output: {m.output_length_avg}</span>
                        <span>Drift: {(m.semantic_distance * 100).toFixed(1)}%</span>
                        <span>Tone Shift: {(m.tone_shift_score * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                  ))}
                  <HashFooter hash={a.artifact_hash} date={a.created_at} />
                </>
              );
            })()}
          </TabsContent>

          {/* Confidentiality Boundary */}
          <TabsContent value="confidentiality_boundary" className="mt-3 space-y-3">
            {(() => {
              const a = getArtifact("confidentiality_boundary");
              if (!a) return null;
              const d = a.artifact_data;
              const isConfidential = d.confidentiality_mode !== "standard";
              return (
                <>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-[9px] font-mono ${isConfidential ? "border-rose-500/30 text-rose-400" : "border-emerald-500/30 text-emerald-400"}`}>
                      {isConfidential ? <Lock className="h-2.5 w-2.5 mr-0.5" /> : <CheckCircle className="h-2.5 w-2.5 mr-0.5" />}
                      {d.confidentiality_mode}
                    </Badge>
                  </div>
                  <div className="space-y-1 text-[10px] font-mono text-muted-foreground">
                    <div>Providers: {d.providers_used?.join(", ") || "None"}</div>
                    <div>Models: {d.models_used?.join(", ") || "None"}</div>
                    <div>Privacy Modes: {d.privacy_modes_active?.join(", ") || "None"}</div>
                    <div>External Tools: {d.external_tool_usage ? "Yes" : "No"}</div>
                  </div>
                  {d.routing_decisions?.length > 0 && (
                    <div className="space-y-1">
                      <h4 className="text-[10px] font-mono text-muted-foreground uppercase">Routing Decisions</h4>
                      {d.routing_decisions.map((r: any, i: number) => (
                        <div key={i} className="text-[9px] font-mono text-muted-foreground">
                          {r.reason} → {r.model?.split("/").pop() || "?"}
                        </div>
                      ))}
                    </div>
                  )}
                  <HashFooter hash={a.artifact_hash} date={a.created_at} />
                </>
              );
            })()}
          </TabsContent>

          {/* Originality Distance + Structural Integrity */}
          <TabsContent value="originality_distance" className="mt-3 space-y-3">
            {(() => {
              const a = getArtifact("originality_distance");
              if (!a) return null;
              const d = a.artifact_data;
              return (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-muted/40 p-2 text-center">
                      <span className="text-[9px] font-mono text-muted-foreground block">Distance</span>
                      <span className="text-sm font-mono font-bold text-primary">
                        {(Number(d.overall_distance) * 100).toFixed(1)}%
                      </span>
                      {d.originality_risk_label && (
                        <Badge variant="outline" className={`text-[7px] font-mono mt-0.5 ${
                          d.originality_risk_label === "low" ? "text-emerald-400 border-emerald-500/30" :
                          d.originality_risk_label === "moderate" ? "text-amber-400 border-amber-500/30" :
                          "text-destructive border-destructive/30"
                        }`}>{d.originality_risk_label} risk</Badge>
                      )}
                    </div>
                    <div className="rounded-lg bg-muted/40 p-2 text-center">
                      <span className="text-[9px] font-mono text-muted-foreground block">Novelty</span>
                      <span className="text-sm font-mono font-bold text-amber-400">
                        {(Number(d.overall_novelty) * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  {/* Voice Stability */}
                  {d.voice_stability_score != null && (
                    <div className="rounded-lg border border-border/20 bg-muted/20 p-2 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <Mic className="h-3 w-3 text-muted-foreground" />
                        <span className="text-[10px] font-mono text-muted-foreground uppercase">Voice Stability</span>
                        {d.voice_stability_label && <Badge variant="outline" className="text-[7px] font-mono">{d.voice_stability_label}</Badge>}
                      </div>
                      <ScoreBar label="Voice" value={Number(d.voice_stability_score)} invert />
                    </div>
                  )}

                  {/* Structural Integrity */}
                  {d.structural_integrity_score != null && (
                    <div className="rounded-lg border border-border/20 bg-muted/20 p-2 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <Layers className="h-3 w-3 text-muted-foreground" />
                        <span className="text-[10px] font-mono text-muted-foreground uppercase">Structural Integrity</span>
                      </div>
                      <ScoreBar label="Structure" value={Number(d.structural_integrity_score)} invert />
                      {d.structural_flags?.length > 0 && (
                        <div className="flex gap-1 flex-wrap mt-1">
                          {d.structural_flags.map((flag: string, i: number) => (
                            <Badge key={i} variant="outline" className="text-[7px] font-mono border-amber-500/30 text-amber-400 gap-0.5">
                              <AlertTriangle className="h-2 w-2" />
                              {flag.replace(/_/g, " ")}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {d.per_version?.length > 0 && (
                    <div className="space-y-1.5">
                      <h4 className="text-[10px] font-mono text-muted-foreground uppercase">Per Version</h4>
                      {d.per_version.map((v: any, i: number) => (
                        <div key={i} className="space-y-1">
                          <ScoreBar label={`v${i + 1} distance`} value={v.distance_score} />
                          <ScoreBar label={`v${i + 1} novelty`} value={v.novelty_index} />
                        </div>
                      ))}
                    </div>
                  )}
                  <HashFooter hash={a.artifact_hash} date={a.created_at} />
                </>
              );
            })()}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function HashFooter({ hash, date, version, integrityHashes }: {
  hash: string;
  date: string;
  version?: number;
  integrityHashes?: { text?: string; versionGraph?: string; governance?: string };
}) {
  return (
    <div className="space-y-1 mt-2">
      <div className="flex items-center gap-2 rounded-md border border-border/30 bg-card/60 px-2 py-1">
        <FileCheck className="h-3 w-3 text-emerald-500 shrink-0" />
        <span className="text-[8px] font-mono text-muted-foreground truncate">
          {hash.slice(0, 16)}…{hash.slice(-8)}
        </span>
        {version && (
          <Badge variant="outline" className="text-[7px] font-mono px-1 py-0 h-3.5">
            v{version}
          </Badge>
        )}
        <span className="text-[8px] font-mono text-muted-foreground ml-auto shrink-0">
          {new Date(date).toLocaleDateString()}
        </span>
      </div>
      {integrityHashes && (integrityHashes.text || integrityHashes.versionGraph || integrityHashes.governance) && (
        <div className="flex items-center gap-3 px-2 text-[7px] font-mono text-muted-foreground/60">
          <Hash className="h-2.5 w-2.5 shrink-0" />
          {integrityHashes.text && <span title="Text hash">txt:{integrityHashes.text.slice(0, 8)}</span>}
          {integrityHashes.versionGraph && <span title="Version graph hash">vg:{integrityHashes.versionGraph.slice(0, 8)}</span>}
          {integrityHashes.governance && <span title="Governance hash">gov:{integrityHashes.governance.slice(0, 8)}</span>}
        </div>
      )}
    </div>
  );
}
