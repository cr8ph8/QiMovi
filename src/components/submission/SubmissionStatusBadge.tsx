import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, AlertTriangle, Clock, Star, ShieldAlert, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  submitted: {
    label: "Submitted",
    icon: <Clock className="h-3 w-3" />,
    className: "border-primary/30 text-primary bg-primary/10",
  },
  judging: {
    label: "Scoring",
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    className: "border-amber-500/30 text-amber-400 bg-amber-500/10",
  },
  scored: {
    label: "Scored",
    icon: <CheckCircle2 className="h-3 w-3" />,
    className: "border-emerald-500/30 text-emerald-400 bg-emerald-500/10",
  },
  shortlisted: {
    label: "Shortlisted",
    icon: <Star className="h-3 w-3" />,
    className: "border-primary/40 text-primary bg-primary/15",
  },
  accepted: {
    label: "Finalist",
    icon: <Star className="h-3 w-3" />,
    className: "border-primary/50 text-primary bg-primary/20",
  },
  under_review: {
    label: "Under Review",
    icon: <ShieldAlert className="h-3 w-3" />,
    className: "border-amber-500/30 text-amber-400 bg-amber-500/10",
  },
  disqualified: {
    label: "Disqualified",
    icon: <XCircle className="h-3 w-3" />,
    className: "border-destructive/30 text-destructive bg-destructive/10",
  },
  error: {
    label: "Error",
    icon: <AlertTriangle className="h-3 w-3" />,
    className: "border-destructive/30 text-destructive bg-destructive/10",
  },
};

interface SubmissionStatusBadgeProps {
  status: string;
  className?: string;
}

export default function SubmissionStatusBadge({ status, className }: SubmissionStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? {
    label: status.replace(/_/g, " "),
    icon: <Clock className="h-3 w-3" />,
    className: "border-border text-muted-foreground",
  };

  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] font-mono gap-1 px-2 py-0.5 capitalize",
        config.className,
        className,
      )}
    >
      {config.icon}
      {config.label}
    </Badge>
  );
}
