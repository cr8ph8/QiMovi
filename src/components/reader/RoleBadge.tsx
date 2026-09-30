import { Shield, User, Gavel, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type ReaderRole,
  ROLE_LABEL,
  ROLE_TONE,
  ROLE_DESCRIPTION,
} from "@/lib/reader/roles";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const ICON: Record<ReaderRole, typeof Shield> = {
  operator: Shield,
  entrant: User,
  judge: Gavel,
  reader: Eye,
};

interface Props {
  role: ReaderRole;
  className?: string;
}

export function RoleBadge({ role, className }: Props) {
  const Icon = ICON[role];
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider border",
              ROLE_TONE[role],
              className,
            )}
          >
            <Icon className="w-3 h-3" />
            {ROLE_LABEL[role]}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          {ROLE_DESCRIPTION[role]}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
