import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Terminal, ClipboardCheck, Server, BookOpen, Gauge, Package } from "lucide-react";
import ActivityLogPanel from "@/components/admin/ActivityLogPanel";
import SystemAuditPanel from "@/components/admin/SystemAuditPanel";
import SystemArchitecturePanel from "@/components/admin/SystemArchitecturePanel";
import LighthouseAuditPanel from "@/components/admin/LighthouseAuditPanel";
import AssetRegistryPanel from "@/components/admin/AssetRegistryPanel";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface WorkLogItem {
  phase: string;
  title: string;
  status: "done" | "in-progress" | "pending";
  items: { task: string; done: boolean }[];
  cost?: string;
}

// Deployment-specific operational history is deliberately not bundled.
const WORK_LOG: WorkLogItem[] = [];

interface MetricDef {
  name: string;
  unit: string;
  source: string;
  description: string;
  thresholds: { safe: string; warn: string; critical: string };
  interpretation: string;
}

const METRIC_DEFINITIONS: MetricDef[] = [
  {
    name: "voice_similarity_score",
    unit: "0.0–1.0 (ratio)",
    source: "voice-drift edge fn",
    description: "Cosine similarity between the writer's baseline voice embedding and the current version. Measures how consistently the author's unique style is maintained across drafts.",
    thresholds: { safe: ">= 0.85", warn: "0.60–0.84", critical: "< 0.60" },
    interpretation: "Low scores suggest significant stylistic deviation — possible heavy AI rewrite or ghost-writing. Pair with ai_influence_score for context.",
  },
  {
    name: "ai_influence_ratio",
    unit: "0.0–1.0 (ratio)",
    source: "ai-judge edge fn",
    description: "Proportion of the text estimated to be AI-generated or heavily AI-influenced, based on perplexity analysis and token-level attribution.",
    thresholds: { safe: "<= 0.30", warn: "0.31–0.60", critical: "> 0.60" },
    interpretation: "Values above 0.60 trigger governance review. A ratio of 1.0 = fully AI-generated. Must be cross-referenced with method_type on the entry.",
  },
  {
    name: "semantic_drift",
    unit: "0.0–1.0 (distance)",
    source: "voice-drift edge fn",
    description: "Euclidean distance between semantic embeddings of consecutive versions. Captures how much the meaning/intent has shifted between drafts.",
    thresholds: { safe: "<= 0.20", warn: "0.21–0.45", critical: "> 0.45" },
    interpretation: "High drift between minor drafts may indicate AI injection. Expected to be higher between major rewrites (check draft_number).",
  },
  {
    name: "originality_distance",
    unit: "0.0–1.0 (distance)",
    source: "ai-judge edge fn",
    description: "Normalized distance from nearest known reference work in the training corpus. Higher = more original. Measures creative differentiation.",
    thresholds: { safe: ">= 0.70", warn: "0.40–0.69", critical: "< 0.40" },
    interpretation: "Low scores may indicate derivative work or unattributed influence. Not a plagiarism detector — use with provenance graph for full picture.",
  },
  {
    name: "structural_integrity",
    unit: "0–100 (score)",
    source: "parse-screenplay edge fn",
    description: "Adherence to standard screenplay formatting rules (slug lines, transitions, character cues, page breaks). Based on Fountain parser validation.",
    thresholds: { safe: ">= 85", warn: "60–84", critical: "< 60" },
    interpretation: "Low scores typically mean formatting issues, not creative problems. Auto-fixable in many cases. Affects competition eligibility.",
  },
  {
    name: "structure_variance",
    unit: "0.0–1.0 (coefficient of variation)",
    source: "ai-judge edge fn",
    description: "Statistical variance of act/sequence/scene lengths relative to industry norms. Measures structural balance and pacing consistency.",
    thresholds: { safe: "<= 0.25", warn: "0.26–0.50", critical: "> 0.50" },
    interpretation: "High variance = uneven pacing. May be intentional (experimental structure) or problematic (unfocused narrative). Check genre context.",
  },
  {
    name: "confidence_score",
    unit: "0.0–1.0 (ratio)",
    source: "ai-judge edge fn",
    description: "Meta-metric: the AI judge's self-assessed confidence in the accuracy of its own evaluation run. Based on input quality, token coverage, and prompt clarity.",
    thresholds: { safe: ">= 0.80", warn: "0.50–0.79", critical: "< 0.50" },
    interpretation: "Low confidence means the evaluation should be treated as provisional. May warrant re-evaluation with a different model or manual review.",
  },
];

