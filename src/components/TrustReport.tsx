/**
 * TrustReport — human-readable trust layer for an entry.
 * Surfaces evaluation, scoring, stability, provenance, model involvement,
 * artifact readiness, and integrity references in accessible language.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Shield, CheckCircle2, AlertTriangle, Clock, GitBranch,
  Brain, Activity, FileCheck, Hash, Info,
} from "lucide-react";
import { normalizeArtifactType, ARTIFACT_TYPE_META, type CanonicalArtifactType } from "@/lib/evidence-schema";
import { readScorecard, type ScorecardSource } from "@/lib/entryScorecard";
import { ScorecardTransparencyPanel } from "@/components/judges/ScorecardTransparencyPanel";

interface TrustReportProps {
  entryId: string;
  compact?: boolean;
}

interface TrustData {
  entry: { title: string; status: string; created_at: string; method_type: string; model_used: string | null; sensitivity: string } | null;
  scores: { total_score: number } | null;
  scoreSource: ScorecardSource;
  gradingCount: number;
  artifacts: { artifact_type: string; status: string; artifact_hash: string; artifact_version: number; created_at: string; text_hash: string | null; version_graph_hash: string | null; governance_log_hash: string | null }[];
  versionCount: number;
  humanVersions: number;
  aiVersions: number;
  govEventCount: number;
  modelsUsed: string[];
  influenceScore: number | null;
  voiceStability: number | null;
  stabilityLabel: string | null;
}

const HEALTH_COLORS: Record<string, string> = {
  strong: "text-emerald-500",
  moderate: "text-amber-500",
  weak: "text-destructive",
};

function TrustRow({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-mono text-muted-foreground mb-0.5">{label}</p>
        <div className="text-sm text-foreground">{children}</div>
      </div>
    </div>
  );
}

export default function TrustReport({ entryId, compact = false }: TrustReportProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TrustData | null>(null);
  const [tab, setTab] = useState<"overview" | "transparency">("overview");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [entryRes, scorecard, gradingRes, artifactsRes, versionsRes, govRes, influenceRes, driftRes] = await Promise.all([
        supabase.from("entries").select("title, status, created_at, method_type, model_used, sensitivity").eq("id", entryId).maybeSingle(),
        readScorecard(entryId),
        supabase.from("grading_reports").select("id, model_id").eq("entry_id", entryId),
        supabase.from("artifacts").select("artifact_type, status, artifact_hash, artifact_version, created_at, text_hash, version_graph_hash, governance_log_hash").eq("entry_id", entryId),
        supabase.from("screenplay_versions").select("id, actor_type").eq("entry_id", entryId),
        supabase.from("governance_events").select("id, model_name").eq("entry_id", entryId),
        supabase.from("influence_scores").select("ai_influence_score, voice_stability_score").eq("entry_id", entryId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("voice_drift_analysis" as any).select("drift_score").eq("entry_id", entryId).maybeSingle(),
      ]);
      if (cancelled) return;

      const versions = versionsRes.data || [];
      const govEvents = govRes.data || [];
      const models = new Set<string>();
      (gradingRes.data || []).forEach((r: any) => models.add(r.model_id));
      govEvents.forEach((e: any) => { if (e.model_name) models.add(e.model_name); });

      setData({
        entry: entryRes.data as any,
        scores: scorecard?.total_score != null ? { total_score: scorecard.total_score } : null,
        scoreSource: scorecard?.source ?? "none",
        gradingCount: (gradingRes.data || []).length,
        artifacts: (artifactsRes.data || []) as any,
        versionCount: versions.length,
        humanVersions: versions.filter((v: any) => v.actor_type === "human").length,
        aiVersions: versions.filter((v: any) => v.actor_type === "ai").length,
        govEventCount: govEvents.length,
        modelsUsed: Array.from(models),
        influenceScore: (influenceRes.data as any)?.ai_influence_score ?? null,
        voiceStability: (influenceRes.data as any)?.voice_stability_score ?? null,
        stabilityLabel: null,
      });
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [entryId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/80 p-5 space-y-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (!data || !data.entry) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/80 p-5">
        <p className="text-sm text-muted-foreground">Trust report data is not available for this entry.</p>
      </div>
    );
  }

  const readyArtifacts = data.artifacts.filter(a => a.status === "ready" || a.status === "exported");
  const failedArtifacts = data.artifacts.filter(a => a.status === "failed");
  const staleArtifacts = data.artifacts.filter(a => a.status === "stale");
  const hasIntegrity = data.artifacts.some(a => a.text_hash || a.version_graph_hash || a.governance_log_hash);

  const overallHealth = readyArtifacts.length >= 3 && failedArtifacts.length === 0
    ? "strong"
    : failedArtifacts.length > 0
      ? "weak"
      : "moderate";

  const influenceLabel = data.influenceScore == null
    ? "Not measured"
    : data.influenceScore > 0.8
      ? "High AI influence detected"
      : data.influenceScore > 0.4
        ? "Moderate AI involvement"
        : "Low AI influence";

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-primary" />
        <h3 className="font-display text-sm font-bold tracking-tight">Trust Report</h3>
        <Badge variant="outline" className={`ml-auto text-[10px] font-mono ${HEALTH_COLORS[overallHealth]}`}>
          {overallHealth === "strong" ? "✓ Strong" : overallHealth === "moderate" ? "◐ Moderate" : "⚠ Weak"}
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        This report summarizes how this screenplay was analyzed, what signals were observed,
        and what evidence supports the outcome. All data comes from canonical platform records.
      </p>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "overview" | "transparency")} className="w-full">
        <TabsList className="grid w-full grid-cols-2 h-8">
          <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
          <TabsTrigger value="transparency" className="text-xs">Transparency</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-3 space-y-4">
          <Separator className="opacity-50" />

          {/* Evaluation Summary */}
          <div>
        <p className="text-xs font-display font-semibold text-foreground mb-1">Evaluation Summary</p>
        <TrustRow icon={CheckCircle2} label="Status">
          <Badge variant="outline" className="text-[10px] font-mono capitalize">{data.entry.status}</Badge>
        </TrustRow>
        <TrustRow icon={Activity} label="Grading Passes">
          {data.gradingCount} evaluation{data.gradingCount !== 1 ? "s" : ""} completed
        </TrustRow>
        {data.scores && (
          <TrustRow icon={FileCheck} label="Composite Signal">
            {data.scores.total_score} / 100
          </TrustRow>
        )}
        <TrustRow icon={Clock} label="Submitted">
          {new Date(data.entry.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
        </TrustRow>
      </div>

      <Separator className="opacity-50" />

      {/* AI Involvement */}
      <div>
        <p className="text-xs font-display font-semibold text-foreground mb-1">AI Involvement</p>
        <TrustRow icon={Brain} label="Writing Method">
          <span className="capitalize">{data.entry.method_type === "ai" ? "AI-generated" : data.entry.method_type === "hybrid" ? "Human–AI hybrid" : "Human-written"}</span>
        </TrustRow>
        <TrustRow icon={Brain} label="AI Influence">
          {influenceLabel}
          {data.influenceScore != null && (
            <span className="ml-2 text-xs font-mono text-muted-foreground">({Math.round(data.influenceScore * 100)}%)</span>
          )}
        </TrustRow>
        {data.voiceStability != null && (
          <TrustRow icon={Activity} label="Voice Stability">
            {data.voiceStability >= 0.7 ? "Stable" : data.voiceStability >= 0.4 ? "Moderate drift" : "Significant drift"}
            <span className="ml-2 text-xs font-mono text-muted-foreground">({Math.round(data.voiceStability * 100)}%)</span>
          </TrustRow>
        )}
        {data.modelsUsed.length > 0 && (
          <TrustRow icon={Brain} label="Models Used">
            <div className="flex flex-wrap gap-1">
              {data.modelsUsed.map(m => (
                <Badge key={m} variant="outline" className="text-[9px] font-mono">{m.split("/").pop()}</Badge>
              ))}
            </div>
          </TrustRow>
        )}
      </div>

      <Separator className="opacity-50" />

      {/* Provenance */}
      <div>
        <p className="text-xs font-display font-semibold text-foreground mb-1">Provenance</p>
        <TrustRow icon={GitBranch} label="Version History">
          {data.versionCount} version{data.versionCount !== 1 ? "s" : ""} recorded
          {data.versionCount > 0 && (
            <span className="text-xs text-muted-foreground ml-1">
              ({data.humanVersions} human, {data.aiVersions} AI)
            </span>
          )}
        </TrustRow>
        <TrustRow icon={Shield} label="Governance Events">
          {data.govEventCount} decision{data.govEventCount !== 1 ? "s" : ""} logged
        </TrustRow>
      </div>

      <Separator className="opacity-50" />

      {/* Artifact Readiness */}
      <div>
        <p className="text-xs font-display font-semibold text-foreground mb-1">Artifact Readiness</p>
        <div className="grid grid-cols-2 gap-2">
          {data.artifacts.map((a, i) => {
            const canonical = normalizeArtifactType(a.artifact_type);
            const meta = ARTIFACT_TYPE_META[canonical as CanonicalArtifactType];
            const statusColor = a.status === "ready" || a.status === "exported"
              ? "text-emerald-500"
              : a.status === "failed"
                ? "text-destructive"
                : "text-amber-500";
            return (
              <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-border/30 bg-muted/20 text-xs">
                <span className={statusColor}>
                  {a.status === "ready" || a.status === "exported" ? "✓" : a.status === "failed" ? "✗" : "◐"}
                </span>
                <span className="truncate">{meta?.label || a.artifact_type}</span>
                <span className="ml-auto text-[9px] font-mono text-muted-foreground">v{a.artifact_version}</span>
              </div>
            );
          })}
        </div>
        {data.artifacts.length === 0 && (
          <p className="text-xs text-muted-foreground">No artifacts have been generated yet.</p>
        )}
      </div>

      {/* Integrity References */}
      {hasIntegrity && !compact && (
        <>
          <Separator className="opacity-50" />
          <div>
            <p className="text-xs font-display font-semibold text-foreground mb-1">Integrity References</p>
            {data.artifacts.filter(a => a.text_hash || a.artifact_hash).slice(0, 1).map((a, i) => (
              <div key={i} className="space-y-1">
                {a.artifact_hash && (
                  <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                    <Hash className="h-3 w-3" />
                    <span>Artifact: {a.artifact_hash.slice(0, 16)}…</span>
                  </div>
                )}
                {a.text_hash && (
                  <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                    <Hash className="h-3 w-3" />
                    <span>Text: {a.text_hash.slice(0, 16)}…</span>
                  </div>
                )}
                {a.version_graph_hash && (
                  <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                    <Hash className="h-3 w-3" />
                    <span>Lineage: {a.version_graph_hash.slice(0, 16)}…</span>
                  </div>
                )}
                {a.governance_log_hash && (
                  <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                    <Hash className="h-3 w-3" />
                    <span>Governance: {a.governance_log_hash.slice(0, 16)}…</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

          {/* Transparency Note */}
          <Separator className="opacity-50" />
          <div className="flex items-start gap-2 text-[10px] text-muted-foreground">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            <p>
              Scores, stability indicators, and provenance data are presented as analytical signals —
              not guarantees. All evaluation data is generated by AI models and stored as canonical platform records.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="transparency" className="mt-3 space-y-3">
          <ScorecardTransparencyPanel
            entryId={entryId}
            paused={tab !== "transparency"}
          />
          <div className="flex items-start gap-2 text-[10px] text-muted-foreground">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            <p>
              Same unified total shown above, expanded with the exact grading tier
              (finalized · panel consensus · grading reports), contributor counts,
              rubric version, and per-dimension breakdown that produced it.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
