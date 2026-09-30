import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type JudgeRole = "lead" | "judge";

export interface CompetitionJudge {
  id: string;
  competition_id: string;
  user_id: string;
  role: JudgeRole;
  assigned_at: string;
  assigned_by: string | null;
}

/**
 * Fetches judges/leads for a competition and exposes the current user's role
 * on that competition. Realtime-aware.
 */
export function useCompetitionJudges(competitionId: string | null) {
  const { user, isAdmin } = useAuth();
  const [judges, setJudges] = useState<CompetitionJudge[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!competitionId) {
      setJudges([]);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("competition_judges")
      .select("*")
      .eq("competition_id", competitionId)
      .order("assigned_at", { ascending: true });
    setJudges((data ?? []) as CompetitionJudge[]);
    setLoading(false);
  }, [competitionId]);

  useEffect(() => {
    refresh();
    if (!competitionId) return;
    const ch = supabase
      .channel(`competition_judges:${competitionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "competition_judges", filter: `competition_id=eq.${competitionId}` },
        () => refresh()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [competitionId, refresh]);

  const myRow = user ? judges.find((j) => j.user_id === user.id) : null;
  const isLead = isAdmin || myRow?.role === "lead";
  const isJudge = isAdmin || !!myRow;

  return { judges, loading, isLead, isJudge, myRow, refresh };
}
