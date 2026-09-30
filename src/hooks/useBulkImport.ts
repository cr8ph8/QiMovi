import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { ParsedRow } from "@/lib/judges/importTemplate";

export interface BulkImportResult {
  batch_id: string;
  imported: number;
  skipped: number;
  errors: { row: number; error: string }[];
}

export function useBulkImport() {
  const [pending, setPending] = useState(false);

  const run = async (competition_id: string, rows: ParsedRow[]): Promise<BulkImportResult | null> => {
    setPending(true);
    try {
      const { data, error } = await supabase.functions.invoke("bulk-import-entries", {
        body: { competition_id, rows },
      });
      if (error) {
        toast.error("Bulk import failed", { description: error.message });
        return null;
      }
      const res = data as BulkImportResult & { error?: string };
      if (res?.error) {
        toast.error("Bulk import rejected", { description: res.error });
        return null;
      }
      toast.success(`Imported ${res.imported} entries`, {
        description: res.skipped > 0 ? `${res.skipped} skipped` : undefined,
      });
      return res;
    } finally {
      setPending(false);
    }
  };

  return { run, pending };
}
