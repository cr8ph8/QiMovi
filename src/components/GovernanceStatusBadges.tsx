import { Shield, AlertTriangle, Activity, GitBranch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export interface GovernanceFlags {
  isProtected?: boolean;
  isFlagged?: boolean;
  isHighDrift?: boolean;
  isRouted?: boolean;
  aiInfluenceScore?: number;
  driftScore?: number;
  sensitivity?: string;
  routingReason?: string;
}

export function GovernanceStatusBadges({ flags }: { flags: GovernanceFlags }) {
  if (!flags.isProtected && !flags.isFlagged && !flags.isHighDrift && !flags.isRouted) return null;

  return (
    <TooltipProvider>
      {flags.isProtected && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="shrink-0 text-[10px] font-mono border-blue-500/30 text-blue-400 gap-1">
              <Shield className="h-3 w-3" />
              Protected
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">Sensitivity: {flags.sensitivity || "confidential"} — restricted AI routing</p>
          </TooltipContent>
        </Tooltip>
      )}
      {flags.isFlagged && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="shrink-0 text-[10px] font-mono border-red-500/30 text-red-400 gap-1">
              <AlertTriangle className="h-3 w-3" />
              Flagged
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">AI influence score: {flags.aiInfluenceScore != null ? `${Math.round(flags.aiInfluenceScore * 100)}%` : "high"} — under review</p>
          </TooltipContent>
        </Tooltip>
      )}
      {flags.isHighDrift && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="shrink-0 text-[10px] font-mono border-amber-500/30 text-amber-400 gap-1">
              <Activity className="h-3 w-3" />
              High Drift
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">Voice drift: {flags.driftScore != null ? `${Math.round(100 - flags.driftScore)}% preserved` : "significant deviation detected"}</p>
          </TooltipContent>
        </Tooltip>
      )}
      {flags.isRouted && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="shrink-0 text-[10px] font-mono border-purple-500/30 text-purple-400 gap-1">
              <GitBranch className="h-3 w-3" />
              Routed
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">AI model rerouted: {flags.routingReason || "policy override"}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </TooltipProvider>
  );
}
