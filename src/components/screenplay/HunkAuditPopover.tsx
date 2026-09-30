import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Sparkles, User, Bot, GitBranch, FileInput, RotateCcw, Cpu, ExternalLink } from "lucide-react";
import AuditCallChainDialog from "./AuditCallChainDialog";
import type { AuditEntry } from "@/lib/screenplay/versionAudit";
import { triggerLabel } from "@/lib/screenplay/versionAudit";

const ACTION_STYLE: Record<string, { className: string; icon: React.ComponentType<{ className?: string }> }> = {
  manual_edit: { className: "border-muted-foreground/30 text-muted-foreground", icon: User },
  ai_rewrite: { className: "border-primary/40 text-primary", icon: Sparkles },
  ai_suggest_apply: { className: "border-primary/40 text-primary", icon: Bot },
  ai_compare_apply: { className: "border-primary/40 text-primary", icon: Cpu },
  promote_brief: { className: "border-emerald-500/40 text-emerald-400", icon: GitBranch },
  import: { className: "border-amber-500/40 text-amber-400", icon: FileInput },
  restore: { className: "border-amber-500/40 text-amber-400", icon: RotateCcw },
  system: { className: "border-muted-foreground/40 text-muted-foreground", icon: Cpu },
};

function actorInitials(label: string): string {
  const parts = label.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

interface Props {
  primary: AuditEntry;
  all: AuditEntry[];
  actorLabel?: string;
}

export default function HunkAuditBadge({ primary, all, actorLabel }: Props) {
  const [dialogEntry, setDialogEntry] = useState<AuditEntry | null>(null);
  const style = ACTION_STYLE[primary.triggerAction] ?? ACTION_STYLE.manual_edit;
  const Icon = style.icon;
  const label = actorLabel ?? primary.actorUserId.slice(0, 8);
  const multi = all.length > 1;

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-mono transition-colors bg-background/80 backdrop-blur-sm hover:bg-muted/60",
              style.className,
            )}
            title={`${triggerLabel(primary.triggerAction)} — ${label}`}
          >
            <Icon className="h-2.5 w-2.5" />
            <span>{actorInitials(label)}</span>
            <span className="text-muted-foreground">·</span>
            <span>{relativeTime(primary.createdAt)}</span>
            {multi && (
              <span className="ml-0.5 rounded bg-muted-foreground/20 px-1 text-[8px]">
                +{all.length - 1}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-3 space-y-3" side="left" align="start">
          <div className="space-y-2">
            {all.map((entry, i) => {
              const s = ACTION_STYLE[entry.triggerAction] ?? ACTION_STYLE.manual_edit;
              const EntryIcon = s.icon;
              return (
                <div
                  key={`${entry.versionId}-${i}`}
                  className="rounded-lg border border-border/40 bg-card/60 p-2 space-y-1"
                >
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="outline" className={cn("text-[9px] font-mono", s.className)}>
                      <EntryIcon className="h-2.5 w-2.5 mr-1" />
                      {triggerLabel(entry.triggerAction)}
                    </Badge>
                    {entry.triggerFunction && (
                      <Badge variant="secondary" className="text-[9px] font-mono">
                        {entry.triggerFunction}
                      </Badge>
                    )}
                    {entry.fromDraftNumber != null && entry.toDraftNumber != null && (
                      <Badge variant="outline" className="text-[9px] font-mono">
                        v{entry.fromDraftNumber} → v{entry.toDraftNumber}
                      </Badge>
                    )}
                  </div>
                  <dl className="grid grid-cols-[64px_1fr] gap-y-0.5 text-[10px] font-mono">
                    <dt className="text-muted-foreground">Who</dt>
                    <dd className="truncate">{actorLabel ?? entry.actorUserId.slice(0, 12)}</dd>
                    <dt className="text-muted-foreground">When</dt>
                    <dd>{new Date(entry.createdAt).toLocaleString()}</dd>
                    {entry.correlationId && (
                      <>
                        <dt className="text-muted-foreground">Corr.</dt>
                        <dd className="truncate">{entry.correlationId.slice(0, 12)}…</dd>
                      </>
                    )}
                  </dl>
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] font-mono"
                      onClick={() => setDialogEntry(entry)}
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      View evidence
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      <AuditCallChainDialog
        open={dialogEntry !== null}
        onOpenChange={(open) => !open && setDialogEntry(null)}
        entry={dialogEntry}
        actorLabel={actorLabel}
      />
    </>
  );
}
