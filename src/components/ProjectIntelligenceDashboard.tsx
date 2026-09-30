/**
 * ProjectIntelligenceDashboard — centralized view of structural and developmental
 * signals for a screenplay project. Reuses canonical parse outputs, artifact status,
 * and stability metrics. No prescriptive recommendations.
 */
import { useMemo } from "react";
import { FountainParseResult } from "@/lib/fountain-parser";
import AdaptationPathwayPanel from "@/components/screenplay/AdaptationPathwayPanel";
import ProductionReadinessPanel from "@/components/ProductionReadinessPanel";
import NarrativeContinuityPanel from "@/components/NarrativeContinuityPanel";
import DevelopmentTrajectoryPanel from "@/components/DevelopmentTrajectoryPanel";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Layers, MessageSquare, Users, GitBranch, Activity, FileCheck,
  Clapperboard, FileText, Type, BarChart3, Info,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/* ── types ── */
interface ArtifactSummary {
  total: number;
  ready: number;
  pending: number;
  stale: number;
  failed: number;
}

interface StabilitySnapshot {
  overallScore: number | null; // 0-100
  label: string; // "stable" | "moderate drift" | "high drift"
}

interface ProjectIntelligenceDashboardProps {
  parsed: FountainParseResult | null;
  draftNumber: number;
  status: string;
  artifactSummary?: ArtifactSummary;
  stabilitySnapshot?: StabilitySnapshot;
  versionCount?: number;
  evaluationCount?: number;
  drafts?: { draft_number: number; script_text: string }[];
}

/* ── helpers ── */
function pctLabel(value: number): string {
  return `${Math.round(value)}%`;
}

function signalColor(pct: number): string {
  if (pct >= 75) return "text-emerald-400";
  if (pct >= 45) return "text-amber-400";
  return "text-destructive";
}

function signalBg(pct: number): string {
  if (pct >= 75) return "bg-emerald-500/15";
  if (pct >= 45) return "bg-amber-500/15";
  return "bg-destructive/15";
}

function barFill(pct: number): string {
  if (pct >= 75) return "bg-emerald-500";
  if (pct >= 45) return "bg-amber-500";
  return "bg-destructive";
}

/* ── signal card ── */
function SignalRow({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-mono text-foreground">{label}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[220px] text-xs">{hint}</TooltipContent>
            </Tooltip>
          </div>
          <span className={cn("text-xs font-mono font-bold", signalColor(value))}>{pctLabel(value)}</span>
        </div>
        <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
          <div className={cn("h-full rounded-full transition-all", barFill(value))} style={{ width: `${Math.min(value, 100)}%` }} />
        </div>
      </div>
    </div>
  );
}

