import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export function useFinalizeEntry() {
  const [pending, setPending] = useState<string | null>(null);

  const finalize = async (entryId: string) => {
    setPending(entryId);
    try {
      const { data, error } = await supabase.rpc("finalize_entry_score", { _entry_id: entryId });
      if (error) {
        toast.error("Could not finalize score", { description: error.message });
        return null;
      }
      const result = data as { status?: string; median?: number };
      if (result?.status === "already_finalized") {
        toast.info("Entry was already finalized");
      } else {
        toast.success("Score finalized", {
          description: result?.median != null ? `Median ${result.median}` : undefined,
        });
      }
      return result;
    } finally {
      setPending(null);
    }
  };

  return { finalize, pending };
}
