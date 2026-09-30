import { useEffect, useState, useCallback } from "react";
import { FileDown, Trash2, Clock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import {
  listReceipts,
  removeReceipt,
  type ReceiptTimelineEntry,
} from "@/lib/receiptTimeline";
import { generateSubmissionReceiptPdf } from "@/lib/submissionReceipt";

interface Props {
  userId: string | null | undefined;
  /** Bump this number after a new receipt is appended to force a refresh. */
  refreshKey?: number;
}

/**
 * Timeline of previously-generated Details-step submission receipts.
 * Reads from localStorage (per-user) and re-runs the deterministic PDF
 * generator on demand, so the redownloaded file matches the original hash.
 */
export function SubmissionReceiptsTimeline({ userId, refreshKey = 0 }: Props) {
  const [entries, setEntries] = useState<ReceiptTimelineEntry[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(() => {
    setEntries(listReceipts(userId));
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload, refreshKey]);

  const handleDownload = async (entry: ReceiptTimelineEntry) => {
    setBusyId(entry.id);
    try {
      const { hash } = await generateSubmissionReceiptPdf(entry.data);
      const matches = hash === entry.hash;
      toast({
        title: matches ? "Receipt re-downloaded" : "Receipt downloaded (hash drift)",
        description: matches
          ? `SHA-256 ${hash.slice(0, 12)}… matches stored receipt.`
          : `Stored ${entry.hash.slice(0, 8)}… · generated ${hash.slice(0, 8)}…`,
        variant: matches ? "default" : "destructive",
      });
    } catch (e: any) {
      toast({
        title: "Download failed",
        description: e?.message ?? "Could not regenerate receipt PDF",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = (entry: ReceiptTimelineEntry) => {
    removeReceipt(userId, entry.id);
    reload();
  };

  if (entries.length === 0) {
    return (
      <div className="rounded border border-dashed border-border/40 p-4 text-xs text-muted-foreground">
        No prior receipts yet. Advancing past the Details step will save one here.
      </div>
    );
  }

  return (
    <div className="border border-border/40 rounded divide-y divide-border/30">
      {entries.map((r) => {
        const d = r.data;
        const when = new Date(r.emitted_at);
        const whenStr = isNaN(when.getTime()) ? r.emitted_at : when.toLocaleString();
        return (
          <div key={r.id} className="p-3 flex items-start gap-3 text-xs">
            <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium truncate">{d.submission.title || "Untitled submission"}</span>
                {d.submission.category && (
                  <Badge variant="outline" className="text-[10px]">{d.submission.category}</Badge>
                )}
                {d.ai_disclosure.is_ai_generated && (
                  <Badge variant="secondary" className="text-[10px]">AI-assisted</Badge>
                )}
                {d.lineage?.draft_artifact_id && (
                  <Badge variant="outline" className="text-[10px]">
                    draft v{d.lineage.draft_version ?? "?"}
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {whenStr}
                </span>
                <span className="font-mono" title={r.hash}>
                  sha256 {r.hash.slice(0, 12)}…
                </span>
                <span className="truncate max-w-[240px]" title={r.filename}>{r.filename}</span>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-[11px]"
                disabled={busyId === r.id}
                onClick={() => handleDownload(r)}
              >
                <FileDown className="h-3 w-3" />
                {busyId === r.id ? "…" : "Download"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => handleRemove(r)}
                title="Remove from timeline"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
