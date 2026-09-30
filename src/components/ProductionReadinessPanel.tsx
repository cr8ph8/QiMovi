/**
 * ProductionReadinessPanel — structured indicators describing how prepared
 * a screenplay project is for further development workflows.
 * Descriptive only — no quality, commercial, or predictive claims.
 */
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CheckCircle2, Circle, Info, Milestone, Layers, MessageSquare,
  Users, FileCheck, GitBranch, Activity,
} from "lucide-react";

/* ── types ── */
interface ReadinessSignal {
  label: string;
  present: boolean;
  hint: string;
  icon: React.ElementType;
  detail?: string;
}

export interface ProductionReadinessProps {
  /** Draft number of current entry */
  draftNumber: number;
  /** Number of scenes parsed */
  sceneCount: number;
  /** Number of unique characters */
  characterCount: number;
  /** Dialogue block count */
  dialogueBlockCount: number;
  /** Action line count */
  actionLineCount: number;
  /** Total page count */
  pageCount: number;
  /** Number of ready artifacts (optional) */
  artifactReadyCount?: number;
  /** Total artifact count (optional) */
  artifactTotalCount?: number;
  /** Number of screenplay versions (optional) */
  versionCount?: number;
  /** Number of evaluation runs (optional) */
  evaluationCount?: number;
  /** Stability score 0-100 (optional) */
  stabilityScore?: number | null;
  /** Compact mode for public pages */
  compact?: boolean;
}

/* ── component ── */
export default function ProductionReadinessPanel({
  draftNumber,
  sceneCount,
  characterCount,
  dialogueBlockCount,
  actionLineCount,
  pageCount,
  artifactReadyCount = 0,
  artifactTotalCount = 0,
  versionCount = 0,
  evaluationCount = 0,
  stabilityScore,
  compact = false,
}: ProductionReadinessProps) {
  const signals = useMemo<ReadinessSignal[]>(() => {
    const totalContent = dialogueBlockCount + actionLineCount;

    return [
      {
        label: "Structural Continuity",
        present: sceneCount >= 5 && pageCount >= 10,
        hint: "Scene and page volume indicating a structurally developed screenplay.",
        icon: Layers,
        detail: `${sceneCount} scenes · ${pageCount} pages`,
      },
      {
        label: "Revision Maturity",
        present: draftNumber >= 2,
        hint: "Multiple revision drafts indicate iterative development.",
        icon: GitBranch,
        detail: `Draft ${draftNumber}`,
      },
      {
        label: "Character Continuity",
        present: characterCount >= 3,
        hint: "Multiple speaking characters present across the screenplay.",
        icon: Users,
        detail: `${characterCount} characters`,
      },
      {
        label: "Dialogue Consistency",
        present: totalContent > 0 && dialogueBlockCount / totalContent >= 0.2 && dialogueBlockCount / totalContent <= 0.8,
        hint: "Dialogue-to-action ratio within a balanced range, indicating consistent content distribution.",
        icon: MessageSquare,
        detail: `${totalContent > 0 ? Math.round((dialogueBlockCount / totalContent) * 100) : 0}% dialogue`,
      },
      {
        label: "Artifact Completeness",
        present: artifactTotalCount > 0 && artifactReadyCount / artifactTotalCount >= 0.5,
        hint: "Evidence artifacts generated and in a ready state.",
        icon: FileCheck,
        detail: artifactTotalCount > 0 ? `${artifactReadyCount}/${artifactTotalCount} ready` : "No artifacts",
      },
      {
        label: "Version Lineage",
        present: versionCount >= 1,
        hint: "Version history present, providing revision traceability.",
        icon: GitBranch,
        detail: `${versionCount} version${versionCount !== 1 ? "s" : ""}`,
      },
      {
        label: "Evaluation Stability",
        present: evaluationCount >= 2 && (stabilityScore == null || stabilityScore >= 60),
        hint: "Multiple evaluation runs with consistent scoring patterns.",
        icon: Activity,
        detail: evaluationCount > 0
          ? `${evaluationCount} run${evaluationCount !== 1 ? "s" : ""}${stabilityScore != null ? ` · ${Math.round(stabilityScore)}% stable` : ""}`
          : "No evaluations",
      },
    ];
  }, [draftNumber, sceneCount, characterCount, dialogueBlockCount, actionLineCount, pageCount, artifactReadyCount, artifactTotalCount, versionCount, evaluationCount, stabilityScore]);

  const presentCount = signals.filter((s) => s.present).length;
  const totalCount = signals.length;

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Milestone className="h-3.5 w-3.5 text-primary" />
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Readiness Signals</span>
          <Badge variant="outline" className="text-[9px] font-mono ml-auto">
            {presentCount}/{totalCount}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {signals.map((s) => (
            <Badge
              key={s.label}
              variant="outline"
              className={cn(
                "text-[9px] font-mono gap-1 transition-colors",
                s.present
                  ? "border-primary/30 text-primary"
                  : "border-muted-foreground/20 text-muted-foreground/40"
              )}
            >
              {s.present ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Circle className="h-2.5 w-2.5" />}
              {s.label}
            </Badge>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Milestone className="h-4 w-4 text-primary" />
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Production Readiness Signals</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[240px] text-xs">
            Observable indicators of development completeness. These describe structural state, not quality or commercial viability.
          </TooltipContent>
        </Tooltip>
        <Badge variant="outline" className="text-[9px] font-mono ml-auto">
          {presentCount}/{totalCount} present
        </Badge>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary/70 rounded-full transition-all"
          style={{ width: `${(presentCount / totalCount) * 100}%` }}
        />
      </div>

      {/* Signal list */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {signals.map((s) => (
          <div
            key={s.label}
            className={cn(
              "flex items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors",
              s.present
                ? "border-primary/20 bg-primary/5"
                : "border-border/30 bg-card/40 opacity-60"
            )}
          >
            <div className="mt-0.5">
              {s.present ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
              ) : (
                <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono font-semibold text-foreground">{s.label}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 text-muted-foreground/40 cursor-help shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[200px] text-xs">{s.hint}</TooltipContent>
                </Tooltip>
              </div>
              {s.detail && (
                <span className="text-[10px] font-mono text-muted-foreground">{s.detail}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
