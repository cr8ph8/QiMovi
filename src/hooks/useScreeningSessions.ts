import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type ScreeningSession = Database["public"]["Tables"]["screening_sessions"]["Row"];

export function useScreeningSessions(competitionId: string | null) {
  const [sessions, setSessions] = useState<ScreeningSession[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!competitionId) {
      setSessions([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("screening_sessions")
      .select("*")
      .eq("competition_id", competitionId)
      .order("scheduled_for", { ascending: true, nullsFirst: false });
    setSessions((data ?? []) as ScreeningSession[]);
    setLoading(false);
  }, [competitionId]);

  useEffect(() => {
    setLoading(true);
    load();
    if (!competitionId) return;
    const ch = supabase
      .channel(`screenings:${competitionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "screening_sessions", filter: `competition_id=eq.${competitionId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [competitionId, load]);

  const startSession = async (id: string) => {
    const { error } = await supabase.rpc("start_screening", { _session_id: id });
    if (error) throw error;
  };
  const endSession = async (id: string) => {
    const { error } = await supabase.rpc("end_screening", { _session_id: id });
    if (error) throw error;
  };
  const finalizeSession = async (id: string, reason: string) => {
    const { error } = await supabase.rpc("finalize_screening", { _session_id: id, _reason: reason });
    if (error) throw error;
  };

  return { sessions, loading, reload: load, startSession, endSession, finalizeSession };
}

export function useEntryScreening(entryId: string | null) {
  const [session, setSession] = useState<ScreeningSession | null>(null);

  useEffect(() => {
    if (!entryId) {
      setSession(null);
      return;
    }
    let active = true;
    const load = async () => {
      const { data } = await supabase
        .from("screening_sessions")
        .select("*")
        .eq("entry_id", entryId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (active) setSession((data as ScreeningSession) ?? null);
    };
    load();
    const ch = supabase
      .channel(`entry-screening:${entryId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "screening_sessions", filter: `entry_id=eq.${entryId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(ch);
    };
  }, [entryId]);

  return session;
}
