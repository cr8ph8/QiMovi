import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CheckCircle2, CircleDashed, ShieldAlert, Archive, Pencil, FileText, Loader2 } from "lucide-react";

export type ConceptStatus = "draft" | "prototype" | "verified" | "deprecated";

const STATUS_META: Record<ConceptStatus, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  draft:      { label: "DRAFT",      className: "bg-amber-500/10 text-amber-500 border-amber-500/30",   Icon: CircleDashed },
  prototype:  { label: "PROTOTYPE",  className: "bg-sky-500/10 text-sky-400 border-sky-500/30",         Icon: ShieldAlert },
  verified:   { label: "VERIFIED",   className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30", Icon: CheckCircle2 },
  deprecated: { label: "DEPRECATED", className: "bg-muted text-muted-foreground border-border",         Icon: Archive },
};

interface Props {
  type: string;
  title: string;
  status: ConceptStatus;
  tags?: string[];
  body?: string;
  onAdmit?: () => void;
  onReject?: () => void;
  onEdit?: () => void;
  onGenerateDraft?: () => void;
  generatingDraft?: boolean;
  busy?: boolean;
}

export function ConceptCard({ type, title, status, tags = [], body, onAdmit, onReject, onEdit, onGenerateDraft, generatingDraft, busy }: Props) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  const Icon = meta.Icon;
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider",
            meta.className,
          )}>
            <Icon className="h-3 w-3" />
            {meta.label}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{type}</span>
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
              aria-label="Edit concept"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          )}
        </div>
        <h4 className="font-display text-base leading-tight">{title}</h4>
        {body && <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{body}</p>}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                #{t}
              </span>
            ))}
          </div>
        )}
        {(onAdmit || onReject || onGenerateDraft) && (
          <div className="pt-2 flex items-center gap-2 flex-wrap">
            {onAdmit && (
              <button
                type="button"
                disabled={busy}
                onClick={onAdmit}
                className="text-xs px-2 py-1 rounded border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40"
              >
                Admit
              </button>
            )}
            {onReject && (
              <button
                type="button"
                disabled={busy}
                onClick={onReject}
                className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                Reject
              </button>
            )}
            {onGenerateDraft && (
              <button
                type="button"
                disabled={busy || generatingDraft}
                onClick={onGenerateDraft}
                className="ml-auto inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-40"
                title="Turn this concept into a Fountain screenplay draft"
              >
                {generatingDraft ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                {generatingDraft ? "Generating…" : "Generate draft"}
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
