import { ReactNode, useId, useState } from "react";
import { Clock, Download, FileJson, FileText, History, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  exportReceiptsJSON,
  exportReceiptsPDF,
  type ReceiptExportContext,
} from "@/lib/export/exportReceipts";
import { cn } from "@/lib/utils";

export interface ReceiptBadge {
  label: string;
  tone?: "default" | "primary" | "warn" | "danger" | "success";
  title?: string;
}

export interface ReceiptEntry {
  id: string;
  /** ISO timestamp, or any string parsable by Date. Falls back to raw text. */
  timestamp?: string;
  /** Primary label for the row (e.g. "v3 → v4", "Submission committed"). */
  title: ReactNode;
  /** Optional short badges rendered inline next to the title. */
  badges?: ReceiptBadge[];
  /** Optional narrative reason / note lines. */
  notes?: ReactNode;
  /** Hex hash to display truncated with tooltip. */
  hash?: string;
  hashLabel?: string;
  correlationId?: string;
  actor?: string;
  /** Optional trailing element (e.g. re-download button). */
  actions?: ReactNode;
}

interface Props {
  title?: string;
  entries: ReceiptEntry[];
  emptyMessage?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  loading?: boolean;
  className?: string;
  /**
   * When provided, renders a one-click "Export receipts" menu in the header
   * so judges, partners, and auditors can download the trail as PDF or JSON.
   * Omit to hide the action entirely.
   */
  exportContext?: ReceiptExportContext;
}

const BADGE_TONE: Record<NonNullable<ReceiptBadge["tone"]>, string> = {
  default: "border-border/40 text-muted-foreground",
  primary: "border-primary/30 text-primary bg-primary/5",
  warn: "border-amber-500/40 text-amber-300 bg-amber-500/5",
  danger: "border-red-500/40 text-red-300 bg-red-500/5",
  success: "border-emerald-500/40 text-emerald-300 bg-emerald-500/5",
};

/**
 * ReceiptTrail — shared timeline of receipts / proof events used across
 * Submit (submission receipts), Insights (scorecard evidence), Shield
 * (authorship submissions), and Publication rollback preview.
 *
 * Presentational only — parents load their own rows and map them into
 * `ReceiptEntry[]`.
 */
export function ReceiptTrail({
  title = "Receipt trail",
  entries,
  emptyMessage = "No receipts recorded yet.",
  collapsible = false,
  defaultOpen = true,
  loading = false,
  className,
  exportContext,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = collapsible ? open : true;
  const canExport = !!exportContext && entries.length > 0;
  const reactId = useId();
  const panelId = `receipt-trail-panel-${reactId}`;
  const labelId = `receipt-trail-label-${reactId}`;

  const header = (
    <span id={labelId} className="flex items-center gap-2">
      <History className="h-3 w-3" aria-hidden="true" />
      {title}
      <Badge variant="outline" className="text-[10px] font-mono border-border/40" aria-label={`${entries.length} receipt${entries.length === 1 ? "" : "s"}`}>
        {entries.length}
      </Badge>
      {loading && (
        <Loader2
          className="h-3 w-3 animate-spin opacity-60"
          aria-label="Loading receipts"
        />
      )}
    </span>
  );


  const exportMenu = exportContext ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!canExport}
          onClick={(e) => e.stopPropagation()}
          aria-label={
            canExport
              ? "Export receipt trail as PDF or JSON"
              : "No receipts to export yet"
          }
          className="h-6 px-2 text-[10px] font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Download className="h-3 w-3 mr-1" aria-hidden="true" />
          Export receipts
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Package for {exportContext.audience ?? "reviewers"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            exportReceiptsPDF(entries, exportContext);
          }}
        >
          <FileText className="h-3.5 w-3.5 mr-2" aria-hidden="true" /> Download PDF
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            exportReceiptsJSON(entries, exportContext);
          }}
        >
          <FileJson className="h-3.5 w-3.5 mr-2" aria-hidden="true" /> Download JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  return (
    <section
      aria-labelledby={labelId}
      className={cn("rounded-md border border-border/40 bg-muted/10", className)}
    >
      {collapsible ? (
        <div className="w-full flex items-center justify-between pr-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex-1 flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            aria-expanded={isOpen}
            aria-controls={panelId}
          >
            {header}
            <span aria-hidden="true" className="text-[10px] opacity-60">
              {isOpen ? "▾" : "▸"}
            </span>
          </button>
          {exportMenu}
        </div>
      ) : (
        <div className="px-3 py-2 text-xs font-medium text-muted-foreground flex items-center justify-between gap-2">
          {header}
          {exportMenu}
        </div>
      )}


      {isOpen && (
        <ol
          id={panelId}
          className="border-t border-border/40 divide-y divide-border/40 list-none m-0 p-0"
        >
          {entries.length === 0 && !loading && (
            <li className="px-3 py-3 text-[11px] text-muted-foreground italic">
              {emptyMessage}
            </li>
          )}
          {entries.map((e) => {
            const when = e.timestamp ? new Date(e.timestamp) : null;
            const whenStr =
              when && !isNaN(when.getTime())
                ? when.toLocaleString()
                : e.timestamp ?? null;
            return (
              <li key={e.id} className="px-3 py-2.5 text-[11px] space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-foreground/90">{e.title}</span>
                  {e.badges?.map((b, i) => (
                    <Badge
                      key={i}
                      variant="outline"
                      title={b.title}
                      className={cn(
                        "text-[10px] font-mono",
                        BADGE_TONE[b.tone ?? "default"],
                      )}
                    >
                      {b.label}
                    </Badge>
                  ))}
                  {whenStr && (
                    <time
                      dateTime={
                        when && !isNaN(when.getTime())
                          ? when.toISOString()
                          : undefined
                      }
                      className="ml-auto inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground"
                    >
                      <Clock className="h-3 w-3" aria-hidden="true" /> {whenStr}
                    </time>
                  )}
                </div>
                {e.notes && (
                  <div className="text-muted-foreground">{e.notes}</div>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-muted-foreground/80">
                  {e.hash && (
                    <span
                      title={e.hash}
                      aria-label={`${e.hashLabel ?? "sha256"} hash ${e.hash}`}
                    >
                      {e.hashLabel ?? "sha256"} {e.hash.slice(0, 12)}…
                    </span>
                  )}
                  {e.correlationId && (
                    <span
                      title={e.correlationId}
                      aria-label={`correlation id ${e.correlationId}`}
                    >
                      corr {e.correlationId.slice(0, 8)}
                    </span>
                  )}
                  {e.actor && (
                    <span title={e.actor} aria-label={`actor ${e.actor}`}>
                      by {e.actor.slice(0, 8)}
                    </span>
                  )}
                  {e.actions && <span className="ml-auto">{e.actions}</span>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

