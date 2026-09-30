import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface JudgeRecusal {
  id: string;
  entry_id: string;
  judge_user_id: string;
  reason: string;
  created_by: string;
  created_at: string;
}

export function useJudgeRecusals(entryId: string | null) {
  const [recusals, setRecusals] = useState<JudgeRecusal[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!entryId) {
      setRecusals([]);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("judge_recusals")
      .select("*")
      .eq("entry_id", entryId)
      .order("created_at", { ascending: true });
    setRecusals((data ?? []) as JudgeRecusal[]);
    setLoading(false);
  }, [entryId]);

  useEffect(() => {
    load();
    if (!entryId) return;
    const ch = supabase
      .channel(`judge_recusals:${entryId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "judge_recusals", filter: `entry_id=eq.${entryId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [entryId, load]);

  const recuse = useCallback(
    async (judgeUserId: string, reason: string) => {
      if (!entryId) return new Error("No entry");
      if (reason.trim().length < 5) return new Error("Reason must be at least 5 characters");
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return new Error("Not signed in");
      const { error } = await supabase.from("judge_recusals").insert({
        entry_id: entryId,
        judge_user_id: judgeUserId,
        reason: reason.trim(),
        created_by: u.user.id,
      });
      await load();
      return error ?? null;
    },
    [entryId, load],
  );

  const unrecuse = useCallback(
    async (recusalId: string) => {
      const { error } = await supabase.from("judge_recusals").delete().eq("id", recusalId);
      await load();
      return error ?? null;
    },
    [load],
  );

  return { recusals, loading, recuse, unrecuse, reload: load };
}
