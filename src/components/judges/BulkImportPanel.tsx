import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Download, FileSpreadsheet, Crown, CheckCircle2, AlertCircle } from "lucide-react";
import {
  downloadTemplate,
  parseSpreadsheet,
  validateRow,
  type ParsedRow,
  type RowValidation,
} from "@/lib/judges/importTemplate";
import { useBulkImport } from "@/hooks/useBulkImport";
import { toast } from "sonner";

interface Props {
  competitionId: string;
  canEdit: boolean;
  onImported?: () => void;
}

export function BulkImportPanel({ competitionId, canEdit, onImported }: Props) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [validations, setValidations] = useState<RowValidation[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const { run, pending } = useBulkImport();

  if (!canEdit) {
    return (
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        <Crown className="h-4 w-4 text-primary" />
        Only Lead Judges or Admins can bulk import submissions.
      </div>
    );
  }

  const handleFile = async (file: File) => {
    setRows([]);
    setValidations([]);
    setFileName(null);
    try {
      const parsed = await parseSpreadsheet(file);
      if (parsed.length === 0) {
        toast.error("No data rows found in the CSV.");
        return;
      }
      setFileName(file.name);
      setRows(parsed);
      setValidations(parsed.map(validateRow));
    } catch (e) {
      toast.error("Could not parse CSV", { description: (e as Error).message });
    }
  };

  const validRows = rows.filter((_, i) => validations[i]?.ok);
  const invalidCount = rows.length - validRows.length;

  const handleImport = async () => {
    if (validRows.length === 0) return;
    const res = await run(competitionId, validRows);
    if (res && res.imported > 0) {
      setRows([]);
      setValidations([]);
      setFileName(null);
      onImported?.();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-muted-foreground">
          Bulk-load submissions from a CSV file. Each row is an entry with an external script URL.
        </div>
        <Button variant="outline" size="sm" onClick={downloadTemplate}>
          <Download className="h-3.5 w-3.5 mr-1.5" /> Download CSV template
        </Button>
      </div>

      <label className="block">
        <Card className="p-6 bg-background/30 border-dashed border-border/60 hover:border-primary/40 cursor-pointer transition-colors">
          <div className="flex items-center gap-3">
            <Upload className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <div className="text-sm font-body">{fileName || "Choose a .csv file to import"}</div>
              <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">
                CSV only · Max 1 MiB · 500 data rows · title, writer_name, writer_email, page_count, script_url…
              </div>
            </div>
          </div>
          <input
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </Card>
      </label>

      {rows.length > 0 && (
        <>
          <div className="flex items-center gap-3 text-sm">
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
            <span>{rows.length} rows parsed</span>
            <Badge variant="outline" className="bg-emerald-500/10 border-emerald-500/30 text-emerald-300">
              {validRows.length} valid
            </Badge>
            {invalidCount > 0 && (
              <Badge variant="outline" className="bg-amber-500/10 border-amber-500/30 text-amber-300">
                {invalidCount} invalid
              </Badge>
            )}
            <div className="ml-auto">
              <Button
                onClick={handleImport}
                disabled={pending || validRows.length === 0}
                className="bg-gold-gradient"
              >
                {pending ? "Importing…" : `Import ${validRows.length} entries`}
              </Button>
            </div>
          </div>

          <Card className="bg-background/30 border-border/40 overflow-hidden">
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-background/60 text-[10px] font-mono uppercase tracking-wider text-muted-foreground sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left w-10">#</th>
                    <th className="px-3 py-2 text-left">Title</th>
                    <th className="px-3 py-2 text-left">Writer</th>
                    <th className="px-3 py-2 text-left">Pages</th>
                    <th className="px-3 py-2 text-left">Genre</th>
                    <th className="px-3 py-2 text-left">Script URL</th>
                    <th className="px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const v = validations[i];
                    return (
                      <tr key={i} className="border-t border-border/30">
                        <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2 truncate max-w-[200px]">{r.title || "—"}</td>
                        <td className="px-3 py-2 truncate max-w-[180px]">
                          <div>{r.writer_name || "—"}</div>
                          <div className="text-[10px] text-muted-foreground">{r.writer_email}</div>
                        </td>
                        <td className="px-3 py-2">{r.page_count ?? "—"}</td>
                        <td className="px-3 py-2 truncate max-w-[120px]">{r.genre || "—"}</td>
                        <td className="px-3 py-2 truncate max-w-[200px] text-[11px] text-muted-foreground">
                          {r.script_url || "—"}
                        </td>
                        <td className="px-3 py-2">
                          {v?.ok ? (
                            <span className="inline-flex items-center gap-1 text-emerald-300 text-[11px]">
                              <CheckCircle2 className="h-3 w-3" /> OK
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 text-amber-300 text-[11px]"
                              title={v?.errors.join(" · ")}
                            >
                              <AlertCircle className="h-3 w-3" /> {v?.errors[0]}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
