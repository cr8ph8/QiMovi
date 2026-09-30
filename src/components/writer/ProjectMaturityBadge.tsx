/**
 * ProjectMaturityBadge — shows structural maturity of a project.
 * Does NOT imply artistic quality.
 */
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Layers, CheckCircle2, GitBranch, Shield, Activity } from "lucide-react";

export interface ProjectMaturityData {
  hasDraft: boolean;
  isParsed: boolean;
  isJudged: boolean;
  isRevised: boolean;           // draft_number > 1
  lineageDepth: number;         // version count
  hasArtifacts: boolean;
  hasStability: boolean;        // 2+ grading reports
}

const MATURITY_STEPS = [
  { key: "hasDraft" as const, label: "Draft", icon: Layers },
  { key: "isParsed" as const, label: "Parsed", icon: CheckCircle2 },
  { key: "isJudged" as const, label: "Evaluated", icon: Activity },
  { key: "isRevised" as const, label: "Revised", icon: GitBranch },
  { key: "hasArtifacts" as const, label: "Artifacts", icon: Shield },
];

export function getMaturityLevel(data: ProjectMaturityData): { label: string; level: number } {
  let level = 0;
  if (data.hasDraft) level++;
  if (data.isParsed) level++;
  if (data.isJudged) level++;
  if (data.isRevised) level++;
  if (data.hasArtifacts) level++;
  if (data.hasStability) level++;

  if (level >= 5) return { label: "Mature", level };
  if (level >= 3) return { label: "Developing", level };
  if (level >= 1) return { label: "Early", level };
  return { label: "New", level: 0 };
}

/** Inline badge showing maturity level */
export function ProjectMaturityBadge({ data }: { data: ProjectMaturityData }) {
  const { label, level } = getMaturityLevel(data);
  const colorClass = level >= 5
    ? "border-emerald-500/30 text-emerald-500"
    : level >= 3
      ? "border-primary/30 text-primary"
      : "border-muted-foreground/30 text-muted-foreground";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={`text-[9px] font-mono gap-1 cursor-default ${colorClass}`}>
          <Layers className="h-2.5 w-2.5" /> {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-52">
        <p className="font-semibold mb-1">Project Maturity: {label}</p>
        <ul className="space-y-0.5">
          {MATURITY_STEPS.map(s => (
            <li key={s.key} className="flex items-center gap-1.5">
              {data[s.key] ? (
                <span className="text-emerald-500">✓</span>
              ) : (
                <span className="text-muted-foreground/40">○</span>
              )}
              <span>{s.label}</span>
            </li>
          ))}
          {data.lineageDepth > 0 && (
            <li className="flex items-center gap-1.5">
              <span className="text-emerald-500">✓</span>
              <span>{data.lineageDepth} version{data.lineageDepth !== 1 ? "s" : ""}</span>
            </li>
          )}
        </ul>
        <p className="text-muted-foreground mt-1">Indicates structural completeness, not artistic quality.</p>
      </TooltipContent>
    </Tooltip>
  );
}

/** Compact revision depth indicator */
export function RevisionDepthBadge({ versionCount, draftNumber }: { versionCount: number; draftNumber: number }) {
  if (versionCount <= 0 && draftNumber <= 1) return null;
  const depth = Math.max(versionCount, draftNumber);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className="text-[9px] font-mono gap-1 border-muted-foreground/30 text-muted-foreground cursor-default">
          <GitBranch className="h-2.5 w-2.5" /> {depth} iteration{depth !== 1 ? "s" : ""}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {draftNumber > 1 && <p>Draft v{draftNumber}</p>}
        {versionCount > 0 && <p>{versionCount} recorded version{versionCount !== 1 ? "s" : ""}</p>}
      </TooltipContent>
    </Tooltip>
  );
}
