import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface EntryReadiness {
  entry_id: string;
  rubric_complete: boolean;
  panel_resolved: boolean;
  coi_clear: boolean;
  recusals_clear: boolean;
  quorum_met: boolean;
  variance_ok: boolean;
  judge_sample_count: number;
  current_variance: number | null;
  lead_reviewed_at: string | null;
  lead_reviewed_by: string | null;
  lead_review_notes: string | null;
  updated_at: string;
}

/** Realtime view of `entry_finalize_checklist` for a single entry. */
export function useEntryReadiness(entryId: string | null) {
  const [readiness, setReadiness] = useState<EntryReadiness | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!entryId) {
      setReadiness(null);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("entry_finalize_checklist")
      .select("*")
      .eq("entry_id", entryId)
      .maybeSingle();
    setReadiness((data as EntryReadiness | null) ?? null);
    setLoading(false);
  }, [entryId]);

  useEffect(() => {
    load();
    if (!entryId) return;
    const ch = supabase
      .channel(`entry_checklist:${entryId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "entry_finalize_checklist",
          filter: `entry_id=eq.${entryId}`,
        },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [entryId, load]);

  const markReviewed = useCallback(
    async (notes?: string) => {
      if (!entryId) return null;
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { error } = await supabase
        .from("entry_finalize_checklist")
        .upsert(
          {
            entry_id: entryId,
            lead_reviewed_at: new Date().toISOString(),
            lead_reviewed_by: u.user.id,
            lead_review_notes: notes ?? null,
          },
          { onConflict: "entry_id" },
        );
      if (error) return error;
      await load();
      return null;
    },
    [entryId, load],
  );

  const clearReview = useCallback(async () => {
    if (!entryId) return;
    await supabase
      .from("entry_finalize_checklist")
      .update({ lead_reviewed_at: null, lead_reviewed_by: null })
      .eq("entry_id", entryId);
    await load();
  }, [entryId, load]);

  return { readiness, loading, reload: load, markReviewed, clearReview };
}