function SignalCategory({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/80 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{title}</span>
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

/* ── main component ── */
export default function ProjectIntelligenceDashboard({
  parsed,
  draftNumber,
  status,
  artifactSummary,
  stabilitySnapshot,
  versionCount = 0,
  evaluationCount = 0,
  drafts,
}: ProjectIntelligenceDashboardProps) {
  /* ── computed structural signals ── */
  const signals = useMemo(() => {
    if (!parsed) return null;
    const { stats, scenes, elements } = parsed;

    // Structure signals
    const sceneCount = stats.sceneCount;
    const pageCount = stats.pageCount;
    const sceneDensity = pageCount > 0 ? sceneCount / pageCount : 0;
    // Typical screenplay: ~1 scene per 1-2 pages → density ∈ [0.5, 1.5]
    const structuralBalance = Math.min(100, Math.round((Math.min(sceneDensity, 1.2) / 1.2) * 100));

    // Page utilization: words per page (typical ~250)
    const wordsPerPage = pageCount > 0 ? stats.wordCount / pageCount : 0;
    const pageUtilization = Math.min(100, Math.round((Math.min(wordsPerPage, 300) / 300) * 100));

    // Dialogue signals
    const totalElements = elements.length;
    const dialogueRatio = totalElements > 0 ? stats.dialogueBlockCount / totalElements : 0;
    // Typical: 40-60% of elements involve dialogue
    const dialogueBalance = Math.min(100, Math.round(Math.min(dialogueRatio / 0.35, 1) * 100));

    // Dialogue distribution across characters (Gini-like)
    const charCounts = Object.values(stats.characterDialogueCounts);
    let dialogueDistribution = 100;
    if (charCounts.length > 1) {
      const totalDialogue = charCounts.reduce((s, c) => s + c, 0);
      const mean = totalDialogue / charCounts.length;
      const deviation = charCounts.reduce((s, c) => s + Math.abs(c - mean), 0) / charCounts.length;
      dialogueDistribution = Math.max(0, Math.round((1 - deviation / Math.max(mean, 1)) * 100));
    }

    // Character signals
    const charCount = stats.uniqueCharacters.length;
    const charPresence = Math.min(100, Math.round(Math.min(charCount, 20) / 20 * 100));

    // Characters with dialogue vs. total
    const speakingChars = Object.keys(stats.characterDialogueCounts).length;
    const voiceCoverage = charCount > 0 ? Math.round((speakingChars / charCount) * 100) : 0;

    // Pacing: action vs. dialogue ratio
    const actionRatio = totalElements > 0 ? stats.actionLineCount / totalElements : 0;
    const pacingBalance = Math.min(100, Math.round(
      (1 - Math.abs(actionRatio - 0.35) / 0.35) * 100
    ));

    // Scene length variance
    const sceneLengths = scenes.map((s, i) => {
      const nextIdx = i < scenes.length - 1 ? scenes[i + 1].elementIndex : elements.length;
      return nextIdx - s.elementIndex;
    });
    let sceneVariety = 50;
    if (sceneLengths.length > 1) {
      const avgLen = sceneLengths.reduce((a, b) => a + b, 0) / sceneLengths.length;
      const variance = sceneLengths.reduce((s, l) => s + Math.pow(l - avgLen, 2), 0) / sceneLengths.length;
      const cv = Math.sqrt(variance) / Math.max(avgLen, 1);
      // cv ~0.5 is healthy, too low is monotonous, too high is erratic
      sceneVariety = Math.min(100, Math.round((1 - Math.abs(cv - 0.5) / 0.5) * 100));
    }

    // Revision depth
    const revisionDepth = Math.min(100, Math.round(Math.min(draftNumber, 5) / 5 * 100));

    return {
      structuralBalance,
      pageUtilization,
      dialogueBalance,
      dialogueDistribution,
      charPresence,
      voiceCoverage,
      pacingBalance,
      sceneVariety,
      revisionDepth,
      sceneCount,
      pageCount,
      wordCount: stats.wordCount,
      charCount,
    };
  }, [parsed, draftNumber]);

  if (!parsed || !signals) {
    return (
      <div className="p-8 text-center">
        <BarChart3 className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Parse a screenplay to see project intelligence signals.</p>
      </div>
    );
  }

  // Artifact readiness
  const artifactReadiness = artifactSummary && artifactSummary.total > 0
    ? Math.round((artifactSummary.ready / artifactSummary.total) * 100)
    : null;

  // Stability
  const stabilityPct = stabilitySnapshot?.overallScore ?? null;

  return (
    <div className="space-y-4">
      {/* Quick stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { icon: FileText, label: "Pages", value: String(signals.pageCount) },
          { icon: Clapperboard, label: "Scenes", value: String(signals.sceneCount) },
          { icon: Type, label: "Words", value: signals.wordCount.toLocaleString() },
          { icon: Users, label: "Characters", value: String(signals.charCount) },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/30 bg-card/60">
            <s.icon className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="text-[10px] font-mono text-muted-foreground uppercase">{s.label}</span>
            <span className="ml-auto font-mono text-sm font-bold text-foreground">{s.value}</span>
          </div>
        ))}
      </div>

      {/* Status + Draft row */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-[10px] font-mono">{status}</Badge>
        <Badge variant="outline" className="text-[10px] font-mono">Draft {draftNumber}</Badge>
        {stabilitySnapshot && (
          <Badge variant="outline" className={cn("text-[10px] font-mono",
            stabilitySnapshot.label === "stable" ? "border-emerald-500/30 text-emerald-400" :
            stabilitySnapshot.label === "moderate drift" ? "border-amber-500/30 text-amber-400" :
            "border-destructive/30 text-destructive"
          )}>
            {stabilitySnapshot.label}
          </Badge>
        )}
      </div>

      {/* Signal grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <SignalCategory icon={Layers} title="Structure Signals">
          <SignalRow label="Structural Balance" value={signals.structuralBalance} hint="Scene-to-page density — indicates how evenly scenes distribute across pages." />
          <SignalRow label="Page Utilization" value={signals.pageUtilization} hint="Word density per page — reflects how fully each page is utilized." />
          <SignalRow label="Scene Variety" value={signals.sceneVariety} hint="Variation in scene lengths — a mix of short and long scenes can indicate varied pacing." />
        </SignalCategory>

        <SignalCategory icon={MessageSquare} title="Dialogue Signals">
          <SignalRow label="Dialogue Presence" value={signals.dialogueBalance} hint="Proportion of dialogue elements relative to total content." />
          <SignalRow label="Dialogue Distribution" value={signals.dialogueDistribution} hint="How evenly dialogue is distributed across characters." />
        </SignalCategory>

        <SignalCategory icon={Users} title="Character Signals">
          <SignalRow label="Character Presence" value={signals.charPresence} hint="Number of unique characters relative to a typical ensemble size." />
          <SignalRow label="Voice Coverage" value={signals.voiceCoverage} hint="Percentage of characters that have at least one line of dialogue." />
        </SignalCategory>

        <SignalCategory icon={BarChart3} title="Pacing Signals">
          <SignalRow label="Pacing Balance" value={signals.pacingBalance} hint="Balance between action and dialogue elements — indicates narrative rhythm." />
        </SignalCategory>

        <SignalCategory icon={GitBranch} title="Revision Signals">
          <SignalRow label="Revision Depth" value={signals.revisionDepth} hint="Number of revision drafts relative to a typical mature project (5 drafts)." />
        </SignalCategory>

        {(artifactReadiness !== null || stabilityPct !== null) && (
          <SignalCategory icon={artifactReadiness !== null ? FileCheck : Activity} title={artifactReadiness !== null ? "Artifact Signals" : "Stability Signals"}>
            {artifactReadiness !== null && (
              <SignalRow label="Artifact Readiness" value={artifactReadiness} hint="Percentage of evidence artifacts in 'ready' state." />
            )}
            {stabilityPct !== null && (
              <SignalRow label="Evaluation Stability" value={stabilityPct} hint="Overall stability of evaluation scores across runs." />
            )}
          </SignalCategory>
        )}
      </div>

      {/* Adaptation pathway signals */}
      <div className="rounded-xl border border-border/50 bg-card/80 p-4">
        <AdaptationPathwayPanel parsed={parsed} />
      </div>

      {/* Production readiness signals */}
      <div className="rounded-xl border border-border/50 bg-card/80 p-4">
        <ProductionReadinessPanel
          draftNumber={draftNumber}
          sceneCount={signals.sceneCount}
          characterCount={signals.charCount}
          dialogueBlockCount={parsed.stats.dialogueBlockCount}
          actionLineCount={parsed.stats.actionLineCount}
          pageCount={signals.pageCount}
          artifactReadyCount={artifactSummary?.ready ?? 0}
          artifactTotalCount={artifactSummary?.total ?? 0}
          versionCount={versionCount}
          evaluationCount={evaluationCount}
          stabilityScore={stabilitySnapshot?.overallScore}
        />
      </div>

      {/* Development trajectory signals */}
      {drafts && drafts.length >= 2 && (
        <div className="rounded-xl border border-border/50 bg-card/80 p-4">
          <DevelopmentTrajectoryPanel drafts={drafts} compact />
        </div>
      )}

      {/* Narrative continuity signals */}
      {drafts && drafts.length >= 2 && (
        <div className="rounded-xl border border-border/50 bg-card/80 p-4">
          <NarrativeContinuityPanel drafts={drafts} compact />
        </div>
      )}
    </div>
  );
}
