/**
 * BoundaryMapExportMenu
 * ─────────────────────
 * One-click export of the current route boundary map (enforced-read vs
 * reclassified-write, plus missing / stale) in either CSV or PDF form. Both
 * formats are generated client-side from the same registry the panel renders,
 * so the artifact an auditor receives matches what the operator sees on
 * screen at the moment of export.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  downloadBoundaryMapCsv,
  downloadBoundaryMapPdf,
} from "@/lib/governance/exportRouteBoundaryMap";

export default function BoundaryMapExportMenu() {
  const [busy, setBusy] = useState<null | "csv" | "pdf">(null);

  async function run(kind: "csv" | "pdf") {
    setBusy(kind);
    try {
      // Yield to the event loop so the button shows its spinner before the
      // (sync) PDF generation blocks the main thread.
      await new Promise((r) => setTimeout(r, 0));
      const filename =
        kind === "csv" ? downloadBoundaryMapCsv() : downloadBoundaryMapPdf();
      toast.success(`Exported ${filename}`);
    } catch (err) {
      toast.error(
        `Export failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Download className="h-3 w-3" />
          )}
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs">
          Route boundary map
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            void run("csv");
          }}
          disabled={busy !== null}
          className="text-xs gap-2"
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          Download CSV
          <span className="ml-auto text-[10px] text-muted-foreground">
            spreadsheet
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            void run("pdf");
          }}
          disabled={busy !== null}
          className="text-xs gap-2"
        >
          <FileText className="h-3.5 w-3.5" />
          Download PDF
          <span className="ml-auto text-[10px] text-muted-foreground">
            auditor
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
