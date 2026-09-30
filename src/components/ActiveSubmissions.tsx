import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Clock, Loader2, AlertCircle, Shield } from "lucide-react";
import { format } from "date-fns";
import SubmissionProgressBar from "@/components/SubmissionProgressBar";

interface Submission {
  id: string;
  title: string;
  genre: string | null;
  logline: string | null;
  status: string;
  method_type: string;
  model_used: string | null;
  page_count: number | null;
  length_category: string | null;
  author: string | null;
  created_at: string;
  updated_at: string;
  draft_number: number;
  parent_entry_id: string | null;
  sensitivity?: string;
  embargo_until?: string | null;
  scores: {
    total_score: number;
    originality: number;
    structure: number;
    character_depth: number;
    dialogue: number;
    theme: number;
    emotion: number;
    format_adherence: number;
    feedback: string | null;
  } | null;
}

const statusConfig: Record<string, { label: string; icon: typeof Clock; className: string }> = {
  submitted: { label: "Submitted", icon: Clock, className: "bg-muted text-muted-foreground" },
  judging: { label: "Judging", icon: Loader2, className: "bg-primary/10 text-primary" },
  under_review: { label: "Under Review", icon: Clock, className: "bg-primary/10 text-primary" },
};

interface ActiveSubmissionsProps {
  submissions: Submission[];
}

export default function ActiveSubmissions({ submissions }: ActiveSubmissionsProps) {
  const active = submissions.filter((s) =>
    ["submitted", "judging", "under_review"].includes(s.status) && (s as any).competition_id
  );

  if (active.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="mb-6"
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
        <h2 className="font-display text-lg font-semibold">Active Submissions</h2>
        <Badge variant="secondary" className="text-[10px] font-mono">
          {active.length}
        </Badge>
      </div>

      <div className="space-y-3">
        {active.map((sub, i) => {
          const cfg = statusConfig[sub.status] || statusConfig.submitted;
          const StatusIcon = cfg.icon;

          return (
            <Link
              key={sub.id}
              to={`/entry/${sub.id}`}
              className="block rounded-xl border border-border/50 bg-card/80 p-5 hover:border-primary/30 transition-colors"
            >
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <h3 className="font-display text-base font-semibold truncate">{sub.title}</h3>
                    <Badge variant="outline" className={`shrink-0 text-[10px] font-mono ${cfg.className}`}>
                      <StatusIcon className={`h-3 w-3 mr-1 ${sub.status === "judging" ? "animate-spin" : ""}`} />
                      {cfg.label}
                    </Badge>
                    {sub.draft_number > 1 && (
                      <Badge variant="outline" className="shrink-0 text-[10px] font-mono">
                        v{sub.draft_number}
                      </Badge>
                    )}
                    {sub.sensitivity && sub.sensitivity !== "standard" && (
                      <Badge variant="outline" className="shrink-0 text-[10px] font-mono border-amber-500/30 text-amber-500 gap-1">
                        <Shield className="h-3 w-3" />
                        {sub.sensitivity.charAt(0).toUpperCase() + sub.sensitivity.slice(1)}
                      </Badge>
                    )}
                    {sub.embargo_until && new Date(sub.embargo_until) > new Date() && (
                      <Badge variant="outline" className="shrink-0 text-[10px] font-mono border-blue-500/30 text-blue-400 gap-1">
                        <Clock className="h-3 w-3" />
                        Embargoed until {format(new Date(sub.embargo_until), "MMM yyyy")}
                      </Badge>
                    )}
                  </div>
                  {sub.logline && (
                    <p className="text-sm text-muted-foreground line-clamp-1 mb-2">{sub.logline}</p>
                  )}
                  <div className="flex flex-wrap gap-3 text-xs font-mono text-muted-foreground mb-2">
                    {sub.genre && <span>{sub.genre}</span>}
                    {sub.page_count && <span>{sub.page_count} pages</span>}
                    {sub.length_category && <span className="capitalize">· {sub.length_category}</span>}
                    <span>· {new Date(sub.created_at).toLocaleDateString()}</span>
                  </div>
                  <SubmissionProgressBar status={sub.status} createdAt={sub.created_at} updatedAt={sub.updated_at} />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </motion.div>
  );
}