function WorkLogPanel() {
  return (
    <ScrollArea className="h-[600px]">
      <div className="space-y-4">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-foreground mb-1">Workspace Work Log</h3>
          <p className="text-[11px] text-muted-foreground">
            No deployment work history is bundled with this public source release. Review your workspace activity and verification records below.
          </p>
        </div>

        {WORK_LOG.map((phase) => {
          const completedCount = phase.items.filter(i => i.done).length;
          return (
            <div key={phase.phase} className="rounded-xl border border-border/50 bg-card/80 p-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px] font-mono">Phase {phase.phase}</Badge>
                <span className="text-sm font-semibold">{phase.title}</span>
                <Badge
                  variant="outline"
                  className={`text-[10px] font-mono ml-auto ${
                    phase.status === "done"
                      ? "text-emerald-500 border-emerald-500/30"
                      : phase.status === "in-progress"
                      ? "text-amber-500 border-amber-500/30"
                      : "text-muted-foreground border-border"
                  }`}
                >
                  {phase.status}
                </Badge>
                {phase.cost && (
                  <span className="text-[10px] text-muted-foreground font-mono">{phase.cost}</span>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground font-mono">
                {completedCount}/{phase.items.length} tasks
              </div>
              <div className="space-y-1">
                {phase.items.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className={`shrink-0 mt-0.5 ${item.done ? "text-emerald-500" : "text-muted-foreground"}`}>
                      {item.done ? "✓" : "○"}
                    </span>
                    <span className={item.done ? "text-muted-foreground" : "text-foreground"}>{item.task}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Artifact Metric Standard Definitions */}
        <div className="rounded-xl border border-border/50 bg-card/80 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/30 bg-muted/20">
            <p className="text-xs font-semibold text-foreground flex items-center gap-2">
              <span className="text-primary">◆</span> Artifact Metric Standard Definitions
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Canonical metric names, units, thresholds, and interpretation guide for artifact_metrics table.
            </p>
          </div>
          <div className="p-4 space-y-3">
            {METRIC_DEFINITIONS.map((m) => (
              <div key={m.name} className="rounded-lg border border-border/30 bg-muted/10 p-3 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-semibold text-primary">{m.name}</span>
                  <Badge variant="outline" className="text-[9px] font-mono">{m.unit}</Badge>
                  <Badge variant="outline" className="text-[9px] font-mono text-muted-foreground">{m.source}</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">{m.description}</p>
                <div className="flex gap-4 text-[10px] font-mono">
                  <span className="text-emerald-500">safe: {m.thresholds.safe}</span>
                  <span className="text-amber-500">warn: {m.thresholds.warn}</span>
                  <span className="text-destructive">critical: {m.thresholds.critical}</span>
                </div>
                <p className="text-[10px] text-muted-foreground/70 italic">{m.interpretation}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2">
          <p className="text-xs font-semibold text-primary">Canonical Table Map</p>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            {[
              ["screenplay_versions", "Creative lineage"],
              ["governance_events", "Governance decisions"],
              ["provenance_nodes/edges", "Knowledge graph"],
              ["artifacts / artifact_metrics", "Computed interpretations"],
              ["influence_scores", "Per-version raw scores"],
              ["ai_usage_log", "Model telemetry"],
              ["audit_log", "Platform/admin actions"],
            ].map(([table, desc]) => (
              <div key={table} className="flex items-center gap-1.5">
                <span className="font-mono text-primary">{table}</span>
                <span className="text-muted-foreground">→ {desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

export default function DeveloperLogPanel() {
  return (
    <div className="space-y-4">
      <Tabs defaultValue="activity" className="w-full">
        <TabsList className="w-full justify-start bg-muted/50 border border-border/30 rounded-xl p-1 h-auto">
          <TabsTrigger value="activity" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-4 py-2">
            <Terminal className="h-3.5 w-3.5" /> Activity Log
          </TabsTrigger>
          <TabsTrigger value="audits" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-4 py-2">
            <ClipboardCheck className="h-3.5 w-3.5" /> System Audits
          </TabsTrigger>
          <TabsTrigger value="architecture" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-4 py-2">
            <Server className="h-3.5 w-3.5" /> Architecture
          </TabsTrigger>
          <TabsTrigger value="worklog" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-4 py-2">
            <BookOpen className="h-3.5 w-3.5" /> Work Log
          </TabsTrigger>
          <TabsTrigger value="lighthouse" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-4 py-2">
            <Gauge className="h-3.5 w-3.5" /> Lighthouse
          </TabsTrigger>
          <TabsTrigger value="assets" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-4 py-2">
            <Package className="h-3.5 w-3.5" /> Asset Registry
          </TabsTrigger>
        </TabsList>

        <TabsContent value="activity" className="mt-4">
          <ActivityLogPanel />
        </TabsContent>
        <TabsContent value="audits" className="mt-4">
          <SystemAuditPanel />
        </TabsContent>
        <TabsContent value="architecture" className="mt-4">
          <SystemArchitecturePanel />
        </TabsContent>
        <TabsContent value="worklog" className="mt-4">
          <WorkLogPanel />
        </TabsContent>
        <TabsContent value="lighthouse" className="mt-4">
          <LighthouseAuditPanel />
        </TabsContent>
        <TabsContent value="assets" className="mt-4">
          <AssetRegistryPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
